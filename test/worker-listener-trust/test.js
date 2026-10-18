/*eslint-env node*/

import assert from 'assert';
import fs from 'fs';

import {listenerDocumentTrusted, serverConfirmedIDs, userStateDelivery} from '../../lib/src/worker/listener-trust.js';

describe('worker listener watermark trust', () => {
	it('trusts only server-confirmed documents', () => {
		assert.equal(listenerDocumentTrusted(false, false), true);
		assert.equal(listenerDocumentTrusted(true, false), false);
		assert.equal(listenerDocumentTrusted(false, true), false);
		assert.equal(listenerDocumentTrusted(true, true), false);
	});

	it('applies document-level pending-write trust to the tombstone listener', () => {
		const worker = fs.readFileSync(new URL('../../src/worker/corpus-worker.ts', import.meta.url), 'utf8');
		const start = worker.indexOf('const attachTombstoneListener');
		const end = worker.indexOf('const attachDeltaListener', start);
		assert.ok(start >= 0 && end > start, 'could not isolate tombstone listener');
		const listener = worker.slice(start, end);
		assert.match(listener, /listenerDocumentTrusted\([\s\S]*snapshot\.metadata\.fromCache[\s\S]*change\.doc\.metadata\.hasPendingWrites/,
			'tombstone listener must reject both cached snapshots and pending documents');
		assert.ok(
			listener.indexOf('listenerDocumentTrusted(') < listener.indexOf('data({serverTimestamps: \'estimate\'})'),
			'the pending-write check must happen before reading a client-estimated timestamp',
		);
	});
});

describe('one-shot server-read watermark trust (review R2-2)', () => {
	const worker = fs.readFileSync(new URL('../../src/worker/corpus-worker.ts', import.meta.url), 'utf8');

	const between = (startMarker, endMarker) => {
		const start = worker.indexOf(startMarker);
		const end = worker.indexOf(endMarker, start);
		assert.ok(start >= 0 && end > start, `could not isolate region ${startMarker}`);
		return worker.slice(start, end);
	};

	it('parseSnapshot surfaces pending-write overlays for every caller', () => {
		assert.match(worker, /pendingWriteIDs = new Set<CardID>\(\)/,
			'parseSnapshot must collect pending-write ids');
		assert.match(worker, /change\.doc\.metadata\.hasPendingWrites\) pendingWriteIDs\.add\(id\)/,
			'parseSnapshot must mark docs overlaid by pending local writes');
	});

	it('partition repair contaminates pending-write overlays before they can feed the watermark', () => {
		const repair = between('const repairPartitions', '//Card IDs whose corpus entry carries a CLIENT-CLOCK');
		assert.match(repair, /contaminatePendingWriteIDs\(pendingWriteIDs\)/,
			'repairPartitions must contaminate pending-write docs');
	});

	it('cold sweep contaminates pending-write overlays and keeps them out of the start bound', () => {
		const sweep = between('const coldSweep', 'const connectUnpublishedWatermark');
		const occurrences = sweep.split('contaminatePendingWriteIDs(pendingWriteIDs)').length - 1;
		assert.ok(occurrences >= 2, `cold sweep priority phase and page sweep must both contaminate (found ${occurrences})`);
		assert.match(sweep, /if \(pendingWriteIDs\.has\(id\)\) continue;/,
			'the sweep start bound must skip client-clock estimates');
	});

	it('tombstone catch-up defers pending tombstone writes to their server acknowledgement', () => {
		const catchUp = between('const catchUpTombstones', 'const retryPendingLaunders');
		assert.ok(
			catchUp.indexOf('docSnapshot.metadata.hasPendingWrites') < catchUp.indexOf('data({serverTimestamps: \'estimate\'})'),
			'catchUpTombstones must skip pending docs before reading estimated timestamps',
		);
	});

	it('the tombstone launder re-ingest contaminates pending overlays', () => {
		const launder = between('const processTombstones', 'const catchUpTombstones');
		assert.match(launder, /snapshot\.metadata\.hasPendingWrites\) clientClockCardIDs\.add\(card\.id\)/,
			'launder re-ingest must not un-contaminate a pending overlay');
	});

	it('a server-confirmed snapshot vouches for a marked doc only when the held `updated` is the server\'s, changed or not', () => {
		//#785: the cache-first delivery marks the whole window; the
		//confirming snapshot carries no changes when the cache matched.
		const stamp = (seconds) => ({seconds, nanoseconds: 0});
		const doc = (id, updated, hasPendingWrites = false) => ({id, metadata: {hasPendingWrites}, get: (field) => (field === 'updated' ? updated : undefined)});
		const held = {a: stamp(10), b: stamp(10), c: stamp(10), echo: stamp(99)};
		const heldUpdated = (id) => held[id];
		const marked = new Set(['a', 'b', 'c', 'echo']);
		assert.deepStrictEqual(serverConfirmedIDs({metadata: {fromCache: true}, docs: [doc('a', stamp(10)), doc('b', stamp(10))]}, marked, heldUpdated), [], 'a cache view vouches for nothing');
		assert.deepStrictEqual(serverConfirmedIDs({metadata: {fromCache: false}, docs: [doc('a', stamp(10)), doc('b', stamp(10), true), doc('c', stamp(10)), doc('echo', stamp(10))]}, marked, heldUpdated), ['a', 'c'],
			'the server view vouches for unchanged docs without a pending overlay; not a pending one; not a held echo whose client stamp differs from the server image');
		assert.deepStrictEqual(serverConfirmedIDs({metadata: {fromCache: false}, docs: [doc('a', stamp(10))]}, new Set(), heldUpdated), [], 'nothing marked, nothing walked');
		assert.deepStrictEqual(serverConfirmedIDs({metadata: {fromCache: false}, docs: [doc('zzz', stamp(10))]}, marked, heldUpdated), [], 'an unmarked doc is not touched');
	});

	it('both server listener paths clear the client-clock mark over the whole confirmed result set', () => {
		const ingest = between('const ingestSnapshot', 'const listenerError');
		assert.match(ingest, /for \(const id of serverConfirmedIDs\(snapshot, clientClockCardIDs, heldUpdatedStamp\)\) clientClockCardIDs\.delete\(id\)/,
			'ingestSnapshot must clear over serverConfirmedIDs, not only admitted changes');
		const delta = between('const attachDeltaListener', 'const unpublishedPartitionPageQuery');
		assert.match(delta, /for \(const id of serverConfirmedIDs\(snapshot, clientClockCardIDs, heldUpdatedStamp\)\) clientClockCardIDs\.delete\(id\)/,
			'the delta listener must clear over serverConfirmedIDs, not only docChanges');
	});

	it('server listener deliveries never un-contaminate a doc still overlaid by a pending write', () => {
		const ingest = between('const ingestSnapshot', 'const listenerError');
		assert.match(ingest, /if \(!parsed\.pendingWriteIDs\.has\(id\)\) clientClockCardIDs\.delete\(id\)/,
			'ingestSnapshot must exclude pending-write docs from un-contamination');
	});

	it('per-user state listeners drop an empty cache first delivery, take the server\'s empty confirmation as the set, and skip metadata-only events after that', () => {
		//#776: on the memory cache the offline (or still-unknown) SDK raises
		//the empty cache first; the server's confirmation of an empty set is
		//a metadata-only event, which the listeners opt into.
		assert.strictEqual(userStateDelivery(true, true, true, 0), 'drop', 'empty cache first delivery is not the set');
		assert.strictEqual(userStateDelivery(true, false, true, 0), 'authoritative', 'the server saying "empty" IS the set, even with no changes');
		assert.strictEqual(userStateDelivery(true, true, false, 2), 'authoritative', 'a cache first delivery with content is served');
		assert.strictEqual(userStateDelivery(true, false, false, 2), 'authoritative');
		assert.strictEqual(userStateDelivery(false, false, true, 0), 'skip', 'a later metadata-only event carries nothing');
		assert.strictEqual(userStateDelivery(false, false, false, 1), 'delta');
		const worker = fs.readFileSync(new URL('../../src/worker/corpus-worker.ts', import.meta.url), 'utf8').replace(/\/\/[^\n]*/g, '');
		const stars = worker.slice(worker.indexOf('const cardIDDeltaListener'), worker.indexOf('const attachReadingList'));
		assert.match(stars, /\{includeMetadataChanges: true\},/, 'stars and reads listen with metadata changes, or an empty set never confirms');
		assert.match(stars, /userStateDelivery\(firstDelivery, snapshot\.metadata\.fromCache, snapshot\.empty, snapshot\.docChanges\(\)\.length\)/);
		const reading = worker.slice(worker.indexOf('const attachReadingList'), worker.indexOf('const connectPublished ='));
		assert.match(reading, /\{includeMetadataChanges: true\},/, 'the reading list too');
		assert.match(reading, /let firstDelivery = true;[\s\S]{0,400}userStateDelivery\(firstDelivery,/, 'the reading list latch is per attach, so a re-attached listener sends its first delivery as the whole set');
		//The compact snapshot's sections and tags are restored only while the
		//live listener has not delivered, on BOTH prime paths.
		assert.strictEqual((worker.match(/!supplementalDelivered\.sections && compactSnapshot\.sections/g) || []).length, 2, 'both restores guard sections on delivery');
		assert.strictEqual((worker.match(/!supplementalDelivered\.tags && compactSnapshot\.tags/g) || []).length, 2, 'both restores guard tags on delivery');
		assert.match(worker, /supplementalDelivered\[type\] = true;/, 'the live listener marks delivery');
	});
});

/*eslint-env node*/

import assert from 'assert';
import fs from 'fs';

import {listenerDocumentTrusted} from '../../lib/src/worker/listener-trust.js';

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
			listener.indexOf('listenerDocumentTrusted(') < listener.indexOf("data({serverTimestamps: 'estimate'})"),
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
			catchUp.indexOf('docSnapshot.metadata.hasPendingWrites') < catchUp.indexOf("data({serverTimestamps: 'estimate'})"),
			'catchUpTombstones must skip pending docs before reading estimated timestamps',
		);
	});

	it('the tombstone launder re-ingest contaminates pending overlays', () => {
		const launder = between('const processTombstones', 'const catchUpTombstones');
		assert.match(launder, /snapshot\.metadata\.hasPendingWrites\) clientClockCardIDs\.add\(card\.id\)/,
			'launder re-ingest must not un-contaminate a pending overlay');
	});

	it('server listener deliveries never un-contaminate a doc still overlaid by a pending write', () => {
		const ingest = between('const ingestSnapshot', 'const listenerError');
		assert.match(ingest, /if \(!parsed\.pendingWriteIDs\.has\(id\)\) clientClockCardIDs\.delete\(id\)/,
			'ingestSnapshot must exclude pending-write docs from un-contamination');
	});
});

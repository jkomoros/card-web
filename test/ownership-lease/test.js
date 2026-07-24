/*eslint-env node*/

import assert from 'assert';
import fs from 'fs';

import {heartbeatDecision, leaseBelongsTo, nextOwnershipLease} from '../../lib/src/ownership-lease.js';

const lease = (tabID, epoch) => ({
	version: 1,
	tabID,
	epoch,
	heartbeatAt: 100,
	dirty: false,
	pending: false,
});

describe('ownership heartbeat fencing', () => {
	it('deactivates instead of overwriting a forced-takeover epoch', () => {
		assert.equal(heartbeatDecision(true, 'old', 4, lease('new', 5)), 'deactivate');
		assert.equal(leaseBelongsTo(lease('new', 5), 'old', 4), false);
	});

	it('also rejects a foreign token with the same or older epoch', () => {
		assert.equal(heartbeatDecision(true, 'old', 4, lease('new', 4)), 'deactivate');
		assert.equal(heartbeatDecision(true, 'old', 4, lease('new', 3)), 'deactivate');
	});

	it('writes only while the local token remains authoritative', () => {
		assert.equal(heartbeatDecision(true, 'owner', 7, lease('owner', 7)), 'write');
		assert.equal(heartbeatDecision(true, 'owner', 7, null), 'write');
		assert.equal(heartbeatDecision(false, 'owner', 7, lease('owner', 7)), 'skip');
	});

	it('claims a newer durable epoch before a reloaded page starts its heartbeat', () => {
		const claim = nextOwnershipLease('reload', 0, lease('old-page', 7), 200, {dirty: false, pending: false});
		assert.deepEqual(claim, {
			version: 1,
			tabID: 'reload',
			epoch: 8,
			heartbeatAt: 200,
			dirty: false,
			pending: false,
		});
		assert.equal(heartbeatDecision(true, claim.tabID, claim.epoch, claim), 'write');
	});

	it('disconnects ambient listeners on the normal supersession path', () => {
		const bridge = fs.readFileSync(new URL('../../src/corpus-bridge.ts', import.meta.url), 'utf8');
		const start = bridge.indexOf('const purgeAndDeactivate');
		const end = bridge.indexOf('function deactivateSupersededOwnership', start);
		assert.ok(start >= 0 && end > start, 'could not isolate purgeAndDeactivate');
		assert.match(
			bridge.slice(start, end),
			/disconnectBackgroundDataForInactiveTab/,
			'a superseded tab must stop supplemental listeners and warmup traffic',
		);
	});

	it('does not contend with the compact snapshot read while polling ownership', () => {
		const worker = fs.readFileSync(new URL('../../src/worker/corpus-worker.ts', import.meta.url), 'utf8');
		const connectStart = worker.indexOf('const connectUnpublishedWatermark');
		const connectEnd = worker.indexOf('const connectCards', connectStart);
		assert.ok(connectStart >= 0 && connectEnd > connectStart, 'could not isolate watermark connection');
		const connection = worker.slice(connectStart, connectEnd);
		const snapshotLoad = connection.indexOf('await corpusSnapshotStore.load()');
		const postLoadOwnershipCheck = connection.indexOf('await corpusSnapshotStore.ownsCurrentOwnership()');
		const guardInterval = connection.indexOf('ownershipEpochGuard = setInterval');
		assert.ok(snapshotLoad >= 0 && postLoadOwnershipCheck > snapshotLoad && guardInterval > postLoadOwnershipCheck,
			'load the compact snapshot, revalidate once, then start steady-state polling');
	});

	it('defers the large published cache listener until after the compact prime handoff', () => {
		const worker = fs.readFileSync(new URL('../../src/worker/corpus-worker.ts', import.meta.url), 'utf8');
		const connectStart = worker.indexOf('const connectUnpublishedWatermark');
		const connectEnd = worker.indexOf('const connectCards', connectStart);
		assert.ok(connectStart >= 0 && connectEnd > connectStart, 'could not isolate watermark connection');
		const connection = worker.slice(connectStart, connectEnd);
		const snapshotLoad = connection.indexOf('await corpusSnapshotStore.load()');
		const primeHandoff = connection.indexOf('forwardBatch(primedUnpublished');
		const publishedListener = connection.lastIndexOf('if (deferPublishedUntilAfterPrime) connectPublished()');
		assert.ok(snapshotLoad >= 0 && primeHandoff > snapshotLoad && publishedListener > primeHandoff,
			'compact snapshot must load and hand off before the published listener starts its cache query');
	});
});

describe('review round-2 wiring fixes', () => {
	it('unsubscribing a worker collection slot resets the fast-resubscribe memo (review R2-4a)', () => {
		const bridge = fs.readFileSync(new URL('../../src/corpus-bridge.ts', import.meta.url), 'utf8');
		const start = bridge.indexOf('const ensureSubscription');
		const end = bridge.indexOf('//cardSimilarity is snapshotted', start);
		assert.ok(start >= 0 && end > start, 'could not isolate ensureSubscription');
		const unsubscribePath = bridge.slice(start, end);
		assert.match(unsubscribePath, /subscription\.descriptionSerialized = '';/,
			'the unsubscribe path must clear descriptionSerialized, or the per-dispatch change check runs forever and identical reopened queries fall back to the throttled path');
	});

	it('a superseded sync-meta claim tears the worker down instead of throwing (review R2-4b)', () => {
		const worker = fs.readFileSync(new URL('../../src/worker/corpus-worker.ts', import.meta.url), 'utf8');
		const start = worker.indexOf('const loadSyncMeta = async () =>');
		const end = worker.indexOf('corpusSnapshotStore = new CorpusSnapshotStore', start);
		assert.ok(start >= 0 && end > start, 'could not isolate loadSyncMeta');
		const loader = worker.slice(start, end);
		assert.match(loader, /await stopSupersededWorker\(/,
			'a failed sync-meta ownership claim must stop the superseded worker');
		assert.ok(!/throw new Error/.test(loader),
			'the claim failure must not throw (it was swallowed by the prime cache catch and surfaced as an unhandled rejection post-prime)');
	});
});

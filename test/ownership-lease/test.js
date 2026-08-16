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

describe('pre-land debt fixes (round 5)', () => {
	const bridge = fs.readFileSync(new URL('../../src/corpus-bridge.ts', import.meta.url), 'utf8');
	const database = fs.readFileSync(new URL('../../src/actions/database.ts', import.meta.url), 'utf8');
	const data = fs.readFileSync(new URL('../../src/actions/data.ts', import.meta.url), 'utf8');

	it('a blocked-at-boot tab goes network-inert and reconnects only after winning a takeover', () => {
		const contended = bridge.indexOf("setOwnershipStatus('contended'");
		assert.ok(contended >= 0);
		assert.ok(bridge.indexOf('disconnectBackgroundData();', contended) >= 0,
			'the contended boot path must tear down ambient listeners');
		assert.match(bridge, /const activateOwnedConnection[\s\S]{0,600}reconnectBackgroundDataForActiveTab/,
			'winning a takeover must re-attach what the blocked boot tore down');
		assert.match(database, /if \(!backgroundDataInert\) return;/,
			'reconnect must be a no-op for tabs that were never made inert');
		const guards = database.split('if (backgroundDataInert) return;').length - 1;
		assert.ok(guards >= 10, `attach functions must no-op while inert (found ${guards} guards)`);
	});

	it('a stolen Web Lock deactivates the old owner even when the lease is gone', () => {
		assert.match(bridge, /granted && ownershipState === 'active'[\s\S]{0,120}purgeAndDeactivate\(\)/,
			'the steal-induced lock rejection must deactivate directly, closing the null-lease resurrection path');
	});

	it('bulk-tag resume skips confirmed-deleted targets instead of wedging', () => {
		const start = data.indexOf('const missingIDs = chunkIDs.filter(id => !rawCards[id]);');
		assert.ok(start >= 0, 'bulk-tag executor must classify missing targets');
		const executor = data.slice(start, start + 1200);
		assert.match(executor, /authoritativeCardsAfterFailedCommit\(missingIDs\)/,
			'missing targets must be read authoritatively, not thrown on');
		assert.match(executor, /removedIDs\.length/,
			'confirmed-deleted targets must be counted as skipped');
		assert.ok(!executor.includes('Cannot safely continue'),
			'the wedge-forever error must be gone from the missing-target path');
	});
});

describe('reader multi-tab (anonymous ownership bypass)', () => {
	const bridge = fs.readFileSync(new URL('../../src/corpus-bridge.ts', import.meta.url), 'utf8');

	it('anonymous fresh visitors bypass exclusive ownership entirely', () => {
		//Round-6 audit: the original predicate required an EMPTY uid, but this
		//deployment auto-signs every visitor in anonymously — so no visitor
		//ever qualified and the reader path was dead code. Readerness must
		//accept the anonymous-auth uid.
		assert.match(bridge, /readerConnectionParams[\s\S]{0,500}selectUserIsAnonymous/,
			'readers include anonymously-signed-in sessions, not just pre-auth empty uids');
		assert.match(bridge, /if \(ownershipState !== 'active' && ownershipState !== 'reader'\) return;/,
			"connectWorkerNow must admit the reader state — the original guard made the reader worker unspawnable (round-6 audit's Bug A)");
		assert.match(bridge, /activateReaderConnection[\s\S]{0,400}configureMutationOwnership\(\(\) => true/,
			'reader tabs must not fence user-scoped writes');
		//Hoisted into a const when the signed-out cache purge began gating on the
		//same expression; assert BOTH halves so the pin still means what it did.
		assert.match(bridge, /const persist = corpusWorkerOwnsCardIngestion\(\) && ownershipState !== 'reader';/,
			'reader workers must never claim the persistent single-tab cache — that is what makes N tabs safe');
		assert.match(bridge, /post\(\{type: 'connect'[^\n]*persist,/,
			'and that computed value must be what is actually sent');
		//The purge deletes the persistent cache; a reader boot must never
		//trigger it, or N reader tabs could delete the owner's database.
		assert.match(bridge, /purgePersistence: persist && Boolean\(pendingPersistencePurgeUid\(\)\)/,
			'the signed-out cache purge must be gated on the same persist expression');
	});

	it('keeps the anonymous-signin loop guard while routing readers on a separate key', () => {
		const user = fs.readFileSync(new URL('../../src/actions/user.ts', import.meta.url), 'utf8');
		const bridge = fs.readFileSync(new URL('../../src/corpus-bridge.ts', import.meta.url), 'utf8');
		//hasPreviousSignIn exists to stop signOutSuccess from calling
		//signInAnonymously again on the next null-auth event. An earlier
		//attempt to make the reader path reachable CLEARED it for anonymous
		//users, removing that guard. (NOTE: that hazard is real but was NOT
		//the cause of the owner-reported "sign-in loops" symptom — no reload
		//path in this app is reachable from auth state. The likely cause was
		//a blocked popup failing SILENTLY, since SIGNIN_FAILURE is not
		//rendered anywhere; see the redirect fallback and the alert in
		//signIn().) Reader routing gets its own signal regardless.
		assert.match(user, /\n\tflagHasPreviousSignIn\(\);/,
			'the loop guard must be set unconditionally, including for anonymous sign-ins');
		assert.ok(!user.includes('clearHasPreviousSignIn'),
			'nothing may clear the anonymous-signin loop guard');
		assert.match(user, /if \(!firebaseUser\.isAnonymous\) flagHasPreviousRealSignIn\(\);/,
			'reader routing needs its own real-sign-in signal');
		assert.match(bridge, /hasPreviousRealSignIn/,
			'the bridge must route on the real-sign-in key, not the loop guard');
	});

	it('previously-signed-in devices route straight to exclusive acquisition', () => {
		assert.match(bridge, /probablyWillSignIn\(\)[\s\S]{0,120}beginInitialOwnership/,
			'admin boots must not pay a throwaway reader worker');
	});

	it('a reader session that signs in privileged restarts the worker into owned mode', () => {
		assert.match(bridge, /upgradeReaderToOwnedConnection[\s\S]{0,600}stopWorker\(\);[\s\S]{0,300}beginInitialOwnership/,
			'persist mode cannot flip post-init; upgrade must restart the worker through real acquisition');
		assert.match(bridge, /ownershipAcquisitionStarted = false;/,
			'the acquisition guard must reset or the upgrade never acquires');
	});

	it('reader tabs ignore the ownership takeover protocol', () => {
		assert.match(bridge, /message\.type === 'request' && ownershipState === 'active'/,
			'only an ACTIVE owner may grant takeovers — reader tabs hold nothing to grant');
	});
});

describe('sign-in propagation from an anonymous (reader) session', () => {
	const user = fs.readFileSync(new URL('../../src/actions/user.ts', import.meta.url), 'utf8');

	it('the anonymous link path dispatches signInSuccess itself', () => {
		//linkWithPopup keeps the SAME uid, so onAuthStateChanged (the app's
		//only sign-in propagation path, in user-chip) does not fire — the
		//signed-in user did not change, only its providers did. Without an
		//explicit dispatch the UI renders the anonymous session until a
		//manual reload. This became reachable on every visit once anonymous
		//sign-ins stopped setting the previous-sign-in marker (round 6).
		assert.match(user, /const linked = await linkWithPopup\(user, provider\);[\s\S]{0,600}dispatch\(signInSuccess\(linked\.user\)\);/,
			'a successful anonymous->Google link must propagate the new user to the store');
	});
});

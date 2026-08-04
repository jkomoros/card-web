/*eslint-env node*/

//The star/read/reading-list toggles never applied anything locally: the UI was
//painted entirely by the Firestore listener echo, instant only because the write
//and the listener shared ONE Firestore instance. Those listeners now live in the
//CORPUS WORKER -- the only context with a persistent cache, so its re-attach
//bills deltas rather than the whole result set -- and that instance knows
//nothing about the main thread's pending write. Without an optimistic layer
//every toggle would wait for a server round trip before visibly doing anything.
//
//THE INVARIANT THAT MATTERS, and the one an earlier version got wrong: the
//outcome of the FIRST attempt does not decide anything. `runDurableAuxWrite`
//answers 'queued' for anything retryable and returns, and the intent can still
//die much later -- on a replay that hits a permanent failure (the target card
//was deleted meanwhile) or by ageing out after 30 days. Neither can reach a
//closure that already returned, so a discarded star stayed visibly starred for
//the rest of the session. These tests drive that real sequence through the REAL
//queue rather than a truth table over the wrapper.

import assert from 'assert';
import {bootstrapApp, clearAuxQueue} from '../harness-support/app-harness.js';

let queue;
let user;
let store;
let UID;

const permanent = () => Object.assign(new Error('the card was deleted'), {code: 'not-found'});

describe('optimistic per-user state survives a LATE discard', () => {
	before(async () => {
		const app = await bootstrapApp();
		store = app.store;
		UID = app.uid;
		queue = await import('../../lib/src/aux-write-queue.js');
		user = await import('../../lib/src/actions/user.js');
		//ONCE, and deliberately not per-test. resetAuxWriteQueueForTesting()
		//clears the queue's discard subscribers, while the reconciler's own
		//install guard (which exists so repeated sign-ins do not register it
		//twice) refuses to add it back — so resetting per test would silently
		//leave every case after the first with no subscriber at all. Production
		//never calls the reset, so this is a test-only interaction, but it is
		//exactly the shape that makes a suite pass for the wrong reason.
		queue.resetAuxWriteQueueForTesting();
		user.installOptimisticUserStateReconciler();
	});

	beforeEach(() => {
		clearAuxQueue();
		store.dispatch(user.updateStars([], Object.keys(store.getState().user.stars || {})));
	});

	const starred = (id) => Boolean(store.getState().user.stars[id]);

	it('reverts a star discarded on REPLAY, long after the first attempt said queued', async () => {
		//The exact scenario: star on a flaky connection (queued, so the UI keeps
		//the star and the queue promises a retry), the card is deleted
		//meanwhile, and the replay then earns a permanent failure.
		const id = 'card-late-discard';
		queue.registerAuxWriteExecutor('star-add', async () => { throw new Error('offline'); });
		store.dispatch(user.updateStars([id], []));
		assert.equal(starred(id), true, 'the optimistic star is applied immediately');

		const outcome = await queue.runDurableAuxWrite(queue.makeAuxWriteIntent(UID, 'star-add', id));
		assert.equal(outcome, 'queued', 'a transient failure is retained, not discarded');
		assert.equal(starred(id), true, 'a QUEUED write keeps the star: the intent is durable and will retry');

		//Now the card is gone, so the replay fails permanently.
		queue.registerAuxWriteExecutor('star-add', async () => { throw permanent(); });
		await queue.replayPendingAuxWrites(UID);

		assert.deepEqual(queue.readPendingAuxWrites(), [], 'the intent is discarded');
		assert.equal(starred(id), false,
			'and the star must be REVERTED -- observing only the first attempt left it visibly starred forever');
	});

	it('reverts a star discarded on the FIRST attempt too', async () => {
		const id = 'card-immediate-discard';
		queue.registerAuxWriteExecutor('star-add', async () => { throw permanent(); });
		store.dispatch(user.updateStars([id], []));
		await queue.runDurableAuxWrite(queue.makeAuxWriteIntent(UID, 'star-add', id));
		assert.equal(starred(id), false);
	});

	it('reverts a star-REMOVE by putting the star back', async () => {
		const id = 'card-remove-discard';
		store.dispatch(user.updateStars([id], []));
		queue.registerAuxWriteExecutor('star-remove', async () => { throw permanent(); });
		store.dispatch(user.updateStars([], [id]));
		assert.equal(starred(id), false, 'optimistically unstarred');
		await queue.runDurableAuxWrite(queue.makeAuxWriteIntent(UID, 'star-remove', id));
		assert.equal(starred(id), true, 'a discarded removal must restore the star');
	});

	it('does NOT revert another account\'s discarded intent', async () => {
		//An intent belonging to a previous account is discarded after a switch
		//(its replay earns permission-denied, which is classified permanent).
		//Reverting then would corrupt the CURRENT user's state.
		const id = 'card-other-account';
		store.dispatch(user.updateStars([id], []));
		queue.registerAuxWriteExecutor('star-add', async () => { throw permanent(); });
		await queue.runDurableAuxWrite(queue.makeAuxWriteIntent('some-other-uid', 'star-add', id));
		assert.equal(starred(id), true, 'the current account\'s state is untouched');
	});

	it('an optimistic update does NOT claim the authoritative set has loaded', () => {
		//`starsLoaded` gates selectDataIsFullyLoaded. A local star -- or
		//auto-mark-read firing on boot -- would otherwise flip it with a single
		//entry while the real set was still in flight, and everything gated on
		//"user state loaded" would proceed against one card instead of hundreds.
		store.dispatch({type: 'SIGNOUT_SUCCESS'});
		store.dispatch(user.updateStars(['card-x'], [], true));
		assert.equal(store.getState().user.starsLoaded, false,
			'an optimistic star must not mark the star set loaded');
		store.dispatch(user.updateStars(['card-y'], []));
		assert.equal(store.getState().user.starsLoaded, true,
			'the authoritative delivery does mark it loaded');
		//And once loaded, a later optimistic update must not UNSET it.
		store.dispatch(user.updateStars(['card-z'], [], true));
		assert.equal(store.getState().user.starsLoaded, true);
	});
});

describe('a full re-delivery cannot reverse the user\'s last action', () => {
	let queue;
	let user;
	let store;
	let UID;

	before(async () => {
		const app = await bootstrapApp();
		store = app.store;
		UID = app.uid;
		queue = await import('../../lib/src/aux-write-queue.js');
		user = await import('../../lib/src/actions/user.js');
	});

	beforeEach(() => {
		clearAuxQueue();
		store.dispatch({type: 'SIGNOUT_SUCCESS'});
		store.dispatch({type: 'SIGNIN_SUCCESS', user: {uid: UID, isAnonymous: false, photoURL: '', displayName: 'Harness', email: 'h@example.com'}});
	});

	const starred = (id) => Boolean(store.getState().user.stars[id]);

	it('REPLACES rather than unions, so a removal can be expressed at all', () => {
		//Firestore reports the first snapshot after an attach as every document
		//`added`. Applied as a delta, the reducer unions it in and a star
		//removed on ANOTHER device could never disappear here.
		store.dispatch(user.updateStars(['a', 'b', 'c'], []));
		store.dispatch(user.receiveAuthoritativeStars(['a', 'c']));
		assert.deepEqual(Object.keys(store.getState().user.stars).sort(), ['a', 'c'],
			'b was removed elsewhere and must be gone');
	});

	it('keeps a PENDING removal that the server has not applied yet', () => {
		//THE REGRESSION. Unstar while offline: the write is queued, so the
		//server legitimately still has the star. A re-attach then re-delivered
		//it and the star came back, silently reversing the last thing the user
		//did -- while their removal was still sitting in the queue.
		queue.registerAuxWriteExecutor('star-remove', async () => { throw new Error('offline'); });
		store.dispatch(user.updateStars(['a', 'b'], []));
		return queue.runDurableAuxWrite(queue.makeAuxWriteIntent(UID, 'star-remove', 'b')).then(outcome => {
			assert.equal(outcome, 'queued');
			store.dispatch(user.updateStars([], ['b'], true));
			assert.equal(starred('b'), false, 'optimistically unstarred');

			//The server still reports both, because the removal has not landed.
			store.dispatch(user.receiveAuthoritativeStars(['a', 'b']));
			assert.equal(starred('b'), false,
				'the pending removal must survive an authoritative re-delivery');
			assert.equal(starred('a'), true, 'and untouched stars remain');
		});
	});

	it('keeps a PENDING add the server has not applied yet', () => {
		//The mirror image, and it also repairs something that predates the
		//optimistic layer: after a reload a queued-but-unsent star used to be
		//invisible until it committed.
		queue.registerAuxWriteExecutor('star-add', async () => { throw new Error('offline'); });
		return queue.runDurableAuxWrite(queue.makeAuxWriteIntent(UID, 'star-add', 'new-card')).then(() => {
			store.dispatch(user.receiveAuthoritativeStars([]));
			assert.equal(starred('new-card'), true,
				'a queued star must be shown even though the server has never seen it');
		});
	});

	it('ignores another account\'s pending intents', () => {
		queue.registerAuxWriteExecutor('star-add', async () => { throw new Error('offline'); });
		return queue.runDurableAuxWrite(queue.makeAuxWriteIntent('someone-else', 'star-add', 'theirs')).then(() => {
			store.dispatch(user.receiveAuthoritativeStars(['mine']));
			assert.equal(starred('theirs'), false);
			assert.equal(starred('mine'), true);
		});
	});
});

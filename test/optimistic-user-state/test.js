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
});

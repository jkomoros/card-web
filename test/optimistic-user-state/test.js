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
import {readFileSync} from 'fs';
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

//D7. These six actions each swallowed the guard's refusal into a console.log
//and returned: tap star, or read, or add-to-reading-list, and NOTHING happens —
//no change, no message, an unmarked dead control. The copy to explain it already
//existed one stack frame away and was being discarded.
//
//SCOPE NOTE, so the next reader is not misled about what is covered here. The
//other half of this change (D24 — applyOptimistically explaining its revert)
//is NOT exercised by this file, and I could not honestly make it be: every one
//of the six actions awaits awaitInteractableCollection first, and in this
//harness there is no interactable collection, so the guard refuses before
//applyOptimistically is ever reached. Testing the revert message needs a seeded
//active collection, which this harness cannot currently produce. Treat the D24
//copy as unverified at runtime rather than as covered by these three tests.
describe('a refused action says why instead of doing nothing', () => {
	before(async () => {
		const app = await bootstrapApp();
		store = app.store;
		UID = app.uid;
		queue = await import('../../lib/src/aux-write-queue.js');
		user = await import('../../lib/src/actions/user.js');
	});

	beforeEach(() => {
		clearAuxQueue();
		queue.resetAuxWriteQueueForTesting();
		//An earlier block in this file leaves the store signed OUT, and addStar
		//returns at its !uid guard before ever reaching the guard under test —
		//which is how the first version of these tests passed in isolation and
		//failed in the suite, asserting on an empty list either way.
		store.dispatch({type: 'SIGNIN_SUCCESS', user: {
			uid: UID, isAnonymous: false, photoURL: '', displayName: 'Harness', email: 'harness@example.com'
		}});
	});

	const snackbars = () => (store.getState().app.snackbars || []).map(entry => entry.message);
	//The action thunks await the guard, so the dispatch resolves after it, but
	//let the microtask queue drain regardless.
	const settle = () => new Promise(resolve => setTimeout(resolve, 0));

	it('tells the user when a star does nothing', async () => {
		await store.dispatch(user.addStar({id: 'card-d7'}));
		await settle();
		const said = snackbars();
		assert.ok(said.length > 0, 'a refused star must not be silent — that is an unmarked dead control');
		assert.ok(said.some(text => /still loading|placeholder content/i.test(text)),
			`the refusal must name the reason; snackbars were ${JSON.stringify(said)}`);
	});

	it('says the same for marking read', async () => {
		await store.dispatch(user.markRead({id: 'card-d7b'}));
		await settle();
		assert.ok(snackbars().length > 0, 'a refused read must not be silent either');
	});

	it('collapses three refused controls into one message', async () => {
		await store.dispatch(user.addStar({id: 'card-d7c'}));
		await store.dispatch(user.markRead({id: 'card-d7d'}));
		await store.dispatch(user.addToReadingList({id: 'card-d7e'}));
		await settle();
		//They share one cause, so they are one situation, not three.
		assert.strictEqual(snackbars().length, 1,
			`three controls refused for the same reason is one message; got ${JSON.stringify(snackbars())}`);
	});

	//SOURCE PIN, and it has to be. The runtime version of this test was VACUOUS:
	//this harness has no collection at all, so the guard always takes its
	//"still loading" branch and the fallback message is unreachable — I
	//confirmed that by reintroducing the old internal phrase and watching the
	//runtime assertion stay green. Both of the guard's messages are now shown to
	//the user verbatim, so both have to read like copy, and the only way to check
	//the one this harness cannot reach is to read it.
	it('keeps internal vocabulary out of both messages the guard throws', () => {
		const source = readFileSync(new URL('../../src/actions/fallback-guard.ts', import.meta.url), 'utf8');
		const thrown = [...source.matchAll(/throw new Error\('([^']+)'\)/g)].map(match => match[1]);
		assert.ok(thrown.length >= 2, `expected both guard messages, found ${thrown.length}`);
		for (const message of thrown) {
			assert.doesNotMatch(message, /fallback|isFallback|collection is not interactable/i,
				`"${message}" leaks an internal concept (HS-1.4) and is shown to the user verbatim`);
			assert.match(message, /[a-z]\u2019?t?\.?$|\.$/,
				`"${message}" should read as a sentence, not a diagnostic`);
		}
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

	it('keeps a PENDING reading-list add across a full delivery', () => {
		//The reading list never got this treatment: the bridge replaced it
		//wholesale on every worker delivery, and EVERY delivery is a full list.
		//Queue an add on a flaky connection, receive any delivery -- including
		//the post-error re-attach that the listener retry made routine -- and
		//the user's action visibly reversed itself.
		queue.registerAuxWriteExecutor('reading-list-add', async () => { throw new Error('offline'); });
		store.dispatch(user.updateReadingList(['a', 'b']));
		return queue.runDurableAuxWrite(queue.makeAuxWriteIntent(UID, 'reading-list-add', 'c', 'k1')).then(outcome => {
			assert.equal(outcome, 'queued');
			store.dispatch(user.updateReadingList(['a', 'b', 'c'], true));
			//The server has not applied it, so its full list still lacks 'c'.
			store.dispatch(user.receiveAuthoritativeReadingList(['a', 'b']));
			assert.deepEqual(store.getState().user.readingList, ['a', 'b', 'c'],
				'a queued add must survive an authoritative full-list delivery');
		});
	});

	it('keeps a PENDING reading-list removal, and preserves ORDER', () => {
		queue.registerAuxWriteExecutor('reading-list-remove', async () => { throw new Error('offline'); });
		return queue.runDurableAuxWrite(queue.makeAuxWriteIntent(UID, 'reading-list-remove', 'b', 'k2')).then(() => {
			store.dispatch(user.receiveAuthoritativeReadingList(['a', 'b', 'c']));
			assert.deepEqual(store.getState().user.readingList, ['a', 'c'],
				'a queued removal must survive, and the remaining order must be the server\'s');
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

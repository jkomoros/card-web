/*eslint-env node, es2022*/

import assert from 'assert';
import {bootstrapApp, wireCard, clearAuxQueue, clearWhatUserWasTold, whatUserWasTold} from '../harness-support/app-harness.js';

const {store, db, uid, firestore} = await bootstrapApp();
const {doc, setDoc, getDoc, getDocs, collection, updateDoc, Transaction, serverTimestamp} = firestore;
const {modifyCardsWithDurableMultiEdit, modifyCardsWithDurableTagOperation} = await import('../../lib/src/actions/data.js');
const {MultiBatch} = await import('../../lib/src/multi_batch.js');
const keys = {multi: 'card-web-pending-multi-edit-v1', tag: 'card-web-pending-bulk-tag-operation-v1'};
let serial = 0;

const seed = async (count = 1) => {
	const tag = `lifecycle-${Date.now()}-${serial++}`;
	const tagData = {id: tag, title: tag, cards: []};
	await setDoc(doc(db, 'tags', tag), tagData);
	store.dispatch({type: 'UPDATE_TAGS', tags: {[tag]: tagData}});
	const cards = Array.from({length: count}, (_,index) => ({...wireCard(`${tag}-${index}`, uid), id: `${tag}-${index}`}));
	await Promise.all(cards.map(card => setDoc(doc(db, 'cards', card.id), card)));
	store.dispatch({type: 'UPDATE_CARDS', cards: Object.fromEntries(cards.map(card => [card.id, card])), fetchType: 'unpublished'});
	return {cards, tag};
};

const run = (kind, cards, tag) => store.dispatch(kind === 'tag'
	? modifyCardsWithDurableTagOperation(cards, tag, true)
	: modifyCardsWithDurableMultiEdit(cards, {notes: 'durable new notes'}));

const read = kind => JSON.parse(localStorage.getItem(keys[kind]));

describe('durable operation ownership and commit-time content guards', function() {
	this.timeout(120000);
	let originalCommit;
	let originalUser;
	beforeEach(() => {
		originalCommit = MultiBatch.prototype.commit;
		originalUser = store.getState().user.user;
		clearAuxQueue();
		for (const key of Object.values(keys)) localStorage.removeItem(key);
		clearWhatUserWasTold(store);
		store.dispatch({type: 'UPDATE_USER_PERMISSIONS', permissions: {admin: true}});
		store.dispatch({type: 'UPDATE_CORPUS_STATUS', status: 'live', message: ''});
	});
	afterEach(() => {
		MultiBatch.prototype.commit = originalCommit;
		store.dispatch({type: 'SIGNIN_SUCCESS', user: originalUser});
		for (const key of Object.values(keys)) localStorage.removeItem(key);
	});

	for (const kind of ['tag', 'multi']) {
		for (const outcome of ['reject', 'confirm']) {
			for (const replacement of ['removed', 'different', 'advanced']) {
				it(`${kind}: late ${outcome} preserves ${replacement} cross-tab state`, async () => {
					const {cards, tag} = await seed(16);
					let expected;
					MultiBatch.prototype.commit = async function(...args) {
						if (outcome === 'confirm') await originalCommit.apply(this, args);
						const current = read(kind);
						if (replacement === 'removed') {
							localStorage.removeItem(keys[kind]);
							expected = null;
						} else {
							expected = {...current, ...(replacement === 'different' ? {id: `${current.id}-newer`} : {nextIndex: 16})};
							localStorage.setItem(keys[kind], JSON.stringify(expected));
						}
						if (outcome === 'reject') throw new Error('Old tab lost mutation ownership');
					};
					await run(kind, cards, tag);
					const actual = read(kind);
					if (expected === null) assert.equal(actual, null, 'must not resurrect a cleared intent');
					else {
						assert.equal(actual.id, expected.id, 'must not replace the newer intent');
						assert.equal(actual.nextIndex, expected.nextIndex, 'must not rewind the newer cursor');
					}
				});
			}
		}

		it(`${kind}: preserves an unreadable newer record on late failure`, async () => {
			const {cards, tag} = await seed();
			MultiBatch.prototype.commit = async () => {
				localStorage.setItem(keys[kind], '{unreadable-but-not-discardable');
				throw new Error('Old tab lost mutation ownership');
			};
			await run(kind, cards, tag);
			assert.equal(localStorage.getItem(keys[kind]), '{unreadable-but-not-discardable');
		});

		it(`${kind}: storage quota failure does not claim a retryable intent`, async () => {
			const {cards, tag} = await seed();
			const prototype = Object.getPrototypeOf(localStorage);
			const originalSet = prototype.setItem;
			prototype.setItem = function(key, value) {
				if (key === keys[kind]) throw new Error('Quota exceeded');
				return originalSet.call(this, key, value);
			};
			try { await run(kind, cards, tag); } finally { prototype.setItem = originalSet; }
			assert.equal(read(kind), null);
			assert.ok(whatUserWasTold(store).some(message => /No retryable operation was saved/.test(message)));
			assert.ok(!whatUserWasTold(store).some(message => /remain (safely )?retryable/.test(message)));
		});
	}

	for (const changedAccount of [false, true]) {
		it(`parked single save ${changedAccount ? 'refuses a different account' : 'allows same-account profile updates'}`, async () => {
			const {cards} = await seed(2);
			let started, release;
			const firstStarted = new Promise(resolve => { started = resolve; });
			const held = new Promise(resolve => { release = resolve; });
			let count = 0;
			MultiBatch.prototype.commit = async function(...args) {
				await originalCommit.apply(this, args);
				if (++count === 1) { started(); await held; }
			};
			const first = store.dispatch(modifyCardsWithDurableMultiEdit([cards[0]], {notes: 'first saved'}, false, 'single'));
			await firstStarted;
			const parked = store.dispatch(modifyCardsWithDurableMultiEdit([cards[1]], {notes: 'private parked draft'}, false, 'single'));
			store.dispatch({type: 'SIGNIN_SUCCESS', user: {...originalUser, uid: changedAccount ? 'another-account' : uid, displayName: 'Updated profile'}});
			store.dispatch({type: 'UPDATE_USER_PERMISSIONS', permissions: {admin: true}});
			release();
			await Promise.all([first, parked]);
			assert.equal((await getDoc(doc(db, 'cards', cards[1].id))).data().notes, changedAccount ? cards[1].notes : 'private parked draft');
		});
	}

	it('does not overwrite content changed between authoritative planning and commit', async () => {
		const {cards: [card]} = await seed();
		MultiBatch.prototype.commit = async function(...args) {
			await updateDoc(doc(db, 'cards', card.id), {notes: 'newer content to preserve'});
			return originalCommit.apply(this, args);
		};
		await store.dispatch(modifyCardsWithDurableMultiEdit([card], {notes: 'older draft'}));
		assert.equal((await getDoc(doc(db, 'cards', card.id))).data().notes, 'newer content to preserve');
		assert.equal((await getDocs(collection(db, 'cards', card.id, 'updates'))).size, 0, 'rejected save must not write audit history');
		assert.match(read('multi').lastError, /Changed elsewhere after you saved/);
		assert.equal(read('multi').nextIndex, 0, 'no completion marker or cursor may acknowledge the rejected save');
	});

	it('preserves unrelated content changed between planning and commit', async () => {
		const {cards: [card]} = await seed();
		MultiBatch.prototype.commit = async function(...args) {
			await updateDoc(doc(db, 'cards', card.id), {body: '<p>newer unrelated body</p>'});
			return originalCommit.apply(this, args);
		};
		await store.dispatch(modifyCardsWithDurableMultiEdit([card], {notes: 'new notes'}));
		const saved = (await getDoc(doc(db, 'cards', card.id))).data();
		assert.equal(saved.body, '<p>newer unrelated body</p>');
		assert.equal(saved.notes, 'new notes');
		assert.equal(read('multi'), null);
	});

	it('rechecks fixed content expectations when Firestore retries a transaction', async () => {
		const {cards: [card]} = await seed();
		const originalGet = Transaction.prototype.get;
		let reads = 0;
		Transaction.prototype.get = async function(ref) {
			const snapshot = await originalGet.call(this, ref);
			if (ref.path === `cards/${card.id}` && ++reads === 1) {
				//The first attempt read the original value. Alter the real server
				//before its commit, forcing the SDK's optimistic retry mechanism.
				await updateDoc(doc(db, 'cards', card.id), {notes: 'changed during transaction'});
			}
			return snapshot;
		};
		try {
			await store.dispatch(modifyCardsWithDurableMultiEdit([card], {notes: 'older queued notes'}));
		} finally { Transaction.prototype.get = originalGet; }
		assert.ok(reads >= 2, 'must exercise a real SDK transaction retry');
		assert.equal((await getDoc(doc(db, 'cards', card.id))).data().notes, 'changed during transaction');
		assert.match(read('multi').lastError, /Changed elsewhere after you saved/);
	});

	it('replays an oversized guarded fanout after its own prefix committed', async () => {
		const {cards: [card]} = await seed();
		const build = () => {
			const batch = new MultiBatch(db);
			batch.beginAtomicGroup(card.id);
			batch.protectCardContent(doc(db, 'cards', card.id), card);
			batch.update(doc(db, 'cards', card.id), {notes: 'our desired content', updated: serverTimestamp()});
			for (let index = 0; index < 500; index++) batch.set(doc(db, 'cards', card.id, 'updates', `fanout-${index}`), {note: 'fanout'});
			batch.endAtomicGroup();
			return batch;
		};
		const first = build();
		assert.equal(first.pendingUnderlyingBatchCount, 2);
		const commitBatch = first._config.commitBatch;
		first._config.commitConcurrency = 1;
		let commits = 0;
		first._config.commitBatch = async (batch, groupIDs) => {
			if (++commits === 2) throw new Error('Lost second fanout batch');
			return commitBatch(batch, groupIDs);
		};
		await assert.rejects(first.commit(), /Lost second fanout batch/);
		assert.equal((await getDoc(doc(db, 'cards', card.id))).data().notes, 'our desired content');
		await build().commit();
		assert.equal((await getDocs(collection(db, 'cards', card.id, 'updates'))).size, 500);
	});

	it('guards do not introduce transactions for additive-only writes', async () => {
		const {cards: [card], tag} = await seed();
		const originalGet = Transaction.prototype.get;
		let reads = 0;
		Transaction.prototype.get = function(...args) { reads++; return originalGet.apply(this, args); };
		try {
			await store.dispatch(modifyCardsWithDurableMultiEdit([card], {add_tags: [tag]}));
		} finally { Transaction.prototype.get = originalGet; }
		assert.equal(reads, 0, 'additive metadata must keep the ordinary batch fast path');
		assert.deepEqual((await getDoc(doc(db, 'cards', card.id))).data().tags, [tag]);
	});

	it('reads each independent protected card only in its own underlying batch', async () => {
		const {cards} = await seed(260);
		const batch = new MultiBatch(db);
		for (const card of cards) {
			batch.beginAtomicGroup(card.id);
			batch.protectCardContent(doc(db, 'cards', card.id), card);
			batch.update(doc(db, 'cards', card.id), {notes: 'bounded guard reads', updated: serverTimestamp()});
			batch.endAtomicGroup();
		}
		assert.equal(batch.pendingUnderlyingBatchCount, 2);
		const originalGet = Transaction.prototype.get;
		let reads = 0;
		Transaction.prototype.get = function(...args) { reads++; return originalGet.apply(this, args); };
		try { await batch.commit(); } finally { Transaction.prototype.get = originalGet; }
		assert.equal(reads, cards.length, 'independent batches must not re-read and contend on every other card');
	});
});

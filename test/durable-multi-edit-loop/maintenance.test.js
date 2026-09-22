/*eslint-env node, es2022*/

import assert from 'assert';
import {bootstrapApp, wireCard} from '../harness-support/app-harness.js';
const {store, db, uid, firestore} = await bootstrapApp();
const {doc, setDoc, getDoc, getDocs, collection, Transaction} = firestore;
const {MAINTENANCE_TASKS} = await import('../../lib/src/actions/maintenance.js');
const {MultiBatch} = await import('../../lib/src/multi_batch.js');
let sequence = 0;

const seed = async count => {
	const prefix = `maintenance-guard-${Date.now()}-${sequence++}`;
	const cards = Array.from({length: count}, (_, index) => ({
		...wireCard(`${prefix}-${index}`, uid), id: `${prefix}-${index}`, card_type: 'working-notes',
		title: 'Outdated derived title', body: `<p>Distinct maintenance content ${index}</p>`,
	}));
	await Promise.all(cards.map(card => setDoc(doc(db, 'cards', card.id), card)));
	//The real task processes selectCards(getState()). Isolate this fixture
	//corpus from cards seeded by other suites in the shared app harness.
	const current = store.getState();
	const state = {...current, data: {...current.data, cards: Object.fromEntries(cards.map(card => [card.id, card]))}};
	return {cards, state};
};

const run = async state => {
	const originalLog = console.log;
	console.log = () => {};
	try { await MAINTENANCE_TASKS['rerun-card-finishers'].fn(store.dispatch, () => state); }
	finally { console.log = originalLog; }
};

describe('maintenance finisher writes retain bounded atomic groups', function() {
	this.timeout(120000);
	beforeEach(() => {
		store.dispatch({type: 'UPDATE_USER_PERMISSIONS', permissions: {admin: true}});
		store.dispatch({type: 'UPDATE_CORPUS_STATUS', status: 'live', message: ''});
	});

	it('reads each changed card once across the real multi-batch maintenance task', async () => {
		const {cards, state} = await seed(180);
		const originalGet = Transaction.prototype.get;
		let reads = 0;
		Transaction.prototype.get = function(...args) { reads++; return originalGet.apply(this, args); };
		try { await run(state); } finally { Transaction.prototype.get = originalGet; }
		assert.equal(reads, cards.length, 'maintenance must not read all source cards in every batch and create artificial transaction conflicts');
		for (const card of [cards[0], cards.at(-1)]) {
			assert.notEqual((await getDoc(doc(db, 'cards', card.id))).data().title, card.title, 'the actual finisher output must be persisted');
		}
	});

	it('aborts all staged writes for a card when planning fails and continues with the next card', async () => {
		const {cards, state} = await seed(2);
		const originalUpdate = MultiBatch.prototype.update;
		MultiBatch.prototype.update = function(ref, data) {
			const result = originalUpdate.call(this, ref, data);
			if (ref.path === `cards/${cards[0].id}`) throw new Error('Planning failed after staging the card update');
			return result;
		};
		try { await run(state); } finally { MultiBatch.prototype.update = originalUpdate; }
		assert.equal((await getDoc(doc(db, 'cards', cards[0].id))).data().title, cards[0].title, 'failed card must not leak a prefix into the final commit');
		assert.equal((await getDocs(collection(db, 'cards', cards[0].id, 'updates'))).size, 0);
		assert.notEqual((await getDoc(doc(db, 'cards', cards[1].id))).data().title, cards[1].title, 'the next independent card must still save');
	});
});

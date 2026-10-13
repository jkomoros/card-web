/*eslint-env node, es2022*/

//The warm-boot prime reaches the main thread in two batches: published
//cards without a projection, then unpublished cards carrying the whole
//projection with the whole-corpus domain. Real thunks and reducers: the
//bitset projection must install on that path, must NOT install when a
//pending edit holds some of the cards back (the store's domain would not
//match), and the filters must agree with the held cards either way.

import assert from 'assert';
import {bootstrapApp, wireCard} from '../harness-support/app-harness.js';

const {store, uid} = await bootstrapApp();
const {receiveCards} = await import('../../lib/src/actions/data.js');
const {MODIFY_CARD, MODIFY_CARD_SUCCESS, CLEAR_ENQUEUED_CARD_UPDATES} = await import('../../lib/src/actions.js');
const {selectRawCards} = await import('../../lib/src/selectors.js');
const {CARD_FILTER_FUNCS, INITIAL_STATE} = await import('../../lib/src/filters.js');
const {UPDATE_CARDS} = await import('../../lib/src/actions.js');
const collectionReducer = (await import('../../lib/src/reducers/collection.js')).default;
const {primeBitsFor, membershipHas} = await import('../../lib/shared/filter_membership.js');
const {cardFilterBitsForWire} = await import('../../lib/src/card-filter-projection.js');
store.addReducers({collection: collectionReducer});

const names = Object.keys(CARD_FILTER_FUNCS);
let sequence = 0;
const batch = (count, published, tag) => Object.fromEntries(Array.from({length: count}, () => {
	const id = `handoff-${tag}-${Date.now()}-${sequence++}`;
	//wireCard's id is a placeholder (the Firestore doc id is the key there).
	return [id, {...wireCard(id, uid), id, title: id, body: `<p>${id}</p>`, published, revision: 1}];
}));
const disagreements = () => {
	const held = selectRawCards(store.getState());
	const filters = store.getState().collection.filters;
	const out = [];
	for (const card of Object.values(held)) for (const name of names) {
		if (Boolean(CARD_FILTER_FUNCS[name].func(card)) !== membershipHas(filters[name] || {}, card.id)) out.push(`${card.id}:${name}`);
	}
	return out;
};
const installedFromBits = bits => names.filter(name => primeBitsFor(store.getState().collection.filters[name])?.ids === bits.ids).length;
//The worker's prime over the whole corpus — what the store already holds
//(earlier tests' cards stay in it) plus both batches — as bits. A domain
//that omitted the held cards would be dropped before any of the checks
//under test ran, and the tests would pass for the wrong reason.
const workerProjection = batches => {
	const cards = {...selectRawCards(store.getState()), ...batches};
	const primed = collectionReducer(INITIAL_STATE, {type: UPDATE_CARDS, cards, fetchType: 'published'});
	return cardFilterBitsForWire(Object.fromEntries(names.map(name => [name, primed.filters[name]])));
};

describe('prime projection handoff in two batches (real thunks)', function() {
	this.timeout(60000);

	beforeEach(() => {
		store.dispatch({type: CLEAR_ENQUEUED_CARD_UPDATES});
		store.dispatch({type: 'UPDATE_USER_PERMISSIONS', permissions: {admin: true}});
	});

	it('installs the bits on the unpublished batch once the published batch is held', () => {
		const published = batch(700, true, 'pub');
		const unpublished = batch(500, false, 'unpub');
		const bits = workerProjection({...published, ...unpublished});
		assert.ok(bits, 'a fresh 1,200-card prime goes as bits');
		store.dispatch(receiveCards(published, 'published', true, false));
		store.dispatch(receiveCards(unpublished, 'unpublished', false, false, undefined, bits.ids, bits));
		assert.strictEqual(installedFromBits(bits), names.length, 'every filter was installed from the received bits');
		assert.deepStrictEqual(disagreements(), []);
	});

	it('bits whose ids are not the stated domain array are not installed, even when the domain matches the store', () => {
		const published = batch(600, true, 'pub2');
		const unpublished = batch(500, false, 'unpub2');
		const bits = workerProjection({...published, ...unpublished});
		store.dispatch(receiveCards(published, 'published', true, false));
		//A forged projection: one extra id in the bits, set in every filter,
		//while the stated domain is exactly the store's.
		const forged = {ids: [...bits.ids, 'ghost'], names: bits.names, words: bits.words.map(flat => {
			const grown = new Uint32Array(Math.ceil((bits.ids.length + 1) / 32));
			grown.set(flat);
			grown[bits.ids.length >>> 5] |= 1 << (bits.ids.length & 31);
			return grown;
		})};
		store.dispatch(receiveCards(unpublished, 'unpublished', false, false, undefined, bits.ids, forged));
		assert.strictEqual(installedFromBits(forged), 0, 'the forged projection was not installed');
		assert.strictEqual(membershipHas(store.getState().collection.filters['has-content'], 'ghost'), false);
		assert.deepStrictEqual(disagreements(), []);
	});

	it('does not install the bits while a pending edit holds back one of the batch\'s cards, and the filters still agree after the flush', () => {
		const published = batch(600, true, 'pub3');
		const unpublished = batch(500, false, 'unpub3');
		const bits = workerProjection({...published, ...unpublished});
		store.dispatch(receiveCards(published, 'published', true, false));
		const heldBack = Object.keys(unpublished)[3];
		//A large modificationCount: a count of 1 flushes the queue at once and
		//hides the held-back state.
		store.dispatch({type: MODIFY_CARD, modificationCount: 1000, cardIDs: [heldBack]});
		store.dispatch(receiveCards(unpublished, 'unpublished', false, false, undefined, bits.ids, bits));
		assert.strictEqual(installedFromBits(bits), 0, 'the projection was not installed over a partial store');
		assert.deepStrictEqual(disagreements(), [], 'the derived filters agree with the held cards');
		store.dispatch({type: MODIFY_CARD_SUCCESS, modificationCount: 1000});
		store.dispatch(receiveCards({}, 'unpublished'));
		assert.ok(selectRawCards(store.getState())[heldBack], 'the held-back card arrived on the flush');
		assert.deepStrictEqual(disagreements(), [], 'the filters agree after the flush');
	});
});

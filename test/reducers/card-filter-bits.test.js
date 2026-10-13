/* eslint-env node, mocha, es2022 */

//The prime's bitsets, sent in place of ~78 plain maps, must install the
//same memberships a plain-map projection would, and a malformed one must
//be ignored (the reducer then derives the filters from the cards).

import assert from 'node:assert/strict';

const collectionReducer = (await import('../../lib/src/reducers/collection.js')).default;
const {INITIAL_STATE, CARD_FILTER_FUNCS} = await import('../../lib/src/filters.js');
const {UPDATE_CARDS} = await import('../../lib/src/actions.js');
const {membershipKeys, membershipToFilterMap, primeBitsFor} = await import('../../lib/shared/filter_membership.js');
const {cardFilterBitsForWire} = await import('../../lib/src/card-filter-projection.js');

const makeCard = (id, extras = {}) => ({
	id, card_type: 'content', title: 'Title of ' + id, body: '<p>Body of ' + id + '</p>', section: 'main', tags: [],
	references: {}, references_info: {}, references_inbound: {}, references_info_inbound: {},
	star_count: 0, star_count_manual: 0, tweet_favorite_count: 0, tweet_retweet_count: 0, thread_count: 0, thread_resolved_count: 0,
	notes: '', todo: '', auto_todo_overrides: {}, published: true, full_bleed: false, images: [], slugs: [], ...extras,
});
const names = Object.keys(CARD_FILTER_FUNCS);
const keysOf = state => Object.fromEntries(names.map(name => [name, membershipKeys(state.filters[name])]));

describe('card filter bits on UPDATE_CARDS', () => {
	//A worker-shaped prime: 1,100 cards with ids a plain object reorders and
	//ids that collide with Object.prototype, mixed published/unpublished.
	const ids = Array.from({length: 1100}, (_, i) => i % 9 === 0 ? String(i * 7) : `card-${i}`);
	ids[3] = 'constructor'; ids[4] = 'toString'; ids[5] = '__proto__';
	const cards = Object.fromEntries(ids.map((id, i) => [id, makeCard(id, {published: i % 3 !== 0, notes: i % 5 === 0 ? 'note' : ''})]));
	const worker = collectionReducer(INITIAL_STATE, {type: UPDATE_CARDS, cards, fetchType: 'published'});
	const bits = cardFilterBitsForWire(Object.fromEntries(names.map(name => [name, worker.filters[name]])));
	const maps = Object.fromEntries(names.map(name => [name, membershipToFilterMap(worker.filters[name])]));

	it('installs the same memberships, in the same order, as the plain-map projection', () => {
		assert.ok(bits, 'a fresh prime sends bits');
		//Round-trip through structured clone, as the worker boundary does.
		const received = structuredClone(bits);
		const fromBits = collectionReducer(INITIAL_STATE, {type: UPDATE_CARDS, cards, fetchType: 'published', cardFilterBits: received});
		const fromMaps = collectionReducer(INITIAL_STATE, {type: UPDATE_CARDS, cards, fetchType: 'published', cardFilters: structuredClone(maps)});
		assert.deepEqual(keysOf(fromBits), keysOf(fromMaps));
		assert.deepEqual(keysOf(fromBits), keysOf(worker));
		//Installed from the bits, not re-derived from the cards (which would
		//give the same keys): the memberships carry the RECEIVED ids array.
		for (const name of names) assert.strictEqual(primeBitsFor(fromBits.filters[name])?.ids, received.ids, `${name} installed from the received bits`);
		for (const name of names) assert.equal(primeBitsFor(fromMaps.filters[name]), undefined, `${name} imported from maps is not a prime`);
		for (const name of names) assert.equal(membershipKeys(fromBits.filters[name]).includes('constructor'), Boolean(CARD_FILTER_FUNCS[name].func(cards.constructor)), name);
	});

	it('ignores a malformed projection and derives the filters itself', () => {
		for (const malformed of [
			{...bits, names: bits.names.slice(1)},
			{...bits, words: [...bits.words.slice(1), new Uint32Array(2)]},
			{...bits, ids: [...bits.ids.slice(0, -1), bits.ids[0]]},
		]) {
			const state = collectionReducer(INITIAL_STATE, {type: UPDATE_CARDS, cards, fetchType: 'published', cardFilterBits: malformed});
			assert.deepEqual(keysOf(state), keysOf(worker));
		}
	});
});

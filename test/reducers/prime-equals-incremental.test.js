/* eslint-env node, mocha, es2022 */

//The collection reducer has two ways to build card-derived filters: the
//≥1000-card prime from empty filters (card-major, straight into bitsets)
//and the incremental group update. They must agree exactly — keys and
//order — or the worker's warm-boot prime and a listener-fed main thread
//would disagree about collections. Nothing else asserts this.

import assert from 'node:assert/strict';

const collectionReducer = (await import('../../lib/src/reducers/collection.js')).default;
const {INITIAL_STATE, CARD_FILTER_FUNCS} = await import('../../lib/src/filters.js');
const {UPDATE_CARDS, REMOVE_CARDS} = await import('../../lib/src/actions.js');
const {membershipKeys} = await import('../../lib/shared/filter_membership.js');

const makeCard = (id, extras = {}) => ({
	id, card_type: 'content', title: 'Title of ' + id, body: '<p>Body of ' + id + '</p>', section: 'main', tags: [],
	references: {}, references_info: {}, references_inbound: {}, references_info_inbound: {},
	star_count: 0, star_count_manual: 0, tweet_favorite_count: 0, tweet_retweet_count: 0, thread_count: 0, thread_resolved_count: 0,
	notes: '', todo: '', auto_todo_overrides: {}, published: true, full_bleed: false, images: [], slugs: [], ...extras,
});
const names = Object.keys(CARD_FILTER_FUNCS);
const keysOf = state => Object.fromEntries(names.map(name => [name, membershipKeys(state.filters[name])]));

describe('prime and incremental filter builds agree', () => {
	it('a 2,400-card prime equals the same cards delivered in 100-card chunks, keys and order, before and after churn', () => {
		const ids = Array.from({length: 2400}, (_, i) => i % 13 === 0 ? String(i * 7) : `card-${i}`);
		ids[3] = 'constructor'; ids[4] = 'toString'; ids[5] = '__proto__';
		const cards = Object.fromEntries(ids.map((id, i) => [id, makeCard(id, {
			published: i % 3 !== 0, notes: i % 5 === 0 ? 'note' : '', card_type: i % 17 === 0 ? 'working-notes' : i % 23 === 0 ? 'concept' : 'content',
			todo: i % 7 === 0 ? 'do it' : '', tags: i % 4 === 0 ? ['t'] : [],
		})]));
		const prime = collectionReducer(INITIAL_STATE, {type: UPDATE_CARDS, cards, fetchType: 'published'});
		let incremental = INITIAL_STATE;
		for (let start = 0; start < ids.length; start += 100) {
			const chunk = Object.fromEntries(ids.slice(start, start + 100).map(id => [id, cards[id]]));
			incremental = collectionReducer(incremental, {type: UPDATE_CARDS, cards: chunk, fetchType: 'published'});
		}
		assert.deepEqual(keysOf(incremental), keysOf(prime));
		//Both paths then take the same churn and still agree.
		const churn = state => {
			let next = collectionReducer(state, {type: UPDATE_CARDS, cards: {[ids[10]]: {...cards[ids[10]], published: !cards[ids[10]].published}, later: makeCard('later')}, fetchType: 'published'});
			next = collectionReducer(next, {type: REMOVE_CARDS, cardIDs: [ids[0], ids[1]]});
			return next;
		};
		assert.deepEqual(keysOf(churn(incremental)), keysOf(churn(prime)));
	});
});

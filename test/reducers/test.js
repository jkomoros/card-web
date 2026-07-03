/*eslint-env node*/

//Tests for identity-preservation behavior in the collection and data
//reducers: single-card updates must only change the identity of filter maps
//whose membership actually changed, and no-op star/read updates must return
//the same state object, so downstream selectors don't reevaluate.

import {
	JSDOM
} from 'jsdom';

import assert from 'assert';

const dom = new JSDOM('');
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.Document = dom.window.Document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.customElements = dom.window.customElements;
globalThis.CSSStyleSheet = dom.window.CSSStyleSheet;

let collectionReducer;
let dataReducer;
let UPDATE_CARDS;
let UPDATE_READS;
let UPDATE_STARS;
let INITIAL_COLLECTION_STATE;

const makeCard = (id, extras) => ({
	id,
	card_type: 'content',
	title: 'Title of ' + id,
	body: '<p>Body of ' + id + '</p>',
	section: 'main',
	tags: [],
	references: {},
	references_info: {},
	references_inbound: {},
	references_info_inbound: {},
	star_count: 0,
	star_count_manual: 0,
	tweet_favorite_count: 0,
	tweet_retweet_count: 0,
	thread_count: 0,
	thread_resolved_count: 0,
	notes: '',
	todo: '',
	auto_todo_overrides: {},
	published: true,
	full_bleed: false,
	images: [],
	...extras,
});

describe('reducer identity preservation', () => {
	before(async () => {
		collectionReducer = (await import('../../lib/src/reducers/collection.js')).default;
		dataReducer = (await import('../../lib/src/reducers/data.js')).default;
		({
			UPDATE_CARDS,
			UPDATE_READS,
			UPDATE_STARS,
		} = await import('../../lib/src/actions.js'));
		({
			INITIAL_STATE: INITIAL_COLLECTION_STATE
		} = await import('../../lib/src/filters.js'));
	});

	const primedCollectionState = (cards) => {
		return collectionReducer(INITIAL_COLLECTION_STATE, {type: UPDATE_CARDS, cards, fetchType: 'published'});
	};

	it('UPDATE_CARDS with an unchanged card preserves state identity', async () => {
		const card = makeCard('card-one');
		const state = primedCollectionState({'card-one': card});
		//Redelivering the same card (e.g. a snapshot echo) changes no
		//membership, so the whole state object should be identical.
		const nextState = collectionReducer(state, {type: UPDATE_CARDS, cards: {'card-one': makeCard('card-one')}, fetchType: 'published'});
		assert.strictEqual(nextState, state);
	});

	it('UPDATE_CARDS changing one membership only changes affected filter maps', async () => {
		const card = makeCard('card-one');
		const state = primedCollectionState({'card-one': card});
		//Adding a note flips membership in the has-notes/no-notes filters but
		//nothing else.
		const changed = makeCard('card-one', {notes: 'some notes'});
		const nextState = collectionReducer(state, {type: UPDATE_CARDS, cards: {'card-one': changed}, fetchType: 'published'});
		assert.notStrictEqual(nextState, state);
		assert.notStrictEqual(nextState.filters, state.filters);
		let changedMaps = 0;
		let sharedMaps = 0;
		for (const name of Object.keys(state.filters)) {
			if (nextState.filters[name] === state.filters[name]) {
				sharedMaps++;
			} else {
				changedMaps++;
			}
		}
		//Only a small number of note-related filter maps should have changed;
		//every untouched filter map must keep its identity.
		assert.ok(changedMaps > 0, 'expected at least one filter map to change');
		assert.ok(changedMaps <= 6, 'expected few filter maps to change, got ' + changedMaps);
		assert.ok(sharedMaps > 50, 'expected most filter maps to keep identity, got ' + sharedMaps);
	});

	it('no-op UPDATE_READS preserves state identity', async () => {
		const card = makeCard('card-one');
		let state = primedCollectionState({'card-one': card});
		state = collectionReducer(state, {type: UPDATE_READS, readsToAdd: ['card-one'], readsToRemove: []});
		const readState = state;
		//Marking an already-read card read again (echo redelivery) is a no-op.
		state = collectionReducer(state, {type: UPDATE_READS, readsToAdd: ['card-one'], readsToRemove: []});
		assert.strictEqual(state, readState);
		//Removing a read that isn't set is also a no-op.
		state = collectionReducer(state, {type: UPDATE_READS, readsToAdd: [], readsToRemove: ['card-two']});
		assert.strictEqual(state, readState);
	});

	it('genuine UPDATE_READS changes only the read filter', async () => {
		const card = makeCard('card-one');
		const state = primedCollectionState({'card-one': card});
		const nextState = collectionReducer(state, {type: UPDATE_READS, readsToAdd: ['card-one'], readsToRemove: []});
		assert.notStrictEqual(nextState, state);
		assert.strictEqual(nextState.filters.read['card-one'], true);
		for (const name of Object.keys(state.filters)) {
			if (name === 'read') continue;
			assert.strictEqual(nextState.filters[name], state.filters[name], 'filter ' + name + ' should keep identity');
		}
	});

	it('no-op UPDATE_STARS preserves state identity', async () => {
		const card = makeCard('card-one');
		const state = primedCollectionState({'card-one': card});
		const nextState = collectionReducer(state, {type: UPDATE_STARS, starsToAdd: [], starsToRemove: ['card-one']});
		assert.strictEqual(nextState, state);
	});

	it('UPDATE_CARDS prunes only similarity entries mentioning changed cards', async () => {
		const dataState = dataReducer(undefined, {type: '@@INIT'});
		const primed = {
			...dataState,
			cards: {},
			cardSimilarity: {
				'card-one': {'card-two': 0.9, 'card-three': 0.5},
				'card-four': {'card-five': 0.8},
			}
		};
		//Updating a card that appears in one entry's results prunes only that
		//entry.
		const nextState = dataReducer(primed, {type: UPDATE_CARDS, cards: {'card-two': makeCard('card-two')}, fetchType: 'published'});
		assert.strictEqual(nextState.cardSimilarity['card-one'], undefined);
		assert.strictEqual(nextState.cardSimilarity['card-four'], primed.cardSimilarity['card-four']);
		//Updating a card mentioned nowhere keeps the whole map's identity.
		const unrelated = dataReducer(primed, {type: UPDATE_CARDS, cards: {'card-nine': makeCard('card-nine')}, fetchType: 'published'});
		assert.strictEqual(unrelated.cardSimilarity, primed.cardSimilarity);
	});
});

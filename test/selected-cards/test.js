/*eslint-env node, es2020*/

//WHAT A SELECTION MEANS WHEN THE CORPUS HAS NOT CAUGHT UP.
//
//A selection is a set of card IDs, and an ID is allowed to name a card this tab
//does not hold. That is not an edge case: bulk import selects its cards the
//instant they are written, and they arrive later through the worker, so the gap
//is on the main path of a daily workflow.
//
//selectSelectedCards used to map the IDs straight through the corpus, producing
//an array with `undefined` holes, and every consumer dereferences its elements.
//A single missing card therefore threw inside whatever dispatch triggered the
//recompute — which, with the multi-edit dialog open, meant the dialog broke on
//open, every later dispatch threw the same way, and Save reported
//"0 of 0 cards were processed safely" having written nothing.
//
//These tests pin the two halves of the contract: the array never has holes, and
//the number of dropped cards is reported so the UI can refuse to save a
//silently-narrowed edit.

import {JSDOM} from 'jsdom';
import assert from 'assert';

const dom = new JSDOM('');
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.Document = dom.window.Document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.customElements = dom.window.customElements;
globalThis.CSSStyleSheet = dom.window.CSSStyleSheet;

let selectSelectedCards;
let selectSelectedCardsMissingCount;
let selectSelectedCardsTagsUnion;
let selectSelectedCardsTagsIntersection;
let selectSelectedCardsReferencesUnion;
let COLLECTION_INITIAL_STATE;

const card = (id) => ({
	id,
	card_type: 'working-notes',
	title: 'Title of ' + id,
	body: '<p>Body</p>',
	tags: ['tag-' + id],
	references: {},
	references_info: {},
	references_inbound: {},
	references_info_inbound: {},
	auto_todo_overrides: {},
	published: false,
	sort_order: 1.0,
	section: '',
	slugs: [],
	name: id,
	author: 'uid',
	permissions: {},
	collaborators: [],
	star_count: 0,
	star_count_manual: 0,
	thread_count: 0,
	thread_resolved_count: 0,
	tweet_favorite_count: 0,
	tweet_retweet_count: 0,
	tweet_count: 0,
	font_size_boost: {},
	flags: {},
	images: [],
	notes: '',
	todo: '',
	created: {seconds: 1, nanoseconds: 0},
	updated: {seconds: 1, nanoseconds: 0},
	updated_substantive: {seconds: 1, nanoseconds: 0},
	updated_message: {seconds: 1, nanoseconds: 0},
});

//`loaded` cards are in the corpus; `selected` names what the user selected,
//which may include IDs the corpus does not have yet.
const stateWith = (loaded, selected) => ({
	data: {
		cards: Object.fromEntries(loaded.map(id => [id, card(id)])),
		tags: {}, sections: {}, authors: {}, cardMeta: {}, cardsSnapshot: {}, slugIndex: {},
	},
	collection: {
		...COLLECTION_INITIAL_STATE,
		selectedCards: Object.fromEntries(selected.map(id => [id, true])),
	},
	user: {user: null},
});

describe('selected cards with an incomplete corpus', () => {

	before(async () => {
		const selectors = await import('../../lib/src/selectors.js');
		selectSelectedCards = selectors.selectSelectedCards;
		selectSelectedCardsMissingCount = selectors.selectSelectedCardsMissingCount;
		selectSelectedCardsTagsUnion = selectors.selectSelectedCardsTagsUnion;
		selectSelectedCardsTagsIntersection = selectors.selectSelectedCardsTagsIntersection;
		selectSelectedCardsReferencesUnion = selectors.selectSelectedCardsReferencesUnion;
		COLLECTION_INITIAL_STATE = (await import('../../lib/src/filters.js')).INITIAL_STATE;
	});

	it('returns every selected card when the corpus has them all', () => {
		const state = stateWith(['a', 'b', 'c'], ['a', 'b', 'c']);
		assert.deepStrictEqual(selectSelectedCards(state).map(c => c.id), ['a', 'b', 'c']);
		assert.strictEqual(selectSelectedCardsMissingCount(state), 0);
	});

	it('never returns a hole for a card the corpus does not have', () => {
		const state = stateWith(['a'], ['a', 'b', 'c']);
		const selected = selectSelectedCards(state);
		assert.deepStrictEqual(selected.map(c => c.id), ['a']);
		assert.ok(selected.every(Boolean), 'the array must not contain undefined entries');
	});

	it('reports how many selected cards are missing', () => {
		assert.strictEqual(selectSelectedCardsMissingCount(stateWith(['a'], ['a', 'b', 'c'])), 2);
		assert.strictEqual(selectSelectedCardsMissingCount(stateWith([], ['a', 'b'])), 2);
	});

	it('does not report missing cards when nothing is explicitly selected', () => {
		//With no explicit selection the active collection stands in, and its
		//cards come from the corpus by construction.
		const state = stateWith(['a', 'b'], []);
		assert.strictEqual(selectSelectedCardsMissingCount(state), 0);
	});

	//The consumers below are exactly the ones the multi-edit dialog evaluates in
	//stateChanged. Each threw on a hole, and because stateChanged runs inside
	//store.dispatch, that exception came out of the dispatch — which is how a
	//partially-loaded selection took down card ingestion as well as the dialog.
	it('lets the dialog\'s own selectors run over a partially-loaded selection', () => {
		const state = stateWith(['a'], ['a', 'b', 'c']);
		assert.doesNotThrow(() => selectSelectedCardsTagsUnion(state));
		assert.doesNotThrow(() => selectSelectedCardsTagsIntersection(state));
		assert.doesNotThrow(() => selectSelectedCardsReferencesUnion(state));
		assert.deepStrictEqual(selectSelectedCardsTagsUnion(state), ['tag-a']);
	});

	it('lets them run when NONE of the selection has loaded', () => {
		const state = stateWith([], ['a', 'b']);
		assert.deepStrictEqual(selectSelectedCards(state), []);
		assert.doesNotThrow(() => selectSelectedCardsTagsUnion(state));
		assert.deepStrictEqual(selectSelectedCardsTagsUnion(state), []);
	});
});

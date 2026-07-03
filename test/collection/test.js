/*eslint-env node*/

//Tests for Collection work handoff (reusing filter/sort work when only the
//live cards map changed) and countForDescription (cheap tab counts).

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

let CollectionDescription;
let countForDescription;
let descriptionRequiresFullCollectionCount;

const card = (id, extras) => ({
	id,
	card_type: 'content',
	title: 'Title of ' + id,
	body: '<p>Body</p>',
	section: 'main',
	tags: [],
	sort_order: 1.0,
	references: {},
	references_info: {},
	references_inbound: {},
	references_info_inbound: {},
	auto_todo_overrides: {},
	published: true,
	...extras,
});

const makeBaseState = () => {
	const cards = {
		a: card('a', {sort_order: 3.0}),
		b: card('b', {sort_order: 2.0}),
		c: card('c', {sort_order: 1.0}),
	};
	const sets = {
		main: ['a', 'b', 'c'],
		everything: ['a', 'b', 'c'],
		'reading-list': [],
	};
	const filters = {
		starred: {a: true, b: true},
		read: {c: true},
	};
	return {cards, sets, filters};
};

//Shared stable objects, mirroring how the real selectors keep these
//identity-stable across unrelated card updates.
const STABLE_SECTIONS = {};
const STABLE_FALLBACKS = {};
const STABLE_START_CARDS = {};
const STABLE_SIMILARITY = {};

const makeArgs = (state, extras) => ({
	cards: state.cards,
	sets: state.sets,
	filters: state.filters,
	sections: STABLE_SECTIONS,
	fallbacks: STABLE_FALLBACKS,
	startCards: STABLE_START_CARDS,
	userID: '',
	randomSalt: '',
	cardSimilarity: STABLE_SIMILARITY,
	editingCardSimilarity: undefined,
	keyCardID: '',
	editingCard: undefined,
	cardsSnapshot: state.cards,
	filtersSnapshot: state.filters,
	...extras,
});

describe('Collection handoff', () => {
	before(async () => {
		({
			CollectionDescription,
			countForDescription,
			descriptionRequiresFullCollectionCount,
		} = await import('../../lib/src/collection_description.js'));
	});

	it('hands off filter/sort work when only live cards changed', async () => {
		const state = makeBaseState();
		const description = new CollectionDescription('everything', ['starred']);
		const args = makeArgs(state);
		const previous = description.collection(args);
		//Force the previous collection to do its work.
		const previousCards = previous.finalSortedCards;
		const previousLabels = previous.finalLabels;
		assert.deepStrictEqual(previousCards.map(c => c.id), ['a', 'b']);

		//Simulate a card edit echo: new cards map identity, same snapshot.
		const newCards = {...state.cards, a: card('a', {sort_order: 3.0, title: 'Edited title'})};
		const newArgs = makeArgs(state, {cards: newCards});
		const handed = description.collection(newArgs, previous);
		//Sort info carried over by identity proves the handoff took place.
		assert.strictEqual(handed._sortInfo, previous._sortInfo);
		//Results are equivalent to a full rebuild.
		const rebuilt = description.collection(newArgs);
		assert.deepStrictEqual(handed.finalSortedCards.map(c => c.id), rebuilt.finalSortedCards.map(c => c.id));
		assert.deepStrictEqual(handed.finalLabels, rebuilt.finalLabels);
		assert.strictEqual(handed.numCards, rebuilt.numCards);
		assert.strictEqual(handed.isFallback, rebuilt.isFallback);
		//The expanded cards use the NEW card objects.
		assert.strictEqual(handed.finalSortedCards[0].title, 'Edited title');
		assert.deepStrictEqual(previousLabels, handed.finalLabels);
	});

	it('does not hand off when the snapshot changed', async () => {
		const state = makeBaseState();
		const description = new CollectionDescription('everything', ['starred']);
		const previous = description.collection(makeArgs(state));
		previous.finalSortedCards;
		const newCards = {...state.cards};
		//Snapshot identity changes: full rebuild required.
		const newArgs = makeArgs(state, {cards: newCards, cardsSnapshot: {...state.cards}});
		const handed = description.collection(newArgs, previous);
		assert.notStrictEqual(handed._sortInfo, previous._sortInfo);
	});

	it('does not hand off when filters changed and there is no filters snapshot', async () => {
		const state = makeBaseState();
		const description = new CollectionDescription('everything', ['starred']);
		const baseArgs = makeArgs(state, {filtersSnapshot: undefined});
		const previous = description.collection(baseArgs);
		assert.deepStrictEqual(previous.finalSortedCards.map(c => c.id), ['a', 'b']);
		const newFilters = {...state.filters, starred: {a: true}};
		const newArgs = makeArgs(state, {filtersSnapshot: undefined, filters: newFilters, cards: {...state.cards}});
		const handed = description.collection(newArgs, previous);
		//Full rebuild picks up the new filter membership.
		assert.deepStrictEqual(handed.finalSortedCards.map(c => c.id), ['a']);
	});
});

describe('countForDescription', () => {
	before(async () => {
		({
			CollectionDescription,
			countForDescription,
			descriptionRequiresFullCollectionCount,
		} = await import('../../lib/src/collection_description.js'));
	});

	it('matches Collection.numCards for precomputed filters', async () => {
		const state = makeBaseState();
		const allCardIDs = Object.fromEntries(Object.keys(state.cards).map(id => [id, true]));
		for (const filters of [['starred'], ['read'], ['starred', 'read'], []]) {
			const description = new CollectionDescription('everything', filters);
			assert.strictEqual(descriptionRequiresFullCollectionCount(description), false);
			const expected = description.collection(makeArgs(state)).numCards;
			const actual = countForDescription(description, state.sets, state.filters, allCardIDs);
			assert.strictEqual(actual, expected, 'for filters ' + filters.join(','));
		}
	});

	it('detects configurable filters', async () => {
		const description = new CollectionDescription('everything', ['query/foo']);
		assert.strictEqual(descriptionRequiresFullCollectionCount(description), true);
	});
});

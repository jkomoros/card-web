/*eslint-env node, es2020*/

//Pins #777: a Collection built from a worker result holds the worker's ids
//and processes a card only when a consumer asks for that card. The main
//thread's cards map is the lazy processing Proxy, so every read of cards[id]
//is a card processed and pinned; expanding the whole result on construction
//processed the owner's entire working-notes collection on every delivery
//when the thumbnail list renders a window of it and everything else wants
//ids or counts.

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
let Collection;
let lazyProcessCards;

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

const rawCards = () => ({
	a: card('a', {sort_order: 3.0}),
	b: card('b', {sort_order: 2.0}),
	c: card('c', {sort_order: 1.0}),
});

//The real lazy Proxy, wrapped so the test can count which cards a consumer
//read through it. `in` is answered by the has trap without a read, as in
//the product.
const countingCards = () => {
	const inner = lazyProcessCards(rawCards());
	const reads = [];
	const cards = new Proxy({}, {
		get: (_target, property) => {
			if (typeof property === 'string' && property in inner) reads.push(property);
			return inner[property];
		},
		has: (_target, property) => property in inner,
		ownKeys: () => Reflect.ownKeys(inner),
		getOwnPropertyDescriptor: (_target, property) => Object.getOwnPropertyDescriptor(inner, property),
	});
	return {cards, reads};
};

const STABLE = {};

const makeArgs = (cards, extras) => ({
	cards,
	sets: {main: ['a', 'b', 'c'], everything: ['a', 'b', 'c'], 'reading-list': []},
	filters: {starred: {a: true, b: true}},
	sections: STABLE,
	fallbacks: STABLE,
	startCards: STABLE,
	userID: '',
	randomSalt: '',
	cardSimilarity: STABLE,
	editingCardSimilarity: undefined,
	keyCardID: '',
	editingCard: undefined,
	cardsSnapshot: cards,
	filtersSnapshot: undefined,
	...extras,
});

const workerResult = (description, extras) => ({
	description: description.serialize(),
	ids: [],
	labels: [],
	numCards: 0,
	numStartCards: 0,
	isFallback: false,
	preview: false,
	partialMatches: {},
	...extras,
});

describe('Collection.fromWorkerResult is lazy', () => {
	before(async () => {
		({CollectionDescription, Collection} = await import('../../lib/src/collection_description.js'));
		({lazyProcessCards} = await import('../../lib/src/card-processing.js'));
	});

	it('reads no card for ids, counts, membership or labels, and only the window for a slice', () => {
		const {cards, reads} = countingCards();
		const description = new CollectionDescription('everything', ['starred'], 'default');
		const result = workerResult(description, {ids: ['a', 'b'], labels: ['', ''], numCards: 2});
		const collection = Collection.fromWorkerResult(description, makeArgs(cards), result);
		assert.deepStrictEqual(reads, [], 'construction processed a card');

		assert.deepStrictEqual(collection.finalSortedCardIDs, ['a', 'b']);
		assert.strictEqual(collection.numFinalSortedCards, 2);
		assert.strictEqual(collection.numStartCards, 0);
		assert.strictEqual(collection.numCards, 2);
		assert.strictEqual(collection.isFallback, false);
		assert.deepStrictEqual(collection.sortedCardIDs, ['a', 'b']);
		assert.strictEqual(collection.matchedCard('a'), true);
		assert.strictEqual(collection.matchedCard('c'), false);
		assert.deepStrictEqual(collection.finalLabels, ['', '']);
		assert.deepStrictEqual(collection.partialMatches, {});
		assert.deepStrictEqual(reads, [], 'an id or count question processed a card');

		const window = collection.finalSortedCardsSlice(1, 2);
		assert.deepStrictEqual(window.map(c => c.id), ['b']);
		assert.deepStrictEqual(reads, ['b'], 'a slice processed cards outside its window');
		//(This comparison is itself a read through the counting map.)
		assert.strictEqual(window[0], cards.b);

		//The whole list is still there for the consumers that need it, and
		//is the same answer the eager expansion gave.
		const all = collection.finalSortedCards;
		assert.deepStrictEqual(all.map(c => c.id), ['a', 'b']);
		assert.strictEqual(all[0], cards.a);
		assert.ok(reads.includes('a'));
		//Once expanded, a slice comes from the expansion.
		assert.strictEqual(collection.finalSortedCardsSlice(0, 1)[0], all[0]);
	});

	it('narrows ids with no card on this thread, so counts, indexes, labels and the cards agree', () => {
		const {cards} = countingCards();
		const description = new CollectionDescription('everything', ['starred'], 'default');
		//The worker may name a card this thread has not received yet.
		const result = workerResult(description, {ids: ['a', 'missing', 'b'], labels: ['A', 'M', 'B'], numCards: 3});
		const collection = Collection.fromWorkerResult(description, makeArgs(cards), result);
		assert.deepStrictEqual(collection.finalSortedCardIDs, ['a', 'b']);
		assert.strictEqual(collection.numFinalSortedCards, 2);
		assert.deepStrictEqual(collection.finalSortedCardsSlice(1, 2).map(c => c.id), ['b']);
		assert.deepStrictEqual(collection.finalSortedCards.map(c => c.id), ['a', 'b']);
		assert.strictEqual(collection.matchedCard('missing'), false);
		//The dropped card's label goes with it; the eager code left every
		//later card under its predecessor's label.
		assert.deepStrictEqual(collection.finalLabels, ['A', 'B']);
		assert.deepStrictEqual(collection.labels, ['A', 'B']);
	});

	it('a dropped card that opened a label group hands the label to the next card of the group', () => {
		const {cards} = countingCards();
		const description = new CollectionDescription('everything', ['starred'], 'default');
		//The worker blanks a label that repeats its predecessor's, so once
		//the opener is dropped the group would have no label at all.
		const result = workerResult(description, {ids: ['a', 'missing', 'b', 'c'], labels: ['L1', 'L2', '', 'L3'], numCards: 4});
		const collection = Collection.fromWorkerResult(description, makeArgs(cards), result);
		assert.deepStrictEqual(collection.finalSortedCardIDs, ['a', 'b', 'c']);
		assert.deepStrictEqual(collection.finalLabels, ['L1', 'L2', 'L3']);
	});

	it('a dropped start card does not promote the first match into the start segment', () => {
		const {cards} = countingCards();
		const description = new CollectionDescription('everything', ['starred'], 'default');
		const result = workerResult(description, {ids: ['missing', 'a', 'b'], labels: ['', 'A', 'B'], numCards: 2, numStartCards: 1});
		const collection = Collection.fromWorkerResult(description, makeArgs(cards), result);
		assert.strictEqual(collection.numStartCards, 0);
		assert.deepStrictEqual(collection.sortedCardIDs, ['a', 'b']);
		assert.strictEqual(collection.matchedCard('a'), true);
		assert.deepStrictEqual(collection.finalLabels, ['A', 'B']);
		assert.strictEqual(collection.finalLabels.length, collection.numFinalSortedCards);
	});

	it('a slice at the front expands only its window', () => {
		const {cards, reads} = countingCards();
		const description = new CollectionDescription('everything', ['starred'], 'default');
		const result = workerResult(description, {ids: ['a', 'b', 'c'], labels: ['', '', ''], numCards: 3});
		const collection = Collection.fromWorkerResult(description, makeArgs(cards), result);
		assert.deepStrictEqual(collection.finalSortedCardsSlice(0, 1).map(c => c.id), ['a']);
		assert.deepStrictEqual(reads, ['a'], 'the slice read past its end');
	});

	it('keeps the start cards ahead of the sorted cards without reading them', () => {
		const {cards, reads} = countingCards();
		const description = new CollectionDescription('everything', ['starred'], 'default');
		const result = workerResult(description, {ids: ['c', 'a', 'b'], labels: ['', 'L', 'L'], numCards: 2, numStartCards: 1});
		const collection = Collection.fromWorkerResult(description, makeArgs(cards), result);
		assert.strictEqual(collection.numStartCards, 1);
		assert.deepStrictEqual(collection.sortedCardIDs, ['a', 'b']);
		assert.deepStrictEqual(collection.finalSortedCardIDs, ['c', 'a', 'b']);
		assert.deepStrictEqual(collection.finalLabels, ['', 'L', 'L']);
		assert.deepStrictEqual(collection.labels, ['L', 'L']);
		assert.strictEqual(collection.matchedCard('c'), false, 'a start card is not a match');
		assert.deepStrictEqual(reads, []);
		assert.deepStrictEqual(collection.finalSortedCards.map(c => c.id), ['c', 'a', 'b']);
		assert.deepStrictEqual(collection.sortedCards.map(c => c.id), ['a', 'b']);
		assert.deepStrictEqual(collection.filteredCards.map(c => c.id), ['a', 'b']);
	});

	it('does not apply the offset and limit a second time to the worker\'s ids', () => {
		const {cards} = countingCards();
		const description = new CollectionDescription('everything', ['starred', 'offset/1'], 'default');
		assert.strictEqual(description.offset, 1);
		//The worker already skipped the first match.
		const result = workerResult(description, {ids: ['b'], labels: [''], numCards: 1});
		const collection = Collection.fromWorkerResult(description, makeArgs(cards), result);
		assert.deepStrictEqual(collection.sortedCards.map(c => c.id), ['b']);
		assert.deepStrictEqual(collection.filteredCards.map(c => c.id), ['b']);
		assert.deepStrictEqual(collection.sortedCardIDs, ['b']);
		assert.strictEqual(collection.numCards, 1);
	});

	it('is never a handoff source for the local pipeline', () => {
		const {cards} = countingCards();
		const description = new CollectionDescription('everything', ['starred'], 'default');
		const args = makeArgs(cards);
		const result = workerResult(description, {ids: ['a', 'b'], labels: ['', ''], numCards: 2});
		const collection = Collection.fromWorkerResult(description, args, result);
		//Do its work, as a previous collection would have.
		assert.strictEqual(collection.finalSortedCards.length, 2);
		assert.strictEqual(Collection.handoff(collection, description, {...args, cards: lazyProcessCards(rawCards())}), null);
	});

	it('a local collection answers the id accessors from its own cards', () => {
		const {cards} = countingCards();
		const description = new CollectionDescription('everything', ['starred'], 'default');
		const collection = description.collection(makeArgs(cards));
		assert.deepStrictEqual(collection.finalSortedCardIDs, ['a', 'b']);
		assert.strictEqual(collection.numFinalSortedCards, 2);
		assert.deepStrictEqual(collection.sortedCardIDs, ['a', 'b']);
		assert.deepStrictEqual(collection.finalSortedCardsSlice(1).map(c => c.id), ['b']);
		assert.strictEqual(collection.matchedCard('b'), true);
	});

	it('a local collection with start cards labels them blank ahead of the sorted labels', () => {
		const {cards} = countingCards();
		const description = new CollectionDescription('everything', ['starred'], 'default');
		const collection = description.collection(makeArgs(cards, {startCards: {[description.serialize()]: ['c']}}));
		assert.strictEqual(collection.numStartCards, 1);
		assert.deepStrictEqual(collection.finalSortedCardIDs, ['c', 'a', 'b']);
		assert.strictEqual(collection.finalLabels.length, collection.numFinalSortedCards);
		assert.strictEqual(collection.finalLabels[0], '');
		assert.deepStrictEqual(collection.finalLabels.slice(1), collection.labels);
	});
});

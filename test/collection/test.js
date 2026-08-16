/*eslint-env node*/

//Tests for Collection work handoff (reusing filter/sort work when only the
//live cards map changed), Collection.fromWorkerResult (reproducing a
//worker-computed collection on the main thread without recomputing it), and
//countForDescription (cheap tab counts).

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

describe('Collection.fromWorkerResult', () => {
	before(async () => {
		({
			CollectionDescription,
			countForDescription,
			descriptionRequiresFullCollectionCount,
		} = await import('../../lib/src/collection_description.js'));
	});

	it('reproduces a locally-computed collection without recomputing', async () => {
		const state = makeBaseState();
		const description = new CollectionDescription('everything', ['starred']);
		const args = makeArgs(state);
		const local = description.collection(args);
		const result = {
			description: description.serialize(),
			ids: local.finalSortedCards.map(c => c.id),
			labels: local.finalLabels,
			numCards: local.numCards,
			numStartCards: local.numStartCards,
			isFallback: local.isFallback,
			preview: local.preview,
			partialMatches: local.partialMatches,
		};
		const {Collection} = await import('../../lib/src/collection_description.js');
		const seeded = Collection.fromWorkerResult(description, args, result);
		//All the getters components use agree with the local computation...
		assert.deepStrictEqual(seeded.finalSortedCards.map(c => c.id), result.ids);
		assert.deepStrictEqual(seeded.finalLabels, result.labels);
		assert.strictEqual(seeded.numCards, local.numCards);
		assert.strictEqual(seeded.numStartCards, local.numStartCards);
		assert.strictEqual(seeded.isFallback, local.isFallback);
		assert.strictEqual(seeded.preview, local.preview);
		//...and the expensive state was pre-seeded, not recomputed: the
		//internal filtered cards were installed directly.
		assert.ok(seeded._filteredCards !== null);
		//Expanded cards come from the live cards map.
		assert.strictEqual(seeded.finalSortedCards[0], state.cards[result.ids[0]]);
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

//#731: a Timestamp that has crossed the worker boundary arrives
//prototype-stripped — structuredClone keeps own properties but drops the
//prototype — so the date filter's unguarded val.toMillis() threw, the worker's
//subscription loop swallowed the exception, and the collection rendered
//permanently empty with no trace outside the worker console.
describe('date filters tolerate prototype-stripped timestamps', () => {
	let makeConfigurableFilter;
	let Timestamp;

	before(async () => {
		({makeConfigurableFilter} = await import('../../lib/src/filters.js'));
		({Timestamp} = await import('firebase/firestore'));
	});

	//Exactly what structuredClone leaves behind.
	const strip = (timestamp) => ({seconds: timestamp.seconds, nanoseconds: timestamp.nanoseconds});

	it('gives the same answer for a real Timestamp and a stripped one', () => {
		const [func] = makeConfigurableFilter('created/after/7-days-ago');
		const recent = Timestamp.fromMillis(Date.now() - 1000 * 60 * 60);
		const old = Timestamp.fromMillis(Date.now() - 1000 * 60 * 60 * 24 * 30);

		assert.strictEqual(func({created: recent}).matches, true);
		assert.strictEqual(func({created: strip(recent)}).matches, true, 'stripped recent should still match');
		assert.strictEqual(func({created: old}).matches, false);
		assert.strictEqual(func({created: strip(old)}).matches, false, 'stripped old should still not match');
	});

	it('does not throw on a stripped timestamp', () => {
		//The #731 failure was a TypeError, not a wrong answer.
		const [func] = makeConfigurableFilter('created/after/7-days-ago');
		assert.doesNotThrow(() => func({created: strip(Timestamp.fromMillis(Date.now()))}));
	});

	it('covers before and between, not just after', () => {
		const recent = Timestamp.fromMillis(Date.now() - 1000 * 60 * 60);
		const [before] = makeConfigurableFilter('created/before/7-days-ago');
		assert.strictEqual(before({created: recent}).matches, false);
		assert.strictEqual(before({created: strip(recent)}).matches, false);

		const [between] = makeConfigurableFilter('created/between/30-days-ago/today');
		assert.strictEqual(between({created: strip(recent)}).matches, between({created: recent}).matches);
	});

	it('still reports no match for a missing timestamp, without throwing', () => {
		const [func] = makeConfigurableFilter('created/after/7-days-ago');
		assert.strictEqual(func({}).matches, false);
	});

	//A MALFORMED created (as opposed to the legitimate wire shape) must never
	//match anything. An earlier draft of this fix returned 0 — the epoch — for
	//these, which made a card created TODAY report `created/before/7-days-ago`
	//as true: silently wrong, and worse than the crash the fix removed.
	it('never matches for a malformed timestamp, in any comparison', () => {
		const now = Date.now();
		const malformed = {
			'a JS Date': new Date(now),
			'an ISO string': new Date(now).toISOString(),
			'a bare millis number': now,
			'seconds as a string': {seconds: String(Math.floor(now / 1000)), nanoseconds: 0},
			'null': null,
		};
		const filters = {
			after: makeConfigurableFilter('created/after/7-days-ago')[0],
			before: makeConfigurableFilter('created/before/7-days-ago')[0],
			between: makeConfigurableFilter('created/between/30-days-ago/today')[0],
		};
		for (const [shape, created] of Object.entries(malformed)) {
			for (const [comparison, func] of Object.entries(filters)) {
				assert.strictEqual(func({created}).matches, false, `${shape} should not match ${comparison}`);
			}
		}
	});

	//The helper must agree with Firestore's own toMillis(), which does NOT
	//round — it returns fractional milliseconds.
	it('agrees with the real Timestamp.toMillis, including sub-millisecond values', () => {
		const [func] = makeConfigurableFilter('created/after/7-days-ago');
		for (const nanoseconds of [0, 400000, 500000, 999999999]) {
			const real = new Timestamp(Math.floor(Date.now() / 1000) - 1, nanoseconds);
			assert.strictEqual(
				func({created: real}).matches,
				func({created: strip(real)}).matches,
				`stripped and real should agree at nanoseconds=${nanoseconds}`
			);
		}
	});
});

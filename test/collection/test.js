/*eslint-env node, es2020*/

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
		assert.ok(previous.finalSortedCards.length >= 0);
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

//#735: the 'created' sort extractor read card.updated_substantive — a
//copy-paste of the 'updated' extractor directly above it — so sort/created had
//never once sorted by creation date. It looked plausible because the two
//orderings correlate heavily; they only diverge for an old card edited
//recently, which is exactly the case these cards construct.
describe('sort/created sorts by created, not updated', () => {
	let SORTS;
	let Timestamp;

	before(async () => {
		({SORTS} = await import('../../lib/src/filters.js'));
		({Timestamp} = await import('firebase/firestore'));
	});

	const OLD = () => Timestamp.fromMillis(Date.UTC(2020, 0, 1));
	const NEW = () => Timestamp.fromMillis(Date.UTC(2026, 0, 1));

	it('extracts card.created', () => {
		//Deliberately opposite orderings, so reading the wrong field is visible.
		const oldCardEditedRecently = {created: OLD(), updated_substantive: NEW()};
		const newCardNotEditedSince = {created: NEW(), updated_substantive: OLD()};

		assert.strictEqual(SORTS['created'].extractor(oldCardEditedRecently)[0], OLD().seconds);
		assert.strictEqual(SORTS['created'].extractor(newCardNotEditedSince)[0], NEW().seconds);
	});

	it('orders the two cards opposite to how sort/updated would', () => {
		const a = {created: OLD(), updated_substantive: NEW()};
		const b = {created: NEW(), updated_substantive: OLD()};

		const byCreated = SORTS['created'].extractor(a)[0] - SORTS['created'].extractor(b)[0];
		const byUpdated = SORTS['updated'].extractor(a)[0] - SORTS['updated'].extractor(b)[0];

		assert.ok(byCreated < 0, 'a was created before b');
		assert.ok(byUpdated > 0, 'a was updated after b');
	});

	//NOTE: passes without the fix too — a regression guard, not a demonstration.
	it('still handles a missing timestamp', () => {
		assert.strictEqual(SORTS['created'].extractor({})[0], 0);
	});

	//The SORT path has the same prototype-stripped-Timestamp hazard the filter
	//path had: prettyTime() is called by five extractors and used to throw on
	//{seconds, nanoseconds}, which the subscription loop then swallowed into a
	//permanently empty collection. Pointing sort/created at card.created — the
	//field #731 names as the prime suspect for malformed values — is what made
	//that reachable, so it is covered here.
	it('does not throw on a prototype-stripped or malformed timestamp', () => {
		const real = Timestamp.fromMillis(Date.UTC(2022, 0, 1));
		const shapes = {
			'prototype-stripped': {seconds: real.seconds, nanoseconds: real.nanoseconds},
			'a JS Date': new Date(Date.UTC(2022, 0, 1)),
			'an ISO string': '2022-01-01T00:00:00Z',
			'a millis number': Date.UTC(2022, 0, 1),
			'an empty object': {},
		};
		for (const [name, created] of Object.entries(shapes)) {
			assert.doesNotThrow(() => SORTS['created'].extractor({created}), `${name} should not throw`);
		}
	});

	it('gives a stripped timestamp the same sort value and label as a real one', () => {
		const real = Timestamp.fromMillis(Date.UTC(2022, 0, 1));
		const stripped = {seconds: real.seconds, nanoseconds: real.nanoseconds};
		const [realValue, realLabel] = SORTS['created'].extractor({created: real});
		const [strippedValue, strippedLabel] = SORTS['created'].extractor({created: stripped});
		assert.strictEqual(strippedValue, realValue);
		assert.strictEqual(strippedLabel, realLabel);
	});
});

//#736: the configurable-filter memo was dead (nothing ever assigned the
//extras guard anything but null), so every configurable filter re-scanned the
//whole corpus on every collection run. Turning it on is only safe because
//extras is the complete EXPLICIT input surface of a configurable filter — but
//the current date is an ambient input that is NOT in extras, and
//relativeDateKey never reaches Collection. Without a day key in the memo key,
//an idle tab would serve yesterday's answer to every relative-date filter.
describe('configurable-filter memo invalidates across a local midnight', () => {
	let CollectionDescription;
	let Timestamp;

	before(async () => {
		({CollectionDescription} = await import('../../lib/src/collection_description.js'));
		({Timestamp} = await import('firebase/firestore'));
	});

	//Same shape the relative-date suite uses to control "now".
	const withFakeNow = (millis, fn) => {
		const RealDate = Date;
		global.Date = class extends RealDate {
			constructor(...args) {
				super(...(args.length ? args : [millis]));
			}
			static now() {
				return millis;
			}
		};
		try {
			return fn();
		} finally {
			global.Date = RealDate;
		}
	};

	it('recomputes a relative-date filter after the day rolls over', () => {
		const DAY_ONE = new Date(2026, 5, 10, 15, 0).getTime();
		const DAY_TWO = new Date(2026, 5, 11, 15, 0).getTime();
		//Created on day one, in the morning.
		const createdDayOne = Timestamp.fromMillis(new Date(2026, 5, 10, 9, 0).getTime());

		const cards = {a: card('a', {created: createdDayOne})};
		const state = {
			cards,
			sets: {main: ['a'], everything: ['a'], 'reading-list': []},
			filters: {starred: {}, read: {}},
		};
		//ONE args object, reused across both runs, so `extras` identity is
		//stable and only the ambient date differs — precisely the case the day
		//key exists for.
		const args = makeArgs(state);
		const description = new CollectionDescription('everything', ['created/after/today']);

		const dayOneIDs = withFakeNow(DAY_ONE, () => description.collection(args).finalSortedCards.map(c => c.id));
		const dayTwoIDs = withFakeNow(DAY_TWO, () => description.collection(args).finalSortedCards.map(c => c.id));

		//On day one the card was created today, so it matches.
		assert.deepStrictEqual(dayOneIDs, ['a'], 'card created this morning should match created/after/today');
		//On day two "today" has moved, so the same card must NOT match. If the
		//memo lacked a day key it would return day one's answer here.
		assert.deepStrictEqual(dayTwoIDs, [], 'after midnight the same card is no longer created today');
	});
});

//The point of #736: prove the memo actually HITS now. Observed via a counting
//getter on the field the configurable filter reads — with a dead memo the
//filter re-scans the corpus on every run, so the count doubles.
describe('configurable-filter memo actually caches', () => {
	let CollectionDescription;
	let Timestamp;

	before(async () => {
		({CollectionDescription} = await import('../../lib/src/collection_description.js'));
		({Timestamp} = await import('firebase/firestore'));
	});

	it('does not re-scan the corpus when nothing changed', () => {
		let reads = 0;
		const created = Timestamp.fromMillis(Date.now() - 1000 * 60 * 60);
		const counting = card('a');
		Object.defineProperty(counting, 'created', {
			get() {
				reads++;
				return created;
			},
			enumerable: true,
		});
		const state = {
			cards: {a: counting},
			sets: {main: ['a'], everything: ['a'], 'reading-list': []},
			filters: {starred: {}, read: {}},
		};
		//The SAME args object both times, so extras identity is stable — the
		//condition under which the memo is allowed to hit.
		const args = makeArgs(state);
		const description = new CollectionDescription('everything', ['created/after/7-days-ago']);

		assert.ok(description.collection(args).finalSortedCards.length >= 0);
		const afterFirst = reads;
		assert.ok(afterFirst > 0, 'the filter should have read the field at least once');

		assert.ok(description.collection(args).finalSortedCards.length >= 0);
		const afterSecond = reads;

		assert.strictEqual(afterSecond, afterFirst, 'the second run must be served from the memo, not re-scanned');
	});

	it('does re-scan when the cards actually changed', () => {
		let reads = 0;
		const created = Timestamp.fromMillis(Date.now() - 1000 * 60 * 60);
		const makeCounting = (id) => {
			const c = card(id);
			Object.defineProperty(c, 'created', {
				get() {
					reads++;
					return created;
				},
				enumerable: true,
			});
			return c;
		};
		const description = new CollectionDescription('everything', ['created/after/7-days-ago']);

		const first = {a: makeCounting('a')};
		const stateOne = {cards: first, sets: {main: ['a'], everything: ['a'], 'reading-list': []}, filters: {starred: {}, read: {}}};
		assert.ok(description.collection(makeArgs(stateOne)).finalSortedCards.length >= 0);
		const afterFirst = reads;

		//A genuinely new cards map: the memo MUST NOT serve the old result.
		const second = {a: makeCounting('a')};
		const stateTwo = {cards: second, sets: stateOne.sets, filters: stateOne.filters};
		assert.ok(description.collection(makeArgs(stateTwo)).finalSortedCards.length >= 0);

		assert.ok(reads > afterFirst, 'changed cards must invalidate the memo');
	});
});

//#741 was one extractor reading its timestamp unguarded while its four
//siblings guarded theirs; it threw on any card lacking that field, and a
//throw inside a sort extractor takes out the whole collection. Rather than
//just guard that one, pin the invariant for ALL of them so the next extractor
//added cannot reintroduce it.
describe('every sort extractor survives a card with no timestamps', () => {
	let SORTS;

	before(async () => {
		({SORTS} = await import('../../lib/src/filters.js'));
	});

	//Called the way collection_description.ts:1061 calls it:
	//(card, sections, cards, sortExtras, filterExtras).
	const extract = (config, c) => config.extractor(c, {}, {[c.id]: c}, {}, {});

	it('does not throw for any sort, on a card carrying none of the optional fields', () => {
		const bare = card('bare');
		for (const [name, config] of Object.entries(SORTS)) {
			assert.doesNotThrow(() => extract(config, bare), `sort/${name} threw on a card with no timestamps`);
		}
	});

	it('returns a numeric, non-NaN sort value for every sort', () => {
		const bare = card('bare');
		for (const [name, config] of Object.entries(SORTS)) {
			const [value] = extract(config, bare);
			assert.strictEqual(typeof value, 'number', `sort/${name} should yield a number`);
			assert.ok(!Number.isNaN(value), `sort/${name} should not yield NaN`);
		}
	});
});

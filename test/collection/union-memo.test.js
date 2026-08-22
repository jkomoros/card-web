/*eslint-env node, es2020*/

//Pins the #769 fix: a `+`-union with an INVERSE member (like the default
//sticky search filter `prioritized+published`) expands via a whole-corpus
//walk, and ran unmemoized on every collection evaluation — a ~22ms walk at
//40k cards per debounced find keystroke. The memo keys on each member's
//membership identity plus (only when an inverse member needs it) the cards
//identity, and returns the SAME object on a hit — which also stops
//downstream identity-keyed memos from busting.

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

let filterSetForFilterDefinitionItem;
let INVERSE_FILTER_NAMES;

//A minimal FilterExtras: the union path reads these three fields. The
//token mirrors real construction: the cards map identity on
//immutable-update paths, a version counter on the worker.
const extrasFor = (filterSetMemberships, cards, cardsContentToken = cards) => ({filterSetMemberships, cards, cardsContentToken});

describe('union filter expansion is memoized (#769)', () => {
	before(async () => {
		({filterSetForFilterDefinitionItem} = await import('../../lib/src/collection_description.js'));
		({INVERSE_FILTER_NAMES} = await import('../../lib/src/filters.js'));
		//The tests below lean on 'prioritized' being an inverse filter, the
		//way the motivating default expression does.
		assert.ok(INVERSE_FILTER_NAMES['prioritized'], 'fixture assumption: prioritized is an inverse filter');
	});

	after(() => {
		dom.window.close();
	});

	it('computes the right membership for an inverse-member union, and caches by identity', () => {
		const notPrioritized = {b: true, c: true};
		const published = {a: true, b: true};
		const memberships = {'not-prioritized': notPrioritized, published};
		const cards = {a: true, b: true, c: true, d: true};
		const extras = extrasFor(memberships, cards);
		const [first] = filterSetForFilterDefinitionItem('prioritized+published', extras);
		//prioritized = NOT not-prioritized = {a, d}; union with published
		//{a, b} = {a, b, d}.
		assert.deepStrictEqual(Object.keys(first).sort(), ['a', 'b', 'd']);
		//Identity-stable across identical evaluations: the whole point.
		const [second] = filterSetForFilterDefinitionItem('prioritized+published', extras);
		assert.strictEqual(second, first, 'a hit must return the SAME object, not an equal one');
		//And across a fresh-but-identical extras object (the memo keys on
		//the member identities, not the extras wrapper).
		const [third] = filterSetForFilterDefinitionItem('prioritized+published', extrasFor(memberships, cards));
		assert.strictEqual(third, first);
	});

	it('invalidates when a member membership identity changes', () => {
		const notPrioritized = {b: true};
		const published = {a: true};
		const cards = {a: true, b: true};
		const [first] = filterSetForFilterDefinitionItem('prioritized+published', extrasFor({'not-prioritized': notPrioritized, published}, cards));
		const [second] = filterSetForFilterDefinitionItem('prioritized+published', extrasFor({'not-prioritized': notPrioritized, published: {a: true, b: true}}, cards));
		assert.notStrictEqual(second, first);
		assert.deepStrictEqual(Object.keys(second).sort(), ['a', 'b']);
	});

	it('invalidates on cards identity ONLY when an inverse member depends on it', () => {
		const starred = {a: true};
		const read = {b: true};
		const memberships = {starred, read, 'not-prioritized': {b: true}, published: {a: true}};
		//No inverse member: cards identity is irrelevant.
		const [plainFirst] = filterSetForFilterDefinitionItem('starred+read', extrasFor(memberships, {a: true, b: true}));
		const [plainSecond] = filterSetForFilterDefinitionItem('starred+read', extrasFor(memberships, {a: true, b: true, c: true}));
		assert.strictEqual(plainSecond, plainFirst, 'a union of normal filters must not recompute on card churn');
		//Inverse member: new cards identity must recompute.
		const [inverseFirst] = filterSetForFilterDefinitionItem('prioritized+published', extrasFor(memberships, {a: true, b: true}));
		const [inverseSecond] = filterSetForFilterDefinitionItem('prioritized+published', extrasFor(memberships, {a: true, b: true, c: true}));
		assert.notStrictEqual(inverseSecond, inverseFirst);
		assert.deepStrictEqual(Object.keys(inverseSecond).sort(), ['a', 'c'], 'the new card lands in the concretized inverse');
	});

	it('a member that resolves later (async section/tag load) invalidates', () => {
		const cards = {a: true, b: true};
		const [first] = filterSetForFilterDefinitionItem('some-tag+starred', extrasFor({starred: {a: true}}, cards));
		assert.deepStrictEqual(Object.keys(first), ['a'], 'unresolved member contributes nothing');
		const [second] = filterSetForFilterDefinitionItem('some-tag+starred', extrasFor({starred: {a: true}, 'some-tag': {b: true}}, cards));
		assert.notStrictEqual(second, first);
		assert.deepStrictEqual(Object.keys(second).sort(), ['a', 'b']);
	});

	it('a stable cards identity with a bumped content token invalidates (the worker shape)', () => {
		//The #769 review's blocking find: the worker mutates ONE cards map
		//in place for its whole life and bumps a version counter, so keying
		//on cards identity served stale inverse unions — a newly-synced
		//prioritized unpublished card was invisible to the default sticky
		//filter. The memo must key on the TOKEN.
		const memberships = {'not-prioritized': {b: true}, published: {a: true}};
		const cards = {a: true, b: true};
		const [first] = filterSetForFilterDefinitionItem('prioritized+published', extrasFor(memberships, cards, 1));
		assert.deepStrictEqual(Object.keys(first).sort(), ['a']);
		//The worker's in-place mutation: same map identity, new content,
		//bumped token.
		cards.p = true;
		const [second] = filterSetForFilterDefinitionItem('prioritized+published', extrasFor(memberships, cards, 2));
		assert.notStrictEqual(second, first, 'a bumped token must invalidate despite stable identities');
		assert.deepStrictEqual(Object.keys(second).sort(), ['a', 'p'], 'the newly-arrived prioritized card must be visible');
		//And an unchanged token hits.
		const [third] = filterSetForFilterDefinitionItem('prioritized+published', extrasFor(memberships, cards, 2));
		assert.strictEqual(third, second);
	});

	it('END TO END: a card arriving on the inverse side becomes visible through the real QueryEngine', async () => {
		//The reviewer's demonstration, as a permanent regression test: this
		//exact sequence returned a stale ['a'] on the identity-keyed memo.
		const {QueryEngine} = await import('../../lib/src/worker/query-engine.js');
		const fullCard = (id, extras) => ({
			id, card_type: 'content', title: id, body: '<p>b</p>', section: 'main',
			tags: [], sort_order: 1.0, references: {}, references_info: {},
			references_inbound: {}, references_info_inbound: {},
			auto_todo_overrides: {}, published: true, ...extras,
		});
		const engine = new QueryEngine();
		engine.updateCards({
			a: fullCard('a', {star_count: 1}),
			b: fullCard('b'),
		}, []);
		engine.applyAction({type: 'UPDATE_STARS', starsToAdd: ['a'], starsToRemove: []});
		engine.applyAction({type: 'UPDATE_READS', readsToAdd: ['b'], readsToRemove: []});
		const before = engine.runCollection('everything/unstarred+read/', {});
		assert.deepStrictEqual(before.ids.sort(), ['b']);
		//A new card arrives: not starred, not read — it belongs in the
		//union via the INVERSE member, which is exactly the side the stale
		//memo could not see.
		engine.updateCards({d: fullCard('d')}, []);
		const after = engine.runCollection('everything/unstarred+read/', {});
		assert.ok(after.ids.includes('d'), `a newly-arrived card on the inverse side must be visible (got ${JSON.stringify(after.ids)})`);
	});

	it('a different cards map under the SAME token recomputes (the narrowed-run shape)', () => {
		//The worker's narrowed query runs evaluate against a fresh
		//restricted proxy carrying the same version counter as the full
		//corpus. A full-corpus run hitting a narrowed run's entry would be
		//UNDER-inclusive — the worse direction.
		const memberships = {'not-prioritized': {b: true}, published: {}};
		const narrowed = {a: true, b: true};
		const full = {a: true, b: true, c: true};
		const [narrowedResult] = filterSetForFilterDefinitionItem('prioritized+published', extrasFor(memberships, narrowed, 7));
		assert.deepStrictEqual(Object.keys(narrowedResult).sort(), ['a']);
		const [fullResult] = filterSetForFilterDefinitionItem('prioritized+published', extrasFor(memberships, full, 7));
		assert.notStrictEqual(fullResult, narrowedResult);
		assert.deepStrictEqual(Object.keys(fullResult).sort(), ['a', 'c'], 'the full run must see the full inverse, not the narrowed cache');
	});

	it('a hit refreshes recency, so a hot union survives a flood of cold names (LRU)', () => {
		const starred = {a: true};
		const memberships = {starred, read: {b: true}};
		const cards = {a: true, b: true};
		const [hot] = filterSetForFilterDefinitionItem('starred+read', extrasFor(memberships, cards));
		for (let i = 0; i < 40; i++) {
			//Interleave hits with the flood: the hot entry must keep
			//surviving because each hit re-marks it newest.
			filterSetForFilterDefinitionItem(`starred+cold-${i}`, extrasFor(memberships, cards));
			const [again] = filterSetForFilterDefinitionItem('starred+read', extrasFor(memberships, cards));
			assert.strictEqual(again, hot, `the hot entry must survive the flood (lost at cold-${i})`);
		}
	});

	it('the memo is capped and still correct after eviction', () => {
		const memberships = {starred: {a: true}, read: {b: true}};
		const cards = {a: true, b: true};
		const [first] = filterSetForFilterDefinitionItem('starred+read', extrasFor(memberships, cards));
		//Flood with distinct union names past the cap.
		for (let i = 0; i < 40; i++) {
			filterSetForFilterDefinitionItem(`starred+missing-${i}`, extrasFor(memberships, cards));
		}
		//The original entry may have been evicted; a re-request must still
		//be CORRECT (identity may differ, correctness may not).
		const [again] = filterSetForFilterDefinitionItem('starred+read', extrasFor(memberships, cards));
		assert.deepStrictEqual(Object.keys(again).sort(), Object.keys(first).sort());
	});
});

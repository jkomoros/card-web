/*eslint-env node, es2020*/

//Pins the #752 fixes: counts reflect card RECORDS, not the sections doc's
//membership index (readable by anyone, so an anonymous client sees all IDs
//but only the published records); an oversized offset counts 0, not
//negative; and exotic numerals in limit/offset fall back to "no limit" the
//way limit/abc always did, instead of parseInt truncating limit/1e400 to 1.

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
let computeDefaultSet;

const card = (id, section) => ({
	id,
	card_type: 'content',
	title: 'Title of ' + id,
	body: '<p>Body</p>',
	section,
	tags: [],
	sort_order: 1.0,
	references: {},
	references_info: {},
	references_inbound: {},
	references_info_inbound: {},
	auto_todo_overrides: {},
	published: true,
});

describe('truthful card counts (#752)', () => {
	before(async () => {
		({CollectionDescription, countForDescription} = await import('../../lib/src/collection_description.js'));
		({computeDefaultSet} = await import('../../lib/src/set-projections.js'));
	});

	after(() => {
		dom.window.close();
	});

	it('computeDefaultSet skips IDs with no card record', () => {
		//The anonymous-user shape: the section lists more IDs than the
		//client holds records for.
		const cards = {a: card('a', 'main'), b: card('b', 'main')};
		const sections = {main: {cards: ['a', 'b', 'phantom-1', 'phantom-2']}};
		assert.deepStrictEqual(computeDefaultSet(sections, cards).sort(), ['a', 'b'],
			'the set must contain exactly the IDs that could render');
	});

	it('header count equals what renders, even through a section + no-op filter', () => {
		//The self-contradicting case from the issue: /c/complexity/all-cards/
		//reported 40 and rendered 39, because the count read the raw ID list
		//while rendering dropped the phantom.
		const cards = {a: card('a', 'complexity'), b: card('b', 'complexity')};
		const sections = {complexity: {cards: ['a', 'b', 'phantom']}};
		const sets = {
			main: computeDefaultSet(sections, cards),
			everything: Object.keys(cards),
			'reading-list': [],
		};
		const filters = {
			complexity: {a: true, b: true, phantom: true},
			'all-cards': {a: true, b: true, phantom: true},
		};
		const description = new CollectionDescription('main', ['complexity', 'all-cards']);
		const collection = description.collection({cards, sets, filters, sections, fallbacks: {}, startCards: {}});
		assert.strictEqual(collection.numCards, 2);
		assert.strictEqual(collection.finalSortedCards.length, 2, 'count and render must agree');
		assert.strictEqual(countForDescription(description, sets, filters, Object.fromEntries(Object.keys(cards).map(id => [id, true]))), 2,
			'the cheap tab count must agree too');
	});

	it('the reading-list set is existence-gated too, preserving identity when clean', async () => {
		//The review of the first version of this change proved the claim
		//"counts always equal what renders" false for /c/reading-list/: the
		//stored list can outlive a card's deletion (or reach a user who may
		//not read it), and it was passed through raw.
		const {existingCardsOnly} = await import('../../lib/src/set-projections.js');
		const cards = {a: card('a', 'main'), b: card('b', 'main')};
		assert.deepStrictEqual(existingCardsOnly(['a', 'phantom', 'b'], cards), ['a', 'b']);
		//Identity preservation: a clean list comes back as the SAME array,
		//so memoized consumers keyed on set identity don't churn.
		const clean = ['a', 'b'];
		assert.strictEqual(existingCardsOnly(clean, cards), clean);
		//And the worker's set build uses it (source-text pin; the engine's
		//own suite covers behavior).
		const {readFileSync} = await import('fs');
		const engine = readFileSync(new URL('../../src/worker/query-engine.ts', import.meta.url), 'utf8');
		assert.match(engine, /'reading-list': existingCardsOnly\(this\._readingList, this\._cards\)/);
	});

	it('an offset past the match count reports 0, not a negative count', () => {
		const cards = {a: card('a', 'main')};
		const sets = {main: ['a'], everything: ['a'], 'reading-list': []};
		const description = new CollectionDescription('everything', ['offset/2000']);
		const collection = description.collection({cards, sets, filters: {}, sections: {}, fallbacks: {}, startCards: {}});
		assert.strictEqual(collection.numCards, 0, 'was -1999');
		assert.strictEqual(countForDescription(description, sets, {}, {a: true}), 0);
	});

	it('exotic numerals in limit fall back to no-limit, matching limit/abc', () => {
		const cards = {a: card('a', 'main'), b: card('b', 'main'), c: card('c', 'main')};
		const sets = {main: [], everything: ['a', 'b', 'c'], 'reading-list': []};
		const args = {cards, sets, filters: {}, sections: {}, fallbacks: {}, startCards: {}};
		//parseInt('1e400') is 1 — the user asked for effectively no limit
		//and got exactly one card. 0x10 and friends fail the same way now.
		for (const bogus of ['1e400', '0x10', 'abc', '-5', '12.5']) {
			const description = new CollectionDescription('everything', [`limit/${bogus}`]);
			assert.strictEqual(description.collection(args).numCards, 3, `limit/${bogus} must mean no limit`);
		}
		//Real limits still limit.
		const real = new CollectionDescription('everything', ['limit/2']);
		assert.strictEqual(real.collection(args).numCards, 2);
	});
});

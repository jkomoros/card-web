/*eslint-env node, es2020*/

//Pins the #743 fix: the wrapper filters (exclude/, combine/, expand/) hold
//their own memoize keyed on extras identity ALONE, retained indefinitely by
//makeConfigurableFilter's by-name cache — so on a tab whose extras identity
//was stable across a local midnight (an idle tab overnight, the normal
//case), a WRAPPED relative-date filter kept serving yesterday's answer even
//after #736 gave the outer per-run memo a day key. The fix evicts the
//by-name cache on day change, which covers every wrapper at once.
//
//This is the issue's measured battery. Non-vacuousness was verified by
//removing the eviction from the compiled output and re-running: exclude/,
//combine/ and expand/ all serve day-one answers on day two without it,
//while the control still passes (#736's outer day key covers only the
//direct filter). NOTE the fixture's cardSimilarity: {} in the SHARED args
//is load-bearing: the Collection constructor defaults a missing
//cardSimilarity to a fresh {} per call, which busts the extras memo and
//hands every run a fresh wrapper-memo key — silently defusing the very
//trap this battery exists to set.

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
let Timestamp;

const card = (id) => ({
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
});

//Same shape the sibling midnight test uses to control "now".
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

describe('wrapper filters roll over local midnight (#743)', () => {
	before(async () => {
		({CollectionDescription} = await import('../../lib/src/collection_description.js'));
		({Timestamp} = await import('firebase/firestore'));
	});

	after(() => {
		dom.window.close();
	});

	const DAY_ONE = new Date(2026, 5, 10, 15, 0).getTime();
	const DAY_TWO = new Date(2026, 5, 11, 15, 0).getTime();

	const runBattery = (filters) => {
		//Created on day one, in the morning.
		const createdDayOne = Timestamp.fromMillis(new Date(2026, 5, 10, 9, 0).getTime());
		const cards = {a: {...card('a'), created: createdDayOne}};
		//ONE args object reused across both runs, so extras identity is
		//stable and only the ambient date differs — the wrapper memos' key
		//never changes, which is exactly the trap.
		const args = {
			cards,
			sets: {main: ['a'], everything: ['a'], 'reading-list': []},
			filters: {starred: {}, read: {}},
			sections: {},
			fallbacks: {},
			startCards: {},
			//Load-bearing: see the header comment.
			cardSimilarity: {},
		};
		const description = new CollectionDescription('everything', filters);
		const dayOne = withFakeNow(DAY_ONE, () => description.collection(args).finalSortedCards.map(c => c.id));
		const dayTwo = withFakeNow(DAY_TWO, () => description.collection(args).finalSortedCards.map(c => c.id));
		return {dayOne, dayTwo};
	};

	it('control: the direct relative-date filter rolls over (already fixed by #736)', () => {
		const {dayOne, dayTwo} = runBattery(['created/after/today']);
		assert.deepStrictEqual(dayOne, ['a']);
		assert.deepStrictEqual(dayTwo, []);
	});

	it('exclude/ rolls over instead of serving yesterday\'s answer', () => {
		const {dayOne, dayTwo} = runBattery(['exclude/created/after/today']);
		assert.deepStrictEqual(dayOne, [], 'created today, so excluded');
		assert.deepStrictEqual(dayTwo, ['a'], 'no longer created today, so no longer excluded');
	});

	it('combine/ rolls over', () => {
		const {dayOne, dayTwo} = runBattery(['combine/created/after/today/created/before/2000-1-1']);
		assert.deepStrictEqual(dayOne, ['a']);
		assert.deepStrictEqual(dayTwo, [], 'neither branch matches after the day rolls');
	});

	it('expand/ rolls over', () => {
		const {dayOne, dayTwo} = runBattery(['expand/created/after/today/children/a']);
		assert.deepStrictEqual(dayOne, ['a'], 'the seed filter matches on day one (no children to add)');
		assert.deepStrictEqual(dayTwo, [], 'the seed filter must re-resolve after midnight');
	});
});

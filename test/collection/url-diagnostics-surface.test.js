/*eslint-env node, es2020*/

//Pins the #757 surfacing machinery: diagnostics are SCOPED to the RAW URL
//being looked at (self-hiding on navigation, self-showing on re-visit, no
//clear/re-report cycle to get wrong — raw URL rather than the canonical
//serialization because the adversarial review proved parts the parser
//DROPS never appear in serialize()), and a part that later parses fine
//retracts its diagnostic (section/tag names load async, so an early boot
//recompute can report against a perfectly valid URL).

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
let diagnosticsModule;
let urlDiagnosticsForRawURL;

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

const args = (cards, filters) => ({
	cards,
	sets: {main: Object.keys(cards), 'reading-list': [], everything: Object.keys(cards)},
	filters,
	sections: {},
	fallbacks: {},
	startCards: {},
	cardSimilarity: {},
});

describe('URL diagnostics surfacing (#757)', () => {
	before(async () => {
		({CollectionDescription} = await import('../../lib/src/collection_description.js'));
		//The SAME module instance lib/src/collection_description.js imports —
		//shared/dist is a separate build with separate module state.
		diagnosticsModule = await import('../../lib/shared/url-diagnostics.js');
		({urlDiagnosticsForRawURL} = await import('../../lib/src/selectors.js'));
	});

	beforeEach(() => {
		diagnosticsModule.clearURLDiagnostics();
	});

	after(() => {
		dom.window.close();
		for (const handle of process._getActiveHandles()) {
			if (handle.constructor?.name === 'MessagePort' && typeof handle.unref === 'function') handle.unref();
		}
	});

	it('scopes diagnostics to the URL being looked at', () => {
		const diagnostics = [
			{part: 'typo', fallback: 'ignored it'},
			{part: 'sort/bogus', fallback: 'sorted by default'},
		];
		//On the URL that contains the part: shown.
		assert.deepStrictEqual(
			urlDiagnosticsForRawURL(diagnostics, 'everything/typo/').map(d => d.part),
			['typo']);
		//Whole-segment matching: a part must not match inside another word.
		assert.deepStrictEqual(
			urlDiagnosticsForRawURL(diagnostics, 'everything/typography/').map(d => d.part),
			[]);
		//Multi-segment parts match as a sequence.
		assert.deepStrictEqual(
			urlDiagnosticsForRawURL(diagnostics, 'everything/sort/bogus/').map(d => d.part),
			['sort/bogus']);
		//Navigation away: nothing shown, nothing cleared.
		assert.deepStrictEqual(
			urlDiagnosticsForRawURL(diagnostics, 'main/').map(d => d.part),
			[]);
	});

	it('parts the parser DROPS still scope against the raw URL (review B1/B2)', () => {
		//A bogus view mode is consumed-and-dropped: serialize() returns
		//'everything/' with no trace of it — which is why scoping reads the
		//RAW URL, never the canonical serialization. And the sort report
		//site names the BARE part, because the reversed form serializes as
		//sort/reverse/<part> and a 'sort/<part>' report could never match.
		assert.deepStrictEqual(
			urlDiagnosticsForRawURL([{part: 'view/bogus-view', fallback: 'used the default view'}], 'everything/view/bogus-view/').map(d => d.part),
			['view/bogus-view']);
		assert.deepStrictEqual(
			urlDiagnosticsForRawURL([{part: 'bogus-sort', fallback: 'sorted by default'}], 'everything/sort/reverse/bogus-sort/').map(d => d.part),
			['bogus-sort'], 'the bare part matches the reversed form');
		assert.deepStrictEqual(
			urlDiagnosticsForRawURL([{part: 'bogus-sort', fallback: 'sorted by default'}], 'everything/sort/bogus-sort/').map(d => d.part),
			['bogus-sort'], 'and the plain form');
		//The report site itself names the bare part.
		diagnosticsModule.clearURLDiagnostics();
		//The report is lazy: it fires when the sort config is consulted, as
		//a collection run would.
		CollectionDescription.deserialize('everything/sort/reverse/bogus-sort/').sortConfig;
		assert.ok(diagnosticsModule.currentURLDiagnostics().some(d => d.part === 'bogus-sort'),
			'the sort report must use the bare part');
	});

	it('an orphan multi-part head reports instead of vanishing (review N5)', () => {
		//The un-wrapped #750 shape: `before/2020-01-01` shapes multi-part
		//parsing but is not a filter on its own, and used to be dropped
		//with no trace — the URL named a filter and the app showed
		//everything, silently.
		const description = CollectionDescription.deserialize('everything/before/2020-01-01/');
		assert.deepStrictEqual([...description.filters], []);
		assert.ok(diagnosticsModule.currentURLDiagnostics().some(d => d.part === 'before/2020-01-01'),
			'the dropped orphan head must be reported');
	});

	it('a bogus filter reports; the same name resolving later retracts (boot false positive)', () => {
		const cards = {a: card('a')};
		const description = new CollectionDescription('everything', ['not-yet-loaded-section']);
		//Boot shape: the section filter names have not arrived yet, so the
		//name is unknown and gets reported.
		//Materialize: the filter run is lazy.
		description.collection(args(cards, {})).finalSortedCards;
		assert.ok(diagnosticsModule.currentURLDiagnostics().some(d => d.part === 'not-yet-loaded-section'),
			'the unknown name must be reported');
		//The names arrive; the same run now resolves the name — and the
		//stale report must retract, or the notice would accuse a valid URL.
		description.collection(args(cards, {'not-yet-loaded-section': {a: true}})).finalSortedCards;
		assert.ok(!diagnosticsModule.currentURLDiagnostics().some(d => d.part === 'not-yet-loaded-section'),
			'a name that resolves must retract its diagnostic');
	});

	it('retraction is a no-op for unreported parts and notifies the listener', () => {
		const seen = [];
		diagnosticsModule.setURLDiagnosticsListener(list => seen.push(list.length));
		diagnosticsModule.retractURLDiagnostic('never-reported');
		assert.deepStrictEqual(seen, [], 'no notification for a no-op retraction');
		diagnosticsModule.reportURLDiagnostic('bad-part', 'ignored it');
		diagnosticsModule.retractURLDiagnostic('bad-part');
		assert.deepStrictEqual(seen, [1, 0]);
		diagnosticsModule.setURLDiagnosticsListener(null);
	});
});

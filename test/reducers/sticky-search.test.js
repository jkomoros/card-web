/*eslint-env node*/

//Pins #745 stage 1: the sticky search filter expression survives the find
//dialog's deliberate open/close resets, validates on read, and composes
//into the generic query description as ANDed components.

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

let findReducer;
let actions;
let sticky;
let selectors;

describe('sticky search filters (#745)', () => {
	before(async () => {
		//A storage shim: this JSDOM has no origin, so its localStorage throws.
		const backing = new Map();
		globalThis.localStorage = {
			getItem: (key) => backing.has(key) ? backing.get(key) : null,
			setItem: (key, value) => backing.set(key, String(value)),
			removeItem: (key) => backing.delete(key),
		};
		Object.defineProperty(window, 'localStorage', {value: globalThis.localStorage, configurable: true});
		findReducer = (await import('../../lib/src/reducers/find.js')).default;
		actions = await import('../../lib/src/actions.js');
		sticky = await import('../../lib/src/sticky-search-filters.js');
		selectors = await import('../../lib/src/selectors.js');
	});

	after(() => {
		dom.window.close();
		for (const handle of process._getActiveHandles()) {
			if (handle.constructor?.name === 'MessagePort' && typeof handle.unref === 'function') handle.unref();
		}
	});

	it('defaults to enabled with the prioritized+published union', () => {
		assert.strictEqual(sticky.readStickySearchEnabled(), true);
		assert.strictEqual(sticky.readStickySearchExpression(), 'prioritized+published');
	});

	it('survives the dialog open/close resets that clear everything else', () => {
		let state = findReducer(undefined, {type: actions.FIND_UPDATE_STICKY_FILTERS, enabled: false, expression: 'prioritized+published'});
		assert.strictEqual(state.stickyFiltersEnabled, false);
		//FIND_DIALOG_OPEN and CLOSE deliberately reset sortByRecent and
		//cardTypeFilter; the sticky value is the one thing that must not
		//reset — that is the whole point of "sticky".
		state = findReducer(state, {type: actions.FIND_DIALOG_OPEN});
		assert.strictEqual(state.stickyFiltersEnabled, false, 'must survive dialog open');
		assert.strictEqual(state.sortByRecent, false);
		state = findReducer(state, {type: actions.FIND_DIALOG_CLOSE});
		assert.strictEqual(state.stickyFiltersEnabled, false, 'must survive dialog close');
	});

	it('validates grammar AND vocabulary, degrading to none', () => {
		//The review proved the round trip alone is grammar-only: unknown
		//names parsed as "valid" and then silently no-op'd, and a
		//misspelled union MEMBER silently narrowed the union. The validator
		//now also checks the live filter vocabulary.
		const {validateStickySearchExpression} = selectors;
		//not-prioritized is the concrete filter the inverse resolves to;
		//published is a plain card filter — the live memberships map holds
		//both.
		const known = {'not-prioritized': {}, published: {}, 'has-body': {}, 'my-tag': {}};
		assert.deepStrictEqual(validateStickySearchExpression('prioritized+published', known), ['prioritized+published']);
		//A general expression parses to a LIST of ANDed components.
		assert.deepStrictEqual(validateStickySearchExpression('prioritized+published/has-body', known), ['prioritized+published', 'has-body']);
		//Configurable expressions validate by registered head.
		assert.deepStrictEqual(validateStickySearchExpression('updated/after/7-days-ago', known), ['updated/after/7-days-ago']);
		//Dynamic names (tags/sections) validate against the live map.
		assert.deepStrictEqual(validateStickySearchExpression('my-tag', known), ['my-tag']);
		//THE review case: a renamed/misspelled name must be REJECTED, not
		//silently no-op'd — including a misspelled union member, which
		//would otherwise silently narrow the union to published-only.
		assert.strictEqual(validateStickySearchExpression('no-such-filter-xyz', known), null);
		assert.strictEqual(validateStickySearchExpression('prioritzed+published', known), null);
		assert.strictEqual(validateStickySearchExpression('bogushead/whatever/x', known), null);
		//Empty degrades too.
		assert.strictEqual(validateStickySearchExpression('', known), null);
	});

	it('stickySearchFilterComponents honors enablement and a rejecting validator', () => {
		//Unit semantics of the composition helper with an injected
		//validator; the REAL validator's rejection behavior is pinned above.
		const validate = (expression) => expression === 'good' ? ['good'] : null;
		assert.deepStrictEqual(sticky.stickySearchFilterComponents(true, 'good', validate), ['good']);
		assert.deepStrictEqual(sticky.stickySearchFilterComponents(false, 'good', validate), [], 'disabled means no extra filters');
		assert.deepStrictEqual(sticky.stickySearchFilterComponents(true, 'anything-else', validate), [], 'rejected degrades to none, not to a throw');
	});

	it('sticky filters apply in generic mode only, through the real selector', () => {
		//The single most important safety property: the sticky expression
		//must never hide cards the user is trying to LINK to. Constructed
		//states through the real selectCollectionDescriptionForQuery.
		const findBase = {
			open: true, searchRecall: null, query: '', activeQuery: 'foo',
			renderOffset: 0, linking: false, permissions: false,
			referencing: false, sortByRecent: false, cardTypeFilter: '',
			cardTypeFilterLocked: false,
			stickyFiltersEnabled: true,
			stickyFiltersExpression: 'prioritized+published',
		};
		const collection = {activeCardID: 'card-a', filters: {'not-prioritized': {}, published: {}, 'has-body': {}}};
		const generic = selectors.selectCollectionDescriptionForQuery({find: findBase, collection});
		assert.ok(generic.serialize().includes('prioritized+published/'), `generic must include the sticky component (got ${generic.serialize()})`);
		const linking = selectors.selectCollectionDescriptionForQuery({find: {...findBase, linking: true}, collection});
		assert.ok(!linking.serialize().includes('prioritized+published'), `linking must NOT include it (got ${linking.serialize()})`);
		const disabled = selectors.selectCollectionDescriptionForQuery({find: {...findBase, stickyFiltersEnabled: false}, collection});
		assert.ok(!disabled.serialize().includes('prioritized+published'), 'disabled must not include it');
	});

	it('persists enablement and clears storage when back at the default', () => {
		sticky.writeStickySearchEnabled(false);
		assert.strictEqual(sticky.readStickySearchEnabled(), false);
		assert.ok(localStorage.getItem('card-web-sticky-search-filters-v1'), 'non-default persists');
		sticky.writeStickySearchEnabled(true);
		assert.strictEqual(sticky.readStickySearchEnabled(), true);
		assert.strictEqual(localStorage.getItem('card-web-sticky-search-filters-v1'), null,
			'the house pattern: remove the record when the value equals the default');
	});
});

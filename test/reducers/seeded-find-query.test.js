/*eslint-env node, es2022*/

//A SEEDED QUERY IS TEXT; A TYPED QUERY IS GRAMMAR.
//
//The find dialog now shares the composer's operator parser and is handed the
//live corpus as vocabulary, so a TYPED `tag:intrnal` resolves to the `internal`
//tag and `sort:stars` orders the results. That is the point of the shared
//parser and it stays.
//
//But the find dialog is not always typed into. Ctrl-L in the editor dispatches
//findCardToLink(selection.toString()) — the user's TEXT SELECTION becomes the
//query — and the widened operator table has heads (`type`, `kind`, `by`,
//`query`, `text`, `search`, `sort`, `order`, `set`, …) that occur in ordinary
//English prose. Measured on the un-fixed tree: selecting `Type: safety` searched
//for `safety` with the word `Type` deleted, `the set: of all things` lost
//`set:`, and `type:content` became a card-type filter.
//
//So provenance decides. This file pins BOTH sides through the real reducer and
//the real selector, because either one alone can be right while the pair is
//wrong: the flag has to survive from the action that seeds the query to the
//selector that reads it, and it has to be cleared at exactly the moment the
//edited query goes live.

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
let selectors;
let queryOperators;

//The corpus the vocabulary is derived from. selectQueryOperatorVocabulary reads
//tags and sections off the store, so a state that has them is a state where a
//typed `tag:` can actually resolve.
const STATE_WITH_TAGS = {
	data: {
		tags: {internal: {cards: []}},
		sections: {about: {cards: []}},
	},
};

const descriptionFor = (find) => selectors.selectCollectionDescriptionForQuery({
	...STATE_WITH_TAGS,
	find,
	collection: {activeCardID: 'card-a', filters: {internal: {}, published: {}, 'has-body': {}}},
});

describe('a find query the app seeded is searched for literally', () => {
	before(async () => {
		const backing = new Map();
		globalThis.localStorage = {
			getItem: (key) => backing.has(key) ? backing.get(key) : null,
			setItem: (key, value) => backing.set(key, String(value)),
			removeItem: (key) => backing.delete(key),
		};
		Object.defineProperty(window, 'localStorage', {value: globalThis.localStorage, configurable: true});
		findReducer = (await import('../../lib/src/reducers/find.js')).default;
		actions = await import('../../lib/src/actions.js');
		selectors = await import('../../lib/src/selectors.js');
		queryOperators = await import('../../lib/src/query-operators.js');
	});

	after(() => {
		dom.window.close();
		for (const handle of process._getActiveHandles()) {
			if (handle.constructor?.name === 'MessagePort' && typeof handle.unref === 'function') handle.unref();
		}
	});

	//The literal reading is the SAME normalization the operator parser applies
	//to the words it does not claim — lower-cased, single-spaced — so a consumer
	//needs no second code path and the two readings differ in exactly one thing.
	it('reads seeded text as words, colons and all', () => {
		assert.deepStrictEqual(queryOperators.parseQueryAsLiteralText('Type: safety'), {
			text: 'type: safety',
			filters: [],
			sort: '',
			sortReversed: false,
			set: '',
			operators: [],
		});
		assert.strictEqual(queryOperators.parseQueryAsLiteralText('the set:  of all things').text, 'the set: of all things');
		assert.strictEqual(queryOperators.parseQueryAsLiteralText('type:content').text, 'type:content');
		//The premise, stated as a test: the TYPED reading of that same string
		//really does eat the words. If this ever stops being true the fix above
		//is no longer needed — and this file should be the thing that says so.
		const typed = queryOperators.parseQueryOperators('Type: safety');
		assert.strictEqual(typed.text, 'safety', 'the premise: the operator table drops a bare head');
	});

	it('keeps a selection-seeded query literal through reducer and selector', () => {
		//This is what findCardToLink dispatches when the editor had a selection.
		const state = findReducer(undefined, {
			type: actions.FIND_CARD_TO_LINK,
			query: 'type: safety',
			cardTypeFilter: '',
			literal: true,
		});
		assert.strictEqual(state.queryIsLiteral, true);
		assert.strictEqual(state.activeQuery, 'type: safety');
		const serialized = descriptionFor(state).serialize();
		//The whole selection is in the query filter, and no card-type filter was
		//invented from the word before the colon.
		assert.ok(serialized.includes('query/type%3A+safety'),
			`the seeded text must be searched for whole (got ${serialized})`);
		assert.ok(!/\/content\//.test(serialized), 'no card-type filter from prose');
		//And the regression this pins, stated the other way: with the flag off,
		//the SAME state searches for 'safety' alone.
		const asTyped = descriptionFor({...state, queryIsLiteral: false}).serialize();
		assert.ok(asTyped.includes('query/safety'), `the premise (got ${asTyped})`);
	});

	it('does not treat a link search with no selection as literal', () => {
		//findCardToLink with an empty selection falls back to the ACTIVE
		//COLLECTION's query text, which is a query and is read as one.
		const state = findReducer(undefined, {
			type: actions.FIND_CARD_TO_LINK,
			query: 'tag:internal',
			cardTypeFilter: '',
			literal: false,
		});
		assert.strictEqual(state.queryIsLiteral, false);
		assert.ok(descriptionFor(state).serialize().includes('internal'), 'the operator still resolves');
	});

	it('gives the whole table back the moment the user edits the seeded query', () => {
		let state = findReducer(undefined, {
			type: actions.FIND_CARD_TO_LINK,
			query: 'type: safety',
			cardTypeFilter: '',
			literal: true,
		});
		//Typing changes `query` but not `activeQuery` — and must not change the
		//flag either, or the still-seeded activeQuery would spend a debounce
		//interval being read as grammar it is not.
		state = findReducer(state, {type: actions.FIND_UPDATE_QUERY, query: 'tag:internal'});
		assert.strictEqual(state.queryIsLiteral, true, 'still describing the seeded activeQuery');
		assert.strictEqual(state.activeQuery, 'type: safety');
		//Promoting the edit is where the flag clears, so the flag and the query
		//it describes can never disagree.
		state = findReducer(state, {type: actions.FIND_UPDATE_ACTIVE_QUERY});
		assert.strictEqual(state.queryIsLiteral, false);
		assert.strictEqual(state.activeQuery, 'tag:internal');
		assert.ok(descriptionFor(state).serialize().includes('internal'),
			'a typed operator resolves once the user has typed one');
	});

	//Only findCardToLink can be seeded. Every other way in either opens with the
	//active collection's own query text or with nothing.
	it('never marks the other launch modes literal', () => {
		for (const type of [actions.FIND_DIALOG_OPEN, actions.FIND_CARD_TO_PERMISSION, actions.FIND_CARD_TO_REFERENCE]) {
			const state = findReducer(undefined, {type, query: 'tag:internal', cardTypeFilter: ''});
			assert.strictEqual(state.queryIsLiteral, false, `${String(type)} must read operators`);
		}
		const configuring = findReducer(undefined, {type: actions.FIND_CARD_TO_CONFIGURE, query: 'tag:internal', requestID: 'r1'});
		assert.strictEqual(configuring.queryIsLiteral, false);
		//And closing forgets it, like everything else the dialog resets.
		const closed = findReducer(
			findReducer(undefined, {type: actions.FIND_CARD_TO_LINK, query: 'type: safety', cardTypeFilter: '', literal: true}),
			{type: actions.FIND_DIALOG_CLOSE}
		);
		assert.strictEqual(closed.queryIsLiteral, false);
	});
});

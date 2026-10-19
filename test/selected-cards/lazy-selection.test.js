/*eslint-env node, es2020*/

//THE SELECTION SELECTORS THAT RUN ON EVERY STATE CHANGE PROCESS NO CARD (#777).
//
//The multi-edit and bulk-import dialogs are always mounted, so their
//stateChanged runs on every store change with the dialogs closed, and with
//nothing selected "the selection" is the whole active collection. Reading
//that selection's CARDS processes every one of them through the lazy Proxy
//(selectCards) — on the owner's working-notes view, all ~45k on every worker
//delivery — which undid the lazy worker collection entirely. The id-based
//chain answers from the collection's ids and the Proxy's has trap.
//
//The raw cards map is wrapped so a processing read (processCard reads
//rawCards[id]) is counted; hasOwnProperty goes through the descriptor trap,
//not get, so an `in` check is not a read. Building the active collection's
//inputs (sets, filters) legitimately enumerates the raw map, so each test
//measures the reads AFTER the active collection exists.

import {JSDOM} from 'jsdom';
import assert from 'assert';
import fs from 'fs';

const dom = new JSDOM('');
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.Document = dom.window.Document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.customElements = dom.window.customElements;
globalThis.CSSStyleSheet = dom.window.CSSStyleSheet;

let selectors;
let COLLECTION_INITIAL_STATE;

const card = (id) => ({
	id, card_type: 'working-notes', title: 'Title of ' + id, body: '<p>Body</p>', tags: [],
	references: {}, references_info: {}, references_inbound: {}, references_info_inbound: {},
	auto_todo_overrides: {}, published: false, sort_order: 1.0, section: '', slugs: [], name: id,
	author: 'uid', permissions: {}, collaborators: [], font_size_boost: {}, flags: {}, images: [],
	notes: '', todo: '',
	created: {seconds: 1, nanoseconds: 0}, updated: {seconds: 1, nanoseconds: 0}, updated_substantive: {seconds: 1, nanoseconds: 0},
});

const IDS = ['a', 'b', 'c', 'd'];
//The worker's result leads with one start card; the selection is the
//matches, never the start cards (as filteredCards never held them).
const START = 'z';
const ALL = [START, ...IDS];

//A state whose active collection is served by the worker, with a raw cards
//map that counts processing reads.
const workerState = (selected = [], extras = {}) => {
	const raw = Object.fromEntries(ALL.map(id => [id, card(id)]));
	const reads = [];
	const cards = new Proxy(raw, {
		get: (target, property, receiver) => {
			if (typeof property === 'string' && Object.prototype.hasOwnProperty.call(target, property)) reads.push(property);
			return Reflect.get(target, property, receiver);
		},
	});
	const base = {
		data: {cards, tags: {}, sections: {}, authors: {}, cardMeta: {}, cardsSnapshot: cards, slugIndex: {}},
		collection: {...COLLECTION_INITIAL_STATE, selectedCards: Object.fromEntries(selected.map(id => [id, true]))},
		user: {user: null},
		multiedit: {},
		bulkImport: {},
		...extras,
	};
	const description = selectors.selectActiveCollectionDescription(base);
	const result = {description: description.serialize(), ids: ALL, labels: ALL.map(() => ''), numCards: IDS.length, numStartCards: 1, isFallback: false, preview: false, partialMatches: {}};
	const state = {...base, collection: {...base.collection, workerActiveCollection: result}};
	const collection = selectors.selectActiveCollection(state);
	if (!collection || !collection._workerIDs) throw new Error('the fixture must be a worker-served collection');
	const baseline = reads.length;
	return {state, collection, readsSince: () => reads.slice(baseline)};
};

describe('the per-state-change selection selectors are lazy', () => {

	before(async () => {
		selectors = await import('../../lib/src/selectors.js');
		COLLECTION_INITIAL_STATE = (await import('../../lib/src/filters.js')).INITIAL_STATE;
	});

	it('the fixture is a worker-served collection over the counting map', () => {
		const {state, collection, readsSince} = workerState();
		assert.deepStrictEqual(collection.finalSortedCardIDs, ALL);
		assert.strictEqual(collection.numStartCards, 1);
		assert.deepStrictEqual(readsSince(), []);
		//And the map does count a processing read.
		void selectors.selectCards(state).a;
		assert.deepStrictEqual(readsSince(), ['a']);
	});

	it('with nothing selected and the dialogs closed, the ids and counts process no card', () => {
		const {state, readsSince} = workerState();
		assert.deepStrictEqual(selectors.selectSelectedCardIDs(state), IDS);
		assert.strictEqual(selectors.selectSelectedCardsMissingCount(state), 0);
		assert.deepStrictEqual(selectors.selectMultiEditCardIDs(state), IDS);
		assert.strictEqual(selectors.selectMultiEditCardsMissingCount(state), 0);
		assert.strictEqual(selectors.selectBulkImportDialogExportContent(state), '');
		assert.strictEqual(selectors.selectActiveCollectionNotFullySelected(state), false);
		assert.deepStrictEqual(readsSince(), [], 'a per-state-change selector processed a card');
	});

	it('an explicit selection is narrowed to the cards this tab holds without processing them', () => {
		const {state, readsSince} = workerState(['b', 'missing', 'd']);
		assert.deepStrictEqual(selectors.selectSelectedCardIDs(state), ['b', 'd']);
		assert.strictEqual(selectors.selectSelectedCardsMissingCount(state), 1);
		assert.deepStrictEqual(selectors.selectMultiEditCardIDs(state), ['b', 'd']);
		assert.strictEqual(selectors.selectMultiEditCardsMissingCount(state), 1);
		assert.deepStrictEqual(readsSince(), []);
	});

	it('the multi-edit target ids are narrowed the same way', () => {
		const {state, readsSince} = workerState([], {multiedit: {targetIDs: ['c', 'missing']}});
		assert.deepStrictEqual(selectors.selectMultiEditCardIDs(state), ['c']);
		assert.strictEqual(selectors.selectMultiEditCardsMissingCount(state), 1);
		assert.deepStrictEqual(readsSince(), []);
	});

	it('the cards are derived from the ids for the callers that want them', () => {
		const {state, readsSince} = workerState();
		assert.deepStrictEqual(selectors.selectSelectedCards(state).map(c => c.id), IDS);
		assert.deepStrictEqual(selectors.selectMultiEditCards(state).map(c => c.id), IDS);
		assert.deepStrictEqual([...new Set(readsSince())].sort(), IDS);
	});

	it('the multi-edit dialog reads ids on every state change, never the cards', () => {
		const source = fs.readFileSync(new URL('../../src/components/multi-edit-dialog.ts', import.meta.url), 'utf8');
		const stateChanged = source.slice(source.indexOf('override stateChanged('));
		assert.match(stateChanged, /this\._selectedCardIDs = selectMultiEditCardIDs\(state\)/);
		const code = stateChanged.replace(/\/\/.*$/gm, '');
		assert.ok(!/selectMultiEditCards\(state\)|selectSelectedCards\(state\)|cards\[/.test(code), 'stateChanged must not process the selection\'s cards');
	});

	it('the bulk export checks open and mode before any memoized input is read', () => {
		const source = fs.readFileSync(new URL('../../src/selectors.ts', import.meta.url), 'utf8');
		const start = source.indexOf('export const selectBulkImportDialogExportContent');
		const body = source.slice(start, source.indexOf('};', start));
		assert.ok(!/createSelector/.test(body), 'a createSelector evaluates every input, selectSelectedCards included, before its own open check');
		assert.match(body, /if \(!selectBulkImportDialogOpen\(state\) \|\| selectBulKimportDialogMode\(state\) != 'export'\) return ''/);
	});
});

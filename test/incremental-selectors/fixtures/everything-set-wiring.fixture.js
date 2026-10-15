/* eslint-env node, es2022 */
//Runs in its own process: perf counters are enabled by localStorage at the
//moment perf.js first loads. Pins that the PRODUCT's everything-set selectors
//(not an inline stand-in) take the incremental update path on a one-card
//change — the main-thread half of the Save→New saving.
import {JSDOM} from 'jsdom';

const dom = new JSDOM('', {url: 'http://localhost/'});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
//selectors.js reaches lit through its imports, which touch these at load.
globalThis.Document = dom.window.Document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.customElements = dom.window.customElements;
globalThis.CSSStyleSheet = dom.window.CSSStyleSheet;
dom.window.localStorage.setItem('debug-perf', '1');

await import('../../../lib/src/perf.js');
const {selectEverythingSet} = await import('../../../lib/src/selectors.js');
const {makeEverythingSetFromCards} = await import('../../../lib/src/set-projections.js');

const makeCard = (id, sortOrder) => ({
	id, card_type: 'content', title: 'T ' + id, body: '', section: 'main', tags: [], sort_order: sortOrder,
	references: {}, references_info: {}, references_inbound: {}, references_info_inbound: {},
	star_count: 0, thread_count: 0, notes: '', todo: '', auto_todo_overrides: {}, published: true, full_bleed: false, images: [], slugs: [],
});
const counters = () => window.DEBUG_PERF.data().counters;
const stateFor = (cards) => ({data: {cards, sections: {}, tags: {}}});

const cards = Object.fromEntries(Array.from({length: 500}, (_, i) => ['c' + i, makeCard('c' + i, (i * 7919) % 1000)]));
window.DEBUG_PERF.reset();
const first = selectEverythingSet(stateFor(cards));
const next = {...cards, n1: makeCard('n1', 512.5)};
const second = selectEverythingSet(stateFor(next));
const result = {
	firstMatchesFull: JSON.stringify(first) === JSON.stringify(makeEverythingSetFromCards(cards)),
	secondMatchesFull: JSON.stringify(second) === JSON.stringify(makeEverythingSetFromCards(next)),
	recomputes: counters()['diffSelector:everythingSet:recompute'] || 0,
	updates: counters()['diffSelector:everythingSet:update'] || 0,
};
console.log(JSON.stringify(result));
process.exit(0);

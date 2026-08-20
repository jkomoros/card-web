/*eslint-env node, es2022*/

//Child-process probe for the #749 test (run with node --expose-gc): builds a
//corpus, runs a real collection through makeExtrasForFilterFunc, drops every
//app-side reference, forces GC between macrotasks (WeakRef.deref() keeps its
//target alive for the rest of the current job, so a synchronous
//drop-then-check falsely reports "reachable" — the issue documents this
//trap), and reports whether the processed cards map was collectible.
//Prints exactly 'collected' or 'retained' on the last line.

import {JSDOM} from 'jsdom';

const dom = new JSDOM('');
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.Document = dom.window.Document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.customElements = dom.window.customElements;
globalThis.CSSStyleSheet = dom.window.CSSStyleSheet;

const {CollectionDescription} = await import('../../lib/src/collection_description.js');

const card = (id) => ({
	id,
	card_type: 'content',
	title: 'Title of ' + id,
	body: '<p>Body of ' + id + '</p>',
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

const macrotask = () => new Promise(resolve => setTimeout(resolve, 0));

//Everything strong lives inside this function's frame, which dies on
//return — block scoping alone is not enough, since the frame can
//conservatively retain bindings (args.cards would keep the map alive).
const runAndRelease = () => {
	const cards = Object.fromEntries(Array.from({length: 500}, (_, i) => [`card-${i}`, card(`card-${i}`)]));
	const args = {
		cards,
		sets: {main: Object.keys(cards), everything: Object.keys(cards), 'reading-list': []},
		//A configurable filter forces the extras path through
		//makeExtrasForFilterFunc — the memo under test.
		filters: {starred: {}, read: {}},
		sections: {},
		fallbacks: {},
		startCards: {},
		cardSimilarity: {},
	};
	const description = new CollectionDescription('everything', ['has-body']);
	const collection = description.collection(args);
	//Materialize, so the run actually happened.
	if (collection.finalSortedCards.length !== 500) {
		console.log('probe-broken');
		process.exit(1);
	}
	return new WeakRef(cards);
};

const weakCards = runAndRelease();

//GC between macrotasks, twice, per the issue's documented methodology.
await macrotask();
globalThis.gc();
await macrotask();
globalThis.gc();
await macrotask();

console.log(weakCards.deref() === undefined ? 'collected' : 'retained');

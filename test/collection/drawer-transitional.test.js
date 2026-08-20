/*eslint-env node, es2020*/

//Pins the #762 fix: the cutover-mode transitional placeholder (description
//changed, worker result not yet arrived) must not be treated as an
//authoritative collection. Its isFallback: false is a guess, and the drawer
//selector acting on it made the drawer flash in during the navigation that
//creating a working-notes card performs. The drawer decision now holds its
//previous collection-state verdict while the collection is transitional.

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
let Collection;
let computeCardsDrawerPanelShowing;

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

const makeArgs = (cards) => ({
	cards,
	sets: {main: Object.keys(cards), 'reading-list': [], everything: Object.keys(cards)},
	filters: {},
	sections: {},
	fallbacks: {},
	startCards: {},
});

const workerResult = (description, overrides) => ({
	description: description.serialize(),
	ids: [],
	labels: [],
	numCards: 0,
	numStartCards: 0,
	isFallback: false,
	preview: false,
	partialMatches: {},
	...overrides,
});

describe('transitional placeholder collections (#762)', () => {
	before(async () => {
		({CollectionDescription, Collection} = await import('../../lib/src/collection_description.js'));
		({computeCardsDrawerPanelShowing} = await import('../../lib/src/selectors.js'));
	});

	after(() => {
		dom.window.close();
		//Importing selectors pulls in Firebase's Node transport, which keeps a
		//MessagePort referenced even though this suite never uses it. Unref it
		//so the full npm test chain exits (same as test/reducers).
		for (const handle of process._getActiveHandles()) {
			if (handle.constructor?.name === 'MessagePort' && typeof handle.unref === 'function') handle.unref();
		}
	});

	it('fromWorkerResult carries the transitional flag, defaulting off', () => {
		const cards = {a: card('a')};
		const description = new CollectionDescription('everything', []);
		const args = makeArgs(cards);
		const placeholder = Collection.fromWorkerResult(description, args, workerResult(description, {transitional: true}));
		assert.strictEqual(placeholder.isTransitional, true);
		const real = Collection.fromWorkerResult(description, args, workerResult(description, {ids: ['a'], numCards: 1}));
		assert.strictEqual(real.isTransitional, false);
	});

	it('the drawer holds its previous verdict across a transitional placeholder', () => {
		const cards = {a: card('a')};
		const description = new CollectionDescription('everything', []);
		const args = makeArgs(cards);
		//The #762 sequence: viewing an orphaned card, so the authoritative
		//collection is a fallback and (data fully loaded) the drawer hides.
		const fallback = Collection.fromWorkerResult(description, args, workerResult(description, {isFallback: true}));
		let [showing, verdict] = computeCardsDrawerPanelShowing(fallback, true, false, false, true, null);
		assert.strictEqual(showing, false);
		//Cmd-Shift-M navigates; the placeholder claims isFallback: false. The
		//drawer must NOT flash in on that lie — it holds the previous verdict.
		const placeholder = Collection.fromWorkerResult(description, args, workerResult(description, {transitional: true}));
		[showing, verdict] = computeCardsDrawerPanelShowing(placeholder, true, false, false, true, verdict);
		assert.strictEqual(showing, false, 'drawer must not flash in on a transitional placeholder');
		//The worker's real result (another fallback) keeps it hidden.
		const nextFallback = Collection.fromWorkerResult(description, args, workerResult(description, {isFallback: true}));
		[showing, verdict] = computeCardsDrawerPanelShowing(nextFallback, true, false, false, true, verdict);
		assert.strictEqual(showing, false);
	});

	it('a transitional placeholder also holds a previous SHOWING verdict', () => {
		const cards = {a: card('a')};
		const description = new CollectionDescription('everything', []);
		const args = makeArgs(cards);
		const real = Collection.fromWorkerResult(description, args, workerResult(description, {ids: ['a'], numCards: 1}));
		let [showing, verdict] = computeCardsDrawerPanelShowing(real, true, false, false, true, null);
		assert.strictEqual(showing, true);
		const placeholder = Collection.fromWorkerResult(description, args, workerResult(description, {transitional: true}));
		[showing, verdict] = computeCardsDrawerPanelShowing(placeholder, true, false, false, true, verdict);
		assert.strictEqual(showing, true, 'a normal collection must not lose its drawer during a transition');
	});

	it('boot (no verdict yet) defaults to showing, matching the deliberate boot behavior', () => {
		const cards = {a: card('a')};
		const description = new CollectionDescription('everything', []);
		const args = makeArgs(cards);
		const placeholder = Collection.fromWorkerResult(description, args, workerResult(description, {transitional: true}));
		const [showing] = computeCardsDrawerPanelShowing(placeholder, true, false, false, false, null);
		assert.strictEqual(showing, true);
	});

	it('a re-boot window (data not fully loaded) beats a stale held verdict', () => {
		//A verdict recorded under a previous auth scope (e.g. hidden on an
		//orphan card, then sign-out) must not hide the drawer during the next
		//boot's loading window — the boot rule deliberately holds the drawer
		//visible while data arrives.
		const cards = {a: card('a')};
		const description = new CollectionDescription('everything', []);
		const args = makeArgs(cards);
		const placeholder = Collection.fromWorkerResult(description, args, workerResult(description, {transitional: true}));
		const [showing] = computeCardsDrawerPanelShowing(placeholder, true, false, false, false, false);
		assert.strictEqual(showing, true);
	});

	it('panel/editor rules stay live during a transition', () => {
		const cards = {a: card('a')};
		const description = new CollectionDescription('everything', []);
		const args = makeArgs(cards);
		const placeholder = Collection.fromWorkerResult(description, args, workerResult(description, {transitional: true}));
		//Editing with a minimized editor always hides, transition or not.
		assert.strictEqual(computeCardsDrawerPanelShowing(placeholder, true, true, true, true, true)[0], false);
		//A closed panel always hides.
		assert.strictEqual(computeCardsDrawerPanelShowing(placeholder, false, false, false, true, true)[0], false);
	});
});

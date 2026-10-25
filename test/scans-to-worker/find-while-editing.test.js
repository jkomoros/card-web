/*eslint-env node, es2022*/

//THE FIND DIALOG HOLDS A WORKER RESULT WHILE EDITING (#777 step 2). The
//bridge has two readers of "which query description to serve": the periodic
//subscription pass and the per-dispatch fast resubscribe. The first cut
//changed only the first, so every push the worker made while editing was
//unsubscribed and nulled by the very dispatch that delivered it, and a
//second later the slot was subscribed again — the review's find. Driven
//through the real bridge against a fake worker.

import assert from 'assert';
import {JSDOM} from 'jsdom';

const dom = new JSDOM('', {url: 'https://example.com/c/main/a'});
for (const name of [
	'window', 'document', 'Document', 'HTMLElement', 'Element', 'Node',
	'customElements', 'CSSStyleSheet', 'Event', 'CustomEvent', 'MouseEvent',
	'InputEvent', 'KeyboardEvent', 'ShadowRoot', 'HTMLInputElement',
	'HTMLButtonElement', 'HTMLSelectElement', 'HTMLTextAreaElement', 'HTMLSlotElement',
	'navigator', 'getComputedStyle', 'MutationObserver', 'requestAnimationFrame',
	'DocumentFragment', 'HTMLImageElement', 'HTMLAnchorElement',
]) globalThis[name] = name === 'window' ? dom.window : name === 'document' ? dom.window.document : dom.window[name];
globalThis.location = dom.window.location;
globalThis.history = dom.window.history;
globalThis.BroadcastChannel = class { addEventListener() {} removeEventListener() {} postMessage() {} close() {} };

class FakeWorker {
	static current;
	constructor() {
		this.sent = [];
		this.listeners = new Map();
		FakeWorker.current = this;
	}
	postMessage(message) { this.sent.push(message); }
	addEventListener(type, listener) { this.listeners.set(type, listener); }
	terminate() {}
	deliver(message) { this.listeners.get('message')?.({data: message}); }
	ofType(type) { return this.sent.filter(message => message.type === type); }
}
globalThis.Worker = FakeWorker;

describe('the find dialog is served by the worker while editing', () => {
	let store;
	let bridge;
	let generation;
	const card = {id: 'a', name: 'a', card_type: 'content', section: 'main', title: 'zebra', body: '<p>zebra</p>', tags: [], published: true, sort_order: 2, references: {}, references_info: {}, references_inbound: {}, references_info_inbound: {}, auto_todo_overrides: {}};
	const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

	before(async () => {
		({store} = await import('../../lib/src/store.js'));
		const [{default: app}, {default: data}, {default: collection}] = await Promise.all([
			import('../../lib/src/reducers/app.js'), import('../../lib/src/reducers/data.js'), import('../../lib/src/reducers/collection.js'),
		]);
		const initial = {...store.getState(), collection: collection(undefined, {type: '@@INIT'})};
		store.replaceReducer((state = initial, action) => {
			if (action.type === 'TEST_PATCH') return {...state, ...action.changes};
			return {...state, app: app(state.app, action), data: data(state.data, action), collection: collection(state.collection, action)};
		});
		store.dispatch({type: 'TEST_PATCH', changes: {
			data: {...initial.data, cards: {a: card, b: {...card, id: 'b', name: 'b'}}},
			collection: {...initial.collection, activeCardID: 'a'},
			//Editing, with the find dialog open on a query: the case the
			//bridge used to keep local.
			editor: {editing: true, card},
			find: {open: true, activeQuery: 'zebra', queryIsLiteral: false},
		}});
		bridge = await import('../../lib/src/corpus-bridge.js');
		bridge.corpusWorkerConnectCards(false, '');
		const connect = FakeWorker.current.ofType('connect').at(-1);
		assert.ok(connect, 'the real bridge connects');
		generation = connect.generation;
		FakeWorker.current.deliver({type: 'loadComplete', generation, corpusSize: 2, snapshotAgeMs: 0});
		assert.ok(bridge.corpusWorkerCanRunCollections());
	});

	it('subscribes the query slot once and keeps the push across later dispatches', async () => {
		const worker = FakeWorker.current;
		//The periodic pass subscribes within its interval.
		await sleep(1100);
		const subscription = worker.ofType('subscribeCollection').filter(message => message.description.includes('query')).at(-1);
		assert.ok(subscription, 'the query slot is subscribed while editing');
		worker.deliver({type: 'collectionResult', generation, subscriptionID: subscription.subscriptionID, ids: ['b'], labels: [''], numCards: 1, numStartCards: 0, isFallback: false, preview: false, partialMatches: {}, ms: 1});
		assert.deepStrictEqual(store.getState().collection.workerQueryCollection?.ids, ['b'], 'the push lands');
		//The per-dispatch fast path must not unsubscribe it.
		store.dispatch({type: 'UNRELATED_ACTION'});
		assert.deepStrictEqual(store.getState().collection.workerQueryCollection?.ids, ['b'], 'the result survives the next dispatch');
		await sleep(1100);
		assert.deepStrictEqual(store.getState().collection.workerQueryCollection?.ids, ['b'], 'and the next periodic pass');
		assert.strictEqual(worker.ofType('unsubscribeCollection').length, 0, 'nothing unsubscribed the slot');
		assert.strictEqual(worker.ofType('subscribeCollection').filter(message => message.description.includes('query')).length, 1, 'subscribed exactly once');
	});
});

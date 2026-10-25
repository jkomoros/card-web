/*eslint-env node, es2022*/

//THE INFO PANEL'S ACCOUNT, DRIVEN THROUGH THE REAL PANEL AND BRIDGE against
//a fake worker (#777 step 2). What the source pins cannot show: that a
//reply dropped because the user had moved on is asked for again when they
//come back (navigation does not change the active collection's identity,
//so the de-duplication alone would have held the panel without an account
//until the next push — the third review pass's find), that a request in
//flight is not duplicated, and that a reply contradicting the collection
//on screen is withdrawn.

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

const tick = () => new Promise(resolve => setTimeout(resolve, 5));

describe('the info panel asks the worker for the account', () => {
	let store;
	let patch;
	let generation;
	let selectors;
	let panel;
	let workerResult;
	const card = {id: 'a', name: 'a', card_type: 'content', section: 'main', title: 'zebra', body: '<p>zebra</p>', tags: [], published: true, sort_order: 2, references: {}, references_info: {}, references_inbound: {}, references_info_inbound: {}, auto_todo_overrides: {}};
	const requests = () => FakeWorker.current.ofType('collectionMembership');
	const reply = (request, membership, failed = false) => {
		FakeWorker.current.deliver({type: 'collectionMembershipResult', generation, id: request.id, membership, ms: 1, failed});
		return tick();
	};
	const account = (passes) => ({conditions: [{passes, members: []}], setPasses: true, failingConditions: passes ? 0 : 1, passes});
	const navigate = (cardID) => patch({collection: {...store.getState().collection, activeCardID: cardID}});

	before(async () => {
		({store} = await import('../../lib/src/store.js'));
		const [{default: app}, {default: data}, {default: collection}, {default: user}] = await Promise.all([
			import('../../lib/src/reducers/app.js'), import('../../lib/src/reducers/data.js'), import('../../lib/src/reducers/collection.js'), import('../../lib/src/reducers/user.js'),
		]);
		const initial = {...store.getState(), collection: collection(undefined, {type: '@@INIT'}), user: store.getState().user || user(undefined, {type: '@@INIT'})};
		store.replaceReducer((state = initial, action) => {
			if (action.type === 'TEST_PATCH') return {...state, ...action.changes};
			return {...state, app: app(state.app, action), data: data(state.data, action), collection: collection(state.collection, action)};
		});
		patch = changes => store.dispatch({type: 'TEST_PATCH', changes});
		patch({data: {...initial.data, cards: {a: card, b: {...card, id: 'b', name: 'b'}}}, collection: {...initial.collection, activeCardID: 'a'}, editor: {editing: false}, user: initial.user});
		const bridge = await import('../../lib/src/corpus-bridge.js');
		bridge.corpusWorkerConnectCards(false, '');
		const connect = FakeWorker.current.ofType('connect').at(-1);
		generation = connect.generation;
		FakeWorker.current.deliver({type: 'loadComplete', generation, corpusSize: 2, snapshotAgeMs: 0});
		assert.ok(bridge.corpusWorkerCanRunCollections());
		const {CollectionDescription} = await import('../../lib/src/collection_description.js');
		selectors = await import('../../lib/src/selectors.js');
		const description = CollectionDescription.deserialize('everything/query/zebra/');
		workerResult = {description: description.serialize(), ids: ['a', 'b'], labels: ['', ''], numCards: 2, numStartCards: 0, isFallback: false, preview: false, partialMatches: {}};
		patch({collection: {...store.getState().collection, active: description.configuration, workerActiveCollection: workerResult, activeCardID: 'a'}});
		await import('../../lib/src/components/card-info-panel.js');
		panel = document.createElement('card-info-panel');
		panel._open = true;
	});

	it('asks once per (card, collection), and asks again after a reply that could not commit', async () => {
		const collection = selectors.selectActiveCollection(store.getState());
		panel._requestWhyHere(store.getState(), 'a');
		assert.strictEqual(requests().length, 1, 'one request for a');
		//In flight: the debounce fires again, nothing new is asked.
		panel._requestWhyHere(store.getState(), 'a');
		assert.strictEqual(requests().length, 1, 'no duplicate while in flight');
		//The user moves to b before the reply lands: the reply is dropped.
		navigate('b');
		await reply(requests().at(-1), account(true));
		assert.strictEqual(panel._whyHereForCardID, '', 'a reply for a card no longer active does not commit');
		//Back to a, same collection object: the panel must ask again.
		navigate('a');
		assert.strictEqual(selectors.selectActiveCollection(store.getState()), collection, 'navigation leaves the collection identity alone');
		panel._requestWhyHere(store.getState(), 'a');
		assert.strictEqual(requests().length, 2, 'asked again for a');
		await reply(requests().at(-1), account(true));
		assert.strictEqual(panel._whyHereForCardID, 'a');
		assert.strictEqual(panel._whyHereMembership?.passes, true);
		//Committed: the next fire for the same inputs asks nothing.
		panel._requestWhyHere(store.getState(), 'a');
		assert.strictEqual(requests().length, 2);
	});

	it('asks again after a failed reply', async () => {
		//A new collection object, so the previous commit does not apply.
		patch({collection: {...store.getState().collection, workerActiveCollection: {...workerResult}}});
		const before = requests().length;
		panel._requestWhyHere(store.getState(), 'a');
		assert.strictEqual(requests().length, before + 1);
		await reply(requests().at(-1), null, true);
		panel._requestWhyHere(store.getState(), 'a');
		assert.strictEqual(requests().length, before + 2, 'a failure releases the request');
	});

	it('withdraws an account that contradicts the collection on screen', async () => {
		patch({collection: {...store.getState().collection, workerActiveCollection: {...workerResult}}});
		panel._requestWhyHere(store.getState(), 'a');
		//The worker judged a fresher corpus and says a does not match; the
		//rendered collection lists a.
		await reply(requests().at(-1), account(false));
		assert.strictEqual(panel._whyHereForCardID, 'a');
		assert.strictEqual(panel._whyHereMembership, null, 'the contradiction is withdrawn, not published');
	});
});

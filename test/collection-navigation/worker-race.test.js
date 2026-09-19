/*eslint-env node, es2022*/

import assert from 'assert';
import {JSDOM} from 'jsdom';

const dom = new JSDOM('', {url: 'https://example.com/c/everything/working-notes/sort/recent/old-note'});
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
	last(type) { return this.sent.filter(message => message.type === type).at(-1); }
}
globalThis.Worker = FakeWorker;

describe('new card navigation waits for the real worker answer', () => {
	let store;
	let navigateToNewCard;
	let bridge;
	let initial;
	let generation;
	const description = 'everything/working-notes/sort/recent/';
	const oldPath = '/c/everything/working-notes/sort/recent/old-note';
	const newPath = '/c/everything/working-notes/sort/recent/new-note';
	const newCard = {
		id: 'new-note', name: 'new-note', card_type: 'working-notes',
		section: '', title: 'New note', body: '<p>Draft</p>', tags: [],
		published: false, sort_order: 2, references: {}, references_info: {},
		references_inbound: {}, references_info_inbound: {}, auto_todo_overrides: {},
	};
	const oldCard = {...newCard, id: 'old-note', name: 'old-note', sort_order: 1};

	const patch = changes => store.dispatch({type: 'TEST_PATCH', changes});
	const reset = () => {
		window.history.replaceState({}, '', oldPath);
		patch({
			app: {...initial.app, page: 'c', pageExtra: oldPath.slice(3)},
			data: {...initial.data, cards: {'old-note': oldCard, 'new-note': newCard}, pendingNewCardIDToNavigateTo: 'new-note'},
			collection: {
				...initial.collection,
				active: {setName: 'everything', filterNames: ['working-notes'], sortName: 'recent', sortReversed: false, viewMode: 'list', viewModeExtra: ''},
				activeCardID: 'old-note', requestedCard: 'old-note',
				workerActiveCollection: {description, ids: ['old-note'], labels: [], numCards: 1, numStartCards: 1, isFallback: false, preview: false, partialMatches: {}},
			},
		});
	};
	const answer = (ids, failed = false) => {
		const request = FakeWorker.current.last('runCollection');
		assert.ok(request, 'real bridge must issue the collection RPC');
		FakeWorker.current.deliver({type: 'runCollectionResult', generation, id: request.id, failed,
			ids, labels: [], numCards: ids.length, numStartCards: ids.length,
			isFallback: false, preview: false, partialMatches: {}, ms: 1});
	};

	before(async () => {
		({store} = await import('../../lib/src/store.js'));
		const [{default: app}, {default: data}, {default: collection}] = await Promise.all([
			import('../../lib/src/reducers/app.js'), import('../../lib/src/reducers/data.js'), import('../../lib/src/reducers/collection.js'),
		]);
		initial = {...store.getState(), collection: collection(undefined, {type: '@@INIT'})};
		store.replaceReducer((state = initial, action) => {
			if (action.type === 'TEST_PATCH') return {...state, ...action.changes};
			return {...state, app: app(state.app, action), data: data(state.data, action), collection: collection(state.collection, action)};
		});
		({navigateToNewCard} = await import('../../lib/src/actions/data.js'));
		bridge = await import('../../lib/src/corpus-bridge.js');
		reset();
		bridge.corpusWorkerConnectCards(false, '');
		const connect = FakeWorker.current.last('connect');
		assert.ok(connect, 'reader connection starts the actual bridge');
		generation = connect.generation;
		FakeWorker.current.deliver({type: 'loadComplete', generation, corpusSize: 2, snapshotAgeMs: 0});
		assert.ok(bridge.corpusWorkerCanRunCollections());
	});

	beforeEach(() => reset());

	it('holds the collection route past the former 150ms grace, then navigates on membership', async () => {
		const navigation = store.dispatch(navigateToNewCard());
		await new Promise(resolve => setTimeout(resolve, 180));
		assert.strictEqual(window.location.pathname, oldPath);
		answer(['new-note', 'old-note']);
		await navigation;
		assert.strictEqual(window.location.pathname, newPath);
	});

	it('uses an authoritative exclusion to choose the card default route', async () => {
		const navigation = store.dispatch(navigateToNewCard());
		answer(['old-note']);
		await navigation;
		assert.strictEqual(window.location.pathname, '/c/new-note');
	});

	it('does not route from a failed worker run', async () => {
		const navigation = store.dispatch(navigateToNewCard());
		answer([], true);
		await navigation;
		assert.strictEqual(window.location.pathname, oldPath);
	});

	it('cancels when the collection changes while the card stays selected', async () => {
		const navigation = store.dispatch(navigateToNewCard());
		patch({collection: {...store.getState().collection,
			active: {setName: 'everything', filterNames: ['working-notes', 'unpublished'], sortName: 'recent', sortReversed: false, viewMode: 'list', viewModeExtra: ''}}});
		answer(['new-note']);
		await navigation;
		assert.strictEqual(window.location.pathname, oldPath);
	});

	it('deduplicates two navigation attempts for the same pending card', async () => {
		const before = FakeWorker.current.sent.filter(message => message.type === 'runCollection').length;
		const first = store.dispatch(navigateToNewCard());
		const second = store.dispatch(navigateToNewCard());
		assert.strictEqual(FakeWorker.current.sent.filter(message => message.type === 'runCollection').length, before + 1);
		answer(['new-note', 'old-note']);
		await Promise.all([first, second]);
		assert.strictEqual(window.location.pathname, newPath);
	});

	it('does not revive navigation after a collection change away and back', async () => {
		const navigation = store.dispatch(navigateToNewCard());
		const original = store.getState().collection;
		patch({collection: {...original,
			active: {setName: 'everything', filterNames: ['working-notes', 'unpublished'], sortName: 'recent', sortReversed: false, viewMode: 'list', viewModeExtra: ''}}});
		patch({collection: {...store.getState().collection, active: original.active}});
		assert.strictEqual(store.getState().collection.activeCardID, 'old-note');
		assert.strictEqual(store.getState().collection.active.filterNames.length, 1);
		answer(['new-note', 'old-note']);
		await navigation;
		assert.strictEqual(window.location.pathname, oldPath);
	});

	it('leaves a newer pending card alone when the older run finishes', async () => {
		const navigation = store.dispatch(navigateToNewCard());
		patch({data: {...store.getState().data, pendingNewCardIDToNavigateTo: 'next-note'}});
		answer(['new-note', 'old-note']);
		await navigation;
		assert.strictEqual(store.getState().data.pendingNewCardIDToNavigateTo, 'next-note');
		assert.strictEqual(window.location.pathname, oldPath);
	});
});

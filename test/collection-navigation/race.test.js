/*eslint-env node, es2022*/

import assert from 'assert';
import {JSDOM} from 'jsdom';

const dom = new JSDOM('', {url: 'https://example.com/c/everything/working-notes/unpublished/sort/recent/new-note'});
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

describe('new working note collection race', () => {
	let canonicalizeURL;
	let render;
	let store;
	let initialState;
	let CollectionDescription;

	before(async () => {
		({store} = await import('../../lib/src/store.js'));
		await import('../../lib/src/components/main-view.js');
		await import('../../lib/src/components/card-view.js');
		({canonicalizeURL} = await import('../../lib/src/actions/collection.js'));
		({render} = await import('lit'));
		({CollectionDescription} = await import('../../lib/src/collection_description.js'));
		initialState = store.getState();
	});

	const card = {
		id: 'new-note', name: 'new-note', card_type: 'working-notes',
		section: '', title: 'New note', body: '<p>Draft</p>', tags: [],
		published: false, sort_order: 1, references: {}, references_info: {},
		references_inbound: {}, references_info_inbound: {}, auto_todo_overrides: {},
	};

	it('keeps collection intent while an orphaned card is absent from the worker result', () => {
		const state = {
			...initialState,
			app: {...initialState.app, page: 'c', pageExtra: 'everything/working-notes/unpublished/sort/recent/new-note'},
			data: {...initialState.data, cards: {'new-note': card}},
			collection: {
				...initialState.collection,
				active: {setName: 'everything', filterNames: ['working-notes', 'unpublished'], sortName: 'recent', sortReversed: false, viewMode: 'list', viewModeExtra: ''},
				activeCardID: 'new-note', requestedCard: 'new-note',
				workerActiveCollection: {description: 'everything/working-notes/unpublished/sort/recent/', ids: [], labels: [], numCards: 0, numStartCards: 0, isFallback: false, preview: false, partialMatches: {}},
			},
		};
		//Run the real action and nested navigation thunk against a frozen Redux
		//snapshot. The browser history call is the production navigation seam.
		const dispatch = action => typeof action === 'function' ? action(dispatch, () => state) : action;
		window.history.replaceState({}, '', '/c/everything/working-notes/unpublished/sort/recent/new-note');
		canonicalizeURL()(dispatch, () => state);
		assert.strictEqual(window.location.pathname, '/c/everything/working-notes/unpublished/sort/recent/new-note');
	});

	const renderEmptyState = async ({editing = false, displayCard = null, pendingSave = false, requestedCard = '_'} = {}) => {
		const view = document.createElement('card-view');
		view._editing = editing;
		view._card = displayCard;
		view._editingCard = editing ? displayCard : null;
		view._displayCard = displayCard;
		view._displayCardPendingSave = pendingSave;
		view._dataIsFullyLoaded = true;
		view._collectionPending = false;
		view._collectionUpdating = false;
		view._collectionFailureMessage = '';
		view._suggestionsForCard = [];
		view._cardTodos = [];
		view._collection = {finalSortedCards: [], description: new CollectionDescription('everything', ['working-notes'], 'recent', false)};
		view._pageExtra = `everything/working-notes/sort/recent/${requestedCard}`;
		view._requestedCard = requestedCard;
		const container = document.createElement('div');
		render(view.render(), container);
		await Promise.resolve();
		return container;
	};

	it('keeps the live editor visible under a ready empty collection result', async () => {
		const result = await renderEmptyState({editing: true, displayCard: card, requestedCard: 'new-note'});
		assert.strictEqual(result.querySelector('card-stage').cardHidden, false);
		assert.strictEqual(result.querySelector('.collection-empty'), null);
	});

	it('keeps an explicitly requested card visible', async () => {
		const result = await renderEmptyState({displayCard: card, requestedCard: 'new-note'});
		assert.strictEqual(result.querySelector('card-stage').cardHidden, false);
		assert.strictEqual(result.querySelector('.collection-empty'), null);
	});

	it('keeps a committed pending-save card visible', async () => {
		const result = await renderEmptyState({displayCard: card, pendingSave: true});
		assert.strictEqual(result.querySelector('card-stage').cardHidden, false);
		assert.strictEqual(result.querySelector('.collection-empty'), null);
	});

	it('shows the empty state for a genuinely empty placeholder collection', async () => {
		const result = await renderEmptyState();
		assert.strictEqual(result.querySelector('card-stage').cardHidden, true);
		assert.ok(result.querySelector('.collection-empty'));
	});
});

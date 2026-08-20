/*eslint-env node*/

//Pins the per-card pending-modification tracking from #763: a save in
//flight blocks editing affordances only for the cards it targets, so
//opening an editor on a different card (the rapid create-while-saving
//workflow) is not refused. Also pins the fail-closed fallback: a pending
//modification with no recorded targets blocks every card, matching the old
//global behavior.

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

let dataReducer;
let actions;
let selectors;

describe('per-card pending modification tracking (#763)', () => {
	before(async () => {
		dataReducer = (await import('../../lib/src/reducers/data.js')).default;
		actions = await import('../../lib/src/actions.js');
		selectors = await import('../../lib/src/selectors.js');
	});

	after(() => {
		dom.window.close();
		//Importing selectors pulls in Firebase's Node transport, which keeps
		//a MessagePort referenced even though this suite never uses it. Unref
		//only that transport handle so the full npm test chain exits. Same
		//workaround as test/reducers/test.js.
		for (const handle of process._getActiveHandles()) {
			if (handle.constructor?.name === 'MessagePort' && typeof handle.unref === 'function') handle.unref();
		}
	});

	const stateFor = (dataState) => ({data: dataState});

	it('blocks only the cards a modification targets', () => {
		const data = dataReducer(undefined, {type: actions.MODIFY_CARD, modificationCount: 1, cardIDs: ['card-a']});
		const state = stateFor(data);
		assert.strictEqual(selectors.selectCardModificationPending(state), true);
		assert.strictEqual(selectors.selectCardModificationPendingForCard(state, 'card-a'), true);
		//The load-bearing assertion: a DIFFERENT card is not blocked, so a
		//new editor session can open during the first card's server round
		//trip.
		assert.strictEqual(selectors.selectCardModificationPendingForCard(state, 'card-b'), false);
	});

	it('tracks every target of a bulk operation', () => {
		const ids = ['card-a', 'card-b', 'card-c'];
		const data = dataReducer(undefined, {type: actions.MODIFY_CARD, modificationCount: ids.length, cardIDs: ids});
		const state = stateFor(data);
		for (const id of ids) {
			assert.strictEqual(selectors.selectCardModificationPendingForCard(state, id), true);
		}
		assert.strictEqual(selectors.selectCardModificationPendingForCard(state, 'card-d'), false);
	});

	it('falls back to blocking every card when a pending modification has no recorded targets', () => {
		//A dispatch shape that omits targets must fail closed (the old
		//global behavior), not silently allow overlapping sessions.
		const data = dataReducer(undefined, {type: actions.MODIFY_CARD, modificationCount: 2, cardIDs: []});
		const state = stateFor(data);
		assert.strictEqual(selectors.selectCardModificationPending(state), true);
		assert.strictEqual(selectors.selectCardModificationPendingForCard(state, 'anything'), true);
	});

	it('clears the per-card set on success', () => {
		let data = dataReducer(undefined, {type: actions.MODIFY_CARD, modificationCount: 1, cardIDs: ['card-a']});
		data = dataReducer(data, {type: actions.MODIFY_CARD_SUCCESS, modificationCount: 1});
		const state = stateFor(data);
		assert.strictEqual(selectors.selectCardModificationPending(state), false);
		assert.strictEqual(selectors.selectCardModificationPendingForCard(state, 'card-a'), false);
		assert.deepStrictEqual(data.pendingModificationCardIDs, {});
	});

	it('clears the per-card set on failure', () => {
		let data = dataReducer(undefined, {type: actions.MODIFY_CARD, modificationCount: 1, cardIDs: ['card-a']});
		data = dataReducer(data, {type: actions.MODIFY_CARD_FAILURE, error: new Error('boom')});
		const state = stateFor(data);
		assert.strictEqual(selectors.selectCardModificationPending(state), false);
		assert.strictEqual(selectors.selectCardModificationPendingForCard(state, 'card-a'), false);
		assert.deepStrictEqual(data.pendingModificationCardIDs, {});
	});

	it('a fresh modification replaces the previous target set', () => {
		let data = dataReducer(undefined, {type: actions.MODIFY_CARD, modificationCount: 1, cardIDs: ['card-a']});
		data = dataReducer(data, {type: actions.MODIFY_CARD_SUCCESS, modificationCount: 1});
		data = dataReducer(data, {type: actions.MODIFY_CARD, modificationCount: 1, cardIDs: ['card-b']});
		const state = stateFor(data);
		assert.strictEqual(selectors.selectCardModificationPendingForCard(state, 'card-a'), false);
		assert.strictEqual(selectors.selectCardModificationPendingForCard(state, 'card-b'), true);
	});

	it('a legacy dispatch with no cardIDs at all fails closed', () => {
		const data = dataReducer(undefined, {type: actions.MODIFY_CARD, modificationCount: 1});
		const state = stateFor(data);
		assert.strictEqual(selectors.selectCardModificationPendingForCard(state, 'anything'), true);
	});
});

describe('per-card durable mutation pending (#763)', () => {
	const BULK_KEY = 'card-web-pending-bulk-tag-operation-v1';
	const MULTI_KEY = 'card-web-pending-multi-edit-v1';

	let dataActions;

	before(async () => {
		//A plain shim: this suite's JSDOM has no origin, so its localStorage
		//getter throws. The durable helpers only need the Storage surface.
		const backing = new Map();
		globalThis.localStorage = {
			getItem: (key) => backing.has(key) ? backing.get(key) : null,
			setItem: (key, value) => backing.set(key, String(value)),
			removeItem: (key) => backing.delete(key),
			clear: () => backing.clear(),
		};
		dataActions = await import('../../lib/src/actions/data.js');
	});

	beforeEach(() => {
		localStorage.removeItem(BULK_KEY);
		localStorage.removeItem(MULTI_KEY);
	});

	const bulkRecord = (targetIDs, extras) => JSON.stringify({
		version: 1,
		id: 'bulk-tag-1-abc',
		uid: 'user-1',
		tag: 'weekly',
		adding: true,
		targetIDs,
		nextIndex: 0,
		...extras,
	});

	const multiRecord = (targetIDs, extras) => JSON.stringify({
		version: 1,
		id: 'single-edit-1-abc',
		uid: 'user-1',
		targetIDs,
		nextIndex: 0,
		modifiedCount: 0,
		update: {},
		substantive: false,
		kind: 'single',
		baseFields: {},
		...extras,
	});

	it('no records pending: no card is blocked', () => {
		assert.strictEqual(dataActions.durableCardMutationPendingForCard('card-a'), false);
	});

	it('a readable record blocks exactly its targets', () => {
		localStorage.setItem(MULTI_KEY, multiRecord(['card-a']));
		assert.strictEqual(dataActions.durableCardMutationPending(), true);
		assert.strictEqual(dataActions.durableCardMutationPendingForCard('card-a'), true);
		//The load-bearing assertion: the durable half must not block OTHER
		//cards either.
		assert.strictEqual(dataActions.durableCardMutationPendingForCard('card-b'), false);
	});

	it('bulk-tag records block their targets too', () => {
		localStorage.setItem(BULK_KEY, bulkRecord(['card-x', 'card-y']));
		assert.strictEqual(dataActions.durableCardMutationPendingForCard('card-x'), true);
		assert.strictEqual(dataActions.durableCardMutationPendingForCard('card-z'), false);
	});

	it('an unreadable record fails closed for every card', () => {
		localStorage.setItem(MULTI_KEY, '{corrupt json');
		assert.strictEqual(dataActions.durableCardMutationPendingForCard('anything'), true);
	});

	it('clearing the record unblocks (and does not serve a stale cache)', () => {
		localStorage.setItem(MULTI_KEY, multiRecord(['card-a']));
		assert.strictEqual(dataActions.durableCardMutationPendingForCard('card-a'), true);
		localStorage.removeItem(MULTI_KEY);
		assert.strictEqual(dataActions.durableCardMutationPendingForCard('card-a'), false);
	});

	it('per-chunk progress rewrites of the same operation stay correct', () => {
		//Operations are immutable per id; only progress fields change. The
		//cache's same-op fast path must keep answering correctly across the
		//rewrite, and a NEW operation id must not reuse the old target set.
		localStorage.setItem(MULTI_KEY, multiRecord(['card-a', 'card-b']));
		assert.strictEqual(dataActions.durableCardMutationPendingForCard('card-a'), true);
		localStorage.setItem(MULTI_KEY, multiRecord(['card-a', 'card-b'], {nextIndex: 1, modifiedCount: 1}));
		assert.strictEqual(dataActions.durableCardMutationPendingForCard('card-b'), true);
		assert.strictEqual(dataActions.durableCardMutationPendingForCard('card-c'), false);
		localStorage.setItem(MULTI_KEY, JSON.stringify({...JSON.parse(multiRecord(['card-z'])), id: 'single-edit-2-def'}));
		assert.strictEqual(dataActions.durableCardMutationPendingForCard('card-z'), true);
		assert.strictEqual(dataActions.durableCardMutationPendingForCard('card-a'), false);
	});
});

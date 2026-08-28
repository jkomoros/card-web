/*eslint-env node, es2022*/

import { JSDOM } from 'jsdom';
import assert from 'assert';

const dom = new JSDOM('');
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.Document = dom.window.Document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.customElements = dom.window.customElements;
globalThis.CSSStyleSheet = dom.window.CSSStyleSheet;

let reducer;
let initialState;
let OPEN_CONFIGURE_COLLECTION_DIALOG;
let CLOSE_CONFIGURE_COLLECTION_DIALOG;
let CANCEL_CONFIGURE_COLLECTION_DIALOG;
let UPDATE_COLLECTION_CONFIGURATION_SHAPSHOT;

describe('Collection Composer draft lifecycle', () => {
	before(async () => {
		reducer = (await import('../../lib/src/reducers/collection.js')).default;
		({ INITIAL_STATE: initialState } = await import('../../lib/src/filters.js'));
		({
			OPEN_CONFIGURE_COLLECTION_DIALOG,
			CLOSE_CONFIGURE_COLLECTION_DIALOG,
			CANCEL_CONFIGURE_COLLECTION_DIALOG,
			UPDATE_COLLECTION_CONFIGURATION_SHAPSHOT,
		} = await import('../../lib/src/actions.js'));
	});

	const draft = {
		setName: 'main',
		filterNames: ['starred'],
		sortName: 'default',
		sortReversed: false,
		viewMode: 'list',
		viewModeExtra: '',
	};

	it('does not apply a composed draft on cancel', () => {
		const opened = reducer(initialState, { type: OPEN_CONFIGURE_COLLECTION_DIALOG });
		const changed = reducer(opened, {
			type: UPDATE_COLLECTION_CONFIGURATION_SHAPSHOT,
			collection: draft,
		});
		const cancelled = reducer(changed, { type: CANCEL_CONFIGURE_COLLECTION_DIALOG });
		assert.deepStrictEqual(cancelled.active, initialState.active);
		assert.strictEqual(cancelled.snapshot, null);
	});

	it('resumes an un-committed draft when reopened on the same collection', () => {
		//Source mode already keeps its text across a close; the quick composer
		//threw a multi-clause draft away in silence on the same Escape.
		const opened = reducer(initialState, { type: OPEN_CONFIGURE_COLLECTION_DIALOG });
		const changed = reducer(opened, {
			type: UPDATE_COLLECTION_CONFIGURATION_SHAPSHOT,
			collection: draft,
		});
		const cancelled = reducer(changed, { type: CANCEL_CONFIGURE_COLLECTION_DIALOG });
		assert.deepStrictEqual(cancelled.preservedSnapshot.configuration, draft);
		const reopened = reducer(cancelled, { type: OPEN_CONFIGURE_COLLECTION_DIALOG });
		assert.deepStrictEqual(reopened.snapshot, draft, 'the chips come back');
		assert.strictEqual(reopened.preservedSnapshot, null, 'and are not resumed twice');
	});

	it('re-derives from the collection the user is now looking at', () => {
		const opened = reducer(initialState, { type: OPEN_CONFIGURE_COLLECTION_DIALOG });
		const changed = reducer(opened, {
			type: UPDATE_COLLECTION_CONFIGURATION_SHAPSHOT,
			collection: draft,
		});
		const cancelled = reducer(changed, { type: CANCEL_CONFIGURE_COLLECTION_DIALOG });
		//The user navigates. A draft is an adjustment to a place, so an
		//adjustment to a place they have left is not where they are.
		const elsewhere = {
			...cancelled,
			active: { ...initialState.active, filterNames: ['has-todo'] },
		};
		const reopened = reducer(elsewhere, { type: OPEN_CONFIGURE_COLLECTION_DIALOG });
		assert.deepStrictEqual(reopened.snapshot, elsewhere.active, 'begins from where the user is');
		assert.strictEqual(reopened.preservedSnapshot, null, 'and the stale draft is dropped');
	});

	it('preserves nothing when the draft never diverged', () => {
		const opened = reducer(initialState, { type: OPEN_CONFIGURE_COLLECTION_DIALOG });
		const cancelled = reducer(opened, { type: CANCEL_CONFIGURE_COLLECTION_DIALOG });
		//Opening and closing without composing anything is not work, and
		//"Restored the draft you were composing" over an untouched draft would
		//be a claim about something that never happened.
		assert.strictEqual(cancelled.preservedSnapshot, null);
	});

	it('leaves nothing to resume after a committed draft', () => {
		const opened = reducer(initialState, { type: OPEN_CONFIGURE_COLLECTION_DIALOG });
		const changed = reducer(opened, {
			type: UPDATE_COLLECTION_CONFIGURATION_SHAPSHOT,
			collection: draft,
		});
		const committed = reducer(changed, { type: CLOSE_CONFIGURE_COLLECTION_DIALOG });
		assert.strictEqual(committed.preservedSnapshot, null);
		const reopened = reducer(committed, { type: OPEN_CONFIGURE_COLLECTION_DIALOG });
		assert.deepStrictEqual(reopened.snapshot, draft, 'which is now simply the active collection');
	});

	it('preserves the legacy builder\'s explicit commit path', () => {
		const opened = reducer(initialState, { type: OPEN_CONFIGURE_COLLECTION_DIALOG });
		const changed = reducer(opened, {
			type: UPDATE_COLLECTION_CONFIGURATION_SHAPSHOT,
			collection: draft,
		});
		const committed = reducer(changed, { type: CLOSE_CONFIGURE_COLLECTION_DIALOG });
		assert.deepStrictEqual(committed.active, draft);
		assert.strictEqual(committed.snapshot, null);
	});

	it('does not erase a draft when the composer is opened again', () => {
		const opened = reducer(initialState, { type: OPEN_CONFIGURE_COLLECTION_DIALOG });
		const changed = reducer(opened, {
			type: UPDATE_COLLECTION_CONFIGURATION_SHAPSHOT,
			collection: draft,
		});
		const reopened = reducer(changed, { type: OPEN_CONFIGURE_COLLECTION_DIALOG });
		assert.strictEqual(reopened, changed);
		assert.deepStrictEqual(reopened.snapshot, draft);
	});
});

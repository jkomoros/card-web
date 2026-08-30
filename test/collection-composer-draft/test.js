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

	//SUPERSEDED PINS (round 3, D1). Three tests stood here — 'resumes an
	//un-committed draft when reopened on the same collection', 're-derives from
	//the collection the user is now looking at', and 'preserves nothing when the
	//draft never diverged'. They pinned `preservedSnapshot`: a draft that survived
	//an Escape and came back on the next open, resumed only while the collection
	//it was derived from was still on screen.
	//
	//The owner's constitution retires the whole mechanism: "if you make a mistake,
	//esc/X resets to the previous state". Preservation made Escape mean DEFER
	//rather than reset — the mistake reappeared on the next Ctrl-K, on a surface
	//that had silently reopened on it, and the second Escape was spent undoing the
	//first one's failure to undo. The field is deleted from CollectionState, and
	//with it the composer's `_preservedComposerInput` / `_preservedDraftBase` and
	//the 'Restored the draft you were composing' receipt.
	//
	//What replaces them is one pin, below: every composition begins from the
	//collection on screen.
	it('begins every composition from the collection on screen', () => {
		const opened = reducer(initialState, { type: OPEN_CONFIGURE_COLLECTION_DIALOG });
		const changed = reducer(opened, {
			type: UPDATE_COLLECTION_CONFIGURATION_SHAPSHOT,
			collection: draft,
		});
		const cancelled = reducer(changed, { type: CANCEL_CONFIGURE_COLLECTION_DIALOG });
		assert.strictEqual(cancelled.snapshot, null, 'the draft is discarded, whole');
		const reopened = reducer(cancelled, { type: OPEN_CONFIGURE_COLLECTION_DIALOG });
		assert.deepStrictEqual(reopened.snapshot, initialState.active,
			'and the next composition starts from the active collection, not from it');
		//And nothing anywhere in the state is keeping it: the reset is the undo,
		//so a second Escape has nothing left to undo.
		assert.ok(!('preservedSnapshot' in reopened),
			'the preserved-draft slot is gone from the state, not merely left empty');
	});

	it('leaves nothing to resume after a committed draft', () => {
		const opened = reducer(initialState, { type: OPEN_CONFIGURE_COLLECTION_DIALOG });
		const changed = reducer(opened, {
			type: UPDATE_COLLECTION_CONFIGURATION_SHAPSHOT,
			collection: draft,
		});
		const committed = reducer(changed, { type: CLOSE_CONFIGURE_COLLECTION_DIALOG });
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

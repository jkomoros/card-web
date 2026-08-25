/*eslint-env node, es2022*/

//ONE DRAFT SLOT PER CARD (#766).
//
//The single localStorage draft slot was safe under an invariant #763 silently
//broke: editor sessions can now overlap a still-round-tripping save. With one
//slot, a second card's keystrokes overwrote the first card's stamped draft
//after the 200ms debounce — and the second session finishing CLEAN deleted
//the slot outright — so a paused save's Stop-and-recover flow surfaced the
//WRONG card's words, or none. These tests pin the per-card slots: overlap
//scenarios end with every card's words intact, each clear touches only its
//own card, the v1 slot migrates, and the cap evicts oldest-first.
//
//The crown test drives the REAL watcher through the REAL store: card A's
//draft is stamped for a save; a session on card B opens, types, and finishes
//clean; A's draft must survive.

import assert from 'assert';
import {bootstrapApp} from '../harness-support/app-harness.js';

const app = await bootstrapApp();
const {store, uid: UID, dom} = app;

let editDraft;

const card = (id, title) => ({
	id,
	card_type: 'working-notes',
	title: title || 'Title of ' + id,
	body: '<p>Body of ' + id + '</p>',
	section: '',
	slugs: [],
	tags: [],
	references: {},
	references_info: {},
	references_inbound: {},
	references_info_inbound: {},
	auto_todo_overrides: {},
	flags: {},
	published: false,
});

let savedAtCounter = 1000;
const storedDraft = (cardID, overrides = {}) => ({
	version: 1,
	uid: UID,
	cardID,
	diff: {title: 'draft title for ' + cardID},
	substantive: false,
	baseUpdated: null,
	savedAt: savedAtCounter++,
	...overrides,
});

const seed = (draft) => {
	globalThis.localStorage.setItem(editDraft.EDIT_DRAFT_STORAGE_PREFIX + draft.cardID, JSON.stringify(draft));
};

const clearAllDraftKeys = () => {
	for (const key of Object.keys(globalThis.localStorage)) {
		if (key.includes('card-web-edit-draft')) globalThis.localStorage.removeItem(key);
	}
};

describe('per-card draft slots (#766)', () => {

	before(async () => {
		editDraft = await import('../../lib/src/edit-draft.js');
	});

	beforeEach(clearAllDraftKeys);

	it('drafts for different cards coexist, newest first', () => {
		seed(storedDraft('card-a', {operationID: 'op-1'}));
		seed(storedDraft('card-b'));
		const drafts = editDraft.readEditDrafts();
		assert.deepStrictEqual(drafts.map(d => d.cardID), ['card-b', 'card-a'], 'newest first');
		assert.strictEqual(editDraft.readEditDraft('card-a').operationID, 'op-1');
		assert.strictEqual(editDraft.readEditDraft().cardID, 'card-b', 'no-arg read is the newest draft');
	});

	it('clearing one card leaves the other card\'s stamped draft intact', () => {
		//The heart of #766: B\'s teardown must not destroy A\'s parked draft.
		seed(storedDraft('card-a', {operationID: 'op-1'}));
		seed(storedDraft('card-b'));
		editDraft.clearEditDraft('card-b');
		assert.strictEqual(editDraft.readEditDraft('card-b'), null);
		const survivor = editDraft.readEditDraft('card-a');
		assert.ok(survivor, 'card-a\'s draft must survive card-b\'s clear');
		assert.strictEqual(survivor.operationID, 'op-1');
	});

	it('a bare clear removes every slot, including the legacy one', () => {
		globalThis.localStorage.setItem(editDraft.EDIT_DRAFT_STORAGE_KEY, JSON.stringify(storedDraft('card-legacy')));
		seed(storedDraft('card-a'));
		seed(storedDraft('card-b'));
		editDraft.clearEditDraft();
		assert.deepStrictEqual(editDraft.readEditDrafts(), []);
		assert.strictEqual(globalThis.localStorage.getItem(editDraft.EDIT_DRAFT_STORAGE_KEY), null);
	});

	it('migrates a v1 draft into its card\'s slot and removes the v1 key', () => {
		const legacy = storedDraft('card-legacy');
		globalThis.localStorage.setItem(editDraft.EDIT_DRAFT_STORAGE_KEY, JSON.stringify(legacy));
		const drafts = editDraft.readEditDrafts();
		assert.strictEqual(drafts.length, 1);
		assert.strictEqual(drafts[0].cardID, 'card-legacy');
		assert.strictEqual(globalThis.localStorage.getItem(editDraft.EDIT_DRAFT_STORAGE_KEY), null, 'v1 key removed after migration');
		assert.ok(editDraft.readEditDraft('card-legacy'), 'migrated draft readable by card');
	});

	it('migration never clobbers a newer v2 draft for the same card', () => {
		const older = storedDraft('card-x');
		const newer = storedDraft('card-x', {diff: {title: 'newer'}});
		assert.ok(newer.savedAt > older.savedAt);
		seed(newer);
		globalThis.localStorage.setItem(editDraft.EDIT_DRAFT_STORAGE_KEY, JSON.stringify(older));
		const draft = editDraft.readEditDraft('card-x');
		assert.deepStrictEqual(draft.diff, {title: 'newer'});
	});

	it('caps stored drafts, evicting oldest first', () => {
		const total = editDraft.MAX_EDIT_DRAFT_SLOTS + 3;
		for (let i = 0; i < total; i++) seed(storedDraft('card-cap-' + i));
		editDraft.enforceEditDraftSlotCap();
		const drafts = editDraft.readEditDrafts();
		assert.strictEqual(drafts.length, editDraft.MAX_EDIT_DRAFT_SLOTS);
		//The oldest three (0, 1, 2) are the evicted ones.
		assert.strictEqual(editDraft.readEditDraft('card-cap-0'), null);
		assert.strictEqual(editDraft.readEditDraft('card-cap-2'), null);
		assert.ok(editDraft.readEditDraft('card-cap-' + (total - 1)));
	});

	it('the cap never evicts a stamped draft — a paused save\'s recovery record', () => {
		//The #766 review executed this exact loss: a stamped draft as the
		//oldest slot was evicted by the 9th persist (possibly from another
		//tab). Stamped drafts are exempt; victims come from unstamped only.
		seed(storedDraft('card-stamped', {operationID: 'op-live'}));
		const total = editDraft.MAX_EDIT_DRAFT_SLOTS + 3;
		for (let i = 0; i < total; i++) seed(storedDraft('card-fill-' + i));
		editDraft.enforceEditDraftSlotCap();
		assert.ok(editDraft.readEditDraft('card-stamped'), 'the stamped draft must survive the cap');
		assert.strictEqual(editDraft.readEditDraft('card-fill-0'), null, 'the oldest unstamped draft is the victim instead');
	});

	it('stamped drafts consume slots first; unstamped eviction fits the remaining budget, oldest first', () => {
		//Three stamped drafts leave a budget of MAX - 3 unstamped slots. Seed
		//two more unstamped than that: exactly the two OLDEST unstamped drafts
		//are evicted, and the newest unstamped draft always survives.
		for (let i = 0; i < 3; i++) seed(storedDraft('card-stamp-' + i, {operationID: 'op-' + i}));
		const budget = editDraft.MAX_EDIT_DRAFT_SLOTS - 3;
		for (let i = 0; i < budget + 2; i++) seed(storedDraft('card-un-' + i));
		editDraft.enforceEditDraftSlotCap();
		assert.strictEqual(editDraft.readEditDraft('card-un-0'), null, 'oldest unstamped evicted');
		assert.strictEqual(editDraft.readEditDraft('card-un-1'), null, 'second-oldest unstamped evicted');
		assert.ok(editDraft.readEditDraft('card-un-2'), 'unstamped drafts within budget stay');
		assert.ok(editDraft.readEditDraft('card-un-' + (budget + 1)), 'the newest unstamped draft always survives');
		for (let i = 0; i < 3; i++) assert.ok(editDraft.readEditDraft('card-stamp-' + i), 'stamped drafts are never victims');
		assert.strictEqual(editDraft.readEditDrafts().length, editDraft.MAX_EDIT_DRAFT_SLOTS);
	});

	it('a cap full of stamped drafts never claims the just-persisted draft', () => {
		//The pre-fix arithmetic computed excess over ALL drafts and sliced the
		//unstamped list by it: with MAX stamped drafts parked (budget 0), the
		//slice wrapped around to the ENTIRE unstamped list — deleting the draft
		//the persist had just written, every 200ms, violating the header
		//invariant. justPersistedCardID must shield it unconditionally.
		for (let i = 0; i < editDraft.MAX_EDIT_DRAFT_SLOTS; i++) seed(storedDraft('card-stamp-' + i, {operationID: 'op-' + i}));
		seed(storedDraft('card-just-typed'));
		editDraft.enforceEditDraftSlotCap('card-just-typed');
		assert.ok(editDraft.readEditDraft('card-just-typed'), 'the just-persisted draft must survive a zero budget');
		//Older unstamped drafts get no such shield: with budget 0 they are all
		//over budget, and a stale one IS evicted.
		seed(storedDraft('card-stale'));
		seed(storedDraft('card-just-typed'));
		editDraft.enforceEditDraftSlotCap('card-just-typed');
		assert.strictEqual(editDraft.readEditDraft('card-stale'), null, 'an older unstamped draft is still evicted at zero budget');
		assert.ok(editDraft.readEditDraft('card-just-typed'));
	});

	it('recoverEditDraft refuses another account\'s draft, per slot', async () => {
		seed(storedDraft('card-other', {uid: 'someone-else'}));
		await assert.rejects(editDraft.recoverEditDraft('card-other'), /No draft is available/);
		//And the no-arg form skips other accounts\' drafts entirely.
		await assert.rejects(editDraft.recoverEditDraft(), /No draft is available/);
	});

	describe('the real watcher, end to end', () => {

		before(async () => {
			//The shared harness store registers only app/data/user; the
			//editing session lives in the editor slice.
			store.addReducers({editor: (await import('../../lib/src/reducers/editor.js')).default});
			editDraft.installEditDraftWatcher();
		});

		afterEach(() => {
			store.dispatch({type: 'EDITING_FINISH'});
			clearAllDraftKeys();
		});

		const waitForDebounce = () => new Promise(resolve => setTimeout(resolve, 300));

		it('writes a dirty session\'s draft into its own card\'s slot', async () => {
			store.dispatch({type: 'EDITING_START', card: card('watch-a')});
			store.dispatch({type: 'EDITING_TEXT_FIELD_UPDATED', fieldName: 'title', value: 'edited A', fromContentEditable: false});
			await waitForDebounce();
			const draft = editDraft.readEditDraft('watch-a');
			assert.ok(draft, 'the draft must land in the per-card slot');
			assert.strictEqual(draft.uid, UID);
		});

		it('a session finishing clean clears ONLY its own card\'s slot', async () => {
			//The #766 loss chain, driven for real: card A\'s stamped draft is
			//parked; a session on card B types and then finishes.
			seed(storedDraft('watch-parked', {operationID: 'op-parked'}));
			store.dispatch({type: 'EDITING_START', card: card('watch-b')});
			store.dispatch({type: 'EDITING_TEXT_FIELD_UPDATED', fieldName: 'title', value: 'edited B', fromContentEditable: false});
			await waitForDebounce();
			assert.ok(editDraft.readEditDraft('watch-b'), 'B\'s draft exists while dirty');
			//The user closes B\'s editor, discarding: dirty -> clean.
			store.dispatch({type: 'EDITING_FINISH'});
			await waitForDebounce();
			assert.strictEqual(editDraft.readEditDraft('watch-b'), null, 'B\'s own draft clears on clean finish');
			const parked = editDraft.readEditDraft('watch-parked');
			assert.ok(parked, 'A\'s parked draft MUST survive B\'s teardown — the #766 loss chain');
			assert.strictEqual(parked.operationID, 'op-parked');
		});

		it('a save confirmation clears only its exact card and operation', async () => {
			seed(storedDraft('watch-c1', {operationID: 'op-c1'}));
			seed(storedDraft('watch-c2', {operationID: 'op-c2'}));
			dom.window.dispatchEvent(new dom.window.CustomEvent('card-web-single-save-confirmed', {
				detail: {cardID: 'watch-c1', operationID: 'op-c1'},
			}));
			assert.strictEqual(editDraft.readEditDraft('watch-c1'), null, 'the confirmed save\'s draft clears');
			assert.ok(editDraft.readEditDraft('watch-c2'), 'the other card\'s draft stays');
			//A confirmation that matches the card but not the operation leaves
			//the draft alone (a newer session\'s work).
			dom.window.dispatchEvent(new dom.window.CustomEvent('card-web-single-save-confirmed', {
				detail: {cardID: 'watch-c2', operationID: 'op-other'},
			}));
			assert.ok(editDraft.readEditDraft('watch-c2'), 'an operation mismatch must not clear');
		});

		it('a new session\'s draft survives its own persist even with a cap full of stamped drafts', async () => {
			//The pre-fix loss loop, driven for real: with MAX stamped drafts
			//parked (saves paused), the unstamped budget is zero — and the old
			//arithmetic made every 200ms persist write the active session\'s
			//recovery draft and immediately delete it. The just-persisted draft
			//must survive; the stamped records must too.
			for (let i = 0; i < editDraft.MAX_EDIT_DRAFT_SLOTS; i++) seed(storedDraft('watch-stamp-' + i, {operationID: 'op-' + i}));
			store.dispatch({type: 'EDITING_START', card: card('watch-fresh')});
			store.dispatch({type: 'EDITING_TEXT_FIELD_UPDATED', fieldName: 'title', value: 'edited fresh', fromContentEditable: false});
			await waitForDebounce();
			assert.ok(editDraft.readEditDraft('watch-fresh'), 'the active session\'s just-persisted draft must not be evicted');
			for (let i = 0; i < editDraft.MAX_EDIT_DRAFT_SLOTS; i++) {
				assert.ok(editDraft.readEditDraft('watch-stamp-' + i), 'stamped drafts survive alongside it');
			}
		});

		it('persisting into an EXISTING slot never evicts anything', async () => {
			//Cap enforcement is gated on slot creation: rewriting a slot cannot
			//change the count, so the (whole-keyspace) enforcement pass must not
			//run — and must not evict — on the steady 200ms debounce ticks.
			//Seed an over-cap population where enforcement WOULD find a victim.
			seed(storedDraft('watch-existing'));
			const total = editDraft.MAX_EDIT_DRAFT_SLOTS + 1;
			for (let i = 1; i < total; i++) seed(storedDraft('watch-keep-' + i));
			store.dispatch({type: 'EDITING_START', card: card('watch-existing')});
			store.dispatch({type: 'EDITING_TEXT_FIELD_UPDATED', fieldName: 'title', value: 'edited existing', fromContentEditable: false});
			await waitForDebounce();
			assert.strictEqual(editDraft.readEditDrafts().length, total, 'a rewrite of an existing slot evicts nothing');
			assert.ok(editDraft.readEditDraft('watch-keep-1'), 'the oldest seeded draft in particular survives');
		});

		it('stamping targets the identified card\'s slot', async () => {
			store.dispatch({type: 'EDITING_START', card: card('watch-d')});
			store.dispatch({type: 'EDITING_TEXT_FIELD_UPDATED', fieldName: 'title', value: 'edited D', fromContentEditable: false});
			await waitForDebounce();
			dom.window.dispatchEvent(new dom.window.CustomEvent('card-web-preserve-edit-draft-for-save', {
				detail: {cardID: 'watch-d', operationID: 'op-d'},
			}));
			const draft = editDraft.readEditDraft('watch-d');
			assert.strictEqual(draft.operationID, 'op-d');
			//And because the preserve handler resets the dirty tracking, the
			//editor teardown that follows a save does NOT clear the stamp.
			store.dispatch({type: 'EDITING_FINISH'});
			await waitForDebounce();
			assert.ok(editDraft.readEditDraft('watch-d'), 'the stamped draft survives the post-save teardown');
		});
	});
});

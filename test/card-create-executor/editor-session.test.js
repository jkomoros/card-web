/*eslint-env node, es2022*/

//A single-card save that arrives while another save is still running PARKS
//until the runner settles. On master it parked BEFORE anything was
//persisted and before the editor was released, so the editor stayed open
//with no indication, keystrokes typed in that window were silently lost
//when the parked save resumed with the diff computed at commit time, and
//the post-park release closed whatever editor was open — card B's, if the
//user had moved on. The optimistic "pending" face was also one slot for
//all cards, so any cancel or any refusal anywhere dropped card A's face.
//
//Real thunks against the real server: saves are held by stubbing
//MultiBatch.prototype.commit and released explicitly.

import assert from 'assert';
import {bootstrapApp, clearAuxQueue, wireCard} from '../harness-support/app-harness.js';

const {store, db, uid, firestore} = await bootstrapApp();
const {doc, getDoc, serverTimestamp} = firestore;
const {receiveCards, modifyCard, durableCardMutationPendingForCard} = await import('../../lib/src/actions/data.js');
const {editingFinish, editingStart, textFieldUpdated} = await import('../../lib/src/actions/editor.js');
const {MultiBatch} = await import('../../lib/src/multi_batch.js');
const {EDITING_START} = await import('../../lib/src/actions.js');
const {selectIsEditing, selectEditingCard, selectPendingSaveCard} = await import('../../lib/src/selectors.js');
const {installEditDraftWatcher, EDIT_DRAFT_STORAGE_PREFIX, EDIT_DRAFT_CHANGED_EVENT} = await import('../../lib/src/edit-draft.js');
store.addReducers({collection: (await import('../../lib/src/reducers/collection.js')).default});
store.addReducers({editor: (await import('../../lib/src/reducers/editor.js')).default});
//The product's draft watcher: it writes the per-card draft slot on every
//editor change and stamps it when a save preserves it.
installEditDraftWatcher();

const MULTI_EDIT_KEY = 'card-web-pending-multi-edit-v1';
const draftFor = id => JSON.parse(localStorage.getItem(EDIT_DRAFT_STORAGE_PREFIX + id) || 'null');
let sequence = 0;
const nextID = () => `editor-session-${Date.now()}-${sequence++}`;
const serverCard = async id => ({...(await getDoc(doc(db, 'cards', id))).data(), id});
const faces = () => selectPendingSaveCard(store.getState()) || {};
const settle = ms => new Promise(resolve => setTimeout(resolve, ms));

//Seed a card on the server (real revision) and in the store.
const seed = async (title) => {
	const id = nextID();
	const batch = new MultiBatch(db);
	batch.set(doc(db, 'cards', id), {...wireCard(id, uid), title, body: `<p>${title}</p>`, updated: serverTimestamp()});
	await batch.commit();
	const image = await serverCard(id);
	store.dispatch(receiveCards({[id]: image}, 'unpublished'));
	return image;
};

describe('editor sessions around a parked save (real thunks)', function() {
	this.timeout(60000);
	let originalCommit;
	let originalUser;
	//The current hold's release, so a failed assertion cannot leave a commit
	//held (and every later test parked behind it) — afterEach releases it.
	let pendingRelease = null;
	let warnings = [];
	let originalWarn;

	//Hold the NEXT commit until release() is called; later commits run normally.
	const holdNextCommit = () => {
		let release;
		const released = new Promise(resolve => { release = resolve; });
		let held = false;
		MultiBatch.prototype.commit = async function(...args) {
			if (!held) {
				held = true;
				await released;
			}
			return originalCommit.apply(this, args);
		};
		pendingRelease = () => { release(); pendingRelease = null; };
		return pendingRelease;
	};

	beforeEach(() => {
		clearAuxQueue();
		localStorage.removeItem(MULTI_EDIT_KEY);
		originalUser = store.getState().user.user;
		originalCommit = MultiBatch.prototype.commit;
		warnings = [];
		originalWarn = console.warn;
		console.warn = (...args) => { warnings.push(args.join(' ')); };
		store.dispatch({type: 'UPDATE_USER_PERMISSIONS', permissions: {admin: true}});
		store.dispatch({type: 'UPDATE_CORPUS_STATUS', status: 'live', message: ''});
		if (selectIsEditing(store.getState())) store.dispatch(editingFinish());
	});

	afterEach(async () => {
		if (pendingRelease) {
			pendingRelease();
			//Let the released saves settle so they cannot bleed into the next test.
			await settle(500);
		}
		MultiBatch.prototype.commit = originalCommit;
		console.warn = originalWarn;
		store.dispatch({type: 'SIGNIN_SUCCESS', user: originalUser});
		if (selectIsEditing(store.getState())) store.dispatch(editingFinish());
		localStorage.removeItem(MULTI_EDIT_KEY);
	});

	//Runs save X (held), then save A which parks behind it. Returns the
	//release for X and the two cards.
	const parkASaveBehindX = async () => {
		const x = await seed('X');
		const a = await seed('A');
		const release = holdNextCommit();
		const xSave = store.dispatch(modifyCard(x, {title: 'X2'}));
		await settle(50);
		//A is being edited, through the real editor actions, when its save is
		//requested; the draft watcher has written A's draft slot by then.
		store.dispatch({type: EDITING_START, card: a});
		store.dispatch(textFieldUpdated('title', 'A2'));
		//The watcher debounces its write by 200ms.
		await settle(300);
		assert.strictEqual(draftFor(a.id)?.diff?.title, 'A2', 'the watcher holds the unsaved draft');
		const aSave = store.dispatch(modifyCard(a, {title: 'A2'}));
		await settle(50);
		return {x, a, release, xSave, aSave};
	};

	it('a parked save releases its editor at once and shows the pending face, instead of leaving the editor open to type into', async () => {
		const {a, release, xSave, aSave} = await parkASaveBehindX();
		assert.strictEqual(selectIsEditing(store.getState()), false, 'the editor is closed while the save waits');
		assert.strictEqual(faces()[a.id]?.title, 'A2', 'the committed draft is the face from this instant');
		const stamped = draftFor(a.id);
		assert.ok(stamped?.operationID, 'the draft is stamped with the id the save will carry');
		release();
		await Promise.all([xSave, aSave]);
		assert.strictEqual((await serverCard(a.id)).title, 'A2');
		assert.strictEqual(faces()[a.id], undefined, 'the face clears on settle');
		assert.strictEqual(draftFor(a.id), null, 'the confirmed save deleted the draft it was stamped for');
	});

	it('a card whose save is parked reads as pending: the editor cannot be reopened on it and its stamped draft is not an orphan', async () => {
		//During the park no durable record exists for A (the one record slot
		//belongs to X), so without this A could be reopened from its stale
		//copy; the resumed save then closed that editor and the confirmation
		//deleted the newer draft — the keystroke loss this slice removes,
		//reachable by a different door. The same predicate keeps the
		//orphaned-draft banner from offering a draft a save still owns.
		const {a, release, xSave, aSave} = await parkASaveBehindX();
		assert.strictEqual(durableCardMutationPendingForCard(a.id), true, 'parked reads as pending');
		store.dispatch({type: 'SHOW_CARD', requestedCard: a.id, card: a.id});
		await store.dispatch(editingStart());
		assert.strictEqual(selectIsEditing(store.getState()), false, 'reopening the parked card is refused');
		assert.ok(warnings.some(w => w.includes('save is still finishing')), 'refused for the pending reason, not some other guard: ' + JSON.stringify(warnings));
		//The last dispatch of the run must already see the card as not
		//pending: card-view computes its Edit affordance in stateChanged, and
		//nothing dispatches after a settle to recompute it.
		let pendingAtLastDispatch = null;
		const unsubscribe = store.subscribe(() => { pendingAtLastDispatch = durableCardMutationPendingForCard(a.id); });
		release();
		await Promise.all([xSave, aSave]);
		unsubscribe();
		assert.strictEqual(durableCardMutationPendingForCard(a.id), false, 'pending clears once the save settles');
		assert.strictEqual(pendingAtLastDispatch, false, 'the settle dispatch itself already reads not pending');
		assert.strictEqual((await serverCard(a.id)).title, 'A2');
		//And the editor reopens now that the save is done.
		await store.dispatch(editingStart());
		assert.strictEqual(selectEditingCard(store.getState())?.id, a.id, 'the editor reopens on the card after settle');
		store.dispatch(editingFinish());
	});

	it('a parked save refused after the park keeps its stamped draft, clears only its face, and tells the recovery banner', async () => {
		//The park released the editor and stamped the draft, so after a
		//refusal that draft is the only copy of the edit. The card must stop
		//reading as pending (nothing will ever settle it) and the banner must
		//be told to re-read the slots, as after a stopped save.
		const {a, release, xSave, aSave} = await parkASaveBehindX();
		let draftEvents = 0;
		const onDraft = () => { draftEvents++; };
		window.addEventListener(EDIT_DRAFT_CHANGED_EVENT, onDraft);
		//The account changes while A waits.
		store.dispatch({type: 'SIGNIN_SUCCESS', user: {...originalUser, uid: 'someone-else'}});
		release();
		await xSave;
		await aSave;
		window.removeEventListener(EDIT_DRAFT_CHANGED_EVENT, onDraft);
		assert.strictEqual(durableCardMutationPendingForCard(a.id), false, 'a refused parked save leaves nothing pending');
		assert.strictEqual(faces()[a.id], undefined, 'the face is cleared');
		assert.strictEqual(draftFor(a.id)?.diff?.title, 'A2', 'the stamped draft survives the refusal');
		assert.ok(draftEvents >= 1, 'the recovery banner was told to re-read the drafts');
		assert.strictEqual((await serverCard(a.id)).title, 'A', 'the refused edit was not written');
	});

	it('a parked save whose predecessor paused is refused before the run, so its error does not land in the paused record', async () => {
		//X's commit fails and leaves X's durable record behind. A must not
		//fall into the run: the run's catch would write A's error into X's
		//record and clear faces for X's ids, leaving A's face up forever.
		const x = await seed('X');
		const a = await seed('A');
		let fail;
		const failed = new Promise(resolve => { fail = resolve; });
		let held = false;
		MultiBatch.prototype.commit = async function(...args) {
			if (!held) {
				held = true;
				await failed;
				throw new Error('boom');
			}
			return originalCommit.apply(this, args);
		};
		pendingRelease = () => { fail(); pendingRelease = null; };
		const xSave = store.dispatch(modifyCard(x, {title: 'X2'}));
		await settle(50);
		store.dispatch({type: EDITING_START, card: a});
		store.dispatch(textFieldUpdated('title', 'A2'));
		await settle(300);
		const aSave = store.dispatch(modifyCard(a, {title: 'A2'}));
		await settle(50);
		assert.strictEqual(durableCardMutationPendingForCard(a.id), true, 'parked reads as pending');
		pendingRelease();
		await xSave;
		await aSave;
		const record = JSON.parse(localStorage.getItem(MULTI_EDIT_KEY) || 'null');
		assert.strictEqual(record?.targetIDs?.[0], x.id, 'X\'s paused record is left behind');
		assert.ok(record.lastError.includes('boom'), 'X\'s record keeps X\'s error: ' + record.lastError);
		assert.strictEqual(faces()[a.id], undefined, 'A\'s face is cleared');
		assert.strictEqual(durableCardMutationPendingForCard(a.id), false, 'A is not pending');
		assert.strictEqual(draftFor(a.id)?.diff?.title, 'A2', 'A\'s stamped draft survives');
		localStorage.removeItem(MULTI_EDIT_KEY);
	});

	it('a parked save that resumes does not close an editor opened on another card meanwhile', async () => {
		const {a, release, xSave, aSave} = await parkASaveBehindX();
		const b = await seed('B');
		store.dispatch({type: EDITING_START, card: b});
		release();
		await Promise.all([xSave, aSave]);
		assert.strictEqual(selectEditingCard(store.getState())?.id, b.id, 'B is still being edited');
		assert.strictEqual((await serverCard(a.id)).title, 'A2', 'A was saved anyway');
		store.dispatch(editingFinish());
	});

	it('a refused third save does not drop a pending card\'s face', async () => {
		const {a, release, xSave, aSave} = await parkASaveBehindX();
		const c = await seed('C');
		store.dispatch(modifyCard(c, {title: 'C2'}));
		await settle(50);
		assert.strictEqual(faces()[a.id]?.title, 'A2', 'A\'s face survives the refusal of C');
		release();
		await Promise.all([xSave, aSave]);
	});

	it('cancelling another card\'s editor does not drop a pending card\'s face', async () => {
		const {a, release, xSave, aSave} = await parkASaveBehindX();
		const b = await seed('B');
		store.dispatch({type: EDITING_START, card: b});
		store.dispatch(editingFinish());
		assert.strictEqual(faces()[a.id]?.title, 'A2', 'A\'s face survives B\'s cancel');
		release();
		await Promise.all([xSave, aSave]);
	});
});

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
const {receiveCards, modifyCard} = await import('../../lib/src/actions/data.js');
const {editingFinish} = await import('../../lib/src/actions/editor.js');
const {MultiBatch} = await import('../../lib/src/multi_batch.js');
const {EDITING_START} = await import('../../lib/src/actions.js');
const {selectIsEditing, selectEditingCard, selectPendingSaveCard} = await import('../../lib/src/selectors.js');
store.addReducers({collection: (await import('../../lib/src/reducers/collection.js')).default});
store.addReducers({editor: (await import('../../lib/src/reducers/editor.js')).default});

const MULTI_EDIT_KEY = 'card-web-pending-multi-edit-v1';
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
		//A is being edited when its save is requested, and the editor's draft
		//is what the save carries (editingCommit diffs the draft against the
		//base; here the draft is seeded directly).
		store.dispatch({type: EDITING_START, card: {...a, title: 'A2'}});
		const aSave = store.dispatch(modifyCard(a, {title: 'A2'}));
		await settle(50);
		return {x, a, release, xSave, aSave};
	};

	it('a parked save releases its editor at once and shows the pending face, instead of leaving the editor open to type into', async () => {
		const {a, release, xSave, aSave} = await parkASaveBehindX();
		assert.strictEqual(selectIsEditing(store.getState()), false, 'the editor is closed while the save waits');
		assert.strictEqual(faces()[a.id]?.title, 'A2', 'the committed draft is the face from this instant');
		release();
		await Promise.all([xSave, aSave]);
		assert.strictEqual((await serverCard(a.id)).title, 'A2');
		assert.strictEqual(faces()[a.id], undefined, 'the face clears on settle');
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

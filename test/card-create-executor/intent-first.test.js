/*eslint-env node, es2022*/

//Card creation is intent-first: the new card is echoed into the store (and
//the worker) and navigation may proceed as soon as the create intent is
//persisted, while the commit runs underneath. On master the editor opened
//only when the server answered the commit — the whole Save→New gap at
//production latency. Real thunks against the emulator; the commit is held
//or failed by stubbing MultiBatch.prototype.commit, as editor-session does.

import assert from 'assert';
import {bootstrapApp, clearAuxQueue, clearHarnessAlerts, makeCorpusLive, whatUserWasTold, wireCard} from '../harness-support/app-harness.js';

const {store, db, uid, firestore} = await bootstrapApp();
const {doc, getDocFromServer} = firestore;
const {createCard, modifyCard, receiveCards, cardCreatePendingForCard} = await import('../../lib/src/actions/data.js');
const {editingFinish, textFieldUpdated} = await import('../../lib/src/actions/editor.js');
const queue = await import('../../lib/src/aux-write-queue.js');
const {MultiBatch} = await import('../../lib/src/multi_batch.js');
const {EDITING_START} = await import('../../lib/src/actions.js');
const {writeCorpusWorkerMode, readCorpusWorkerMode} = await import('../../lib/src/corpus-mode.js');
const {selectRawCards, selectIsEditing, selectPendingNewCardIDToNavigateTo, selectPendingNewCardArrived} = await import('../../lib/src/selectors.js');
const {installEditDraftWatcher, EDIT_DRAFT_STORAGE_PREFIX} = await import('../../lib/src/edit-draft.js');
store.addReducers({collection: (await import('../../lib/src/reducers/collection.js')).default});
store.addReducers({editor: (await import('../../lib/src/reducers/editor.js')).default});
installEditDraftWatcher();

const settle = ms => new Promise(resolve => setTimeout(resolve, ms));
const draftFor = id => JSON.parse(localStorage.getItem(EDIT_DRAFT_STORAGE_PREFIX + id) || 'null');
const serverDoc = id => getDocFromServer(doc(db, 'cards', id));

describe('intent-first card creation (real thunks)', function() {
	this.timeout(60000);
	let originalCommit;
	let previousMode;
	let previousUser;
	let previousPermissions;
	let pendingRelease = null;
	let originalWarn;

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

	//Dispatch a creation and return its promise with the id it is creating.
	const startCreation = async () => {
		const creation = store.dispatch(createCard({cardType: 'working-notes'}));
		await settle(100);
		const id = selectPendingNewCardIDToNavigateTo(store.getState());
		assert.ok(id, 'the creation registered the card to navigate to');
		return {creation, id};
	};

	beforeEach(() => {
		previousMode = readCorpusWorkerMode();
		previousUser = store.getState().user.user;
		previousPermissions = store.getState().user.userPermissions;
		//The echo path exists only when the worker owns ingestion.
		writeCorpusWorkerMode('shadow');
		originalCommit = MultiBatch.prototype.commit;
		originalWarn = console.warn;
		console.warn = () => {};
		clearAuxQueue();
		clearHarnessAlerts();
		store.dispatch({type: 'SIGNIN_SUCCESS', user: {uid, isAnonymous: false, photoURL: '', displayName: 'Harness', email: 'harness@example.com'}});
		store.dispatch({type: 'UPDATE_USER_PERMISSIONS', permissions: {admin: true}});
		makeCorpusLive(store);
		if (selectIsEditing(store.getState())) store.dispatch(editingFinish());
	});

	afterEach(async () => {
		if (pendingRelease) {
			pendingRelease();
			await settle(500);
		}
		MultiBatch.prototype.commit = originalCommit;
		console.warn = originalWarn;
		queue.setAuxWriteAttemptTimeoutForTesting(8000);
		if (selectIsEditing(store.getState())) store.dispatch(editingFinish());
		store.dispatch({type: 'SIGNIN_SUCCESS', user: previousUser});
		store.dispatch({type: 'UPDATE_USER_PERMISSIONS', permissions: previousPermissions});
		writeCorpusWorkerMode(previousMode);
		clearAuxQueue();
		//Drafts and paused records this file leaves behind (the discarded
		//creation keeps its draft on purpose) bleed into other suites run in
		//the same process: the multi-edit loop's "pending save owns its
		//draft" cases failed when this file ran first.
		for (const key of Object.keys(localStorage)) {
			if (key.startsWith(EDIT_DRAFT_STORAGE_PREFIX)) localStorage.removeItem(key);
		}
		localStorage.removeItem('card-web-pending-multi-edit-v1');
	});

	it('echoes the card and satisfies the arrival gate before the server answers; the server image then lands as an equal', async () => {
		const release = holdNextCommit();
		const {creation, id} = await startCreation();
		const optimistic = selectRawCards(store.getState())[id];
		assert.ok(optimistic, 'the card is in the store while its commit is still held');
		assert.strictEqual(optimistic.card_type, 'working-notes');
		assert.strictEqual(optimistic.revision, 1, 'the echo carries the revision MultiBatch.set will stamp');
		assert.strictEqual(selectPendingNewCardArrived(store.getState()), true, 'navigation may proceed on the echo');
		assert.strictEqual(cardCreatePendingForCard(id), true);
		assert.strictEqual((await serverDoc(id)).exists(), false, 'nothing has reached the server yet');
		assert.ok(queue.readPendingAuxWrites().some(intent => intent.cardID === id), 'the creation is durable from the start');
		release();
		await creation;
		const server = await serverDoc(id);
		assert.ok(server.exists(), 'the held commit landed');
		assert.strictEqual(server.data().revision, 1);
		const settled = selectRawCards(store.getState())[id];
		assert.strictEqual(settled.created.toMillis(), server.data().created.toMillis(), 'the server’s stamps replaced the echo’s client clock');
		assert.strictEqual(cardCreatePendingForCard(id), false);
		assert.deepStrictEqual(queue.readPendingAuxWrites(), []);
	});

	it('a save on the just-created card waits for its creation instead of reading its absence as a deletion', async () => {
		const release = holdNextCommit();
		const {creation, id} = await startCreation();
		const optimistic = selectRawCards(store.getState())[id];
		//On master the save's authoritative reread ran against a server
		//that did not hold the card yet, skipped the edit, and told the user
		//the card no longer existed.
		const save = store.dispatch(modifyCard(optimistic, {body: '<p>typed before the commit answered</p>'}, true));
		await settle(400);
		assert.strictEqual((await serverDoc(id)).exists(), false, 'the save is waiting, not writing against a missing doc');
		release();
		await Promise.all([creation, save]);
		await settle(200);
		const server = await serverDoc(id);
		//The body finisher normalizes markup (a trailing newline); the words are the point.
		assert.ok(server.data().body.includes('typed before the commit answered'), `the edit landed on the created card: ${server.data().body}`);
		assert.strictEqual(server.data().revision, 2, 'creation then edit');
		const told = whatUserWasTold(store);
		assert.ok(!told.some(text => /no longer exists/.test(text)), `the user was wrongly told the card was gone: ${told.join(' | ')}`);
	});

	it('a DISCARDED creation withdraws the echo everywhere and closes its editor with the draft kept', async () => {
		MultiBatch.prototype.commit = async function() {
			const error = new Error('rules refused it');
			error.code = 'permission-denied';
			throw error;
		};
		//Hold the discard long enough to open the editor on the echoed card.
		let releaseFailure;
		const failureGate = new Promise(resolve => { releaseFailure = resolve; });
		const failing = MultiBatch.prototype.commit;
		MultiBatch.prototype.commit = async function(...args) { await failureGate; return failing.apply(this, args); };
		const {creation, id} = await startCreation();
		const optimistic = selectRawCards(store.getState())[id];
		store.dispatch({type: EDITING_START, card: optimistic});
		store.dispatch(textFieldUpdated('title', 'Typed into a card that will be refused'));
		await settle(300);
		assert.strictEqual(draftFor(id)?.diff?.title, 'Typed into a card that will be refused', 'the watcher holds the draft');
		releaseFailure();
		await creation;
		//The withdrawal confirms absence with the server first.
		await settle(500);
		assert.strictEqual(selectRawCards(store.getState())[id], undefined, 'the echo is withdrawn from the store');
		assert.strictEqual(selectIsEditing(store.getState()), false, 'the editor on the refused card is closed');
		assert.strictEqual(draftFor(id)?.diff?.title, 'Typed into a card that will be refused', 'the typed text survives as a draft');
		assert.strictEqual(selectPendingNewCardIDToNavigateTo(store.getState()), '', 'the expectation is cleared');
		assert.deepStrictEqual(queue.readPendingAuxWrites(), [], 'a discarded intent is gone');
		assert.strictEqual((await serverDoc(id)).exists(), false);
	});

	it('a creation queued and then DISCARDED on replay is withdrawn too, not left as a phantom', async () => {
		//The review's blocking case: the first attempt's discard was handled
		//inside createCard, so a replay's discard left the echoed card in the
		//store while the user was told the creation did not go through.
		queue.setAuxWriteAttemptTimeoutForTesting(150);
		MultiBatch.prototype.commit = () => new Promise(() => { /* never answers */ });
		const {creation, id} = await startCreation();
		await creation;
		assert.ok(selectRawCards(store.getState())[id], 'queued: the echo stays');
		MultiBatch.prototype.commit = async function() {
			const error = new Error('rules refused it on replay');
			error.code = 'permission-denied';
			throw error;
		};
		await queue.replayPendingAuxWrites(uid);
		await settle(300);
		assert.deepStrictEqual(queue.readPendingAuxWrites(), [], 'the replay discarded the intent');
		assert.strictEqual(selectRawCards(store.getState())[id], undefined, 'the phantom is withdrawn');
	});

	it('a discard does not withdraw a card the server actually holds', async () => {
		//A split group or a replay repair can fail permanently AFTER the card
		//batch landed; the queue reports a discard, but the card is real.
		const {setDoc} = firestore;
		const id = 'intent-first-held-' + Date.now();
		await setDoc(doc(db, 'cards', id), {...wireCard(id, uid), revision: 1});
		const image = {...(await serverDoc(id)).data(), id};
		store.dispatch(receiveCards({[id]: image}, 'unpublished'));
		assert.ok(selectRawCards(store.getState())[id], 'seeded in the store');
		MultiBatch.prototype.commit = async function() {
			const error = new Error('fanout refused');
			error.code = 'permission-denied';
			throw error;
		};
		const payload = {kind: 'card-create', card: wireCard(id, uid), section: '', sectionUpdateKey: ''};
		assert.strictEqual(await queue.runDurableAuxWrite(queue.makeAuxWriteIntent(uid, 'card-create', id, '', payload)), 'discarded');
		await settle(300);
		assert.ok(selectRawCards(store.getState())[id], 'a card the server holds is kept');
	});

	it('an edit made while the creation is QUEUED pauses with honest copy and resumes when the replay creates the card', async () => {
		queue.setAuxWriteAttemptTimeoutForTesting(150);
		MultiBatch.prototype.commit = () => new Promise(() => { /* never answers */ });
		const {creation, id} = await startCreation();
		await creation;
		const echoed = selectRawCards(store.getState())[id];
		await store.dispatch(modifyCard(echoed, {body: '<p>typed while queued</p>'}, true));
		await settle(300);
		const paused = JSON.parse(localStorage.getItem('card-web-pending-multi-edit-v1') || 'null');
		assert.ok(paused && paused.targetIDs.includes(id), 'the edit is retained as a paused durable record');
		assert.match(paused.lastError, /still being created/, `the pause says why: ${paused.lastError}`);
		assert.ok(!whatUserWasTold(store).some(text => /no longer exists/.test(text)), 'never told the card was deleted');
		//The connection recovers: the replay creates the card, and the paused
		//edit resumes on its own.
		MultiBatch.prototype.commit = originalCommit;
		await queue.replayPendingAuxWrites(uid);
		for (let waited = 0; waited < 10000; waited += 200) {
			await settle(200);
			if (!localStorage.getItem('card-web-pending-multi-edit-v1')) break;
		}
		assert.strictEqual(localStorage.getItem('card-web-pending-multi-edit-v1'), null, 'the paused edit was resumed and cleared');
		const server = await serverDoc(id);
		assert.ok(server.exists() && server.data().body.includes('typed while queued'), `the edit reached the created card: ${server.data()?.body}`);
	});

	it('a QUEUED creation keeps the echoed card: it is what the replay will create', async () => {
		queue.setAuxWriteAttemptTimeoutForTesting(150);
		MultiBatch.prototype.commit = () => new Promise(() => { /* never answers */ });
		const {creation, id} = await startCreation();
		await creation;
		assert.ok(selectRawCards(store.getState())[id], 'the card stays in the store');
		assert.ok(queue.readPendingAuxWrites().some(intent => intent.cardID === id), 'the intent is still queued for replay');
		assert.ok(whatUserWasTold(store).some(text => /created automatically when the connection recovers/.test(text)), 'the user is told it will be created');
	});
});

/*eslint-env node, es2022*/

import assert from 'node:assert/strict';
import {bootstrapApp, clearAuxQueue} from '../harness-support/app-harness.js';

const {store, db, dom, firestore} = await bootstrapApp();
const {bulkCreateWorkingNotes} = await import('../../lib/src/actions/data.js');
const {openBulkImportDialog, commitBulkImport} = await import('../../lib/src/actions/bulk-import.js');
const {MultiBatch} = await import('../../lib/src/multi_batch.js');
const {readPendingAuxWrites} = await import('../../lib/src/aux-write-queue.js');
const {writeCorpusWorkerMode} = await import('../../lib/src/corpus-mode.js');

const draft = ['<p>New unsaved draft</p>'];
const setDraft = () => store.dispatch({type: 'BULK_IMPORT_SET_BODIES', bodies: draft,
	importer: 'google-docs-flat', importerVersion: 1});
const selectOtherCards = () => {
	store.dispatch({type: 'CLEAR_SELECTED_CARDS'});
	store.dispatch({type: 'SELECT_CARDS', cards: ['new-selection']});
};

describe('bulk import session ownership (real thunk and executor)', () => {
	let user;
	before(() => {
		globalThis.location = dom.window.location;
		globalThis.history = dom.window.history;
	});
	beforeEach(async () => {
		store.addReducers({
			collection: (await import('../../lib/src/reducers/collection.js')).default,
			bulkImport: (await import('../../lib/src/reducers/bulk-import.js')).default,
		});
		clearAuxQueue();
		user = store.getState().user.user;
		store.dispatch({type: 'UPDATE_CORPUS_STATUS', status: 'live', message: ''});
		store.dispatch({type: 'UPDATE_USER_PERMISSIONS', permissions: {admin: true}});
		store.dispatch(openBulkImportDialog('import'));
		writeCorpusWorkerMode('on');
	});
	afterEach(() => {
		store.dispatch({type: 'SIGNIN_SUCCESS', user});
		store.dispatch({type: 'CLEAR_SELECTED_CARDS'});
		clearAuxQueue();
		writeCorpusWorkerMode('on');
	});

	it('a pending import refuses repeated activation and disables its rendered button', async () => {
		await import('../../lib/src/components/bulk-import-dialog.js');
		setDraft();
		const element = document.createElement('bulk-import-dialog');
		document.body.appendChild(element);
		await element.updateComplete;
		const originalCommit = MultiBatch.prototype.commit;
		let release;
		const paused = new Promise(resolve => { release = resolve; });
		MultiBatch.prototype.commit = async function() {
			await paused;
			return originalCommit.call(this);
		};
		const running = store.dispatch(commitBulkImport());
		try {
			await element.updateComplete;
			assert.equal(store.getState().bulkImport.pending, true);
			const button = element.shadowRoot.querySelector('button[aria-label="Import these cards"]');
			assert.equal(button.disabled, true, 'a focused button must not accept a second keyboard activation');
			//The action guard is independently necessary for an event from the
			//previous render; a disabled-control assertion alone cannot prove it.
			await store.dispatch(commitBulkImport());
			const queued = readPendingAuxWrites();
			assert.equal(queued.length, 1, 'one pasted body must create exactly one durable intent');
			release();
			await running;
			assert.deepEqual(Object.keys(store.getState().collection.selectedCards), [queued[0].cardID]);
			assert.equal((await firestore.getDoc(firestore.doc(db, 'cards', queued[0].cardID))).exists(), true);
		} finally {
			release();
			await running;
			MultiBatch.prototype.commit = originalCommit;
			element.remove();
		}
	});

	it('a same-account profile refresh preserves both the draft and a running import', async () => {
		setDraft();
		const before = store.getState().bulkImport;
		store.dispatch({type: 'SIGNIN_SUCCESS', user: {...user, displayName: 'Profile refreshed'}});
		assert.deepEqual(store.getState().bulkImport, before, 'profile enrichment is not an account switch');
		const originalCommit = MultiBatch.prototype.commit;
		MultiBatch.prototype.commit = async function() {
			store.dispatch({type: 'SIGNIN_SUCCESS', user: {...user, displayName: 'Refreshed during save'}});
			return originalCommit.call(this);
		};
		try {
			await store.dispatch(bulkCreateWorkingNotes(draft));
			assert.equal(store.getState().bulkImport.open, false, 'the original operation must still finish its own dialog');
			assert.equal(Object.keys(store.getState().collection.selectedCards).length, 1);
		} finally {
			MultiBatch.prototype.commit = originalCommit;
		}
	});

	//Hold the REAL executor at its commit, then let the user change sessions.
	//Success still writes to the emulator; queued failures retain the intent.
	for (const queued of [false, true]) {
		for (const changedAccount of [false, true]) {
			it(`${queued ? 'queued' : 'committed'} old import cannot overwrite ${changedAccount ? 'another account' : 'a reopened dialog'}`, async () => {
				const originalCommit = MultiBatch.prototype.commit;
				const onlineDescriptor = Object.getOwnPropertyDescriptor(navigator, 'onLine');
				let release;
				const paused = new Promise(resolve => { release = resolve; });
				let reached;
				const atCommit = new Promise(resolve => { reached = resolve; });
				MultiBatch.prototype.commit = async function() {
					reached();
					await paused;
					if (queued) throw new Error('Simulated offline commit');
					return originalCommit.call(this);
				};
				Object.defineProperty(navigator, 'onLine', {configurable: true, value: !queued});
				const body = `<p>old-private-import-${Date.now()}</p>`;
				const running = store.dispatch(bulkCreateWorkingNotes([body]));
				try {
					await atCommit;
					const oldID = store.getState().data.pendingNewCardID;
					if (changedAccount) {
						store.dispatch({type: 'SIGNOUT_SUCCESS'});
						store.dispatch({type: 'SIGNIN_SUCCESS', user: {...user, uid: 'other-import-user'}});
					} else {
						store.dispatch({type: 'BULK_IMPORT_DIALOG_CLOSE'});
					}
					store.dispatch({type: 'BULK_IMPORT_DIALOG_OPEN', mode: 'import'});
					setDraft();
					selectOtherCards();
					const newerDialog = store.getState().bulkImport;
					const path = location.href;
					release();
					await running;
					assert.deepEqual(store.getState().bulkImport, newerDialog,
						'late progress/outcome/success cannot clear a newer draft, close it, or expose old bodies');
					assert.deepEqual(Object.keys(store.getState().collection.selectedCards), ['new-selection']);
					assert.equal(location.href, path, 'an older import cannot navigate the new session');
					if (queued) {
						assert.ok(readPendingAuxWrites().some(intent => intent.cardID === oldID), 'the detached write remains durable');
					} else {
						assert.equal((await firestore.getDoc(firestore.doc(db, 'cards', oldID))).data().body, body,
							'detaching UI does not cancel the accepted creation');
					}
				} finally {
					release();
					await running;
					MultiBatch.prototype.commit = originalCommit;
					if (onlineDescriptor) Object.defineProperty(navigator, 'onLine', onlineDescriptor);
					else delete navigator.onLine;
				}
			});
		}
	}

	it('rechecks session ownership after waiting for committed cards to arrive', async () => {
		writeCorpusWorkerMode('off'); //Hold listener delivery after a real commit.
		const body = `<p>arrival-session-${Date.now()}</p>`;
		let changed = false;
		let newerDialog;
		let delivered;
		const delivery = new Promise(resolve => { delivered = resolve; });
		const unsubscribe = store.subscribe(() => {
			if (changed || store.getState().bulkImport.progress?.committed !== 1) return;
			changed = true;
			//The progress dispatch precedes the arrival await. A timer yields
			//until that await, then reopens and delivers the withheld server card.
			setTimeout(async () => {
				const id = store.getState().data.pendingNewCardID;
				const snap = await firestore.getDoc(firestore.doc(db, 'cards', id));
				store.dispatch({type: 'BULK_IMPORT_DIALOG_CLOSE'});
				store.dispatch({type: 'BULK_IMPORT_DIALOG_OPEN', mode: 'import'});
				setDraft();
				selectOtherCards();
				newerDialog = store.getState().bulkImport;
				store.dispatch({type: 'UPDATE_CARDS', cards: {[id]: {...snap.data(), id}}, fetchType: 'unpublished'});
				delivered();
			}, 0);
		});
		try {
			await store.dispatch(bulkCreateWorkingNotes([body]));
			await delivery;
			assert.ok(changed, 'the test must reach the post-commit arrival phase');
			assert.deepEqual(store.getState().bulkImport, newerDialog);
			assert.deepEqual(Object.keys(store.getState().collection.selectedCards), ['new-selection']);
		} finally {
			unsubscribe();
		}
	});
});

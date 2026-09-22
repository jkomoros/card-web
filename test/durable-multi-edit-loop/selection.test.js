/*eslint-env node, es2022*/

import assert from 'assert';
import {bootstrapApp, wireCard, clearWhatUserWasTold, whatUserWasTold, makeCorpusLive} from '../harness-support/app-harness.js';

const {store, db, uid, firestore} = await bootstrapApp();
const {doc, setDoc, getDoc} = firestore;
const {default: collectionReducer} = await import('../../lib/src/reducers/collection.js');
const {default: multieditReducer} = await import('../../lib/src/reducers/multiedit.js');
const {commitMultiEditDialog, openMultiEditDialog} = await import('../../lib/src/actions/multiedit.js');
store.addReducers({collection: collectionReducer, multiedit: multieditReducer});

describe('multi-edit selection at the action boundary', function() {
	this.timeout(120000);
	afterEach(async () => {
		//The original action did not return the executor promise. Drain it even
		//when testing that broken version, so one expected failure cannot leave
		//a running operation that contaminates the next regression case.
		for (let i = 0; store.getState().data.pendingModifications && i < 1000; i++) {
			await new Promise(resolve => setTimeout(resolve, 10));
		}
		assert.equal(store.getState().data.pendingModifications, false);
		localStorage.removeItem('card-web-pending-multi-edit-v1');
		localStorage.removeItem('card-web-pending-bulk-tag-operation-v1');
	});
	for (const mixed of [false, true]) {
		it(`refuses a partially loaded ${mixed ? 'mixed' : 'tag-only'} selection without saving a subset`, async () => {
			clearWhatUserWasTold(store);
			makeCorpusLive(store);
			localStorage.removeItem('card-web-pending-multi-edit-v1');
			localStorage.removeItem('card-web-pending-bulk-tag-operation-v1');
			const prefix = `selection-${Date.now()}-${mixed}`;
			const cards = ['loaded', 'missing'].map(suffix => ({...wireCard(`${prefix}-${suffix}`, uid), id: `${prefix}-${suffix}`}));
			for (const card of cards) await setDoc(doc(db, 'cards', card.id), card);
			store.dispatch({type: 'UPDATE_CARDS', cards: {[cards[0].id]: cards[0]}, fetchType: 'unpublished'});
			store.dispatch({type: 'CLEAR_SELECTED_CARDS'});
			store.dispatch({type: 'SELECT_CARDS', cards: cards.map(card => card.id)});
			store.dispatch(openMultiEditDialog());
			store.dispatch({type: 'MULTI_EDIT_DIALOG_ADD_TAG', tagID: 'bits-and-bobs'});
			if (mixed) store.dispatch({type: 'MULTI_EDIT_DIALOG_ADD_TODO_DISABLEMENT', todo: 'prioritized'});

			//Invoke the action directly, as a stale rendered button could. The
			//server holds both cards; only the tab's local copy is incomplete.
			await store.dispatch(commitMultiEditDialog());

			assert.ok(whatUserWasTold(store).some(message => /selected cards have not loaded/.test(message)),
				'the action must explain why it refused before reaching either executor');
			assert.equal(store.getState().multiedit.open, true);
			assert.deepEqual(store.getState().multiedit.addTags, ['bits-and-bobs']);
			assert.equal(localStorage.getItem('card-web-pending-multi-edit-v1'), null);
			assert.equal(localStorage.getItem('card-web-pending-bulk-tag-operation-v1'), null);
			for (const card of cards) assert.deepEqual((await getDoc(doc(db, 'cards', card.id))).data().tags, []);
		});
	}
});

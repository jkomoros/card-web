/*eslint-env node, es2022*/

import assert from 'node:assert/strict';
import {bootstrapApp, wireCard, makeCorpusLive, clearWhatUserWasTold, whatUserWasTold} from '../harness-support/app-harness.js';

const {store, db, firestore, uid} = await bootstrapApp();
const {openMultiEditDialog, commitMultiEditDialog, closeMultiEditDialog} = await import('../../lib/src/actions/multiedit.js');
const {removeCards} = await import('../../lib/src/actions/data.js');
const {safePublishedRemovals} = await import('../../lib/src/worker/published-removals.js');
const selectors = await import('../../lib/src/selectors.js');
//Keep the probes runnable against the pre-fix selectors for source-revert
//verification: failures must demonstrate narrowed intent, not missing exports.
const selectMultiEditCards = selectors.selectMultiEditCards || selectors.selectSelectedCards;
const selectMultiEditCardsMissingCount = selectors.selectMultiEditCardsMissingCount || selectors.selectSelectedCardsMissingCount;
const selectMultiEditCardsTagsUnion = selectors.selectMultiEditCardsTagsUnion || selectors.selectSelectedCardsTagsUnion;
const {default: collectionReducer} = await import('../../lib/src/reducers/collection.js');
const {default: multieditReducer} = await import('../../lib/src/reducers/multiedit.js');
store.addReducers({collection: collectionReducer, multiedit: multieditReducer});

const put = cards => store.dispatch({type: 'UPDATE_CARDS', cards: Object.fromEntries(cards.map(card => [card.id, card])), fetchType: 'unpublished'});
let serial = 0;
const seed = async () => {
	const id = `selection-lifetime-${Date.now()}-${serial++}`;
	const card = {...wireCard(id, uid), id, published: true};
	await firestore.setDoc(firestore.doc(db, 'cards', id), card);
	put([card]);
	return card;
};
const select = ids => {
	store.dispatch({type: 'CLEAR_SELECTED_CARDS'});
	store.dispatch({type: 'SELECT_CARDS', cards: ids});
};

describe('multi-edit target lifetime', function() {
	this.timeout(30000);
	let user;
	beforeEach(() => {
		user = store.getState().user.user;
		makeCorpusLive(store);
		store.dispatch({type: 'UPDATE_USER_PERMISSIONS', permissions: {admin: true}});
		clearWhatUserWasTold(store);
	});
	afterEach(() => {
		store.dispatch(closeMultiEditDialog());
		store.dispatch({type: 'SIGNIN_SUCCESS', user});
		store.dispatch({type: 'UPDATE_USER_PERMISSIONS', permissions: {}});
		select([]);
	});

	it('preserves both targets when publication removal precedes arrival by more than three seconds', async () => {
		const cards = await Promise.all([seed(), seed()]);
		select(cards.map(card => card.id));
		store.dispatch(openMultiEditDialog());
		store.dispatch({type: 'MULTI_EDIT_DIALOG_ADD_TODO_DISABLEMENT', todo: 'prioritized'});
		await firestore.updateDoc(firestore.doc(db, 'cards', cards[1].id), {published: false});
		//Use the real worker-side removal decision and real delayed main-thread
		//removal action, in the ordering two independent listeners can deliver.
		const removed = safePublishedRemovals([cards[1].id], new Map(cards.map(card => [card.id, card])));
		store.dispatch(removeCards(removed, false));
		await new Promise(resolve => setTimeout(resolve, 3150));
		assert.equal(selectMultiEditCardsMissingCount(store.getState()), 1);
		await store.dispatch(commitMultiEditDialog());
		assert.ok(whatUserWasTold(store).some(message => /selected cards have not loaded/.test(message)));
		assert.deepEqual((await firestore.getDoc(firestore.doc(db, 'cards', cards[0].id))).data().auto_todo_overrides, {});
		const arrived = await firestore.getDoc(firestore.doc(db, 'cards', cards[1].id));
		put([{...arrived.data(), id: cards[1].id}]);
		assert.equal(selectMultiEditCardsMissingCount(store.getState()), 0);
		assert.deepEqual(selectMultiEditCards(store.getState()).map(card => card.id), cards.map(card => card.id));
		await store.dispatch(commitMultiEditDialog());
		for (const card of cards) assert.equal((await firestore.getDoc(firestore.doc(db, 'cards', card.id))).data().auto_todo_overrides.prioritized, false);
	});

	it('keeps dialog membership and tag controls stable when the surrounding selection changes', async () => {
		const original = await seed();
		const unrelated = {...await seed(), tags: ['unrelated']};
		put([unrelated]);
		select([original.id]);
		store.dispatch(openMultiEditDialog());
		select([unrelated.id]);
		assert.deepEqual(selectMultiEditCards(store.getState()).map(card => card.id), [original.id]);
		assert.deepEqual(selectMultiEditCardsTagsUnion(store.getState()), []);
		store.dispatch({type: 'REMOVE_CARDS', cardIDs: [original.id]});
		assert.equal(selectMultiEditCardsMissingCount(store.getState()), 1);
		assert.deepEqual(selectMultiEditCards(store.getState()), [], 'missing final target must not widen to the collection');
	});

	it('preserves a same-account profile refresh but detaches another account', async () => {
		const card = await seed();
		select([card.id]);
		store.dispatch(openMultiEditDialog());
		store.dispatch({type: 'MULTI_EDIT_DIALOG_ADD_TODO_DISABLEMENT', todo: 'prioritized'});
		const before = store.getState().multiedit;
		store.dispatch({type: 'SIGNIN_SUCCESS', user: {...user, displayName: 'Profile refreshed'}});
		assert.deepEqual(store.getState().multiedit, before);
		store.dispatch({type: 'SIGNIN_SUCCESS', user: {...user, uid: 'different-selection-account'}});
		assert.equal(store.getState().multiedit.open, false);
		assert.equal(store.getState().multiedit.targetIDs, null);
		await store.dispatch(commitMultiEditDialog());
		assert.deepEqual((await firestore.getDoc(firestore.doc(db, 'cards', card.id))).data().auto_todo_overrides, {});
	});

	it('a resumed dialog displays its saved targets instead of a newer selection', async () => {
		const saved = await seed();
		const current = {...await seed(), tags: ['newer-selection']};
		put([current]);
		select([current.id]);
		store.dispatch(openMultiEditDialog([saved.id]));
		assert.deepEqual(selectMultiEditCards(store.getState()).map(card => card.id), [saved.id]);
		assert.deepEqual(selectMultiEditCardsTagsUnion(store.getState()), []);
	});
});

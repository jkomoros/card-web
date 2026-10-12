/*eslint-env node, es2022*/

//The blank-card race, with the real reducers and the real server: a card is
//created (revision 1, empty body), its body is saved (revision 2), and then
//the OLDER create image arrives late — the shape a delayed listener snapshot
//takes in production. On master every holder applied whichever image came
//last, so the saved card rendered empty until the next delivery. With the
//revision clock the late image is refused at the store, at the enqueued
//buckets, and at the editor base.

import assert from 'assert';
import {bootstrapApp, wireCard} from '../harness-support/app-harness.js';

const {store, db, uid, firestore} = await bootstrapApp();
const {doc, getDoc, serverTimestamp} = firestore;
const {receiveCards} = await import('../../lib/src/actions/data.js');
const {MultiBatch} = await import('../../lib/src/multi_batch.js');
const {UPDATE_CARDS, EDITING_START, EDITING_UPDATE_UNDERLYING_CARD} = await import('../../lib/src/actions.js');
const {selectRawCards, selectEditingUnderlyingCardSnapshot} = await import('../../lib/src/selectors.js');
store.addReducers({collection: (await import('../../lib/src/reducers/collection.js')).default});
store.addReducers({editor: (await import('../../lib/src/reducers/editor.js')).default});

let sequence = 0;
const nextID = () => `revision-admission-${Date.now()}-${sequence++}`;
const serverCard = async id => ({...(await getDoc(doc(db, 'cards', id))).data(), id});
const held = id => selectRawCards(store.getState())[id];

describe('revision admission (real reducers, real server revisions)', function() {
	this.timeout(30000);

	const createAndSave = async () => {
		const id = nextID();
		const create = new MultiBatch(db);
		create.set(doc(db, 'cards', id), {...wireCard(id, uid), body: '', updated: serverTimestamp()});
		await create.commit();
		const createImage = await serverCard(id);
		assert.strictEqual(createImage.revision, 1, 'MultiBatch set starts the clock at 1');
		store.dispatch(receiveCards({[id]: createImage}, 'unpublished'));
		const save = new MultiBatch(db);
		save.update(doc(db, 'cards', id), {body: '<p>saved body</p>', updated: serverTimestamp()});
		await save.commit();
		const savedImage = await serverCard(id);
		assert.strictEqual(savedImage.revision, 2, 'a content update advances it by one');
		store.dispatch(receiveCards({[id]: savedImage}, 'unpublished'));
		assert.strictEqual(held(id).body, '<p>saved body</p>');
		return {id, createImage, savedImage};
	};

	it('a late create image cannot blank a saved card in the store', async () => {
		const {id, createImage} = await createAndSave();
		store.dispatch(receiveCards({[id]: createImage}, 'unpublished'));
		assert.strictEqual(held(id).body, '<p>saved body</p>', 'the older image was refused');
		assert.strictEqual(held(id).revision, 2);
		//A direct reducer dispatch (the enqueued-bucket flush path) is backstopped too.
		store.dispatch({type: UPDATE_CARDS, cards: {[id]: createImage}, fetchType: 'unpublished'});
		assert.strictEqual(held(id).body, '<p>saved body</p>');
	});

	it('an equal-revision image (the listener refresh of an echo) and a newer one still apply', async () => {
		const {id, savedImage} = await createAndSave();
		store.dispatch(receiveCards({[id]: {...savedImage, title: 'refreshed'}}, 'unpublished'));
		assert.strictEqual(held(id).title, 'refreshed');
		const again = new MultiBatch(db);
		again.update(doc(db, 'cards', id), {body: '<p>third</p>', updated: serverTimestamp()});
		await again.commit();
		store.dispatch(receiveCards({[id]: await serverCard(id)}, 'unpublished'));
		assert.strictEqual(held(id).body, '<p>third</p>');
		assert.strictEqual(held(id).revision, 3);
	});

	it('the editor base refuses an older image of the card being edited', async () => {
		const {createImage, savedImage} = await createAndSave();
		store.dispatch({type: EDITING_START, card: savedImage});
		store.dispatch({type: EDITING_UPDATE_UNDERLYING_CARD, updatedUnderlyingCard: createImage});
		assert.strictEqual(selectEditingUnderlyingCardSnapshot(store.getState()).body, '<p>saved body</p>');
		store.dispatch({type: EDITING_UPDATE_UNDERLYING_CARD, updatedUnderlyingCard: {...savedImage, title: 'newer'}});
		assert.strictEqual(selectEditingUnderlyingCardSnapshot(store.getState()).title, 'newer');
	});

	it('legacy images without a revision still apply to each other, as on master', async () => {
		const id = nextID();
		//wireCard carries the create executor's placeholder id; these images
		//stand for cards already on the server, so they carry the real one.
		const legacyA = {...wireCard(id, uid), id, body: '<p>a</p>'};
		const legacyB = {...wireCard(id, uid), id, body: '<p>b</p>'};
		store.dispatch(receiveCards({[id]: legacyA}, 'unpublished'));
		store.dispatch(receiveCards({[id]: legacyB}, 'unpublished'));
		assert.strictEqual(held(id).body, '<p>b</p>');
	});
});

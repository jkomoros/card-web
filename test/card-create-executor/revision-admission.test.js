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
const {EDITING_START, EDITING_UPDATE_UNDERLYING_CARD, MODIFY_CARD, MODIFY_CARD_SUCCESS, CLEAR_ENQUEUED_CARD_UPDATES} = await import('../../lib/src/actions.js');
const {selectRawCards, selectEditingUnderlyingCardSnapshot} = await import('../../lib/src/selectors.js');
const {CARD_FILTER_FUNCS} = await import('../../lib/src/filters.js');
store.addReducers({collection: (await import('../../lib/src/reducers/collection.js')).default});
store.addReducers({editor: (await import('../../lib/src/reducers/editor.js')).default});

let sequence = 0;
const nextID = () => `revision-admission-${Date.now()}-${sequence++}`;
const serverCard = async id => ({...(await getDoc(doc(db, 'cards', id))).data(), id});
const held = id => selectRawCards(store.getState())[id];
//The collection reducer consumes the same UPDATE_CARDS: every card-derived
//filter must agree with the card the store holds, or a card vanishes from
//collections while rendering fine on its own.
const filterDisagreements = id => {
	const card = held(id);
	const filters = store.getState().collection.filters;
	return Object.entries(CARD_FILTER_FUNCS)
		.filter(([name, {func}]) => Boolean(func(card)) !== Boolean(filters[name]?.[id]))
		.map(([name]) => name);
};

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
		assert.deepStrictEqual(filterDisagreements(id), []);
	});

	it('the per-fetch-type flush of gated deliveries cannot apply an older bucket over a newer one, and the filters agree', async () => {
		//While a modification is pending, deliveries for its targets are
		//gated into buckets keyed by fetch type and flushed one bucket at a
		//time; a bucket flushed later can hold an older revision. The thunk
		//admits each bucket against the store, so both reducers see the
		//same map (the review found a reducer-only backstop left the filters
		//indexing the refused image).
		const {id, createImage, savedImage} = await createAndSave();
		const publishedImage = {...savedImage, published: true, revision: 3};
		store.dispatch({type: MODIFY_CARD, modificationCount: 5, cardIDs: [id]});
		store.dispatch(receiveCards({[id]: {...createImage, revision: 2}}, 'unpublished'));
		store.dispatch(receiveCards({[id]: publishedImage}, 'published'));
		store.dispatch({type: MODIFY_CARD_SUCCESS, modificationCount: 5});
		//The next delivery flushes the leftovers, one bucket at a time.
		store.dispatch(receiveCards({}, 'unpublished'));
		assert.strictEqual(held(id).revision, 3, 'the newer bucket wins regardless of flush order');
		assert.strictEqual(held(id).published, true);
		assert.deepStrictEqual(filterDisagreements(id), [], 'collection filters index exactly the held card');
		store.dispatch({type: CLEAR_ENQUEUED_CARD_UPDATES});
	});

	it('receiveCards refuses an older image against a newer gated bucket, not just the store', async () => {
		//Only receiveCards sees the buckets: with admission there mutated out,
		//a stale delivery would overwrite the newer bucket entry and the flush
		//would then apply it over the store.
		const {id, createImage, savedImage} = await createAndSave();
		store.dispatch({type: MODIFY_CARD, modificationCount: 5, cardIDs: [id]});
		store.dispatch(receiveCards({[id]: {...savedImage, title: 'third', revision: 3}}, 'unpublished'));
		store.dispatch(receiveCards({[id]: {...createImage, revision: 2, title: 'stale'}}, 'unpublished'));
		assert.strictEqual(store.getState().data.enqueuedCards.unpublished[id].revision, 3, 'the bucket keeps the newer image');
		store.dispatch({type: MODIFY_CARD_SUCCESS, modificationCount: 5});
		store.dispatch(receiveCards({}, 'unpublished'));
		assert.strictEqual(held(id).title, 'third');
		assert.strictEqual(held(id).revision, 3);
		store.dispatch({type: CLEAR_ENQUEUED_CARD_UPDATES});
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

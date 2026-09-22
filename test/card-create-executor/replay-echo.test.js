/*eslint-env node, es2022*/
import assert from 'assert';
import {bootstrapApp, clearAuxQueue, seedQueuedIntent, wireCard} from '../harness-support/app-harness.js';

const {store, db, uid, firestore} = await bootstrapApp();
const {doc, setDoc, getDoc, updateDoc} = firestore;
const {receiveCards, reorderCard} = await import('../../lib/src/actions/data.js');
const queue = await import('../../lib/src/aux-write-queue.js');
const {MultiBatch} = await import('../../lib/src/multi_batch.js');
const {writeCorpusWorkerMode, readCorpusWorkerMode} = await import('../../lib/src/corpus-mode.js');
const {selectUserMayReorderActiveCollection, selectUserMayViewUnpublished} = await import('../../lib/src/selectors.js');
store.addReducers({collection: (await import('../../lib/src/reducers/collection.js')).default});

let sequence = 0;
const nextID = () => `replay-echo-${Date.now()}-${sequence++}`;
const payloadFor = (id, extra = {}) => ({kind: 'card-create', card: wireCard(id, uid), section: '', sectionUpdateKey: '', ...extra});
const create = (id, payload) => queue.runDurableAuxWrite(queue.makeAuxWriteIntent(uid, 'card-create', id, '', payload));
const replay = async (id, payload) => {
	seedQueuedIntent(queue.makeAuxWriteIntent(uid, 'card-create', id, '', payload));
	await queue.replayPendingAuxWrites(uid);
	assert.equal(queue.readPendingAuxWrites().length, 0, 'replay must complete, not merely avoid changes by failing');
};
const serverCard = async id => ({...(await getDoc(doc(db, 'cards', id))).data(), id});
const deliver = async id => store.dispatch(receiveCards({[id]: await serverCard(id)}, 'unpublished'));

describe('creation replay and reorder preserve newer data (real executors)', function() {
	this.timeout(30000);
	let previousMode;
	let originalCommit;
	let previousUser;
	let previousPermissions;
	beforeEach(() => {
		previousMode = readCorpusWorkerMode();
		previousUser = store.getState().user.user;
		previousPermissions = store.getState().user.userPermissions;
		writeCorpusWorkerMode('shadow');
		originalCommit = MultiBatch.prototype.commit;
		clearAuxQueue();
		store.dispatch({type: 'SIGNIN_SUCCESS', user: {uid, isAnonymous: false, photoURL: '', displayName: 'Harness', email: 'harness@example.com'}});
		store.dispatch({type: 'UPDATE_USER_PERMISSIONS', permissions: {admin: true}});
		store.dispatch({type: 'UPDATE_CORPUS_STATUS', status: 'live', message: ''});
	});
	afterEach(() => {
		MultiBatch.prototype.commit = originalCommit;
		store.dispatch({type: 'SIGNIN_SUCCESS', user: previousUser});
		store.dispatch({type: 'UPDATE_USER_PERMISSIONS', permissions: previousPermissions});
		writeCorpusWorkerMode(previousMode);
		clearAuxQueue();
	});

	it('replay preserves the newer local body and removed tag, section and reference memberships', async () => {
		const id = nextID(), tag = nextID(), section = nextID(), origin = nextID();
		await setDoc(doc(db, 'tags', tag), {cards: [], title: 'Tag'});
		await setDoc(doc(db, 'sections', section), {cards: [], title: 'Section'});
		await setDoc(doc(db, 'cards', origin), wireCard(origin, uid));
		const payload = payloadFor(id, {
			card: wireCard(id, uid, {tags: [tag], section, references: {[origin]: true}, references_info: {[origin]: {'fork-of': ''}}}),
			section, sectionUpdateKey: nextID(), tagUpdateKeys: {[tag]: nextID()}, deriveInboundLinks: true,
		});
		assert.equal(await create(id, payload), 'committed');
		await updateDoc(doc(db, 'cards', id), {body: '<p>A later edit to keep</p>', tags: [], section: '', references: {}, references_info: {}});
		await updateDoc(doc(db, 'tags', tag), {cards: []});
		await updateDoc(doc(db, 'sections', section), {cards: []});
		await updateDoc(doc(db, 'cards', origin), {references_inbound: {}, references_info_inbound: {}});
		await deliver(id);
		await replay(id, payload);
		assert.equal(store.getState().data.cards[id].body, '<p>A later edit to keep</p>');
		assert.deepEqual(store.getState().data.cards[id].tags, []);
		assert.deepEqual((await getDoc(doc(db, 'tags', tag))).data().cards, []);
		assert.deepEqual((await getDoc(doc(db, 'sections', section))).data().cards, []);
		assert.deepEqual((await serverCard(origin)).references_inbound, {});
	});

	it('repairs missing fanout and confirms authoritative section identity', async () => {
		const id = nextID(), tag = nextID(), section = nextID(), origin = nextID();
		const payload = payloadFor(id, {
			card: wireCard(id, uid, {tags: [tag], section, references: {[origin]: true}, references_info: {[origin]: {'fork-of': ''}}}),
			section, sectionUpdateKey: nextID(), tagUpdateKeys: {[tag]: nextID()}, deriveInboundLinks: true,
		});
		await setDoc(doc(db, 'tags', tag), {cards: [], title: 'Tag'});
		await setDoc(doc(db, 'sections', section), {cards: [], title: 'Section'});
		await setDoc(doc(db, 'cards', origin), wireCard(origin, uid));
		await setDoc(doc(db, 'cards', id), {...payload.card, body: '<p>Keep current content while repairing</p>'});
		await replay(id, payload);
		assert.equal((await serverCard(id)).body, '<p>Keep current content while repairing</p>');
		assert.ok((await getDoc(doc(db, 'tags', tag))).data().cards.includes(id));
		assert.ok((await getDoc(doc(db, 'sections', section))).data().cards.includes(id));
		assert.equal(store.getState().data.sections[section].id, section, 'server section IDs must be restored for collection tabs');
		assert.ok((await serverCard(origin)).references_inbound[id]);
	});

	it('replay cannot restore membership removed after its preflight read', async () => {
		const id = nextID(), tag = nextID();
		await setDoc(doc(db, 'tags', tag), {cards: [], title: 'Tag'});
		const payload = payloadFor(id, {card: wireCard(id, uid, {tags: [tag]}), tagUpdateKeys: {[tag]: nextID()}});
		assert.equal(await create(id, payload), 'committed');
		MultiBatch.prototype.commit = async function() {
			await updateDoc(doc(db, 'cards', id), {tags: []});
			await updateDoc(doc(db, 'tags', tag), {cards: []});
			return originalCommit.call(this);
		};
		seedQueuedIntent(queue.makeAuxWriteIntent(uid, 'card-create', id, '', payload));
		await queue.replayPendingAuxWrites(uid);
		assert.deepEqual((await getDoc(doc(db, 'tags', tag))).data().cards, []);
		assert.ok(queue.readPendingAuxWrites().some(intent => intent.cardID === id), 'a changed preflight retains its repair intent');
		MultiBatch.prototype.commit = originalCommit;
		await queue.replayPendingAuxWrites(uid);
		assert.equal(queue.readPendingAuxWrites().length, 0, 'a fresh preflight can finish without resurrecting the tag');
		assert.deepEqual((await getDoc(doc(db, 'tags', tag))).data().cards, []);
	});

	it('replay fences a reference-type change even when reference labels are empty', async () => {
		const id = nextID(), origin = nextID();
		await setDoc(doc(db, 'cards', origin), wireCard(origin, uid));
		const payload = payloadFor(id, {
			card: wireCard(id, uid, {references: {[origin]: true}, references_info: {[origin]: {'fork-of': ''}}}),
			deriveInboundLinks: true,
		});
		assert.equal(await create(id, payload), 'committed');
		MultiBatch.prototype.commit = async function() {
			await updateDoc(doc(db, 'cards', id), {references_info: {[origin]: {generic: ''}}});
			await updateDoc(doc(db, 'cards', origin), {references_info_inbound: {[id]: {generic: ''}}});
			return originalCommit.call(this);
		};
		seedQueuedIntent(queue.makeAuxWriteIntent(uid, 'card-create', id, '', payload));
		await queue.replayPendingAuxWrites(uid);
		assert.deepEqual((await serverCard(origin)).references_info_inbound[id], {generic: ''});
		assert.ok(queue.readPendingAuxWrites().some(intent => intent.cardID === id));
	});

	it('creation confirms a newer body delivered before its commit acknowledgement', async () => {
		const id = nextID();
		MultiBatch.prototype.commit = async function() {
			await originalCommit.call(this);
			await updateDoc(doc(db, 'cards', id), {body: '<p>Concurrent content</p>'});
			await deliver(id);
		};
		assert.equal(await create(id, payloadFor(id)), 'committed');
		assert.equal(store.getState().data.cards[id].body, '<p>Concurrent content</p>');
	});

	it('permission revocation during creation suppresses private card and section echoes', async () => {
		const id = nextID(), section = nextID();
		await setDoc(doc(db, 'sections', section), {cards: [], title: 'Section'});
		store.dispatch({type: 'UPDATE_SECTIONS', sections: {[section]: {id: section, cards: [], title: 'Section'}}});
		MultiBatch.prototype.commit = async function() {
			await originalCommit.call(this);
			store.dispatch({type: 'UPDATE_USER_PERMISSIONS', permissions: {}});
			store.dispatch({type: 'REMOVE_CARDS', cardIDs: [id]});
		};
		assert.equal(await create(id, payloadFor(id, {card: wireCard(id, uid, {section}), section, sectionUpdateKey: nextID()})), 'committed');
		assert.equal(selectUserMayViewUnpublished(store.getState()), false);
		assert.equal(store.getState().data.cards[id], undefined);
		assert.deepEqual(store.getState().data.sections[section].cards, []);
	});

	const prepareReorder = async () => {
		const id = nextID(), other = nextID();
		for (const [index, key] of [id, other].entries()) {
			await setDoc(doc(db, 'cards', key), wireCard(key, uid, {sort_order: 100 + index * 100}));
			await deliver(key);
		}
		assert.ok(selectUserMayReorderActiveCollection(store.getState()), 'must exercise an allowed reorder');
		return {id, other};
	};
	it('reorder preserves concurrently delivered content', async () => {
		const {id, other} = await prepareReorder();
		MultiBatch.prototype.commit = async function() {
			await originalCommit.call(this);
			await updateDoc(doc(db, 'cards', id), {body: '<p>Content edited during reorder</p>'});
			await deliver(id);
		};
		await store.dispatch(reorderCard(id, other, true));
		assert.equal(store.getState().data.cards[id].body, '<p>Content edited during reorder</p>');
		assert.notEqual((await serverCard(id)).sort_order, 100, 'the reorder must actually commit');
	});

	it('reorder does not reinsert private cards after account changes', async () => {
		const {id, other} = await prepareReorder();
		MultiBatch.prototype.commit = async function() {
			await originalCommit.call(this);
			store.dispatch({type: 'SIGNOUT_SUCCESS'});
			store.dispatch({type: 'REMOVE_CARDS', cardIDs: [id]});
		};
		await store.dispatch(reorderCard(id, other, true));
		assert.equal(store.getState().data.cards[id], undefined);
		assert.notEqual((await serverCard(id)).sort_order, 100);
	});
});

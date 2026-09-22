/*eslint-env node, es2022*/
import assert from 'node:assert/strict';
import {bootstrapApp, clearAuxQueue, wireCard} from '../harness-support/app-harness.js';
const {store, db, uid, firestore: f} = await bootstrapApp();
const {modifyCardsIndividually, modifyCardsWithDurableMultiEdit, receiveCards} = await import('../../lib/src/actions/data.js');
const {MultiBatch, MultiBatchCommitError} = await import('../../lib/src/multi_batch.js');

let sequence = 0;
const seed = async () => {
	const id = `recovery-scope-${Date.now()}-${sequence++}`;
	const card = {...wireCard(id, uid), id};
	await f.setDoc(f.doc(db, 'cards', id), card);
	store.dispatch(receiveCards({[id]: card}, 'unpublished'));
	return card;
};

describe('shared write planner and recovery scope', () => {
	beforeEach(() => {
		clearAuxQueue();
		localStorage.removeItem('card-web-pending-multi-edit-v1');
		store.dispatch({type: 'UPDATE_USER_PERMISSIONS', permissions: {admin: true}});
		store.dispatch({type: 'UPDATE_CORPUS_STATUS', status: 'live', message: ''});
	});

	for (const durable of [false, true]) {
		for (const field of ['notes', 'commentary']) {
			it(`${durable ? 'durable' : 'suggestion'} save preserves a concurrent ${field} edit`, async () => {
				const card = await seed();
				const original = MultiBatch.prototype.commit;
				MultiBatch.prototype.commit = async function() {
					await f.updateDoc(f.doc(db, 'cards', card.id), {[field]: '<p>Keep this newer content</p>'});
					return original.call(this);
				};
				try {
					const update = {[field]: '<p>Older proposed content</p>'};
					await store.dispatch(durable ? modifyCardsWithDurableMultiEdit([card], update)
						: modifyCardsIndividually([card], {[card.id]: update}));
				} finally {
					MultiBatch.prototype.commit = original;
				}
				assert.equal((await f.getDoc(f.doc(db, 'cards', card.id))).data()[field], '<p>Keep this newer content</p>');
				assert.ok(store.getState().data.cardModificationError, 'conflict must be reported');
				localStorage.removeItem('card-web-pending-multi-edit-v1');
			});
		}
	}

	it('resumes an explicitly approved overwrite while retaining a split-operation planning base', async () => {
		const card = await seed();
		await f.updateDoc(f.doc(db, 'cards', card.id), {notes: 'Newer content explicitly approved for replacement'});
		const update = {notes: 'Approved replacement'};
		const key = 'card-web-pending-multi-edit-v1';
		localStorage.setItem(key, JSON.stringify({version: 1, id: `approved-${card.id}`, uid,
			targetIDs: [card.id], nextIndex: 0, modifiedCount: 0, update, substantive: false,
			kind: 'multi', baseFields: {[card.id]: {notes: card.notes}},
			oversizedBaseCards: {[card.id]: card}, overwriteAcknowledged: true}));
		await store.dispatch(modifyCardsWithDurableMultiEdit([], update, false, 'multi', [card.id]));
		assert.equal((await f.getDoc(f.doc(db, 'cards', card.id))).data().notes, update.notes);
		assert.equal(localStorage.getItem(key), null);
	});

	it('does not install private recovery data after sign-out during the server reread', async () => {
		const [target, a, b] = await Promise.all([seed(), seed(), seed()]);
		const user = store.getState().user.user;
		const commit = MultiBatch.prototype.commit;
		const settled = Promise.allSettled;
		let switched = false;
		MultiBatch.prototype.commit = async function() {
			await commit.call(this);
			Promise.allSettled = async promises => {
				const outcomes = await settled.call(Promise, promises);
				if (outcomes.some(outcome => outcome.status === 'fulfilled' && outcome.value?.id === target.id)) {
					switched = true;
					store.dispatch({type: 'SIGNOUT_SUCCESS'});
					store.dispatch({type: 'REMOVE_CARDS', cardIDs: [target.id, a.id, b.id]});
				}
				return outcomes;
			};
			throw new MultiBatchCommitError(1, [new Error('controlled partial failure')], [a.id], [b.id]);
		};
		try {
			const update = {references_diff: [{cardID: target.id, referenceType: 'generic', value: ''}]};
			await store.dispatch(modifyCardsIndividually([a, b], {[a.id]: update, [b.id]: update}));
			assert.ok(switched, 'must cross the real authoritative reread boundary');
			assert.equal(store.getState().data.cards[target.id], undefined);
		} finally {
			MultiBatch.prototype.commit = commit;
			Promise.allSettled = settled;
			store.dispatch({type: 'SIGNIN_SUCCESS', user});
		}
	});
});

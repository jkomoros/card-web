/*eslint-env node, es2022*/

import assert from 'assert';
import {bootstrapApp, clearAuxQueue} from '../harness-support/app-harness.js';
const {store, uid} = await bootstrapApp();
const {abandonPendingBulkTagOperation, retryPendingBulkTagOperation} = await import('../../lib/src/actions/data.js');
const {installModalHandler, uninstallModalHandler, cancelAllModals, resolveModal} = await import('../../lib/src/modal.js');
const {MultiBatch} = await import('../../lib/src/multi_batch.js');
const keys = {tag: 'card-web-pending-bulk-tag-operation-v1', multi: 'card-web-pending-multi-edit-v1'};
let serial = 0;
const recordFor = kind => ({
	version: 1, id: `confirm-lifecycle-${Date.now()}-${serial++}`, uid, targetIDs: ['confirm-target-one', 'confirm-target-two'], nextIndex: 0,
	...(kind === 'tag' ? {tag: 'confirm-tag', adding: true} : {modifiedCount: 0, update: {notes: 'pending draft'}, kind: 'multi', baseFields: {}}),
});
const pendingModal = () => {
	const request = store.getState().modal.requests.at(-1);
	assert.ok(request, 'must use the deferred in-app confirmation seam');
	return request;
};

describe('durable operation confirmations retain their reviewed scope', function() {
	this.timeout(120000);
	let originalUser, originalCommit;
	beforeEach(() => {
		clearAuxQueue();
		for (const key of Object.values(keys)) localStorage.removeItem(key);
		originalUser = store.getState().user.user;
		originalCommit = MultiBatch.prototype.commit;
		store.dispatch({type: 'UPDATE_USER_PERMISSIONS', permissions: {admin: true}});
		store.dispatch({type: 'UPDATE_CORPUS_STATUS', status: 'live', message: ''});
		installModalHandler('destructive-confirm');
	});
	afterEach(() => {
		cancelAllModals();
		uninstallModalHandler('destructive-confirm');
		MultiBatch.prototype.commit = originalCommit;
		store.dispatch({type: 'SIGNIN_SUCCESS', user: originalUser});
		for (const key of Object.values(keys)) localStorage.removeItem(key);
	});

	for (const confirmed of [false, true]) {
		it(`save-pill Stop ${confirmed ? 'shows the recovery draft after confirmation' : 'keeps the draft hidden after cancellation'}`, async () => {
			await import('../../lib/src/components/card-web-app.js');
			await import('../../lib/src/edit-draft.js');
			const operation = {...recordFor('multi'), kind: 'single', targetIDs: ['save-pill-draft']};
			const draftKey = `card-web-edit-draft-v2-${operation.targetIDs[0]}`;
			localStorage.setItem(keys.multi, JSON.stringify(operation));
			localStorage.setItem(draftKey, JSON.stringify({
				version: 1, uid, cardID: operation.targetIDs[0], operationID: operation.id,
				diff: operation.update, substantive: false, baseUpdated: null, savedAt: Date.now(),
			}));
			//Construct the real component without connecting it: the actual
			//handler and refresh execute, without global lifecycle listeners
			//masking a missing refresh by incidentally refreshing the banner.
			const element = document.createElement('card-web-app');
			try {
				await element._refreshDraftAvailability();
				assert.equal(element._draftAvailable, false, 'pending save owns its draft');
				const modalShown = new Promise(resolve => {
					const unsubscribe = store.subscribe(() => {
						const request = store.getState().modal.requests.at(-1);
						if (request) { unsubscribe(); resolve(request); }
					});
				});
				const stopping = element._stopRetryingSave();
				const request = await modalShown;
				//Give an incorrectly un-awaited dispatch time to finish its
				//premature refresh while the dialog remains open.
				await new Promise(resolve => setTimeout(resolve, 0));
				assert.equal(element._draftAvailable, false);
				resolveModal(request.id, {confirmed});
				await stopping;
				await new Promise(resolve => setTimeout(resolve, 0));
				assert.equal(element._draftAvailable, confirmed);
				assert.equal(localStorage.getItem(keys.multi) === null, confirmed);
				assert.notEqual(localStorage.getItem(draftKey), null, 'Stop and Cancel must both retain the recovery draft');
			} finally { localStorage.removeItem(draftKey); }
		});
	}

	for (const kind of ['tag', 'multi']) {
		it(`Stop ${kind} refuses when its retry starts while the confirmation is open`, async () => {
			localStorage.setItem(keys[kind], JSON.stringify(recordFor(kind)));
			const stopping = store.dispatch(abandonPendingBulkTagOperation());
			const request = pendingModal();
			MultiBatch.prototype.commit = async () => { throw new Error('Keep resumed operation paused'); };
			const resuming = store.dispatch(retryPendingBulkTagOperation());
			resolveModal(request.id, {confirmed: true});
			await stopping;
			assert.notEqual(localStorage.getItem(keys[kind]), null, 'must not clear an actively resumed operation');
			await resuming;
		});

		for (const corrupt of [false, true]) {
			for (const change of ['replacement', 'account', 'same-account', 'progress', 'other-operation']) {
				it(`Stop ${corrupt ? 'unreadable ' : ''}${kind} ${change === 'same-account' ? 'allows profile updates' : `refuses ${change} during confirmation`}`, async () => {
					const original = recordFor(kind);
					const raw = corrupt ? '{unreadable-old-intent' : JSON.stringify(original);
					localStorage.setItem(keys[kind], raw);
					const stopping = store.dispatch(abandonPendingBulkTagOperation());
					const request = pendingModal();
					let expected = raw;
					if (change === 'replacement' || change === 'progress') {
						expected = JSON.stringify({...original, ...(change === 'replacement' ? {id: `${original.id}-replacement`} : {nextIndex: 1})});
						localStorage.setItem(keys[kind], expected);
					} else if (change === 'other-operation') {
						const otherKind = kind === 'tag' ? 'multi' : 'tag';
						localStorage.setItem(keys[otherKind], JSON.stringify(recordFor(otherKind)));
					} else {
						store.dispatch({type: 'SIGNIN_SUCCESS', user: {...originalUser, uid: change === 'account' ? 'switched-account' : uid, displayName: 'Updated profile'}});
					}
					resolveModal(request.id, {confirmed: true});
					await stopping;
					assert.equal(localStorage.getItem(keys[kind]), change === 'same-account' ? null : expected);
				});
			}
		}
	}

	for (const corrupt of [false, true]) {
		for (const change of ['replacement', 'account', 'progress', 'same-account']) {
			it(`Retry ${corrupt ? 'discard' : 'overwrite'} confirmation ${change === 'same-account' ? 'allows profile updates' : `refuses ${change}`}`, async () => {
				const original = {...recordFor('multi'), lastError: 'Changed elsewhere after you saved: confirm-target-one (notes).'};
				const raw = corrupt ? '{unreadable-retry-intent' : JSON.stringify(original);
				localStorage.setItem(keys.multi, raw);
				//Keep a legitimately approved retry paused so its persisted
				//acknowledgement remains inspectable, without making server writes.
				MultiBatch.prototype.commit = async () => { throw new Error('Pause after approved retry'); };
				const retrying = store.dispatch(retryPendingBulkTagOperation());
				const request = pendingModal();
				let expected = raw;
				if (change === 'replacement' || change === 'progress') {
					expected = JSON.stringify({...original, ...(change === 'replacement' ? {id: `${original.id}-replacement`} : {nextIndex: 1})});
					localStorage.setItem(keys.multi, expected);
				} else {
					store.dispatch({type: 'SIGNIN_SUCCESS', user: {...originalUser, uid: change === 'account' ? 'switched-account' : uid, displayName: 'Updated profile'}});
				}
				resolveModal(request.id, {confirmed: true});
				await retrying;
				if (change !== 'same-account') assert.equal(localStorage.getItem(keys.multi), expected, 'must not approve or discard the changed intent');
				else if (corrupt) assert.equal(localStorage.getItem(keys.multi), null);
				else assert.equal(JSON.parse(localStorage.getItem(keys.multi)).overwriteAcknowledged, true);
			});
		}
	}
});

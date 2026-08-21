/*eslint-env node*/

import assert from 'assert';
import fs from 'fs';
import {draftMatchesConfirmedSave} from '../../lib/src/edit-draft-confirmation.js';

describe('durable single-card editing', () => {
	it('persists before releasing the editor and keeps the draft until confirmation', () => {
		const data = fs.readFileSync('src/actions/data.ts', 'utf8');
		const persist = data.indexOf('persistDurableMultiEdit(operation);');
		const preserve = data.indexOf("card-web-preserve-edit-draft-for-save", persist);
		//editingFinish(true) is the save-flavored teardown: it retains the
		//committed draft as editor.pendingSaveCard so the card face shows the
		//new value optimistically instead of flashing the pre-edit copy.
		const finish = data.indexOf('dispatch(editingFinish(true));', preserve);
		assert.ok(persist >= 0 && preserve > persist && finish > preserve);
		assert.ok(data.includes("operation.kind === 'single'"));
		assert.ok(data.includes("card-web-single-save-confirmed"));
	});

	it('flushes a pending draft during ordinary page exit', () => {
		const draft = fs.readFileSync('src/edit-draft.ts', 'utf8');
		assert.ok(draft.includes("window.addEventListener('beforeunload', flushPendingDraft)"));
		assert.ok(draft.includes("document.visibilityState === 'hidden'"));
		assert.ok(draft.includes('baseChanged'));
	});

	it('does not let a late save acknowledgement close a newer editor session', () => {
		const data = fs.readFileSync('src/actions/data.ts', 'utf8');
		const successStart = data.indexOf('const modifyCardSuccess');
		const successEnd = data.indexOf('const modifyCardFailure', successStart);
		const success = data.slice(successStart, successEnd);
		assert.ok(successStart >= 0 && successEnd > successStart);
		assert.ok(!success.includes('dispatch(editingFinish())'));

		const editor = fs.readFileSync('src/actions/editor.ts', 'utf8');
		const start = editor.indexOf('export const editingStart');
		const finish = editor.indexOf('export const editingFinish', start);
		const editingStart = editor.slice(start, finish);
		//Per-card since #763: a save in flight on ANOTHER card must not
		//block a new editor session; the same-card guard is what keeps a
		//late acknowledgement from being mistaken for a newer edit's
		//completion.
		assert.ok(editingStart.includes('selectCardModificationPendingForCard(state, card.id) || durableCardMutationPendingForCard(card.id)'));
		assert.equal(draftMatchesConfirmedSave(
			{cardID: 'card-a', operationID: 'save-new'},
			{cardID: 'card-a', operationID: 'save-old'},
		), false);
	});

	it('clears a draft only for its exact card and durable operation', () => {
		const draft = {cardID: 'card-a', operationID: 'save-a'};
		assert.equal(draftMatchesConfirmedSave(draft, {cardID: 'card-b', operationID: 'save-b'}), false);
		assert.equal(draftMatchesConfirmedSave(draft, {cardID: 'card-a', operationID: 'save-b'}), false);
		assert.equal(draftMatchesConfirmedSave(draft, {cardID: 'card-a', operationID: 'save-a'}), true);
		assert.equal(draftMatchesConfirmedSave({cardID: 'card-a'}, {cardID: 'card-a', operationID: 'save-a'}), false);
	});

	it('retains canonical audit history and finishers for ordinary card saves', () => {
		const data = fs.readFileSync('src/actions/data.ts', 'utf8');
		const durableStart = data.indexOf('export const modifyCardsWithDurableMultiEdit');
		const durableEnd = data.indexOf('const resumePendingDurableMultiEdit', durableStart);
		const durable = data.slice(durableStart, durableEnd);
		assert.ok(durable.includes("const compactMultiEdit = operation.kind !== 'single'"));
		assert.ok(durable.includes('false, compactMultiEdit, false'));
	});

	it('does not start whole-corpus tag fingerprinting on the UI thread when the editor opens in worker mode', () => {
		const editor = fs.readFileSync('src/components/card-editor.ts', 'utf8');
		const scheduleStart = editor.lastIndexOf('_scheduleSuggestions(state');
		const scheduleEnd = editor.indexOf('_makeVisibleCardTagInfos', scheduleStart);
		const schedule = editor.slice(scheduleStart, scheduleEnd);
		assert.ok(scheduleStart >= 0 && scheduleEnd > scheduleStart);
		//In worker mode, suggestions come from the corpus worker (off-thread);
		//the local whole-corpus selector is reachable ONLY in the non-worker
		//diagnostic fallback branch.
		assert.match(schedule, /corpusWorkerCanRunCollections\(\)[\s\S]{0,200}corpusWorkerSuggestTags\(\)/,
			'worker mode must request suggestions from the worker');
		const localCallIndex = schedule.indexOf('selectEditingCardSuggestedTags(');
		const fallbackGuardIndex = schedule.indexOf('!corpusWorkerServesCollections()');
		assert.ok(localCallIndex >= 0 && fallbackGuardIndex >= 0 && fallbackGuardIndex < localCallIndex,
			'the local selector may only run behind the non-worker fallback guard');
		assert.ok(schedule.includes('selectEditingCardSuggestedConceptReferences'));
	});

	it('offers an escape from a permanently paused single-card save', () => {
		const app = fs.readFileSync('src/components/card-web-app.ts', 'utf8');
		//The affordance's label changed in the #764 refit (button.small icon
		//with an explicit aria-label); the escape itself is what matters.
		assert.ok(app.includes('Stop and discard the saved operation'));
		assert.ok(app.includes('_stopRetryingSave'));
		assert.ok(app.includes('abandonPendingBulkTagOperation'));
		assert.ok(app.includes('await this._refreshDraftAvailability()'));
	});
});

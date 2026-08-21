/*eslint-env node*/

import assert from 'assert';

let reducer;
let actions;

describe('multi-edit reducer intent isolation', () => {
	before(async () => {
		reducer = (await import('../../lib/src/reducers/multiedit.js')).default;
		actions = await import('../../lib/src/actions.js');
	});

	it('never carries publication intent into a later dialog session', () => {
		let state = reducer(undefined, {type: actions.MULTI_EDIT_DIALOG_OPEN});
		state = reducer(state, {type: actions.MULTI_EDIT_DIALOG_SET_PUBLISHED, published: true});
		state = reducer(state, {type: actions.MULTI_EDIT_DIALOG_CLOSE});
		state = reducer(state, {type: actions.MULTI_EDIT_DIALOG_OPEN});
		assert.strictEqual(state.published, null);
	});

	it('keeps TODO enable and disable intent mutually exclusive', () => {
		let state = reducer(undefined, {type: actions.MULTI_EDIT_DIALOG_OPEN});
		state = reducer(state, {type: actions.MULTI_EDIT_DIALOG_ADD_TODO_ENABLEMENT, todo: 'prioritized'});
		state = reducer(state, {type: actions.MULTI_EDIT_DIALOG_ADD_TODO_ENABLEMENT, todo: 'prioritized'});
		assert.deepStrictEqual(state.addTODOEnablements, ['prioritized']);
		state = reducer(state, {type: actions.MULTI_EDIT_DIALOG_ADD_TODO_DISABLEMENT, todo: 'prioritized'});
		assert.deepStrictEqual(state.addTODOEnablements, []);
		assert.deepStrictEqual(state.addTODODisablements, ['prioritized']);
		state = reducer(state, {type: actions.MULTI_EDIT_DIALOG_ADD_TODO_ENABLEMENT, todo: 'prioritized'});
		assert.deepStrictEqual(state.addTODOEnablements, ['prioritized']);
		assert.deepStrictEqual(state.addTODODisablements, []);
	});

	it('deduplicates repeated label intents and cancels their inverse', () => {
		let state = reducer(undefined, {type: actions.MULTI_EDIT_DIALOG_OPEN});
		state = reducer(state, {type: actions.MULTI_EDIT_DIALOG_ADD_TAG, tagID: 'weekly'});
		state = reducer(state, {type: actions.MULTI_EDIT_DIALOG_ADD_TAG, tagID: 'weekly'});
		assert.deepStrictEqual(state.addTags, ['weekly']);
		state = reducer(state, {type: actions.MULTI_EDIT_DIALOG_REMOVE_TAG, tagID: 'weekly'});
		assert.deepStrictEqual(state.addTags, []);
		assert.deepStrictEqual(state.removeTags, []);
		state = reducer(state, {type: actions.MULTI_EDIT_DIALOG_REMOVE_TAG, tagID: 'weekly'});
		state = reducer(state, {type: actions.MULTI_EDIT_DIALOG_REMOVE_TAG, tagID: 'weekly'});
		assert.deepStrictEqual(state.removeTags, ['weekly']);
		state = reducer(state, {type: actions.MULTI_EDIT_DIALOG_ADD_TAG, tagID: 'weekly'});
		assert.deepStrictEqual(state.addTags, []);
		assert.deepStrictEqual(state.removeTags, []);
	});
});

describe('bulk import failure reporting (#758 slice)', () => {
	let bulkImportReducer;
	let bulkActions;

	before(async () => {
		bulkImportReducer = (await import('../../lib/src/reducers/bulk-import.js')).default;
		bulkActions = await import('../../lib/src/actions.js');
	});

	it('a failure lands in dialog state instead of an alert, and clears on retry', () => {
		//The reducer used to call alert() directly — a blocking OS modal
		//fired from inside a reducer. The dialog stays open on failure, so
		//the message belongs there.
		let state = bulkImportReducer(undefined, {type: bulkActions.BULK_IMPORT_DIALOG_OPEN, mode: 'import'});
		state = bulkImportReducer(state, {type: bulkActions.BULK_IMPORT_PENDING});
		state = bulkImportReducer(state, {type: bulkActions.BULK_IMPORT_FAILURE, error: 'These cards could not be created.'});
		assert.strictEqual(state.pending, false);
		assert.strictEqual(state.open, true, 'the dialog must stay open to show the failure');
		assert.strictEqual(state.error, 'These cards could not be created.');
		//Starting a new attempt clears the stale message.
		state = bulkImportReducer(state, {type: bulkActions.BULK_IMPORT_PENDING});
		assert.strictEqual(state.error, '');
	});

	it('progress tracks the two phases and clears on every terminal transition (#758)', () => {
		let state = bulkImportReducer(undefined, {type: bulkActions.BULK_IMPORT_DIALOG_OPEN, mode: 'import'});
		state = bulkImportReducer(state, {type: bulkActions.BULK_IMPORT_PENDING});
		state = bulkImportReducer(state, {type: bulkActions.BULK_IMPORT_PROGRESS, progress: {total: 32, committed: 8, arrived: 3}});
		assert.deepStrictEqual(state.progress, {total: 32, committed: 8, arrived: 3});
		//Success closes and clears.
		let done = bulkImportReducer(state, {type: bulkActions.BULK_IMPORT_SUCCESS});
		assert.strictEqual(done.progress, null);
		assert.strictEqual(done.open, false);
		//Failure clears progress but stays open — asserted, not assumed:
		//the review caught the first version of this test claiming the
		//clear in a comment while the reducer left stale progress behind.
		done = bulkImportReducer(state, {type: bulkActions.BULK_IMPORT_FAILURE, error: 'boom'});
		assert.strictEqual(done.pending, false);
		assert.strictEqual(done.open, true);
		assert.strictEqual(done.progress, null);
	});

	it('an outcome keeps the dialog open and clears on close or retry (#758)', () => {
		const outcome = {createdCount: 24, queuedCount: 5, discardedCount: 0, unarrivedCount: 3, queuedBodies: ['a body'], discardedBodies: []};
		let state = bulkImportReducer(undefined, {type: bulkActions.BULK_IMPORT_DIALOG_OPEN, mode: 'import'});
		state = bulkImportReducer(state, {type: bulkActions.BULK_IMPORT_SET_BODIES, bodies: ['<p>one</p>', '<p>two</p>']});
		state = bulkImportReducer(state, {type: bulkActions.BULK_IMPORT_PENDING});
		state = bulkImportReducer(state, {type: bulkActions.BULK_IMPORT_PROGRESS, progress: {total: 32, committed: 32, arrived: 24}});
		assert.deepStrictEqual(state.bodies, ['<p>one</p>', '<p>two</p>'], 'fixture must actually arm the form');
		state = bulkImportReducer(state, {type: bulkActions.BULK_IMPORT_OUTCOME, outcome});
		//The whole point (#758): the report lives in the surface that
		//produced it, so the dialog must NOT close when there is something
		//to say.
		assert.strictEqual(state.open, true);
		assert.strictEqual(state.pending, false);
		assert.strictEqual(state.progress, null);
		assert.strictEqual(state.outcome, outcome);
		//And the re-import form is DISARMED (review): leaving bodies
		//populated put an enabled create button directly under a report
		//saying the cards already exist — one click duplicated the import.
		assert.deepStrictEqual(state.bodies, []);
		//A new attempt clears the stale report…
		assert.strictEqual(bulkImportReducer(state, {type: bulkActions.BULK_IMPORT_PENDING}).outcome, null);
		//…and closing acknowledges it, like the error field.
		const closed = bulkImportReducer(state, {type: bulkActions.BULK_IMPORT_DIALOG_CLOSE});
		assert.strictEqual(closed.outcome, null);
	});

	it('closing the dialog acknowledges the failure; a post-close failure still shows next time', () => {
		//The review of 9484c181 caught the retention bug: a Monday import
		//failure greeted Thursday's EXPORT dialog in warning red. Closing
		//clears — but a late failure dispatched AFTER an impatient
		//close-while-pending lands post-clear and must survive to the next
		//open, which is why the clear lives on CLOSE and not on OPEN.
		let state = bulkImportReducer(undefined, {type: bulkActions.BULK_IMPORT_DIALOG_OPEN, mode: 'import'});
		state = bulkImportReducer(state, {type: bulkActions.BULK_IMPORT_PENDING});
		state = bulkImportReducer(state, {type: bulkActions.BULK_IMPORT_FAILURE, error: 'boom'});
		state = bulkImportReducer(state, {type: bulkActions.BULK_IMPORT_DIALOG_CLOSE});
		assert.strictEqual(state.error, '', 'closing acknowledges the shown failure');
		state = bulkImportReducer(state, {type: bulkActions.BULK_IMPORT_DIALOG_OPEN, mode: 'export'});
		assert.strictEqual(state.error, '', 'a fresh session must not open with a stale warning');
		//The close-while-pending race: failure lands after CLOSE.
		state = bulkImportReducer(state, {type: bulkActions.BULK_IMPORT_PENDING});
		state = bulkImportReducer(state, {type: bulkActions.BULK_IMPORT_DIALOG_CLOSE});
		state = bulkImportReducer(state, {type: bulkActions.BULK_IMPORT_FAILURE, error: 'late failure'});
		state = bulkImportReducer(state, {type: bulkActions.BULK_IMPORT_DIALOG_OPEN, mode: 'import'});
		assert.strictEqual(state.error, 'late failure', 'a post-close failure must not be lost');
	});
});

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

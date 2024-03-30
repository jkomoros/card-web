import {
	MULTI_EDIT_DIALOG_OPEN,
	MULTI_EDIT_DIALOG_CLOSE,
	MULTI_EDIT_DIALOG_ADD_REFERENCE,
	MULTI_EDIT_DIALOG_REMOVE_REFERENCE,
	MULTI_EDIT_DIALOG_ADD_TAG,
	MULTI_EDIT_DIALOG_REMOVE_TAG
} from '../actions.js';

import {
	referencesEntriesDiffWithSet,
	referencesEntriesDiffWithRemove
} from '../references.js';

import {
	MultiEditState
} from '../types.js';

import {
	SomeAction
} from '../actions.js';

const INITIAL_STATE : MultiEditState = {
	open: false,
	referencesDiff: [],
	addTags: [],
	removeTags: []
};

const app = (state : MultiEditState = INITIAL_STATE, action : SomeAction) : MultiEditState => {
	switch (action.type) {
	case MULTI_EDIT_DIALOG_OPEN:
		return {
			...state,
			open: true,
			referencesDiff: [],
			addTags: [],
			removeTags: []
		};
	case MULTI_EDIT_DIALOG_CLOSE:
		return {
			...state,
			open: false,
		};
	case MULTI_EDIT_DIALOG_ADD_REFERENCE:
		return {
			...state,
			referencesDiff: referencesEntriesDiffWithSet(state.referencesDiff, action.cardID, action.referenceType)
		};
	case MULTI_EDIT_DIALOG_REMOVE_REFERENCE:
		return {
			...state,
			referencesDiff: referencesEntriesDiffWithRemove(state.referencesDiff, action.cardID, action.referenceType)
		};
	case MULTI_EDIT_DIALOG_ADD_TAG:
		return {
			...state,
			addTags: [...state.addTags, action.tagID],
			//Make sure we don't have the tag in both add and remove
			removeTags: state.removeTags.filter(tagID => tagID !== action.tagID)
		};
	case MULTI_EDIT_DIALOG_REMOVE_TAG:
		return {
			...state,
			removeTags: [...state.removeTags, action.tagID],
			//Make sure we don't have the tag in both add and remove
			addTags: state.addTags.filter(tagID => tagID !== action.tagID)
		};
	default:
		return state;
	}
};

export default app;
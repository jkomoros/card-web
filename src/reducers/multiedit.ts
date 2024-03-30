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
	removeTags: [],
	addTODOEnablements: [],
	addTODODisablements: []
};

const app = (state : MultiEditState = INITIAL_STATE, action : SomeAction) : MultiEditState => {
	switch (action.type) {
	case MULTI_EDIT_DIALOG_OPEN:
		return {
			...state,
			open: true,
			referencesDiff: [],
			addTags: [],
			removeTags: [],
			addTODOEnablements: [],
			addTODODisablements: []
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
		if (state.removeTags.includes(action.tagID)) {
			return {
				...state,
				//Remove it from removeTags, don't add it to add tags.
				removeTags: state.removeTags.filter(tagID => tagID !== action.tagID)
			};
		}
		return {
			...state,
			addTags: [...state.addTags, action.tagID],
		};
	case MULTI_EDIT_DIALOG_REMOVE_TAG:
		if (state.addTags.includes(action.tagID)) {
			return {
				...state,
				//Remove it from add tags, don't add to removeTags.
				addTags: state.addTags.filter(tagID => tagID !== action.tagID)
			};
		}
		return {
			...state,
			removeTags: [...state.removeTags, action.tagID],
		};
	default:
		return state;
	}
};

export default app;
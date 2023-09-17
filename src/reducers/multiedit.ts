import {
	MULTI_EDIT_DIALOG_OPEN,
	MULTI_EDIT_DIALOG_CLOSE,
	MULTI_EDIT_DIALOG_ADD_REFERENCE,
	MULTI_EDIT_DIALOG_REMOVE_REFERENCE
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
};

const app = (state : MultiEditState = INITIAL_STATE, action : SomeAction) : MultiEditState => {
	switch (action.type) {
	case MULTI_EDIT_DIALOG_OPEN:
		return {
			...state,
			open: true,
			referencesDiff: [],
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
	default:
		return state;
	}
};

export default app;
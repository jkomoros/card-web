import {
	selectIsEditing
} from '../selectors.js';

import {
	ThunkSomeAction
} from '../store.js';

import {
	CardID,
	ReferenceType
} from '../types.js';

import {
	MULTI_EDIT_DIALOG_ADD_REFERENCE,
	MULTI_EDIT_DIALOG_CLOSE,
	MULTI_EDIT_DIALOG_OPEN,
	MULTI_EDIT_DIALOG_REMOVE_REFERENCE,
	SomeAction
} from '../actions.js';

export const openMultiEditDialog = () : ThunkSomeAction => (dispatch, getState) => {

	const state = getState();

	//It's not valid to open a multi-edit dialog when an individual card is
	//being edited
	if (selectIsEditing(state)) return;

	dispatch({
		type: MULTI_EDIT_DIALOG_OPEN
	});
};

export const closeMultiEditDialog = () : SomeAction => {
	return {
		type: MULTI_EDIT_DIALOG_CLOSE
	};
};

export const addReference = (cardID : CardID, referenceType : ReferenceType) : SomeAction => {
	return {
		type: MULTI_EDIT_DIALOG_ADD_REFERENCE,
		cardID,
		referenceType,
	};
};

export const removeReference = (cardID : CardID, referenceType : ReferenceType) : SomeAction => {
	return {
		type: MULTI_EDIT_DIALOG_REMOVE_REFERENCE,
		cardID,
		referenceType,
	};
};
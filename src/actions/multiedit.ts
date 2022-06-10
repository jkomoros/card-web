export const MULTI_EDIT_DIALOG_OPEN = 'MULTI_EDIT_DIALOG_OPEN';
export const MULTI_EDIT_DIALOG_CLOSE ='MULTI_EDIT_DIALOG_CLOSE';
export const MULTI_EDIT_DIALOG_ADD_REFERENCE = 'MULTI_EDIT_DIALOG_ADD_REFERENCE';
export const MULTI_EDIT_DIALOG_REMOVE_REFERENCE = 'MULTI_EDIT_DIALOG_REMOVE_REFERENCE';

import {
	AnyAction
} from 'redux';

import {
	selectIsEditing
} from '../selectors.js';

import {
	AppActionCreator
} from '../store.js';

import {
	CardID,
	ReferenceType
} from '../types.js';

export const openMultiEditDialog : AppActionCreator = () => (dispatch, getState) => {

	const state = getState();

	//It's not valid to open a multi-edit dialog when an individual card is
	//being edited
	if (selectIsEditing(state)) return;

	dispatch({
		type: MULTI_EDIT_DIALOG_OPEN
	});
};

export const closeMultiEditDialog = () : AnyAction => {
	return {
		type: MULTI_EDIT_DIALOG_CLOSE
	};
};

export const addReference = (cardID : CardID, referenceType : ReferenceType) : AnyAction => {
	return {
		type: MULTI_EDIT_DIALOG_ADD_REFERENCE,
		cardID,
		referenceType,
	};
};

export const removeReference = (cardID : CardID, referenceType : ReferenceType) : AnyAction => {
	return {
		type: MULTI_EDIT_DIALOG_REMOVE_REFERENCE,
		cardID,
		referenceType,
	};
};
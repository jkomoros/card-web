import {
	selectIsEditing,
	selectMultiEditCardDiff,
	selectSelectedCards
} from '../selectors.js';

import {
	ThunkSomeAction
} from '../store.js';

import {
	AutoTODOType,
	BooleanDiffValue,
	CardID,
	ReferenceType,
	TagID
} from '../types.js';

import {
	MULTI_EDIT_DIALOG_ADD_REFERENCE,
	MULTI_EDIT_DIALOG_ADD_TAG,
	MULTI_EDIT_DIALOG_ADD_TODO_DISABLEMENT,
	MULTI_EDIT_DIALOG_ADD_TODO_ENABLEMENT,
	MULTI_EDIT_DIALOG_CLOSE,
	MULTI_EDIT_DIALOG_OPEN,
	MULTI_EDIT_DIALOG_REMOVE_REFERENCE,
	MULTI_EDIT_DIALOG_REMOVE_TAG,
	MULTI_EDIT_DIALOG_REMOVE_TODO_DISABLEMENT,
	MULTI_EDIT_DIALOG_REMOVE_TODO_ENABLEMENT,
	MULTI_EDIT_DIALOG_SET_PUBLISHED,
	SomeAction
} from '../actions.js';

import {
	modifyCardsWithDurableTagOperation,
	modifyCardsWithDurableMultiEdit,
} from './data.js';

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

export const commitMultiEditDialog = () : ThunkSomeAction => (dispatch, getState) => {
	const state = getState();

	const update = selectMultiEditCardDiff(state);

	if (Object.keys(update).length === 0) {
		//If there's nothing to do, we can close the dialog now.
		dispatch(closeMultiEditDialog());
		return;
	}

	//There's a change to make. modifyCardsSuccess will close the dialog.

	const selectedCards = selectSelectedCards(state);
	const keys = Object.keys(update);
	const pureTagAddition = keys.length === 1 && update.add_tags?.length === 1;
	const pureTagRemoval = keys.length === 1 && update.remove_tags?.length === 1;
	if (pureTagAddition || pureTagRemoval) {
		const tag = pureTagAddition ? update.add_tags?.[0] : update.remove_tags?.[0];
		if (!tag) throw new Error('Missing tag for bulk edit');
		dispatch(modifyCardsWithDurableTagOperation(selectedCards, tag, pureTagAddition));
		return;
	}
	dispatch(modifyCardsWithDurableMultiEdit(selectedCards, update));

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

export const addTag = (tagID : TagID) : SomeAction => {
	return {
		type: MULTI_EDIT_DIALOG_ADD_TAG,
		tagID,
	};
};

export const removeTag = (tagID : TagID) : SomeAction => {
	return {
		type: MULTI_EDIT_DIALOG_REMOVE_TAG,
		tagID,
	};
};

export const addTODOEnablement = (todo: AutoTODOType) : SomeAction => {
	return {
		type: MULTI_EDIT_DIALOG_ADD_TODO_ENABLEMENT,
		todo
	};
};

export const removeTODOEnablement = (todo: AutoTODOType) : SomeAction => {
	return {
		type: MULTI_EDIT_DIALOG_REMOVE_TODO_ENABLEMENT,
		todo
	};
};

export const addTODODisablement = (todo: AutoTODOType) : SomeAction => {
	return {
		type: MULTI_EDIT_DIALOG_ADD_TODO_DISABLEMENT,
		todo
	};
};

export const removeTODODisablement = (todo: AutoTODOType) : SomeAction => {
	return {
		type: MULTI_EDIT_DIALOG_REMOVE_TODO_DISABLEMENT,
		todo
	};
};

export const setPublished = (published : BooleanDiffValue) : SomeAction => {
	return {
		type: MULTI_EDIT_DIALOG_SET_PUBLISHED,
		published
	};
};

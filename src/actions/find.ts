export const FIND_DIALOG_OPEN = 'FIND_DIALOG_OPEN';
export const FIND_DIALOG_CLOSE ='FIND_DIALOG_CLOSE';
export const FIND_UPDATE_QUERY = 'FIND_UPDATE_QUERY';
export const FIND_CARD_TO_LINK = 'FIND_CARD_TO_LINK';
export const FIND_UPDATE_RENDER_OFFSET = 'FIND_UPDATE_RENDER_OFFSET';
export const FIND_UPDATE_ACTIVE_QUERY = 'FIND_UPDATE_ACTIVE_QUERY';
export const FIND_CARD_TO_PERMISSION = 'FIND_CARD_TO_PERMISSION';
export const FIND_CARD_TO_REFERENCE = 'FIND_CARD_TO_REFERENCE';
export const FIND_UPDATE_CARD_TYPE_FILTER = 'FIND_UPDATE_CARD_TYPE_FILTER';
export const FIND_UPDATE_SORT_BY_RECENT = 'FIND_UPDATE_SORT_BY_RECENT';

import {
	saveSelectionRange
} from './editor.js';

import {
	queryTextFromCollectionDescription
} from '../collection_description.js';

import {
	selectActiveCollectionDescription,
	selectFindCardTypeFilterLocked,
} from '../selectors.js';

import {
	FindDialogType
} from '../types.js';

import {
	AppActionCreator
} from '../store.js';

import {
	AnyAction
} from 'redux';

export const openFindDialog = () => {
	return launchFind(FIND_DIALOG_OPEN);
};

export const closeFindDialog = () : AnyAction => {
	return {
		type: FIND_DIALOG_CLOSE
	};
};

let updateActiveQueryTimeout = 0;
//This time should be how long after the user stops typing to wait.
const QUERY_UPDATE_INTERVAL = 250;

export const updateQuery : AppActionCreator  = (query) => (dispatch) => {

	if (updateActiveQueryTimeout) {
		window.clearTimeout(updateActiveQueryTimeout);
		updateActiveQueryTimeout = 0;
	}

	updateActiveQueryTimeout = window.setTimeout(() => {
		updateActiveQueryTimeout = 0;
		dispatch({
			type: FIND_UPDATE_ACTIVE_QUERY,
		});
	}, QUERY_UPDATE_INTERVAL);

	dispatch({
		type: FIND_UPDATE_QUERY,
		query
	});
};

export const findCardToLink = (starterQuery = '') => {
	saveSelectionRange();
	return launchFind(FIND_CARD_TO_LINK, starterQuery);
};

export const findCardToPermission = () => {
	return launchFind(FIND_CARD_TO_PERMISSION);
};

//lockedCardTypeFilter might be a union filter, or a single cardtype, or ''
export const findCardToReference = (lockedCardTypeFilter : string) => {
	return launchFind(FIND_CARD_TO_REFERENCE, '', lockedCardTypeFilter);
};

export const findUpdateRenderOffset = (renderOffset : number) : AnyAction => {
	return {
		type: FIND_UPDATE_RENDER_OFFSET,
		renderOffset,
	};
};

const launchFind : AppActionCreator = (typ : FindDialogType, starterQuery? : string, lockedCardTypeFilter? : string) => (dispatch, getState) => {
	if (!starterQuery) {
		const description = selectActiveCollectionDescription(getState());
		starterQuery = queryTextFromCollectionDescription(description);
	}
	if (!lockedCardTypeFilter) lockedCardTypeFilter = '';
	dispatch({
		type: typ,
		query: starterQuery,
		cardTypeFilter: lockedCardTypeFilter,
	});
};

export const findUpdateCardTypeFilter : AppActionCreator = (filter) => (dispatch, getState) =>  {

	const cardTypeFilterLocked = selectFindCardTypeFilterLocked(getState());

	if (cardTypeFilterLocked) return;

	dispatch({
		type: FIND_UPDATE_CARD_TYPE_FILTER,
		filter,
	});
};

export const findUpdateSortByRecent = (sortByRecent : boolean) : AnyAction => {
	return {
		type: FIND_UPDATE_SORT_BY_RECENT,
		sortByRecent,
	};
};
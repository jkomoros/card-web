export const FIND_DIALOG_OPEN = 'FIND_DIALOG_OPEN';
export const FIND_DIALOG_CLOSE ='FIND_DIALOG_CLOSE';
export const FIND_UPDATE_QUERY = 'FIND_UPDATE_QUERY';
export const FIND_CARD_TO_LINK = 'FIND_CARD_TO_LINK';
export const FIND_UPDATE_ACTIVE_QUERY = 'FIND_UPDATE_ACTIVE_QUERY';
export const FIND_CARD_TO_PERMISSION = 'FIND_CARD_TO_PERMISSION';
export const FIND_UPDATE_CARD_TYPE_FILTER = 'FIND_UPDATE_CARD_TYPE_FILTER';

import {
	saveSelectionRange
} from './editor.js';

export const openFindDialog = () => {
	return {
		type: FIND_DIALOG_OPEN
	};
};

export const closeFindDialog = () => {
	return {
		type: FIND_DIALOG_CLOSE
	};
};

let updateActiveQueryTimeout = 0;
//This time should be how long after the user stops typing to wait.
const QUERY_UPDATE_INTERVAL = 250;

export const updateQuery = (query) => (dispatch) => {

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

export const findCardToLink = (starterQuery) => {
	if (!starterQuery) starterQuery = '';
	saveSelectionRange();
	return {
		type: FIND_CARD_TO_LINK,
		query: starterQuery,
	};
};

export const findCardToPermission = () => {
	return {
		type: FIND_CARD_TO_PERMISSION,
	};
};

export const findUpdateCardTypeFilter = (filter) => {
	return {
		type: FIND_UPDATE_CARD_TYPE_FILTER,
		filter,
	};
};
export const FIND_DIALOG_OPEN = 'FIND_DIALOG_OPEN';
export const FIND_DIALOG_CLOSE ='FIND_DIALOG_CLOSE';
export const FIND_UPDATE_QUERY = 'FIND_UPDATE_QUERY';
export const FIND_CARD_TO_LINK = 'FIND_CARD_TO_LINK';
export const FIND_UPDATE_ACTIVE_QUERY = 'FIND_UPDATE_ACTIVE_QUERY';

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
const QUERY_UPDATE_INTERVAL = 500;

export const updateQuery = (query) => (dispatch) => {
	if (!updateActiveQueryTimeout) {
		updateActiveQueryTimeout = window.setTimeout(() => {
			updateActiveQueryTimeout = 0;
			dispatch({
				type: FIND_UPDATE_ACTIVE_QUERY,
			});
		}, QUERY_UPDATE_INTERVAL);
	}
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
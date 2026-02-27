import {
	saveSelectionRange
} from './editor.js';

import {
	queryTextFromCollectionDescription
} from '../collection_description.js';

import {
	selectActiveCollectionDescription,
	selectFindCardTypeFilterLocked,
	selectCollectionDescriptionForQuery,
	selectFindDialogOpen,
} from '../selectors.js';

import {
	requestDeepFetch,
	cancelAndCleanupDeepFetch
} from './collection.js';

import {
	FindDialogType,
	State
} from '../types.js';

import {
	ThunkSomeAction
} from '../store.js';

import {
	FIND_CARD_TO_LINK,
	FIND_CARD_TO_PERMISSION,
	FIND_CARD_TO_REFERENCE,
	FIND_DIALOG_CLOSE,
	FIND_DIALOG_OPEN,
	FIND_UPDATE_ACTIVE_QUERY,
	FIND_UPDATE_CARD_TYPE_FILTER,
	FIND_UPDATE_QUERY,
	FIND_UPDATE_RENDER_OFFSET,
	FIND_UPDATE_SORT_BY_RECENT,
	SomeAction
} from '../actions.js';

// Tracks the find dialog's current deep fetch collection key so we can
// clean up the old key when the collection description changes.
let findDialogDeepFetchKey : string | null = null;

/**
 * After any find-related state mutation, call this to trigger deep fetch
 * for the new find collection description (and clean up the old one).
 */
const refreshFindDeepFetch = (dispatch: (action: ThunkSomeAction | SomeAction) => void, getState: () => State) : void => {
	const state = getState();
	if (!selectFindDialogOpen(state)) return;

	// Self-healing: if findDialogDeepFetchKey points to a key that was cleaned
	// externally (e.g., cleanupDeepFetchCardsIfNeeded on page navigation), reset it.
	if (findDialogDeepFetchKey && !state.collection?.deepFetchState[findDialogDeepFetchKey]) {
		findDialogDeepFetchKey = null;
	}

	const description = selectCollectionDescriptionForQuery(state);
	const newKey = description ? description.serialize() : null;

	if (newKey !== findDialogDeepFetchKey) {
		// Clean up old key, but only if the main active collection isn't using it
		if (findDialogDeepFetchKey) {
			const activeDescription = selectActiveCollectionDescription(state);
			const activeKey = activeDescription ? activeDescription.serialize() : '';
			if (activeKey !== findDialogDeepFetchKey) {
				dispatch(cancelAndCleanupDeepFetch(findDialogDeepFetchKey));
			}
		}
		findDialogDeepFetchKey = newKey;
	}

	// Trigger deep fetch (requestDeepFetch checks SIMPLE eligibility internally)
	if (description) {
		dispatch(requestDeepFetch(description));
	}
};

export const openFindDialog = () => {
	return launchFind(FIND_DIALOG_OPEN);
};

export const closeFindDialog = () : ThunkSomeAction => (dispatch, getState) => {
	// Clean up deep fetch for the find dialog's collection key,
	// but only if the main active collection doesn't share the same key.
	if (findDialogDeepFetchKey) {
		const state = getState();
		const activeDescription = selectActiveCollectionDescription(state);
		const activeKey = activeDescription ? activeDescription.serialize() : '';
		if (activeKey !== findDialogDeepFetchKey) {
			dispatch(cancelAndCleanupDeepFetch(findDialogDeepFetchKey));
		}
		findDialogDeepFetchKey = null;
	}
	dispatch({
		type: FIND_DIALOG_CLOSE
	});
};

let updateActiveQueryTimeout = 0;
//This time should be how long after the user stops typing to wait.
const QUERY_UPDATE_INTERVAL = 250;

export const updateQuery  = (query : string) : ThunkSomeAction => (dispatch, getState) => {

	if (updateActiveQueryTimeout) {
		window.clearTimeout(updateActiveQueryTimeout);
		updateActiveQueryTimeout = 0;
	}

	updateActiveQueryTimeout = window.setTimeout(() => {
		updateActiveQueryTimeout = 0;
		dispatch({
			type: FIND_UPDATE_ACTIVE_QUERY,
		});
		// After the active query updates, trigger deep fetch for the new collection
		refreshFindDeepFetch(dispatch, getState);
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

export const findUpdateRenderOffset = (renderOffset : number) : SomeAction => {
	return {
		type: FIND_UPDATE_RENDER_OFFSET,
		renderOffset,
	};
};

const launchFind = (typ : FindDialogType, starterQuery? : string, lockedCardTypeFilter? : string) : ThunkSomeAction => (dispatch, getState) => {
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
	// Trigger deep fetch for the initial query
	refreshFindDeepFetch(dispatch, getState);
};

export const findUpdateCardTypeFilter = (filter : string) : ThunkSomeAction => (dispatch, getState) =>  {

	const cardTypeFilterLocked = selectFindCardTypeFilterLocked(getState());

	if (cardTypeFilterLocked) return;

	dispatch({
		type: FIND_UPDATE_CARD_TYPE_FILTER,
		filter,
	});

	// Card type filter changes the collection description, trigger deep fetch
	refreshFindDeepFetch(dispatch, getState);
};

export const findUpdateSortByRecent = (sortByRecent : boolean) : ThunkSomeAction => (dispatch, getState) => {
	dispatch({
		type: FIND_UPDATE_SORT_BY_RECENT,
		sortByRecent,
	});

	// Sort changes the collection description, trigger deep fetch
	refreshFindDeepFetch(dispatch, getState);
};

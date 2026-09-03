import {
	saveSelectionRange
} from './editor.js';

import {
	queryTextFromCollectionDescription
} from '../collection_description.js';

import {
	selectActiveCollectionDescription,
	selectFindCardTypeFilterLocked,
	selectFindConfigureRequestID,
} from '../selectors.js';

import {
	CardID,
	FindDialogType,
} from '../types.js';

import {
	ThunkSomeAction
} from '../store.js';

import {
	FIND_CARD_TO_LINK,
	FIND_CARD_TO_PERMISSION,
	FIND_CARD_TO_REFERENCE,
	FIND_CARD_TO_CONFIGURE,
	FIND_CARD_CONFIGURED,
	FIND_DIALOG_CLOSE,
	FIND_DIALOG_OPEN,
	FIND_UPDATE_ACTIVE_QUERY,
	FIND_UPDATE_CARD_TYPE_FILTER,
	FIND_UPDATE_QUERY,
	FIND_UPDATE_RENDER_OFFSET,
	FIND_UPDATE_SORT_BY_RECENT,
	FIND_UPDATE_STICKY_FILTERS,
	SomeAction
} from '../actions.js';

import {
	writeStickySearchEnabled,
	readStickySearchExpression
} from '../sticky-search-filters.js';

export const openFindDialog = () => {
	return launchFind(FIND_DIALOG_OPEN);
};

export const closeFindDialog = () : SomeAction => {
	return {
		type: FIND_DIALOG_CLOSE
	};
};

//Toggles the sticky extra search filters (#745), persisting the choice so it
//survives dialog close and reload.
export const updateStickySearchFiltersEnabled = (enabled : boolean) : ThunkSomeAction => (dispatch) => {
	writeStickySearchEnabled(enabled);
	dispatch({
		type: FIND_UPDATE_STICKY_FILTERS,
		enabled,
		expression: readStickySearchExpression(),
	});
};

let updateActiveQueryTimeout = 0;
//This time should be how long after the user stops typing to wait.
const QUERY_UPDATE_INTERVAL = 250;

export const updateQuery  = (query : string) : ThunkSomeAction => (dispatch) => {

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

//The composer's key-card control picking the card a card-valued filter names
//(HS-5: find-dialog is the primitive for 'pick a card'). Deliberately NOT
//routed through launchFind: this mode carries a requestID instead of a
//card-type filter, and widening launchFind's dispatch to carry both would put a
//field on three action shapes that have no use for it.
export const findCardToConfigure = (requestID : string) : ThunkSomeAction => (dispatch, getState) => {
	const description = selectActiveCollectionDescription(getState());
	dispatch({
		type: FIND_CARD_TO_CONFIGURE,
		query: queryTextFromCollectionDescription(description),
		requestID,
	});
};

//Reports the pick back to whichever control asked. Reads the requestID out of
//state rather than taking it as an argument, for the same reason
//setCardToAddPermissionTo reads the pending uid: find-dialog knows the card,
//and the mode that opened it knows everything else.
export const setCardToConfigure = (cardID : CardID) : ThunkSomeAction => (dispatch, getState) => {
	//No outstanding request means nobody is listening, and writing the answer
	//anyway would leave a pick sitting in state for the next control to read.
	if (!selectFindConfigureRequestID(getState())) return;
	dispatch({
		type: FIND_CARD_CONFIGURED,
		cardID,
	});
};

export const findUpdateRenderOffset = (renderOffset : number) : SomeAction => {
	return {
		type: FIND_UPDATE_RENDER_OFFSET,
		renderOffset,
	};
};

//Every mode whose action shape is (query, cardTypeFilter). FIND_CARD_TO_CONFIGURE
//is the one that is not — it carries a requestID instead — and findCardToConfigure
//dispatches its own action rather than widening this one for all four.
type LaunchableFindDialogType = Exclude<FindDialogType, typeof FIND_CARD_TO_CONFIGURE>;

const launchFind = (typ : LaunchableFindDialogType, starterQuery? : string, lockedCardTypeFilter? : string) : ThunkSomeAction => (dispatch, getState) => {
	//WHERE THE QUERY CAME FROM IS PART OF WHAT IT MEANS. A starterQuery is text
	//the APP put in the box — today, the editor's current text selection — and
	//prose read through the operator table loses words to heads it never meant
	//(`Type: safety`) or acquires filters (`type:content`). The FALLBACK below
	//is the opposite case: the active collection's own query text, which is a
	//query and must keep being read as one. So the distinction is made here,
	//before the fallback, and nowhere else.
	const seeded = Boolean(starterQuery);
	if (!starterQuery) {
		const description = selectActiveCollectionDescription(getState());
		starterQuery = queryTextFromCollectionDescription(description);
	}
	if (!lockedCardTypeFilter) lockedCardTypeFilter = '';
	//Only FIND_CARD_TO_LINK can be seeded, so only its action shape carries the
	//flag — the same reasoning findCardToConfigure records above about not
	//widening three shapes for a field two of them have no use for.
	if (typ === FIND_CARD_TO_LINK) {
		dispatch({
			type: typ,
			query: starterQuery,
			cardTypeFilter: lockedCardTypeFilter,
			literal: seeded,
		});
		return;
	}
	dispatch({
		type: typ,
		query: starterQuery,
		cardTypeFilter: lockedCardTypeFilter,
	});
};

export const findUpdateCardTypeFilter = (filter : string) : ThunkSomeAction => (dispatch, getState) =>  {

	const cardTypeFilterLocked = selectFindCardTypeFilterLocked(getState());

	if (cardTypeFilterLocked) return;

	dispatch({
		type: FIND_UPDATE_CARD_TYPE_FILTER,
		filter,
	});
};

export const findUpdateSortByRecent = (sortByRecent : boolean) : SomeAction => {
	return {
		type: FIND_UPDATE_SORT_BY_RECENT,
		sortByRecent,
	};
};

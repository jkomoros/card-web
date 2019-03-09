export const SHOW_CARD = 'SHOW_CARD';
export const UPDATE_COLLECTION = 'UPDATE_COLLECTION';
export const RE_SHOW_CARD = 'RE_SHOW_CARD';

//Collections are a complex conccept. The canonical (slightly out of date) documentation is at https://github.com/jkomoros/complexity-compendium/issues/60#issuecomment-451705854

import {
	scheduleAutoMarkRead
} from './user.js';

import {
	navigatePathTo,
	navigateToCard
} from './app.js';

import {
	DEFAULT_SET_NAME,
	SET_NAMES,
	DEFAULT_SORT_NAME,
} from '../reducers/collection.js';

import {
	getIdForCard,
	getCard,
	selectDataIsFullyLoaded,
	selectSortedActiveCollection,
	selectActiveSetName,
	selectActiveCardId,
	selectActiveSectionId,
	selectRequestedCard,
	selectActiveFilterNames,
	selectActiveCard,
	selectActiveCardIndex,
	selectPage,
	selectPageExtra,
	getCardIndexForActiveCollection,
	selectActiveSortName
} from '../selectors.js';

export const FORCE_COLLECTION_URL_PARAM = 'force-collection';

export const PLACEHOLDER_CARD_ID_CHARACTER = '_';

export const updateCardSelector = (cardSelector) => (dispatch, getState) => {

	let queryParts = cardSelector.split('?');

	let forceUpdateCollection = false;

	if (queryParts.length > 1) {
		let queryParams = queryParts[1].split('&');
		for (let param of queryParams) {
			if (param == FORCE_COLLECTION_URL_PARAM) forceUpdateCollection = true;
		}
	}

	let path = queryParts[0];

	let parts = path.split('/');

	//Remove trailing slash
	if (!parts[parts.length - 1]) parts.pop();

	//in some weird situations, like during editing commit, we might be at no
	//route even when our view is active. Not entirely clear how, but it
	//happens... for a second.
	let firstPart = parts.length ? parts[0].toLowerCase() : '';
	
	let setName = DEFAULT_SET_NAME;

	for (let name of SET_NAMES) {
		if (name == firstPart) {
			setName = firstPart;
			parts.unshift();
			break;
		}
	}

	//Get last part
	let cardIdOrSlug = parts.pop();

	//TODO: detect if it's one of the weird cardIdOrSlugs (e.g. '.', '.default');

	let [filters, sortName] = extractFilterNamesAndSort(parts);

	let doUpdateCollection = true;

	if (filters.length == 0) {
		const state = getState();
		let card = getCard(state, cardIdOrSlug);
		if (card) {
			//If we had a default filter URL and the card is a member of the set
			//we're already in, leave the collection information the same.
			if (getCardIndexForActiveCollection(state, card.id) >= 0) {
				doUpdateCollection = false;
			}
			filters = [card.section ? card.section : 'none'];
		} else {
			//Make sure the collection has no items, so canonicalizeURL won't add
			//'all' in it which would then load up the whole collection before
			//redirecting.
			filters = ['none'];
		}
	}

	if (doUpdateCollection || forceUpdateCollection) dispatch(updateCollection(setName, filters, sortName));
	dispatch(showCard(cardIdOrSlug));
};

const extractFilterNamesAndSort = (parts) => {
	//parts is all of the unconsumed portions of the path that aren't the set
	//name or the card name.
	if (!parts.length) return [[], DEFAULT_SORT_NAME];
	return [[...parts], DEFAULT_SORT_NAME];
};

export const updateCollection = (setName, filters, sortName) => (dispatch, getState) =>{
	const state = getState();
	let sameSetName = false;
	if (setName == selectActiveSetName(state)) sameSetName = true;

	let sameActiveFilters = false;
	let activeFilters = selectActiveFilterNames(state);
	if (filters.length == activeFilters.length) {
		sameActiveFilters = true;
		for (let i = 0; i < filters.length; i++) {
			if (filters[i] != activeFilters[i]) {
				sameActiveFilters = false;
				break;
			}
		}
	}

	let sameSortName = false;
	if (sortName == selectActiveSortName) sameSortName = true;

	if (sameSetName && sameActiveFilters && sameSortName) return;
	dispatch({
		type: UPDATE_COLLECTION,
		setName,
		filters,
		sortName
	});
};

export const refreshCardSelector = () => (dispatch, getState) => {
	//Called when cards and sections update, just in case we now have
	//information to do this better. Also called when stars and reads update,
	//because if we're filtering to one of those filters we might not yet know
	//if we're in that collection or not.
	const state = getState();

	let page = selectPage(state);
	if (page != 'c') return;
	let pageExtra = selectPageExtra(state);
	dispatch(updateCardSelector(pageExtra));
};

export const canonicalizeURL = () => (dispatch, getState) => {

	//Called to ensure that the URL is canonical given activeSet, activeFilters, etc.

	let state = getState();

	let card = selectActiveCard(state);

	if (!card) return;

	let activeSectionId = selectActiveSectionId(state);
	let activeFilterNames = selectActiveFilterNames(state);
	let activeSetName = selectActiveSetName(state);

	//TODO: this should be a constant somewhere
	let result = ['c'];

	//Orphaned cards just live at their name and nothing else. But the
	//start_cards for tags are technically orphans, and should be shown as being
	//in the collection they're in.
	if (card.section || card.card_type=='section-head') {

		if (activeSetName != DEFAULT_SET_NAME || activeFilterNames.length == 0) {
			result.push(activeSetName);
		}

		if (!activeSectionId) {
			//activeSectionId is only there if the only filter is the section name the
			//user is in, which can be omitted for brevity.
			result.push(...activeFilterNames);
		}

	}

	let requestedCard = selectRequestedCard(state);
	if (cardIdIsPlaceholder(requestedCard)) {
		//If it was a special placeholder that was requested, then leave it in
		//the URL. If they arrow down and back up it's OK for it go back to its
		//canonical URL.
		result.push(requestedCard);
	} else {
		result.push(card.name);
	}

	let path = result.join('/');

	//Ensure that the article name that we're shwoing--no matter how they
	//havigated here--is the preferred slug name.
	dispatch(navigatePathTo(path, true));
};

const cardIdIsPlaceholder = (cardId) => {
	if (!cardId) return false;
	return cardId[0] == PLACEHOLDER_CARD_ID_CHARACTER;
};

const cardIdForPlaceholder = (requestedCard, collection) => {
	if (!cardIdIsPlaceholder(requestedCard)) return '';
	if (!collection || !collection.length) return '';
	//TODO: support random, _popular, _recent, etc.
	return collection[0];
};

export const redirectIfInvalidCardOrCollection = () => (dispatch, getState) => {

	//This routine is called to make sure that if there is a valid card, we're
	//actually sitting in a collection that contains it. If we aren't, we
	//navigate to its canonical location.

	//It's also responsible for checking to see if the card ID is the special
	//placehodler "_" which means, just pick a random item out of the collection
	//I selected.

	const state = getState();
	if (!selectDataIsFullyLoaded(state)) return;
	let card = selectActiveCard(state);
	let collection = selectSortedActiveCollection(state);
	if (!card) {
		
		//If we get here, we could navigate to a default card (we know that the
		//card is invalid), but it's better to just show an error card.

		return;
	}
  
	if (!collection.length) return;
	let index = selectActiveCardIndex(state);
	//If the card is not in this collection, then forward to a collection that
	//it is in.
	if (index >= 0) return;
	dispatch(navigateToCard(card, false));
};

export const showCard = (requestedCard) => (dispatch, getState) => {

	const state = getState();

	let cardId = getIdForCard(state, requestedCard);
	//If it'll be a no op don't worry about it.
	if (selectActiveCardId(state) == cardId) {
		dispatch(redirectIfInvalidCardOrCollection());
		return;
	}

	//The qreuestedCard is a placeholder, so we need to select the cardId based
	//on the current collection.
	if (cardIdIsPlaceholder(requestedCard)) {
		if (!selectDataIsFullyLoaded(state)) return;
		let collection = selectSortedActiveCollection(state);
		cardId = cardIdForPlaceholder(requestedCard, collection);
		//If there's no valid card then give up.
		if (!cardId) return;
	}

	dispatch({
		type: SHOW_CARD,
		requestedCard: requestedCard,
		card: cardId,
	});
	dispatch(redirectIfInvalidCardOrCollection());
	dispatch(canonicalizeURL());
	dispatch(scheduleAutoMarkRead());
};

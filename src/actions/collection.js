export const SHOW_CARD = 'SHOW_CARD';
export const UPDATE_COLLECTION = 'UPDATE_COLLECTION';
export const RE_SHOW_CARD = 'RE_SHOW_CARD';
export const COMMIT_PENDING_COLLECTION_MODIFICATIONS = 'COMMIT_PENDING_COLLECTION_MODIFICATIONS';

//Collections are a complex conccept. The canonical (slightly out of date) documentation is at https://github.com/jkomoros/complexity-compendium/issues/60#issuecomment-451705854

import {
	scheduleAutoMarkRead
} from './user.js';

import {
	navigatePathTo,
	navigateToCard,
	PAGE_DEFAULT
} from './app.js';

import {
	SORTS,
} from '../reducers/collection.js';

import {
	DEFAULT_SET_NAME,
	SET_NAMES,
	DEFAULT_SORT_NAME,
	SORT_REVERSED_URL_KEYWORD,
	SORT_URL_KEYWORD,
	CollectionDescription,
} from '../collection_description.js';

import {
	getIdForCard,
	getCard,
	selectDataIsFullyLoaded,
	selectFinalCollection,
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
	selectActiveSortName,
	selectActiveSortReversed,
	selectCollectionIsFallback,
	selectActiveCollectionDescription
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

	let path = queryParts[0].toLowerCase();

	let parts = path.split('/');

	//We do not remove a trailing slash; we take a trailing slash to mean
	//"deafult item in the collection".

	//in some weird situations, like during editing commit, we might be at no
	//route even when our view is active. Not entirely clear how, but it
	//happens... for a second.
	let firstPart = parts.length ? parts[0] : '';
	
	let setName = DEFAULT_SET_NAME;
	//Whether or not the set was explicitly included in the URL, as opposed to
	//implied.
	let setExplicitlySpecified = false;

	for (let name of SET_NAMES) {
		if (name == firstPart) {
			setName = firstPart;
			parts.shift();
			setExplicitlySpecified = true;
			break;
		}
	}

	//Get last part, which is the card selector (and might be "").
	let cardIdOrSlug = parts.pop();
	//If the requestedCard is actually "" we'll pretend throughout the pipeline
	//it's actually "_", and just never show it to the user. This is because the
	//identifier "" also happens to be the intial active card ID, which confuses
	//caching logic, so it's better to have it be explicit (just never shown to
	//the user).
	if (cardIdOrSlug == '') cardIdOrSlug = PLACEHOLDER_CARD_ID_CHARACTER;

	let [filters, sortName, sortReversed] = extractFilterNamesAndSort(parts);

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
		} else if(!setExplicitlySpecified) {

			//If the set was explicitly specified, e.g. `/c/all/sort/recent/_`
			//then don't filter out items.

			//Make sure the collection has no items, so canonicalizeURL won't add
			//'all' in it which would then load up the whole collection before
			//redirecting.
			filters = ['none'];
		}
	}

	if (doUpdateCollection || forceUpdateCollection) dispatch(updateCollection(setName, filters, sortName, sortReversed));
	dispatch(showCard(cardIdOrSlug));
};

const extractFilterNamesAndSort = (parts) => {
	//returns the filter names, the sort name, and whether the sort is reversed
	//parts is all of the unconsumed portions of the path that aren't the set
	//name or the card name.
	if (!parts.length) return [[], DEFAULT_SORT_NAME, false];
	let filters = [];
	let sortName = DEFAULT_SORT_NAME;
	let sortReversed = false;
	let nextPartIsSort = false;
	for (let i = 0; i < parts.length; i++) {
		const part = parts[i];
		if (part == '') continue;
		if (part == SORT_URL_KEYWORD) {
			nextPartIsSort = true;
			//handle the case where there was already one sort, and only listen
			//to the last reversed.
			sortReversed = false;
			continue;
		}
		if (nextPartIsSort) {
			if (part == SORT_REVERSED_URL_KEYWORD) {
				sortReversed = true;
				//Note that we requested a reverse, and then expect the  next
				//part to be the sort name
				continue;
			}
			//Take note of the sort, but only if it's a valid sort name; if it's
			//not, drop it on the floor.
			if (SORTS[part]) {
				sortName = part;
			} else {
				//If we dropped iton the floor, also drop the reverse
				//instruction on the floor, if there was one.
				sortReversed = false;
			}
			nextPartIsSort = false;
			continue;
		}
		filters.push(part);
	}
	return [filters, sortName, sortReversed];
};

export const updateCollection = (setName, filters, sortName, sortReversed) => (dispatch, getState) =>{	
	const state = getState();
	const activeCollectionDescription = selectActiveCollectionDescription(state);
	const newCollectionDescription = new CollectionDescription(setName, filters, sortName, sortReversed);
	if (activeCollectionDescription.equivalent(newCollectionDescription)) return;

	//make sure we're working with the newest set of filters, because now is the
	//one time that it's generally OK to update the active filter set, since the
	//whole collection is changing anyway.
	dispatch(commitPendingCollectionModifications());
	dispatch({
		type: UPDATE_COLLECTION,
		setName,
		filters,
		sortName,
		sortReversed
	});
};

//commitPendingCollectionModifications should be dispatched when the list of
//things that should show in a given collection may have changed and you want
//the collection to cahnge at that moment. Often, we DON'T want it to change, to
//emphasize consistency and so collections don't change as, for exmaple, a card
//is read and you're viewing an unread filter set.
export const commitPendingCollectionModifications = () => {
	return {type:COMMIT_PENDING_COLLECTION_MODIFICATIONS};
};

//Keep track of whether we've called refreshCardSelector once already when the
//data is fully loaded.
let refreshCardSelectorHasSeenDataFullyLoaded = false;

export const refreshCardSelector = (forceCommit) => (dispatch, getState) => {
	//Called when cards and sections update, just in case we now have
	//information to do this better. Also called when stars and reads update,
	//because if we're filtering to one of those filters we might not yet know
	//if we're in that collection or not.

	//forceCommit is whether the commitPendingCollectionModifications should be
	//forced to updated now even if the data is fully laoded.

	const state = getState();

	let page = selectPage(state);
	if (page != PAGE_DEFAULT) return;
	let pageExtra = selectPageExtra(state);

	const dataIsFullyLoaded = selectDataIsFullyLoaded(state);

	if (!dataIsFullyLoaded || (dataIsFullyLoaded && !refreshCardSelectorHasSeenDataFullyLoaded) || forceCommit) {
		//This action creator gets called when ANYTHING that could have changed
		//the collection gets called. If we got called before everything is
		//fully loaded, then we should make sure that the more recent
		//information is available to filter off of. If it was AFTER everythign
		//was fully loaded, then we should optimize for the collection not
		//changing while the user is looking at it (for example, if they're
		//looking at `/c/unread/_` then it would be weird for the card to
		//disappear when auto-read), and instead wait until the collection is
		//changed. However, there's one extra case: when this is the FIRST time
		//that we've run since the data has been fully loaded. This will happen
		//for the last item that has loaded that has made the data fully loaded;
		//often, reads. Basically, as soon as the data is fully loaded we want
		//to run it once.
		dispatch(commitPendingCollectionModifications());
	}

	if (dataIsFullyLoaded) refreshCardSelectorHasSeenDataFullyLoaded = true;

	dispatch(updateCardSelector(pageExtra));
};

export const canonicalizeURL = () => (dispatch, getState) => {

	//Called to ensure that the URL is canonical given activeSet, activeFilters, etc.

	let state = getState();

	let card = selectActiveCard(state);

	if (!card) return;

	let activeSectionId = selectActiveSectionId(state);
	let activeFilterNames = selectActiveFilterNames(state);
	let activeSortName = selectActiveSortName(state);
	let activeSortReversed = selectActiveSortReversed(state);
	let activeSetName = selectActiveSetName(state);
	let collectionIsFallback = selectCollectionIsFallback(state);

	let result = [PAGE_DEFAULT];

	//If the card is an orphan, then it should just be the set name (if
	//non-default), and then its card name. A card is an orphan if it is not in
	//a section AND it is not a section-head card (tag header cards are not in
	//any section) AND the collection showing is not a fallback, because the
	//fallback cards, despite being an orphan card, are not an orphan when
	//showing in the fallback context.
	if (card.section || card.card_type=='section-head' || collectionIsFallback) {

		//We need to show the set name if it's not the default set, or if its
		//the default set and there are no filters active (e.g.
		//`c/all/sort/recent/_`)
		if (activeSetName != DEFAULT_SET_NAME || activeFilterNames.length == 0) {
			result.push(activeSetName);
		}

		if (!activeSectionId) {
			//activeSectionId is only there if the only filter is the section name the
			//user is in, which can be omitted for brevity.
			result.push(...activeFilterNames);
		}

	}

	if (activeSortName != DEFAULT_SORT_NAME || activeSortReversed) {
		result.push(SORT_URL_KEYWORD);
		if(activeSortReversed) {
			result.push(SORT_REVERSED_URL_KEYWORD);
		}
		result.push(activeSortName);
	}

	let requestedCard = selectRequestedCard(state);
	if (cardIdIsPlaceholder(requestedCard)) {
		//If the selector was "_" then canonically replace it with just blank.
		if (requestedCard == PLACEHOLDER_CARD_ID_CHARACTER) requestedCard = '';
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

//cardIdIsPlaceholder is whether the cardId (the last part of the URL) starts
//with a "_"
const cardIdIsPlaceholder = (cardId) => {
	if (!cardId) return false;
	return cardId[0] == PLACEHOLDER_CARD_ID_CHARACTER;
};

const cardIdForPlaceholder = (requestedCard, collection) => {
	//Collection is an expanded collection of cards, not card ids.
	if (!cardIdIsPlaceholder(requestedCard)) return '';
	if (!collection || !collection.length) return '';
	//TODO: support random, _popular, _recent, etc.
	return collection[0].id;
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
	let collection = selectFinalCollection(state);
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
		let collection = selectFinalCollection(state);
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

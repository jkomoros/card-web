//Collections are a complex conccept. The canonical (slightly out of date) documentation is at https://github.com/jkomoros/complexity-compendium/issues/60#issuecomment-451705854

import {
	scheduleAutoMarkRead
} from './user.js';

import {
	navigatePathTo,
	navigateToCardInDefaultCollection,
	PAGE_DEFAULT,
	navigateToCollection
} from './app.js';

import {
	SORT_REVERSED_URL_KEYWORD,
	SORT_URL_KEYWORD,
	VIEW_MODE_URL_KEYWORD,
	NONE_FILTER_NAME,
	limitFilter
} from '../filters.js';

import {
	SORT_NAME_DEFAULT,
	SORT_NAME_RANDOM
} from '../type_constants.js';

import {
	Collection,
	CollectionDescription,
} from '../collection_description.js';

import {
	getIdForCard,
	getCard,
	selectDataIsFullyLoaded,
	selectActiveCollectionCards,
	selectActiveCardId,
	selectActiveSectionId,
	selectRequestedCard,
	selectActiveCard,
	selectActiveCardIndex,
	selectPage,
	selectPageExtra,
	getCardIndexForActiveCollection,
	selectActiveCollectionDescription,
	selectActiveCollection,
	selectPendingNewCardIDToNavigateTo,
	selectAlreadyCommittedModificationsWhenFullyLoaded,
	selectCollectionConstructorArguments
} from '../selectors.js';

import {
	CARD_TYPE_CONFIGURATION,
} from '../card_fields.js';

import {
	navigatedToNewCard,
	committedFiltersWhenFullyLoaded
} from './data.js';

import {
	editingStart
} from './editor.js';

import {
	ThunkSomeAction, store
} from '../store.js';

import {
	SetName,
	SortName,
	ViewMode,
	CardID,
	Card,
	State,
	CollectionConstructorArguments
} from '../types.js';

import {
	RANDOMIZE_SALT,
	SHOW_CARD,
	SomeAction,
	UPDATE_COLLECTION,
	UPDATE_COLLECTION_SHAPSHOT,
	UPDATE_RENDER_OFFSET
} from '../actions.js';

export const FORCE_COLLECTION_URL_PARAM = 'force-collection';

export const PLACEHOLDER_CARD_ID_CHARACTER = '_';

export const updateCardSelector = (cardSelector : string) : ThunkSomeAction => (dispatch, getState) => {

	const queryParts = cardSelector.split('?');

	let forceUpdateCollection = false;

	if (queryParts.length > 1) {
		const queryParams = queryParts[1].split('&');
		for (const param of queryParams) {
			if (param == FORCE_COLLECTION_URL_PARAM) forceUpdateCollection = true;
		}
	}

	const path = queryParts[0].toLowerCase();
	let [description, cardIdOrSlug] = CollectionDescription.deserializeWithExtra(path);

	//If the requestedCard is actually "" we'll pretend throughout the pipeline
	//it's actually "_", and just never show it to the user. This is because the
	//identifier "" also happens to be the intial active card ID, which confuses
	//caching logic, so it's better to have it be explicit (just never shown to
	//the user).
	if (cardIdOrSlug == '') cardIdOrSlug = PLACEHOLDER_CARD_ID_CHARACTER;

	let filters = description.filters;
	let doUpdateCollection = true;

	let set : SetName = description.set;

	if (filters.length == 0) {
		const state = getState();
		const card = getCard(state, cardIdOrSlug);
		if (card) {
			//If we had a default filter URL and the card is a member of the set
			//we're already in, leave the collection information the same.
			if (getCardIndexForActiveCollection(state, card.id) >= 0) {
				//TODO :this machinery should be possible to remove. Audit any
				//cases where it's called (autoReads currently causes it to be
				//triggered if you're on a normal default URL and click a card
				//link to navigate to another one) and verify it's always a no
				//op. See #422 for more about the changes that were made to the
				//machinery that made it possibly unnecessary.
				doUpdateCollection = false;
			}

			//Put in the default filters. 
			if (card.section) {
				//If it's a normal, non-orphaned card, the default location is
				//in the filter to the section it's. in.
				filters = [card.section];
			} else {
				//If it's oprhaned...
				if (CARD_TYPE_CONFIGURATION[card.card_type].orphanedByDefault && !description.setNameExplicitlySet) {
					//If it's a working notes card then by default we'll view it
					//in the collection including all of its other cards.
					set = 'everything';
					filters = [card.card_type];
				} else {
					filters = [NONE_FILTER_NAME];
				}
			}
		} else if(!description.setNameExplicitlySet) {

			//If the set was explicitly specified, e.g. `/c/all/sort/recent/_`
			//then don't filter out items.

			//Make sure the collection has no items, so canonicalizeURL won't add
			//'main' in it which would then load up the whole collection before
			//redirecting.
			filters = [NONE_FILTER_NAME];
		}
	}

	if (doUpdateCollection || forceUpdateCollection) dispatch(updateCollection(set, filters, description.sort, description.sortReversed, description.viewMode, description.viewModeExtra));
	dispatch(showCard(cardIdOrSlug));
};

export const updateCollection = (setName : SetName, filters : string[], sortName : SortName, sortReversed : boolean, viewMode : ViewMode, viewModeExtra : string) : ThunkSomeAction => (dispatch, getState) =>{	
	const state = getState();
	const activeCollectionDescription = selectActiveCollectionDescription(state);
	const newCollectionDescription = new CollectionDescription(setName, filters, sortName, sortReversed, viewMode, viewModeExtra);
	if (activeCollectionDescription.equivalent(newCollectionDescription)) return;

	//make sure we're working with the newest set of filters, because now is the
	//one time that it's generally OK to update the active filter set, since the
	//whole collection is changing anyway.
	dispatch(updateCollectionSnapshot());
	dispatch({
		type: UPDATE_COLLECTION,
		setName,
		filters,
		sortName,
		sortReversed,
		viewMode,
		viewModeExtra
	});
};

//commitPendingCollectionModifications should be dispatched when the list of
//things that should show in a given collection may have changed and you want
//the collection to cahnge at that moment. Often, we DON'T want it to change, to
//emphasize consistency and so collections don't change as, for exmaple, a card
//is read and you're viewing an unread filter set.
export const updateCollectionSnapshot = () : SomeAction => {
	return {type:UPDATE_COLLECTION_SHAPSHOT};
};

export const updateRenderOffset = (renderOffset : number) : SomeAction => {
	return {
		type: UPDATE_RENDER_OFFSET,
		renderOffset
	};
};

export const refreshCardSelector = (forceCommit? : boolean) : ThunkSomeAction => (dispatch, getState) => {
	//Called when cards and sections update, just in case we now have
	//information to do this better. Also called when stars and reads update,
	//because if we're filtering to one of those filters we might not yet know
	//if we're in that collection or not.

	//forceCommit is whether the commitPendingCollectionModifications should be
	//forced to updated now even if the data is fully laoded.

	const state = getState();

	const page = selectPage(state);
	if (page != PAGE_DEFAULT) return;
	const pageExtra = selectPageExtra(state);

	const dataIsFullyLoaded = selectDataIsFullyLoaded(state);
	const alreadyCommittedModificationsWhenFullyLoaded = selectAlreadyCommittedModificationsWhenFullyLoaded(state);

	if (!dataIsFullyLoaded || (dataIsFullyLoaded && !alreadyCommittedModificationsWhenFullyLoaded) || forceCommit) {
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
		dispatch(updateCollectionSnapshot());
	}

	if (dataIsFullyLoaded && !alreadyCommittedModificationsWhenFullyLoaded) {
		dispatch(committedFiltersWhenFullyLoaded());
	}

	dispatch(updateCardSelector(pageExtra));
};

export const canonicalizeURL = () : ThunkSomeAction => (dispatch, getState) => {

	//Called to ensure that the URL is canonical given activeSet, activeFilters, etc.

	const state = getState();

	const card = selectActiveCard(state);

	if (!card) return;

	const activeSectionId = selectActiveSectionId(state);
	const description = selectActiveCollectionDescription(state);
	const collection = selectActiveCollection(state);
	const collectionContainsCards = collection && collection.numCards > 0;

	const result = [PAGE_DEFAULT];

	let requestedCard = selectRequestedCard(state);
	//If the selector was "_" then canonically replace it with just blank.
	if (requestedCard == PLACEHOLDER_CARD_ID_CHARACTER) requestedCard = '';
	

	//As long as the card is not a singleton orphan, then we want to put in the
	//sets and filters (possibly eliding the set if it's the default URL to the
	//card). A card is a singleton orphan if it has a blank section AND the
	//current collection doesn't have any cards. It's possible for an orphan
	//card to be selected, e.g. if the `everything` set (as opposed to the
	//`main` set) is selected.
	if (collectionContainsCards || card.section) {

		//We need to show the set name if it's not the default set, or if its
		//the default set and there are no filters active (e.g.
		//`c/main/sort/recent/_`)
		if (description.set != 'main' || description.filters.length == 0) {
			result.push(description.set);
		}

		//Don't elide the activeSectionId if we didn't select a specific card
		if (!activeSectionId || !requestedCard) {
			//activeSectionId is only there if the only filter is the section name the
			//user is in, which can be omitted for brevity.
			result.push(...description.filters);
		}

	}

	//TODO: it's weird to recreate the logic of CollectionDescription.serialize() here.
	if (description.sort != SORT_NAME_DEFAULT || description.sortReversed) {
		result.push(SORT_URL_KEYWORD);
		if(description.sortReversed) {
			result.push(SORT_REVERSED_URL_KEYWORD);
		}
		result.push(description.sort);
	}

	if (description.viewMode != 'list') {
		result.push(VIEW_MODE_URL_KEYWORD);
		result.push(description.viewMode);
		if (description.viewModeExtra) result.push(description.viewModeExtra);
	}


	if (cardIdIsPlaceholder(requestedCard) || !requestedCard) {
		//If it was a special placeholder that was requested, then leave it in
		//the URL. If they arrow down and back up it's OK for it go back to its
		//canonical URL.
		result.push(requestedCard);
	} else {
		result.push(card.name);
	}

	const path = result.join('/');

	//Ensure that the article name that we're shwoing--no matter how they
	//havigated here--is the preferred slug name.
	dispatch(navigatePathTo(path, true));
};

//cardIdIsPlaceholder is whether the cardId (the last part of the URL) starts
//with a "_"
const cardIdIsPlaceholder = (cardId : CardID) : boolean => {
	if (!cardId) return false;
	return cardId[0] == PLACEHOLDER_CARD_ID_CHARACTER;
};

const cardIdForPlaceholder = (requestedCard : CardID, collection : Card[]) : CardID => {
	//Collection is an expanded collection of cards, not card ids.
	if (!cardIdIsPlaceholder(requestedCard)) return '';
	if (!collection || !collection.length) return '';
	//TODO: support random, _popular, _recent, etc.
	return collection[0].id;
};

export const redirectIfInvalidCardOrCollection = () : ThunkSomeAction => (dispatch, getState) => {

	//This routine is called to make sure that if there is a valid card, we're
	//actually sitting in a collection that contains it. If we aren't, we
	//navigate to its canonical location.

	//It's also responsible for checking to see if the card ID is the special
	//placehodler "_" which means, just pick a random item out of the collection
	//I selected.

	const state = getState();
	if (!selectDataIsFullyLoaded(state)) return;
	const card = selectActiveCard(state);
	const collection = selectActiveCollectionCards(state);
	if (!card) {
		
		//If we get here, we could navigate to a default card (we know that the
		//card is invalid), but it's better to just show an error card.

		return;
	}
  
	if (!collection.length) return;
	const index = selectActiveCardIndex(state);
	//If the card is not in this collection, then forward to a collection that
	//it is in.
	if (index >= 0) return;
	dispatch(navigateToCardInDefaultCollection(card, false));
};

export const showCard = (requestedCard : CardID = PLACEHOLDER_CARD_ID_CHARACTER) : ThunkSomeAction => (dispatch, getState) => {

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
		//We used to check that data was fully loaded here. But that delays
		//showing the content for the card until EVERYTHING is loaded. And
		//because the cardID is canonically removed from the URL, it doesn't
		//really matter if we change the requested card later. This logic will
		//need updating if/when we support other placeholders like _random.
		const collection = selectActiveCollectionCards(state);
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

	const pendingNewCardIDToNavigateTo = selectPendingNewCardIDToNavigateTo(state);

	if (pendingNewCardIDToNavigateTo == cardId) {
		//This is where we note that we were told to navigate 
		dispatch(navigatedToNewCard());

		const card = selectActiveCard(state);
		const cardTypeConfig = CARD_TYPE_CONFIGURATION[card.card_type];
		//If it's a card type that autoSlugs (like concept card) then don't open
		//for editing immediately, because the autoSlug will come in later, and
		//if the card's already open for editing then it will be ignored, and if
		//the user then saves that card, the autoSlug will be overridden. This
		//is kind of a hack, really what should happen is when the
		//undelryingCard is changed, the modifications should be rediffed on
		//top.
		if (cardTypeConfig && cardTypeConfig.autoSlug) return;

		//Try to open the new card for editing. Note thta the timestamp data
		//will be estimates only at this point (see
		//database.js/cardSnapshotReceiver), but that's OK because they'll be
		//set properly later.
		dispatch(editingStart());
	}
};

export const RANDOM_CARD_COLLECTION = new CollectionDescription('everything', [limitFilter(1)], SORT_NAME_RANDOM, false);

const randomizeSalt = () : SomeAction => {
	return {
		type: RANDOMIZE_SALT,
	};
};

export const randomizeCollection = () : ThunkSomeAction => (dispatch, getState) => {
	dispatch(randomizeSalt());
	//Only show card if it's the default page ('c') where a card collection is selected
	if (selectPage(getState()) != PAGE_DEFAULT) return;
	const collection = selectActiveCollectionDescription(getState());
	if (!collection.isRandom) return;
	//showCard without an argument will show the default card in a collection, immediately
	dispatch(showCard());
};

export const navigateToRandomCard = () : ThunkSomeAction => (dispatch) => {
	dispatch(navigateToCollection(RANDOM_CARD_COLLECTION));
	dispatch(randomizeCollection());
};

//Allows awaiting a new state
const waitForStateChange = async () : Promise<void> => {
	return new Promise((resolve) => {
		const unsubscribe = store.subscribe(() => {
			unsubscribe();
			resolve();
		});
	});
};

type WaitForFinalCollectionArgs = {
	argGetter? : (state : State) => CollectionConstructorArguments,
	keyCardID? : CardID
};

//Waits until the given collection can be created with no preview filter
//results. In practice this is useful to wait until the similar cards has
//settled and used the embedding based similarity. If keyCardID is provided,
//then the args to the collection will be overriden with that keyCardID.
export const waitForFinalCollection = async (description : CollectionDescription, options : WaitForFinalCollectionArgs = {}) : Promise<Collection> => {

	const argGetter = options.argGetter || selectCollectionConstructorArguments;
	const keyCardID = options.keyCardID;

	let continueLooping = true;

	let collection : Collection | null = null;

	do {
		const state = store.getState() as State;
		let args = argGetter(state);
		if (keyCardID) args = {
			...args,
			keyCardID
		};
		collection = description.collection(args);
		if (!collection.preview) {
			continueLooping = false;
			break;
		}
		//wait until the state updates again to try again
		await waitForStateChange();
	} while(continueLooping);

	if (!collection) throw new Error('We somehow settled without a collection');

	return collection;
};
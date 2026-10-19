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
	NONE_FILTER_NAME,
	limitFilter
} from '../filters.js';

import {
	Collection,
	CollectionDescription,
	collectionURLPath,
} from '../collection_description.js';

import {
	cardIDIsPlaceholder,
	resolveCardRequest,
	resolveInvalidCollectionCard,
	shouldRefreshCollectionSnapshot,
} from '../collection-navigation.js';

import {
	getIdForCard,
	getCard,
	selectDataIsFullyLoaded,
	selectActiveCollectionCardIDs,
	selectActiveCardID,
	selectRequestedCard,
	selectActiveCard,
	selectPage,
	selectPageExtra,
	getCardIndexForActiveCollection,
	selectActiveCollectionDescription,
	selectActiveCollection,
	selectPendingNewCardIDToNavigateTo,
	selectAlreadyCommittedModificationsWhenFullyLoaded,
	selectCollectionConstructorArguments,
	selectExplicitlySelectedCardIDs,
	selectKnownCollectionFilterNames,
	selectUid,
} from '../selectors.js';

import {
	collectionDescriptionActuallyVisited,
	recordRecentCollection,
} from '../collection-composer-history.js';

import {
	CARD_TYPE_CONFIGURATION,
} from '../../shared/card_fields.js';

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
} from '../../shared/types.js';

import {
	CardID,
	State,
	CollectionConstructorArguments
} from '../types.js';

import {
	CLEAR_SELECTED_CARDS,
	INCREMENT_COLLECTION_WORD_CLOUD_VERSION,
	RANDOMIZE_SALT,
	SELECT_CARDS,
	SHOW_CARD,
	SomeAction,
	UNSELECT_CARDS,
	UPDATE_COLLECTION,
	UPDATE_COLLECTION_CONFIGURATION_SHAPSHOT,
	UPDATE_COLLECTION_SHAPSHOT,
	UPDATE_RENDER_OFFSET,
} from '../actions.js';

export const FORCE_COLLECTION_URL_PARAM = 'force-collection';

export const PLACEHOLDER_CARD_ID_CHARACTER = '_';

//What a card selector RESOLVES to, which is not the same thing as what it
//says. A URL with no filters at all names no collection; the rules below are
//how the router decides which one the user actually lands in.
export type ResolvedCardSelector = {
	//The collection that will become active.
	description : CollectionDescription,
	//The card the URL asked for, with '' already rewritten to the placeholder.
	cardIdOrSlug : CardID,
	//False when the URL's card is already in the collection on screen, so the
	//active collection is deliberately left alone.
	updatesCollection : boolean,
	//TRUE WHEN THE ROUTER INVENTED THE CLAUSES. A `/c/<cardid>` URL names a
	//card and no collection at all, so the rules below substitute one — the
	//card's section, the everything-set for an orphan, or the `none`
	//placeholder. That substitution is a fallback, not a destination the user
	//chose, and callers that RECORD where the user has been have to be able to
	//tell the two apart.
	substitutedCollection : boolean,
};

//Exported so that a caller who is about to push a path can ask what that path
//will actually turn into — a receipt that names the REQUESTED collection while
//the router quietly resolves a different one is the shape of bug this exists
//to close. It is the same resolution updateCardSelector performs, so the two
//cannot answer differently.
export const resolveCardSelector = (state : State, cardSelector : string) : ResolvedCardSelector => {

	const path = cardSelector.split('?')[0].toLowerCase();
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
				const configuration = CARD_TYPE_CONFIGURATION[card.card_type];
				//If it's oprhaned...
				if (configuration && configuration.orphanedByDefault && !description.setNameExplicitlySet) {
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

	return {
		description: new CollectionDescription(set, filters, description.sort, description.sortReversed, description.viewMode, description.viewModeExtra),
		cardIdOrSlug,
		updatesCollection: doUpdateCollection,
		//The URL carried no clauses and this function supplied some: whatever
		//comes back is the router's answer to "where does this card live", not
		//the user's answer to "which collection do I want".
		substitutedCollection: description.filters.length == 0 && filters.length > 0,
	};
};

export const updateCardSelector = (cardSelector : string) : ThunkSomeAction => (dispatch, getState) => {

	const queryParts = cardSelector.split('?');

	let forceUpdateCollection = false;

	if (queryParts.length > 1) {
		const queryParams = queryParts[1].split('&');
		for (const param of queryParams) {
			if (param == FORCE_COLLECTION_URL_PARAM) forceUpdateCollection = true;
		}
	}

	const {description: resolvedDescription, cardIdOrSlug, updatesCollection, substitutedCollection} = resolveCardSelector(getState(), cardSelector);
	const doUpdateCollection = updatesCollection || forceUpdateCollection;

	const descriptionActuallyVisited = collectionDescriptionActuallyVisited(
		resolvedDescription,
		selectActiveCollectionDescription(getState()),
		doUpdateCollection
	);
	//A SUBSTITUTED COLLECTION IS NOT A PLACE THE USER WENT — and the guard that
	//says so lives with the other poison guards, in the history module, so every
	//future caller inherits it. Only when the substitution is what would be
	//recorded: a card already inside the collection on screen leaves that
	//collection active, and THAT is a real destination.
	recordRecentCollection(descriptionActuallyVisited, selectUid(getState()), Date.now(), {
		rawURL: cardSelector,
		knownFilterNames: selectKnownCollectionFilterNames(getState()),
		substituted: substitutedCollection && doUpdateCollection,
	});
	if (doUpdateCollection) dispatch(updateCollection(resolvedDescription.set, resolvedDescription.filters, resolvedDescription.sort, resolvedDescription.sortReversed, resolvedDescription.viewMode, resolvedDescription.viewModeExtra));
	dispatch(showCard(cardIdOrSlug));
};

export const updateCollectionConfigurationSnapshot = (description : CollectionDescription) : SomeAction => {

	//TODO: it's kind of silly that we expect a dsecription and then unpack it.
	//It should be faster to just modify a copy of the current collection configuration snapshot.
	//But we already have a lot of e.g. collectionDescriptionWithFilterRemoved so :shrug:

	return {
		type: UPDATE_COLLECTION_CONFIGURATION_SHAPSHOT,
		collection: {
			setName: description.set,
			filterNames: description.filters,
			sortName: description.sort,
			sortReversed: description.sortReversed,
			viewMode: description.viewMode,
			viewModeExtra: description.viewModeExtra
		}
	};
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
		collection: {
			setName,
			filterNames: filters,
			sortName,
			sortReversed,
			viewMode,
			viewModeExtra
		}
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

	if (shouldRefreshCollectionSnapshot({
		dataFullyLoaded: dataIsFullyLoaded,
		alreadyCommittedWhenFullyLoaded: alreadyCommittedModificationsWhenFullyLoaded,
		forceCommit: Boolean(forceCommit),
		requestedCard: selectRequestedCard(state),
		activeCollectionSize: selectActiveCollectionCardIDs(state).length,
	})) {
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
		//to run it once. An empty collection reached through the default-card
		//placeholder is the other exception: it may be waiting for a just-written
		//tag/card echo, so refresh its snapshot until the first match appears.
		dispatch(updateCollectionSnapshot());
	}

	if (dataIsFullyLoaded && !alreadyCommittedModificationsWhenFullyLoaded) {
		dispatch(committedFiltersWhenFullyLoaded());
	}

	dispatch(updateCardSelector(pageExtra));
};

export const canonicalizeURL = () : ThunkSomeAction => (dispatch, getState) => {
	const state = getState();
	const card = selectActiveCard(state);
	if (!card) return;
	const requestedCard = selectRequestedCard(state);
	//The URL records intent, not the current result's cardinality. A worker
	//result can be empty (or still pending) while an explicitly selected card
	//exists. Dropping clauses here turned that temporary state into a different
	//destination on the next refresh. Use the shared serializer, including for
	//section collections, so passive canonicalization never changes the query.
	const selectedCard = requestedCard === PLACEHOLDER_CARD_ID_CHARACTER ? '' :
		cardIDIsPlaceholder(requestedCard) || !requestedCard ? requestedCard : card.name;
	dispatch(navigatePathTo(collectionURLPath(selectActiveCollectionDescription(state), {selectedCard, originalOrder: true}), true));
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
	const activeCollection = selectActiveCollection(state);
	if (!activeCollection || activeCollection.isTransitional) return;
	const collection = activeCollection.finalSortedCardIDs;
	if (!card) {
		
		//If we get here, we could navigate to a default card (we know that the
		//card is invalid), but it's better to just show an error card.

		return;
	}
  
	const resolution = resolveInvalidCollectionCard(
		selectRequestedCard(state),
		card.id,
		collection
	);
	if (resolution.action === 'stay') return;
	if (resolution.action === 'select-first') {
		dispatch(showCard(selectRequestedCard(state)));
		return;
	}
	//An explicitly requested card takes precedence over a collection that does
	//not contain it, so forward to the card's default collection.
	dispatch(navigateToCardInDefaultCollection(card, false));
};

export const showCard = (requestedCard : CardID = PLACEHOLDER_CARD_ID_CHARACTER) : ThunkSomeAction => (dispatch, getState) => {

	const state = getState();

	const collection = cardIDIsPlaceholder(requestedCard) ? selectActiveCollectionCardIDs(state) : [];
	const resolution = resolveCardRequest(
		requestedCard,
		getIdForCard(state, requestedCard),
		selectActiveCardID(state),
		collection
	);
	if (!resolution.commit) {
		dispatch(redirectIfInvalidCardOrCollection());
		return;
	}
	const cardId = resolution.cardID;

	dispatch({
		type: SHOW_CARD,
		requestedCard: requestedCard,
		card: cardId,
	});
	//Keep the placeholder request in state while membership catches up. A later
	//refresh will select the first card without redirecting away from the
	//explicitly requested collection.
	if (resolution.collectionPending) return;
	dispatch(redirectIfInvalidCardOrCollection());
	dispatch(canonicalizeURL());
	dispatch(scheduleAutoMarkRead());

	//Re-read: `state` above predates the SHOW_CARD dispatch, so selectors run
	//against it resolve the PREVIOUS card — the existence guard below passed on
	//the old card's presence while the new card had not arrived, and the
	//autoSlug bail-out tested the old card's type. The dispatches above can
	//also re-enter showCard synchronously (redirectIfInvalidCardOrCollection →
	//'select-first'), consuming the pending flag this frame is about to check.
	const stateAfterShow = getState();
	const pendingNewCardIDToNavigateTo = selectPendingNewCardIDToNavigateTo(stateAfterShow);

	if (pendingNewCardIDToNavigateTo == cardId) {
		//This is where we note that we were told to navigate
		dispatch(navigatedToNewCard());

		//By the ID this frame resolved, not selectActiveCard: the dispatches
		//above can re-enter navigation (redirectIfInvalidCardOrCollection),
		//and if the active card has since moved elsewhere the editor must not
		//open on whatever it moved to.
		if (selectActiveCardID(stateAfterShow) !== cardId) return;
		const card = selectActiveCard(stateAfterShow);
		if (!card) return;
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

export const RANDOM_CARD_COLLECTION = new CollectionDescription('everything', [limitFilter(1)], 'random', false);

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

export const toggleCardSelected = (id : CardID) : ThunkSomeAction => (dispatch, getState) => {
	const state = getState();
	const selected = selectExplicitlySelectedCardIDs(state);
	if (selected[id]) {
		dispatch(unselectCards([id]));
	} else {
		dispatch(doSelectCards([id]));
	}
};

//Funky name to avoid colliding with selectCards selector
export const doSelectCards = (cards : CardID[]) : SomeAction => {
	return {
		type: SELECT_CARDS,
		cards
	};
};

export const unselectCards = (cards : CardID[]) : SomeAction => {
	return {
		type: UNSELECT_CARDS,
		cards
	};
};

export const clearSelectedCards = () : SomeAction => {
	return {
		type: CLEAR_SELECTED_CARDS
	};
};

export const incrementCollectionWordCloud = () : SomeAction => {
	return {
		type: INCREMENT_COLLECTION_WORD_CLOUD_VERSION
	};
};

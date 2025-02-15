/**
@license
Copyright (c) 2018 The Polymer Project Authors. All rights reserved.
This code may only be used under the BSD style license found at http://polymer.github.io/LICENSE.txt
The complete set of authors may be found at http://polymer.github.io/AUTHORS.txt
The complete set of contributors may be found at http://polymer.github.io/CONTRIBUTORS.txt
Code distributed by Google as part of the polymer project is also
subject to an additional IP rights grant found at http://polymer.github.io/PATENTS.txt
*/

import {
	_PAGE_BASIC_CARD
} from '../util.js';

//Note: some of these are also duplicated in functions/common.js
export const PAGE_DEFAULT = 'c';
export const PAGE_BASIC_CARD = _PAGE_BASIC_CARD;
export const PAGE_COMMENT = 'comment';
export const PAGE_MAINTENANCE = 'maintenance';
export const PAGE_PERMISSIONS = 'permissions';
export const PAGE_404 = 'view404';

import {
	selectActiveCollectionCards,
	selectCommentsAreFullyLoaded,
	getMessageById,
	getThreadById,
	selectPage,
	selectPageExtra,
	selectActivePreviewCardId,
	selectFetchedCard,
	selectCards,
	selectComposeOpen,
	selectIsEditing,
	selectActiveCardIndex,
	selectUserMayEditActiveCard,
	selectDefaultCollectionDescription,
	selectCtrlKeyPressed,
	selectCardsDrawerInfoExpanded,
	selectActiveCollectionDescription,
	getCardIndexForActiveCollection
} from '../selectors.js';

import {
	pageRequiresMainView
} from '../util.js';

import {
	db
} from '../firebase.js';

import {
	receiveCards
} from './data.js';

import {
	editingStart,
	editingCommit
} from './editor.js';

import {
	composeCommit
} from './prompt.js';

import {
	REFERENCES_INBOUND_CARD_PROPERTY,
	CARDS_COLLECTION
} from '../type_constants.js';

import {
	references,
} from '../references.js';

import {
	collectionDescriptionWithQuery,
	collectionDescriptionWithConfigurableFilter,
	CollectionDescription,
	collectionDescriptionWithSelected
} from '../collection_description.js';

import {
	aboutConceptFilter,
} from '../filters.js';

import {
	getDocs,
	query,
	where,
	collection,
	limit,
	getDoc,
	doc,
	DocumentSnapshot
} from 'firebase/firestore';

import {
	CardID,
	Card,
	Cards,
	TagID,
	CardIdentifier,
	CommentMessageID,
	CommentThreadID
} from '../types.js';

import {
	ThunkSomeAction
} from '../store.js';

import {
	CARD_BEING_FETCHED,
	CLOSE_CARDS_DRAWER_INFO,
	CLOSE_CARDS_DRAWER_PANEL,
	CLOSE_COMMENTS_AND_INFO_PANEL,
	CLOSE_CONFIGURE_COLLECTION_DIALOG,
	CLOSE_HEADER_PANEL,
	CLOSE_SNACKBAR,
	DISABLE_MOBILE_MODE,
	DISABLE_PRESENTATION_MODE,
	ENABLE_MOBILE_MODE,
	ENABLE_PRESENTATION_MODE,
	OPEN_CARDS_DRAWER_INFO,
	OPEN_CARDS_DRAWER_PANEL,
	OPEN_COMMENTS_AND_INFO_PANEL,
	OPEN_CONFIGURE_COLLECTION_DIALOG,
	OPEN_HEADER_PANEL,
	OPEN_SNACKBAR,
	SomeAction,
	TURN_SUGGEST_MISSING_CONCEPTS,
	UPDATE_CTRL_KEY_PRESSED,
	UPDATE_FETCHED_CARD,
	UPDATE_HOVERED_CARD,
	UPDATE_OFFLINE,
	UPDATE_PAGE
} from '../actions.js';

//if silent is true, then just passively updates the URL to reflect what it should be.
export const navigatePathTo = (path : string, silent? : boolean) : ThunkSomeAction => (dispatch, getState) => {
	const state = getState();
	//If we're already pointed there, no need to navigate
	if ('/' + path === window.location.pathname) return;
	if (selectIsEditing(state)) {
		console.log('Can\'t navigate while editing');
		return;
	}
	if (silent) {
		window.history.replaceState({}, '', path);
		return;
	}
	window.history.pushState({}, '', path);
	dispatch(navigated(path, location.search));
};

export const navigateToNextCard = () : ThunkSomeAction => (dispatch, getState) => {
	const state = getState();
	let index = selectActiveCardIndex(state);
	index++;
	const collection = selectActiveCollectionCards(state);
	if (!collection) return;
	const newCard = collection[index];
	if (!newCard) return;
	dispatch(navigateToCardInCurrentCollection(newCard.id));
};

export const navigateToPreviousCard = () : ThunkSomeAction => (dispatch, getState) => {
	const state = getState();
	let index = selectActiveCardIndex(state);
	index--;
	const collection = selectActiveCollectionCards(state);
	if (!collection) return;
	const newCard = collection[index];
	if (!newCard) return;
	dispatch(navigateToCardInCurrentCollection(newCard.id));
};

export const urlForCard = (cardOrId : Card | CardID) : string => {
	let id = cardOrId;
	if(!id) return '';
	//note: null is an object;
	if (cardOrId && typeof cardOrId === 'object') {
		id = cardOrId.name;
	}
	return '/' + PAGE_DEFAULT + '/' + id;
};

export const urlForTag = (tagName : TagID, optCardId? : CardID) : string => {
	if (!optCardId) optCardId = '';
	return '/' + PAGE_DEFAULT + '/' + tagName + '/' + optCardId;
};

//Should be called any time we might want to redirect to the given comment. For
//example, when the redirect comment view boots, or when threads or messages are
//loaded.
export const refreshCommentRedirect = () : ThunkSomeAction => (dispatch, getState) => {
	//Called when cards and sections update, just in case we now have
	//information to do this better. Also called when stars and reads update,
	//because if we're filtering to one of those filters we might not yet know
	//if we're in that collection or not.
	const state = getState();

	const page = selectPage(state);
	if (page != PAGE_COMMENT) return;
	const pageExtra = selectPageExtra(state);
	dispatch(navigateToComment(pageExtra));
};

export const askForPathToNavigateTo = () : ThunkSomeAction => (dispatch) => {
	const location = window.location.pathname;
	const newLocation = prompt('Where do you want to navigate to?', location);
	if (!newLocation) return;
	if (newLocation == location) return;
	dispatch(navigatePathTo(newLocation, false));
};

export const navigateToComment = (commentId : CommentMessageID | CommentThreadID) : ThunkSomeAction => (dispatch, getState) => {
	//commentId is either a thread or message id.
	const state = getState();
	if (!selectCommentsAreFullyLoaded(state)) return;

	const message = getMessageById(state, commentId);
	if (message) {
		dispatch(navigateToCardInDefaultCollection(message.card));
		return;
	}
	const thread = getThreadById(state, commentId);
	if (thread) {
		dispatch(navigateToCardInDefaultCollection(thread.card));
		return;
	}
	alert('That comment does not exist. Redirecting to the default card.');
	dispatch(navigateToDefaultIfSectionsAndTagsLoaded(false));
};

//navigateToDefaultIfSectionsLoaded will navigate to default if sections are
//loaded. If they aren't, it won't do anything.
export const navigateToDefaultIfSectionsAndTagsLoaded = (silent? : boolean) : ThunkSomeAction => (dispatch, getState) => {
	const defaultCollectionDescription = selectDefaultCollectionDescription(getState());
	if (!defaultCollectionDescription) {
		//must not have loaded yet
		return;
	}
	dispatch(navigatePathTo('/' + PAGE_DEFAULT + '/' + defaultCollectionDescription.serialize(), silent));
};

export const navigateToCardInCurrentCollection = (cardID : CardID, silent? : boolean) : ThunkSomeAction => (dispatch, getState) => {
	const state = getState();
	const cardIndexinActiveCollection = getCardIndexForActiveCollection(state, cardID);
	if (cardIndexinActiveCollection < 0) {
		dispatch(navigateToCardInDefaultCollection(cardID, silent));
		return;
	}
	//If there is an active collection, then we're in a place where the path is
	//a collection and we can just swap out the cardID (or blank) at the end.
	//This preserves the order of all filters, etc. ... Which feels a bit like a
	//hack.
	const pageExtra = selectPageExtra(state);
	const pageExtraParts = pageExtra.split('/');
	pageExtraParts[pageExtraParts.length - 1] = cardID;
	const path = '/' + PAGE_DEFAULT + '/' + pageExtraParts.join('/');
	dispatch(navigatePathTo(path, silent));
};

//if card is not provided, will try to navigate to default if sections loaded.
export const navigateToCardInDefaultCollection = (cardOrId : Card | CardID, silent? : boolean) : ThunkSomeAction => (dispatch) => {
	const path = urlForCard(cardOrId);
	if (!path) {
		dispatch(navigateToDefaultIfSectionsAndTagsLoaded(silent));
	}
	dispatch(navigatePathTo(path, silent));
};

export const navigateToCollectionWithAboutConcept = (conceptStr : string) : ThunkSomeAction => (dispatch, getState) => {
	const collection = selectActiveCollectionDescription(getState());
	const newCollection = collectionDescriptionWithConfigurableFilter(collection, aboutConceptFilter(conceptStr));
	dispatch(navigateToCollection(newCollection));
};

export const navigateToCollectionWithQuery = (queryText : string) : ThunkSomeAction => (dispatch, getState) => {
	const collection = selectActiveCollectionDescription(getState());
	const newCollection = collectionDescriptionWithQuery(collection, queryText);
	dispatch(navigateToCollection(newCollection));
};

export const navigateToCollectionWithSelected = () : ThunkSomeAction => (dispatch, getState) => {
	const collection = selectActiveCollectionDescription(getState());
	const newCollection = collectionDescriptionWithSelected(collection);
	dispatch(navigateToCollection(newCollection));
};

export const urlForCollection = (collection : CollectionDescription) : string => {
	return '/' + PAGE_DEFAULT + '/' + collection.serializeShortOriginalOrder();
};

export const navigateToCollection = (collection : CollectionDescription) => {
	return navigatePathTo(urlForCollection(collection));
};

export const navigated = (path : string, query : string) : ThunkSomeAction => (dispatch) => {

	// Extract the page name from path.
	const page = path === '/' ? PAGE_DEFAULT : path.slice(1);

	// Any other info you might want to extract from the path (like page type),
	// you can do here
	dispatch(loadPage(page, query));

};

const loadPage = (pathname : string, query : string) : ThunkSomeAction => (dispatch) => {

	//pathname is the whole path minus starting '/', like 'c/VIEW_ID'
	const pieces = pathname.split('/');

	let page = pieces[0];
	let pageExtra = pieces.length < 2 ? '' : pieces.slice(1).join('/');

	if (query) pageExtra += query;

	if (pageRequiresMainView(page)) import('../components/main-view.js');

	switch(page) {
	case PAGE_DEFAULT:
		import('../components/card-view.js').then(() => {
			// Put code in here that you want to run every time when
			// navigating to view1 after my-view1.js is loaded.
		});
		break;
	case PAGE_COMMENT:
		import('../components/comment-redirect-view.js');
		break;
	case PAGE_MAINTENANCE:
		import('../components/maintenance-view.js');
		break;
	case PAGE_BASIC_CARD:
		import('../components/basic-card-view.js');
		break;
	case PAGE_PERMISSIONS:
		import('../components/permissions-view.js');
		break;
	default:
		page = PAGE_404;
		import('../components/my-view404.js');
	}

	dispatch(updatePage(pathname, page, pageExtra));
};

const updatePage = (location : string, page : string, pageExtra : string) : SomeAction => {
	return {
		type: UPDATE_PAGE,
		location,
		page,
		pageExtra
	};
};

const fetchCardFromDb = async (cardIDOrSlug : CardIdentifier) : Promise<DocumentSnapshot | null> => {
	//Cards are more likely to be fetched via slug, so try that first
	const cards = await getDocs(query(collection(db, CARDS_COLLECTION), where('published', '==', true), where('slugs', 'array-contains', cardIDOrSlug), limit(1)));
	if (cards && !cards.empty) {
		return cards.docs[0];
	}
	const card = await getDoc(doc(db, CARDS_COLLECTION, cardIDOrSlug));
	if (card && card.exists()) {
		return card;
	}
	return null;
};

const fetchCardLinkCardsForFetchedCardFromDb : ((card : Card) => Promise<Cards>) = async (card : Card) => {
	//orderBy is effectively a filter to only items that have 'references.CARD_ID' key.
	const rawQuery = await getDocs(query(collection(db, CARDS_COLLECTION), where('published', '==', true), where(REFERENCES_INBOUND_CARD_PROPERTY + '.' + card.id, '==', true)));
	if (rawQuery.empty) return {};
	return Object.fromEntries(rawQuery.docs.map(doc => [doc.id, {...doc.data(), id: doc.id} as Card]));
};

//Exposed so basic-card-view can expose an endpoint. Typically you use
//fetchCard.
export const updateFetchedCard = (card : Card) : SomeAction => {
	return {
		type: UPDATE_FETCHED_CARD,
		card
	};
};

export const fetchCardLinkCardsForFetchedCard = (fetchedCard : Card) : ThunkSomeAction => async (dispatch, getState) =>{
	if (!fetchedCard || Object.values(fetchedCard).length == 0) return;

	//If all of the cards were already fetched we can bail early.
	const links = references(fetchedCard).substantiveArray();
	const state = getState();
	const fetchedCards = selectCards(state);
	const allCardsFetched = links.every(cardID => fetchedCards[cardID]);
	if (allCardsFetched) {
		//Dispatching updateCards, even with any empty one, is how we signal
		//that everything is done loading, so the card viewer knows to fade it
		//in.
		dispatch(receiveCards({}, 'published'));
		return;
	}

	const cards = await fetchCardLinkCardsForFetchedCardFromDb(fetchedCard);
	dispatch(receiveCards(cards, 'published'));
};

export const fetchCard = (cardIDOrSlug : CardIdentifier) : ThunkSomeAction => async (dispatch, getState) =>  {
	if (!cardIDOrSlug) return;

	//If we already fetched the card in question we can stop.
	const state = getState();
	const previouslyFetchedCard = selectFetchedCard(state);
	if (previouslyFetchedCard && Object.entries(previouslyFetchedCard).length) {
		if (previouslyFetchedCard.id == cardIDOrSlug) return;
		if (previouslyFetchedCard.slugs && previouslyFetchedCard.slugs.some(slug => slug == cardIDOrSlug)) return;
	}

	dispatch({
		type: CARD_BEING_FETCHED
	});
	
	//To be used to fetch a singular card from the store, as in basic-card-view.
	const rawCard = await fetchCardFromDb(cardIDOrSlug);
	if (!rawCard) {
		console.warn('no cards matched');
		return;
	}
	const card = {...rawCard.data(), id: rawCard.id} as Card;
	if (!card.published) {
		console.warn('Card wasn\'t published');
		return;
	}
	dispatch(await fetchCardLinkCardsForFetchedCard(card));
	dispatch(updateFetchedCard(card));
};

//A generic commit action, depending on what is happening. If editing, commit
//the edit. If composing, commit the compose.
export const doCommit = () : ThunkSomeAction => (dispatch, getState) => {
	const state = getState();
	if (selectIsEditing(state)) {
		dispatch(editingCommit());
		return;
	}
	if (selectComposeOpen(state)) {
		dispatch(composeCommit());
		return;
	}
	if (selectUserMayEditActiveCard(state)) {
		dispatch(editingStart());
		return;
	}
	return;
};

let hoverPreviewTimer : number;
const HOVER_CARD_PREVIEW_DELAY = 500;

export const cancelHoverTimeout = () => {
	if (!hoverPreviewTimer) return;
	window.clearTimeout(hoverPreviewTimer);
	hoverPreviewTimer = 0;
};

export const hoveredCardMouseMoved = () : ThunkSomeAction => (dispatch, getState) => {
	cancelHoverTimeout();
	const activePreviewCardId = selectActivePreviewCardId(getState());
	if (!activePreviewCardId) return;
	dispatch({ type: UPDATE_HOVERED_CARD, x: 0, y: 0, cardId: ''});
};

export const updateHoveredCard = (x : number,y : number,cardId : CardID) : ThunkSomeAction => (dispatch) => {
	cancelHoverTimeout();
	hoverPreviewTimer = window.setTimeout(() => {
		hoverPreviewTimer = 0;
		dispatch({ type: UPDATE_HOVERED_CARD, x, y, cardId});
	}, HOVER_CARD_PREVIEW_DELAY);
};

let snackbarTimer : number;

export const showSnackbar = () : ThunkSomeAction => (dispatch) => {
	dispatch({
		type: OPEN_SNACKBAR
	});
	window.clearTimeout(snackbarTimer);
	snackbarTimer = window.setTimeout(() =>
		dispatch({ type: CLOSE_SNACKBAR }), 3000);
};

export const updateOffline = (offline : boolean) : ThunkSomeAction => (dispatch, getState) => {
	// Show the snackbar only if offline status changes.
	if (offline !== getState().app.offline) {
		dispatch(showSnackbar());
	}
	dispatch({
		type: UPDATE_OFFLINE,
		offline
	});
};

export const openHeaderPanel = () : SomeAction => {
	return {
		type: OPEN_HEADER_PANEL
	};
};

export const closeHeaderPanel = () : SomeAction => {
	return {
		type: CLOSE_HEADER_PANEL
	};
};

export const openCommentsAndInfoPanel = () : SomeAction => {
	return {
		type: OPEN_COMMENTS_AND_INFO_PANEL
	};
};

export const closeCommentsAndInfoPanel = () : SomeAction => {
	return {
		type: CLOSE_COMMENTS_AND_INFO_PANEL
	};
};

export const openCardsDrawerPanel = () : SomeAction => {
	return {
		type: OPEN_CARDS_DRAWER_PANEL
	};
};

export const closeCardsDrawerPanel = () : SomeAction => {
	return {
		type: CLOSE_CARDS_DRAWER_PANEL
	};
};

export const openConfigureCollectionDialog = () : SomeAction => {
	return {
		type: OPEN_CONFIGURE_COLLECTION_DIALOG,
	};
};

export const closeConfigureCollectionDialog = () : SomeAction => {
	return {
		type: CLOSE_CONFIGURE_COLLECTION_DIALOG
	};
};


export const enablePresentationMode = () : SomeAction => {
	return {
		type: ENABLE_PRESENTATION_MODE,
	};
};

export const disablePresentationMode = () : SomeAction => {
	return {
		type: DISABLE_PRESENTATION_MODE,
	};
};

export const turnMobileMode= (on : boolean) : ThunkSomeAction => (dispatch) => {
	if (on) {
		dispatch(enablePresentationMode());
		dispatch({type:ENABLE_MOBILE_MODE});
		return;
	}
	dispatch(disablePresentationMode());
	dispatch({type:DISABLE_MOBILE_MODE});
};

export const ctrlKeyPressed= (pressed : boolean) : ThunkSomeAction => (dispatch, getState) => {
	//Only dispatch if it will make a change
	if (selectCtrlKeyPressed(getState()) === pressed) return;
	dispatch({
		type: UPDATE_CTRL_KEY_PRESSED,
		pressed,
	});
};

//export const OPEN_CARDS_DRAWER_INFO_PANEL = 'OPEN_CARDS_DRAWER_INFO_PANEL';
//export const CLOSE_CARDS_DRAWER_INFO_PANEL = 'CLOSE_CARDS_DRAWER_INFO_PANEL';

const openCardsDrawerInfo = () : SomeAction => {
	return {
		type:OPEN_CARDS_DRAWER_INFO,
	};
};


const closeCardsDrawerInfo = () : SomeAction => {
	return {
		type:CLOSE_CARDS_DRAWER_INFO,
	};
};

export const toggleCardsDrawerInfo = () : ThunkSomeAction => (dispatch, getState) => {
	const isOpen = selectCardsDrawerInfoExpanded(getState());
	dispatch(isOpen ? closeCardsDrawerInfo() : openCardsDrawerInfo());
};

export const turnSuggestMissingConcepts = (on : boolean) : SomeAction => {
	return {
		type: TURN_SUGGEST_MISSING_CONCEPTS,
		on,
	};
};

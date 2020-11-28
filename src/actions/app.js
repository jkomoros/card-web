/**
@license
Copyright (c) 2018 The Polymer Project Authors. All rights reserved.
This code may only be used under the BSD style license found at http://polymer.github.io/LICENSE.txt
The complete set of authors may be found at http://polymer.github.io/AUTHORS.txt
The complete set of contributors may be found at http://polymer.github.io/CONTRIBUTORS.txt
Code distributed by Google as part of the polymer project is also
subject to an additional IP rights grant found at http://polymer.github.io/PATENTS.txt
*/

export const UPDATE_PAGE = 'UPDATE_PAGE';
export const UPDATE_OFFLINE = 'UPDATE_OFFLINE';
export const OPEN_SNACKBAR = 'OPEN_SNACKBAR';
export const CLOSE_SNACKBAR = 'CLOSE_SNACKBAR';
export const OPEN_HEADER_PANEL = 'OPEN_HEADER_PANEL';
export const CLOSE_HEADER_PANEL = 'CLOSE_HEADER_PANEL';
export const OPEN_COMMENTS_AND_INFO_PANEL = 'OPEN_COMMENTS_AND_INFO_PANEL';
export const CLOSE_COMMENTS_AND_INFO_PANEL = 'CLOSE_COMMENTS_AND_INFO_PANEL';
export const OPEN_CARDS_DRAWER_PANEL = 'OPEN_CARDS_DRAWER_PANEL';
export const CLOSE_CARDS_DRAWER_PANEL = 'CLOSE_CARDS_DRAWER_PANEL';
export const ENABLE_PRESENTATION_MODE = 'ENABLE_PRESENTATION_MODE';
export const DISABLE_PRESENTATION_MODE = 'DISABLE_PRESENTATION_MODE';
export const ENABLE_MOBILE_MODE = 'ENABLE_MOBILE_MODE';
export const DISABLE_MOBILE_MODE = 'DISABLE_MOBILE_MODE';
export const UPDATE_HOVERED_CARD = 'UPDATE_HOVERED_CARD';
export const UPDATE_FETCHED_CARD = 'UPDATE_FETCHED_CARD';
export const CARD_BEING_FETCHED = 'CARD_BEING_FETCHED';
export const UPDATE_CTRL_KEY_PRESSED = 'UPDATE_CTRL_KEY_PRESSED';
export const UPDATE_MAINTENANCE_MODE_ENABLED = 'UPDATE_MAINTENANCE_MODE_ENABLED';
export const OPEN_CARDS_DRAWER_INFO = 'OPEN_CARDS_DRAWER_INFO';
export const CLOSE_CARDS_DRAWER_INFO = 'CLOSE_CARDS_DRAWER_INFO';

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
	selectFinalCollection,
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
	selectDefaultSectionID,
	selectCtrlKeyPressed,
	selectCardsDrawerInfoExpanded,
	selectActiveCollectionDescription
} from '../selectors.js';

import {
	pageRequiresMainView
} from '../util.js';

import {
	CARDS_COLLECTION,
} from './database.js';

import {
	db
} from '../firebase.js';

import {
	updateCards,
} from './data.js';

import {
	editingStart,
	editingCommit
} from './editor.js';

import {
	composeCommit
} from './prompt.js';

import {
	references,
	REFERENCES_INBOUND_CARD_PROPERTY
} from '../card_fields.js';

import {
	collectionDescriptionWithQuery
} from '../collection_description.js';

//if silent is true, then just passively updates the URL to reflect what it should be.
export const navigatePathTo = (path, silent) => (dispatch, getState) => {
	const state = getState();
	//If we're already pointed there, no need to navigate
	if ('/' + path === window.location.pathname) return;
	if (state.editor.editing) {
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

export const navigateToNextCard = () => (dispatch, getState) => {
	const state = getState();
	let index = selectActiveCardIndex(state);
	index++;
	const collection = selectFinalCollection(state);
	if (!collection) return;
	let newId = collection[index];
	if (!newId) return;
	dispatch(navigateToCard(newId));
};

export const navigateToPreviousCard = () => (dispatch, getState) => {
	const state = getState();
	let index = selectActiveCardIndex(state);
	index--;
	const collection = selectFinalCollection(state);
	if (!collection) return;
	let newId = collection[index];
	if (!newId) return;
	dispatch(navigateToCard(newId));
};

const urlForCard = (cardOrId) => {
	let id = cardOrId;
	if(!id) return '';
	//note: null is an object;
	if (cardOrId && typeof cardOrId === 'object') {
		id = cardOrId.name;
	}
	return '/' + PAGE_DEFAULT + '/' + id;
};

export const urlForTag = (tagName, optCardId) => {
	if (!optCardId) optCardId = '';
	return '/' + PAGE_DEFAULT + '/' + tagName + '/' + optCardId;
};

//Should be called any time we might want to redirect to the given comment. For
//example, when the redirect comment view boots, or when threads or messages are
//loaded.
export const refreshCommentRedirect = () => (dispatch, getState) => {
	//Called when cards and sections update, just in case we now have
	//information to do this better. Also called when stars and reads update,
	//because if we're filtering to one of those filters we might not yet know
	//if we're in that collection or not.
	const state = getState();

	let page = selectPage(state);
	if (page != PAGE_COMMENT) return;
	let pageExtra = selectPageExtra(state);
	dispatch(navigateToComment(pageExtra));
};

export const navigateToComment = (commentId) => (dispatch, getState) => {
	//commentId is either a thread or message id.
	const state = getState();
	if (!selectCommentsAreFullyLoaded(state)) return;

	const message = getMessageById(state, commentId);
	if (message) {
		dispatch(navigateToCard(message.card));
		return;
	}
	const thread = getThreadById(state, commentId);
	if (thread) {
		dispatch(navigateToCard(thread.card));
		return;
	}
	alert('That comment does not exist. Redirecting to the default card.');
	dispatch(navigateToDefaultIfSectionsLoaded(false));
};

//navigateToDefaultIfSectionsLoaded will navigate to default if sections are
//loaded. If they aren't, it won't do anything.
export const navigateToDefaultIfSectionsLoaded = (silent) => (dispatch, getState) => {
	const defaultSectionID = selectDefaultSectionID(getState());
	if (!defaultSectionID) {
		//must not have loaded yet
		return;
	}
	dispatch(navigatePathTo('/' + PAGE_DEFAULT + '/' + defaultSectionID + '/', silent));
};

//if card is not provided, will try to navigate to default if sections loaded.
export const navigateToCard = (cardOrId, silent) => (dispatch) => {
	let path = urlForCard(cardOrId);
	if (!path) {
		dispatch(navigateToDefaultIfSectionsLoaded(silent));
	}
	dispatch(navigatePathTo(path, silent));
};

export const navigateToCollectionWithQuery = (queryText) => (dispatch, getState) => {
	const collection = selectActiveCollectionDescription(getState());
	const newCollection = collectionDescriptionWithQuery(collection, queryText);
	dispatch(navigatePathTo('/' + PAGE_DEFAULT + '/' + newCollection.serializeShort()));
};

export const navigated = (path, query) => (dispatch) => {

	// Extract the page name from path.
	const page = path === '/' ? PAGE_DEFAULT : path.slice(1);

	// Any other info you might want to extract from the path (like page type),
	// you can do here
	dispatch(loadPage(page, query));

};

const loadPage = (pathname, query) => (dispatch) => {

	//pathname is the whole path minus starting '/', like 'c/VIEW_ID'
	let pieces = pathname.split('/');

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

const updatePage = (location, page, pageExtra) => {
	return {
		type: UPDATE_PAGE,
		location,
		page,
		pageExtra
	};
};

const fetchCardFromDb = async (cardIDOrSlug) => {
	//Cards are more likely to be fetched via slug, so try that first
	let cards = await db.collection(CARDS_COLLECTION).where('published', '==', true).where('slugs', 'array-contains', cardIDOrSlug).limit(1).get();
	if (cards && !cards.empty) {
		return cards.docs[0];
	}
	let card = await db.collection(CARDS_COLLECTION).doc(cardIDOrSlug).get();
	if (card && card.exists) {
		return card;
	}
	return null;
};

const fetchCardLinkCardsForFetchedCardFromDb = async (card) => {
	//orderBy is effectively a filter to only items that have 'references.CARD_ID' key.
	const rawQuery =  await db.collection(CARDS_COLLECTION).where('published', '==', true).where(REFERENCES_INBOUND_CARD_PROPERTY + '.' + card.id, '==', true).get();
	if (rawQuery.empty) return {};
	return Object.fromEntries(rawQuery.docs.map(doc => [doc.id, {...doc.data(), id: doc.id}]));
};

//Exposed so basic-card-view can expose an endpoint. Typically you use
//fetchCard.
export const updateFetchedCard = (card) => {
	return {
		type: UPDATE_FETCHED_CARD,
		card
	};
};

export const fetchCardLinkCardsForFetchedCard = async (fetchedCard) => async (dispatch, getState) =>{
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
		dispatch(updateCards({}, false));
		return;
	}

	const cards = await fetchCardLinkCardsForFetchedCardFromDb(fetchedCard);
	dispatch(updateCards(cards, false));
};

export const fetchCard = (cardIDOrSlug) => async (dispatch, getState) =>  {
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
	let rawCard = await fetchCardFromDb(cardIDOrSlug);
	if (!rawCard) {
		console.warn('no cards matched');
		return;
	}
	let card = {...rawCard.data(), id: rawCard.id};
	if (!card.published) {
		console.warn('Card wasn\'t published');
		return;
	}
	dispatch(await fetchCardLinkCardsForFetchedCard(card));
	dispatch(updateFetchedCard(card));
};

//A generic commit action, depending on what is happening. If editing, commit
//the edit. If composing, commit the compose.
export const doCommit  = () => (dispatch, getState) => {
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

let hoverPreviewTimer;
let HOVER_CARD_PREVIEW_DELAY = 1000;

export const cancelHoverTimeout = () => {
	if (!hoverPreviewTimer) return;
	window.clearTimeout(hoverPreviewTimer);
	hoverPreviewTimer = 0;
};

export const hoveredCardMouseMoved = () => (dispatch, getState) => {
	cancelHoverTimeout();
	const activePreviewCardId = selectActivePreviewCardId(getState());
	if (!activePreviewCardId) return;
	dispatch({ type: UPDATE_HOVERED_CARD, x: 0, y: 0, cardId: ''});
};

export const updateHoveredCard = (x,y,cardId) => (dispatch) => {
	cancelHoverTimeout();
	hoverPreviewTimer = window.setTimeout(() => {
		hoverPreviewTimer = 0;
		dispatch({ type: UPDATE_HOVERED_CARD, x, y, cardId});
	}, HOVER_CARD_PREVIEW_DELAY);
};

let snackbarTimer;

export const showSnackbar = () => (dispatch) => {
	dispatch({
		type: OPEN_SNACKBAR
	});
	window.clearTimeout(snackbarTimer);
	snackbarTimer = window.setTimeout(() =>
		dispatch({ type: CLOSE_SNACKBAR }), 3000);
};

export const updateOffline = (offline) => (dispatch, getState) => {
	// Show the snackbar only if offline status changes.
	if (offline !== getState().app.offline) {
		dispatch(showSnackbar());
	}
	dispatch({
		type: UPDATE_OFFLINE,
		offline
	});
};

export const openHeaderPanel = () => {
	return {
		type: OPEN_HEADER_PANEL
	};
};

export const closeHeaderPanel = () => {
	return {
		type: CLOSE_HEADER_PANEL
	};
};

export const openCommentsAndInfoPanel = () => {
	return {
		type: OPEN_COMMENTS_AND_INFO_PANEL
	};
};

export const closeCommentsAndInfoPanel = () => {
	return {
		type: CLOSE_COMMENTS_AND_INFO_PANEL
	};
};

export const openCardsDrawerPanel = () => {
	return {
		type: OPEN_CARDS_DRAWER_PANEL
	};
};

export const closeCardsDrawerPanel = () => {
	return {
		type: CLOSE_CARDS_DRAWER_PANEL
	};
};


export const enablePresentationMode = () => {
	return {
		type: ENABLE_PRESENTATION_MODE,
	};
};

export const disablePresentationMode = () => {
	return {
		type: DISABLE_PRESENTATION_MODE,
	};
};

export const turnMobileMode = (on) => (dispatch) => {
	if (on) {
		dispatch(enablePresentationMode());
		dispatch({type:ENABLE_MOBILE_MODE});
		return;
	}
	dispatch(disablePresentationMode());
	dispatch({type:DISABLE_MOBILE_MODE});
};

export const ctrlKeyPressed = (pressed) => (dispatch, getState) => {
	//Only dispatch if it will make a change
	if (selectCtrlKeyPressed(getState()) === pressed) return;
	dispatch({
		type: UPDATE_CTRL_KEY_PRESSED,
		pressed,
	});
};

export const updateMaintenanceModeEnabled = (enabled) => {
	return {
		type: UPDATE_MAINTENANCE_MODE_ENABLED,
		enabled,
	};
};

//export const OPEN_CARDS_DRAWER_INFO_PANEL = 'OPEN_CARDS_DRAWER_INFO_PANEL';
//export const CLOSE_CARDS_DRAWER_INFO_PANEL = 'CLOSE_CARDS_DRAWER_INFO_PANEL';

const openCardsDrawerInfo = () => {
	return {
		type:OPEN_CARDS_DRAWER_INFO,
	};
};


const closeCardsDrawerInfo = () => {
	return {
		type:CLOSE_CARDS_DRAWER_INFO,
	};
};

export const toggleCardsDrawerInfo = () => (dispatch, getState) => {
	const isOpen = selectCardsDrawerInfoExpanded(getState());
	dispatch(isOpen ? closeCardsDrawerInfo() : openCardsDrawerInfo());
};

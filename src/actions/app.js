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
export const OPEN_COMMENTS_PANEL = 'OPEN_COMMENTS_PANEL';
export const CLOSE_COMMENTS_PANEL = 'CLOSE_COMMENTS_PANEL';
export const OPEN_CARD_INFO_PANEL = 'OPEN_CARD_INFO_PANEL';
export const CLOSE_CARD_INFO_PANEL = 'CLOSE_CARD_INFO_PANEL';
export const OPEN_CARDS_DRAWER_PANEL = 'OPEN_CARDS_DRAWER_PANEL';
export const CLOSE_CARDS_DRAWER_PANEL = 'CLOSE_CARDS_DRAWER_PANEL';
export const ENABLE_PRESENTATION_MODE = 'ENABLE_PRESENTATION_MODE';
export const DISABLE_PRESENTATION_MODE = 'DISABLE_PRESENTATION_MODE';
export const ENABLE_MOBILE_MODE = 'ENABLE_MOBILE_MODE';
export const DISABLE_MOBILE_MODE = 'DISABLE_MOBILE_MODE';
export const UPDATE_HOVERED_CARD = 'UPDATE_HOVERED_CARD';
export const UPDATE_FETCHED_CARD = 'UPDATE_FETCHED_CARD';

import {
	selectFinalCollection, selectCommentsAreFullyLoaded, getMessageById, getThreadById, selectPage, selectPageExtra, selectActivePreviewCardId
} from '../selectors.js';

import {
	selectActiveCardIndex
} from '../selectors.js';

import { 
	PLACEHOLDER_CARD_ID_CHARACTER
} from './collection';

import { pageRequiresMainView } from '../util.js';

import {
	db,
	CARDS_COLLECTION,
} from './database.js';

//This is the card that is loaded if we weren't passed anything
const DEFAULT_CARD = 'section-half-baked';

//if silent is true, then just passively updates the URL to reflect what it should be.
export const navigatePathTo = (path, silent) => (dispatch, getState) => {
	const state = getState();
	if (state.editor.editing) {
		console.log('Can\'t navigate while editing');
		return;
	}
	if (silent) {
		window.history.replaceState({}, '', path);
		return;
	}
	window.history.pushState({}, '', path);
	dispatch(navigated(decodeURIComponent(path), decodeURIComponent(location.search)));
};

export const navigateToChangesNumDays = (numDays) => (dispatch) => {
	if (!numDays) numDays = 1;
	dispatch(navigatePathTo('/recent/' + numDays + '/days'));
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

export const urlForCard = (cardOrId, edit) => {
	let id = cardOrId;
	if (!id) id = DEFAULT_CARD;
	//note: null is an object;
	if (cardOrId && typeof cardOrId === 'object') {
		id = cardOrId.name;
	}
	return '/c/' + id + (edit ? '/edit' : '');
};

export const urlForTag = (tagName, optCardId) => {
	if (!optCardId) optCardId = PLACEHOLDER_CARD_ID_CHARACTER;
	return '/c/' + tagName + '/' + optCardId;
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
	if (page != 'comment') return;
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
	dispatch(navigateToCard(''));
};

export const navigateToCard = (cardOrId, silent) => (dispatch) => {
	let path = urlForCard(cardOrId, false);
	dispatch(navigatePathTo(path, silent));
};

export const navigated = (path, query) => (dispatch) => {

	// Extract the page name from path.
	const page = path === '/' ? 'c' : path.slice(1);

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
	case 'c':
		import('../components/card-view.js').then(() => {
			// Put code in here that you want to run every time when
			// navigating to view1 after my-view1.js is loaded.
		});
		break;
	case 'comment':
		import('../components/comment-redirect-view.js');
		break;
	case 'maintenance':
		import('../components/maintenance-view.js');
		break;
	case 'basic-card':
		import('../components/basic-card-view.js');
		break;
	default:
		page = 'view404';
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

export const fetchCard = (cardID) => async (dispatch) =>  {
	if (!cardID) return;
	//To be used to fetch a singular card from the store, as in basic-card-view.
	let rawCard = await db.collection(CARDS_COLLECTION).doc(cardID).get();
	if (!rawCard) {
		console.warn('no cards matched');
		return;
	}
	let card = {...rawCard.data(), id: cardID};
	if (!card.published) {
		console.warn('Card wasn\'t published');
	}
	dispatch({
		type: UPDATE_FETCHED_CARD,
		card
	});
};

let hoverPreviewTimer;
let HOVER_CARD_PREVIEW_DELAY = 1000;

const cancelHoverTimeout = () => {
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

export const openCommentsPanel = () => {
	return {
		type: OPEN_COMMENTS_PANEL
	};
};

export const closeCommentsPanel = () => {
	return {
		type: CLOSE_COMMENTS_PANEL
	};
};

export const openCardInfoPanel = () => {
	return {
		type: OPEN_CARD_INFO_PANEL
	};
};

export const closeCardInfoPanel = () => {
	return {
		type: CLOSE_CARD_INFO_PANEL
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


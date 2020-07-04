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
	UPDATE_PAGE,
	UPDATE_OFFLINE,
	OPEN_SNACKBAR,
	CLOSE_SNACKBAR,
	OPEN_HEADER_PANEL,
	CLOSE_HEADER_PANEL,
	OPEN_COMMENTS_AND_INFO_PANEL,
	CLOSE_COMMENTS_AND_INFO_PANEL,
	OPEN_CARDS_DRAWER_PANEL,
	CLOSE_CARDS_DRAWER_PANEL,
	ENABLE_PRESENTATION_MODE,
	DISABLE_PRESENTATION_MODE,
	ENABLE_MOBILE_MODE,
	DISABLE_MOBILE_MODE,
	UPDATE_HOVERED_CARD,
	UPDATE_FETCHED_CARD,
	CARD_BEING_FETCHED,
} from '../actions/app.js';

const HEADER_PANEL_DEFAULT_VALUE = true;
const COMMENTS_AND_INFO_PANEL_DEFAULT_VALUE = true;
const CARDS_DRAWER_PANEL_DEFAULT_VALUE = true;

const INITIAL_STATE = {
	location: '',
	page: '',
	pageExtra: '',
	offline: false,
	snackbarOpened: false,
	headerPanelOpen: HEADER_PANEL_DEFAULT_VALUE,
	commentsAndInfoPanelOpen: COMMENTS_AND_INFO_PANEL_DEFAULT_VALUE,
	cardsDrawerPanelOpen: CARDS_DRAWER_PANEL_DEFAULT_VALUE,
	presentationMode: false,
	mobileMode: false,
	hoverX: 0,
	hoverY: 0,
	hoverCardId: '',
	//the card that was fetched as a singleton, for example in basic-card-view.
	fetchedCard: {},
	cardBeingFetched: false,
};

const app = (state = INITIAL_STATE, action) => {
	switch (action.type) {
	case UPDATE_PAGE:
		return {
			...state,
			location: action.location,
			page: action.page,
			pageExtra: action.pageExtra
		};
	case UPDATE_OFFLINE:
		return {
			...state,
			offline: action.offline
		};
	case OPEN_SNACKBAR:
		return {
			...state,
			snackbarOpened: true
		};
	case CLOSE_SNACKBAR:
		return {
			...state,
			snackbarOpened: false
		};
	case OPEN_HEADER_PANEL:
		return {
			...state,
			headerPanelOpen: true
		};
	case CLOSE_HEADER_PANEL: 
		return {
			...state,
			headerPanelOpen: false
		};
	case OPEN_COMMENTS_AND_INFO_PANEL:
		return {
			...state,
			commentsAndInfoPanelOpen: true,
		};
	case CLOSE_COMMENTS_AND_INFO_PANEL:
		return {
			...state,
			commentsAndInfoPanelOpen: false,
		};
	case OPEN_CARDS_DRAWER_PANEL:
		return {
			...state,
			cardsDrawerPanelOpen: true
		};
	case CLOSE_CARDS_DRAWER_PANEL: 
		return {
			...state,
			cardsDrawerPanelOpen: false
		};
	case ENABLE_PRESENTATION_MODE:
		return {
			...state,
			headerPanelOpen: false,
			cardsDrawerPanelOpen: false,
			commentsAndInfoPanelOpen: false,
			presentationMode: true
		};
	case DISABLE_PRESENTATION_MODE:
		return {
			...state,
			headerPanelOpen: HEADER_PANEL_DEFAULT_VALUE,
			cardsDrawerPanelOpen: CARDS_DRAWER_PANEL_DEFAULT_VALUE,
			commentsAndInfoPanelOpen: COMMENTS_AND_INFO_PANEL_DEFAULT_VALUE,
			presentationMode:false
		};
	case ENABLE_MOBILE_MODE: 
		return {
			...state,
			mobileMode: true
		};
	case DISABLE_MOBILE_MODE:
		return {
			...state,
			mobileMode: false
		};
	case UPDATE_HOVERED_CARD:
		return {
			...state,
			hoverX: action.x,
			hoverY: action.y,
			hoverCardId: action.cardId
		};
	case UPDATE_FETCHED_CARD:
		return {
			...state,
			fetchedCard: action.card,
			cardBeingFetched: false
		};
	case CARD_BEING_FETCHED:
		return {
			...state,
			cardBeingFetched: true
		};
	default:
		return state;
	}
};

export default app;

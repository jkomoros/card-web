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
	OPEN_COMMENTS_PANEL,
	CLOSE_COMMENTS_PANEL,
	OPEN_CARD_INFO_PANEL,
	CLOSE_CARD_INFO_PANEL,
	OPEN_CARDS_DRAWER_PANEL,
	CLOSE_CARDS_DRAWER_PANEL,
	ENABLE_PRESENTATION_MODE,
	DISABLE_PRESENTATION_MODE,
	ENABLE_MOBILE_MODE,
	DISABLE_MOBILE_MODE
} from '../actions/app.js';

import {
	selectFinalCollection,
	selectComposeOpen,
} from '../selectors.js';

const HEADER_PANEL_DEFAULT_VALUE = true;
const COMMENTS_PANEL_DEFAULT_VALUE = true;
const CARD_INFO_PANEL_DEFAULT_VALUE = false;
const CARDS_DRAWER_PANEL_DEFAULT_VALUE = true;

const INITIAL_STATE = {
	location: '',
	page: '',
	pageExtra: '',
	offline: false,
	snackbarOpened: false,
	headerPanelOpen: HEADER_PANEL_DEFAULT_VALUE,
	commentsPanelOpen: COMMENTS_PANEL_DEFAULT_VALUE,
	cardInfoPanelOpen: CARD_INFO_PANEL_DEFAULT_VALUE,
	cardsDrawerPanelOpen: CARDS_DRAWER_PANEL_DEFAULT_VALUE,
	presentationMode: false,
	mobileMode: false
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
	case OPEN_COMMENTS_PANEL:
		//Only one of cardInfo and comments panels can be open at a time.
		return {
			...state,
			commentsPanelOpen: true,
			cardInfoPanelOpen: false
		};
	case CLOSE_COMMENTS_PANEL:
		return {
			...state,
			commentsPanelOpen: false
		};
	case OPEN_CARD_INFO_PANEL:
		//Only one of cardInfo and comments panels can be open at a time.
		return {
			...state,
			cardInfoPanelOpen: true,
			commentsPanelOpen: false
		};
	case CLOSE_CARD_INFO_PANEL:
		return {
			...state,
			cardInfoPanelOpen: false
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
			cardInfoPanelOpen: false,
			commentsPanelOpen: false,
			presentationMode: true
		};
	case DISABLE_PRESENTATION_MODE:
		return {
			...state,
			headerPanelOpen: HEADER_PANEL_DEFAULT_VALUE,
			cardsDrawerPanelOpen: CARDS_DRAWER_PANEL_DEFAULT_VALUE,
			commentsPanelOpen: COMMENTS_PANEL_DEFAULT_VALUE,
			cardInfoPanelOpen: CARD_INFO_PANEL_DEFAULT_VALUE,
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
	default:
		return state;
	}
};

export const keyboardNavigates = state => {
	if (state.editor && state.editor.editing) return false;
	if (state.find && state.find.open) return false;
	if (selectComposeOpen(state)) return false;
	return true;
};

//The cardsDrawerPanel hides itself when there are no cards to show (that is,
//for orphaned cards). This is the logic that decides if it's open based on state.
export const cardsDrawerPanelShowing = state => {
	let collection = selectFinalCollection(state);
	if (!collection || !collection.length) return false;
	return state.app.cardsDrawerPanelOpen;
};

export default app;

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
	OPEN_CONFIGURE_COLLECTION_DIALOG,
	CLOSE_CONFIGURE_COLLECTION_DIALOG,
	ENABLE_PRESENTATION_MODE,
	DISABLE_PRESENTATION_MODE,
	ENABLE_MOBILE_MODE,
	DISABLE_MOBILE_MODE,
	UPDATE_HOVERED_CARD,
	UPDATE_FETCHED_CARD,
	CARD_BEING_FETCHED,
	UPDATE_CTRL_KEY_PRESSED,
	OPEN_CARDS_DRAWER_INFO,
	CLOSE_CARDS_DRAWER_INFO,
	TURN_SUGGEST_MISSING_CONCEPTS
} from '../actions/app.js';

import {
	EMPTY_CARD
} from '../actions/data.js';

import {
	AppState,
} from '../types.js';

const HEADER_PANEL_DEFAULT_VALUE = true;
const COMMENTS_AND_INFO_PANEL_DEFAULT_VALUE = true;
const CARDS_DRAWER_PANEL_DEFAULT_VALUE = true;

const INITIAL_STATE : AppState = {
	location: '',
	page: '',
	pageExtra: '',
	offline: false,
	snackbarOpened: false,
	headerPanelOpen: HEADER_PANEL_DEFAULT_VALUE,
	commentsAndInfoPanelOpen: COMMENTS_AND_INFO_PANEL_DEFAULT_VALUE,
	cardsDrawerPanelOpen: CARDS_DRAWER_PANEL_DEFAULT_VALUE,
	cardsDrawerInfoExpanded: false,
	configureCollectionDialogOpen: false,
	presentationMode: false,
	mobileMode: false,
	hoverX: 0,
	hoverY: 0,
	hoverCardId: '',
	//the card that was fetched as a singleton, for example in basic-card-view.
	fetchedCard: EMPTY_CARD,
	cardBeingFetched: false,
	ctrlKeyPressed: false,
	//if this is true, then the word cloud in card-drawer will be replaced with
	//the suggest missing concepts, which is EXTREMELY expensive.
	suggestMissingConceptsEnabled: false,
};

const app = (state : AppState = INITIAL_STATE, action) : AppState => {
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
	case OPEN_CONFIGURE_COLLECTION_DIALOG:
		return {
			...state,
			configureCollectionDialogOpen: true,
		};
	case CLOSE_CONFIGURE_COLLECTION_DIALOG:
		return {
			...state,
			configureCollectionDialogOpen: false,
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
	case UPDATE_CTRL_KEY_PRESSED:
		return {
			...state,
			ctrlKeyPressed: action.pressed
		};
	case OPEN_CARDS_DRAWER_INFO:
		return {
			...state,
			cardsDrawerInfoExpanded: true,
		};
	case CLOSE_CARDS_DRAWER_INFO:
		return {
			...state,
			cardsDrawerInfoExpanded: false,
		};
	case TURN_SUGGEST_MISSING_CONCEPTS:
		return{
			...state,
			suggestMissingConceptsEnabled: action.on,
		};
	default:
		return state;
	}
};

export default app;

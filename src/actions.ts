import {
	AIDialogType,
	Card,
	CardID
} from './types';

export const AI_REQUEST_STARTED = 'AI_REQUEST_STARTED';
export const AI_RESULT = 'AI_RESULT';
export const AI_SELECT_RESULT_INDEX = 'AI_SELECT_RESULT_INDEX';
export const AI_DIALOG_CLOSE = 'AI_DIALOG_CLOSE';
export const AI_SET_ACTIVE_CARDS = 'AI_SET_ACTIVE_CARDS';
export const AI_SHOW_ERROR = 'AI_SHOW_ERROR';
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
export const OPEN_CONFIGURE_COLLECTION_DIALOG = 'OPEN_CONFIGURE_COLLECTION_DIALOG';
export const CLOSE_CONFIGURE_COLLECTION_DIALOG = 'CLOSE_CONFIGURE_COLLECTION_DIALOG';
export const ENABLE_PRESENTATION_MODE = 'ENABLE_PRESENTATION_MODE';
export const DISABLE_PRESENTATION_MODE = 'DISABLE_PRESENTATION_MODE';
export const ENABLE_MOBILE_MODE = 'ENABLE_MOBILE_MODE';
export const DISABLE_MOBILE_MODE = 'DISABLE_MOBILE_MODE';
export const UPDATE_HOVERED_CARD = 'UPDATE_HOVERED_CARD';
export const UPDATE_FETCHED_CARD = 'UPDATE_FETCHED_CARD';
export const CARD_BEING_FETCHED = 'CARD_BEING_FETCHED';
export const UPDATE_CTRL_KEY_PRESSED = 'UPDATE_CTRL_KEY_PRESSED';
export const OPEN_CARDS_DRAWER_INFO = 'OPEN_CARDS_DRAWER_INFO';
export const CLOSE_CARDS_DRAWER_INFO = 'CLOSE_CARDS_DRAWER_INFO';
export const TURN_SUGGEST_MISSING_CONCEPTS = 'TURN_SUGGEST_MISSING_CONCEPTS';

type ActionAIRequestStarted = {
	type: typeof AI_REQUEST_STARTED,
	kind: AIDialogType
};

type ActionAIResult = {
	type: typeof AI_RESULT,
	result: string | string[]
};

type ActionAISelectResultIndex = {
	type: typeof AI_SELECT_RESULT_INDEX,
	index: number
};

type ActionAIDialogClose = {
	type: typeof AI_DIALOG_CLOSE
};

type ActionAISetActiveCards = {
	type: typeof AI_SET_ACTIVE_CARDS,
	allCards: CardID[],
	filteredCards: CardID[]
};

type ActionAIShowError = {
	type: typeof AI_SHOW_ERROR,
	error: string
};

type ActionUpdatePage = {
	type: typeof UPDATE_PAGE,
	location: string,
	page: string,
	pageExtra: string
};

type ActionUpdateOffline = {
	type: typeof UPDATE_OFFLINE,
	offline: boolean
};

type ActionOpenSnackbar = {
	type: typeof OPEN_SNACKBAR
};

type ActionCloseSnackbar = {
	type: typeof CLOSE_SNACKBAR
};

type ActionOpenHeaderPanel = {
	type: typeof OPEN_HEADER_PANEL
};

type ActionCloseHeaderPanel = {
	type: typeof CLOSE_HEADER_PANEL
};

type ActionOpenCommentsAndInfoPanel = {
	type: typeof OPEN_COMMENTS_AND_INFO_PANEL
};

type ActionCloseCommentsAndInfoPanel = {
	type: typeof CLOSE_COMMENTS_AND_INFO_PANEL
};

type ActionOpenCardsDrawerPanel = {
	type: typeof OPEN_CARDS_DRAWER_PANEL
};

type ActionCloseCardsDrawerPanel = {
	type: typeof CLOSE_CARDS_DRAWER_PANEL
};

type ActionOpenConfigureCollectionDialog = {
	type: typeof OPEN_CONFIGURE_COLLECTION_DIALOG
};

type ActionCloseConfigureCollectionDialog = {
	type: typeof CLOSE_CONFIGURE_COLLECTION_DIALOG
};

type ActionEnablePresentationMode = {
	type: typeof ENABLE_PRESENTATION_MODE
};

type ActionDisablePresentationMode = {
	type: typeof DISABLE_PRESENTATION_MODE
};

type ActionEnableMobileMode = {
	type: typeof ENABLE_MOBILE_MODE
};

type ActionDisableMobileMode = {
	type: typeof DISABLE_MOBILE_MODE
};

type ActionUpdateHoveredCard = {
	type: typeof UPDATE_HOVERED_CARD,
	x: number,
	y: number,
	cardId: CardID
};

type ActionUpdateFetchedCard = {
	type: typeof UPDATE_FETCHED_CARD,
	card: Card
};

type ActionCardBeingFetched = {
	type: typeof CARD_BEING_FETCHED
};

type ActionUpdateCtrlKeyPressed = {
	type: typeof UPDATE_CTRL_KEY_PRESSED,
	pressed: boolean
};

type ActionOpenCardsDrawerInfo = {
	type: typeof OPEN_CARDS_DRAWER_INFO
};

type ActionCloseCardsDrawerInfo = {
	type: typeof CLOSE_CARDS_DRAWER_INFO
};

type ActionTurnSuggestedMissingConcepts = {
	type: typeof TURN_SUGGEST_MISSING_CONCEPTS,
	on: boolean
};

export type SomeAction = ActionAIRequestStarted
	| ActionAIResult
	| ActionAISelectResultIndex
	| ActionAIDialogClose
	| ActionAISetActiveCards
	| ActionAIShowError
	| ActionUpdatePage
	| ActionUpdateOffline
	| ActionOpenSnackbar
	| ActionCloseSnackbar
	| ActionOpenHeaderPanel
	| ActionCloseHeaderPanel
	| ActionOpenCommentsAndInfoPanel
	| ActionCloseCommentsAndInfoPanel
	| ActionOpenCardsDrawerPanel
	| ActionCloseCardsDrawerPanel
	| ActionOpenConfigureCollectionDialog
	| ActionCloseConfigureCollectionDialog
	| ActionEnablePresentationMode
	| ActionDisablePresentationMode
	| ActionEnableMobileMode
	| ActionDisableMobileMode
	| ActionUpdateHoveredCard
	| ActionUpdateFetchedCard
	| ActionCardBeingFetched
	| ActionUpdateCtrlKeyPressed
	| ActionOpenCardsDrawerInfo
	| ActionCloseCardsDrawerInfo
	| ActionTurnSuggestedMissingConcepts;
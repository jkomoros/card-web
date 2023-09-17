import {
	AIDialogType,
	AuthorsMap,
	Card,
	CardBooleanMap,
	CardID,
	CardType,
	Cards,
	CommentMessages,
	CommentThreads,
	Sections,
	SetName,
	Slug,
	SortName,
	Tags,
	TweetMap,
	ViewMode
} from './types';

//AI
export const AI_REQUEST_STARTED = 'AI_REQUEST_STARTED';
export const AI_RESULT = 'AI_RESULT';
export const AI_SELECT_RESULT_INDEX = 'AI_SELECT_RESULT_INDEX';
export const AI_DIALOG_CLOSE = 'AI_DIALOG_CLOSE';
export const AI_SET_ACTIVE_CARDS = 'AI_SET_ACTIVE_CARDS';
export const AI_SHOW_ERROR = 'AI_SHOW_ERROR';
//App
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
//Collection.js
export const SHOW_CARD = 'SHOW_CARD';
export const UPDATE_COLLECTION = 'UPDATE_COLLECTION';
export const UPDATE_RENDER_OFFSET = 'UPDATE_RENDER_OFFSET';
export const UPDATE_COLLECTION_SHAPSHOT = 'UPDATE_COLLECTION_SHAPSHOT';
export const RANDOMIZE_SALT = 'RANDOMIZE_SALT';
//Comments
export const COMMENTS_UPDATE_THREADS = 'COMMENTS_UPDATE_THREADS';
export const COMMENTS_UPDATE_MESSAGES = 'COMMENTS_UPDATE_MESSAGES';
export const COMMENTS_UPDATE_CARD_THREADS = 'COMMENTS_UPDATE_CARD_THREADS';
//Data
export const UPDATE_CARDS = 'UPDATE_CARDS';
export const UPDATE_SECTIONS = 'UPDATE_SECTIONS';
export const UPDATE_TAGS = 'UPDATE_TAGS';
export const UPDATE_AUTHORS= 'UPDATE_AUTHORS';
export const UPDATE_TWEETS = 'UPDATE_TWEETS';
export const REMOVE_CARDS = 'REMOVE_CARDS';
export const TWEETS_LOADING = 'TWEETS_LOADING';
export const MODIFY_CARD = 'MODIFY_CARD';
export const MODIFY_CARD_SUCCESS = 'MODIFY_CARD_SUCCESS';
export const MODIFY_CARD_FAILURE = 'MODIFY_CARD_FAILURE';
export const REORDER_STATUS = 'REORDER_STATUS';
export const SET_PENDING_SLUG = 'SET_PENDING_SLUG';
export const EXPECT_NEW_CARD = 'EXPECT_NEW_CARD';
export const EXPECTED_NEW_CARD_FAILED = 'EXPECTED_NEW_CARD_FAILED';
export const NAVIGATED_TO_NEW_CARD = 'NAVIGATED_TO_NEW_CARD';
export const EXPECT_CARD_DELETIONS = 'EXPECT_CARD_DELETIONS';
export const COMMITTED_PENDING_FILTERS_WHEN_FULLY_LOADED = 'COMMITTED_PENDING_FILTERS_WHEN_FULLY_LOADED';
export const EXPECT_UNPUBLISHED_CARDS = 'EXPECT_UNPUBLISHED_CARDS';

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

type ActionShowCard = {
	type: typeof SHOW_CARD,
	requestedCard: CardID,
	card: CardID
};

type ActionUpdateCollection = {
	type: typeof UPDATE_COLLECTION,
	setName: SetName,
	filters: string[],
	sortName: SortName,
	sortReversed: boolean,
	viewMode: ViewMode,
	viewModeExtra: string
};

type ActionUpdateRenderOffset = {
	type: typeof UPDATE_RENDER_OFFSET,
	renderOffset: number
};

type ActionUpdateCollectionSnapshot = {
	type: typeof UPDATE_COLLECTION_SHAPSHOT
};

type ActionRandomizeSalt = {
	type: typeof RANDOMIZE_SALT
};

type ActionCommentsUpdateThreads = {
	type: typeof COMMENTS_UPDATE_THREADS,
	threads: CommentThreads
};

type ActionCommentsUpdateMessages = {
	type: typeof COMMENTS_UPDATE_MESSAGES,
	messages: CommentMessages
};

type ActionUpdateCards = {
	type: typeof UPDATE_CARDS,
	cards: Cards,
	unpublished: boolean
};

type ActionUpdateSections = {
	type: typeof UPDATE_SECTIONS,
	sections: Sections
};

type ActionUpdateTags = {
	type: typeof UPDATE_TAGS,
	tags: Tags
};

type ActionUpdateAuthors = {
	type: typeof UPDATE_AUTHORS,
	authors: AuthorsMap
};

type ActionUpdateTweets = {
	type: typeof UPDATE_TWEETS,
	tweets: TweetMap
};

type ActionRemoveCards = {
	type: typeof REMOVE_CARDS,
	cardIDs: CardID[]
};

type ActionTweetsLoading = {
	type: typeof TWEETS_LOADING,
	loading: boolean
};

type ActionModifyCard = {
	type: typeof MODIFY_CARD
};

type ActionModifyCardSuccess = {
	type: typeof MODIFY_CARD_SUCCESS
};

type ActionModifyCardFailure = {
	type: typeof MODIFY_CARD_FAILURE,
	error: Error
};

type ActionReorderStatus = {
	type: typeof REORDER_STATUS,
	pending: boolean
};

type ActionSetPendingSlug = {
	type: typeof SET_PENDING_SLUG,
	slug: Slug
};

type ActionExpectNewCard = {
	type: typeof EXPECT_NEW_CARD,
	ID: CardID
	cardType: CardType,
	navigate: boolean,
	noSectionChange: boolean,
	published: boolean
};

type ActionExpectedNewCardFailed = {
	type: typeof EXPECTED_NEW_CARD_FAILED
};

type ActionNavigatedToNewCard = {
	type: typeof NAVIGATED_TO_NEW_CARD
};

type ActionExpectCardDeletions = {
	type: typeof EXPECT_CARD_DELETIONS,
	cards: CardBooleanMap
};

type ActionCommittedPendingFiltersWhenFullyLoaded = {
	type: typeof COMMITTED_PENDING_FILTERS_WHEN_FULLY_LOADED,
};

type ActionExpectUnpublishedCards = {
	type: typeof EXPECT_UNPUBLISHED_CARDS
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
	| ActionTurnSuggestedMissingConcepts
	| ActionShowCard
	| ActionUpdateCollection
	| ActionUpdateRenderOffset
	| ActionUpdateCollectionSnapshot
	| ActionRandomizeSalt
	| ActionCommentsUpdateThreads
	| ActionCommentsUpdateMessages
	| ActionUpdateCards
	| ActionUpdateSections
	| ActionUpdateTags
	| ActionUpdateAuthors
	| ActionUpdateTweets
	| ActionRemoveCards
	| ActionTweetsLoading
	| ActionModifyCard
	| ActionModifyCardSuccess
	| ActionModifyCardFailure
	| ActionReorderStatus
	| ActionSetPendingSlug
	| ActionExpectNewCard
	| ActionExpectedNewCardFailed
	| ActionNavigatedToNewCard
	| ActionExpectCardDeletions
	| ActionCommittedPendingFiltersWhenFullyLoaded
	| ActionExpectUnpublishedCards;
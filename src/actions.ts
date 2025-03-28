import {
	FIND_CARD_OPEN as OPEN,
	FIND_CARD_TO_LINK as LINK,
	FIND_CARD_TO_PERMISSION as PERMISSION,
	FIND_CARD_TO_REFERENCE as REFRENCE
} from '../shared/card_fields.js';

import {
	ChatID,
	CollectionConfiguration
} from '../shared/types.js';

import {
	AIDialogType,
	AIModelName,
	AuthorsMap,
	AutoTODOType,
	BooleanDiffValue,
	BulkImportDialogMode,
	Card,
	CardBooleanMap,
	CardDiff,
	CardFetchType,
	CardFieldTypeEditable,
	CardID,
	CardIdentifier,
	CardType,
	Cards,
	ChatMessages,
	Chats,
	CommentMessageID,
	CommentMessages,
	CommentThreadID,
	CommentThreads,
	CommitActionType,
	EditorContentTab,
	EditorTab,
	ImageInfoProperty,
	ImageInfoPropertyValue,
	ImporterType,
	MaintenanceTaskMap,
	PermissionType,
	ProcessedCard,
	ReferenceType,
	SectionID,
	Sections,
	Slug,
	SortExtra,
	Suggestion,
	TagID,
	Tags,
	TweetMap,
	Uid,
	UserInfo,
	UserPermissions,
	UserPermissionsMap
} from './types.js';

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
export const TURN_COMPLETE_MODE = 'TURN_COMPLETE_MODE';
//BulkImport
export const BULK_IMPORT_DIALOG_OPEN = 'BULK_IMPORT_DIALOG_OPEN';
export const BULK_IMPORT_PENDING = 'BULK_IMPORT_DIALOG_PENDING';
export const BULK_IMPORT_SUCCESS = 'BULK_IMPORT_SUCCESS';
export const BULK_IMPORT_FAILURE = 'BULK_IMPORT_FAILURE';
export const BULK_IMPORT_DIALOG_CLOSE = 'BULK_IMPORT_DIAOG_CLOSE';
export const BULK_IMPORT_SET_BODIES = 'BULK_IMPORT_SET_BODIES';
export const BULK_IMPORT_SET_OVERRIDE_CARD_ORDER = 'BULK_IMPORT_SET_OVERRIDE_CARD_ORDER';
//Collection.js
export const SHOW_CARD = 'SHOW_CARD';
export const UPDATE_COLLECTION = 'UPDATE_COLLECTION';
export const UPDATE_COLLECTION_CONFIGURATION_SHAPSHOT = 'UPDATE_COLLECTION_CONFIGURATION_SHAPSHOT';
export const UPDATE_RENDER_OFFSET = 'UPDATE_RENDER_OFFSET';
export const UPDATE_COLLECTION_SHAPSHOT = 'UPDATE_COLLECTION_SHAPSHOT';
export const RANDOMIZE_SALT = 'RANDOMIZE_SALT';
export const SELECT_CARDS = 'SELECT_CARDS';
export const UNSELECT_CARDS = 'UNSELECT_CARDS';
export const CLEAR_SELECTED_CARDS = 'CLEAR_SELECTED_CARDS';
export const INCREMENT_COLLECTION_WORD_CLOUD_VERSION = 'INCREMENT_COLLECTION_WORD_CLOUD_VERSION';
//Comments
export const COMMENTS_UPDATE_THREADS = 'COMMENTS_UPDATE_THREADS';
export const COMMENTS_UPDATE_MESSAGES = 'COMMENTS_UPDATE_MESSAGES';
export const COMMENTS_UPDATE_CARD_THREADS = 'COMMENTS_UPDATE_CARD_THREADS';
//Chat
export const CHAT_UPDATE_CHATS = 'CHAT_UPDATE_CHATS';
export const CHAT_UPDATE_MESSAGES = 'CHAT_UPDATE_MESSAGES';
export const CHAT_EXPECT_CHATS = 'CHAT_EXPECT_CHATS';
export const CHAT_EXPECT_CHAT_MESSAGES = 'CHAT_EXPECT_CHAT_MESSAGES';
export const CHAT_UPDATE_CURRENT_CHAT = 'CHAT_UPDATE_CURRENT_CHAT';
export const CHAT_SEND_MESSAGE = 'CHAT_SEND_MESSAGE';
export const CHAT_UPDATE_COMPOSING_MESSAGE = 'CHAT_UPDATE_COMPOSING_MESSAGE';
export const CHAT_SEND_MESSAGE_SUCCESS = 'CHAT_SEND_MESSAGE_SUCCESS';
export const CHAT_SEND_MESSAGE_FAILURE = 'CHAT_SEND_MESSAGE_FAILURE';
//Data
export const UPDATE_CARDS = 'UPDATE_CARDS';
export const ENQUEUE_CARD_UPDATES = 'ENQUEUE_CARD_UPDATES';
export const CLEAR_ENQUEUED_CARD_UPDATES = 'CLEAR_ENQUEUED_CARD_UPDATES';
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
export const EXPECT_FETCHED_CARDS = 'EXPECT_FETCHED_CARDS';
export const STOP_EXPECTING_FETCHED_CARDS = 'STOP_EXPECTING_FETCHED_CARDS';
export const UPDATE_CARD_SIMILARITY = 'UPDATE_CARD_SIMILARITY';
//Editor
export const EDITING_START = 'EDITING_START';
export const EDITING_FINISH = 'EDITING_FINISH';
export const EDITING_EDITOR_MINIMIZED = 'EDITING_EDITOR_MINIMIZED';
export const EDITING_SELECT_TAB = 'EDITING_SELECT_TAB';
export const EDITING_SELECT_EDITOR_TAB = 'EDITING_SELECT_EDITOR_TAB';
export const EDITING_TEXT_FIELD_UPDATED = 'EDITING_TEXT_FIELD_UPDATED';
export const EDITING_SECTION_UPDATED = 'EDITING_SECTION_UPDATED';
export const EDITING_SLUG_ADDED = 'EDITING_SLUG_ADDED';
export const EDITING_NAME_UPDATED = 'EDITING_NAME_UPDATED';
export const EDITING_SUBSTANTIVE_UPDATED = 'EDITING_SUBSTANTIVE_UPDATED';
export const EDITING_CARD_TYPE_UPDATED = 'EDITING_CARD_TYPE_UPDATED';
export const EDITING_PUBLISHED_UPDATED = 'EDITING_PUBLISHED_UPDATED';
export const EDITING_FULL_BLEED_UPDATED = 'EDITING_FULL_BLEED_UPDATED';
export const EDITING_NOTES_UPDATED = 'EDITING_NOTES_UPDATED';
export const EDITING_TODO_UPDATED = 'EDITING_TODO_UPDATED';
export const EDITING_AUTO_TODO_OVERRIDE_ENABLED = 'EDITING_AUTO_TODO_OVERRIDE_ENABLED';
export const EDITING_AUTO_TODO_OVERRIDE_DISABLED = 'EDITING_AUTO_TODO_OVERRIDE_DISABLED';
export const EDITING_AUTO_TODO_OVERRIDE_REMOVED = 'EDITING_AUTO_TODO_OVERRIDE_REMOVED';
export const EDITING_TAG_ADDED = 'EDITING_TAG_ADDED';
export const EDITING_TAG_REMOVED = 'EDITING_TAG_REMOVED';
export const EDITING_PROCESS_NORMALIZED_TEXT_PROPERTIES = 'EDITING_PROCESS_NORMALIZED_TEXT_PROPERTIES';
export const EDITING_EDITOR_ADDED = 'EDITING_EDITOR_ADDED';
export const EDITING_EDITOR_REMOVED = 'EDITING_EDITOR_REMOVED';
export const EDITING_COLLABORATOR_ADDED = 'EDITING_COLLABORATOR_ADDED';
export const EDITING_COLLABORATOR_REMOVED = 'EDITING_COLLABORATOR_REMOVED';
export const EDITING_START_REFERENCE_CARD = 'EDITING_START_REFERENCE_CARD';
export const EDITING_RESET_REFERENCE_CARD = 'EDITING_RESET_REFERENCE_CARD';
export const EDITING_ADD_REFERENCE = 'EDITING_ADD_REFERENCE';
export const EDITING_REMOVE_REFERENCE = 'EDITING_REMOVE_REFERENCE';
export const EDITING_ADD_IMAGE_URL = 'EDITING_ADD_IMAGE_URL';
export const EDITING_REMOVE_IMAGE_AT_INDEX = 'EDITING_REMOVE_IMAGE_AT_INDEX';
export const EDITING_MOVE_IMAGE_AT_INDEX = 'EDITING_MOVE_IMAGE_AT_INDEX';
export const EDITING_CHANGE_IMAGE_PROPERTY = 'EDITING_CHANGE_IMAGE_PROPERTY';
export const EDITING_OPEN_IMAGE_PROPERTIES_DIALOG = 'EDITING_OPEN_IMAGE_PROPERTIES_DIALOG';
export const EDITING_CLOSE_IMAGE_PROPERTIES_DIALOG = 'EDITING_CLOSE_IMAGE_PROPERTIES_DIALOG';
export const EDITING_OPEN_IMAGE_BROWSER_DIALOG = 'EDITING_OPEN_IMAGE_BROWSER_DIALOG';
export const EDITING_CLOSE_IMAGE_BROWSER_DIALOG = 'EDITING_CLOSE_IMAGE_BROWSER_DIALOG';
export const EDITING_UPDATE_UNDERLYING_CARD = 'EDITING_UPDATE_UNDERLYING_CARD';
export const EDITING_MERGE_OVERSHADOWED_CHANGES = 'EDITING_MERGE_OVERSHADOWED_CHANGES';
export const EDITING_UPDATE_SIMILAR_CARDS = 'EDITING_UPDATE_SIMILAR_CARDS';
//Find
export const FIND_DIALOG_OPEN = OPEN;
export const FIND_DIALOG_CLOSE ='FIND_DIALOG_CLOSE';
export const FIND_UPDATE_QUERY = 'FIND_UPDATE_QUERY';
export const FIND_CARD_TO_LINK = LINK;
export const FIND_UPDATE_RENDER_OFFSET = 'FIND_UPDATE_RENDER_OFFSET';
export const FIND_UPDATE_ACTIVE_QUERY = 'FIND_UPDATE_ACTIVE_QUERY';
export const FIND_CARD_TO_PERMISSION = PERMISSION;
export const FIND_CARD_TO_REFERENCE = REFRENCE;
export const FIND_UPDATE_CARD_TYPE_FILTER = 'FIND_UPDATE_CARD_TYPE_FILTER';
export const FIND_UPDATE_SORT_BY_RECENT = 'FIND_UPDATE_SORT_BY_RECENT';
//Maintenance
export const UPDATE_EXECUTED_MAINTENANCE_TASKS = 'UPDATE_EXECUTED_MAINTENANCE_TASKS';
export const UPDATE_MAINTENANCE_TASK_ACTIVE = 'UPDATE_MAINTENANCE_TASK_ACTIVE';
//Multi-edit
export const MULTI_EDIT_DIALOG_OPEN = 'MULTI_EDIT_DIALOG_OPEN';
export const MULTI_EDIT_DIALOG_CLOSE ='MULTI_EDIT_DIALOG_CLOSE';
export const MULTI_EDIT_DIALOG_ADD_REFERENCE = 'MULTI_EDIT_DIALOG_ADD_REFERENCE';
export const MULTI_EDIT_DIALOG_REMOVE_REFERENCE = 'MULTI_EDIT_DIALOG_REMOVE_REFERENCE';
export const MULTI_EDIT_DIALOG_ADD_TAG = 'MULTI_EDIT_DIALOG_ADD_TAG';
export const MULTI_EDIT_DIALOG_REMOVE_TAG = 'MULTI_EDIT_DIALOG_REMOVE_TAG';
export const MULTI_EDIT_DIALOG_ADD_TODO_ENABLEMENT = 'MULTI_EDIT_DIALOG_ADD_TODO_ENABLEMENT';
export const MULTI_EDIT_DIALOG_REMOVE_TODO_ENABLEMENT = 'MULTI_EDIT_DIALOG_REMOVE_TODO_ENABLEMENT';
export const MULTI_EDIT_DIALOG_ADD_TODO_DISABLEMENT = 'MULTI_EDIT_DIALOG_ADD_TODO_DISABLEMENT';
export const MULTI_EDIT_DIALOG_REMOVE_TODO_DISABLEMENT = 'MULTI_EDIT_DIALOG_REMOVE_TODO_DISABLEMENT';
export const MULTI_EDIT_DIALOG_SET_PUBLISHED = 'MULTI_EDIT_DIALOG_SET_PUBLISHED';
//Permissions
export const PERMISSIONS_UPDATE_PERMISSIONS = 'PERMISSIONS_UPDATE_PERMISSIONS';
export const PERMISSIONS_START_ADD_CARD = 'PERMISSIONS_START_ADD_CARD';
export const PERMISSIONS_RESET_ADD_CARD = 'PERMISSIONS_RESET_ADD_CARD';
//Prompt
export const PROMPT_COMPOSE_SHOW = 'PROMPT_COMPOSE_SHOW';
export const PROMPT_COMPOSE_CANCEL = 'PROMPT_COMPOSE_CANCEL';
export const PROMPT_COMPOSE_COMMIT = 'PROMPT_COMPOSE_COMMIT';
export const PROMPT_COMPOSE_UPDATE_CONTENT = 'PROMPT_COMPOSE_UPDATE_CONTENT';
export const PROMPT_CONFIGURE_ACTION = 'PROMPT_CONFIGURE_ACTION';
//Suggestions
export const SUGGESTIONS_SHOW_PANEL = 'SUGGESTIONS_SHOW_PANEL';
export const SUGGESTIONS_HIDE_PANEL = 'SUGGESTIONS_HIDE_PANEL';
export const SUGGESTIONS_CHANGE_SELECTED = 'SUGGESTIONS_CHANGE_SELECTED';
export const SUGGESTIONS_REPLACE_SUGGESTIONS_FOR_CARD = 'SUGGESTIONS_REPLACE_SUGGESTIONS_FOR_CARD';
export const SUGGESTIONS_REMOVE_SUGGESTION_FOR_CARD = 'SUGGESTIONS_REMOVE_SUGGESTION_FOR_CARD';
export const SUGGESTIONS_SET_USE_LLMS = 'SUGGESTIONS_SET_USE_LLMS';
export const SUGGESTIONS_SET_AGGRESSIVE = 'SUGGESTIONS_SET_AGGRESSIVE';
export const SUGGESTIONS_LOADING_FOR_CARD = 'SUGGESTIONS_LOADING_FOR_CARD';
export const SUGGESTIONS_SET_PENDING = 'SUGGESTIONS_SET_PENDING';
//User
export const SIGNIN_USER = 'SIGNIN_USER';
export const SIGNIN_SUCCESS = 'SIGNIN_SUCCESS';
export const SIGNIN_FAILURE = 'SIGNIN_FAILURE';
export const SIGNOUT_USER = 'SIGNOUT_USER';
export const SIGNOUT_SUCCESS = 'SIGNOUT_SUCCESS';
export const UPDATE_STARS = 'UPDATE_STARS';
export const UPDATE_READS = 'UPDATE_READS';
export const UPDATE_READING_LIST = 'UPDATE_READING_LIST';
export const AUTO_MARK_READ_PENDING_CHANGED = 'AUTO_MARK_READ_PENDING_CHANGED';
export const UPDATE_USER_PERMISSIONS = 'UPDATE_USER_PERMISSIONS';

type ActionAIRequestStarted = {
	type: typeof AI_REQUEST_STARTED,
	kind: AIDialogType,
	model: AIModelName
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

type ActionTurnCompleteMode = {
	type: typeof TURN_COMPLETE_MODE,
	on: boolean,
	limit: number
};

type ActionBulkImportDialogOpen = {
	type: typeof BULK_IMPORT_DIALOG_OPEN
	mode: BulkImportDialogMode
};

type ActionBulkImportPending = {
	type: typeof BULK_IMPORT_PENDING
};

type ActionBulkImportDialogSetOverrideCardOrder = {
	type: typeof BULK_IMPORT_SET_OVERRIDE_CARD_ORDER,
	order: CardID[]
};

type ActionBulkImportFailure = {
	type: typeof BULK_IMPORT_FAILURE,
	error: string
};

type ActionBulkImportSuccees = {
	type: typeof BULK_IMPORT_SUCCESS
}

type ActionBulkImportDialogClose = {
	type: typeof BULK_IMPORT_DIALOG_CLOSE
};

type ActionBulkImportSetBodies = {
	type: typeof BULK_IMPORT_SET_BODIES,
	bodies: string[],
	importer: ImporterType,
	importerVersion: number
};

type ActionShowCard = {
	type: typeof SHOW_CARD,
	requestedCard: CardID,
	card: CardID
};

type ActionUpdateCollection = {
	type: typeof UPDATE_COLLECTION,
	collection: CollectionConfiguration
};

type ActionUpdateCollectionConfigurationSnapshot = {
	type: typeof UPDATE_COLLECTION_CONFIGURATION_SHAPSHOT
	collection: CollectionConfiguration
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

type ActionSelectCards = {
	type: typeof SELECT_CARDS,
	cards: CardID[]
};

type ActionUnselectCards = {
	type: typeof UNSELECT_CARDS,
	cards: CardID[]
};

type ActionClearSelectedCards = {
	type: typeof CLEAR_SELECTED_CARDS
};

type ActionIncrementCollectionWordCloudVersion = {
	type: typeof INCREMENT_COLLECTION_WORD_CLOUD_VERSION
};

type ActionCommentsUpdateThreads = {
	type: typeof COMMENTS_UPDATE_THREADS,
	threads: CommentThreads
};

type ActionCommentsUpdateMessages = {
	type: typeof COMMENTS_UPDATE_MESSAGES,
	messages: CommentMessages
};

type ActionChatUpdateChats = {
	type: typeof CHAT_UPDATE_CHATS,
	chats: Chats
};

type ActionChatUpdateMessages = {
	type: typeof CHAT_UPDATE_MESSAGES,
	messages: ChatMessages
};

type ActionChatExpectChats = {
	type: typeof CHAT_EXPECT_CHATS
};

type ActionChatExpectChatMessages = {
	type: typeof CHAT_EXPECT_CHAT_MESSAGES
};

type ActionChatUpdateCurrentChat = {
	type: typeof CHAT_UPDATE_CURRENT_CHAT
	currentChat: ChatID
};

type ActionChatSendMessage = {
	type: typeof CHAT_SEND_MESSAGE,
};

type ActionChatSendMessageSuccess = {
	type: typeof CHAT_SEND_MESSAGE_SUCCESS
};

type ActionChatSendMessageFailure = {
	type: typeof CHAT_SEND_MESSAGE_FAILURE,
	error : Error
};

type ActionChatUpdateComposingMessage = {
	type: typeof CHAT_UPDATE_COMPOSING_MESSAGE,
	composingMessage: string
};

type ActionUpdateCards = {
	type: typeof UPDATE_CARDS,
	cards: Cards,
	fetchType: CardFetchType
};

type ActionEnqueueCardUpdates = {
	type: typeof ENQUEUE_CARD_UPDATES,
	cards: Cards,
	fetchType: CardFetchType
};

type ActionClearEnqueuedCardUpdates = {
	type: typeof CLEAR_ENQUEUED_CARD_UPDATES
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
	type: typeof MODIFY_CARD,
	//How many modifications we expect to be made.
	modificationCount: number
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
	//Which channel to expect to hear the card on.
	cardLoadingChannel: CardFetchType
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

type ActionUpdateCardSimilarity = {
	type: typeof UPDATE_CARD_SIMILARITY,
	card_id : CardID,
	similarity: SortExtra
};

type ActionCommittedPendingFiltersWhenFullyLoaded = {
	type: typeof COMMITTED_PENDING_FILTERS_WHEN_FULLY_LOADED,
};

type ActionExpectFetchedCards = {
	type: typeof EXPECT_FETCHED_CARDS,
	fetchType: CardFetchType
};

type ActionStopExpectingFetchedCards = {
	type: typeof STOP_EXPECTING_FETCHED_CARDS,
	fetchType: CardFetchType
};

type ActionEditingStart = {
	type: typeof EDITING_START,
	card: ProcessedCard
};

type ActionEditingFinish = {
	type: typeof EDITING_FINISH
};

type ActionEditingEditorMinimized = {
	type: typeof EDITING_EDITOR_MINIMIZED,
	minimized: boolean
};

type ActionEditingSelectTab = {
	type: typeof EDITING_SELECT_TAB,
	tab: EditorTab
};

type ActionEditingSelectEditorTab = {
	type: typeof EDITING_SELECT_EDITOR_TAB,
	tab: EditorContentTab
};

type ActionEditingTextFieldUpdated = {
	type: typeof EDITING_TEXT_FIELD_UPDATED,
	fieldName: CardFieldTypeEditable,
	value: string,
	fromContentEditable: boolean
};

type ActionEditingSectionUpdated = {
	type: typeof EDITING_SECTION_UPDATED,
	section: SectionID
};

type ActionEditingSlugAdded = {
	type: typeof EDITING_SLUG_ADDED,
	slug: Slug
};

type ActionEditingNameUpdated = {
	type: typeof EDITING_NAME_UPDATED,
	name: CardIdentifier
};

type ActionEditingSubstantiveUpdated = {
	type: typeof EDITING_SUBSTANTIVE_UPDATED,
	checked: boolean,
	auto: boolean
};

type ActionEditingCardTypeUpdated = {
	type: typeof EDITING_CARD_TYPE_UPDATED,
	cardType: CardType
};

type ActionEditingPublishedUpdated = {
	type: typeof EDITING_PUBLISHED_UPDATED,
	published: boolean
};

type ActionEditingFullBleedUpdated = {
	type: typeof EDITING_FULL_BLEED_UPDATED,
	fullBleed: boolean
};

type ActionEditingNotesUpdated = {
	type: typeof EDITING_NOTES_UPDATED,
	notes: string
};

type ActionEditingTODOUpdated = {
	type: typeof EDITING_TODO_UPDATED,
	todo: string
};

type ActionEditingAutoTODOOverrideEnabled = {
	type: typeof EDITING_AUTO_TODO_OVERRIDE_ENABLED,
	todo: AutoTODOType
};

type ActionEditingAutoTODOOverrideDisabled = {
	type: typeof EDITING_AUTO_TODO_OVERRIDE_DISABLED,
	todo: AutoTODOType
};

type ActionEditingAutoTODOOverrideRemoved = {
	type: typeof EDITING_AUTO_TODO_OVERRIDE_REMOVED,
	todo: AutoTODOType
};

type ActionEditingTagAdded = {
	type: typeof EDITING_TAG_ADDED,
	tag: TagID
};

type ActionEditingTagRemoved = {
	type: typeof EDITING_TAG_REMOVED,
	tag: TagID
};

type ActionEditingProcessNormalizedTextProperties = {
	type: typeof EDITING_PROCESS_NORMALIZED_TEXT_PROPERTIES
};

type ActionEditingEditorAdded = {
	type: typeof EDITING_EDITOR_ADDED,
	editor: Uid
};

type ActionEditingEditorRemoved = {
	type: typeof EDITING_EDITOR_REMOVED,
	editor: Uid
};

type ActionEditingCollaboratorAdded = {
	type: typeof EDITING_COLLABORATOR_ADDED,
	collaborator: Uid,
	auto: boolean
};

type ActionEditingCollaboratorRemoved = {
	type: typeof EDITING_COLLABORATOR_REMOVED,
	collaborator: Uid,
	auto: boolean
};

type ActionEditingStartReferenceCard = {
	type: typeof EDITING_START_REFERENCE_CARD,
	referenceType: ReferenceType
};

type ActionEditingResetReferenceCard = {
	type: typeof EDITING_RESET_REFERENCE_CARD
};

type ActionEditingAddReference = {
	type: typeof EDITING_ADD_REFERENCE,
	cardID: CardID,
	referenceType: ReferenceType,
	value? : string
};

type ActionEditingRemoveReference = {
	type: typeof EDITING_REMOVE_REFERENCE,
	cardID: CardID,
	referenceType: ReferenceType
};

type ActionEditingAddImageURL = {
	type: typeof EDITING_ADD_IMAGE_URL,
	src: string,
	uploadPath: string,
	index: number
};

type ActionEditingRemoveImageAtIndex = {
	type: typeof EDITING_REMOVE_IMAGE_AT_INDEX,
	index: number
};

type ActionEditingMoveImageAtIndex = {
	type: typeof EDITING_MOVE_IMAGE_AT_INDEX,
	index: number,
	isRight: boolean
};

type ActionEditingChangeImageProperty = {
	type: typeof EDITING_CHANGE_IMAGE_PROPERTY,
	index: number,
	property: ImageInfoProperty,
	value: ImageInfoPropertyValue
};

type ActionEditingOpenImagePropertiesDialog = {
	type: typeof EDITING_OPEN_IMAGE_PROPERTIES_DIALOG,
	index: number
};

type ActionEditingCloseImagePropertiesDialog = {
	type: typeof EDITING_CLOSE_IMAGE_PROPERTIES_DIALOG
};

type ActionEditingOpenImageBrowserDialog = {
	type: typeof EDITING_OPEN_IMAGE_BROWSER_DIALOG,
	index: number
};

type ActionEditingCloseImageBrowserDialog = {
	type: typeof EDITING_CLOSE_IMAGE_BROWSER_DIALOG
};

type ActionEditingUpdateUnderlyingCard = {
	type: typeof EDITING_UPDATE_UNDERLYING_CARD,
	updatedUnderlyingCard: ProcessedCard
};

type ActionEditingMergeOvershadowedChanges = {
	type: typeof EDITING_MERGE_OVERSHADOWED_CHANGES,
	diff: CardDiff
};

type ActionEditingUpdateSimilarCards = {
	type: typeof EDITING_UPDATE_SIMILAR_CARDS,
	similarity: SortExtra
};

type ActionFindDialogOpen = {
	type: typeof FIND_DIALOG_OPEN,
	query: string,
	cardTypeFilter: string
};

type ActionFindDialogClose = {
	type: typeof FIND_DIALOG_CLOSE
};

type ActionFindUpdateQuery = {
	type: typeof FIND_UPDATE_QUERY,
	query: string
};

type ActionFindCardToLink = {
	type: typeof FIND_CARD_TO_LINK,
	query: string
};

type ActionFindUpdateRenderOffset = {
	type: typeof FIND_UPDATE_RENDER_OFFSET,
	renderOffset: number
};

type ActionFindUpdateActiveQuery = {
	type: typeof FIND_UPDATE_ACTIVE_QUERY
};

type ActionFindCardToPermission = {
	type: typeof FIND_CARD_TO_PERMISSION,
	query: string,
	cardTypeFilter: string
};

type ActionFindCardToReference = {
	type: typeof FIND_CARD_TO_REFERENCE,
	query: string,
	cardTypeFilter: string
};

type ActionFindUpdateCardTypeFilter = {
	type: typeof FIND_UPDATE_CARD_TYPE_FILTER,
	filter: string
};

type ActionFindUpdateSortByRecent = {
	type: typeof FIND_UPDATE_SORT_BY_RECENT,
	sortByRecent: boolean
};

type ActionUpdateExecutedMaintenanceTasks = {
	type: typeof UPDATE_EXECUTED_MAINTENANCE_TASKS,
	executedTasks: MaintenanceTaskMap
};

type ActionUpdateMaintenanceTaskActive = {
	type: typeof UPDATE_MAINTENANCE_TASK_ACTIVE,
	active: boolean
};

type ActionMultiEditDialogOpen = {
	type: typeof MULTI_EDIT_DIALOG_OPEN
};

type ActionMultiEditDialogClose = {
	type: typeof MULTI_EDIT_DIALOG_CLOSE
};

type ActionMultiEditDialogAddReference = {
	type: typeof MULTI_EDIT_DIALOG_ADD_REFERENCE,
	cardID: CardID,
	referenceType: ReferenceType
};

type ActionMultiEditDialogRemoveReference = {
	type: typeof MULTI_EDIT_DIALOG_REMOVE_REFERENCE,
	cardID: CardID,
	referenceType: ReferenceType
};

type ActionMultiEditDialogAddTag = {
	type: typeof MULTI_EDIT_DIALOG_ADD_TAG,
	tagID: TagID
};

type ActionMultiEditDialogRemoveTag = {
	type: typeof MULTI_EDIT_DIALOG_REMOVE_TAG,
	tagID: TagID
};

type ActionMultiEditDialogAddTODOEnablement = {
	type: typeof MULTI_EDIT_DIALOG_ADD_TODO_ENABLEMENT,
	todo: AutoTODOType
};

type ActionMultiEditDialogRemoveTODOEnablement = {
	type: typeof MULTI_EDIT_DIALOG_REMOVE_TODO_ENABLEMENT,
	todo: AutoTODOType
};

type ActionMultiEditDialogAddTODODisablement = {
	type: typeof MULTI_EDIT_DIALOG_ADD_TODO_DISABLEMENT,
	todo: AutoTODOType
};

type ActionMultiEditDialogRemoveTODODisablement = {
	type: typeof MULTI_EDIT_DIALOG_REMOVE_TODO_DISABLEMENT,
	todo: AutoTODOType
};

type ActionMultiEditDialogSetPublished = {
	type: typeof MULTI_EDIT_DIALOG_SET_PUBLISHED,
	published: BooleanDiffValue
};

type ActionPermissionsUpdatePermissions = {
	type: typeof PERMISSIONS_UPDATE_PERMISSIONS,
	permissionsToAdd: UserPermissionsMap,
	permissionsToRemove: {[user : Uid]: true}
};

type ActionPermissionsStartAddCard = {
	type: typeof PERMISSIONS_START_ADD_CARD,
	permissionType: PermissionType,
	uid: Uid
};

type ActionPermissionsResetAddCard = {
	type: typeof PERMISSIONS_RESET_ADD_CARD
};

type ActionPromptComposeShow = {
	type: typeof PROMPT_COMPOSE_SHOW,
	message: string,
	content: string
};

type ActionPromptComposeCancel = {
	type: typeof PROMPT_COMPOSE_CANCEL
};

type ActionPromptComposeCommit = {
	type: typeof PROMPT_COMPOSE_COMMIT
};

type ActionPromptComposeUpdateContent = {
	type: typeof PROMPT_COMPOSE_UPDATE_CONTENT,
	content: string
};

type ActionPromptConfigureAction = {
	type: typeof PROMPT_CONFIGURE_ACTION,
	action: CommitActionType,
	associatedId: CommentMessageID | CommentThreadID
};

type ActionSuggestionsShowPanel = {
	type: typeof SUGGESTIONS_SHOW_PANEL
};

type ActionSuggestionsHidePanel = {
	type: typeof SUGGESTIONS_HIDE_PANEL
};

type ActionSuggestionsChangeSelected = {
	type: typeof SUGGESTIONS_CHANGE_SELECTED;
	index: number
};

type ActionSuggestionsReplaceSuggestionsForCard = {
	type: typeof SUGGESTIONS_REPLACE_SUGGESTIONS_FOR_CARD,
	card: CardID,
	suggestions: Suggestion[],
	//Unless final is true, will not be marked as done loading for this card.
	final: boolean,
	//If true, will not replace the suggestions that are there but extend them.
	extend: boolean
};

type ActionSuggestionsRemoveSuggestionForCard = {
	type: typeof SUGGESTIONS_REMOVE_SUGGESTION_FOR_CARD,
	card: CardID,
	index: number
};

type ActionSuggestionsLoadingForCard = {
	type: typeof SUGGESTIONS_LOADING_FOR_CARD,
	card: CardID
};

type ActionSuggestionsSetPending = {
	type: typeof SUGGESTIONS_SET_PENDING,
	pending: boolean
};

type ActionSuggestionsSetUseLLMs = {
	type: typeof SUGGESTIONS_SET_USE_LLMS,
	useLLMs: boolean
};

type ActionSuggestionsSetAggressive = {
	type: typeof SUGGESTIONS_SET_AGGRESSIVE,
	aggressive: boolean
};

type ActionSigninUser = {
	type: typeof SIGNIN_USER,
};

type ActionSigninSuccess = {
	type: typeof SIGNIN_SUCCESS,
	user: UserInfo
};

type ActionSigninFailure = {
	type: typeof SIGNIN_FAILURE,
	error: Error
};

type ActionSignoutUser = {
	type: typeof SIGNOUT_USER,
};

type ActionSignoutSuccess = {
	type: typeof SIGNOUT_SUCCESS
};

type ActionUpdateStars = {
	type: typeof UPDATE_STARS,
	starsToAdd: CardID[],
	starsToRemove: CardID[]
};

type ActionUpdateReads = {
	type: typeof UPDATE_READS,
	readsToAdd: CardID[],
	readsToRemove: CardID[]
};

type ActionUpdateReadingList = {
	type: typeof UPDATE_READING_LIST,
	list: CardID[]
};

type ActionAutoMarkReadPendingChanged = {
	type: typeof AUTO_MARK_READ_PENDING_CHANGED,
	pending: boolean
};

type ActionUpdateUserPermissions = {
	type: typeof UPDATE_USER_PERMISSIONS,
	permissions: UserPermissions
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
	| ActionTurnCompleteMode
	| ActionShowCard
	| ActionBulkImportDialogOpen
	| ActionBulkImportPending
	| ActionBulkImportSuccees
	| ActionBulkImportFailure
	| ActionBulkImportDialogClose
	| ActionBulkImportSetBodies
	| ActionBulkImportDialogSetOverrideCardOrder
	| ActionUpdateCollection
	| ActionUpdateCollectionConfigurationSnapshot
	| ActionUpdateRenderOffset
	| ActionUpdateCollectionSnapshot
	| ActionRandomizeSalt
	| ActionSelectCards
	| ActionUnselectCards
	| ActionClearSelectedCards
	| ActionIncrementCollectionWordCloudVersion
	| ActionCommentsUpdateThreads
	| ActionCommentsUpdateMessages
	| ActionChatUpdateChats
	| ActionChatUpdateMessages
	| ActionChatExpectChats
	| ActionChatExpectChatMessages
	| ActionChatUpdateCurrentChat
	| ActionChatSendMessage
	| ActionChatSendMessageSuccess
	| ActionChatSendMessageFailure
	| ActionChatUpdateComposingMessage
	| ActionUpdateCards
	| ActionEnqueueCardUpdates
	| ActionClearEnqueuedCardUpdates
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
	| ActionExpectFetchedCards
	| ActionStopExpectingFetchedCards
	| ActionUpdateCardSimilarity
	| ActionEditingStart
	| ActionEditingFinish
	| ActionEditingEditorMinimized
	| ActionEditingSelectTab
	| ActionEditingSelectEditorTab
	| ActionEditingTextFieldUpdated
	| ActionEditingSectionUpdated
	| ActionEditingSlugAdded
	| ActionEditingNameUpdated
	| ActionEditingSubstantiveUpdated
	| ActionEditingCardTypeUpdated
	| ActionEditingPublishedUpdated
	| ActionEditingFullBleedUpdated
	| ActionEditingNotesUpdated
	| ActionEditingTODOUpdated
	| ActionEditingAutoTODOOverrideEnabled
	| ActionEditingAutoTODOOverrideDisabled
	| ActionEditingAutoTODOOverrideRemoved
	| ActionEditingTagAdded
	| ActionEditingTagRemoved
	| ActionEditingProcessNormalizedTextProperties
	| ActionEditingEditorAdded
	| ActionEditingEditorRemoved
	| ActionEditingCollaboratorAdded
	| ActionEditingCollaboratorRemoved
	| ActionEditingStartReferenceCard
	| ActionEditingResetReferenceCard
	| ActionEditingAddReference
	| ActionEditingRemoveReference
	| ActionEditingAddImageURL
	| ActionEditingRemoveImageAtIndex
	| ActionEditingMoveImageAtIndex
	| ActionEditingChangeImageProperty
	| ActionEditingOpenImagePropertiesDialog
	| ActionEditingCloseImagePropertiesDialog
	| ActionEditingOpenImageBrowserDialog
	| ActionEditingCloseImageBrowserDialog
	| ActionEditingUpdateUnderlyingCard
	| ActionEditingMergeOvershadowedChanges
	| ActionEditingUpdateSimilarCards
	| ActionFindDialogOpen
	| ActionFindDialogClose
	| ActionFindUpdateQuery
	| ActionFindCardToLink
	| ActionFindUpdateRenderOffset
	| ActionFindUpdateActiveQuery
	| ActionFindCardToPermission
	| ActionFindCardToReference
	| ActionFindUpdateCardTypeFilter
	| ActionFindUpdateSortByRecent
	| ActionUpdateExecutedMaintenanceTasks
	| ActionUpdateMaintenanceTaskActive
	| ActionMultiEditDialogOpen
	| ActionMultiEditDialogClose
	| ActionMultiEditDialogAddReference
	| ActionMultiEditDialogRemoveReference
	| ActionMultiEditDialogAddTag
	| ActionMultiEditDialogRemoveTag
	| ActionMultiEditDialogAddTODOEnablement
	| ActionMultiEditDialogRemoveTODOEnablement
	| ActionMultiEditDialogAddTODODisablement
	| ActionMultiEditDialogRemoveTODODisablement
	| ActionMultiEditDialogSetPublished
	| ActionPermissionsUpdatePermissions
	| ActionPermissionsStartAddCard
	| ActionPermissionsResetAddCard
	| ActionPromptComposeShow
	| ActionPromptComposeCancel
	| ActionPromptComposeCommit
	| ActionPromptComposeUpdateContent
	| ActionPromptConfigureAction
	| ActionSuggestionsShowPanel
	| ActionSuggestionsHidePanel
	| ActionSuggestionsChangeSelected
	| ActionSuggestionsReplaceSuggestionsForCard
	| ActionSuggestionsRemoveSuggestionForCard
	| ActionSuggestionsSetUseLLMs
	| ActionSuggestionsSetAggressive
	| ActionSuggestionsLoadingForCard
	| ActionSuggestionsSetPending
	| ActionSigninUser
	| ActionSigninSuccess
	| ActionSigninFailure
	| ActionSignoutUser
	| ActionSignoutSuccess
	| ActionUpdateStars
	| ActionUpdateReads
	| ActionUpdateReadingList
	| ActionAutoMarkReadPendingChanged
	| ActionUpdateUserPermissions;
import { createSelector } from 'reselect';

import {
	createObjectSelector,
	createObjectSelectorCreator
} from 'reselect-map';

/* 
 This is the collection of all getters and selectors for state. 

 Toberesilienttodatamodelstructurechanges,neveraccessstatedirectlyandinsteadus
 eoneofthese.

 functions that start with 'select' take a single argument, state, and are appropriate
 to use in compound selectors. Functions that start with 'get' take state and another argument.

*/

import {
	TODO_COMBINED_FILTER_NAME,
	cardTODOConfigKeys,
	queryFilter,
	CARD_FILTER_DESCRIPTIONS,
	similarFilter,
	limitFilter,
	excludeFilter,
	cardsFilter,
	cardTypeFilter,
	SELECTED_FILTER_NAME
} from './filters.js';

import {
	Collection,
	CollectionDescription,
} from './collection_description.js';

import {
	tabConfiguration
} from './tabs.js';

import {
	BODY_CARD_TYPES,
	DEFAULT_CARD_TYPE,
	CARD_TYPE_CONFIGURATION,
	DEFAULT_SORT_ORDER_INCREMENT,
	MIN_SORT_ORDER_VALUE,
	MAX_SORT_ORDER_VALUE,
	editableFieldsForCardType
} from './card_fields.js';

import {
	references,
	unionReferences,
	intersectionReferences
} from './references.js';

import {
	Fingerprint,
	FingerprintGenerator,
	extractFiltersFromQuery,
	emptyWordCloud,
	cardWithNormalizedTextProperties,
	suggestedConceptReferencesForCard,
	getConceptsFromConceptCards,
	conceptCardsFromCards,
	possibleMissingConcepts,
	synonymMap
} from './nlp.js';

import {
	infoPanelReferenceBlocksForCard,
	expandReferenceBlocks,
	getExpandedPrimaryReferenceBlocksForCard,
	ExpandedReferenceBlocks,
} from './reference_blocks.js';

import {
	COMPOSED_USER_TYPE_ALL_PERMISSIONS,
	COMPOSED_USER_TYPE_ANOYMOUS_PERMISSIONS,
	COMPOSED_USER_TYPE_SIGNED_IN_PERMISSIONS,
	COMPOSED_USER_TYPE_SIGNED_IN_DOMAIN_PERMISSIONS,
	PERMISSION_ADMIN,
	PERMISSION_EDIT,
	PERMISSION_VIEW_APP,
	PERMISSION_VIEW_UNPUBLISHED,
	PERMISSION_EDIT_SECTION,
	PERMISSION_EDIT_TAG,
	PERMISSION_CREATE_CARD,
	PERMISSION_COMMENT,
	PERMISSION_STAR,
	PERMISSION_MARK_READ,
	PERMISSION_MODIFY_READING_LIST,
	PERMISSION_EDIT_CARD,
	PERMISSION_REMOTE_AI
} from './permissions.js';

import {
	backportFallbackTextMapForCard,
} from './util.js';

import {
	nextMaintenanceTaskName
} from './actions/maintenance.js';

import {
	cardDiffDescription,
	generateCardDiff,
	overshadowedDiffChanges,
	cardDiffHasChanges
} from './card_diff.js';

import {
	USER_DOMAIN,
	TAB_CONFIGURATION,
	TAB_OVERRIDES_CONFIGURATION,
	OPENAI_ENABLED
} from './config.GENERATED.SECRET.js';

import {
	State,
	Cards,
	CommentMessageID,
	CommentMessages,
	AuthorsMap,
	CommentThreadID,
	CommentThreads,
	ComposedCommentMessage,
	ComposedCommentThread,
	CommentThread,
	CommentMessage,
	Uid,
	Author,
	CardType,
	ReferencesInfoMap,
	UserInfo,
	CardBooleanMap,
	CardID,
	SectionID,
	TagID,
	Card,
	UserPermissionsForCards,
	ProcessedCard,
	ProcessedCards,
	CardFieldType,
	Sections,
	CardIdentifier,
	Section,
	Slug,
	WordCloud,
	CollectionConstructorArguments,
	ExpandedTabConfig,
	SortName,
	AIDialogType,
	AIModelName,
	SetName,
	ViewMode,
	ReferenceType,
	SortExtra,
	CardDiff,
	Filters
} from './types.js';

import {
	exportContentForCards
} from './contenteditable.js';

import {
	TypedObject
} from './typed_object.js';

import {
	Timestamp
} from 'firebase/firestore';

const selectState = (state : State) : State => state;

export const selectPage = (state : State) => state.app.page;
export const selectPageExtra = (state : State) => state.app.pageExtra;
export const selectFetchedCard = (state : State) => state.app.fetchedCard;
export const selectCardBeingFetched = (state : State) => state.app.cardBeingFetched;
export const selectCardsDrawerInfoExpanded = (state : State) => state.app.cardsDrawerInfoExpanded;
export const selectConfigureCollectionDialogOpen = (state : State) => state.app ? state.app.configureCollectionDialogOpen : false;
export const selectSuggestMissingConceptsEnabled = (state : State) => state.app.suggestMissingConceptsEnabled;

export const selectComposeOpen = (state : State) => state.prompt ? state.prompt.composeOpen : false;
export const selectPromptContent = (state : State) => state.prompt ? state.prompt.content : '';
export const selectPromptMessage = (state : State) => state.prompt ? state.prompt.message : '';
export const selectPromptAction = (state : State) => state.prompt ? state.prompt.action : 'CONSOLE_LOG';
export const selectPromptAssociatedId = (state : State) => state.prompt ? state.prompt.associatedId : '';

export const selectIsEditing = (state : State) => state.editor ? state.editor.editing : false;
export const selectFindDialogOpen = (state : State) => state.find ? state.find.open : false;
export const selectFindReferencing = (state : State) => state.find ? state.find.referencing : false;
export const selectFindLinking = (state : State) => state.find ? state.find.linking : false;
export const selectFindPermissions = (state : State) => state.find ? state.find.permissions : false;

export const selectMultiEditDialogOpen = (state : State) => state.multiedit ? state.multiedit.open : false;
export const selectMultiEditReferencesDiff = (state : State) => state.multiedit ? state.multiedit.referencesDiff : [];
export const selectMultiEditAddTags = (state : State) => state.multiedit ? state.multiedit.addTags : [];
export const selectMultiEditRemoveTags = (state : State) => state.multiedit ? state.multiedit.removeTags : [];
export const selectMultiEditAddTODOEnablements = (state : State) => state.multiedit ? state.multiedit.addTODOEnablements : [];
export const selectMultiEditAddTODODisablements = (state : State) => state.multiedit ? state.multiedit.addTODODisablements : [];

export const selectBulkImportDialogOpen = (state : State) => state.bulkImport ? state.bulkImport.open : false;
export const selectBulKimportDialogMode = (state : State) => state.bulkImport ? state.bulkImport.mode : 'import';
export const selectBulkImportPending = (state : State) => state.bulkImport ? state.bulkImport.pending : false;
export const selectBulkImportDialogBodies = (state : State) => state.bulkImport ? state.bulkImport.bodies : [];
export const selectBulkImportDialogImporter = (state : State) => state.bulkImport ? state.bulkImport.importer : '';
export const selectBulkImportDialogImporterVersion = (state : State) => state.bulkImport ? state.bulkImport.importerVersion : 0;
export const selectBulkImportDialogOverrideCardOrder = (state : State) => state.bulkImport ? state.bulkImport.overrideCardOrder : null;

export const selectAIDialogOpen = (state : State) => state.ai ? state.ai.open : false;
export const selectAIActive = (state : State) => state.ai ? state.ai.active : false;
export const selectAIDialogKind = (state : State) : AIDialogType => state.ai ? state.ai.kind : 'summary';
export const selectAIResult = (state : State) => state.ai ? state.ai.result : [];
export const selectAIResultIndex = (state : State) => state.ai ? state.ai.selectedIndex : -1;
export const selectAIError = (state : State) => state.ai ? state.ai.error : '';
export const selectAIAllCards = (state : State) => state.ai ? state.ai.allCards : [];
export const selectAIFilteredCards = (state : State) => state.ai ? state.ai.filteredCards : [];
export const selectAIModel = (state : State) : AIModelName => state.ai ? state.ai.model : 'gpt-3.5-turbo';

export const selectCommentsAndInfoPanelOpen = (state : State) => state.app ? state.app.commentsAndInfoPanelOpen : false;

export const selectImagePropertiesDialogOpen = (state : State) => state.editor ? state.editor.imagePropertiesDialogOpen : false;
export const selectImagePropertiesDialogIndex = (state : State) => state.editor ? state.editor.imagePropertiesDialogIndex : 0;
export const selectImageBrowserDialogOpen = (state : State) => state.editor ? state.editor.imageBrowserDialogOpen : false;
//undefined signals to add to end
export const selectImageBrowserDialogIndex = (state : State) => state.editor ? state.editor.imageBrowserDialogIndex : undefined;

export const selectActiveRenderOffset = (state : State) => state.collection ? state.collection.activeRenderOffset : 0;
const selectActiveSetName = (state : State) : SetName => state.collection ? state.collection.activeSetName : 'main';
const selectActiveFilterNames = (state : State) => state.collection ? state.collection.activeFilterNames : [];
const selectActiveSortName = (state : State) : SortName => state.collection ? state.collection.activeSortName : 'default';
const selectActiveSortReversed = (state : State) => state.collection ? state.collection.activeSortReversed : false;
const selectActiveViewMode = (state : State) : ViewMode => state.collection ? state.collection.activeViewMode : 'list';
const selectActiveViewModeExtra = (state : State) => state.collection ? state.collection.activeViewModeExtra : '';
export const selectRequestedCard = (state : State) => state.collection? state.collection.requestedCard : '';
export const selectActiveCardID = (state : State) => state.collection ? state.collection.activeCardID : '';
export const selectExplicitlySelectedCardIDs = (state : State) => state.collection ? state.collection.selectedCards : {};
const selectRandomSalt = (state : State) => state.collection ? state.collection.randomSalt : '';
//Note that the editing card doesn't have nlp/normalized text properties set. If
//you want the one with that, look at selectEditingNormalizedCard.
export const selectEditingCard = (state : State) => state.editor ? state.editor.card : null;
export const selectEditingUnderlyingCardSnapshot = (state : State) => state.editor ? state.editor.underlyingCardSnapshot : null;
const selectEditingOriginalUnderlyingCardSnapshot = (state : State) => state.editor ? state.editor.originalUnderlyingCardSnapshot : null;
const selectEditingCardExtractionVersion = (state : State) => state.editor ? state.editor.cardExtractionVersion : 0;
export const selectEditorMinimized = (state : State) => state.editor ? state.editor.editorMinimized : false;
export const selectEditingUpdatedFromContentEditable = (state : State) => state.editor ? state.editor.updatedFromContentEditable : {};
export const selectEditingPendingReferenceType = (state : State) : ReferenceType => state.editor ? state.editor.pendingReferenceType : 'ack';
export const selectPendingSlug = (state : State) => state.editor ? state.editor.pendingSlug : '';
const selectBaseFilters = (state : State) => state.collection ? state.collection.filters : {};
const selectBaseFiltersSnapshot = (state : State) => state.collection ? state.collection.filtersSnapshot : {};
export const selectSections = (state : State) => state.data ? state.data.sections : {};
export const selectTags = (state : State) => state.data ? state.data.tags : {};
export const selectExpectedDeletions = (state : State) => state.data ? state.data.expectedDeletions : {};
export const selectCardModificationPending = (state : State) => state.data ? state.data.cardModificationPending : false;
export const selectCardModificationError = (state : State) => state.data ? state.data.cardModificationError : null;
//All cards downloaded to client can be assumed to be OK to use in the rest of the pipeline.
//rawCards means they don't yet have their nlp data cached. See selectCards which returns that.
//This is only exposed so that updateCards can check for dupes directly.
//NOTE: this next one is duplicated in simple_selectors.js
export const selectRawCards = (state : State) => state.data ? state.data.cards : {};
const selectRawCardsSnapshot = (state : State) => state.data ? state.data.cardsSnapshot : {};
export const selectPendingNewCardIDToNavigateTo = (state : State) => state.data ? state.data.pendingNewCardIDToNavigateTo : '';
export const selectLoadingCardFetchTypes = (state : State) => state.data ? state.data.loadingCardFetchTypes : {};
export const selectSectionsLoaded = (state : State) => state.data ? state.data.sectionsLoaded : false;
export const selectTagsLoaded = (state : State) => state.data ? state.data.tagsLoaded : false;
export const selectMessagesLoaded = (state : State) => state.comments ? state.comments.messagesLoaded : false;
export const selectThreadsLoaded = (state : State) => state.comments ? state.comments.threadsLoaded : false;
export const selectAlreadyCommittedModificationsWhenFullyLoaded = (state : State) => state.data ? state.data.alreadyCommittedModificationsWhenFullyLoaded : false;
export const selectSlugIndex = (state : State) => state.data ? state.data.slugIndex : {};
export const selectMessages = (state : State) => state.comments ? state.comments.messages : null;
export const selectThreads = (state : State) => state.comments ? state.comments.threads : null;
export const selectAuthors = (state : State) => state.data.authors ? state.data.authors : {};
export const selectAllPermissions = (state : State) => state.permissions ? state.permissions.permissions : {};
export const selectPermissionsPendingUid = (state : State) => state.permissions ? state.permissions.pendingUid : '';
export const selectPermissionsPendingPermissionType = (state : State) => state.permissions ? state.permissions.pendingPermissionType : '';
const selectTweets = (state : State) => state.data ? state.data.tweets : {};
export const selectTweetsLoading = (state : State) => state.data ? state.data.tweetsLoading : false;
export const selectCardSimilarity = (state : State) => state.data ? state.data.cardSimilarity : {};
export const selectEditingCardSimilarity = (state : State) : SortExtra | undefined => state.editor ? state.editor.editingCardSimilarity : undefined;
export const selectActivePreviewCardId = (state : State) => state.app ? state.app.hoverCardId : '';
export const selectPreviewCardX = (state : State) => state.app ? state.app.hoverX : 0;
export const selectPreviewCardY = (state : State) => state.app ? state.app.hoverY : 0;
export const selectUserReads = (state : State) => state.user ? state.user.reads : {};
const selectUserStars = (state : State) => state.user ? state.user.stars : {};
export const selectUserReadingList = (state : State) => state.user ? state.user.readingList : [];
const selectUserReadingListSnapshot = (state : State) => state.user ? state.user.readingListSnapshot : [];

const selectCardsDrawerPanelOpen = (state : State) => state.app ? state.app.cardsDrawerPanelOpen : false;
export const selectCtrlKeyPressed = (state : State) => state.app ? state.app.ctrlKeyPressed : false;

export const selectExecutedMaintenanceTasks = (state : State) => state.maintenance ? state.maintenance.executedTasks : {};
export const selectMaintenanceTaskActive = (state : State) => state.maintenance ? state.maintenance.taskActive : false;

//selectQuery is what you should use to update the UI with the literal query
export const selectQuery = (state : State) => state.find ? state.find.query : '';
export const selectFindRenderOffset = (state : State) => state.find ? state.find.renderOffset : 0;
//activeQuery is the query that should be routed into the query pipeline.
const selectActiveQueryText = (state : State) => state.find ? state.find.activeQuery : '';
export const selectFindSortByRecent = (state : State) => state.find ? state.find.sortByRecent : false;
export const selectFindCardTypeFilter = (state : State) => state.find ? state.find.cardTypeFilter : '';
export const selectFindCardTypeFilterLocked = (state : State) => state.find ? state.find.cardTypeFilterLocked : false;

const selectSuggestionsRawOpen = (state : State) => state.suggestions ? state.suggestions.open : false;
export const selectSuggestionsForCards = (state : State) => state.suggestions ? state.suggestions.suggestionsForCard : {};
export const selectSuggestionsSelectedIndex = (state : State) => state.suggestions ? state.suggestions.selectedIndex : 0;
export const selectSuggestionsUseLLMs = (state : State) => state.suggestions ? state.suggestions.useLLMs : false;
export const selectSuggestionsAggressive = (state : State) => state.suggestions ? state.suggestions.aggressive : false;
export const selectSuggestionsLoadingForCard = (state : State) => state.suggestions ? state.suggestions.loadingForCard : {};
export const selectSuggestionsPending = (state : State) => state.suggestions ? state.suggestions.pending : false;

export const selectAuthPending = (state : State) => state.user ? state.user.pending : false;
//Note: this will return false unless stars have been loading, even if there is
//no user to load stars or reads for.
export const selectStarsLoaded = (state : State) => state.user ? state.user.starsLoaded : false;
export const selectReadsLoaded = (state : State) => state.user ? state.user.readsLoaded : false;
export const selectUserPermissionsLoaded = (state : State) => state.user ? state.user.userPermissionsLoaded : false;
export const selectReadingListLoaded = (state : State) => state.user ? state.user.readingListLoaded : false;

export const selectNextMaintenanceTaskName = createSelector(
	selectExecutedMaintenanceTasks,
	(executedTasks) => nextMaintenanceTaskName(executedTasks)
);

//selects a collection of outboundCardID -> fallbackMap, where fallbackMap is
//suitable to being passed to references.withFallbackText. The only items that
//will be created are for refrence types that opt into backporting via
//backportMissingText, and where the card has some text that needs to be filled.
const selectBackportTextFallbackMapCollection = createObjectSelector(
	selectRawCards,
	selectRawCards,
	//Because this is a createObjectSelector, this will be called once per card
	//in selectRawCards.
	(card : Card, cards : Cards) : ReferencesInfoMap | null => backportFallbackTextMapForCard(card, cards)
);

const selectRawConceptCards = createSelector(
	selectRawCards,
	(cards) => conceptCardsFromCards(cards)
);

export const selectSynonymMap = createSelector(
	selectRawCards,
	(cards) => synonymMap(cards)
);

//selectConcepts returns a map of all concepts based on visible concept cards.
export const selectConcepts = createSelector(
	selectRawConceptCards,
	(conceptCards) => getConceptsFromConceptCards(conceptCards)
);

const selectZippedCardAndFallbackMap = createSelector(
	selectRawCards,
	selectBackportTextFallbackMapCollection,
	(cards : Cards, fallbackTextCollection : {[id : CardID] :ReferencesInfoMap}) : {[id : CardID] : [card : Card, fallbackText: ReferencesInfoMap]} => Object.fromEntries(Object.entries(cards).map(entry => [entry[0], [entry[1], fallbackTextCollection[entry[0]]]]))
);

const selectSnapshotZippedCardAndFallbackMap = createSelector(
	selectRawCardsSnapshot,
	selectBackportTextFallbackMapCollection,
	(cards : Cards, fallbackTextCollection : {[id : CardID] :ReferencesInfoMap}) : {[id : CardID] : [card : Card, fallbackText: ReferencesInfoMap]}  => Object.fromEntries(Object.entries(cards).map(entry => [entry[0], [entry[1], fallbackTextCollection[entry[0]]]]))
);

//objectEquality checks for objects to be the same content, allowing nested
//objects
const objectEquality = (before : unknown, after : unknown) : boolean => {
	if (before === after) return true;
	if (!before) return false;
	if (!after) return false;
	if (typeof before != 'object') return false;
	if (typeof after != 'object') return false;
	if (Array.isArray(before) && Array.isArray(after)) return arrayEquality(before, after);
	const beforeEntries = Object.entries(before);
	const objAfter : {[name :string]: unknown} = after as {[name : string] : unknown};
	if (beforeEntries.length != Object.keys(after).length) return false;
	return beforeEntries.every(entry => objectEquality(entry[1], objAfter[entry[0]]));
};

//arrayEquality returns true if both are arrays and each of their items are the same
const arrayEquality = (before : unknown[], after : unknown[]) : boolean => {
	if (before === after) return true;
	if (!Array.isArray(before)) return false;
	if (!Array.isArray(after)) return false;
	if (before.length != after.length) return false;
	return before.every((item, i) => objectEquality(item, after[i]));
};

//note: using objectEquality, instead of something that knows that the first item
//is a card and the second is a two-level map, means that misses on card objects
//will be more expensive to discover, because they'll iterate through each
//property in the card. The upside is that because we use objectSelector, each
//card will be presented the same for each ID consistently, so by only treating
//them differently if something actually changed, we can save a lot of
//downstream processing, since we do often get updateCards with no real change
//to the card, and so much is downstream of when updateCards changes.
const createZippedObjectSelector = createObjectSelectorCreator(objectEquality);

//this uses createZippedObjectSelector because the cardAndFallbackMap entry will
//be a different item, but as long as the individual items are the same as last
//time they should be considered the same.
export const selectCards : (state : State) => ProcessedCards = createZippedObjectSelector(
	selectZippedCardAndFallbackMap,
	//Note that depending on selectConcepts actually doesn't lead to many
	//recalcs. That's because a) we're using objectEquality, so as long as the
	//map stays semantically the same cards won't be reindexed, and b) because
	//concept cards are by default published, which means they're in the first
	//set of cards. That means the only time every card has to be reindexed is
	//when specifically the title of one of the concept cards changes.
	selectConcepts,
	selectSynonymMap,
	//Note this processing on a card to make the nlp card should be the same as what is done in selectEditingNormalizedCard.
	(cardAndFallbackMap, concepts, synonyms) => cardWithNormalizedTextProperties(cardAndFallbackMap[0], cardAndFallbackMap[1], concepts, synonyms)
);

const selectCardsSnapshot : (state : State) => ProcessedCards = createZippedObjectSelector(
	selectSnapshotZippedCardAndFallbackMap,
	selectConcepts,
	selectSynonymMap,
	(cardAndFallbackMap, concepts, synonyms) => cardWithNormalizedTextProperties(cardAndFallbackMap[0], cardAndFallbackMap[1], concepts, synonyms)
);

export const selectAuthorAndCollaboratorUserIDs = createSelector(
	selectRawCards,
	(rawCards : Cards) : Uid[] => {
		const ids : {[id : Uid] : true} = {};
		for (const card of Object.values(rawCards)) {
			ids[card.author] = true;
			for (const collaborator of card.collaborators) {
				ids[collaborator] = true;
			}
		}
		return Object.keys(ids);
	}
);

export const selectActiveCard = createSelector(
	selectCards,
	selectActiveCardID,
	(cards : ProcessedCards, activeCard : CardID ) : ProcessedCard | null => cards[activeCard] || null
);

export const selectKeyboardNavigates = createSelector(
	selectIsEditing,
	selectFindDialogOpen,
	selectComposeOpen,
	(editing, find, compose) => !editing && !find && !compose
);

export const selectFilters = createSelector(
	selectBaseFilters,
	selectExplicitlySelectedCardIDs,
	(baseFilters, selectedCards) : Filters => ({
		...baseFilters,
		[SELECTED_FILTER_NAME]: selectedCards
	})
);

export const selectFiltersSnapshot = createSelector(
	selectBaseFiltersSnapshot,
	selectExplicitlySelectedCardIDs,
	(baseFilters, selectedCards) : Filters => ({
		...baseFilters,
		[SELECTED_FILTER_NAME]: selectedCards
	})
);

//This is just the userPermissions fetched; for the actual permissions object in
//use, see selectCOmposedPermissions.
const selectUserPermissions = (state : State) => state.user ? state.user.userPermissions : {};

//For actions, like starring and marking read, that are OK to do when signed
//in anonymously.
const userObjectExists = (user : UserInfo) : boolean => user && user.uid != '';
const userSignedIn = (user : UserInfo) : boolean => userObjectExists(user) && !user.isAnonymous;

export const selectUser = (state : State) => {
	if (!state.user) return null;
	if (!state.user.user) return null;
	return state.user.user;
};

export const selectUserIsAnonymous = createSelector(
	selectUser,
	(user) => user && userObjectExists(user) && user.isAnonymous
);

//UserSignedIn means that there is a user object, and that user is not
//anonymous. Note that selectors like selectUserMayMarkRead and
//selectUserMayComment may return true even when this returns false if the
//user is signed in anonymously.
export const selectUserSignedIn = createSelector(
	selectUser,
	(user) => user !== null && userSignedIn(user)
);

const selectUserSignedInDomain = createSelector(
	selectUserSignedIn,
	selectUser,
	(signedIn, user) => signedIn && user && user.email && user.email.toLowerCase().split('@')[1] == USER_DOMAIN
);

export const selectUserObjectExists = createSelector(
	selectUser,
	(user) => user && userObjectExists(user)
);

const selectUserTypePermissions = createSelector(
	selectUserObjectExists,
	selectUserSignedIn,
	selectUserSignedInDomain,
	(userObjectExists, isSignedIn,signedInDomain) => {
		//If the last is true, then the two before must be true, and on down.
		//Composed permissions already expand and combine the various bits together.
		if (signedInDomain) return COMPOSED_USER_TYPE_SIGNED_IN_DOMAIN_PERMISSIONS;
		if (isSignedIn) return COMPOSED_USER_TYPE_SIGNED_IN_PERMISSIONS;
		if (userObjectExists) return COMPOSED_USER_TYPE_ANOYMOUS_PERMISSIONS;
		return COMPOSED_USER_TYPE_ALL_PERMISSIONS;
	}
);

//The final, exhaustive enumeration of permissions for this user.
const selectComposedPermissions = createSelector(
	selectUserTypePermissions,
	selectUserPermissions,
	(userTypePermissions, userPermissions) => ({...userTypePermissions, ...userPermissions})
);

const userMayResolveThread = (state : State, thread : CommentThread) => {
	if (selectUserIsAdmin(state)) return true;
	if (!selectUserMayComment(state)) return false;
	if (!thread || typeof thread !== 'object') return false;
	const uid = selectUid(state);
	return uid == thread.author;
};

const userMayEditMessage = (state : State, message : CommentMessage) => {
	if (selectUserIsAdmin(state)) return true;
	if (!selectUserMayComment(state)) return false;
	if (!message || !message.author) return false;
	const uid = selectUid(state);
	return uid == message.author;
};

export const selectUid = createSelector(
	selectUser,
	(user) => user ? user.uid : ''
);

export const selectUserIsAdmin = createSelector(
	selectComposedPermissions,
	(permissions) => permissions[PERMISSION_ADMIN] || false
);

//Effectively recreated in functions/openai.ts:mayUseAI
export const selectUserMayUseAI = createSelector(
	selectUserIsAdmin,
	selectComposedPermissions,
	(admin, permissions) => OPENAI_ENABLED && (admin || permissions[PERMISSION_REMOTE_AI] || false)
);

export const selectUserMayEdit = createSelector(
	selectUserIsAdmin,
	selectComposedPermissions,
	(admin, permissions) => admin || permissions[PERMISSION_EDIT] || false
);

//if the user may edit ANY cards
const selectUserMayEditCards = createSelector(
	selectUserMayEdit,
	selectComposedPermissions,
	(userMayEdit, permissions) => userMayEdit || permissions[PERMISSION_EDIT_CARD] || false
);

export const selectCardIDsUserMayEdit : ((state: State) => CardBooleanMap) = createObjectSelector(
	selectCards,
	selectUserMayEditCards,
	selectUid,
	(card, userMayEditCards, uid) => {
		if (userMayEditCards) {
			return true;
		}
		if (!card) return false;
		if (card.author == uid) {
			return true;
		}
		if (!card.permissions || !card.permissions[PERMISSION_EDIT_CARD]) return false;
		if (!card.permissions[PERMISSION_EDIT_CARD].some((id : Uid) => id === uid)) return false;
		return true;
	}
);

export const userMayEditCard = (state : State, cardID : CardID) : boolean => selectCardIDsUserMayEdit(state)[cardID] || false;

export const selectUserMayEditActiveCard = createSelector(
	selectCardIDsUserMayEdit,
	selectActiveCardID,
	(editableCardIDs : CardBooleanMap, cardID : CardID) : boolean => editableCardIDs[cardID] || false
);

export const selectUserMayViewApp = createSelector(
	selectUserIsAdmin,
	selectComposedPermissions,
	(admin, permissions) => admin || permissions[PERMISSION_VIEW_APP] || false
);

export const selectUserMayViewUnpublished = createSelector(
	selectUserIsAdmin,
	selectUserMayViewApp,
	selectComposedPermissions,
	(admin, mayViewApp, permissions) => (mayViewApp || false) && (admin || permissions[PERMISSION_EDIT] || permissions[PERMISSION_EDIT_CARD] || permissions[PERMISSION_VIEW_UNPUBLISHED] || false)
);

export const selectUserMayEditPermissions = createSelector(
	selectUserIsAdmin,
	//For now, only admins may edit permissions.
	(admin) => admin || false
);

export const getUserMayEditSection = (state : State, sectionID : SectionID) => {
	if (selectUserMayEditSections(state)) return true;
	//orphaned 'section' is always editable
	if (!sectionID) return true;
	//TODO: check if the named section has an override;
	return false;
};

//This is a generic user-may-edit sections. A given section may explicitly allow
//a user to edit even if the user doesn't have generic editSection permission.
const selectUserMayEditSections = createSelector(
	selectUserMayEdit,
	selectComposedPermissions,
	(userMayEdit, permissions) => userMayEdit || permissions[PERMISSION_EDIT_SECTION]
);

export const selectUserMayChangeEditingCardSection = createSelector(
	selectState,
	selectEditingCard,
	(state, editingCard) => editingCard ? getUserMayEditSection(state, editingCard.section) : false
);

export const selectSectionsUserMayEdit = createSelector(
	selectState,
	selectSections,
	(state, sections) => Object.fromEntries(Object.entries(sections).filter(entry => getUserMayEditSection(state, entry[0])))
);

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const getUserMayEditTag = (state : State, _tagID : TagID) => {
	if (selectUserMayEditTags(state)) return true;
	//TODO: check if the named tagID has an override;
	return false;
};

//This is a generic user-may-edit sections. A given section may explicitly allow
//a user to edit even if the user doesn't have generic editSection permission.
const selectUserMayEditTags = createSelector(
	selectUserMayEdit,
	selectComposedPermissions,
	(userMayEdit, permissions) => userMayEdit || permissions[PERMISSION_EDIT_TAG]
);

//true if at least one of the tags returns true for getUserMayEditTag
export const selectUserMayEditSomeTags = createSelector(
	selectState,
	selectTags,
	(state, tags) => Object.keys(tags).some(id => getUserMayEditTag(state, id))
);

//returns the tag names that the user may not edit, useful for suppressItems for
//a editing tag-list.
export const tagsUserMayNotEdit = createSelector(
	selectState,
	selectTags,
	(state, tags) => Object.keys(tags).filter(id => !getUserMayEditTag(state, id))
);

export const selectUserMayCreateCard = createSelector(
	selectUserMayEdit,
	selectComposedPermissions,
	(userMayEdit, permissions) => userMayEdit || permissions[PERMISSION_CREATE_CARD] || false
);

export const selectUserMayForkActiveCard = createSelector(
	selectUserMayCreateCard,
	selectState,
	selectActiveCard,
	(mayCreateCard, state, activeCard) => Boolean(mayCreateCard && activeCard && getUserMayEditSection(state, activeCard.section))
);

//If it's the empty string, then user MAY delete the card
export const getReasonUserMayNotDeleteCard = (state : State, card : Card | null) => {
	//NOTE: this logic is recreatedin the firestore security rules for card deletion
	if (!card) return 'No card provided';

	if (!userMayEditCard(state, card.id)) return 'User may not edit card.';

	if (card.section) return 'Card must be orphaned to be deleted';

	if (card.tags.length) return 'Card must not have any tags to be deleted';

	if(references(card).inboundArray().length) return 'Card must not have any inbound references to be deleted';

	//User may delete the card
	return '';
};

//If non-empty string, it's the reason the user can't delete the card. If empty
//string, then user can delete it.
export const selectReasonsUserMayNotDeleteActiveCard = createSelector(
	selectState,
	selectActiveCard,
	(state, card) => getReasonUserMayNotDeleteCard(state, card)
);

export const selectUserMayComment = createSelector(
	selectUserIsAdmin,
	selectComposedPermissions,
	(admin, permissions) => admin || permissions[PERMISSION_COMMENT] || false
);

export const selectUserMayStar = createSelector(
	selectUserIsAdmin,
	selectComposedPermissions,
	(admin, permissions) => admin || permissions[PERMISSION_STAR] || false
);

export const selectUserMayMarkRead = createSelector(
	selectUserIsAdmin,
	selectComposedPermissions,
	(admin, permissions) => admin || permissions[PERMISSION_MARK_READ] || false
);

export const selectUserMayModifyReadingList = createSelector(
	selectUserIsAdmin,
	selectComposedPermissions,
	(admin, permissions) => admin || permissions[PERMISSION_MODIFY_READING_LIST] || false
);

export const selectAuthorsForTagList = createSelector(
	selectAuthors,
	(authors) => authors ? Object.fromEntries(Object.entries(authors).map(entry => [entry[0], {id:entry[0], title:entry[1].displayName || entry[0]}])) : {}
);

export const selectCollaboratorInfosForActiveCard = createSelector(
	selectActiveCard,
	selectAuthors,
	(card, authors) => card ? card.collaborators.map((uid : Uid) => (authors || {})[uid]) : []
);

//A map of uid -> permissionKey -> [cardID], for any uid that is listed in any card's permissions object.
export const selectUserPermissionsForCardsMap = createSelector(
	selectCards,
	(cards : Cards) : UserPermissionsForCards => {
		const result : UserPermissionsForCards = {};
		for (const card of Object.values(cards)) {
			if (!card.permissions) continue;
			for (const [permissionKey, uids] of TypedObject.entries(card.permissions)) {
				for (const uid of (uids || [])) {
					if (!result[uid]) result[uid] = {};
					if (!result[uid][permissionKey]) result[uid][permissionKey] = [];
					const arr = result[uid][permissionKey];
					if (!arr) throw new Error('We just set arr but it wasnt set');
					arr.push(card.id);
				}
			}
		}
		return result;
	}
);

export const selectUidsWithPermissions = createSelector(
	selectAllPermissions,
	selectUserPermissionsForCardsMap,
	(allPermissions, cardsMap) => Object.fromEntries(Object.entries(allPermissions || {}).map(entry => [entry[0], true]).concat(Object.entries(cardsMap).map(entry => [entry[0], true])))
);

export const selectFingerprintGenerator = createSelector(
	selectCards,
	(cards) => new FingerprintGenerator(cards)
);

//getSemanticFingerprintForCard operates on the actual cardObj passed, so it can
//work for cards that have been modified.
export const getSemanticFingerprintForCard = (state : State, cardObj : ProcessedCard, optFieldList? : CardFieldType[]) => {
	return selectFingerprintGenerator(state).fingerprintForCardObj(cardObj, optFieldList);
};

//A map of tagID to the semantic fingerprint for that card. A tag's semantic
//fingerprint is created by adding up all of its cards semantic fingerprint,
//resorting, and re-trimming down to fingerprint size. They can be compared
//directly to a given card's fingerprint.
const selectTagsSemanticFingerprint = createSelector(
	selectTags,
	selectFingerprintGenerator,
	(tags : Sections, fingerprintGenerator : FingerprintGenerator) : {[id : TagID]: Fingerprint} => {
		if (!tags) return {};
		const result : {[id : TagID]: Fingerprint} = {};
		for (const [tagID, tag] of Object.entries(tags)) {
			result[tagID] = fingerprintGenerator.fingerprintForCardIDList(tag.cards);
		}
		return result;
	}
);

let memoizedEditingNormalizedCard : ProcessedCard | undefined = undefined;
let memoizedEditingNormalizedCardExtractionVersion = -1;

//selectEditingNormalizedCard is like editing card, but with nlp properties set.
//It uses custom memoization because it should only update when the extraction
//version increases, since lots of expensive nlp stuff is downstream of it, and
//if it ran every single keystroke while editingCard was being edited it would
//be very slow. When extractionVersion increments, that's the system saying it's
//OK to run the expensive properties again.
const selectEditingNormalizedCard = (state : State) : ProcessedCard | undefined => {
	const extractionVersion = selectEditingCardExtractionVersion(state);
	if (memoizedEditingNormalizedCardExtractionVersion != extractionVersion) {
		memoizedEditingNormalizedCard = undefined;
	}
	//null is a totally legal value to have, so we signal we need a recalculation via undefined.
	if (memoizedEditingNormalizedCard === undefined) {
		//Note: this processing logic should be the same as selectCards processing.
		const editingCard = selectEditingCard(state);
		if (editingCard) {
			const cards = selectRawCards(state);
			const fallbackMap = backportFallbackTextMapForCard(editingCard, cards);
			const conceptsMap = selectConcepts(state);
			const synonyms = selectSynonymMap(state);
			memoizedEditingNormalizedCard = cardWithNormalizedTextProperties(editingCard, fallbackMap || {}, conceptsMap, synonyms);
		} else {
			memoizedEditingNormalizedCard = undefined;
		}
		memoizedEditingNormalizedCardExtractionVersion = extractionVersion;
	}
	return memoizedEditingNormalizedCard;
};

//EditingCard updates immediately upon keystroke, but doesn't have nlp set.
//editingNormalizedCard has nlp set, but only updates after a delay. This
//returns a hybrid object that updates whenever editingCard does, but munges in
//the most recent nlp block.
export const selectEditingCardwithDelayedNormalizedProperties = createSelector(
	selectEditingCard,
	selectEditingNormalizedCard,
	(editing, normalized) => {
		if (!editing) return editing;
		if (!normalized) return editing;
		return {...editing, nlp:normalized.nlp};
	}
);

export const selectEditingUnderlyingCard = createSelector(
	selectCards,
	selectEditingCard,
	(cards : ProcessedCards, editingCard : Card) : ProcessedCard | null => editingCard ? cards[editingCard.id] : null
);

export const selectEditingCardHasUnsavedChanges = createSelector(
	selectEditingCard,
	selectEditingUnderlyingCardSnapshot,
	(editingCard, snapshot) => cardDiffHasChanges(generateCardDiff(snapshot, editingCard))
);

const selectEditingUnderlyingCardSnapshotDiff = createSelector(
	selectEditingUnderlyingCard,
	selectEditingUnderlyingCardSnapshot,
	(underlyingCard, underlyingCardSnapshot) => generateCardDiff(underlyingCardSnapshot, underlyingCard)
);

export const selectOvershadowedUnderlyingCardChangesDiff = createSelector(
	selectEditingOriginalUnderlyingCardSnapshot,
	selectEditingUnderlyingCard,
	selectEditingCard,
	(original, snapshot, current) => overshadowedDiffChanges(original, snapshot, current)
);

export const selectOvershadowedUnderlyingCardChangesDiffDescription = createSelector(
	selectOvershadowedUnderlyingCardChangesDiff,
	(diff) => cardDiffDescription(diff)
);

export const selectEditingUnderlyingCardSnapshotDiffDescription = createSelector(
	selectEditingUnderlyingCardSnapshotDiff,
	(diff) => cardDiffDescription(diff)
);

//Warning: this is EXTREMELY expensive. Like 10 seconds of processing expensive!
const selectWordCloudForPossibleMissingConcepts = createSelector(
	selectCards,
	(cards) => possibleMissingConcepts(cards).wordCloud()
);

const selectEditingCardSemanticFingerprint = createSelector(
	selectEditingNormalizedCard,
	selectFingerprintGenerator,
	(card, fingerprintGenerator) => card ? fingerprintGenerator.fingerprintForCardObj(card) : new Fingerprint()
);

export const selectEditingCardSuggestedConceptReferences = createSelector(
	selectEditingNormalizedCard,
	selectConcepts,
	(card, concepts) => card ? suggestedConceptReferencesForCard(card, concepts) : []
);

const NUM_SIMILAR_TAGS_TO_SHOW = 3;

//selectEditingCardSuggestedTags returns the tags for the editing card that are
//suggested--that is that are similar to the semantics of this card, but are not
//yet on the card.
export const selectEditingCardSuggestedTags = createSelector(
	selectEditingCardwithDelayedNormalizedProperties,
	selectEditingCardSemanticFingerprint,
	selectTagsSemanticFingerprint,
	(card, cardFingerprint, tagFingerprints) => {
		if (!card || Object.keys(card).length == 0) return [];
		if (!tagFingerprints || Object.keys(tagFingerprints).length == 0) return [];
		const closestTags = new FingerprintGenerator().closestOverlappingItems('', cardFingerprint, tagFingerprints);
		if (closestTags.size == 0) return [];
		const excludeIDs = new Set(card.tags);
		const result = [];
		for (const tagID of closestTags.keys()) {
			if (excludeIDs.has(tagID)) continue;
			result.push(tagID);
			if (result.length >= NUM_SIMILAR_TAGS_TO_SHOW) break;
		}
		return result;
	}
);

//selectingEitingOrActiveCard returns either the editing card, or else the
//active card.
const selectEditingOrActiveNormalizedCard = createSelector(
	selectEditingNormalizedCard,
	selectActiveCard,
	(editing, active) => editing && Object.keys(editing).length > 0 ? editing : active
);

export const selectWordCloudForActiveCard = createSelector(
	selectEditingOrActiveNormalizedCard,
	selectFingerprintGenerator,
	(card, fingerprintGenerator) => {
		if (!card) return emptyWordCloud();
		const fingerprint = fingerprintGenerator.fingerprintForCardObj(card);
		return fingerprint.wordCloud();
	}
);

//Selects the set of all cards the current user can see (which even includes
//ones not in default)
export const selectAllCardsFilter = createSelector(
	selectCards,
	(cards) => Object.fromEntries(Object.entries(cards).map(entry => [entry[0], true]))
);

//selectTagInfosForCards selects a tagInfos map based on all cards. Used for
//example for showing missing link auto todos in card-editor.
export const selectTagInfosForCards = createSelector(
	selectCards,
	cards => Object.fromEntries(Object.entries(cards).map(entry => [entry[0], {id: entry[0], title:entry[1] ? entry[1].name : '', previewCard: entry[0]}]))
);

export const getCardHasStar = (state : State, cardId : CardID) : boolean => {
	return (selectUserStars(state) || {})[cardId] || false;
};

export const getCardIsRead = (state : State, cardId : CardID) : boolean => {
	return (selectUserReads(state) || {})[cardId] || false;
};

export const getCardInReadingList = (state : State, cardId : CardID) : boolean => {
	return (selectUserReadingListMap(state) || {})[cardId] || false;
};

export const getUserMayResolveThread = userMayResolveThread;
export const getUserMayEditMessage = userMayEditMessage;

export const getMessageById = (state : State, messageId : CommentMessageID) : CommentMessage | null => {
	const messages = selectMessages(state);
	if (!messages) return null;
	return messages[messageId];
};

export const getThreadById = (state : State, threadId : CommentThreadID) : CommentThread | null => {
	const threads = selectThreads(state);
	if (!threads) return null;
	return threads[threadId];
};

export const getCardById = (state : State, cardId : CardID) : ProcessedCard | null => {
	const cards = selectCards(state);
	if (!cards) return null;
	return cards[cardId];
};

export const getIdForCard = (state : State, idOrSlug : CardIdentifier) : CardID => {
	const slugIndex = selectSlugIndex(state);
	return slugIndex[idOrSlug] || idOrSlug;
};

export const getAuthorForId = (state : State, authorId : Uid) : Author => {
	const authors = selectAuthors(state);
	return authorOrDefault(authorId, authors || {});
};

const authorOrDefault = (authorId : Uid, authors : AuthorsMap) : Author => {
	const author = authors[authorId];
	if (!author){
		return {
			id: '',
			photoURL: '',
			updated: new Timestamp(0, 0),
			displayName: 'Unknown user'
		};
	}
	return author;
};

export const getCard = (state : State, cardIdOrSlug : CardIdentifier) : ProcessedCard | null  => getCardById(state, getIdForCard(state, cardIdOrSlug));

export const getSection = (state : State, sectionId : SectionID) : Section | null => {
	if (!state.data) return null;
	return state.data.sections[sectionId] || null;
};

const selectCardTodosMapForCurrentUser = createSelector(
	selectUserIsAdmin,
	selectFilters,
	(isAdmin, filters) => isAdmin ? filters[TODO_COMBINED_FILTER_NAME] : {}
);

export const selectUserReadingListMap = createSelector(
	selectUserReadingList,
	list => Object.fromEntries((list || []).map(item => [item, true]))
);

//for use to pass into card-badges.cardBadges.badgeMap
export const selectBadgeMap = createSelector(
	selectUserStars,
	selectUserReads,
	selectCardTodosMapForCurrentUser,
	selectUserReadingListMap,
	selectExplicitlySelectedCardIDs,
	(stars, reads, todos, readingList, selected) => ({stars, reads, todos, readingList, selected})
);

//TODO: once factoring the composed threads selctors into this file, refactor
//this to just select the composed threads.
export const selectActiveCardThreadIds = createSelector(
	selectActiveCardID,
	selectThreads,
	(cardId, rawThreads) => {
		const threads = rawThreads || {};
		return Object.keys(threads).filter(threadId => threads[threadId].card == cardId);
	}
);

export const selectActiveCardComposedThreads = createSelector(
	selectState,
	selectActiveCardThreadIds,
	selectThreads,
	selectMessages,
	selectAuthors,
	(state, threadIds, threads, messages, authors) => threadIds.map(id => composedThread(state, id, threads || {}, messages || {}, authors || {})).filter(thread => !!thread) as ComposedCommentThread[]
);

const composedThread = (state : State, threadId : CommentThreadID, threads : CommentThreads, messages : CommentMessages , authors : AuthorsMap) : ComposedCommentThread | null => {
	const originalThread = threads[threadId];
	if (!originalThread) return null;
	const expandedMessages = [];
	for (const messageId of Object.values(originalThread.messages)) {
		const message = composedMessage(state, messageId, messages, authors);
		if (message) expandedMessages.push(message);
	}
	return {
		...originalThread,
		expandedMessages: expandedMessages,
		expandedAuthor: authorOrDefault(originalThread.author, authors),
		mayResolve: userMayResolveThread(state, originalThread),
	};
};

const composedMessage = (state : State, messageId : CommentMessageID, messages : CommentMessages, authors : AuthorsMap) : ComposedCommentMessage | null => {
	//TODO: return composed children for threads if there are parents
	const originalMessage = messages[messageId];
	if (!originalMessage) return null;
	return {
		...originalMessage,
		expandedAuthor: authorOrDefault(originalMessage.author, authors),
		mayEdit: userMayEditMessage(state, originalMessage)
	};
};

export const selectUserDataIsFullyLoaded = createSelector(
	selectAuthPending,
	selectUserObjectExists,
	selectStarsLoaded,
	selectReadsLoaded,
	selectReadingListLoaded,
	selectUserPermissionsLoaded,
	(pending, userExists, starsLoaded, readsLoaded, readingListLoaded, permissionsLoaded) => {
		if (pending) return false;
		if (!userExists) return true;
		return starsLoaded && readsLoaded && readingListLoaded && permissionsLoaded;
	}
);

export const selectCommentsAreFullyLoaded = createSelector(
	selectThreadsLoaded,
	selectMessagesLoaded,
	(threadsLoaded, messagesLoaded) => threadsLoaded && messagesLoaded
);

//This is different from selectUserPermissionsLoaded because it also takes into
//account whether we're even going to try to load them. Note that there is a
//brief period when the app boots up that this is false but may switch to true.
export const selectUserPermissionsFinal = createSelector(
	selectAuthPending,
	selectUserObjectExists,
	selectUserPermissionsLoaded,
	(pending, userObjectExists, permissionsLoaded) => {
		if (pending) return false;
		if (!userObjectExists) return true;
		return permissionsLoaded;
	}
);

export const selectCardsLoaded = createSelector(
	selectUserPermissionsFinal,
	selectLoadingCardFetchTypes,
	(permissionsFinal, fetchTypes) => permissionsFinal && Object.keys(fetchTypes).length == 0
);

export const selectSectionsAndTagsLoaded = createSelector(
	selectSectionsLoaded,
	selectTagsLoaded,
	(sectionsLoaded, tagsLoaded) => sectionsLoaded && tagsLoaded
);

//DataIsFullyLoaded returns true if we've loaded all of the card/section
//information we're going to load.
export const selectDataIsFullyLoaded = createSelector(
	selectCardsLoaded,
	selectSectionsLoaded,
	selectTagsLoaded,
	selectUserDataIsFullyLoaded,
	(cardsLoaded, sectionsLoaded, tagsLoaded, userDataLoaded) => cardsLoaded && sectionsLoaded && tagsLoaded && userDataLoaded
);

export const selectActivePreviewCard = createSelector(
	selectCards,
	selectActivePreviewCardId,
	(cards, activeCardId) => cards[activeCardId] || null
);

export const selectActiveCardTodosForCurrentUser = createSelector(
	selectUserMayEditActiveCard,
	selectActiveCard,
	(userMayEditCard, card) => userMayEditCard ? cardTODOConfigKeys(card, false) : []
);

export const selectActiveCardTweets = createSelector(
	selectActiveCard,
	selectTweets,
	(card, tweets) => Object.fromEntries(Object.entries(tweets).filter(entry => entry[1].card == (card ? card.id : '')))
);

//selectEditingCardAutoTodos will opeate on not the actual filter set, but one
//that has been updated with the current editingCard values.
export const selectEditingCardAutoTodos = createSelector(
	selectEditingCard,
	(card) => card ? cardTODOConfigKeys(card, true) : []
);

//Map of filterName -> filterDescription for all legal filter-names (normal and configurable)
export const selectFilterDescriptions = createSelector(
	selectSections,
	selectTags,
	(sections, tags) => {
		return {
			...CARD_FILTER_DESCRIPTIONS,
			...Object.fromEntries(Object.entries(sections).map(entry => [entry[0], 'Matches cards in the ' + entry[1].title + ' section'])),
			...Object.fromEntries(Object.entries(tags).map(entry => [entry[0], 'Matches cards in the ' + entry[1].title + ' tag'])),
		};
	}
);

export const selectActiveCollectionDescription = createSelector(
	selectActiveSetName,
	selectActiveFilterNames,
	selectActiveSortName,
	selectActiveSortReversed,
	selectActiveViewMode,
	selectActiveViewModeExtra,
	(setName, filterNames, sortName, sortReversed, viewMode, viewModeExtra) => new CollectionDescription(setName, filterNames, sortName, sortReversed, viewMode, viewModeExtra)
);

//This means htat the active section is the only one showing. See also
//selectActiveCardSelection, which just returns the section name of the
//current collection. selectActiveTagId is the analogue for tags.
export const selectActiveSectionId = createSelector(
	selectActiveCollectionDescription,
	selectSections,
	(collectionDescription, sections) => {
		//The activeSectionId is only true if it's the default set and there
		//is precisely one filter who is also a set.
		if(collectionDescription.set != 'main') return '';
		if (collectionDescription.filters.length != 1) return '';
		return sections[collectionDescription.filters[0]] ? collectionDescription.filters[0] : '';
	}
);

//Only true if there is actually an active section to edit--that is, a singluar section.
const selectUserMayEditActiveSection = createSelector(
	selectState,
	selectActiveSectionId,
	(state, sectionID) => sectionID != '' && getUserMayEditSection(state, sectionID)
);

export const selectActiveCollectionCardTypeToAdd = createSelector(
	selectActiveCollectionDescription,
	(collectionDescription) : CardType => {
		if (collectionDescription.set != 'everything') return DEFAULT_CARD_TYPE;
		if (collectionDescription.filters.length != 1) return DEFAULT_CARD_TYPE;
		//Note: we aren't sure that the first filter is a CardType, but it's
		//safe to try because we're just using it to index.
		const possibleCardType = collectionDescription.filters[0] as CardType;
		const cardTypeConfig = CARD_TYPE_CONFIGURATION[possibleCardType];
		if (!cardTypeConfig) return DEFAULT_CARD_TYPE;
		//Working notes already has its own button
		if (possibleCardType === cardTypeFilter('working-notes')) return DEFAULT_CARD_TYPE;
		if (!cardTypeConfig.orphanedByDefault) return DEFAULT_CARD_TYPE;
		return possibleCardType as CardType;
	}
);

//Whether or not, if the user chose to add a card to the current collection, it
//would work. This is true if the card type is content and the user may edit the
//active section, OR it's the everything set with a single filter, for a card
//type that is orphaned by default.
export const selectUserMayAddCardToActiveCollection = createSelector(
	selectUserMayEditActiveSection,
	selectActiveCollectionCardTypeToAdd,
	(userMayEditActiveSection, cardTypeToAdd) => {
		if (userMayEditActiveSection) return true;
		return cardTypeToAdd !== DEFAULT_CARD_TYPE;
	}
);

export const selectExpandedTabConfig = createSelector(
	selectSections,
	selectTags,
	(sections, tags) => tabConfiguration(TAB_CONFIGURATION, TAB_OVERRIDES_CONFIGURATION, sections, tags)
);

//The CollectionDescription to load up if not provided one
export const selectDefaultCollectionDescription = createSelector(
	selectExpandedTabConfig,
	selectSectionsAndTagsLoaded,
	(tabConfig, sectionsAndTagsLoaded) => {
		for (const tab of tabConfig) {
			if (tab.default) return tab.expandedCollection;
		}
		//If everything is laoded and we still don't have one, just navigate to
		//the first tab item with a set collection description
		if (sectionsAndTagsLoaded) {
			for (const tab of tabConfig) {
				if (tab.collection) return tab.expandedCollection;
			}
			//Well, just return the default collection description I guess?
			return new CollectionDescription();
		}
		//there might not be one marked default if sections hasn't loaded.
		return null;
	}
);

export const selectTabCollectionFallbacks = createSelector(
	selectExpandedTabConfig,
	selectSlugIndex,
	(config : ExpandedTabConfig, slugIndex : {[slug : Slug] : CardID}) : {[collectionDescription : string] : CardID[]} => {
		const result : {[collectionDescription : string] : CardID[]} = {};
		for (const item of config) {
			if (!item.fallback_cards) continue;
			result[item.expandedCollection.serialize()] = item.fallback_cards.map(idOrSlug => slugIndex[idOrSlug] || idOrSlug);
		}
		return result;
	}
);

export const selectTabCollectionStartCards = createSelector(
	selectExpandedTabConfig,
	selectSlugIndex,
	(config : ExpandedTabConfig, slugIndex :{[slug: Slug] : CardID} ) : {[collectionDescription : string] : CardID[]} => {
		const result : {[collectionDescription : string] : CardID[]} = {};
		for (const item of config) {
			if (!item.start_cards) continue;
			result[item.expandedCollection.serialize()] = item.start_cards.map(idOrSlug => slugIndex[idOrSlug] || idOrSlug);
		}
		return result;
	}
);

export const selectLastSectionID = createSelector(
	selectSections,
	(sections) => {
		const entries = Object.entries(sections);
		if (!entries.length) return '';
		const lastEntry = entries[entries.length - 1];
		return lastEntry[0];
	}
);

//selectActiveTagId returns a string IFF precisely one tag is being selected.
//Analogue of selectActiveSectionId.
export const selectActiveTagId = createSelector(
	selectActiveCollectionDescription,
	selectTags,
	(collectionDescription, tags) => {
		//The activeSectionId is only true if it's the default set and there
		//is precisely one filter who is also a set.
		if( collectionDescription.set != 'main') return '';
		if (collectionDescription.filters.length != 1) return '';
		return tags[collectionDescription.filters[0]] ? collectionDescription.filters[0] : '';
	}
);

export const selectDefaultSet = createSelector(
	selectSections,
	selectRawCards,
	(sections : Sections, cards : Cards) : CardID[] => {
		let result : CardID[] = [];
		for (const section of Object.values(sections)) {
			result = result.concat(section.cards);
		}
		//The order of cards in the section object is nondterministic. The order
		//that matters is the sort_order. Higher sort-order should sort to the top.
		result.sort((a,b) => {
			const cardAValue = cards[a] ? cards[a].sort_order : 0.0;
			const cardBValue = cards[b] ? cards[b].sort_order : 0.0;
			return cardBValue - cardAValue;
		});
		return result;
	}
);

const makeEverythingSetFromCards = (cards : Cards) : CardID[] => {
	const keys = Object.keys(cards);
	keys.sort((a, b) => {
		const cardAValue = cards[a] ? cards[a].sort_order : 0.0;
		const cardBValue = cards[b] ? cards[b].sort_order : 0.0;
		return cardBValue - cardAValue;
	});
	return keys;
};

//Note; other selectors depend on this being sorted based on descending sort_order
export const selectEverythingSet = createSelector(
	selectCards,
	makeEverythingSetFromCards,
);

const selectEverythingSetSnapshot = createSelector(
	selectCardsSnapshot,
	makeEverythingSetFromCards,
);

type SetCollection = {
	[set in SetName]: CardID[]
};

const selectAllSets = createSelector(
	selectDefaultSet,
	selectUserReadingList,
	selectEverythingSet,
	(defaultSet, readingListSet, everythingSet) => {
		const result : SetCollection = {
			'main': defaultSet,
			'reading-list': readingListSet,
			'everything': everythingSet,
		};
		return result;
	}
);

//The sets to use based on the snapshot. We don't override default, because
//default's order is set by the user, so the only time it changed is if the user
//wanted it to change.
const selectSetsSnapshot = createSelector(
	selectAllSets,
	selectEverythingSetSnapshot,
	selectUserReadingListSnapshot,
	(allSets, everythingSetSnapshot, readingListSet) => {
		const result : SetCollection = {
			...allSets, 
			'everything': everythingSetSnapshot,
			'reading-list': readingListSet,
		};
		return result;
	}
);


//Returns a map of cardID -> sorted order in the global order
export const selectSortOrderIndexByCard = createSelector(
	selectEverythingSet,
	(sortedCardIDs : CardID[]) : {[id : CardID] : number} => {
		const result : {[id : CardID] : number} = {};
		let index = 0;
		for (const id of sortedCardIDs) {
			result[id] = index;
			index++;
		}
		return result;
	}
);

//Returns a map of sortIndex --> cardID for the sorted order
export const selectCardIDBySortOrderIndex = createSelector(
	selectSortOrderIndexByCard,
	(index) => Object.fromEntries(Object.entries(index).map(entry => [entry[1], entry[0]]))
);

//Gets the sort_order to put another card adjacent to the given cardID in the
//full set. It finds the next card in the evertyhing set and puts it halfway
//between. By default it adds it after the given card, but if before is true it
//will add it before.
export const getSortOrderImmediatelyAdjacentToCard = (state : State, cardID : CardID, before : boolean) => {
	const sortIndexByCard = selectSortOrderIndexByCard(state);
	const cardIDbySortIndex = selectCardIDBySortOrderIndex(state);
	const cards = selectRawCards(state);
	const card = cards[cardID];
	const numCards = Object.keys(cards).length;
	let keyCardIndex = sortIndexByCard[cardID];
	keyCardIndex += (before ? -1.0 : 1.0);
	if (keyCardIndex < 0) return card.sort_order - DEFAULT_SORT_ORDER_INCREMENT;
	if (keyCardIndex >= numCards) return card.sort_order + DEFAULT_SORT_ORDER_INCREMENT;
	const nextCardID = cardIDbySortIndex[keyCardIndex];
	const nextCard = cards[nextCardID];
	//Return halfway between the two cards.
	return (card.sort_order + nextCard.sort_order) / 2;
};

//Returns the lowest sort order known to be currently in use by cards in this
//set. This may be incorrect if there are unloaded cards.
export const selectLowestSortOrder = createSelector(
	selectEverythingSet,
	selectRawCards,
	(sortedCardIDs, cards) => {
		if (!sortedCardIDs || sortedCardIDs.length == 0) return MIN_SORT_ORDER_VALUE;
		const lowestCardID = sortedCardIDs[sortedCardIDs.length - 1];
		const card = cards[lowestCardID];
		if (!card) return 0.0;
		return card.sort_order;
	}
);

//Returns the highgest sort order known to be currently in use by cards in this
//set. This may be incorrect if there are unloaded cards.
export const selectHighestSortOrder = createSelector(
	selectEverythingSet,
	selectRawCards,
	(sortedCardIDs, cards) => {
		if (!sortedCardIDs || sortedCardIDs.length == 0) return MAX_SORT_ORDER_VALUE;
		const highestCardID = sortedCardIDs[0];
		const card = cards[highestCardID];
		if (!card) return 0.0;
		return card.sort_order;
	}
);

//selects the next sort order to use if you don't care about having it sort in
//front of any cards, just appended after any other card that currently exists.
export const selectSortOrderForGlobalAppend = createSelector(
	selectLowestSortOrder,
	(lowestSortOrder) => lowestSortOrder - DEFAULT_SORT_ORDER_INCREMENT
);

//selects the next sort order to use if you want it to show up in front of any
//existing cards.
export const selectSortOrderForGlobalPrepend = createSelector(
	selectHighestSortOrder,
	(highestSortOrder) => highestSortOrder + DEFAULT_SORT_ORDER_INCREMENT
);

//selectCollectionConstructorArguments returns an array that can be unpacked and
//passed as the arguments to collectionDescription.collection(). It omits the
//optional editingCard, cardsSnapshot, and filtersSnapshot. See also
//selectCollectionConstructorArgumentsWithEditingCard and
//selectCollectionConstructorArgumentsForGhostingCollection.
export const selectCollectionConstructorArguments = createSelector(
	selectCards,
	selectAllSets,
	selectFilters,
	selectSections,
	selectTabCollectionFallbacks,
	selectTabCollectionStartCards,
	selectUid,
	selectRandomSalt,
	selectCardSimilarity,
	selectEditingCardSimilarity,
	(cards, sets, filters, sections, fallbacks, startCards, userID, randomSalt, cardSimilarity, editingCardSimilarity) => ({cards, sets, filters, sections, fallbacks, startCards, userID, randomSalt, cardSimilarity, editingCardSimilarity})
);

//Like selectCollectionConstructorArguments, but for the active collection. The
//active collection also needs selectCardsSnapshot and selectFiltersSnapshot,
//which change more often than most other collections want. If you want to call
//cardsThatWillBeRemoved, you likely want this. For example, actie collection is
//a ghosting one.
export const selectCollectionConstructorArgumentsForGhostingCollection = createSelector(
	selectCollectionConstructorArguments,
	selectCardsSnapshot,
	selectSetsSnapshot,
	selectFiltersSnapshot,
	(args, cardsSnapshot, setsSnapshot, filtersSnapshot) => ({...args, cardsSnapshot, sets: setsSnapshot, filtersSnapshot})
);

//selectCollectionConstructorArgumentsWithEditingCard is like
//selectCollectionConstructorArguments, but it also includes editingCard.
//editingCard can change often while editing (roughly once per keystroke), which
//can slow down the editing experience so it's best to only use this in cases
//where you know it needs to update, like
//selectExpandedInfoPanelReferenceBlocksForEditingOrActiveCard, since you want
//similar cards to update live for the card.
export const selectCollectionConstructorArgumentsWithEditingCard = createSelector(
	selectCollectionConstructorArguments,
	selectEditingNormalizedCard,
	(args, editingCard) => ({...args, editingCard})
);

export const selectFieldValidationErrorsForEditingCard = createSelector(
	selectEditingNormalizedCard,
	(card) :{[field in CardFieldType]+?: string}  => {
		const result : {[field in CardFieldType]+?: string} = {};
		if (!card) return result;
		for (const [field, config] of TypedObject.entries(editableFieldsForCardType(card.card_type))) {
			if (!config.validator) continue;
			result[field] = config.validator(card[field], card.card_type, config);
		}
		return result;
	}
);

export const selectActiveCollection = createSelector(
	selectActiveCollectionDescription,
	selectCollectionConstructorArgumentsForGhostingCollection,
	(description, args) => description ? description.collection(args) : null
);

//Whether they're ALLOWED to edit cards, and whether they're in a collection in
//which reordering is legal. Note: this means that even if it is legal in
//genearl to reorder a collection and the user can modify one card in
//partiuclar, they won't be able to reorder it.
export const selectUserMayReorderActiveCollection = createSelector(
	selectUserMayEditCards,
	selectActiveCollection,
	(userMayEditCards, collection) => Boolean(userMayEditCards && collection && collection.reorderable)
);

export const selectCardsSelected = createSelector(
	selectExplicitlySelectedCardIDs,
	(selected) => Object.keys(selected).length > 0
);

export const selectActiveCollectionNotFullySelected = createSelector(
	selectActiveCollection,
	selectExplicitlySelectedCardIDs,
	(collection, selected) => {
		//If no collection, bail.
		if (!collection) return false;
		//If there's no selection, then bail.
		if (Object.keys(selected).length == 0) return false;
		return !collection.finalSortedCards.every(card => selected[card.id]);
	}
);

//This is effectively: "would it be useful to offer to only filter to selected cards?"
export const selectActiveCollectionNotFilteredToSelected = createSelector(
	selectActiveCollection,
	selectExplicitlySelectedCardIDs,
	(collection, selected) => {
		//If no collection, bail.
		if (!collection) return false;
		//If there's no selection, then bail.
		if (Object.keys(selected).length == 0) return false;
		const every = collection.finalSortedCards.every(card => selected[card.id]);
		//It's effectively filtered to selected if every card is selected.
		if (every) return false;
		if (collection.description.filters.includes(SELECTED_FILTER_NAME)) return false;
		return true;
	}
);

//This is the effective selected cards, which is either the explicitly selected
//cards, or just the active collection if there are no explicitly selected cards.
export const selectSelectedCards = createSelector(
	selectCards,
	selectExplicitlySelectedCardIDs,
	selectActiveCollection,
	(cards, selected, collection) => {
		if (Object.keys(selected).length) return Object.keys(selected).map(id => cards[id]);
		return collection ? collection.filteredCards || [] : [];
	}
);

export const selectSelectedCardsReferencesUnion = createSelector(
	selectSelectedCards,
	(cards) => unionReferences(cards)
);

export const selectSelectedCardsReferencesIntersection = createSelector(
	selectSelectedCards,
	(cards) => intersectionReferences(cards)
);

export const selectSelectedCardsTagsUnion = createSelector(
	selectSelectedCards,
	(cards) => {
		const tags : {[tag : TagID] : true} = {};
		for (const card of cards) {
			for (const tag of card.tags) {
				tags[tag] = true;
			}
		}
		return Object.keys(tags);
	}
);

export const selectSelectedCardsTagsIntersection = createSelector(
	selectSelectedCards,
	(cards) => {
		if (!cards.length) return [];
		const tags : {[tag : TagID] : number} = {};
		for (const card of cards) {
			for (const tag of card.tags) {
				tags[tag] = (tags[tag] || 0) + 1;
			}
		}
		return Object.keys(tags).filter(tag => tags[tag] == cards.length);
	}
);

const selectActiveCollectionWordCloud = createSelector(
	selectActiveCollection,
	selectFingerprintGenerator,
	(collection, fingerprintGenerator) => {
		if (!collection) return null;
		if (!collection.filteredCards) return null;
		const fingerprint = fingerprintGenerator.fingerprintForCardIDList(collection.filteredCards.map(card => card.id));
		return fingerprint.wordCloud();
	}
);

//NOTE: this can be EXTREMELY expensive.
export const selectWordCloudForMainCardDrawer = (state : State) : WordCloud | null => {
	return selectSuggestMissingConceptsEnabled(state) ? selectWordCloudForPossibleMissingConcepts(state) : selectActiveCollectionWordCloud(state);
};

export const selectCountsForTabs = createSelector(
	selectExpandedTabConfig,
	selectCollectionConstructorArguments,
	(tabs : ExpandedTabConfig, args : CollectionConstructorArguments) : {[tabDescription : string] : number} => {
		const result : {[tabDescription : string] : number} = {};
		for (const tab of tabs) {
			//hideIfEmpty also requires calculating count
			if (!tab.count && !tab.hideIfEmpty) continue;
			result[tab.expandedCollection.serialize()] = tab.expandedCollection.collection(args).numCards;
		}
		return result;
	}
);

//The cardsDrawerPanel hides itself when there are no cards to show (that is,
//for orphaned cards). This is the logic that decides if it's open based on state.
export const selectCardsDrawerPanelShowing = createSelector(
	selectActiveCollection,
	selectCardsDrawerPanelOpen,
	selectIsEditing,
	selectEditorMinimized,
	(activeCollection, panelOpen, isEditing, editorMinimized) => (isEditing && editorMinimized) ? false : !activeCollection || activeCollection.isFallback ? false : panelOpen
);

//This is the final expanded, sorted collection, including start cards.
export const selectActiveCollectionCards = createSelector(
	selectActiveCollection,
	(collection) => collection ? collection.finalSortedCards : []
);

export const selectActiveCardIndex = createSelector(
	selectActiveCardID,
	selectActiveCollectionCards,
	(cardId, collection) => collection.map(card => card.id).indexOf(cardId)
);

export const getCardIndexForActiveCollection = (state : State, cardId: CardID) : number => {
	const collection = selectActiveCollectionCards(state);
	return collection.map(card => card.id).indexOf(cardId);
};

//returns an array of card-types that are in the BODY_CARD_TYPES that this user has access to
const selectBodyCardTypes = createSelector(
	selectFilters,
	//we can just take advantage of the fact that cards are already set, and there's a filter per card type
	(filters) : CardType[] => (Object.keys(BODY_CARD_TYPES) as CardType[]).filter(cardType => Object.keys(filters[cardType] || {}).length > 0)
);

export const selectFindLegalCardTypeFilters = createSelector(
	selectBodyCardTypes,
	selectFindCardTypeFilter,
	//'' stands for 'no filter' and will show up as 'Default'
	//findCardTypeFilter, whatever it is, needs to show up, since it's 'selected'
	//The set thing makes sure we don't have duplicates
	(bodyCardTypes, findCardTypeFilter) : CardType[] => [... new Set(['', ...bodyCardTypes, findCardTypeFilter])] as CardType[]
);

//Whether the find dialog is open generically
const selectFindGeneric = createSelector(
	selectFindReferencing,
	selectFindLinking,
	selectFindPermissions,
	(referencing, linking, permissions) => !referencing && !linking && !permissions
);

export const selectCollectionDescriptionForQuery = createSelector(
	selectActiveQueryText,
	selectFindCardTypeFilter,
	selectFindSortByRecent,
	selectActiveCardID,
	selectFindGeneric,
	(queryText, cardTypeFilter, sortByRecent, cardID, generic) => {
		const wordsAndFilters = extractFiltersFromQuery(queryText);
		const baseFilters = ['has-body'];
		let sort : SortName = 'default';
		if (cardID && !generic) baseFilters.push(excludeFilter(cardsFilter(cardID)));
		if (cardTypeFilter) baseFilters.push(cardTypeFilter);
		if (!wordsAndFilters[0] && !wordsAndFilters[1].length) {
			if (generic) {
				//If it's a generic search, we don't want similar cards to
				//current card (which might be a boring section title card), we
				//just want recent cards.
				sort = 'recent';
			} else {
				//If it's a search to find a card to link etc we do want it to
				//be related to the card we're on.
				baseFilters.push(similarFilter(cardID));
			}
			baseFilters.push(limitFilter(10));
			//If there's no query, return the similar cards to the current card
			return new CollectionDescription('everything', baseFilters, sort);
		}
		const query = queryFilter(wordsAndFilters[0]);
		return new CollectionDescription('everything',[...baseFilters, query, ...wordsAndFilters[1]], sortByRecent ? 'recent' : 'default');
	}
);

export const selectCollectionForQuery = createSelector(
	selectCollectionDescriptionForQuery,
	selectCollectionConstructorArgumentsWithEditingCard,
	(description, args) : Collection => description.collection(args)
);

export const selectExpandedPrimaryReferenceBlocksForEditingOrActiveCard = createSelector(
	selectEditingOrActiveNormalizedCard,
	selectCollectionConstructorArgumentsWithEditingCard,
	selectCardIDsUserMayEdit,
	(card, args, cardIDsUserMayEdit) : ExpandedReferenceBlocks => getExpandedPrimaryReferenceBlocksForCard(args, card, cardIDsUserMayEdit)
);

export const selectExpandedPrimaryReferenceBlocksForPreviewCard = createSelector(
	selectActivePreviewCard,
	selectCollectionConstructorArguments,
	selectCardIDsUserMayEdit,
	(card, args, cardIDsUserMayEdit) : ExpandedReferenceBlocks => getExpandedPrimaryReferenceBlocksForCard(args, card, cardIDsUserMayEdit)
);

export const selectExpandedInfoPanelReferenceBlocksForEditingOrActiveCard = createSelector(
	selectEditingOrActiveNormalizedCard,
	selectCollectionConstructorArgumentsWithEditingCard,
	selectCardIDsUserMayEdit,
	(card, args, cardIDsUserMayEdit) : ExpandedReferenceBlocks => {
		const blocks = infoPanelReferenceBlocksForCard(card);
		if (blocks.length == 0) return [];
		//reference-block will hide any ones that shouldn't render because of an empty collection so we don't need to filter
		return expandReferenceBlocks(card, blocks, args, cardIDsUserMayEdit);
	}
);

export const selectSuggestionsOpen = createSelector(
	selectIsEditing,
	selectSuggestionsRawOpen,
	(editing, suggestionsOpen) => !editing && suggestionsOpen
);

export const selectSuggestionsForActiveCard = createSelector(
	selectActiveCard,
	selectSuggestionsForCards,
	(card, suggestionsForCard) => suggestionsForCard[card?.id || ''] || []
);

//This is useful because the selectedIndex might be larger than the number of
//suggestions, and this clips it.
export const selectSuggestionsEffectiveSelectedIndex = createSelector(
	selectSuggestionsForActiveCard,
	selectSuggestionsSelectedIndex,
	(suggestions, rawIndex) => rawIndex < suggestions.length ? rawIndex : suggestions.length - 1
);

export const selectMultiEditCardDiff = createSelector(
	selectMultiEditReferencesDiff,
	selectMultiEditAddTags,
	selectMultiEditRemoveTags,
	selectMultiEditAddTODOEnablements,
	selectMultiEditAddTODODisablements,
	(referencesDiff, addTags, removeTags, todoEnablements, todoDisablements) => {
		const result : CardDiff = {};
		if (referencesDiff.length) result.references_diff = referencesDiff;
		if (addTags.length) result.add_tags = addTags;
		if (removeTags.length) result.remove_tags = removeTags;
		if (todoEnablements.length) result.auto_todo_overrides_enablements = todoEnablements;
		if (todoDisablements.length) result.auto_todo_overrides_disablements = todoDisablements;
		return result;
	}
);

export const selectBulkImportDialogExportContent = createSelector(
	selectBulkImportDialogOpen,
	selectBulKimportDialogMode,
	selectBulkImportDialogOverrideCardOrder,
	selectActiveCollectionCards,
	(open, mode, cardOrder, cards) => {
		if (!open || mode != 'export') return '';
		let finalCards = cards;
		if (cardOrder) {
			const allCards = Object.fromEntries(cards.map(card => [card.id, card]));
			finalCards = cardOrder.map(id => allCards[id]);
		}
		return exportContentForCards(finalCards);
	}
);
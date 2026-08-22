import { createSelector } from 'reselect';

import {
	perfCount,
	perfEnabled
} from './perf.js';

import {
	URLDiagnostic
} from '../shared/url-diagnostics.js';

import {
	stickySearchFilterComponents
} from './sticky-search-filters.js';

import {
	createCardsDiffSelector,
	diffCards,
	anyCardMatches,
	anyChangedCardDiffers,
	membershipChanged,
	isConceptCard,
	arraysEqual
} from './incremental-selectors.js';

import {
	lazyProcessCards
} from './card-processing.js';

import {
	CORPUS_STATUS_BLOCKS_INTERACTION
} from './corpus-readiness.js';

import {
	computeDefaultSet,
	makeEverythingSetFromCards,
	existingCardsOnly
} from './set-projections.js';

import {
	createObjectSelector,
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
	SELECTED_FILTER_NAME,
	INVERSE_FILTER_NAMES,
	CONFIGURABLE_FILTER_NAMES,
	UNION_FILTER_DELIMITER as FILTER_UNION_DELIMITER
} from './filters.js';

import {
	relativeDateCacheKey,
} from './relative-date.js';

import {
	Collection,
	CollectionDescription,
	countForDescription,
	descriptionRequiresFullCollectionCount,
	defaultCollectionConfiguration
} from './collection_description.js';

import {
	corpusWorkerOwnsCardIngestion,
	corpusWorkerServesCollections
} from './corpus-mode.js';

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
} from '../shared/card_fields.js';

import {
	references,
	unionReferences,
	intersectionReferences
} from './references.js';

import {
	Fingerprint,
	FingerprintGenerator,
	PENDING_IDF_MAP,
	extractFiltersFromQuery,
	emptyWordCloud,
	cardWithNormalizedTextProperties,
	enrichCardWithConcepts,
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
	OPENAI_ENABLED,
	ANTHROPIC_ENABLED
} from './config.GENERATED.SECRET.js';

import {
	SetName,
	SortName,
	CollectionConfiguration,
	ComposedChats
} from '../shared/types.js';

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
	AIDialogType,
	AIModelName,
	ReferenceType,
	SortExtra,
	CardDiff,
	Filters,
	CardFetchType
} from './types.js';

import {
	exportContentForCards
} from './contenteditable.js';

import {
	TypedObject
} from '../shared/typed_object.js';

import {
	Timestamp
} from 'firebase/firestore';

import {
	FIELD_VALIDATORS
} from './card_methods.js';

import {
	PAGE_DEFAULT
} from './actions/app.js';

const selectState = (state : State) : State => state;

export const selectPage = (state : State) => state.app.page;
export const selectPageExtra = (state : State) => state.app.pageExtra;
export const selectFetchedCard = (state : State) => state.app.fetchedCard;
export const selectCardBeingFetched = (state : State) => state.app.cardBeingFetched;
export const selectCardsDrawerInfoExpanded = (state : State) => state.app.cardsDrawerInfoExpanded;
export const selectConfigureCollectionDialogOpen = (state : State) => state.app ? state.app.configureCollectionDialogOpen : false;
export const selectCollectionWordCloudVersion = (state : State) => state.collection ? state.collection.collectionWordCloudVersion : 0;
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
export const selectMultiEditPublished = (state : State) => state.multiedit ? state.multiedit.published : null;

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
export const selectAIModel = (state : State) : AIModelName => state.ai ? state.ai.model : 'claude-4-sonnet';

export const selectCommentsAndInfoPanelOpen = (state : State) => state.app ? state.app.commentsAndInfoPanelOpen : false;

export const selectChats = (state : State) => state.chat ? state.chat.chats : {};
export const selectChatMessages = (state : State) => state.chat ? state.chat.messages : {};
export const selectChatsLoading = (state : State) => state.chat ? state.chat.chatsLoading : false;
export const selectChatMessagesLoading = (state : State) => state.chat ? state.chat.chatMessagesLoading : false;
export const selectCurrentChatID = (state : State) => state.chat ? state.chat.currentChat : '';
export const selectChatComposingMessage = (state : State) => state.chat ? state.chat.composingMessage : '';
export const selectChatSending = (state : State) => state.chat ? state.chat.sending : false;
export const selectChatSendFailure = (state : State) => state.chat ? state.chat.sendFailure : null;

export const selectImagePropertiesDialogOpen = (state : State) => state.editor ? state.editor.imagePropertiesDialogOpen : false;
export const selectImagePropertiesDialogIndex = (state : State) => state.editor ? state.editor.imagePropertiesDialogIndex : 0;
export const selectImageBrowserDialogOpen = (state : State) => state.editor ? state.editor.imageBrowserDialogOpen : false;
//undefined signals to add to end
export const selectImageBrowserDialogIndex = (state : State) => state.editor ? state.editor.imageBrowserDialogIndex : undefined;

export const selectActiveRenderOffset = (state : State) => state.collection ? state.collection.activeRenderOffset : 0;
const selectActiveCollectionConfiguration = (state : State) : CollectionConfiguration => state.collection ? state.collection.active : defaultCollectionConfiguration();
const selectSnapshotCollectionConfiguration = (state : State) : CollectionConfiguration | null => state.collection ? state.collection.snapshot : null;
export const selectRequestedCard = (state : State) => state.collection? state.collection.requestedCard : '';
export const selectActiveCardID = (state : State) => state.collection ? state.collection.activeCardID : '';
export const selectExplicitlySelectedCardIDs = (state : State) => state.collection ? state.collection.selectedCards : {};
export const selectRandomSalt = (state : State) => state.collection ? state.collection.randomSalt : '';
//Note that the editing card doesn't have nlp/normalized text properties set. If
//you want the one with that, look at selectEditingNormalizedCard.
export const selectEditingCard = (state : State) => state.editor ? state.editor.card : null;
//The committed-but-unconfirmed draft of a single-card save (see
//EditorState.pendingSaveCard). Raw; most callers want
//selectPendingSaveCardForDisplay.
export const selectPendingSaveCard = (state : State) => state.editor ? state.editor.pendingSaveCard : null;
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
export const selectPendingDeletions = (state : State) => state.data ? state.data.pendingDeletions : {};
export const selectEnqueuedCards = (state : State) => state.data ? state.data.enqueuedCards : {};
export const selectPendingModificationCount = (state : State) => state.data ? state.data.pendingModificationCount : 0;
export const selectPendingModificationCardIDs = (state : State) => state.data ? state.data.pendingModificationCardIDs : {};
export const selectCardModificationPending = (state : State) => state.data ? state.data.pendingModifications : false;
//Per-card refinement of selectCardModificationPending: true only when the
//pending operation targets this specific card. Editing affordances use this
//so a save in flight on one card does not block editor sessions on others
//(#763). A pending operation with no recorded targets (legacy dispatch
//shapes) falls back to blocking, matching the old global behavior.
export const selectCardModificationPendingForCard = (state : State, cardID : CardID) : boolean => {
	if (!state.data || !state.data.pendingModifications) return false;
	const ids = state.data.pendingModificationCardIDs;
	if (ids && ids[cardID]) return true;
	//Empty-set fallback: block everything, matching the old global behavior
	//for legacy dispatch shapes. The emptiness test must be O(1): this
	//selector runs on every store dispatch via card-view.stateChanged, and
	//Object.keys() on a bulk operation's map materializes tens of thousands
	//of strings per call (measured ~5.6ms/call at 60k — a per-dispatch
	//main-thread stall for the life of the operation).
	if (ids) {
		for (const _ in ids) return false;
	}
	return true;
};
export const selectBulkTagOperationProgress = (state : State) => state.data ? state.data.bulkTagOperationProgress : null;
export const selectCardModificationError = (state : State) => state.data ? state.data.cardModificationError : null;
//All cards downloaded to client can be assumed to be OK to use in the rest of the pipeline.
//rawCards means they don't yet have their nlp data cached. See selectCards which returns that.
//This is only exposed so that updateCards can check for dupes directly.
//NOTE: this next one is duplicated in simple_selectors.js
export const selectRawCards = (state : State) => state.data ? state.data.cards : {};
const selectRawCardsSnapshot = (state : State) => state.data ? state.data.cardsSnapshot : {};
export const selectPendingNewCardIDToNavigateTo = (state : State) => state.data ? state.data.pendingNewCardIDToNavigateTo : '';
export const selectLoadingCardFetchTypes = (state : State) => state.data ? state.data.loadingCardFetchTypes : {};
export const selectCorpusStatus = (state : State) => state.data ? state.data.corpusStatus : 'off';
export const selectCorpusStatusMessage = (state : State) => state.data ? state.data.corpusStatusMessage : '';
export const selectCorpusSize = (state : State) => state.data ? state.data.corpusSize : 0;
export const selectCorpusSnapshotAgeMs = (state : State) => state.data ? state.data.corpusSnapshotAgeMs : null;
export const selectExpectedCorpusSize = (state : State) => state.data ? state.data.expectedCorpusSize : null;
export const selectCorpusComplete = (state : State) => state.data ? state.data.corpusComplete : false;
export const selectCorpusVerifyDone = (state : State) => state.data ? state.data.verifyDone : null;
export const selectCorpusVerifyTotal = (state : State) => state.data ? state.data.verifyTotal : null;
export const selectPendingAuxWriteCount = (state : State) => state.data ? state.data.pendingAuxWriteCount : 0;
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
//True while a similarity request for the current draft's content is
//outstanding (issued at the typing settle point, cleared by its own
//version-stamped result), meaning any rendered editing-card similarity is
//known to lag what the user typed. See EditorState.similarityPendingVersion.
export const selectEditingSimilarityPending = (state : State) : boolean => Boolean(state.editor && state.editor.editing && state.editor.similarityPendingVersion !== 0);
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
//Both of these only depend on concept cards; the diff projection means a
//non-concept-card update neither recomputes them nor changes their identity
//(which previously re-ran downstream fingerprint/enrichment selectors on
//every card edit).
const selectRawConceptCards = createSelector(
	selectRawCards,
	createCardsDiffSelector({
		name: 'conceptCards',
		needsRecompute: delta => anyCardMatches(delta, isConceptCard),
		compute: (cards) => conceptCardsFromCards(cards)
	})
);

export const selectSynonymMap = createSelector(
	selectRawCards,
	createCardsDiffSelector({
		name: 'synonymMap',
		needsRecompute: delta => anyCardMatches(delta, isConceptCard),
		compute: (cards) => synonymMap(cards)
	})
);

//selectConcepts returns a map of all concepts based on visible concept cards.
export const selectConcepts = createSelector(
	selectRawConceptCards,
	(conceptCards) => getConceptsFromConceptCards(conceptCards)
);

// Per-card processing cache keyed on the Card object reference from Redux.
// When Redux updates a card, it creates a new Card object — the old one's
// cache entry becomes unreachable and is garbage-collected by WeakMap.
// When selectRawCards changes (any card update), we iterate all entries but
// only reprocess the cards whose object reference actually changed.
// This replaces the old reselect-map chain (selectBackportTextFallbackMapCollection
// → selectZippedCardAndFallbackMap → createZippedObjectSelector) which cleared
// ALL 40k per-key caches on every card change, causing 600ms+ of blocking work.
export const selectCards : (state : State) => ProcessedCards = createSelector(
	selectRawCards,
	lazyProcessCards
);

const selectCardsSnapshot : (state : State) => ProcessedCards = createSelector(
	selectRawCardsSnapshot,
	lazyProcessCards
);

export const selectAuthorAndCollaboratorUserIDs = createSelector(
	selectRawCards,
	createCardsDiffSelector({
		name: 'authorsAndCollaborators',
		needsRecompute: delta => anyChangedCardDiffers(delta, (prev, next) => prev.author !== next.author || !arraysEqual(prev.collaborators, next.collaborators)),
		compute: (rawCards : Cards) : Uid[] => {
			const ids : {[id : Uid] : true} = {};
			for (const card of Object.values(rawCards)) {
				ids[card.author] = true;
				for (const collaborator of card.collaborators) {
					ids[collaborator] = true;
				}
			}
			return Object.keys(ids);
		}
	})
);

export const selectActiveCard = createSelector(
	selectCards,
	selectActiveCardID,
	(cards : ProcessedCards, activeCard : CardID ) : ProcessedCard | null => cards[activeCard] || null
);

//selectActiveCardEnriched returns the active card enriched with real
//importantNgrams and synonymMap, so concept highlighting works correctly.
//This only enriches a single card (the active one), not all 40k.
export const selectActiveCardEnriched = createSelector(
	selectActiveCard,
	selectConcepts,
	selectSynonymMap,
	(card, concepts, synonyms) : ProcessedCard | null => card ? enrichCardWithConcepts(card, concepts, synonyms) : null
);

//True when the ownership gate is showing its modal overlay. Keyboard shortcuts
//must be suppressed then: `inert` does not stop document-level keydown
//listeners, so the bare-key bindings (arrows, Space) and the modified ones
//(Cmd-E, Cmd-F, Cmd-Enter, Cmd-M) all still fired behind the overlay — worst
//in an 'inactive' tab, whose store has already been purged.
export const selectCorpusGateBlocking = createSelector(
	selectCorpusStatus,
	(corpusStatus) => CORPUS_STATUS_BLOCKS_INTERACTION.has(corpusStatus)
);

//Every modal main-view renders must suppress the keyboard shortcuts, not just
//the three modals that were originally listed. dialog-element's Escape handler
//does not stopPropagation, so a keystroke aimed at a multi-edit <select>
//(type-ahead) or the bulk-import textarea reached main-view's handler too.
//The sharpest instance of that was bare `e`, which both preventDefault()ed the
//key AND opened the card editor behind the still-open modal; `e` has since
//(2026-08-02, `8816340a`) been made modifier-gated at the binding itself, but
//the general hazard is unchanged for the bindings that are still bare —
//arrows and Space — so this gate stays the load-bearing one.
export const selectKeyboardNavigates = createSelector(
	selectIsEditing,
	selectFindDialogOpen,
	selectComposeOpen,
	selectPage,
	selectMultiEditDialogOpen,
	selectConfigureCollectionDialogOpen,
	selectBulkImportDialogOpen,
	selectAIDialogOpen,
	selectImagePropertiesDialogOpen,
	selectImageBrowserDialogOpen,
	selectCorpusGateBlocking,
	(editing, find, compose, page, multiEdit, configureCollection, bulkImport, ai, imageProperties, imageBrowser, gateBlocking) =>
		!editing && !find && !compose && page == PAGE_DEFAULT &&
		!multiEdit && !configureCollection && !bulkImport && !ai && !imageProperties && !imageBrowser &&
		!gateBlocking
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
	//TODO: note this logic is technically wrong; some uses of this selector use it to see if they can rely on semantic embeddings, which is only OPENAI, not anthropic.
	(admin, permissions) => (OPENAI_ENABLED || ANTHROPIC_ENABLED) && (admin || permissions[PERMISSION_REMOTE_AI] || false)
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
	//Permission checks use only raw card fields. Feeding the lazy processed-card
	//view here still forced processing every card because createObjectSelector
	//enumerates the entire map during each corpus install.
	selectRawCards,
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
	//This projection reads only card.permissions. Using selectCards caused a
	//40k-card processed-map enumeration during warm boot for no semantic gain.
	selectRawCards,
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

export const selectWorkerIDF = (state : State) => state.data.workerIDF;

// Convert WorkerIDFData to IDFMap format if available. Its own selector so
// the wrapper object keeps IDENTITY across generator rebuilds — the
// generator's shared fingerprint cache is keyed on the IDF map object, so a
// fresh wrapper per rebuild would silently defeat it. (The worker map is
// frozen per epoch precisely so this identity — and with it the cache —
// lives for the whole session.)
//
// Before the worker's first epoch delivery, worker modes get the
// PENDING_IDF_MAP sentinel (TF-only ranking) rather than null: null would
// make FingerprintGenerator run a synchronous whole-corpus IDF build on the
// UI thread, the multi-second stall the worker index exists to remove. Off
// mode returns null and keeps the local small-corpus computation.
const selectWorkerIDFMap = createSelector(
	selectWorkerIDF,
	(workerIDF) => workerIDF ? {
		idf: workerIDF.idf,
		maxIDF: workerIDF.maxIDF
	} : (corpusWorkerOwnsCardIngestion() ? PENDING_IDF_MAP : null)
);

export const selectFingerprintGenerator = createSelector(
	selectCards,
	selectWorkerIDFMap,
	selectConcepts,
	selectSynonymMap,
	(cards, idfMap, concepts, synonyms) => new FingerprintGenerator(cards, undefined, undefined, idfMap, concepts, synonyms)
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
export const selectEditingNormalizedCard = (state : State) : ProcessedCard | undefined => {
	const extractionVersion = selectEditingCardExtractionVersion(state);
	if (memoizedEditingNormalizedCardExtractionVersion != extractionVersion) {
		memoizedEditingNormalizedCard = undefined;
	}
	//null is a totally legal value to have, so we signal we need a recalculation via undefined.
	if (memoizedEditingNormalizedCard === undefined) {
		const start = performance.now();
		//Note: this processing logic should be the same as selectCards processing.
		const editingCard = selectEditingCard(state);
		if (editingCard) {
			const cards = selectRawCards(state);
			const fallbackMap = backportFallbackTextMapForCard(editingCard, cards);
			// Keep editing normalization cheap. Suggested concepts use the global
			// concept map as a lookup after tokenizing the card; attaching every
			// concept as importantNgrams here makes semantic word counting scan
			// the full concept set against the editing text.
			//Full enrichment (concepts + synonyms), exactly like master: this
			//only re-runs on the ~1s extraction-version debounce, never per
			//keystroke, and empty maps made similar-card ranking and semantic
			//word counts diverge from the saved card's (regression sweep).
			memoizedEditingNormalizedCard = cardWithNormalizedTextProperties(editingCard, fallbackMap || {}, selectConcepts(state), selectSynonymMap(state));
		} else {
			memoizedEditingNormalizedCard = undefined;
		}
		const duration = performance.now() - start;
		//Gated like everything else in src/perf.ts. This sits on the editing
		//path and logged unconditionally in production builds.
		if (duration > 50 && perfEnabled()) console.log(`[PERF] selectEditingNormalizedCard: ${duration.toFixed(1)}ms`);
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

export const selectEditingCardForDisplay = createSelector(
	selectEditingCard,
	selectActiveCard,
	selectEditingNormalizedCard,
	(editing, active, normalized) => {
		if (!editing) return null;
		if (!active) return editing;
		//Prefer the freshly normalized editing card's NLP (updated on the ~1s
		//extraction debounce) so display-derived features track typing instead
		//of freezing at the last save; the active card is only the fallback
		//before the first normalization lands.
		return {
			...active,
			...editing,
			nlp: normalized?.nlp || active.nlp,
			importantNgrams: normalized?.importantNgrams || active.importantNgrams,
			synonymMap: normalized?.synonymMap || active.synonymMap
		};
	}
);

//The optimistic face for a committed-but-unconfirmed single-card save: the
//draft the user just saved, merged over the active card the same way
//selectEditingCardForDisplay merges before the first normalization lands (the
//active card's nlp/importantNgrams/synonymMap are the display fallback; the
//pending window is sub-second in the common case). Non-null only while the
//durable executor is between accepting the save and the server settling it,
//and only for the card the save belongs to — navigate away and the overlay
//simply doesn't apply.
export const selectPendingSaveCardForDisplay = createSelector(
	selectPendingSaveCard,
	selectActiveCardEnriched,
	(pending, active) : ProcessedCard | null => {
		if (!pending) return null;
		if (!active || active.id !== pending.id) return null;
		return {
			...active,
			...pending,
			nlp: active.nlp,
			importantNgrams: active.importantNgrams,
			synonymMap: active.synonymMap
		};
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
	selectFingerprintGenerator,
	(card, cardFingerprint, tagFingerprints, fingerprintGenerator) => {
		if (!card || Object.keys(card).length == 0) return [];
		if (!tagFingerprints || Object.keys(tagFingerprints).length == 0) return [];
		const closestTags = fingerprintGenerator.closestOverlappingItems('', cardFingerprint, tagFingerprints);
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
//active card (enriched with concepts so fingerprinting and highlighting work).
const selectEditingOrActiveNormalizedCard = createSelector(
	selectEditingNormalizedCard,
	selectActiveCardEnriched,
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
	selectRawCards,
	createCardsDiffSelector({
		name: 'allCardsFilter',
		needsRecompute: membershipChanged,
		compute: (cards) => Object.fromEntries(Object.entries(cards).map(entry => [entry[0], true] as [CardID, true]))
	})
);

//selectTagInfosForCards selects a tagInfos map based on all cards. Used for
//example for showing missing link auto todos in card-editor.
export const selectTagInfosForCards = createSelector(
	selectRawCards,
	createCardsDiffSelector({
		name: 'tagInfosForCards',
		needsRecompute: delta => anyChangedCardDiffers(delta, (prev, next) => prev.name !== next.name),
		compute: cards => Object.fromEntries(Object.entries(cards).map(entry => [entry[0], {id: entry[0], title:entry[1] ? entry[1].name : '', previewCard: entry[0]}]))
	})
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
	selectActiveCollectionConfiguration,
	(config) => CollectionDescription.withConfiguration(config)
);

export const selectSnapshotCollectionDescription = createSelector(
	selectSnapshotCollectionConfiguration,
	(config) => {
		if (!config) return new CollectionDescription();
		return CollectionDescription.withConfiguration(config);
	}
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

export const selectExpectedCardFetchTypeForNewUnpublishedCard = createSelector(
	selectUserMayViewUnpublished,
	(mayViewUnpublished) : CardFetchType => {
		if (mayViewUnpublished) return 'unpublished';
		//Technically this is only true if we have a uid, but otheriwse there's nothing to fetch anyway.
		return 'unpublished-author';
	}
);

const defaultSetCardsDiffer = (prev : Card, next : Card) : boolean =>
	prev.section !== next.section || prev.sort_order !== next.sort_order;

//Hand-rolled two-input memoizer: recomputes when sections change, but a cards
//change only recomputes if a card's section or sort_order changed.
let _defaultSetState : {sections : Sections, cards : Cards, result : CardID[]} | null = null;

export const selectDefaultSet = createSelector(
	selectSections,
	selectRawCards,
	(sections : Sections, cards : Cards) : CardID[] => {
		if (_defaultSetState && _defaultSetState.sections === sections) {
			const delta = diffCards(_defaultSetState.cards, cards);
			if (!anyChangedCardDiffers(delta, defaultSetCardsDiffer)) {
				perfCount('diffSelector:defaultSet:skipped');
				_defaultSetState = {sections, cards, result: _defaultSetState.result};
				return _defaultSetState.result;
			}
		}
		perfCount('diffSelector:defaultSet:recompute');
		const result = computeDefaultSet(sections, cards);
		_defaultSetState = {sections, cards, result};
		return result;
	}
);

const everythingSetCardsDiffer = (prev : Card, next : Card) : boolean =>
	prev.sort_order !== next.sort_order;

//Note; other selectors depend on this being sorted based on descending sort_order
export const selectEverythingSet = createSelector(
	selectRawCards,
	createCardsDiffSelector({
		name: 'everythingSet',
		needsRecompute: delta => anyChangedCardDiffers(delta, everythingSetCardsDiffer),
		compute: makeEverythingSetFromCards
	})
);

const selectEverythingSetSnapshot = createSelector(
	selectRawCardsSnapshot,
	createCardsDiffSelector({
		name: 'everythingSetSnapshot',
		needsRecompute: delta => anyChangedCardDiffers(delta, everythingSetCardsDiffer),
		compute: makeEverythingSetFromCards
	})
);

type SetCollection = {
	[set in SetName]: CardID[]
};

//Existence-gated reading-list set (#752), diff-gated like selectDefaultSet
//so a content-only card edit neither refilters nor changes the result's
//identity: existingCardsOnly returns the raw list identity when every entry
//has a card record (the overwhelmingly common case), and only card
//ADDITIONS/REMOVALS can change existence.
let _readingListSetState : {readingList : CardID[], cards : Cards, result : CardID[]} | null = null;

const selectReadingListSet = createSelector(
	selectUserReadingList,
	selectRawCards,
	(readingList, cards) : CardID[] => {
		if (_readingListSetState && _readingListSetState.readingList === readingList) {
			const delta = diffCards(_readingListSetState.cards, cards);
			if (!membershipChanged(delta)) {
				_readingListSetState = {readingList, cards, result: _readingListSetState.result};
				return _readingListSetState.result;
			}
		}
		const result = existingCardsOnly(readingList, cards);
		_readingListSetState = {readingList, cards, result};
		return result;
	}
);

let _readingListSetSnapshotState : {readingList : CardID[], cards : Cards, result : CardID[]} | null = null;

const selectReadingListSetSnapshot = createSelector(
	selectUserReadingListSnapshot,
	selectRawCards,
	(readingList, cards) : CardID[] => {
		if (_readingListSetSnapshotState && _readingListSetSnapshotState.readingList === readingList) {
			const delta = diffCards(_readingListSetSnapshotState.cards, cards);
			if (!membershipChanged(delta)) {
				_readingListSetSnapshotState = {readingList, cards, result: _readingListSetSnapshotState.result};
				return _readingListSetSnapshotState.result;
			}
		}
		const result = existingCardsOnly(readingList, cards);
		_readingListSetSnapshotState = {readingList, cards, result};
		return result;
	}
);

const selectAllSets = createSelector(
	selectDefaultSet,
	selectReadingListSet,
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
	selectReadingListSetSnapshot,
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
const selectRelativeDateCacheKey = () => relativeDateCacheKey();

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
	selectRelativeDateCacheKey,
	selectWorkerIDFMap,
	(cards, sets, filters, sections, fallbacks, startCards, userID, randomSalt, cardSimilarity, editingCardSimilarity, relativeDateKey, idfMap) => ({cards, sets, filters, sections, fallbacks, startCards, userID, randomSalt, cardSimilarity, editingCardSimilarity, relativeDateKey, idfMap: idfMap || undefined})
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
	selectEditingCard,
	(card) :{[field in CardFieldType]+?: string}  => {
		const result : {[field in CardFieldType]+?: string} = {};
		if (!card) return result;
		for (const [field, config] of TypedObject.entries(editableFieldsForCardType(card.card_type))) {
			const validator = FIELD_VALIDATORS[field];
			if (!validator) continue;
			result[field] = validator(card[field], card.card_type, config);
		}
		return result;
	}
);

//The previous active collection, so single-card update echoes can hand off
//the already-computed filter/sort work instead of rebuilding from scratch.
let _previousActiveCollection : Collection | null = null;

//#768: the continuity slot above strongly holds one full corpus generation
//(the Collection retains its cards). It cannot be weak-keyed — its whole
//purpose is handing the PREVIOUS generation's collection to the next build —
//so on an auth-scope change, where the old user's collection is wrong to
//reuse anyway, the sign-in/sign-out flow releases it eagerly instead of
//waiting for the next active-collection recompute to displace it.
export const releasePreviousActiveCollection = () => {
	_previousActiveCollection = null;
};

export const selectWorkerActiveCollectionResult = (state : State) => state.collection ? state.collection.workerActiveCollection : null;

const selectWorkerActiveCollectionError = (state : State) => state.collection ? state.collection.workerActiveCollectionError : null;

const selectURLDiagnosticsState = (state : State) => state.collection ? state.collection.urlDiagnostics : {main: [], worker: []};

//The diagnostics that apply to a given URL: a diagnostic names the URL part
//it could not understand, so it applies exactly when that part (as a whole
//segment sequence) is present in the URL being looked at. This is what
//makes the notice self-scoping (#757): navigating away hides it,
//revisiting the same bad URL shows it again, and there is no clear/
//re-report cycle to get wrong.
//
//Scope against the RAW URL, never against description.serialize(): the
//canonical serialization by construction contains only the parts the
//parser KEPT, and several report sites name parts the parser DROPPED — a
//bogus view mode ('view/bogus') or a reversed bad sort ('sort/bogus'
//against a serialized 'sort/reverse/bogus') — so those notices could never
//match their own URL (#757 review, verified by execution).
//
//Known accepted limitation: matching is textual, so a stale un-retracted
//part from URL A can match a coincidentally identical segment on URL B
//where that text is valid in a different role (e.g. a former filter typo
//'stars' on /sort/stars/). Bounded by retraction, the 24-entry cap, and
//self-hiding on navigation. Pure and exported for tests.
export const urlDiagnosticsForRawURL = (diagnostics : URLDiagnostic[], rawURL : string) : URLDiagnostic[] => {
	const haystack = '/' + rawURL.replace(/^\/+|\/+$/g, '') + '/';
	return diagnostics.filter(diagnostic => haystack.includes('/' + diagnostic.part.replace(/^\/+|\/+$/g, '') + '/'));
};

//URL parts of the ACTIVE collection that the parser did not understand
//(#757): the URL says one thing and the app is showing another, which is
//invisible without a signal — and actively dangerous ahead of Edit All
//Cards, since a typo'd filter is a no-op that widens the selection.
export const selectActiveCollectionURLDiagnostics = createSelector(
	selectPage,
	selectPageExtra,
	selectURLDiagnosticsState,
	(page, pageExtra, diagnostics) : URLDiagnostic[] => {
		//Only collection URLs can carry collection-parse diagnostics
		//(PAGE_DEFAULT in actions/app.ts; literal here to avoid an
		//actions→selectors import cycle).
		if (page !== 'c') return [];
		const merged = [...diagnostics.main];
		for (const diagnostic of diagnostics.worker) {
			if (!merged.some(existing => existing.part === diagnostic.part)) merged.push(diagnostic);
		}
		return urlDiagnosticsForRawURL(merged, pageExtra);
	}
);

//Non-empty (the failure message) when the ACTIVE collection's worker run
//threw — the collection is failed, not empty, and the drawer should say so
//(#739). Scoped to the current description so a stale failure never sticks
//to a different collection after navigation.
export const selectActiveCollectionFailureMessage = createSelector(
	selectActiveCollectionDescription,
	selectWorkerActiveCollectionError,
	(description, error) : string => description && error && error.description === description.serialize() ? error.message : ''
);

export const selectWorkerActiveCollectionReady = createSelector(
	selectActiveCollectionDescription,
	selectWorkerActiveCollectionResult,
	(description, result) => Boolean(description && result && result.description === description.serialize())
);

//Compact per-card metadata pushed by the corpus worker; empty unless the
//worker owns ingestion.
export const selectCardMetas = (state : State) => state.data ? state.data.cardMeta : {};

export const selectActiveCollection = createSelector(
	selectActiveCollectionDescription,
	selectCollectionConstructorArgumentsForGhostingCollection,
	selectWorkerActiveCollectionResult,
	(description, args, workerResult) => {
		if (!description) {
			_previousActiveCollection = null;
			return null;
		}
		//Cutover mode: when the corpus worker has pushed a result for exactly
		//this description, build the collection from it — no UI-thread
		//filtering or sorting. During transitions (boot, description just
		//changed) expose an empty placeholder until the matching authoritative
		//worker result arrives. Never compute the corpus collection on the UI
		//thread in cutover mode.
		if (corpusWorkerServesCollections()) {
			//The placeholder's transitional flag matters: its other fields
			//(ids: [], isFallback: false) are guesses, and consumers that
			//branch on them — the drawer's fallback-hiding rule in
			//particular — must hold their previous answer instead of acting
			//on a lie for a frame (#762).
			const result = workerResult && workerResult.description === description.serialize()
				? workerResult
				: {description: description.serialize(), ids: [], labels: [], numCards: 0, numStartCards: 0, isFallback: false, preview: false, partialMatches: {}, transitional: true};
			const collection = Collection.fromWorkerResult(description, args, result);
			_previousActiveCollection = collection;
			return collection;
		}
		const collection = description.collection(args, _previousActiveCollection);
		_previousActiveCollection = collection;
		return collection;
	}
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

//A selection is a set of card IDs, and an ID can name a card this tab does not
//hold: the corpus is still catching up (a bulk import selects its cards the
//moment they are written, before they have come back through the worker), or
//the card was deleted elsewhere. That is a normal, transient state — but it
//used to produce an array with `undefined` HOLES, and every consumer here
//dereferences its elements. One missing card therefore threw inside whatever
//dispatch caused the recompute, which took down the multi-edit dialog and, from
//there, the worker delivery that would have filled the hole.
//
//So the holes are dropped, and the count of them is published separately
//(selectSelectedCardsMissingCount) for the UI to act on. Dropping alone would
//be wrong on its own: a multi-edit that silently covers 53 of 100 selected
//cards is worse than one that refuses, which is why the dialog gates Save on
//that count rather than just narrowing the target set.
const selectSelectedCardsWithMissing = createSelector(
	selectCards,
	selectExplicitlySelectedCardIDs,
	selectActiveCollection,
	(cards, selected, collection) : {cards : ProcessedCard[], missing : number} => {
		const selectedIDs = Object.keys(selected);
		if (selectedIDs.length) {
			const present = selectedIDs.map(id => cards[id]).filter((card) : card is ProcessedCard => Boolean(card));
			return {cards: present, missing: selectedIDs.length - present.length};
		}
		//The collection's cards are materialized from the same corpus, so they
		//are present by construction.
		return {cards: collection ? collection.filteredCards || [] : [], missing: 0};
	}
);

//This is the effective selected cards, which is either the explicitly selected
//cards, or just the active collection if there are no explicitly selected cards.
export const selectSelectedCards = createSelector(
	selectSelectedCardsWithMissing,
	(result) => result.cards
);

//How many explicitly-selected cards this tab does not (yet) hold. Non-zero
//means selectSelectedCards is a SUBSET of what the user selected.
export const selectSelectedCardsMissingCount = createSelector(
	selectSelectedCardsWithMissing,
	(result) => result.missing
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

//Counts for tabs whose descriptions only use precomputed filter maps: cheap
//set intersections keyed on identity-stable inputs, so they don't recompute
//on unrelated card updates (previously every tab count instantiated a full
//Collection — several filtering the entire everything set — on every args
//identity change, i.e. every card update).
const selectNonConfigurableCountsForTabs = createSelector(
	selectExpandedTabConfig,
	selectAllSets,
	selectFilters,
	selectAllCardsFilter,
	(tabs : ExpandedTabConfig, sets, filters, allCardIDs) : {[tabDescription : string] : number} => {
		const result : {[tabDescription : string] : number} = {};
		for (const tab of tabs) {
			//hideIfEmpty also requires calculating count
			if (!tab.count && !tab.hideIfEmpty) continue;
			if (descriptionRequiresFullCollectionCount(tab.expandedCollection)) continue;
			result[tab.expandedCollection.serialize()] = countForDescription(tab.expandedCollection, sets, filters, allCardIDs);
		}
		return result;
	}
);

const EMPTY_COUNTS : {[tabDescription : string] : number} = Object.freeze({});

//Counts for tabs that genuinely need the full Collection machinery
//(configurable filters). Returns a stable empty object when there are none,
//so the merged selector doesn't churn.
const selectConfigurableCountsForTabs = createSelector(
	selectExpandedTabConfig,
	selectCollectionConstructorArguments,
	(tabs : ExpandedTabConfig, args : CollectionConstructorArguments) : {[tabDescription : string] : number} => {
		let result : {[tabDescription : string] : number} | null = null;
		for (const tab of tabs) {
			if (!tab.count && !tab.hideIfEmpty) continue;
			if (!descriptionRequiresFullCollectionCount(tab.expandedCollection)) continue;
			if (!result) result = {};
			result[tab.expandedCollection.serialize()] = tab.expandedCollection.collection(args).numCards;
		}
		return result || EMPTY_COUNTS;
	}
);

export const selectCountsForTabs = createSelector(
	selectNonConfigurableCountsForTabs,
	selectConfigurableCountsForTabs,
	(nonConfigurable, configurable) : {[tabDescription : string] : number} => ({...nonConfigurable, ...configurable})
);

//The last collection-state verdict of selectCardsDrawerPanelShowing — the
//part of the answer that depends on the collection itself rather than on
//panel/editor state. Held while the active collection is the transitional
//cutover placeholder, whose isFallback: false is a guess: acting on it made
//the drawer flash in for the frames between a navigation (e.g. creating a
//working-notes card from another orphaned card) and the worker's real
//result arriving (#762). null means no authoritative verdict yet this
//session; the boot default is "show", matching the deliberate boot behavior
//recorded below.
let _previousDrawerCollectionVerdict : boolean | null = null;

//The full drawer-showing decision, pure so tests can drive it. Returns the
//answer plus the new collection-state verdict to carry forward. Exported for
//tests only; the app reads selectCardsDrawerPanelShowing.
export const computeCardsDrawerPanelShowing = (
	activeCollection : Collection | null,
	panelOpen : boolean,
	isEditing : boolean,
	editorMinimized : boolean,
	dataFullyLoaded : boolean,
	previousCollectionVerdict : boolean | null
) : [showing : boolean, collectionVerdict : boolean | null] => {
	if (isEditing && editorMinimized) return [false, previousCollectionVerdict];
	if (!panelOpen) return [false, previousCollectionVerdict];
	if (!activeCollection) return [false, previousCollectionVerdict];
	//A transitional placeholder knows nothing about the real collection;
	//hold the previous collection-state verdict rather than flipping on
	//placeholder values. Same reasoning as the boot case below — a
	//transitional state must not be treated as authoritative. While data is
	//NOT fully loaded (boot, and re-boot windows like sign-out/account
	//switch, which rebuild state without a page reload) the boot rule wins
	//over any held verdict: a verdict recorded under a previous auth scope
	//must not hide the drawer during the next boot's loading window.
	if (activeCollection.isTransitional) return [dataFullyLoaded ? (previousCollectionVerdict ?? true) : true, previousCollectionVerdict];
	//During boot the collection is necessarily a fallback, and hiding the
	//drawer for it made the panel pop into existence — a layout jump that
	//reads as a bug. Hold the drawer's normal width while data is still
	//arriving; a fallback collection AFTER load is a real empty state and
	//still hides.
	const verdict = !(activeCollection.isFallback && dataFullyLoaded);
	return [verdict, verdict];
};

//The cardsDrawerPanel hides itself when there are no cards to show (that is,
//for orphaned cards). This is the logic that decides if it's open based on state.
export const selectCardsDrawerPanelShowing = createSelector(
	selectActiveCollection,
	selectCardsDrawerPanelOpen,
	selectIsEditing,
	selectEditorMinimized,
	selectDataIsFullyLoaded,
	(activeCollection, panelOpen, isEditing, editorMinimized, dataFullyLoaded) => {
		const [showing, verdict] = computeCardsDrawerPanelShowing(activeCollection, panelOpen, isEditing, editorMinimized, dataFullyLoaded, _previousDrawerCollectionVerdict);
		_previousDrawerCollectionVerdict = verdict;
		return showing;
	}
);

//This is the final expanded, sorted collection, including start cards.
export const selectActiveCollectionCards = createSelector(
	selectActiveCollection,
	(collection) => collection ? collection.finalSortedCards : []
);

const selectActiveCollectionCardIndex = createSelector(
	selectActiveCollectionCards,
	(collection) : Map<CardID, number> => new Map(collection.map((card, index) => [card.id, index]))
);

export const selectActiveCardIndex = createSelector(
	selectActiveCardID,
	selectActiveCollectionCardIndex,
	(cardId, index) => index.get(cardId) ?? -1
);

export const getCardIndexForActiveCollection = (state : State, cardId: CardID) : number => {
	return selectActiveCollectionCardIndex(state).get(cardId) ?? -1;
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

export const selectFindStickyFiltersEnabled = (state : State) => state.find ? state.find.stickyFiltersEnabled : false;
export const selectFindStickyFiltersExpression = (state : State) => state.find ? state.find.stickyFiltersExpression : '';

//Validates a sticky search expression: the URL round trip for GRAMMAR (the
//trailing '/' is load-bearing — without it the parser reads the last part
//as a card identifier, the quirk #731 documented) plus a VOCABULARY check
//against the live filter memberships. The round trip alone is grammar-only
//(the parser has no dictionary), so a renamed or misspelled filter parsed
//as "valid" and then silently no-op'd — and a misspelled union MEMBER
//silently narrowed the union — exactly the #731-style silent failure this
//validation exists to prevent (#745 review, verified by execution).
//Returns the component list, or null when anything does not resolve.
export const validateStickySearchExpression = (expression : string, knownFilters : Filters) : string[] | null => {
	try {
		const description = CollectionDescription.deserialize(expression + '/');
		if (!description || !description.filters.length) return null;
		for (const component of description.filters) {
			if (component.includes('/')) {
				//Configurable: the head must be a registered configurable
				//filter (its arguments were already grammar-checked by the
				//round trip, which throws on malformed ones).
				if (!CONFIGURABLE_FILTER_NAMES[component.split('/')[0]]) return null;
				continue;
			}
			for (const member of component.split(FILTER_UNION_DELIMITER)) {
				if (knownFilters[member]) continue;
				if (INVERSE_FILTER_NAMES[member]) continue;
				return null;
			}
		}
		return [...description.filters];
	} catch {
		return null;
	}
};

export const selectCollectionDescriptionForQuery = createSelector(
	selectActiveQueryText,
	selectFindCardTypeFilter,
	selectFindSortByRecent,
	selectActiveCardID,
	selectFindGeneric,
	selectFindStickyFiltersEnabled,
	selectFindStickyFiltersExpression,
	selectFilters,
	(queryText, cardTypeFilter, sortByRecent, cardID, generic, stickyEnabled, stickyExpression, knownFilters) => {
		const wordsAndFilters = extractFiltersFromQuery(queryText);
		const baseFilters = ['has-body'];
		let sort : SortName = 'default';
		if (cardID && !generic) baseFilters.push(excludeFilter(cardsFilter(cardID)));
		if (cardTypeFilter) baseFilters.push(cardTypeFilter);
		//The sticky expression applies in GENERIC search only (#745): in the
		//pick-a-card modes it would silently hide cards the user is trying
		//to link to, from a constraint set during an unrelated search days
		//earlier. A spread, since a general expression parses to a LIST of
		//components, which AND with the rest — including in the empty-query
		//branch below, which is correct: that branch is "recent cards", and
		//a default set should constrain it too.
		if (generic) baseFilters.push(...stickySearchFilterComponents(stickyEnabled, stickyExpression, expression => validateStickySearchExpression(expression, knownFilters)));
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

const selectWorkerQueryCollectionResult = (state : State) => state.collection ? state.collection.workerQueryCollection : null;

const selectFindSearchRecall = (state : State) => state.find ? state.find.searchRecall : null;

//Non-null while the find dialog is waiting on a worker query result AND the
//worker's background search-recall index is still building — the only window
//where "the search is slow because indexing is incomplete" is the honest
//explanation. Self-retires once the build reports ready.
//True when the worker's pushed query result matches the CURRENT find
//description (or the worker doesn't serve collections at all) — i.e. the
//find results on screen are current rather than the stale-while-revalidate
//holdover.
export const selectWorkerQueryCollectionReady = createSelector(
	selectCollectionDescriptionForQuery,
	selectWorkerQueryCollectionResult,
	(description, result) => Boolean(description && result && result.description === description.serialize())
);

//Reactive twin of the durable executor's save-eligibility gate: card saves
//need a base the executor can trust — the server-verified 'live' corpus in
//worker mode, or data-fully-loaded in the main-thread listener modes. UI
//affordances use this to make saves UN-ATTEMPTABLE (disabled with a reason)
//during the window instead of letting the user try and fail.
export const selectCardSavesEligible = createSelector(
	selectCorpusStatus,
	selectDataIsFullyLoaded,
	(corpusStatus, dataFullyLoaded) => {
		if (corpusStatus === 'live') return true;
		if (!corpusWorkerOwnsCardIngestion()) return dataFullyLoaded;
		return false;
	}
);

export const selectFindSearchPreparing = createSelector(
	selectFindDialogOpen,
	selectActiveQueryText,
	selectCollectionDescriptionForQuery,
	selectCollectionConstructorArgumentsWithEditingCard,
	selectWorkerQueryCollectionResult,
	selectFindSearchRecall,
	(open, queryText, description, args, workerResult, recall) : {built : number, total : number} | null => {
		if (!open || !queryText) return null;
		if (!corpusWorkerServesCollections() || args.editingCard) return null;
		//If the worker has already answered THIS query, we are not preparing.
		if (workerResult && workerResult.description === description.serialize()) return null;
		//Otherwise we are: either the recall index is still building, or the
		//worker simply has not answered yet. The second case was missing, so
		//pressing Cmd-F before loadComplete showed a confident "0 cards" — the
		//query slot is not subscribed, the stale-while-revalidate guard has no
		//previous collection to hold, and recall is still null — and the user
		//reasonably concluded the card did not exist.
		if (!recall) return {built: 0, total: 0};
		if (recall.ready) return {built: recall.total, total: recall.total};
		return {built: recall.built, total: recall.total};
	}
);

export const selectCollectionForQuery = createSelector(
	selectCollectionDescriptionForQuery,
	selectCollectionConstructorArgumentsWithEditingCard,
	selectWorkerQueryCollectionResult,
	(description, args, workerResult) : Collection => {
		//Cutover mode: the find dialog's collection is served from worker
		//pushes when available. The editing-card variant stays local (the
		//worker doesn't have the editing card), which the bridge enforces by
		//not subscribing while editing — the description match below then
		//simply fails and we compute locally.
		if (corpusWorkerServesCollections() && !args.editingCard) {
			const result = workerResult && workerResult.description === description.serialize()
				? workerResult
				: {description: description.serialize(), ids: [], labels: [], numCards: 0, numStartCards: 0, isFallback: false, preview: false, partialMatches: {}, transitional: true};
			return Collection.fromWorkerResult(description, args, result);
		}
		return description.collection(args);
	}
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

//Like selectExpandedInfoPanelReferenceBlocksForEditingOrActiveCard, but keyed
//only on the ACTIVE card — deliberately NOT the editing card. The editing
//card changes with every keystroke, and these blocks run ~10 key-card
//collections over the whole corpus (1-2s at 40k cards), so live-updating
//them while typing froze the editor at every pause. While editing, the info
//panel shows the blocks for the card as it was opened; live-updating
//similarity while typing should eventually come from the corpus worker.
export const selectExpandedInfoPanelReferenceBlocksForActiveCard = createSelector(
	selectActiveCardEnriched,
	selectCollectionConstructorArguments,
	selectCardIDsUserMayEdit,
	(card, args, cardIDsUserMayEdit) : ExpandedReferenceBlocks => {
		if (!card) return [];
		const blocks = infoPanelReferenceBlocksForCard(card);
		if (blocks.length == 0) return [];
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
	selectMultiEditPublished,
	(referencesDiff, addTags, removeTags, todoEnablements, todoDisablements, published) => {
		const result : CardDiff = {};
		if (referencesDiff.length) result.references_diff = referencesDiff;
		if (addTags.length) result.add_tags = addTags;
		if (removeTags.length) result.remove_tags = removeTags;
		if (todoEnablements.length) result.auto_todo_overrides_enablements = todoEnablements;
		if (todoDisablements.length) result.auto_todo_overrides_disablements = todoDisablements;
		if (published !== null) result.published = published;
		return result;
	}
);

export const selectBulkImportDialogExportContent = createSelector(
	selectBulkImportDialogOpen,
	selectBulKimportDialogMode,
	selectBulkImportDialogOverrideCardOrder,
	selectSelectedCards,
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

export const selectComposedChats = createSelector(
	selectChats,
	selectChatMessages,
	(chats, messages) : ComposedChats => {
		if (!chats || !messages) return {};
		const result : ComposedChats = {};
		for (const [chatID, chat] of Object.entries(chats)) {
			const messageArray = Object.values(messages).filter(message => message.chat == chatID);
			messageArray.sort((a, b) => a.message_index - b.message_index);
			result[chatID] = {
				...chat,
				messages: messageArray
			};
		}
		return result;
	}
);

export const selectCurrentComposedChat = createSelector(
	selectCurrentChatID,
	selectComposedChats,
	(id , chats) => id ? chats[id] : null
);

export const selectChatsInOrder = createSelector(
	selectChats,
	(chats) => {
		if (!chats) return [];
		const chatArray = Object.values(chats);
		chatArray.sort((a, b) => b.updated.seconds - a.updated.seconds);
		return chatArray;
	}
);

export const selectUserMayChatInCurrentChat = createSelector(
	selectCurrentComposedChat,
	selectUserMayUseAI,
	selectUid,
	(chat, mayUseAI, uid) => {
		if (!chat) return false;
		if (!mayUseAI) return false;
		if (chat.owner != uid) return false;
		return true;
	}
);

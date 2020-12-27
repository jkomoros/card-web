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
	DEFAULT_SET_NAME,
	READING_LIST_SET_NAME,
	EVERYTHING_SET_NAME,
	cardTODOConfigKeys,
	queryConfigurableFilterText,
	SIMILAR_FILTER_NAME,
	LIMIT_FILTER_NAME,
	EXCLUDE_FILTER_NAME,
	CARDS_FILTER_NAME,
} from './filters.js';

import {
	CollectionDescription,
} from './collection_description.js';

import {
	tabConfiguration
} from './tabs.js';

import {
	BODY_CARD_TYPES,
	CARD_TYPE_CONCEPT,
	CARD_TYPE_WORKING_NOTES,
	DEFAULT_CARD_TYPE,
	CARD_TYPE_CONFIGURATION
} from './card_fields.js';

import {
	references
} from './references.js';

import {
	FingerprintGenerator,
	extractFiltersFromQuery,
	emptyWordCloud,
	cardWithNormalizedTextProperties,
	suggestedConceptReferencesForCard,
	getConceptsFromConceptCards,
	conceptCardsFromCards,
	possibleMissingConcepts,
} from './nlp.js';

import {
	infoPanelReferenceBlocksForCard,
	expandReferenceBlocks,
	getExpandedPrimaryReferenceBlocksForCard,
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
	PERMISSION_EDIT_CARD
} from './permissions.js';

import {
	backportFallbackTextMapForCard,
} from './util.js';

import {
	USER_DOMAIN,
	TAB_CONFIGURATION
} from '../config.GENERATED.SECRET.js';

const selectState = (state) => state;

export const selectPage = (state) => state.app.page;
export const selectPageExtra = (state) => state.app.pageExtra;
export const selectFetchedCard = (state) => state.app.fetchedCard;
export const selectCardBeingFetched = (state) => state.app.cardBeingFetched;
export const selectMaintenanceModeEnabled = (state) => state.app.maintenanceModeEnabled;
export const selectCardsDrawerInfoExpanded = (state) => state.app.cardsDrawerInfoExpanded;
export const selectSuggestMissingConceptsEnabled = (state) => state.app.suggestMissingConceptsEnabled;

export const selectComposeOpen = (state) => state.prompt.composeOpen;
export const selectPromptContent = (state) => state.prompt.content;
export const selectPromptMessage = (state) => state.prompt.message;
export const selectPromptAction = (state) => state.prompt.action;
export const selectPromptAssociatedId = (state) => state.prompt.associatedId;

export const selectIsEditing = (state) => state.editor && state.editor.editing;
const selectFindDialogOpen = (state) => state.find && state.find.open;
export const selectFindReferencing = (state) => state.find && state.find.referencing;
export const selectFindLinking = (state) => state.find && state.find.linking;
export const selectFindPermissions = (state) => state.find && state.find.permissions;

export const selectCommentsAndInfoPanelOpen = (state) => state.app ? state.app.commentsAndInfoPanelOpen : false;

const selectActiveSetName = (state) => state.collection.activeSetName;
const selectActiveFilterNames = (state) => state.collection.activeFilterNames;
const selectActiveSortName = (state) => state.collection.activeSortName;
const selectActiveSortReversed = (state) => state.collection.activeSortReversed;
export const selectRequestedCard = (state) => state.collection.requestedCard;
export const selectActiveCardId = (state) => state.collection ? state.collection.activeCardId : '';
//Note that the editing card doesn't have nlp/normalized text properties set. If
//you want the one with that, look at selectEditingNormalizedCard.
export const selectEditingCard = (state) => state.editor ? state.editor.card : null;
const selectEditingCardExtractionVersion = (state) => state.editor ? state.editor.cardExtractionVersion : 0;
export const selectEditingUpdatedFromContentEditable = (state) => state.editor ? state.editor.updatedFromContentEditable : {};
export const selectEditingPendingReferenceType = (state) => state.editor ? state.editor.pendingReferenceType : '';
export const selectPendingSlug = (state) => state.editor ? state.editor.pendingSlug : '';
export const selectFilters = (state) => state.collection.filters;
export const selectPendingFilters = (state) => state.collection.pendingFilters;
export const selectSections = (state) => state.data ? state.data.sections : {};
export const selectTags = (state) => state.data ? state.data.tags : {};
export const selectExpectedDeletions = (state) => state.data ? state.data.expectedDeletions : {};
export const selectCardModificationPending = (state) => state.data ? state.data.cardModificationPending : '';
//All cards downloaded to client can be assumed to be OK to use in the rest of the pipeline.
//rawCards means they don't yet have their nlp data cached. See selectCards which returns that.
const selectRawCards = (state) => state.data ? state.data.cards : {};
const selectPendingNewCardID = (state) => state.data ? state.data.pendingNewCardID : '';
const selectPendingNewCardType = (state) => state.data ? state.data.pendingNewCardType : '';
export const selectPendingNewCardIDToNavigateTo = (state) => state.data ? state.data.pendingNewCardIDToNavigateTo : '';
const selectPublishedCardsLoaded = (state) => state.data ? state.data.publishedCardsLoaded : false;
const selectUnpublishedCardsLoaded = (state) => state.data ? state.data.unpublishedCardsLoaded : false;
export const selectSectionsLoaded = (state) => state.data ? state.data.sectionsLoaded : false;
export const selectTagsLoaded = (state) => state.data ? state.data.tagsLoaded : false;
export const selectMessagesLoaded = (state) => state.comments ? state.comments.messagesLoaded : false;
export const selectThreadsLoaded = (state) => state.comments ? state.comments.threadsLoaded : false;
export const selectAlreadyCommittedModificationsWhenFullyLoaded = (state) => state.data ? state.data.alreadyCommittedModificationsWhenFullyLoaded : false;
const selectSlugIndex = (state) => state.data ? state.data.slugIndex : {};
export const selectMessages = (state) => state.comments ? state.comments.messages : null;
export const selectThreads = (state) => state.comments ? state.comments.threads : null;
export const selectAuthors = (state) => state.data.authors ? state.data.authors : null;
export const selectAllPermissions = (state) => state.permissions ? state.permissions.permissions : null;
export const selectPermissionsPendingUid = (state) => state.permissions ? state.permissions.pendingUid : '';
export const selectPermissionsPendingPermissionType = (state) => state.permissions ? state.permissions.pendingPermissionType : '';
const selectTweets = (state) => state.data ? state.data.tweets : {};
export const selectTweetsLoading = (state) => state.data ? state.data.tweetsLoading : false;
export const selectActivePreviewCardId = (state) => state.app ? state.app.hoverCardId : '';
export const selectPreviewCardX = (state) => state.app ? state.app.hoverX : 0;
export const selectPreviewCardY = (state) => state.app ? state.app.hoverY : 0;
export const selectUserReads = (state) => state.user ? state.user.reads : {};
const selectUserStars = (state) => state.user ? state.user.stars : {};
export const selectUserReadingList = (state) => state.user ? state.user.readingList : [];
const selectUserReadingListForSet = (state) => state.user ? state.user.readingListForSet : [];

const selectCardsDrawerPanelOpen = (state) => state.app ? state.app.cardsDrawerPanelOpen : false;
export const selectCtrlKeyPressed = (state) => state.app ? state.app.ctrlKeyPressed : false;

//selectQuery is what you should use to update the UI with the literal query
export const selectQuery = (state) => state.find.query;
//activeQuery is the query that should be routed into the query pipeline.
const selectActiveQueryText = (state) => state.find.activeQuery;
export const selectFindCardTypeFilter = (state) => state.find ? state.find.cardTypeFilter : '';
export const selectFindCardTypeFilterLocked = (state) => state.find ? state.find.cardTypeFilterLocked : false;

export const selectAuthPending = (state) => state.user ? state.user.pending : false;
//Note: this will return false unless stars have been loading, even if there is
//no user to load stars or reads for.
export const selectStarsLoaded = (state) => state.user ? state.user.starsLoaded : false;
export const selectReadsLoaded = (state) => state.user ? state.user.readsLoaded : false;
export const selectUserPermissionsLoaded = (state) => state.user ? state.user.userPermissionsLoaded : false;
export const selectReadingListLoaded = (state) => state.user ? state.user.readingListLoaded : false;

//selects a collection of outboundCardID -> fallbackMap, where fallbackMap is
//suitable to being passed to references.withFallbackText. The only items that
//will be created are for refrence types that opt into backporting via
//backportMissingText, and where the card has some text that needs to be filled.
const selectBackportTextFallbackMapCollection = createObjectSelector(
	selectRawCards,
	selectRawCards,
	(card, cards) => backportFallbackTextMapForCard(card, cards)
);

const selectRawConceptCards = createSelector(
	selectRawCards,
	(cards) => conceptCardsFromCards(cards)
);

//selectConcepts returns a map of all concepts based on visible concept cards.
export const selectConcepts = createSelector(
	selectRawConceptCards,
	(conceptCards) => getConceptsFromConceptCards(conceptCards)
);

const selectZippedCardAndFallbackMap = createSelector(
	selectRawCards,
	selectBackportTextFallbackMapCollection,
	(cards, fallbackTextCollection) => Object.fromEntries(Object.entries(cards).map(entry => [entry[0], [entry[1], fallbackTextCollection[entry[0]]]]))
);

//objectEquality checks for objects to be the same content, allowing nested
//objects
const objectEquality = (before, after) => {
	if (before === after) return true;
	if (!before) return false;
	if (!after) return false;
	if (typeof before != 'object') return false;
	if (typeof after != 'object') return false;
	if (Array.isArray(before) && Array.isArray(after)) return arrayEquality(before, after);
	const beforeEntries = Object.entries(before);
	if (beforeEntries.length != Object.keys(after).length) return false;
	return beforeEntries.every(entry => objectEquality(entry[1], after[entry[0]]));
};

//arrayEquality returns true if both are arrays and each of their items are the same
const arrayEquality = (before, after) => {
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
export const selectCards = createZippedObjectSelector(
	selectZippedCardAndFallbackMap,
	//Note that depending on selectConcepts actually doesn't lead to many
	//recalcs. That's because a) we're using objectEquality, so as long as the
	//map stays semantically the same cards won't be reindexed, and b) because
	//concept cards are by default published, which means they're in the first
	//set of cards. That means the only time every card has to be reindexed is
	//when specifically the title of one of the concept cards changes.
	selectConcepts,
	//Note this processing on a card to make the nlp card should be the same as what is done in selectEditingNormalizedCard.
	(cardAndFallbackMap, concepts) => cardWithNormalizedTextProperties(cardAndFallbackMap[0], cardAndFallbackMap[1], concepts)
);

const selectConceptCards = createSelector(
	selectCards,
	(cards) => Object.fromEntries(Object.entries(cards).filter(entry => entry[1].card_type == CARD_TYPE_CONCEPT))
);

export const selectActiveCard = createSelector(
	selectCards,
	selectActiveCardId,
	(cards, activeCard) => cards[activeCard] || null
);

export const selectKeyboardNavigates = createSelector(
	selectIsEditing,
	selectFindDialogOpen,
	selectComposeOpen,
	(editing, find, compose) => !editing && !find && !compose
);

//This is just the userPermissions fetched; for the actual permissions object in
//use, see selectCOmposedPermissions.
const selectUserPermissions = (state) => state.user ? state.user.userPermissions : {};

//For actions, like starring and marking read, that are OK to do when signed
//in anonymously.
const userObjectExists = user => user && user.uid != '';
const userSignedIn = user => userObjectExists(user) && !user.isAnonymous;

export const selectUser = state => {
	if (!state.user) return null;
	if (!state.user.user) return null;
	return state.user.user;
};

export const selectUserIsAnonymous = createSelector(
	selectUser,
	(user) => userObjectExists(user) && user.isAnonymous
);

//UserSignedIn means that there is a user object, and that user is not
//anonymous. Note that selectors like selectUserMayMarkRead and
//selectUserMayComment may return true even when this returns false if the
//user is signed in anonymously.
export const selectUserSignedIn = createSelector(
	selectUser,
	(user) => userSignedIn(user)
);

const selectUserSignedInDomain = createSelector(
	selectUserSignedIn,
	selectUser,
	(signedIn, user) => signedIn && user.email && user.email.toLowerCase().split('@')[1] == USER_DOMAIN
);

export const selectUserObjectExists = createSelector(
	selectUser,
	(user) => userObjectExists(user)
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

const userMayResolveThread = (state, thread) => {
	if (selectUserIsAdmin(state)) return true;
	if (!selectUserMayComment(state)) return false;
	if (!thread || typeof thread !== 'object') return false;
	const uid = selectUid(state);
	return uid == thread.author.id;
};

const userMayEditMessage = (state, message) => {
	if (selectUserIsAdmin(state)) return true;
	if (!selectUserMayComment(state)) return false;
	if (!message || !message.author || !message.author.id) return false;
	const uid = selectUid(state);
	return uid == message.author.id;
};

export const selectUid = createSelector(
	selectUser,
	(user) => user ? user.uid : ''
);

export const selectUserIsAdmin = createSelector(
	selectComposedPermissions,
	(permissions) => permissions[PERMISSION_ADMIN]
);

export const selectUserMayEdit = createSelector(
	selectUserIsAdmin,
	selectComposedPermissions,
	(admin, permissions) => admin || permissions[PERMISSION_EDIT]
);

//if the user may edit ANY cards
const selectUserMayEditCards = createSelector(
	selectUserMayEdit,
	selectComposedPermissions,
	(userMayEdit, permissions) => userMayEdit || permissions[PERMISSION_EDIT_CARD]
);

const selectCardsMayCurrentlyBeEdited = createSelector(
	selectMaintenanceModeEnabled,
	(enabled) => !enabled
);

export const selectCardIDsUserMayEdit = createObjectSelector(
	selectCards,
	selectUserMayEditCards,
	selectUid,
	selectCardsMayCurrentlyBeEdited,
	(card, userMayEditCards, uid, cardsMayCurrentlyBeEdited) => {
		if (!cardsMayCurrentlyBeEdited) return false;
		if (userMayEditCards) {
			return true;
		}
		if (!card) return false;
		if (card.author != uid) {
			return true;
		}
		if (!card.permissions || !card.permissions[PERMISSION_EDIT_CARD]) return false;
		if (!card.permissions[PERMISSION_EDIT_CARD].some(id => id === uid)) return false;
		return true;
	}
);

export const selectUserMayEditActiveCard = createSelector(
	selectCardIDsUserMayEdit,
	selectActiveCardId,
	(editableCardIDs, cardID) => editableCardIDs[cardID] || false
);

export const selectUserMayViewApp = createSelector(
	selectUserIsAdmin,
	selectComposedPermissions,
	(admin, permissions) => admin || permissions[PERMISSION_VIEW_APP]
);

export const selectUserMayViewUnpublished = createSelector(
	selectUserIsAdmin,
	selectUserMayViewApp,
	selectComposedPermissions,
	(admin, mayViewApp, permissions) => mayViewApp && (admin || permissions[PERMISSION_EDIT] || permissions[PERMISSION_EDIT_CARD] || permissions[PERMISSION_VIEW_UNPUBLISHED])
);

export const selectUserMayEditPermissions = createSelector(
	selectUserIsAdmin,
	//For now, only admins may edit permissions.
	(admin) => admin
);

export const getUserMayEditSection = (state, sectionID) => {
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

// eslint-disable-next-line no-unused-vars
export const getUserMayEditTag = (state, tagID) => {
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
	selectCardsMayCurrentlyBeEdited,
	(userMayEdit, permissions, mayCurrentlyEdit) => mayCurrentlyEdit && (userMayEdit || permissions[PERMISSION_CREATE_CARD])
);

export const selectUserMayForkActiveCard = createSelector(
	selectUserMayCreateCard,
	selectState,
	selectActiveCard,
	(mayCreateCard, state, activeCard) => mayCreateCard && activeCard && getUserMayEditSection(state, activeCard.section)
);

//If it's the empty string, then user MAY delete the card
export const getReasonUserMayNotDeleteCard = (state, card) => {
	//NOTE: this logic is recreatedin the firestore security rules for card deletion
	if (!card) return 'No card provided';

	if (!selectCardIDsUserMayEdit(state)[card.id]) return 'User may not edit card.';

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
	(admin, permissions) => admin || permissions[PERMISSION_COMMENT]
);

export const selectUserMayStar = createSelector(
	selectUserIsAdmin,
	selectComposedPermissions,
	(admin, permissions) => admin || permissions[PERMISSION_STAR]
);

export const selectUserMayMarkRead = createSelector(
	selectUserIsAdmin,
	selectComposedPermissions,
	(admin, permissions) => admin || permissions[PERMISSION_MARK_READ]
);

export const selectUserMayModifyReadingList = createSelector(
	selectUserIsAdmin,
	selectComposedPermissions,
	(admin, permissions) => admin || permissions[PERMISSION_MODIFY_READING_LIST]
);

export const selectAuthorsForTagList = createSelector(
	selectAuthors,
	(authors) => Object.fromEntries(Object.entries(authors).map(entry => [entry[0], {id:entry[0], title:entry[1].displayName || entry[0]}]))
);

export const selectCollaboratorInfosForActiveCard = createSelector(
	selectActiveCard,
	selectAuthors,
	(card, authors) => card ? card.collaborators.map(uid => authors[uid]) : []
);

//A map of uid -> permissionKey -> [cardID], for any uid that is listed in any card's permissions object.
export const selectUserPermissionsForCardsMap = createSelector(
	selectCards,
	(cards) => {
		let result = {};
		for (let card of Object.values(cards)) {
			if (!card.permissions) continue;
			for (let [permissionKey, uids] of Object.entries(card.permissions)) {
				for (let uid of uids) {
					if (!result[uid]) result[uid] = {};
					if (!result[uid][permissionKey]) result[uid][permissionKey] = [];
					result[uid][permissionKey].push(card.id);
				}
			}
		}
		return result;
	}
);

export const selectUidsWithPermissions = createSelector(
	selectAllPermissions,
	selectUserPermissionsForCardsMap,
	(allPermissions, cardsMap) => Object.fromEntries(Object.entries(allPermissions).map(entry => [entry[0], true]).concat(Object.entries(cardsMap).map(entry => [entry[0], true])))
);

const selectFingerprintGenerator = createSelector(
	selectCards,
	(cards) => new FingerprintGenerator(cards)
);

//getSemanticFingerprintForCard operates on the actual cardObj passed, so it can
//work for cards that have been modified.
export const getSemanticFingerprintForCard = (state, cardObj) => {
	return selectFingerprintGenerator(state).fingerprintForCardObj(cardObj);
};

//A map of tagID to the semantic fingerprint for that card. A tag's semantic
//fingerprint is created by adding up all of its cards semantic fingerprint,
//resorting, and re-trimming down to fingerprint size. They can be compared
//directly to a given card's fingerprint.
const selectTagsSemanticFingerprint = createSelector(
	selectTags,
	selectFingerprintGenerator,
	(tags, fingerprintGenerator) => {
		if (!tags) return {};
		let result = {};
		for (const [tagID, tag] of Object.entries(tags)) {
			result[tagID] = fingerprintGenerator.fingerprintForCardIDList(tag.cards);
		}
		return result;
	}
);

let memoizedEditingNormalizedCard = undefined;
let memoizedEditingNormalizedCardExtractionVersion = -1;

//selectEditingNormalizedCard is like editing card, but with nlp properties set.
//It uses custom memoization because it should only update when the extraction
//version increases, since lots of expensive nlp stuff is downstream of it, and
//if it ran every single keystroke while editingCard was being edited it would
//be very slow. When extractionVersion increments, that's the system saying it's
//OK to run the expensive properties again.
const selectEditingNormalizedCard = (state) => {
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
			memoizedEditingNormalizedCard = cardWithNormalizedTextProperties(editingCard, fallbackMap, conceptsMap);
		} else {
			memoizedEditingNormalizedCard = editingCard;
		}
		memoizedEditingNormalizedCardExtractionVersion = extractionVersion;
	}
	return memoizedEditingNormalizedCard;
};

//Warning: this is EXTREMELY expensive. Like 10 seconds of processing expensive!
const selectWordCloudForPossibleMissingConcepts = createSelector(
	selectCards,
	(cards) => possibleMissingConcepts(cards).wordCloud()
);

const selectEditingCardSemanticFingerprint = createSelector(
	selectEditingNormalizedCard,
	selectFingerprintGenerator,
	(card, fingerprintGenerator) => fingerprintGenerator.fingerprintForCardObj(card)
);

export const selectEditingCardSuggestedConceptReferences = createSelector(
	selectEditingNormalizedCard,
	selectEditingCardSemanticFingerprint,
	selectConceptCards,
	selectConcepts,
	(card, fingerprint, conceptCards, concepts) => suggestedConceptReferencesForCard(card, fingerprint, conceptCards, concepts)
);

const NUM_SIMILAR_TAGS_TO_SHOW = 3;

//selectEditingCardSuggestedTags returns the tags for the editing card that are
//suggested--that is that are similar to the semantics of this card, but are not
//yet on the card.
export const selectEditingCardSuggestedTags = createSelector(
	selectEditingNormalizedCard,
	selectEditingCardSemanticFingerprint,
	selectTagsSemanticFingerprint,
	(card, cardFingerprint, tagFingerprints) => {
		if (!card || Object.keys(card).length == 0) return [];
		if (!tagFingerprints || tagFingerprints.size == 0) return [];
		const closestTags = new FingerprintGenerator().closestOverlappingItems('', cardFingerprint, tagFingerprints);
		if (closestTags.size == 0) return [];
		const excludeIDs = new Set(card.tags);
		let result = [];
		for (const tagID of closestTags.keys()) {
			if (excludeIDs.has(tagID)) continue;
			result.push(tagID);
			if (result.length >= NUM_SIMILAR_TAGS_TO_SHOW) break;
		}
		return result;
	}
);

//getCardExists checks if the card with the given ID is known to exist. This is
//typicaly because a card with that ID is in the set of cards on the client, but
//also might be because we just created that card and know it will exist soon
//even though it's not yet on the client.
export const getCardExists = (state, cardID) => {
	if (cardID == selectPendingNewCardID(state)) return true;
	return Object.keys(selectCards(state)).some(key => key === cardID);
};

//Returns the cardType for the card with the given ID. It looks over the set of
//cards in client, but also will return the pendingNewCardType if the cardID
//matches. See also getCardExists.
export const getCardType = (state, cardID) => {
	if (cardID == selectPendingNewCardID(state)) return selectPendingNewCardType(state);
	const cards = selectCards(state);
	const card = cards[cardID] || {};
	return card.card_type || '';
};

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

export const getCardHasStar = (state, cardId) => {
	return (selectUserStars(state) || {})[cardId] || false;
};

export const getCardIsRead = (state, cardId) => {
	return (selectUserReads(state) || {})[cardId] || false;
};

export const getCardInReadingList = (state, cardId) => {
	return (selectUserReadingListMap(state) || {})[cardId] || false;
};

export const getUserMayResolveThread = userMayResolveThread;
export const getUserMayEditMessage = userMayEditMessage;

export const getMessageById = (state, messageId) => {
	let messages = selectMessages(state);
	if (!messages) return null;
	return messages[messageId];
};

export const getThreadById = (state, threadId) => {
	let threads = selectThreads(state);
	if (!threads) return null;
	return threads[threadId];
};

export const getCardById = (state, cardId) => {
	let cards = selectCards(state);
	if (!cards) return null;
	return cards[cardId];
};

export const getIdForCard = (state, idOrSlug) => {
	const slugIndex = selectSlugIndex(state);
	return slugIndex[idOrSlug] || idOrSlug;
};

export const getAuthorForId = (state, authorId) => {
	let authors = selectAuthors(state);
	return authorOrDefault(authorId, authors);
};

const authorOrDefault = (authorId, authors) => {
	let author = authors[authorId];
	if (!author){
		return {displayName: 'Unknown user'};
	}
	return author;
};

export const getCard = (state, cardIdOrSlug)  => getCardById(state, getIdForCard(state, cardIdOrSlug));

export const getSection = (state, sectionId) => {
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
	(stars, reads, todos, readingList) => ({stars, reads, todos, readingList})
);

//TODO: once factoring the composed threads selctors into this file, refactor
//this to just select the composed threads.
export const selectActiveCardThreadIds = createSelector(
	selectActiveCardId,
	selectThreads,
	(cardId, threads) => Object.keys(threads).filter(threadId => threads[threadId].card == cardId)
);

export const selectActiveCardComposedThreads = createSelector(
	selectState,
	selectActiveCardThreadIds,
	selectThreads,
	selectMessages,
	selectAuthors,
	(state, threadIds, threads, messages, authors) => threadIds.map(id => composedThread(state, id, threads, messages, authors)).filter(thread => !!thread)
);

const composedThread = (state, threadId, threads, messages, authors) => {
	let originalThread = threads[threadId];
	if (!originalThread) return null;
	let thread = {...originalThread};
	let expandedMessages = [];
	for (let messageId of Object.values(thread.messages)) {
		let message = composedMessage(state, messageId, messages, authors);
		if (message) expandedMessages.push(message);
	}
	thread.messages = expandedMessages;
	thread.author = authorOrDefault(originalThread.author, authors);
	thread.mayResolve = userMayResolveThread(state, thread);
	return thread;
};

const composedMessage = (state, messageId, messages, authors) => {
	//TODO: return composed children for threads if there are parents
	let originalMessage = messages[messageId];
	if (!originalMessage) return null;
	let message = {...originalMessage};
	message.author = authorOrDefault(originalMessage.author, authors);
	message.mayEdit = userMayEditMessage(state, message);
	return message;
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
	selectPublishedCardsLoaded,
	selectUserMayViewUnpublished,
	selectUnpublishedCardsLoaded,
	(permissionsFinal, publishedCardsLoaded, userMayViewUnpublished, unpublishedCardsLoaded) => permissionsFinal && publishedCardsLoaded && (userMayViewUnpublished ? unpublishedCardsLoaded : true)
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
	(card, tweets) => Object.fromEntries(Object.entries(tweets).filter(entry => entry[1].card == card.id))
);

//selectEditingCardAutoTodos will opeate on not the actual filter set, but one
//that has been updated with the current editingCard values.
export const selectEditingCardAutoTodos = createSelector(
	selectEditingCard,
	(card) => cardTODOConfigKeys(card, true)
);

export const selectActiveCollectionDescription = createSelector(
	selectActiveSetName,
	selectActiveFilterNames,
	selectActiveSortName,
	selectActiveSortReversed,
	(setName, filterNames, sortName, sortReversed) => new CollectionDescription(setName, filterNames, sortName, sortReversed)
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
		if(collectionDescription.set != DEFAULT_SET_NAME) return '';
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
	(collectionDescription) => {
		if (collectionDescription.set != EVERYTHING_SET_NAME) return DEFAULT_CARD_TYPE;
		if (collectionDescription.filters.length != 1) return DEFAULT_CARD_TYPE;
		const possibleCardType = collectionDescription.filters[0];
		const cardTypeConfig = CARD_TYPE_CONFIGURATION[possibleCardType];
		if (!cardTypeConfig) return DEFAULT_CARD_TYPE;
		//Working notes already has its own button
		if (possibleCardType === CARD_TYPE_WORKING_NOTES) return DEFAULT_CARD_TYPE;
		if (!cardTypeConfig.orphanedByDefault) return DEFAULT_CARD_TYPE;
		return possibleCardType;
	}
);

//Whether or not, if the user chose to add a card to the current collection, it
//would work. This is true if the card type is content and the user may edit the
//active section, OR it's the everything set with a single filter, for a card
//type that is orphaned by default.
export const selectUserMayEditActiveCollection = createSelector(
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
	(sections, tags) => tabConfiguration(TAB_CONFIGURATION, sections, tags)
);

export const selectTabCollectionFallbacks = createSelector(
	selectExpandedTabConfig,
	selectSlugIndex,
	(config, slugIndex) => {
		let result = {};
		for (const item of config) {
			if (!item.fallback_cards) continue;
			result[item.collection.serialize()] = item.fallback_cards.map(idOrSlug => slugIndex[idOrSlug] || idOrSlug);
		}
		return result;
	}
);

export const selectTabCollectionStartCards = createSelector(
	selectExpandedTabConfig,
	selectSlugIndex,
	(config, slugIndex) => {
		let result = {};
		for (const item of config) {
			if (!item.start_cards) continue;
			result[item.collection.serialize()] = item.start_cards.map(idOrSlug => slugIndex[idOrSlug] || idOrSlug);
		}
		return result;
	}
);

//the section that should be loaded by default if no section is specified; Will
//return the first section, or if one is marked as default, that one.
export const selectDefaultSectionID = createSelector(
	selectSections,
	(sections) => {
		const entries = Object.entries(sections);
		if (!entries.length) return '';
		for (const entry of entries) {
			if (entry[1].default) return entry[0];
		}
		return entries[0][0];
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
		if( collectionDescription.set != DEFAULT_SET_NAME) return '';
		if (collectionDescription.filters.length != 1) return '';
		return tags[collectionDescription.filters[0]] ? collectionDescription.filters[0] : '';
	}
);

export const selectDefaultSet = createSelector(
	selectSections,
	(sections) => {
		let result = [];
		for (let section of Object.values(sections)) {
			result = result.concat(section.cards);
		}
		return result;
	}
);

const selectEverythingSet = createSelector(
	selectCards,
	(cards) => {
		let keys = Object.keys(cards);
		keys.sort((a, b) => {
			let aCard = cards[a];
			let bCard = cards[b];
			let aTimestamp = aCard.updated && aCard.updated.seconds ? aCard.updated.seconds : 0;
			let bTimestamp = bCard.updated && bCard.updated.seconds ? bCard.updated.seconds : 0;
			return bTimestamp - aTimestamp;
		});
		return keys;
	}
);

const selectAllSets = createSelector(
	selectDefaultSet,
	selectUserReadingListForSet,
	selectEverythingSet,
	(defaultSet, readingListSet, everythingSet) => {
		return {
			[DEFAULT_SET_NAME]: defaultSet,
			[READING_LIST_SET_NAME]: readingListSet,
			[EVERYTHING_SET_NAME]: everythingSet,
		};
	}
);

//selectCollectionConstructorArguments returns an array that can be unpacked and
//passed as the arguments to collectionDescription.collection(). It omits the
//optional editingCard. See also
//selectCollectionConstructorArgumentsWithEditingCard
export const selectCollectionConstructorArguments = createSelector(
	selectCards,
	selectAllSets,
	selectFilters,
	selectSections,
	selectTabCollectionFallbacks,
	selectTabCollectionStartCards,
	(cards, sets, filters, sections, fallbacks, startCards) => ({cards, sets, filters, sections, fallbacks, startCards})
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

export const selectActiveCollection = createSelector(
	selectActiveCollectionDescription,
	selectCollectionConstructorArguments,
	(description, args) => description ? description.collection(args) : null
);

const selectActiveCollectionWordCloud = createSelector(
	selectActiveCollection,
	selectFingerprintGenerator,
	(collection, fingerprintGenerator) => {
		const fingerprint = fingerprintGenerator.fingerprintForCardIDList(collection.filteredCards.map(card => card.id));
		return fingerprint.wordCloud();
	}
);

//NOTE: this can be EXTREMELY expensive.
export const selectWordCloudForMainCardDrawer = (state) => {
	return selectSuggestMissingConceptsEnabled(state) ? selectWordCloudForPossibleMissingConcepts(state) : selectActiveCollectionWordCloud(state);
};

export const selectCountsForTabs = createSelector(
	selectExpandedTabConfig,
	selectCollectionConstructorArguments,
	(tabs, args) => {
		let result = {};
		for (let tab of tabs) {
			if (!tab.count) continue;
			result[tab.collection.serialize()] = tab.collection.collection(args).numCards;
		}
		return result;
	}
);

//The cardsDrawerPanel hides itself when there are no cards to show (that is,
//for orphaned cards). This is the logic that decides if it's open based on state.
export const selectCardsDrawerPanelShowing = createSelector(
	selectActiveCollection,
	selectCardsDrawerPanelOpen,
	(activeCollection, panelOpen) => !activeCollection || activeCollection.isFallback ? false : panelOpen
);

//This is the final expanded, sorted collection, including start cards.
export const selectActiveCollectionCards = createSelector(
	selectActiveCollection,
	(collection) => collection.finalSortedCards
);

export const selectActiveCardIndex = createSelector(
	selectActiveCardId,
	selectActiveCollectionCards,
	(cardId, collection) => collection.map(card => card.id).indexOf(cardId)
);

export const getCardIndexForActiveCollection = (state, cardId) => {
	let collection = selectActiveCollectionCards(state);
	return collection.map(card => card.id).indexOf(cardId);
};

//returns an array of card-types that are in the BODY_CARD_TYPES that this user has access to
const selectBodyCardTypes = createSelector(
	selectFilters,
	//we can just take advantage of the fact that cards are already set, and there's a filter per card type
	(filters) => Object.keys(BODY_CARD_TYPES).filter(cardType => Object.keys(filters[cardType] || {}).length > 0)
);

export const selectFindLegalCardTypeFilters = createSelector(
	selectBodyCardTypes,
	selectFindCardTypeFilter,
	//'' stands for 'no filter' and will show up as 'Default'
	//findCardTypeFilter, whatever it is, needs to show up, since it's 'selected'
	//The set thing makes sure we don't have duplicates
	(bodyCardTypes, findCardTypeFilter) => [... new Set(['', ...bodyCardTypes, findCardTypeFilter])]
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
	selectActiveCardId,
	selectFindGeneric,
	(queryText, cardTypeFilter, cardID, generic) => {
		const wordsAndFilters = extractFiltersFromQuery(queryText);
		let baseFilters = ['has-body'];
		if (cardID && !generic) baseFilters.push(EXCLUDE_FILTER_NAME + '/' + CARDS_FILTER_NAME + '/' + cardID);
		if (cardTypeFilter) baseFilters.push(cardTypeFilter);
		if (!wordsAndFilters[0] && !wordsAndFilters[1].length) {
			baseFilters.push(SIMILAR_FILTER_NAME + '/' + cardID);
			baseFilters.push(LIMIT_FILTER_NAME + '/' + 10);
			//If there's no query, return the similar cards to the current card
			return new CollectionDescription(EVERYTHING_SET_NAME, baseFilters);
		}
		const queryFilter = queryConfigurableFilterText(wordsAndFilters[0]);
		return new CollectionDescription(EVERYTHING_SET_NAME,[...baseFilters, queryFilter, ...wordsAndFilters[1]]);
	}
);

export const selectCollectionForQuery = createSelector(
	selectCollectionDescriptionForQuery,
	selectCollectionConstructorArguments,
	(description, args) => description.collection(args)
);

export const selectExpandedPrimaryReferenceBlocksForEditingOrActiveCard = createSelector(
	selectEditingOrActiveNormalizedCard,
	selectCollectionConstructorArguments,
	selectCardIDsUserMayEdit,
	(card, args, cardIDsUserMayEdit) => getExpandedPrimaryReferenceBlocksForCard(args, card, cardIDsUserMayEdit)
);

export const selectExpandedPrimaryReferenceBlocksForPreviewCard = createSelector(
	selectActivePreviewCard,
	selectCollectionConstructorArguments,
	selectCardIDsUserMayEdit,
	(card, args, cardIDsUserMayEdit) => getExpandedPrimaryReferenceBlocksForCard(args, card, cardIDsUserMayEdit)
);

export const selectExpandedInfoPanelReferenceBlocksForEditingOrActiveCard = createSelector(
	selectEditingOrActiveNormalizedCard,
	selectCollectionConstructorArgumentsWithEditingCard,
	selectCardIDsUserMayEdit,
	(card, args, cardIDsUserMayEdit) => {
		const blocks = infoPanelReferenceBlocksForCard(card);
		if (blocks.length == 0) return [];
		//reference-block will hide any ones that shouldn't render because of an empty collection so we don't need to filter
		return expandReferenceBlocks(card, blocks, args, cardIDsUserMayEdit);
	}
);
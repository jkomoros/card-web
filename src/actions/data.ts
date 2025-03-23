import {
	slugLegal
} from './database.js';

import {
	TypedObject
} from '../../shared/typed_object.js';

import {
	db,
	deepEqualIgnoringTimestamps,
	serverTimestampSentinel
} from '../firebase.js';

import {
	doc,
	getDoc,
	getDocs,
	query,
	where,
	orderBy,
	collection,
	arrayUnion,
	arrayRemove,
	serverTimestamp,
	Timestamp
} from 'firebase/firestore';

import {
	navigateToCardInCurrentCollection,
	navigateToCollection,
	navigateToNextCard
} from './app.js';

import {
	closeMultiEditDialog
} from './multiedit.js';

import {
	editingFinish,
	slugAdded,
	tagAdded
} from './editor.js';

import {
	newID,
	idWasVended,
	normalizeSlug,
	createSlugFromArbitraryString,
} from '../util.js';

import {
	ensureAuthor
} from './comments.js';

import {
	clearSelectedCards,
	doSelectCards,
	refreshCardSelector,
	updateCollectionSnapshot,
} from './collection.js';

import {
	selectActiveSectionId,
	selectUser,
	selectUserIsAdmin,
	selectFilters,
	selectCards,
	selectDataIsFullyLoaded,
	selectCardIDsUserMayEdit,
	selectLastSectionID,
	getUserMayEditSection,
	selectUserMayCreateCard,
	selectPendingNewCardIDToNavigateTo,
	selectIsEditing,
	selectActiveCardID,
	getReasonUserMayNotDeleteCard,
	selectPendingDeletions,
	selectCardModificationPending,
	getCardById,
	selectMultiEditDialogOpen,
	selectSortOrderForGlobalAppend,
	getSortOrderImmediatelyAdjacentToCard,
	selectUserMayReorderActiveCollection,
	selectActiveCollectionDescription,
	selectRawCards,
	getUserMayEditTag,
	selectEditingCard,
	selectEnqueuedCards,
	selectPendingModificationCount,
	selectCompleteModeEnabled,
	selectCompleteModeRawCardLimit,
	selectCompleteModeEffectiveCardLimit,
	selectExpectedCardFetchTypeForNewUnpublishedCard
} from '../selectors.js';

import {
	INVERSE_FILTER_NAMES,
	SET_NAMES,
	SORT_URL_KEYWORD,
	CONFIGURABLE_FILTER_URL_PARTS,
	collectionDescription,
	SELECTED_FILTER_NAME,
} from '../filters.js';

import {
	PERMISSION_EDIT_CARD
} from '../permissions.js';

import {
	CARD_TYPE_CONFIGURATION,
	DEFAULT_CARD_TYPE,
	KEY_CARD_ID_PLACEHOLDER,
	editableFieldsForCardType,
	sortOrderIsDangerous,
	isNewCardIDPlaceholder,
	DEFAULT_SORT_ORDER_INCREMENT,
	COLORS
} from '../../shared/card_fields.js';

import {
	CARDS_COLLECTION,
	CARD_UPDATES_COLLECTION,
	SECTION_UPDATES_COLLECTION,
	SECTIONS_COLLECTION,
	TAGS_COLLECTION,
	TAG_UPDATES_COLLECTION,
	TWEETS_COLLECTION,
} from '../../shared/collection-constants.js';

import {
	EMPTY_CARD_ID
} from '../card_fields.js';

import {
	cardDiffHasChanges,
	validateCardDiff,
	applyCardDiff,
	applyCardFirebaseUpdate,
	inboundLinksUpdates,
	generateFinalCardDiff,
} from '../card_diff.js';

import {
	CARD_TYPE_EDITING_FINISHERS
} from '../card_finishers.js';

import {
	references,
} from '../references.js';

import {
	ThunkSomeAction,
	store
} from '../store.js';

import {
	MultiBatch
} from '../multi_batch.js';

import {
	State,
	CardDiff,
	Card,
	Cards,
	CardID,
	CardUpdate,
	CardType,
	UserInfo,
	SectionID,
	Slug,
	TagID,
	Sections,
	AuthorsMap,
	Tags,
	CardBooleanMap,
	CreateCardOpts,
	TweetMap,
	CardFetchType,
	CardFlags,
} from '../types.js';

import {
	COMMITTED_PENDING_FILTERS_WHEN_FULLY_LOADED,
	EXPECTED_NEW_CARD_FAILED,
	EXPECT_CARD_DELETIONS,
	EXPECT_NEW_CARD,
	EXPECT_FETCHED_CARDS,
	MODIFY_CARD,
	MODIFY_CARD_FAILURE,
	MODIFY_CARD_SUCCESS,
	NAVIGATED_TO_NEW_CARD,
	REMOVE_CARDS,
	REORDER_STATUS,
	SET_PENDING_SLUG,
	SomeAction,
	TWEETS_LOADING,
	UPDATE_AUTHORS,
	UPDATE_CARDS,
	UPDATE_SECTIONS,
	UPDATE_TAGS,
	UPDATE_TWEETS,
	ENQUEUE_CARD_UPDATES,
	BULK_IMPORT_PENDING,
	BULK_IMPORT_SUCCESS,
	CLEAR_ENQUEUED_CARD_UPDATES,
	TURN_COMPLETE_MODE
} from '../actions.js';

import {
	DEFAULT_PARTIAL_MODE_CARD_FETCH_LIMIT,
	FIRESTORE_MAXIMUM_LIMIT_CLAUSE,
	LOCAL_STORAGE_COMPLETE_MODE_KEY,
	LOCAL_STORAGE_COMPLETE_MODE_LIMIT_KEY
} from '../constants.js';

//map of cardID => promiseResolver that's waiting
const waitingForCards : {[id : CardID]: ((card : Card) => void)[]} = {};

const waitingForCardToExistStoreUpdated = () => {
	let itemDeleted = false;
	for (const cardID of Object.keys(waitingForCards)) {
		const card = getCardById(store.getState() as State, cardID);
		if (!card) continue;
		for (const promiseResolver of waitingForCards[cardID]) {
			promiseResolver(card);
		}
		delete waitingForCards[cardID];
		itemDeleted = true;
	}
	if (itemDeleted && Object.keys(waitingForCards).length == 0) {
		if (unsubscribeFromStore) unsubscribeFromStore();
		unsubscribeFromStore = null;
	}
};

export const toggleCompleteMode = () : ThunkSomeAction => (dispatch, getState) => {
	const completeMode = selectCompleteModeEnabled(getState());
	const limit = selectCompleteModeRawCardLimit(getState());
	dispatch(turnCompleteMode(!completeMode, limit));
};

export const modifyCompleteModeCardLimit = (limit : number) : ThunkSomeAction => (dispatch, getState) => {
	const currentLimit = selectCompleteModeRawCardLimit(getState());
	if (limit == currentLimit) return;
	const completeMode = selectCompleteModeEnabled(getState());
	dispatch(turnCompleteMode(completeMode, limit));
};

export const turnCompleteMode = (on : boolean, limit : number) : ThunkSomeAction => (dispatch, getState) => {

	//Limit of 0 means 'default'

	const state = getState();
	const alreadyActive = selectCompleteModeEnabled(state);
	if (limit > 0 && limit < DEFAULT_PARTIAL_MODE_CARD_FETCH_LIMIT) limit = DEFAULT_PARTIAL_MODE_CARD_FETCH_LIMIT;
	if (limit == DEFAULT_PARTIAL_MODE_CARD_FETCH_LIMIT) limit = 0;
	if (limit > FIRESTORE_MAXIMUM_LIMIT_CLAUSE) limit = FIRESTORE_MAXIMUM_LIMIT_CLAUSE;
	if (limit < 0) limit = 0;
	const activeLimit = selectCompleteModeRawCardLimit(state);
	if (on == alreadyActive && limit == activeLimit) return;

	localStorage.setItem(LOCAL_STORAGE_COMPLETE_MODE_KEY, on ? '1' : '0');
	localStorage.setItem(LOCAL_STORAGE_COMPLETE_MODE_LIMIT_KEY, '' + limit);

	dispatch({
		type: TURN_COMPLETE_MODE,
		on,
		limit
	});


	//If we're turning off complete mode, we need to cull any cards that are
	//in complete mode that shouldn	't be. This will be a no-op if complete mode is on.
	dispatch(cullExtraCompleteModeCards());

};

const cullExtraCompleteModeCards = () : ThunkSomeAction => (dispatch, getState) => {
	//This logic should approximate the selection logic in connectLiveUnpublishedCards.

	const state = getState();
	const cards = selectRawCards(state);
	const completeMode = selectCompleteModeEnabled(state);
	
	//No cards to cull because  we're in complete mode.
	if (completeMode) return;

	const limit = selectCompleteModeEffectiveCardLimit(state);

	const unpublishedCardIDs = Object.values(cards).filter(card => !card.published).sort((a, b) => b.created.seconds - a.created.seconds).map(card => card.id);

	if (unpublishedCardIDs.length <= limit) return;

	const cardsToCull = unpublishedCardIDs.slice(limit);

	dispatch(cullCards(cardsToCull));
	dispatch(refreshCardSelector(true));

};

export const loadSavedCompleteModePreference = () : ThunkSomeAction => (dispatch) => {
	const value = localStorage.getItem(LOCAL_STORAGE_COMPLETE_MODE_KEY);
	let limit = parseInt(localStorage.getItem(LOCAL_STORAGE_COMPLETE_MODE_LIMIT_KEY) || '0');
	if (isNaN(limit)) limit = 0;
	if (limit < 0) limit = 0;
	if (value == '1' || limit > 0) {
		dispatch(turnCompleteMode(value == '1', limit));
	}
};

let unsubscribeFromStore : (() => void) | null = null;

//returns a promise that will be resolved when a card with that ID exists, returning the card.
export const waitForCardToExist = (cardID : CardID) => {
	const card = getCardById(store.getState() as State, cardID);
	if (card) return Promise.resolve(card);
	if (!waitingForCards[cardID]) waitingForCards[cardID] = [];
	if (!unsubscribeFromStore) unsubscribeFromStore = store.subscribe(waitingForCardToExistStoreUpdated);
	const promise = new Promise<Card>((resolve) => {
		waitingForCards[cardID].push(resolve);
	});
	return promise;
};

//When a new tag is created, it is randomly assigned one of these values.
const TAG_COLORS = Object.values(COLORS);

export const modifyCard = (card : Card, update : CardDiff, substantive = false) => {
	return modifyCards([card], update, substantive, true);
};

export const modifyCards = (cards : Card[], update : CardDiff, substantive = false, failOnError = false) => {
	const updates = Object.fromEntries(cards.map(card => [card.id, update]));
	return modifyCardsIndividually(cards, updates, substantive, failOnError);
};

export const modifyCardsIndividually = (cards : Card[], updates : {[id : CardID] : CardDiff}, substantive = false, failOnError = false) : ThunkSomeAction => async (dispatch, getState) => {
	const state = getState();

	if (selectCardModificationPending(state)) {
		console.log('Can\'t modify card; another card is being modified.');
		return;
	}

	cards.forEach((card) => {
		if (!updates[card.id]) {
			//We throw even if failOnError is false because this is something that affects all cards
			throw new Error(`Missing update for ${card.id}`);
		}
	});

	dispatch(modifyCardAction(Object.keys(updates).length));

	const batch = new MultiBatch(db);
	let modifiedCount = 0;
	let errorCount = 0;

	for (const card of cards) {

		if (!card || !card.id) {
			console.log('No id on card');
			if (failOnError) return;
			continue;
		}

		const update = updates[card.id];

		//This shouldn't happen since we verified it above, but tell typescript
		//we know there's an update.
		if (!update) continue;

		try {
			const bool = await modifyCardWithBatch(state, card, update, substantive, batch);
			if (bool) modifiedCount++;
		} catch (err) {
			console.warn('Couldn\'t modify card: ' + err);
			errorCount++;
			if (failOnError) {
				dispatch(modifyCardFailure(err));
				return;
			}
		}
	}

	try {
		await batch.commit();
	} catch(err) {
		dispatch(modifyCardFailure(new Error('Couldn\'t save card: ' + err)));
		return;
	}

	if (modifiedCount > 1 || errorCount > 0) alert('' + modifiedCount + ' cards modified.' + (errorCount > 0 ? '' + errorCount + ' cards errored. See the console for why.' : ''));

	dispatch(modifyCardSuccess());
};

//returns true if a modificatioon was made to the card, or false if it was a no
//op. When an error is thrown, that's an implied 'false'.
export const modifyCardWithBatch = async (state : State, card : Card, rawUpdate : CardDiff, substantive : boolean, batch : MultiBatch) : Promise<boolean> => {

	//If there aren't any updates to a card, that's OK. This might happen in a
	//multiModify where some cards already have the items, for example.
	if (!cardDiffHasChanges(rawUpdate)) return false;

	const user = selectUser(state);

	if (!user) {
		throw new Error('No user');
	}

	if (!selectCardIDsUserMayEdit(state)[card.id]) {
		throw new Error('User isn\'t allowed to edit the given card');
	}

	//This is where cardFinishers and fontSizeBoosts are actually applied.
	const update = await generateFinalCardDiff(state, card, rawUpdate);

	const updateObject = {
		...update,
		batch: batch.batchID || '',
		substantive: substantive,
		timestamp: serverTimestamp()
	};

	//validateDiff might throw, but that's OK, because we also throw
	const sectionUpdated = validateCardDiff(state, card, update);

	const cardUpdateObject = applyCardDiff(card, update);
	cardUpdateObject.updated = serverTimestamp();
	if (substantive) cardUpdateObject.updated_substantive = serverTimestamp();

	const existingCards = selectCards(state);
	const updatedCard = applyCardFirebaseUpdate(card, cardUpdateObject);
	const inboundUpdates = inboundLinksUpdates(card.id, card, updatedCard);
	for (const otherCardID of Object.keys(inboundUpdates)) {
		//We need to throw BEFORE adding any updates to batch, so check now for
		//any references to cards we can't see now.
		if (!existingCards[otherCardID]) throw new Error(otherCardID + 'is in the reference update but does not already exist');
	}

	const cardRef = doc(db, CARDS_COLLECTION, card.id);

	const updateRef = doc(cardRef, CARD_UPDATES_COLLECTION, '' + Date.now());

	batch.set(updateRef, updateObject);
	batch.update(cardRef, cardUpdateObject);

	for (const [otherCardID, otherCardUpdate] of TypedObject.entries(inboundUpdates)) {
		const ref = doc(db, CARDS_COLLECTION, otherCardID);
		batch.update(ref, otherCardUpdate);
	}

	ensureAuthor(batch, user);

	if (sectionUpdated) {
		//Need to update the section objects too.
		const newSection = cardUpdateObject.section;
		if (newSection) {
			const newSectionRef = doc(db, SECTIONS_COLLECTION, newSection);
			const newSectionUpdateRef = doc(newSectionRef, SECTION_UPDATES_COLLECTION, '' + Date.now());
			const newSectionObject = {
				cards: arrayUnion(card.id),
				updated: serverTimestamp()
			};
			const newSectionUpdateObject = {
				timestamp: serverTimestamp(),
				add_card: card.id
			};
			batch.update(newSectionRef, newSectionObject);
			batch.set(newSectionUpdateRef, newSectionUpdateObject);
		}
		const oldSection = card.section;
		if (oldSection) {
			const oldSectionRef = doc(db, SECTIONS_COLLECTION, oldSection);
			const oldSectionUpdateRef = doc(oldSectionRef, SECTION_UPDATES_COLLECTION, '' + Date.now());
			const oldSectionObject = {
				cards: arrayRemove(card.id),
				updated: serverTimestamp()
			};
			const oldSectionUpdateObject = {
				timestamp: serverTimestamp(),
				remove_card: card.id
			};
			batch.update(oldSectionRef, oldSectionObject);
			batch.set(oldSectionUpdateRef, oldSectionUpdateObject);
		}
	}

	if (update.add_tags && update.add_tags.length) {
		//Note: similar logic is replicated in createForkedCard
		for (const tagName of update.add_tags) {
			const tagRef = doc(db, TAGS_COLLECTION, tagName);
			const tagUpdateRef = doc(tagRef, TAG_UPDATES_COLLECTION, '' + Date.now());
			const newTagObject = {
				cards: arrayUnion(card.id),
				updated: serverTimestamp()
			};
			const newTagUpdateObject = {
				timestamp: serverTimestamp(),
				add_card: card.id
			};
			batch.update(tagRef, newTagObject);
			batch.set(tagUpdateRef, newTagUpdateObject);
		}
	}

	if (update.remove_tags && update.remove_tags.length) {
		for (const tagName of update.remove_tags) {
			const tagRef = doc(db, TAGS_COLLECTION, tagName);
			const tagUpdateRef = doc(tagRef, TAG_UPDATES_COLLECTION, '' + Date.now());
			const newTagObject = {
				cards: arrayRemove(card.id),
				updated: serverTimestamp()
			};
			const newTagUpdateObject = {
				timestamp: serverTimestamp(),
				remove_card: card.id
			};
			batch.update(tagRef, newTagObject);
			batch.set(tagUpdateRef, newTagUpdateObject);
		}
	}

	return true;

};

//beforeID is the ID of hte card we should place ourselves immediately before.
export const reorderCard = (cardID : CardID, otherID: CardID, isAfter : boolean) : ThunkSomeAction => async (dispatch, getState) => {

	const state = getState();

	if (!cardID) {
		console.log('That card isn\'t valid');
		return;
	}

	if (cardID == otherID) {
		console.log('Dropping into the same position it is now, which is a no op');
		return;
	}

	if (!selectUserMayReorderActiveCollection(state)) {
		console.log('Reordering the current collection is not allowed');
		return;
	}

	const collectionDescription = selectActiveCollectionDescription(state);

	if (collectionDescription.sortReversed) isAfter = !isAfter;

	const newSortOrder = getSortOrderImmediatelyAdjacentToCard(state, otherID, !isAfter);

	if (sortOrderIsDangerous(newSortOrder)) {
		console.warn('Dangerous sort order proposed: ', newSortOrder, ' See issue #199');
		return;
	}

	dispatch(reorderStatus(true));

	const batch = new MultiBatch(db);
	const update = {
		sort_order: newSortOrder,
	};

	const cards = selectCards(state);
	const card = cards[cardID];

	modifyCardWithBatch(state, card, update, false, batch);

	try {
		await batch.commit();
	} catch(err) {
		console.warn(err);
	}
	dispatch(reorderStatus(false));

	//We don't need to tell the store anything, because firestore will tell it
	//automatically.

};

const setPendingSlug = (slug : Slug) : SomeAction => {
	return {
		type:SET_PENDING_SLUG,
		slug
	};
};

const addLegalSlugToCard = (cardID : CardID, legalSlug : Slug, setName? : boolean) : Promise<void[]> => {
	//legalSlug must already be verified to be legal.
	const batch = new MultiBatch(db);
	const cardRef = doc(db, CARDS_COLLECTION, cardID);
	const update : CardUpdate = {
		slugs: arrayUnion(legalSlug),
		updated: serverTimestamp(),
	};
	if (setName) update.name = legalSlug;
	batch.update(cardRef, update);
	return batch.commit();
};

export const addSlug = (cardId : CardID, newSlug : Slug) : ThunkSomeAction => async (dispatch, getState) => {
 
	newSlug = normalizeSlug(newSlug);

	if (!newSlug) {
		console.log('Must provide a legal slug');
		return;
	}

	const state = getState();
	const editingCard = selectEditingCard(state);
	if (!editingCard) throw new Error('No editing card');
	const isEditingCard = editingCard.id == cardId;

	//slugLegal is a http callable, and it might take multiple seconds if the
	//cloud function is cold.
	dispatch(setPendingSlug(newSlug));

	let result;
	try {
		result = await slugLegal(newSlug);
	} catch(err) {
		dispatch(setPendingSlug(''));
		console.warn(err);
		return;
	}

	if (!result.legal) {
		alert('Couldn\'t add slug: ' + result.reason);
		dispatch(setPendingSlug(''));
		return;
	}

	await addLegalSlugToCard(cardId, newSlug, false);

	dispatch(setPendingSlug(''));

	if (isEditingCard) {
		//We're editing this card, update it in the state.
		dispatch(slugAdded(newSlug));
	}

};

const reservedCollectionName = (state : State, name : string) : boolean => {

	if (!selectDataIsFullyLoaded(state)) {
		console.warn('Sections not loaded');
		return true;
	}

	if (name == SORT_URL_KEYWORD) return true;
	if (name == KEY_CARD_ID_PLACEHOLDER) return true;
	if (isNewCardIDPlaceholder(name)) return true;

	//Filters already contains section names if data is fully loaded.
	const filters = selectFilters(state) || {};

	const keys = [...Object.keys(filters), ...Object.keys(INVERSE_FILTER_NAMES), ...SET_NAMES, ...Object.keys(CONFIGURABLE_FILTER_URL_PARTS)];

	for (const key of keys) {
		if (name == key) return true;
	}
	return false;
};

export const createTag = (name : TagID, displayName : string) : ThunkSomeAction => async (dispatch, getState) => {

	if (!name) {
		console.warn('No short name provided');
		return;
	}

	name = normalizeSlug(name);

	const state = getState();

	if (reservedCollectionName(state, name)) {
		console.warn('That name is reserved');
		return;
	}

	if (!name) {
		console.warn('Tag name invalid');
		return;
	}

	if (!displayName) {
		console.warn('No short name provided');
		return;
	}

	const user = selectUser(state);

	if (!user) {
		console.warn('No user logged in');
		return;
	}

	if (!selectUserIsAdmin(state)) {
		console.log('User isn\'t admin!');
		return;
	}

	const tagRef = doc(db, TAGS_COLLECTION, name);

	const tag = await getDoc(tagRef);

	if (tag.exists()) {
		console.warn('A tag with that name already exists');
		return;
	}

	const startCardId = 'tag-' + name;
	const startCardRef = doc(db, CARDS_COLLECTION, startCardId);

	const card = await getDoc(startCardRef);

	if (card.exists()) {
		console.warn('A card with that id already exists');
		return;
	}

	//Randomly pick a tag color to start with. If an admin wants to edit it they
	//can just edit it by hand in the DB.
	const color = TAG_COLORS[Math.floor(Math.random() * TAG_COLORS.length)];

	const batch = new MultiBatch(db);

	batch.set(tagRef, {
		cards: [],
		start_cards: [startCardId],
		title:displayName,
		updated: serverTimestamp(),
		color: color,
	});

	const cardObject = defaultCardObject(startCardId, user, '', 'section-head', selectSortOrderForGlobalAppend(state));
	cardObject.title = displayName;
	cardObject.subtitle = displayName + ' is a topical tag';
	cardObject.published = true;

	batch.set(startCardRef, cardObject);

	batch.commit().then(() => dispatch(tagAdded(name)));

};

//This omits fields that are already covered in defaultCardObject's arguments
const CARD_FIELDS_TO_COPY_ON_FORK : Partial<Record<keyof Card, true>> = {
	permissions: true,
	title: true,
	body: true,
	references_info: true,
	references: true,
	font_size_boost: true,
	notes: true,
	todo: true,
	tags: true,
};

//exported entireoly for initialSetUp in maintence.js
export const defaultCardObject = (id : CardID, user : UserInfo, section : SectionID, cardType : CardType, sortOrder : number) : Card => {
	return {
		id : '?DEFAULT-INVALID-ID?',
		created: serverTimestampSentinel(),
		updated: serverTimestampSentinel(),
		author: user.uid,
		permissions: {
			[PERMISSION_EDIT_CARD]: [],
		},
		collaborators: [],
		updated_substantive: serverTimestampSentinel(),
		updated_message: serverTimestampSentinel(),
		star_count: 0,
		star_count_manual: 0,
		tweet_favorite_count: 0,
		tweet_retweet_count: 0,
		thread_count: 0,
		thread_resolved_count: 0,
		sort_order: sortOrder,
		title: '',
		section: section,
		body: '',
		references: {},
		references_info: {},
		references_inbound: {},
		references_info_inbound: {},
		flags: {},
		font_size_boost: {},
		card_type: cardType,
		notes: '',
		todo: '',
		slugs: [],
		name: id,
		tags: [],
		published: false,
		images: [],
		auto_todo_overrides: {},
		last_tweeted: Timestamp.fromDate(new Date(0)),
		tweet_count: 0
	};
};

export const bulkCreateWorkingNotes = (bodies : string[], flags? : CardFlags) : ThunkSomeAction => async (dispatch, getState) => {
	const WORKING_NOTES_CONFIG = CARD_TYPE_CONFIGURATION['working-notes'];
	//Sanity check that working-notes is configured in a way we expect.
	if (!WORKING_NOTES_CONFIG) throw new Error('No working notes config');
	if (WORKING_NOTES_CONFIG.publishedByDefault) throw new Error('Working notes are not published by default');
	if (!WORKING_NOTES_CONFIG.orphanedByDefault) throw new Error('Working notes are not orphaned by default');
	const cardFinisher = CARD_TYPE_EDITING_FINISHERS['working-notes'];
	if (!cardFinisher) throw new Error('Working notes didn\'t a card finisher');

	if (bodies.length == 0) return;

	const state = getState();
	if (!selectUserMayCreateCard(state)) throw new Error('User may not create cards');

	const user = selectUser(state);
	if (!user) throw new Error('No user');

	dispatch({
		type: BULK_IMPORT_PENDING
	});

	const batch = new MultiBatch(db);
	ensureAuthor(batch, user);

	const ids : CardID[] = [];

	let sortOrder = selectSortOrderForGlobalAppend(state);

	for (const body of bodies) {
		const id = newID();
		if (sortOrderIsDangerous(sortOrder)) {
			console.warn('Dangerous sort order proposed: ', sortOrder, sortOrder / Number.MAX_VALUE, ' See issue #199');
			return;
		}
		const obj = defaultCardObject(id, user, '', 'working-notes', sortOrder);
		obj.body = body;
		cardFinisher(obj, state);
		if (flags) obj.flags = {...flags};
		batch.set(doc(db, CARDS_COLLECTION, id), obj);
		ids.push(id);
		sortOrder -= DEFAULT_SORT_ORDER_INCREMENT;
	}

	const firstID = ids[0];

	//Tell card-view to expect a new card to be loaded, so the machinery to wait
	//for the new cards works.
	dispatch({
		type: EXPECT_NEW_CARD,
		//We'll only tell it to expect the first one, since they'll all come
		//back in one batch anyway.
		ID: firstID,
		cardType: 'working-notes',
		navigate: false,
		noSectionChange: true,
		cardLoadingChannel: selectExpectedCardFetchTypeForNewUnpublishedCard(state)
	});

	await batch.commit();

	await waitForCardToExist(firstID);

	dispatch(clearSelectedCards());
	dispatch(doSelectCards(ids));
	
	dispatch({
		type: BULK_IMPORT_SUCCESS
	});

	const selectedCards = collectionDescription(SELECTED_FILTER_NAME);
	dispatch(navigateToCollection(selectedCards));

};

//createCard creates an inserts a new card. see also createWorkingNotesCard
//which is similar but simpler.
//Valid arguments of opts:
// cardType: type of card
// section: sectionID to add to
// id: ID to use
// noNavigate: if true, will not navigate to the card when created
// title: title of card

export const createCard = (opts : CreateCardOpts) : ThunkSomeAction => async (dispatch, getState) => {

	//NOTE: if you modify this card you may also want to modify createForkedCard and bulkCreateWorkingNotes

	//newCard creates and inserts a new card in the givne section with the given id.

	const state = getState();

	const user = selectUser(state);

	if (!user) {
		console.log('No user');
		return;
	}

	if (!selectUserMayCreateCard(state)) {
		console.log('User isn\'t allowed to create card');
		return;
	}

	const cardType : CardType = opts.cardType || DEFAULT_CARD_TYPE;

	const CARD_TYPE_CONFIG = CARD_TYPE_CONFIGURATION[cardType] || null;
	if (!CARD_TYPE_CONFIG) {
		console.log('Invalid cardType: ' + cardType);
		return;
	}

	//if section is not provided, use the last section... unless it's a card
	//type that is orphaned by default, in which case we should not put it in a
	//section at all.
	let section = opts.section || '';
	
	if (!section && !CARD_TYPE_CONFIG.orphanedByDefault) {
		section = selectLastSectionID(state);
	}

	if (!section && !CARD_TYPE_CONFIG.orphanedByDefault) {
		console.log('No section identified for a card type that is not orphaned by default');
		return;
	}

	let id = opts.id;
	const idFromOpts = opts.id !== undefined;

	if (id) {
		id = normalizeSlug(id);
	} else {
		id = newID();
	}

	const noNavigate = opts.noNavigate || false;

	let title = opts.title || '';

	if (CARD_TYPE_CONFIG.publishedByDefault && editableFieldsForCardType(cardType).title && !title) {
		const titleFromPrompt = prompt('What should the card\'s title be?');
		if (!titleFromPrompt) {
			console.log('No title provided');
			return;
		}
		title = titleFromPrompt;
	}

	if (section && !getUserMayEditSection(state, section)) {
		console.log('User doesn\'t have edit permission for section the card will be added to.');
		return;
	}

	let sortOrder = selectSortOrderForGlobalAppend(state);
	if (section && selectActiveSectionId(state) == section) {
		sortOrder = getSortOrderImmediatelyAdjacentToCard(state, selectActiveCardID(state), false);
	}

	if (sortOrderIsDangerous(sortOrder)) {
		console.warn('Dangerous sort order proposed: ', sortOrder, sortOrder / Number.MAX_VALUE, ' See issue #199');
		return;
	}

	const obj = defaultCardObject(id, user, section, cardType, sortOrder);
	obj.title = title;
	if (CARD_TYPE_CONFIG.publishedByDefault) obj.published = true;
	if (CARD_TYPE_CONFIG.defaultBody) obj.body = CARD_TYPE_CONFIG.defaultBody;
	if (opts.body !== undefined) obj.body = opts.body;

	const cardFinisher = CARD_TYPE_EDITING_FINISHERS[cardType];

	if (cardFinisher) {
		try {
			cardFinisher(obj, state);
		} catch(err) {
			alert(err);
			console.warn('Card finisher threw an error');
			return;
		}
	}

	const autoSlugConfig = opts.autoSlug !== undefined ? opts.autoSlug : CARD_TYPE_CONFIG.autoSlug;

	let autoSlug = '';
	let fallbackAutoSlug = '';
	if (autoSlugConfig) {
		autoSlug = createSlugFromArbitraryString(title);
		fallbackAutoSlug = normalizeSlug(cardType + '-' + autoSlug);
		if (autoSlugConfig == 'prefixed') {
			//Don't even try the non-card prefixed one.
			autoSlug = fallbackAutoSlug;
			fallbackAutoSlug = '';
		}
	}

	if (CARD_TYPE_CONFIG.publishedByDefault && autoSlugConfig) {
		if (!confirm(`You're creating a card that will be published by default and have its slug set automatically. Is it spelled correctly?\n\nTitle: ${title}\nSlug: ${autoSlug}${fallbackAutoSlug ? `\nAlternate Slug: ${fallbackAutoSlug}` : ''}\n\nDo you want to proceed?`)) {
			console.log('Aborted by user');
			return;
		}
	}

	const cardDocRef = doc(db, CARDS_COLLECTION, id);

	//Tell card-view to expect a new card to be loaded, and when data is
	//fully loaded again, it will then trigger the navigation.
	dispatch({
		type: EXPECT_NEW_CARD,
		ID: id,
		cardType: cardType,
		navigate: !noNavigate,
		noSectionChange: !section,
		cardLoadingChannel: obj.published ? 'published' : selectExpectedCardFetchTypeForNewUnpublishedCard(state)
	});

	if (idFromOpts && !idWasVended(id)) {

		//Checking id is legal is a very expensive operation. If we generated
		//our own id via newID we can just assume it's safe and doesn't conflict
		//with existing ones due to sufficient entropy.

		//Check to make sure the ID is legal. Note that the id and slugs are in the
		//same ID space, so we can reuse slugLegal. Note that slugLegal could take
		//up to 10 seconds to complete if the cloud function is not pre-warmed.
		const result = await slugLegal(id);
		if (!result.legal) {
			console.log('ID is already taken: ' + result.reason);
			if (!noNavigate) {
				//Tell it to not expect the card to be inserted anymore
				dispatch({
					type:EXPECTED_NEW_CARD_FAILED,
				});
			}
			return;
		}
	}

	let autoSlugLegalPromise = null;
	let fallbackAutoSlugLegalPromise = null;
	if (autoSlugConfig) {
		//Kick this off in parallel. We'll await it later.
		autoSlugLegalPromise = slugLegal(autoSlug);
		fallbackAutoSlugLegalPromise = fallbackAutoSlug ?  slugLegal(fallbackAutoSlug) : null;
	}

	const batch = new MultiBatch(db);

	ensureAuthor(batch, user);
	batch.set(cardDocRef, obj);

	if (section) {
		const sectionRef = doc(db, SECTIONS_COLLECTION, obj.section);
		const sectionUpdateRef = doc(sectionRef, SECTION_UPDATES_COLLECTION, '' + Date.now());
		batch.update(sectionRef, {
			cards: arrayUnion(id),
			updated: serverTimestamp(),
		});
		batch.set(sectionUpdateRef, {
			timestamp: serverTimestamp(), 
			add_card: id
		});
	}

	try {
		await batch.commit();
	} catch (err) {
		console.warn(err);
		dispatch({type: EXPECTED_NEW_CARD_FAILED});
	}

	//updateSections will be called and update the current view. card-view's
	//updated will call navigateToNewCard once the data is fully loaded again
	//(if EXPECT_NEW_CARD was dispatched above). If noSectionChange is true
	//above, it will only wait for the card, not the section, to load.

	if (!autoSlug) return;

	await waitForCardToExist(id);
	const autoSlugLegalResult = await autoSlugLegalPromise;
	const fallbackAutoSlugLegalResult = fallbackAutoSlugLegalPromise ? await fallbackAutoSlugLegalPromise : null;

	if (autoSlugLegalResult && !autoSlugLegalResult.legal) {
		if (!fallbackAutoSlug || (fallbackAutoSlugLegalResult && !fallbackAutoSlugLegalResult.legal)) {
			console.warn(`The autoSlug, ${autoSlug} ${fallbackAutoSlug ? `(and its fallback ${fallbackAutoSlug}) ` : ''}was not legal, so it will not be proposed. Reason: ${autoSlugLegalResult.reason}${fallbackAutoSlugLegalResult ? `and ${fallbackAutoSlugLegalResult.reason}` : ''}`);
			return;
		}
	}

	const slugToUse = (autoSlugLegalResult && autoSlugLegalResult.legal) ? autoSlug : fallbackAutoSlug;

	//Just triple check that we didn't fall back on a non-existent fallbackAutoSlug.
	if (!slugToUse) return;

	try {
		await addLegalSlugToCard(id, slugToUse, true);
	} catch(err) {
		console.warn('Couldn\'t add slug to card: ' + err);
	}

};

export const createForkedCard = (cardToFork : Card | null) : ThunkSomeAction => async (dispatch, getState) => {
	//NOTE: if you modify this card you likely also want to modify
	//createWorkingNotesCard too and likely also createForkedCard

	//newCard creates and inserts a new card in the givne section with the given id.
	if (typeof cardToFork !== 'object' || !cardToFork) {
		console.warn('cardToFork wasn\'t valid object');
		return;
	}

	if (!confirm('This will create a forked copy of the current card. OK?')) return;

	const state = getState();

	const id = newID();

	const section = cardToFork.section;
	const cardType = cardToFork.card_type;

	if (!getUserMayEditSection(state, section)) {
		console.log('User doesn\'t have edit permission for section the card will be added to.');
		return;
	}

	const user = selectUser(state);

	if (!user) {
		console.log('No user');
		return;
	}

	if (!selectUserMayCreateCard(state)) {
		console.log('User isn\'t allowed to create card');
		return;
	}

	const sortOrder = getSortOrderImmediatelyAdjacentToCard(state, cardToFork.id, false);

	const newCard = defaultCardObject(id,user,section,cardType, sortOrder);
	for (const key of TypedObject.keys(CARD_FIELDS_TO_COPY_ON_FORK)) {
		//We can literally leave these as the same object because they'll just
		//be sent to firestore and the actual card we'll store will be new
		
		//eslint-disable-next-line @typescript-eslint/no-explicit-any
		(newCard as any)[key] = cardToFork[key] as any;
	}
	//references accessor will copy the references on setting something
	//If the card we're copying was itself a fork, we want to overwrite that otherwise it gets confusing.
	references(newCard).setCardReferencesOfType('fork-of', [cardToFork.id]);
	references(newCard).setCardReference(cardToFork.id, 'mined-from');

	let inboundUpdates = inboundLinksUpdates(id, null, newCard);
	const existingCards = selectCards(state);
	const illegalOtherCards : CardBooleanMap = {};
	//We need to check for illegal other cards BEFORE adding any updates to
	//batch, so check now for any references to cards we can't see now.
	for (const otherCardID of Object.keys(inboundUpdates)) {
		if (!existingCards[otherCardID]) illegalOtherCards[otherCardID] = true;
	}

	if (Object.keys(illegalOtherCards).length) {

		//We can forcibly remove most references to illegal cards in the next
		//step, but not link references (which are fully implied by links in
		//body), so verify none of the illegal card IDs are from links.
		const linkReferences = references(newCard).byType.link || {};
		for (const otherCardID of Object.keys(illegalOtherCards)) {
			if (linkReferences[otherCardID]) {
				alert('The card you are trying to fork links to a card that you do not have access to: ' + otherCardID + '. To fork the card, remove that link and try again.');
				return;
			}
		}

		const message = 'The card you are forking contains references to cards (' + Object.keys(illegalOtherCards).join(', ') + ') that you don\'t have access to. Hit OK to continue forking the card, but elide those illegal references, or cancel to cancel the fork.';
		if (!confirm(message)) {
			console.log('User aborted fork due to illegal other cards');
			return;
		}
		for (const otherCardID of Object.keys(illegalOtherCards)) {
			references(newCard).removeAllReferencesForCard(otherCardID);
		}

		//Regenerate, now that we've removed the illegal ones.
		inboundUpdates = inboundLinksUpdates(id, null, newCard);

	}

	const illegalTags : {[tag : TagID] : true} = {};
	for (const tag of cardToFork.tags) {
		if (!getUserMayEditTag(state, tag)) illegalTags[tag] = true;
	}

	if (Object.keys(illegalTags).length) {
		const message = 'The card you are forking contains tags (' + Object.keys(illegalTags).join(', ') + ') that you do not have edit access on. Hit OK to fork the card, minus those tags. Hit cancel to abort forking.';
		if (!confirm(message)) {
			console.log('User aborted fork due to illegal tags');
			return;
		}
		//newCard.tags could TECHNICALLY be a FieldValue (e.g. an arrayUnion).
		if (Array.isArray(newCard.tags)) {
			newCard.tags = newCard.tags.filter(tag => !illegalTags[tag]);
		}
	}

	const cardDocRef = doc(db, CARDS_COLLECTION, id);

	//Tell card-view to expect a new card to be loaded, and when data is
	//fully loaded again, it will then trigger the navigation.
	dispatch({
		type: EXPECT_NEW_CARD,
		ID: id,
		cardType: cardType,
		navigate: true,
		noSectionChange: !section,
		cardLoadingChannel: newCard.published ? 'published' : selectExpectedCardFetchTypeForNewUnpublishedCard(state)
	});

	const batch = new MultiBatch(db);
	ensureAuthor(batch, user);

	batch.set(cardDocRef, newCard);

	for (const [otherCardID, otherCardUpdate] of Object.entries(inboundUpdates)) {
		const ref = doc(db, CARDS_COLLECTION, otherCardID);
		batch.update(ref, otherCardUpdate);
	}
	if (Array.isArray(newCard.tags)) {
		for (const tagName of newCard.tags) {
			const tagRef = doc(db, TAGS_COLLECTION, tagName);
			const tagUpdateRef = doc(tagRef, TAG_UPDATES_COLLECTION, '' + Date.now());
			const newTagObject = {
				cards: arrayUnion(id),
				updated: serverTimestamp()
			};
			const newTagUpdateObject = {
				timestamp: serverTimestamp(),
				add_card: id,
			};
			batch.update(tagRef, newTagObject);
			batch.set(tagUpdateRef, newTagUpdateObject);
		}
	}

	if (section) {
		const sectionRef = doc(db, SECTIONS_COLLECTION, newCard.section);
		batch.update(sectionRef, {
			cards: arrayUnion(id),
			updated: serverTimestamp()
		});
		const sectionUpdateRef = doc(sectionRef, SECTION_UPDATES_COLLECTION, '' + Date.now());
		batch.set(sectionUpdateRef, {
			timestamp: serverTimestamp(), 
			add_card: id,
		});
	}

	batch.commit();
	return;


	//updateSections will be called and update the current view. card-view's
	//updated will call navigateToNewCard once the data is fully loaded again
	//(if EXPECT_NEW_CARD was dispatched above)
};

export const deleteCard = (card : Card) : ThunkSomeAction => async (dispatch, getState) => {

	const state = getState();

	const reason = getReasonUserMayNotDeleteCard(state, card);

	if (reason) {
		console.warn(reason);
		return;
	}

	if (!confirm('Are you sure you want to delete this card? This action cannot be undone.')) {
		return;
	}

	//If editing, cancel editing
	if (selectIsEditing(state)) {
		dispatch(editingFinish());
	}

	if (selectActiveCardID(state) == card.id) {
		//If we're currently selected, then when we're deleted it will say 'no card found'.
		dispatch(navigateToNextCard());
	}

	const batch = new MultiBatch(db);
	const ref = doc(db, CARDS_COLLECTION, card.id);
	const updates = await getDocs(collection(ref, CARD_UPDATES_COLLECTION));
	for (const update of updates.docs) {
		batch.delete(update.ref);
	}
	batch.delete(ref);
	batch.commit();

	//Tell the system to expect those cards to be deleted.
	dispatch({
		type: EXPECT_CARD_DELETIONS,
		cards: {
			[card.id]: true,
		}
	});

	//The card update will lead to removeCards being called later

};

export const navigateToNewCard = () : ThunkSomeAction => (dispatch, getState) => {
	const ID = selectPendingNewCardIDToNavigateTo(getState());
	if (!ID) return;
	//navigateToNewCard is called when the expected cards/sections are loaded.
	//Ensure that we have the up-to-date sections loaded. The case of adding a
	//card to the current secitno works fine because updateSections will have
	//called refreshCardSelector with force. But it doesn't work automatically
	//for working-notes being added when viewinng working ntoes, since those
	//cards are all oprhaned.
	dispatch(updateCollectionSnapshot());
	//navigateToCard will intiate a chain of actions that culminates in
	//showCard, where we will note that we navigated to new card so we don't do
	//it again.
	dispatch(navigateToCardInCurrentCollection(ID));
};

export const navigatedToNewCard = () : SomeAction => {
	return {
		type:NAVIGATED_TO_NEW_CARD,
	};
};

const modifyCardAction = (modificationCount : number) : SomeAction => {
	return {
		type: MODIFY_CARD,
		modificationCount
	};
};

const modifyCardSuccess = () : ThunkSomeAction => (dispatch, getState) => {
	const state = getState();
	if (selectIsEditing(state)) {
		dispatch(editingFinish());
	}
	if (selectMultiEditDialogOpen(state)) {
		dispatch(closeMultiEditDialog());
	}
	dispatch({
		type:MODIFY_CARD_SUCCESS,
	});
};

const modifyCardFailure = (err : Error, skipAlert? : boolean) : SomeAction => {
	if (skipAlert) {
		console.warn(err);
	} else {
		alert(err);
	}
	return {
		type: MODIFY_CARD_FAILURE,
		error: err,
	};
};

export const reorderStatus = (pending : boolean) : SomeAction => {
	return {
		type: REORDER_STATUS,
		pending
	};
};

export const updateSections = (sections : Sections) : ThunkSomeAction => (dispatch, getState) => {
	dispatch({
		type: UPDATE_SECTIONS,
		sections,
	});

	//If the update is a single section updating and it's the one currently
	//visible then we should update collections. This could happen for example
	//if a new card is added, or if cards are reordered.
	const currentSectionId = selectActiveSectionId(getState());
	const force = Object.keys(sections).length == 1 && sections[currentSectionId] !== undefined;

	dispatch(refreshCardSelector(force));
};

export const updateAuthors = (authors : AuthorsMap) : ThunkSomeAction => (dispatch, getState) => {

	const state = getState();

	const user = selectUser(state);

	if (user && user.uid) {
		const authorRec = authors[user.uid];
		if (authorRec) {
			if ((!authorRec.displayName || !authorRec.photoURL) && (user.displayName || user.photoURL)) {
				//there's an author rec for our user, but it's missing
				//displayName or photoURL, and we have them. This could happen
				//if a user was manually listed as a collaborator or editor
				//without already being in the authors table. We should ensure
				//author!
				console.log('Saving extra author information because our authors rec was missing it');
				const batch = new MultiBatch(db);
				ensureAuthor(batch, user);
				//don't need to wait for it resolve
				batch.commit();
			}
		}
	}

	dispatch({
		type: UPDATE_AUTHORS,
		authors
	});
};

export const updateTags = (tags : Tags) : ThunkSomeAction => (dispatch) => {
	dispatch({
		type:UPDATE_TAGS,
		tags,
	});
	dispatch(refreshCardSelector(false));
};

export const receiveCards = (cards: Cards, fetchType : CardFetchType) : ThunkSomeAction => (dispatch, getState) => {
	const existingCards = selectRawCards(getState());
	const cardsToUpdate : Cards = {};
	for (const card of Object.values(cards)) {
		//Check ot see if we already have effectively the same card locally with no notional changes.
		if (existingCards[card.id] && deepEqualIgnoringTimestamps(existingCards[card.id], card)) continue;
		cardsToUpdate[card.id] = card;
	}

	const pendingModifications = selectPendingModificationCount(getState());
	if (pendingModifications == 0) {
		dispatch(updateCards(cardsToUpdate, fetchType));
	}

	dispatch(enqueueCardUpdates(cardsToUpdate, fetchType));
	
};

const updateCards = (cards : Cards, fetchType : CardFetchType) : ThunkSomeAction => (dispatch) => {
	dispatch({
		type: UPDATE_CARDS,
		cards,
		fetchType
	});
	dispatch(refreshCardSelector(false));
};

const enqueueCardUpdates = (cards : Cards, fetchType : CardFetchType) : ThunkSomeAction => (dispatch, getState) => {
	dispatch({
		type: ENQUEUE_CARD_UPDATES,
		cards,
		fetchType
	});

	//Check if we just added enough cards that we were expecting so we can now dispatch all updates.
	const pendingModifications = selectPendingModificationCount(getState());
	const enquedUpdates = selectEnqueuedCards(getState());
	const count = Object.values(enquedUpdates).reduce((acc, val) => acc + Object.keys(val).length, 0);
	if (count >= pendingModifications) {
		dispatch(updateEnqueuedCards());
	}
};

const updateEnqueuedCards = () : ThunkSomeAction => (dispatch, getState) => {
	const enqueuedCards = selectEnqueuedCards(getState());
	//Note: if there were multiple types enqueued, this would lead to extra
	//cachce invalidation for each type. But that should be very uncommon; the
	//most common case is when multiple cards are updated, and they'll all be
	//hit by the same updater.
	for (const fetchType of TypedObject.keys(enqueuedCards)) {
		const cards = enqueuedCards[fetchType];
		if (!cards) continue;
		dispatch(updateCards(cards, fetchType));
	}
	dispatch({
		type: CLEAR_ENQUEUED_CARD_UPDATES,
	});
};

//This number is used in removeCards. it should be large enough that the race
//between queries for published and unpublished cards should have resolved by
//when it fires.
const REMOVE_CARDS_TIMEOUT = 3000;

export const removeCards = (cardIDs : CardID[], unpublished : boolean) : ThunkSomeAction => (dispatch, getState) => {

	//cards that we expected to be deleted won't show up in the other query
	//ever, so we don't have to wait for the timeout and can delete them now.
	//cards that we weren't told were going to be deleted might show up in the
	//other collection, so wait.

	const expectedDeletions = selectPendingDeletions(getState());

	const nonDeletions : CardID[] = [];
	const deletions : CardID[] = [];

	for (const id of cardIDs) {
		if (expectedDeletions[id]) {
			deletions.push(id);
		} else {
			nonDeletions.push(id);
		}
	}

	if (deletions.length) {
		dispatch(actuallyRemoveCards(deletions, unpublished));
	}

	if (nonDeletions.length) {
		setTimeout(() => {
			dispatch(actuallyRemoveCards(nonDeletions, unpublished));
		}, REMOVE_CARDS_TIMEOUT);
	}
};

//actuallyRemoveCards is the meat of removeCards. It goes through and issues a
//REMOVE_CARDS order for any card whose published property equals the opposite
//of unpublished. Notiobally the logic is: there are two types of live card
//queries: one for published and possibly one for unpublished cards. A given
//card might be removed from either set... but in certain cases it might have
//popped IN in the ohter set (e.g. if the published property was changed). We
//avoid the race between it popping out and then popping in by waiting for
//REMOVE_CARDS_TIMEOUT. By the time this fires, the card will have been
//overwritten with whatever the most recent version of the data is from the
//database, either the published or unpublished variety. The unpublished
//parameter says: "The unpublished query wants you to remove this card". If the
//card in the state wasn't put there by the unpublished side when this runs,
//then it shouldn't be removed, because a more recent copy was put there by the
//published side.
const actuallyRemoveCards = (cardIDs : CardID[], unpublished : boolean) : ThunkSomeAction => (dispatch, getState) => {

	const published = !unpublished;
	const cards = selectCards(getState());

	const filteredCardIDs = cardIDs.filter(id => cards[id] ? cards[id].published == published : false);

	//If a card just had its published property changed (meaning it popped from
	//the unpublished to published collection or vice versa), then this would be
	//empty, and no more work is necessary.
	if (!filteredCardIDs.length) return;

	dispatch(cullCards(filteredCardIDs));
};

//This simply culls any cards with matching IDs from the state.
const cullCards = (cardIDs : CardID[]) : SomeAction => {
	return {
		type: REMOVE_CARDS,
		cardIDs
	};
};

export const fetchTweets = (card : Card) : ThunkSomeAction => async (dispatch) => {

	if (!card || Object.values(card).length == 0 || card.id == EMPTY_CARD_ID) return;

	dispatch({
		type: TWEETS_LOADING,
		loading: true,
	});

	//This query requires an index, defined in firestore.indexes.json
	const snapshot = await getDocs(query(collection(db, TWEETS_COLLECTION), where('card', '==', card.id), where('archived', '==', false), orderBy('created', 'desc')));

	if (snapshot.empty) {
		dispatch({
			type: TWEETS_LOADING,
			loading: false,
		});
		return;
	}

	const tweets = Object.fromEntries(snapshot.docs.map(doc => [doc.id, doc.data()])) as TweetMap;

	dispatch({
		type: UPDATE_TWEETS,
		tweets
	});
};

export const expectUnpublishedCards = (fetchType : CardFetchType) : SomeAction => {
	return {
		type: EXPECT_FETCHED_CARDS,
		fetchType
	};
};

//Denotes that we just did a pending filters commit when the data was fully
//loaded... and shouldn't do it again.
export const committedFiltersWhenFullyLoaded = () : SomeAction => {
	return {
		type: COMMITTED_PENDING_FILTERS_WHEN_FULLY_LOADED,
	};
};


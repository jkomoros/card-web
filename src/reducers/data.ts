import { 
	UPDATE_CARDS,
	UPDATE_SECTIONS,
	UPDATE_TAGS,
	UPDATE_AUTHORS,
	UPDATE_TWEETS,
	REMOVE_CARDS,
	TWEETS_LOADING,
	MODIFY_CARD,
	MODIFY_CARD_SUCCESS,
	MODIFY_CARD_FAILURE,
	REORDER_STATUS,
	EXPECT_NEW_CARD,
	EXPECTED_NEW_CARD_FAILED,
	NAVIGATED_TO_NEW_CARD,
	EXPECT_CARD_DELETIONS,
	COMMITTED_PENDING_FILTERS_WHEN_FULLY_LOADED,
	EXPECT_UNPUBLISHED_CARDS,
	SomeAction,
	UPDATE_CARD_SIMILARITY,
} from '../actions.js';

import {
	UPDATE_COLLECTION_SHAPSHOT
} from '../actions.js';

import {
	DataState,
	CardID,
	Cards,
	Slug,
	State,
	SectionID
} from '../types.js';

import {
	TypedObject
} from '../typed_object.js';

const INITIAL_STATE : DataState = {
	cards:{},
	authors:{},
	sections: {},
	tags: {},
	slugIndex: {},
	cardsSnapshot: {},
	expectedDeletions: {},
	tweetsLoading: false,
	tweets: {},
	publishedCardsLoaded: false,
	unpublishedCardsLoaded: false,
	sectionsLoaded: false,
	tagsLoaded: false,
	alreadyCommittedModificationsWhenFullyLoaded: false,
	cardModificationPending: false,
	cardModificationError: null,
	reorderPending: false,
	pendingNewCardID: '',
	pendingNewCardType: '',
	pendingNewCardIDToNavigateTo: '',
	cardSimilarity: {}
};

const app = (state: DataState = INITIAL_STATE, action : SomeAction) : DataState => {
	switch (action.type) {
	case EXPECT_NEW_CARD:
		//This means that although we may think we're fully loaded now, there's
		//a new card that was just added to database that firebase hasn't yet
		//told us about.
		if (!action.navigate) {
			return {
				...state,
				pendingNewCardID: action.ID,
				pendingNewCardType: action.cardType || '',
			};
		}
		return {
			...state,
			//by default we assume we need a section to load, but if it's a card
			//without a section, that won't happen.
			sectionsLoaded: action.noSectionChange ? true : false,
			//some cards, like concept cards, default to being published
			[action.published ? 'publishedCardsLoaded' : 'unpublishedCardsLoaded']: false,
			reorderPending: true,
			pendingNewCardID: action.ID,
			pendingNewCardIDToNavigateTo: action.ID,
			pendingNewCardType: action.cardType || '',
		};
	case NAVIGATED_TO_NEW_CARD:
		return {
			...state,
			reorderPending: false,
			pendingNewCardID: '',
			pendingNewCardType: '',
			pendingNewCardIDToNavigateTo: '',
		};
	case UPDATE_CARDS:
		const result = {
			...state,
			cards: {...state.cards, ...action.cards},
			slugIndex: {...state.slugIndex, ...extractSlugIndex(action.cards)},
		};
		if (action.unpublished) {
			result.unpublishedCardsLoaded = true;
		} else {
			result.publishedCardsLoaded = true;
		}
		if (Object.keys(action.cards).some(key => key === state.pendingNewCardID)) {
			result.pendingNewCardID = '';
			result.pendingNewCardType = '';
		}
		//Reset the card similarity map because if the card that was just change
		//was in any map, it is now invalid.
		//TODO: couldn't we only remove the entries that explicitly include that item?
		result.cardSimilarity = {};
		return result;
	case UPDATE_COLLECTION_SHAPSHOT:
		return {
			...state,
			cardsSnapshot: state.cards,
		};
	case REMOVE_CARDS:
		return removeCardIDs(action.cardIDs, state);
	case EXPECTED_NEW_CARD_FAILED:
		return {
			...state,
			reorderPending: false,
			sectionsLoaded: true,
			publishedCardsLoaded: true,
			unpublishedCardsLoaded: true,
			pendingNewCardID: '',
			pendingNewCardType: '',
			pendingNewCardIDToNavigateTo: '',
		};
	case EXPECT_CARD_DELETIONS:
		return {
			...state,
			expectedDeletions: {...state.expectedDeletions, ...action.cards}
		};
	case UPDATE_SECTIONS:
		return {
			...state,
			sections: {...state.sections, ...action.sections},
			sectionsLoaded: true,
		};
	case UPDATE_TAGS:
		return {
			...state,
			tags: {...state.tags, ...action.tags},
			tagsLoaded: true,
		};
	case UPDATE_AUTHORS:
		return {
			...state,
			authors: {...state.authors, ...action.authors},
		};
	case UPDATE_TWEETS:
		return {
			...state,
			tweets: {...state.tweets, ...action.tweets},
			tweetsLoading: false,
		};
	case TWEETS_LOADING:
		return {
			...state,
			tweetsLoading: action.loading,
		};
	case MODIFY_CARD:
		return {
			...state,
			cardModificationPending: true,
			cardModificationError: null,
		}; 
	case MODIFY_CARD_SUCCESS:
		return {
			...state,
			cardModificationPending: false,
		};
	case MODIFY_CARD_FAILURE:
		return {
			...state,
			cardModificationPending: false,
			cardModificationError: action.error
		};
	case REORDER_STATUS:
		return {
			...state,
			reorderPending: action.pending
		};
	case COMMITTED_PENDING_FILTERS_WHEN_FULLY_LOADED:
		return {
			...state,
			alreadyCommittedModificationsWhenFullyLoaded: true,
		};
	case EXPECT_UNPUBLISHED_CARDS:
		return {
			...state,
			unpublishedCardsLoaded: false,
			alreadyCommittedModificationsWhenFullyLoaded: false,
		};
	case UPDATE_CARD_SIMILARITY:
		return {
			...state,
			cardSimilarity: {
				...state.cardSimilarity,
				[action.card_id] : action.similarity
			}
		};
	default:
		return state;
	}
};

//Returns a data subState that doesn't have the given cardIDs. If no
//modifications need to be made, it simply return subState, otherwise it will
//return a copy. cardIDs is an array of cardIDs to remove
const removeCardIDs = (cardIDs : CardID[], subState : DataState) : DataState => {
	const newCards = {...subState.cards};
	const newSlugIndex = {...subState.slugIndex};
	const newExpectedDeletions = {...subState.expectedDeletions};
	let changesMade = false;
	for (const id of cardIDs) {
		if (!newCards[id]) continue;
		const cardToDelete = newCards[id];
		delete newCards[id];
		if(newExpectedDeletions[id]) delete newExpectedDeletions[id];
		const slugs = cardToDelete.slugs || [];
		for (const slug of slugs) {
			delete newSlugIndex[slug];
		}
		changesMade = true;
	}
	if (!changesMade) return subState;
	return {...subState, cards: newCards, slugIndex: newSlugIndex, expectedDeletions: newExpectedDeletions};
};

const extractSlugIndex = (cards : Cards) : {[slug : Slug]: CardID} => {
	const result : {[slug : Slug]: CardID} = {};

	for (const cardID of TypedObject.keys(cards) as CardID[]) {
		const card = cards[cardID];
		const slugs = card.slugs;
		if (!slugs) continue;
		for (const val of slugs) {
			result[val] = cardID;
		}
	}

	return result;
};

export const sectionTitle = (state : State, sectionId : SectionID) : string => {
	const section = state.data.sections[sectionId];
	if (!section) return '';
	return section.title;
};

export default app;
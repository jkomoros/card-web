import { 
	UPDATE_CARDS,
	ENQUEUE_CARD_UPDATES,
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
	EXPECT_FETCHED_CARDS,
	SomeAction,
	UPDATE_CARD_SIMILARITY,
	STOP_EXPECTING_FETCHED_CARDS,
	CLEAR_ENQUEUED_CARD_UPDATES,
	TURN_COMPLETE_MODE,
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
} from '../../shared/typed_object.js';

const INITIAL_STATE : DataState = {
	cards:{},
	authors:{},
	sections: {},
	tags: {},
	slugIndex: {},
	cardsSnapshot: {},
	tweetsLoading: false,
	tweets: {},
	//We start off saying that published cards are expected to be fetched.
	loadingCardFetchTypes: {
		published: true
	},
	sectionsLoaded: false,
	tagsLoaded: false,
	alreadyCommittedModificationsWhenFullyLoaded: false,
	completeMode: false,
	//0 means 'default'
	completeModeCardLimit: 0,
	cardModificationError: null,
	pendingModifications: false,
	pendingModificationCount: 0,
	pendingNewCardID: '',
	pendingNewCardType: 'content',
	pendingNewCardIDToNavigateTo: '',
	pendingDeletions: {},
	pendingReorder: false,
	enqueuedCards: {},
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
				pendingNewCardType: action.cardType
			};
		}
		const newState : DataState = {
			...state,
			//by default we assume we need a section to load, but if it's a card
			//without a section, that won't happen.
			sectionsLoaded: action.noSectionChange ? true : false,
			pendingReorder: true,
			pendingNewCardID: action.ID,
			pendingNewCardIDToNavigateTo: action.ID,
			pendingNewCardType: action.cardType,
			//We'll be modifying them in the next few lines
			loadingCardFetchTypes: {...state.loadingCardFetchTypes}
		};
		newState.loadingCardFetchTypes[action.cardLoadingChannel] = true;
		return newState;
	case NAVIGATED_TO_NEW_CARD:
		return {
			...state,
			pendingReorder: false,
			pendingNewCardID: '',
			pendingNewCardType: 'content',
			pendingNewCardIDToNavigateTo: '',
		};
	case TURN_COMPLETE_MODE:
		return {
			...state,
			completeMode: action.on,
			completeModeCardLimit: action.limit
		};
	case ENQUEUE_CARD_UPDATES:
		return {
			...state,
			enqueuedCards: {
				...state.enqueuedCards,
				[action.fetchType]: {
					...state.enqueuedCards[action.fetchType],
					...action.cards
				}
			}
		};
	case CLEAR_ENQUEUED_CARD_UPDATES:
		return {
			...state,
			enqueuedCards: {},
			pendingModificationCount: 0
		};
	case UPDATE_CARDS:
		const result = {
			...state,
			//Only actually change cards identity (which kicks of many
			//downstream recalculations) if the update actually has items. If it
			//doesn't, it's primarily about setting the flag down for loading of
			//a certain type.
			cards: Object.keys(action.cards).length ? {...state.cards, ...action.cards} : state.cards,
			slugIndex: {...state.slugIndex, ...extractSlugIndex(action.cards)},
		};
		result.loadingCardFetchTypes = {...state.loadingCardFetchTypes};
		if (result.loadingCardFetchTypes[action.fetchType]) delete result.loadingCardFetchTypes[action.fetchType];
		if (Object.keys(action.cards).some(key => key === state.pendingNewCardID)) {
			result.pendingNewCardID = '';
			result.pendingNewCardType = 'content';
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
			pendingReorder: false,
			sectionsLoaded: true,
			loadingCardFetchTypes: {},
			pendingNewCardID: '',
			pendingNewCardType: 'content',
			pendingNewCardIDToNavigateTo: '',
		};
	case EXPECT_CARD_DELETIONS:
		return {
			...state,
			pendingDeletions: {...state.pendingDeletions, ...action.cards}
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
			pendingModifications: true,
			pendingModificationCount: action.modificationCount,
			cardModificationError: null,
		}; 
	case MODIFY_CARD_SUCCESS:
		return {
			...state,
			pendingModifications: false,
		};
	case MODIFY_CARD_FAILURE:
		return {
			...state,
			pendingModifications: false,
			cardModificationError: action.error
		};
	case REORDER_STATUS:
		return {
			...state,
			pendingReorder: action.pending
		};
	case COMMITTED_PENDING_FILTERS_WHEN_FULLY_LOADED:
		return {
			...state,
			alreadyCommittedModificationsWhenFullyLoaded: true,
		};
	case EXPECT_FETCHED_CARDS:
		return {
			...state,
			loadingCardFetchTypes: {
				...state.loadingCardFetchTypes,
				[action.fetchType] : true
			},
			alreadyCommittedModificationsWhenFullyLoaded: false,
		};
	case STOP_EXPECTING_FETCHED_CARDS:
		const loading = {...state.loadingCardFetchTypes};
		delete loading[action.fetchType];
		return {
			...state,
			loadingCardFetchTypes: loading
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
	const newExpectedDeletions = {...subState.pendingDeletions};
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
	return {...subState, cards: newCards, slugIndex: newSlugIndex, pendingDeletions: newExpectedDeletions};
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
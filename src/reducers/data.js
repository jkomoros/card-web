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
	NAVIGATED_TO_NEW_CARD,
	EXPECT_CARD_DELETIONS,
	COMMITTED_PENDING_FILTERS_WHEN_FULLY_LOADED,
	EXPECT_UNPUBLISHED_CARDS,
} from '../actions/data.js';

const INITIAL_STATE = {
	cards:{},
	authors:{},
	sections: {},
	tags: {},
	slugIndex: {},
	//a map of cardID -> true for cards that we expect to be deleted imminently,
	//since we just issued a deletion command to the datastore.
	expectedDeletions: {},
	//true while we're loading tweets for the current card
	tweetsLoading: false,
	//We only fetch tweets for cards that we have already viewed.
	tweets: {},
	//These three are flipped to true on the first UPDATE_type entry, primarily
	//as a flag to  selectDataisFullyLoaded.
	publishedCardsLoaded: false,
	unpublishedCardsLoaded: false,
	sectionsLoaded: false,
	tagsLoaded: false,
	//keeps track of whether we committed any pending collections on being fully
	//loaded already. If so, then even if refreshCardSelector gets called again,
	//we won't update the collection again.
	alreadyCommittedModificationsWhenFullyLoaded: false,
	//The modification that is pending
	cardModificationPending: '',
	cardModificationError: null,
	reorderPending: false,
	pendingNewCardID: '',
};

const app = (state = INITIAL_STATE, action) => {
	switch (action.type) {
	case EXPECT_NEW_CARD:
		//This means that although we may think we're fully loaded now, there's
		//a new card that was just added to database that firebase hasn't yet
		//told us about.
		return {
			...state,
			//by default we assume we need a section to load, but if it's a card
			//without a section, that won't happen.
			sectionsLoaded: action.noSectionChange ? true : false,
			//some cards, like concept cards, default to being published
			[action.published ? 'publishedCardsLoaded' : 'unpublishedCardsLoaded']: false,
			reorderPending: true,
			pendingNewCardID: action.ID,
		};
	case NAVIGATED_TO_NEW_CARD:
		return {
			...state,
			reorderPending: false,
			pendingNewCardID: '',
		};
	case UPDATE_CARDS:
		let result = {
			...state,
			cards: {...state.cards, ...action.cards},
			slugIndex: {...state.slugIndex, ...extractSlugIndex(action.cards)},
		};
		if (action.unpublished) {
			result.unpublishedCardsLoaded = true;
		} else {
			result.publishedCardsLoaded = true;
		}
		return result;
	case REMOVE_CARDS:
		return removeCardIDs(action.cardIDs, state);
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
			cardModificationPending: action.cardId,
			cardModificationError: null,
		}; 
	case MODIFY_CARD_SUCCESS:
		return {
			...state,
			cardModificationPending: '',
		};
	case MODIFY_CARD_FAILURE:
		return {
			...state,
			cardModificationPending: '',
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
	default:
		return state;
	}
};

//Returns a data subState that doesn't have the given cardIDs. If no
//modifications need to be made, it simply return subState, otherwise it will
//return a copy. cardIDs is an array of cardIDs to remove
const removeCardIDs = (cardIDs, subState) => {
	let newCards = {...subState.cards};
	let newSlugIndex = {...subState.slugIndex};
	let newExpectedDeletions = {...subState.expectedDeletions};
	let changesMade = false;
	for (let id of cardIDs) {
		if (!newCards[id]) continue;
		const cardToDelete = newCards[id];
		delete newCards[id];
		if(newExpectedDeletions[id]) delete newExpectedDeletions[id];
		let slugs = cardToDelete.slugs || [];
		for (let slug of slugs) {
			delete newSlugIndex[slug];
		}
		changesMade = true;
	}
	if (!changesMade) return subState;
	return {...subState, cards: newCards, slugIndex: newSlugIndex, expectedDeletions: newExpectedDeletions};
};

const extractSlugIndex = cards => {
	let result = {};

	Object.keys(cards).forEach(key => {
		let card = cards[key];
		let slugs = card.slugs;
		if (!slugs) return;
		if (typeof slugs !== 'object') slugs = slugs.split(',');
		for (let val of slugs) {
			result[val] = key;
		}
	});

	return result;
};

export const sectionTitle = (state, sectionId) => {
	let section = state.data.sections[sectionId];
	if (!section) return '';
	return section.title;
};

export default app;
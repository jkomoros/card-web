import { 
	UPDATE_CARDS,
	UPDATE_SECTIONS,
	UPDATE_TAGS,
	UPDATE_AUTHORS,
	UPDATE_TWEETS,
	TWEETS_LOADING,
	MODIFY_CARD,
	MODIFY_CARD_SUCCESS,
	MODIFY_CARD_FAILURE,
	REORDER_STATUS
} from '../actions/data.js';

import {
	TEXT_SEARCH_PROPERTIES,
	normalizedWords,
	allSubstrings
} from '../util.js';

const INITIAL_STATE = {
	cards:{},
	authors:{},
	sections: {},
	tags: {},
	slugIndex: {},
	//a map of normalized word to map of cardid to true. Allows faster filtering.
	cardTermIndex : {},
	//true while we're loading tweets for the current card
	tweetsLoading: false,
	//We only fetch tweets for cards that we have already viewed.
	tweets: {},
	//These three are flipped to true on the first UPDATE_type entry, primarily
	//as a flag to  selectDataisFullyLoaded.
	cardsLoaded: false,
	sectionsLoaded: false,
	tagsLoaded: false,
	//The modification that is pending
	cardModificationPending: '',
	cardModificationError: null,
	reorderPending: false
};

const app = (state = INITIAL_STATE, action) => {
	switch (action.type) {
	case UPDATE_CARDS:
		return {
			...state,
			cards: {...state.cards, ...action.cards},
			cardTermIndex: {...state.cardTermIndex, ...extractCardTermIndex(action.cards, state.cardTermIndex)},
			slugIndex: {...state.slugIndex, ...extractSlugIndex(action.cards)},
			cardsLoaded: true,
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
	default:
		return state;
	}
};

//Returns the update keys to overwrite in the index, ignoring ones that it doesn't come across
const extractCardTermIndex = (cards, existingIndex) => {
	let result = {};
	for (let [id, card] of Object.entries(cards)) {
		for (let property of Object.keys(TEXT_SEARCH_PROPERTIES)) {
			const str = card[property] || '';
			const words = normalizedWords(str);
			for (let word of words) {
				//this leads to a greater than 10x memory blowup for the index than just doing words.
				for (let substr of allSubstrings(word)) {
					if (!result[substr]) result[substr] = existingIndex[substr] ? [...existingIndex[substr]] : {};
					result[substr][id] = true;
				}
			}
		}
	}
	return result;
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

export const getDefaultCardIdForSection = (section) => {
	if (!section) return null;
	if (section.start_cards && section.start_cards.length) return section.start_cards[0];
	return section.cards[0];
};

export default app;
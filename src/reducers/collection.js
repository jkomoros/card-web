import {
	SHOW_CARD,
	UPDATE_COLLECTION,
	COMMIT_PENDING_COLLECTION_MODIFICATIONS
} from '../actions/collection.js';

import {
	UPDATE_SECTIONS,
	UPDATE_CARDS,
	UPDATE_TAGS,
} from '../actions/data.js';

import {
	UPDATE_STARS,
	UPDATE_READS,
	UPDATE_READING_LIST,
} from '../actions/user.js';

import {
	setUnion,
	setRemove,
} from '../util.js';

import {
	INITIAL_STATE,
	FILTER_EQUIVALENTS_FOR_SET,
	DEFAULT_SET_NAME,
	READING_LIST_SET_NAME,
	CARD_FILTER_FUNCS,
	EVERYTHING_SET_NAME
} from '../filters.js';

const app = (state = INITIAL_STATE, action) => {
	switch (action.type) {
	case SHOW_CARD:
		return {
			...state,
			requestedCard: action.requestedCard,
			activeCardId: action.card,
		};
	case UPDATE_COLLECTION:
		return {
			...state,
			activeSetName: action.setName,
			activeFilterNames: [...action.filters],
			activeSortName: action.sortName,
			activeSortReversed: action.sortReversed,
		};
	case COMMIT_PENDING_COLLECTION_MODIFICATIONS:
		//TODO: figure out how to fire this every time one of the other ones
		//that updates filters is fired if it's before data fully loaded.
		return {
			...state,
			filters: {...state.pendingFilters},
		};
	case UPDATE_SECTIONS:
		return {
			...state,
			pendingFilters: {...state.pendingFilters, ...makeFilterFromSection(action.sections, true)}
		};
	case UPDATE_TAGS:
		return {
			...state,
			pendingFilters: {...state.pendingFilters, ...makeFilterFromSection(action.tags, false)}
		};
	case UPDATE_CARDS:
		return {
			...state,
			pendingFilters: {...state.pendingFilters, ...makeFilterFromCards(action.cards, state.pendingFilters)}
		};
	case UPDATE_STARS:
		return {
			...state,
			pendingFilters: {...state.pendingFilters, starred: setUnion(setRemove(state.pendingFilters.starred, action.starsToRemove), action.starsToAdd)}
		};
	case UPDATE_READS:
		return {
			...state,
			pendingFilters: {...state.pendingFilters, read: setUnion(setRemove(state.pendingFilters.read, action.readsToRemove), action.readsToAdd)}
		};
	case UPDATE_READING_LIST:
		return {
			...state,
			pendingFilters: {...state.pendingFilters, ...makeFilterFromReadingList(action.list)}
		};
	default:
		return state;
	}
};

const makeFilterFromReadingList = (readingList) => {
	return {
		[FILTER_EQUIVALENTS_FOR_SET[READING_LIST_SET_NAME]]: Object.fromEntries(readingList.map(id => [id, true]))
	};
};

const makeFilterFromSection = (sections, includeDefaultSet) => {
	let result = {};
	let combinedSet = {};
	for (let key of Object.keys(sections)) {
		let filter = {};
		let section = sections[key];
		section.cards.forEach(card => {
			filter[card] = true;
			combinedSet[card] = true;
		});
		result[key] = filter;
	}
	if (includeDefaultSet) result[FILTER_EQUIVALENTS_FOR_SET[DEFAULT_SET_NAME]] = combinedSet;
	return result;
};

const makeFilterFromCards = (cards, previousFilters) => {
	let result = {};
	for (const [filterName, func] of Object.entries(CARD_FILTER_FUNCS)) {
		let newMatchingCards = [];
		let newNonMatchingCards = [];
		if(!func) throw new Error('Invalid func name: ' + filterName);
		for (let card of Object.values(cards)) {
			if(func(card)) {
				newMatchingCards.push(card.id);
			} else {
				newNonMatchingCards.push(card.id);
			}
		}
		result[filterName] = setUnion(setRemove(previousFilters[filterName], newNonMatchingCards), newMatchingCards);
	}
	const everythingFilterName = FILTER_EQUIVALENTS_FOR_SET[EVERYTHING_SET_NAME];
	//Literally every card is in the everything set.
	result[everythingFilterName] = setUnion(previousFilters[everythingFilterName], Object.keys(cards));
	return result;
};

export default app;
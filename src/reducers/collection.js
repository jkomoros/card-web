import {
	SHOW_CARD,
	UPDATE_COLLECTION,
	UPDATE_COLLECTION_SHAPSHOT
} from '../actions/collection.js';

import {
	UPDATE_SECTIONS,
	UPDATE_CARDS,
	UPDATE_TAGS,
	REMOVE_CARDS,
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
	CARD_FILTER_FUNCS
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
			activeViewMode: action.viewMode,
			activeViewModeExtra: action.viewModeExtra,
		};
	case UPDATE_COLLECTION_SHAPSHOT:
		//TODO: figure out how to fire this every time one of the other ones
		//that updates filters is fired if it's before data fully loaded.
		return {
			...state,
			filtersSnapshot: state.filters,
		};
	case UPDATE_SECTIONS:
		return {
			...state,
			filters: {...state.filters, ...makeFilterFromSection(action.sections, true)}
		};
	case UPDATE_TAGS:
		return {
			...state,
			filters: {...state.filters, ...makeFilterFromSection(action.tags, false)}
		};
	case UPDATE_CARDS:
		return {
			...state,
			filters: {...state.filters, ...makeFilterFromCards(action.cards, state.filters)}
		};
	case REMOVE_CARDS:
		return removeCardIDsFromSubState(action.cardIDs, state);
	case UPDATE_STARS:
		return {
			...state,
			filters: {...state.filters, starred: setUnion(setRemove(state.filters.starred, action.starsToRemove), action.starsToAdd)}
		};
	case UPDATE_READS:
		return {
			...state,
			filters: {...state.filters, read: setUnion(setRemove(state.filters.read, action.readsToRemove), action.readsToAdd)}
		};
	case UPDATE_READING_LIST:
		return {
			...state,
			filters: {...state.filters, ...makeFilterFromReadingList(action.list)}
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
	return result;
};

//Returns a subState where cardIDs are removed from pendingFilters. If no
//changes are to be made, returns subState, otherwise it returns a modified
//copy.
const removeCardIDsFromSubState = (cardIDs, subState) => {
	let newFilters = {...subState.filters};
	let changesMade = false;
	for (let [filterName, filter] of Object.entries(newFilters)) {
		let newFilter = removeCardIDsFromFilter(cardIDs, filter);
		if (newFilter === filter) continue;
		newFilters[filterName] = newFilter;
		changesMade = true;
	}

	return changesMade ? {...subState, filters: newFilters} : subState;
};

//Returns a filter (cardID -> true) that contains none of the cardIDs. IF no
//changes are made, returns the filter.
const removeCardIDsFromFilter = (cardIDs, filter) => {
	const newFilter = {...filter};
	let changesMade = false;
	for (let id of cardIDs) {
		if (!newFilter[id]) continue;
		delete newFilter[id];
		changesMade = true;
	}
	return changesMade ? newFilter : filter;
};

export default app;
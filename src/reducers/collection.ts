import {
	SHOW_CARD,
	UPDATE_COLLECTION,
	UPDATE_RENDER_OFFSET,
	UPDATE_COLLECTION_SHAPSHOT,
	RANDOMIZE_SALT,
	UPDATE_SECTIONS,
	UPDATE_CARDS,
	UPDATE_TAGS,
	REMOVE_CARDS,
	UPDATE_STARS,
	UPDATE_READS,
	UPDATE_READING_LIST,
	SomeAction,
} from '../actions.js';

import {
	setUnion,
	setRemove,
} from '../util.js';

import {
	INITIAL_STATE,
	FILTER_EQUIVALENTS_FOR_SET,
	CARD_FILTER_FUNCS,
} from '../filters.js';

import {
	DEFAULT_SET_NAME,
	READING_LIST_SET_NAME,
} from '../type_constants.js';

import {
	CollectionState,
	Filters,
	Cards,
	CardID,
	FilterMap,
	Sections,
	CardTestFunc
} from '../types.js';

import {
	TypedObject
} from '../typed_object.js';

import {
	randomString
} from '../util.js';

const app = (state : CollectionState = INITIAL_STATE, action : SomeAction) : CollectionState => {
	switch (action.type) {
	case SHOW_CARD:
		return {
			...state,
			requestedCard: action.requestedCard,
			activeCardId: action.card,
		};
	case UPDATE_RENDER_OFFSET:
		return {
			...state,
			activeRenderOffset: action.renderOffset
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
			activeRenderOffset: 0,
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
	case RANDOMIZE_SALT:
		return {
			...state,
			randomSalt: randomString(16)
		};
	default:
		return state;
	}
};

const makeFilterFromReadingList = (readingList : CardID[]) : {[filterName : string] : FilterMap} => {
	return {
		[FILTER_EQUIVALENTS_FOR_SET[READING_LIST_SET_NAME]]: Object.fromEntries(readingList.map(id => [id, true]))
	};
};

const makeFilterFromSection = (sections : Sections, includeDefaultSet? : boolean) : {[filterName : string] : FilterMap} => {
	const result : {[filterName : string] : FilterMap} = {};
	const combinedSet : FilterMap = {};
	for (const key of Object.keys(sections)) {
		const filter : FilterMap = {};
		const section = sections[key];
		section.cards.forEach(card => {
			filter[card] = true;
			combinedSet[card] = true;
		});
		result[key] = filter;
	}
	if (includeDefaultSet) result[FILTER_EQUIVALENTS_FOR_SET[DEFAULT_SET_NAME]] = combinedSet;
	return result;
};

const makeFilterFromCards = (cards : Cards, previousFilters : Filters) => {
	const result : Filters = {};
	for (const [filterName, func] of TypedObject.entries(CARD_FILTER_FUNCS).map(entry => [entry[0], entry[1].func] as [string,  CardTestFunc])) {
		const newMatchingCards = [];
		const newNonMatchingCards = [];
		if(!func) throw new Error('Invalid func name: ' + filterName);
		for (const card of Object.values(cards)) {
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
const removeCardIDsFromSubState = (cardIDs : CardID[], subState : CollectionState) => {
	const newFilters = {...subState.filters};
	let changesMade = false;
	for (const [filterName, filter] of Object.entries(newFilters)) {
		const newFilter = removeCardIDsFromFilter(cardIDs, filter);
		if (newFilter === filter) continue;
		newFilters[filterName] = newFilter;
		changesMade = true;
	}

	return changesMade ? {...subState, filters: newFilters} : subState;
};

//Returns a filter (cardID -> true) that contains none of the cardIDs. IF no
//changes are made, returns the filter.
const removeCardIDsFromFilter = (cardIDs : CardID[], filter : FilterMap) => {
	const newFilter = {...filter};
	let changesMade = false;
	for (const id of cardIDs) {
		if (!newFilter[id]) continue;
		delete newFilter[id];
		changesMade = true;
	}
	return changesMade ? newFilter : filter;
};

export default app;
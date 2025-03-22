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
	SELECT_CARDS,
	UNSELECT_CARDS,
	CLEAR_SELECTED_CARDS,
	INCREMENT_COLLECTION_WORD_CLOUD_VERSION,
	OPEN_CONFIGURE_COLLECTION_DIALOG,
	CLOSE_CONFIGURE_COLLECTION_DIALOG,
	UPDATE_COLLECTION_CONFIGURATION_SHAPSHOT,
} from '../actions.js';

import {
	setUnion,
	setRemove,
} from '../util.js';

import {
	INITIAL_STATE,
	CARD_FILTER_FUNCS,
	SET_INFOS,
} from '../filters.js';

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
} from '../../shared/util.js';

import {
	copyCollectionConfiguration
} from '../collection_description.js';

const app = (state : CollectionState = INITIAL_STATE, action : SomeAction) : CollectionState => {
	switch (action.type) {
	case SHOW_CARD:
		return {
			...state,
			requestedCard: action.requestedCard,
			activeCardID: action.card,
		};
	case UPDATE_RENDER_OFFSET:
		return {
			...state,
			activeRenderOffset: action.renderOffset
		};
	case UPDATE_COLLECTION:
		return {
			...state,
			active: action.collection,
			activeRenderOffset: 0,
			collectionWordCloudVersion: 0
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
	case SELECT_CARDS:
		return {
			...state,
			selectedCards: {
				...state.selectedCards,
				...Object.fromEntries(action.cards.map(id => [id, true]))
			}
		};
	case UNSELECT_CARDS:
		return {
			...state,
			selectedCards: Object.fromEntries(Object.entries(state.selectedCards).filter(([id, _]) => !action.cards.includes(id)))
		};
	case CLEAR_SELECTED_CARDS:
		return {
			...state,
			selectedCards: {}
		};
	case INCREMENT_COLLECTION_WORD_CLOUD_VERSION:
		return {
			...state,
			collectionWordCloudVersion: state.collectionWordCloudVersion + 1
		};
	case OPEN_CONFIGURE_COLLECTION_DIALOG:
		return {
			...state,
			snapshot: copyCollectionConfiguration(state.active),
		};
	case CLOSE_CONFIGURE_COLLECTION_DIALOG:
		return {
			...state,
			active: state.snapshot ? copyCollectionConfiguration(state.snapshot) : state.active,
			snapshot: null,
		};
	case UPDATE_COLLECTION_CONFIGURATION_SHAPSHOT:
		return {
			...state,
			snapshot: action.collection
		};
	default:
		return state;
	}
};

const makeFilterFromReadingList = (readingList : CardID[]) : {[filterName : string] : FilterMap} => {
	return {
		[SET_INFOS['reading-list'].filterEquivalent]: Object.fromEntries(readingList.map(id => [id, true]))
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
	if (includeDefaultSet) result[SET_INFOS.main.filterEquivalent] = combinedSet;
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

	const newSelectedCards = removeCardIDsFromFilter(cardIDs, subState.selectedCards);
	if (newSelectedCards !== subState.selectedCards) {
		changesMade = true;
	}

	return changesMade ? {...subState, filters: newFilters, selectedCards: newSelectedCards} : subState;
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
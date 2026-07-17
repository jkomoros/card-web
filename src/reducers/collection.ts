import {
	SHOW_CARD,
	UPDATE_COLLECTION,
	UPDATE_RENDER_OFFSET,
	UPDATE_COLLECTION_SHAPSHOT,
	UPDATE_WORKER_COLLECTION,
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
	CANCEL_CONFIGURE_COLLECTION_DIALOG,
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
} from '../../shared/typed_object.js';

import {
	randomString
} from '../../shared/util.js';

import {
	copyCollectionConfiguration
} from '../collection_description.js';

import {
	perfCount
} from '../perf.js';

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
			collectionWordCloudVersion: 0,
		};
	case UPDATE_COLLECTION_SHAPSHOT:
		//TODO: figure out how to fire this every time one of the other ones
		//that updates filters is fired if it's before data fully loaded.
		return {
			...state,
			filtersSnapshot: state.filters,
		};
	case UPDATE_WORKER_COLLECTION:
		if (action.slot === 'query') {
			return {
				...state,
				workerQueryCollection: action.result,
			};
		}
		return {
			...state,
			workerActiveCollection: action.result,
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
	case UPDATE_CARDS: {
		if (completeCardFilterProjection(action.cardFilters)) {
			return {
				...state,
				filters: {...state.filters, ...action.cardFilters}
			};
		}
		const changedFilters = makeFilterFromCards(action.cards, state.filters);
		//If no filter membership actually changed, keep state identity so
		//downstream selectors keyed on filters don't reevaluate.
		if (Object.keys(changedFilters).length === 0) return state;
		return {
			...state,
			filters: {...state.filters, ...changedFilters}
		};
	}
	case REMOVE_CARDS:
		return removeCardIDsFromSubState(action.cardIDs, state);
	case UPDATE_STARS: {
		const starred = updateFilterMap(state.filters.starred, action.starsToRemove, action.starsToAdd);
		if (starred === state.filters.starred) return state;
		return {
			...state,
			filters: {...state.filters, starred}
		};
	}
	case UPDATE_READS: {
		const read = updateFilterMap(state.filters.read, action.readsToRemove, action.readsToAdd);
		if (read === state.filters.read) return state;
		return {
			...state,
			filters: {...state.filters, read}
		};
	}
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
		//Opening is idempotent. In particular, a repeated Ctrl-K must not replace
		//an in-progress draft with the active collection.
		if (state.snapshot) return state;
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
	case CANCEL_CONFIGURE_COLLECTION_DIALOG:
		return {
			...state,
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

const completeCardFilterProjection = (filters? : Filters) : filters is Filters => {
	if (!filters) return false;
	const expected = Object.keys(CARD_FILTER_FUNCS);
	const actual = Object.keys(filters);
	return actual.length === expected.length &&
		expected.every(name => Object.prototype.hasOwnProperty.call(filters, name) &&
			typeof filters[name] === 'object' && filters[name] !== null && !Array.isArray(filters[name]));
};

//Applies removals then additions to a filter map, returning the previous map
//by identity if no membership actually changed.
const updateFilterMap = (previous : FilterMap, toRemove : CardID[], toAdd : CardID[]) : FilterMap => {
	const prev = previous || {};
	let changed = false;
	for (const id of toRemove) {
		if (prev[id]) {
			changed = true;
			break;
		}
	}
	if (!changed) {
		for (const id of toAdd) {
			if (!prev[id]) {
				changed = true;
				break;
			}
		}
	}
	if (!changed) return previous;
	const result = setUnion(setRemove(prev, toRemove), toAdd);
	return result;
};

//Returns only the filter maps whose membership actually changed for the
//updated cards; unchanged filters are omitted entirely so their identity (and
//the identity of the overall filters object, if nothing changed) is
//preserved. Previously this cloned every one of the ~125 CARD_FILTER_FUNCS
//maps (each potentially tens of thousands of entries) on every UPDATE_CARDS,
//which made every single-card snapshot echo O(filters × corpus).
const makeFilterFromCards = (cards : Cards, previousFilters : Filters) : Filters => {
	const result : Filters = {};
	const cardValues = Object.values(cards);
	const filterFuncs = TypedObject.entries(CARD_FILTER_FUNCS).map(entry => [entry[0], entry[1].func] as [string, CardTestFunc]);
	//The worker's full-corpus prime starts from the initial empty card-derived
	//maps. Build that projection directly in one card-major pass: the generic
	//incremental algorithm below repeatedly checks empty prior membership,
	//allocates add lists, and then copies maps. Card-major construction is
	//semantically identical here and substantially cheaper for a 40k-card boot.
	if (cardValues.length >= 1000 && filterFuncs.every(([name]) => Object.keys(previousFilters[name] || {}).length === 0)) {
		for (const [name] of filterFuncs) result[name] = {};
		for (const card of cardValues) {
			for (const [name, func] of filterFuncs) {
				if (!func) throw new Error('Invalid func name: ' + name);
				if (func(card)) result[name][card.id] = true;
			}
		}
		perfCount('makeFilterFromCards:calls');
		perfCount('makeFilterFromCards:changedMaps', Object.keys(result).length);
		return result;
	}
	for (const [filterName, func] of filterFuncs) {
		if(!func) throw new Error('Invalid func name: ' + filterName);
		const previous = previousFilters[filterName] || {};
		let toAdd : CardID[] | null = null;
		let toRemove : CardID[] | null = null;
		for (const card of cardValues) {
			//Filter funcs return truthiness, not strict booleans.
			const matches = Boolean(func(card));
			const inPrevious = Boolean(previous[card.id]);
			if (matches === inPrevious) continue;
			if (matches) {
				(toAdd ||= []).push(card.id);
			} else {
				(toRemove ||= []).push(card.id);
			}
		}
		if (!toAdd && !toRemove) continue;
		const updated : FilterMap = {...previous};
		if (toRemove) for (const id of toRemove) delete updated[id];
		if (toAdd) for (const id of toAdd) updated[id] = true;
		result[filterName] = updated;
	}
	perfCount('makeFilterFromCards:calls');
	perfCount('makeFilterFromCards:changedMaps', Object.keys(result).length);
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

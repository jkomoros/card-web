import {
	SHOW_CARD,
	UPDATE_COLLECTION,
	UPDATE_RENDER_OFFSET,
	UPDATE_COLLECTION_SHAPSHOT,
	UPDATE_WORKER_COLLECTION,
	UPDATE_WORKER_COLLECTION_ERROR,
	UPDATE_URL_DIAGNOSTICS,
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
	CardFilterBits,
	Filters,
	FilterMaps,
	FilterMembership,
	Cards,
	CardID,
	FilterMap,
	Sections,
	CardTestFunc
} from '../types.js';

import {validCardFilterBits} from '../card-filter-projection.js';

import {
	cardDerivedMembershipsFromFilterMaps,
	cardDerivedMembershipsFromPrime,
	isCardDerivedMembership,
	membershipHas,
	membershipSize,
	updateCardDerivedMembership,
	updateCardDerivedMembershipGroup,
} from '../../shared/filter_membership.js';

import {
	TypedObject
} from '../../shared/typed_object.js';

import {
	randomString
} from '../../shared/util.js';

import {
	copyCollectionConfiguration,
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
		//Any fresh result state for a slot — including the null dispatched on
		//resubscription — supersedes a recorded failure (#739): errors are
		//only ever (re)set by an explicit UPDATE_WORKER_COLLECTION_ERROR.
		if (action.slot === 'query') {
			return {
				...state,
				workerQueryCollection: action.result,
				workerQueryCollectionError: null,
			};
		}
		return {
			...state,
			workerActiveCollection: action.result,
			workerActiveCollectionError: null,
		};
	case UPDATE_URL_DIAGNOSTICS:
		return {
			...state,
			urlDiagnostics: {
				...state.urlDiagnostics,
				[action.source]: action.diagnostics,
			},
		};
	case UPDATE_WORKER_COLLECTION_ERROR:
		if (action.slot === 'query') {
			return {
				...state,
				workerQueryCollectionError: action.error,
			};
		}
		return {
			...state,
			workerActiveCollectionError: action.error,
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
		const primed = completeCardFilterBits(action.cardFilterBits);
		if (primed) {
			return {
				...state,
				filters: {...state.filters, ...primed}
			};
		}
		if (completeCardFilterProjection(action.cardFilters)) {
			//Plain maps on the wire become memberships here, one shared
			//domain for the whole projection; equal maps share a membership.
			const cardFilters : Filters = {};
			const entries = TypedObject.entries(action.cardFilters);
			const memberships = cardDerivedMembershipsFromFilterMaps(entries.map(([, filter]) => filter));
			for (let index = 0; index < entries.length; index++) cardFilters[entries[index][0]] = memberships[index];
			return {
				...state,
				filters: {...state.filters, ...cardFilters}
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
		const starred = updateFilterMap(plainFilterMap(state.filters.starred), action.starsToRemove, action.starsToAdd);
		if (starred === state.filters.starred) return state;
		return {
			...state,
			filters: {...state.filters, starred}
		};
	}
	case UPDATE_READS: {
		const read = updateFilterMap(plainFilterMap(state.filters.read), action.readsToRemove, action.readsToAdd);
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
	case OPEN_CONFIGURE_COLLECTION_DIALOG: {
		//Opening is idempotent. In particular, a repeated Ctrl-K must not replace
		//an in-progress draft with the active collection.
		if (state.snapshot) return state;
		//EVERY COMPOSITION BEGINS FROM THE COLLECTION ON SCREEN (round 3, D1).
		//
		//This used to resume a draft that a previous Escape had preserved, so
		//that un-committed work survived a close. The owner's constitution
		//retires the idea: the draft is a preview of a collection nobody has
		//opened, and "if you make a mistake, esc/X resets to the previous state"
		//— which is only true if the reset is total. Preservation made Escape
		//mean "defer": the mistake came back on the next Ctrl-K, on a surface
		//that had reopened on it silently, and the user's second Escape was
		//spent undoing the first one's failure to undo.
		return {
			...state,
			snapshot: copyCollectionConfiguration(state.active),
		};
	}
	case CLOSE_CONFIGURE_COLLECTION_DIALOG:
		//Committed.
		return {
			...state,
			active: state.snapshot ? copyCollectionConfiguration(state.snapshot) : state.active,
			snapshot: null,
		};
	case CANCEL_CONFIGURE_COLLECTION_DIALOG:
		//Discarded, whole. The draft was never real; there is nothing to keep.
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

//NOTE (#752): these filter maps still carry IDs with no card record (the
//sections doc is a membership index readable by anyone; card records are
//permission-gated). Existence-gating HERE would be wrong-by-boot-order —
//sections arrive before cards, and this runs in a reducer with no cards in
//scope, so everything would be dropped and never re-added. It is also
//unnecessary: section filters only ever act as INCLUDE sets intersected
//with a base set, and ALL THREE base sets are existence-gated at build time
//(computeDefaultSet, makeEverythingSetFromCards, and the reading-list via
//existingCardsOnly) — so a phantom entry here can never survive into a
//rendered list or a count.
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

//The wire shape is plain maps and nothing else: a membership token that
//crossed the worker boundary arrives as {} (structuredClone drops it), and
//would otherwise install as an empty filter. Accept only own-key
//plain-object maps of `true`.
const completeCardFilterProjection = (filters? : FilterMaps) : filters is FilterMaps => {
	if (!filters) return false;
	const expected = Object.keys(CARD_FILTER_FUNCS);
	const actual = Object.keys(filters);
	return actual.length === expected.length &&
		expected.every(name => Object.prototype.hasOwnProperty.call(filters, name) &&
			typeof filters[name] === 'object' && filters[name] !== null && !Array.isArray(filters[name]) &&
			(Object.getPrototypeOf(filters[name]) === Object.prototype || Object.getPrototypeOf(filters[name]) === null) &&
			Reflect.ownKeys(filters[name]).length === Object.keys(filters[name]).length &&
			Object.values(filters[name]).every(value => value === true));
};

//The prime's bitsets, installed through the same builder the worker used.
//Anything malformed (a name missing, a bitset the wrong length, a repeated
//id) yields null and the reducer derives the filters from the cards itself.
const completeCardFilterBits = (bits? : CardFilterBits) : Filters | null => {
	if (!bits || !validCardFilterBits(bits, Object.keys(CARD_FILTER_FUNCS))) return null;
	let memberships;
	try {
		memberships = cardDerivedMembershipsFromPrime(bits.ids, bits.words);
	} catch {
		return null;
	}
	const filters : Filters = {};
	for (let index = 0; index < bits.names.length; index++) filters[bits.names[index]] = memberships[index];
	perfCount('cardFilterBits:installed');
	return filters;
};

//Stars and reads are user-owned filters: their reducers edit plain maps and
//never receive card-derived storage.
const plainFilterMap = (membership : FilterMembership) : FilterMap => {
	if (isCardDerivedMembership(membership)) throw new Error('User-owned filter unexpectedly used card-derived membership storage');
	return membership;
};

//Applies removals then additions to a filter map, returning the previous map
//by identity if no membership actually changed.
const updateFilterMap = (previous : FilterMap, toRemove : CardID[], toAdd : CardID[]) : FilterMap => {
	const prev = previous || {};
	const owns = (id : CardID) => Object.prototype.hasOwnProperty.call(prev, id);
	let changed = false;
	for (const id of toRemove) {
		if (owns(id)) {
			changed = true;
			break;
		}
	}
	if (!changed) {
		for (const id of toAdd) {
			if (!owns(id)) {
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
	if (!cardValues.length) {
		perfCount('makeFilterFromCards:calls');
		perfCount('makeFilterFromCards:changedMaps', 0);
		return result;
	}
	const filterFuncs = TypedObject.entries(CARD_FILTER_FUNCS).map(entry => [entry[0], entry[1].func] as [string, CardTestFunc]);
	//The worker's full-corpus prime (and a worker respawn's rehydration)
	//starts from empty card-derived filters. Evaluate every predicate
	//card-major into one bitset per filter and build the memberships straight
	//from those bits: no per-filter add lists, no id lookups, and filters
	//with equal bits share one membership. The ordinal is the card's index
	//in cardValues, so membershipKeys order equals the plain-map order the
	//incremental path would have produced.
	//The prime builder keys ordinals by position, so it requires unique ids; a
	//map whose values disagree with their keys (two entries for one card.id)
	//takes the incremental path, which tolerates that as the plain maps did,
	//rather than throwing inside a reducer the worker also runs.
	const primeIDs = cardValues.length >= 1000 ? cardValues.map(card => card.id) : null;
	if (primeIDs && new Set(primeIDs).size === primeIDs.length && filterFuncs.every(([name]) => membershipSize(previousFilters[name] || {}) === 0)) {
		const words = filterFuncs.map(() => new Uint32Array(Math.ceil(cardValues.length / 32)));
		for (let cardIndex = 0; cardIndex < cardValues.length; cardIndex++) {
			const card = cardValues[cardIndex];
			for (let filterIndex = 0; filterIndex < filterFuncs.length; filterIndex++) {
				const [name, func] = filterFuncs[filterIndex];
				if (!func) throw new Error('Invalid func name: ' + name);
				if (func(card)) words[filterIndex][cardIndex >>> 5] |= 1 << (cardIndex & 31);
			}
		}
		const memberships = cardDerivedMembershipsFromPrime(primeIDs, words);
		for (let filterIndex = 0; filterIndex < filterFuncs.length; filterIndex++) result[filterFuncs[filterIndex][0]] = memberships[filterIndex];
		perfCount('makeFilterFromCards:calls');
		perfCount('makeFilterFromCards:primeBulk');
		perfCount('makeFilterFromCards:changedMaps', Object.keys(result).length);
		return result;
	}
	//Incremental: one group update over every card filter, so they all share
	//one id domain and an unchanged filter keeps its identity. A plain-map
	//prior (the initial empty maps) is imported on the way through.
	const requests : {membership : FilterMembership; add : CardID[]; remove : CardID[]}[] = [];
	for (const [filterName, func] of filterFuncs) {
		if(!func) throw new Error('Invalid func name: ' + filterName);
		const previous = previousFilters[filterName] || {};
		const toAdd : CardID[] = [], toRemove : CardID[] = [];
		for (const card of cardValues) {
			//Filter funcs return truthiness, not strict booleans.
			const matches = Boolean(func(card));
			const inPrevious = membershipHas(previous, card.id);
			if (matches === inPrevious) continue;
			if (matches) {
				toAdd.push(card.id);
			} else {
				toRemove.push(card.id);
			}
		}
		requests.push({membership: previous, add: toAdd, remove: toRemove});
	}
	const updated = updateCardDerivedMembershipGroup(requests);
	for (let index = 0; index < filterFuncs.length; index++) {
		if (updated[index] !== requests[index].membership) result[filterFuncs[index][0]] = updated[index];
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
	//Card-derived filters are removed from as one group (one shared domain);
	//the user-owned plain maps (stars, reads, sections, tags) one by one.
	const derivedEntries = Object.entries(newFilters).filter(([, filter]) => isCardDerivedMembership(filter));
	const derivedUpdates = updateCardDerivedMembershipGroup(derivedEntries.map(([, filter]) => ({membership: filter, remove: cardIDs})));
	for (let index = 0; index < derivedEntries.length; index++) {
		const [filterName, filter] = derivedEntries[index];
		const newFilter = derivedUpdates[index];
		if (newFilter === filter) continue;
		newFilters[filterName] = newFilter;
		changesMade = true;
	}
	for (const [filterName, filter] of Object.entries(newFilters)) {
		if (isCardDerivedMembership(filter)) continue;
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
function removeCardIDsFromFilter(cardIDs : CardID[], filter : FilterMap) : FilterMap;
function removeCardIDsFromFilter(cardIDs : CardID[], filter : FilterMembership) : FilterMembership;
function removeCardIDsFromFilter(cardIDs : CardID[], filter : FilterMembership) : FilterMembership {
	if (isCardDerivedMembership(filter)) return updateCardDerivedMembership(filter, {remove: cardIDs});
	const newFilter = {...filter};
	let changesMade = false;
	for (const id of cardIDs) {
		if (!Object.prototype.hasOwnProperty.call(newFilter, id) || !newFilter[id]) continue;
		delete newFilter[id];
		changesMade = true;
	}
	return changesMade ? newFilter : filter;
}

export default app;

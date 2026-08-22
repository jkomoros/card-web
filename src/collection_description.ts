import {
	INVERSE_FILTER_NAMES,
	SORTS,
	UNION_FILTER_DELIMITER,
	CONFIGURABLE_FILTER_URL_PARTS,
	CONFIGURABLE_FILTER_NAMES,
	LIMIT_FILTER_NAME,
	OFFSET_FILTER_NAME,
	makeConfigurableFilter,
	queryFilter,
	queryTextFromQueryFilter,
	SET_INFOS,
	SELECTED_FILTER_NAME,
} from './filters.js';

import {
	extractFilterNamesSortAndView,
	SORT_URL_KEYWORD,
	SORT_REVERSED_URL_KEYWORD,
	VIEW_MODE_URL_KEYWORD,
	SET_NAMES,
} from '../shared/collection_description_base.js';

import {
	TypedObject
} from '../shared/typed_object.js';

import {
	relativeDateCacheKey
} from './relative-date.js';

import {
	reportURLDiagnostic,
	retractURLDiagnostic
} from '../shared/url-diagnostics.js';

import {
	SetName,
	SortName,
	ViewMode,
	FilterName,
	ConfigurableFilterName,
	UnionFilterName,
	CollectionConfiguration,
} from '../shared/types.js';

import {
	CardID,
	ProcessedCard,
	ProcessedCards,
	CollectionConstructorArguments,
	SerializedDescriptionToCardList,
	SortExtra,
	SortExtras,
	SortExtractorResult,
	Filters,
	Sections,
	Sets,
	Uid,
	WebInfo,
	FilterMap,
	FilterExtras,
	IDFMap,
	CardIDMap,
	CardBooleanMap,
	WorkerCollectionResult,
	URLPart,
	CardSimilarityMap,
	ConfigurableFilterResult
} from './types.js';

import {
	KEY_CARD_ID_PLACEHOLDER	
} from '../shared/card_fields.js';

import {
	memoizeWeakFirstArg
} from './memoize.js';

import { references } from './references.js';

import {
	perfCount,
	perfRecord
} from './perf.js';

const SLOW_COLLECTION_WORK_THRESHOLD_MS = 50;

const logSlowCollectionWork = (operation : string, description : CollectionDescription, count : number, start : number) => {
	const duration = performance.now() - start;
	perfCount('collection:' + operation);
	perfRecord('collection:' + operation, duration);
	if (duration < SLOW_COLLECTION_WORK_THRESHOLD_MS) return;
	const executionContext = typeof document === 'undefined' ? 'worker' : 'main';
	console.log(`[PERF] ${executionContext} collection ${operation}: ${duration.toFixed(1)}ms over ${count} cards for ${description.serialize()}`);
};

export const queryTextFromCollectionDescription = (description : CollectionDescription) : string => {
	if (!description) return '';
	for (const filterName of description.filters) {
		const queryText = queryTextFromQueryFilter(filterName);
		if (queryText) return queryText;
	}
	return '';
};

//Returns a collection description like description, but with
//newConfigurableFilter added (and the first filter of the same type that
//already exists removed).
export const collectionDescriptionWithConfigurableFilter = (description : CollectionDescription, newConfigurableFilter : string) : CollectionDescription => {
	const newFilters : string[] = [];
	const filterName = newConfigurableFilter.split('/')[0];
	let replacedFilter = false;
	for (const filter of description.filters) {
		if (!replacedFilter && filter.startsWith(filterName + '/')) {
			replacedFilter = true;
			newFilters.push(newConfigurableFilter);
			continue;
		}
		newFilters.push(filter);
	}

	if (!replacedFilter) newFilters.push(newConfigurableFilter);

	return collectionDescriptionWithOverrides(description, {filters: newFilters});
};

interface CollectionDescriptionOverrides {
	set? : SetName,
	filters? : string[],
	sort? : SortName,
	sortReversed? : boolean,
	viewMode? : ViewMode,
	viewModeExtra? : string
}

const collectionDescriptionWithOverrides = (description : CollectionDescription, overrides : CollectionDescriptionOverrides) => {
	const baseValues : CollectionDescriptionOverrides = {
		set: description.setNameExplicitlySet ? description.set : undefined,
		filters: description.filters,
		sort: description.sort,
		sortReversed: description.sortReversed,
		viewMode: description.viewMode,
		viewModeExtra: description.viewModeExtra,
	};
	const overriddenValues = {...baseValues, ...overrides};
	return new CollectionDescription(overriddenValues.set, overriddenValues.filters, overriddenValues.sort, overriddenValues.sortReversed, overriddenValues.viewMode, overriddenValues.viewModeExtra);
};

export const collectionDescriptionWithSet = (description : CollectionDescription, set : SetName) : CollectionDescription => {
	return collectionDescriptionWithOverrides(description, {set});
};

export const collectionDescriptionWithFilterRemoved = (description : CollectionDescription, index : number) : CollectionDescription => {
	const filters = [...description.filters];
	filters.splice(index, 1);
	return collectionDescriptionWithOverrides(description, {filters});
};

export const collectionDescriptionWithSelected = (description : CollectionDescription) : CollectionDescription => {
	const filters = [...description.filters, SELECTED_FILTER_NAME];
	return collectionDescriptionWithOverrides(description, {filters});
};

export const collectionDescriptionWithFilterModified = (description : CollectionDescription, index : number, newFilterText : string) : CollectionDescription => {
	const filters = [...description.filters];
	filters.splice(index, 1, newFilterText);
	return collectionDescriptionWithOverrides(description, {filters});
};

export const collectionDescriptionWithFilterAppended = (description : CollectionDescription, newFilter : string) : CollectionDescription => {
	const filters = [...description.filters, newFilter];
	return collectionDescriptionWithOverrides(description, {filters});
};

export const collectionDescriptionWithSort = (description : CollectionDescription, sort : SortName) : CollectionDescription => {
	return collectionDescriptionWithOverrides(description, {sort});
};

export const collectionDescriptionWithSortReversed = (description : CollectionDescription, sortReversed : boolean) : CollectionDescription => {
	return collectionDescriptionWithOverrides(description, {sortReversed});
};

//collectionDescriptionWithQuery returns a new cloned collection description,
//but that includes a configurable filter for the given queryText, replacing the
//first existing query filter if one exists, otherwise appending it.
export const collectionDescriptionWithQuery = (description : CollectionDescription, queryText : string) : CollectionDescription => {
	return collectionDescriptionWithConfigurableFilter(description, queryFilter(queryText));
};

//collectionDescriptionWithKeyCard returns the description, but with each instance of 'self' replaced with the given keyCardID
export const collectionDescriptionWithKeyCard = (description : CollectionDescription, keyCardID : CardID) : CollectionDescription => {
	return collectionDescriptionWithPartReplacements(description, {[KEY_CARD_ID_PLACEHOLDER]: keyCardID});
};

//Returns a cloned colletion description where each part (split on '/') that
//precisely matches an item in the passed dict is replaced with the given
//replacement.
const collectionDescriptionWithPartReplacements = (description : CollectionDescription, replacements : {[part : URLPart] : URLPart}) : CollectionDescription => {
	if (!replacements) replacements = {};
	const parts = description.serialize().split('/');
	const replacedParts = parts.map(part => replacements[part] || part);
	return CollectionDescription.deserialize(replacedParts.join('/'));
};

export const defaultCollectionConfiguration = () : CollectionConfiguration => {
	return {
		setName: 'main',
		filterNames: [],
		sortName: 'default',
		sortReversed: false,
		viewMode: 'list',
		viewModeExtra: ''
	};
};

export const copyCollectionConfiguration = (config : CollectionConfiguration) : CollectionConfiguration => {
	return {
		...config,
		filterNames: [...config.filterNames]
	};
};

export class CollectionDescription {

	_setNameExplicitlySet : boolean;
	_set : SetName;
	_filters : FilterName[];
	_sort : SortName;
	_sortReversed : boolean;
	_viewMode : ViewMode;
	_viewModeExtra : string;
	_limit : number;
	_offset : number;
	_serialized : string;
	_serializedShort : string;

	constructor(setName? : SetName, filterNames? : FilterName[], sortName? : SortName, sortReversed? : boolean, viewMode? : ViewMode, viewModeExtra? : string) {
		let setNameExplicitlySet = true;
		if (!setName) {
			setName = 'main';
			setNameExplicitlySet = false;
		}
		if (!sortName) sortName = 'default';
		if (!sortReversed) sortReversed = false;
		if (!filterNames) filterNames = [];
		if (!viewMode) viewMode = 'list';
		if (!viewModeExtra) viewModeExtra = '';

		let limit = 0;
		let offset = 0;
		//Whole-string decimal only, NOT parseInt: parseInt stops at the
		//first non-digit, so limit/1e400 (a user asking for effectively no
		//limit) silently became limit/1, and limit/0x10 became... 16 in
		//some engines and 0 in others. Non-numeric forms already fell back
		//to "no limit" (limit/abc, limit/-5); exotic numerals now fail the
		//same consistent way instead of a surprising nearby number (#752).
		const parseWholeNumber = (part : string | undefined) : number =>
			part !== undefined && /^\d+$/.test(part) ? parseInt(part, 10) : 0;
		for (const filter of filterNames) {
			if (filter.startsWith(LIMIT_FILTER_NAME + '/')){
				limit = parseWholeNumber(filter.split('/')[1]);
			} else if (filter.startsWith(OFFSET_FILTER_NAME + '/')) {
				offset = parseWholeNumber(filter.split('/')[1]);
			}
		}

		this._setNameExplicitlySet = setNameExplicitlySet;
		this._set = setName;
		this._filters = filterNames;
		this._sort = sortName;
		this._sortReversed = sortReversed;
		this._viewMode = viewMode;
		this._viewModeExtra = viewModeExtra;
		this._limit = limit;
		this._offset = offset;
		this._serialized = this._serialize(false);
		this._serializedShort = this._serializeShort(false);
	}

	//setNameExplicitlySet returns whether the setName was set explicitly or
	//not. This is not part of the canonical state of the CollectionDescription,
	//but can be detected after the fact where the structure of the original
	//input is important.
	get setNameExplicitlySet() {
		return this._setNameExplicitlySet;
	}

	get set() {
		return this._set;
	}

	get filters() {
		return this._filters;
	}

	get sort() {
		return this._sort;
	}

	get sortReversed() {
		return this._sortReversed;
	}

	get viewMode() {
		return this._viewMode;
	}

	get viewModeExtra() {
		return this._viewModeExtra;
	}

	get sortConfig() {
		const config = SORTS[this.sort];
		if (config) return config;
		//shared/collection_description_base.ts accepts ANY sort name when
		//deserializing ("we'll just assume it's fine"), so /c/sort/bogus/ reaches
		//here and every consumer then dereferences .extractor on undefined,
		//taking out the whole collection run (#750). Fall back to the default
		//sort, which is what an unknown single-token FILTER already degrades to.
		//The BARE part, not 'sort/' + part: a reversed bad sort appears in
		//the raw URL as sort/reverse/<part>, so the prefixed form would
		//never match the URL the user is on and the notice would be
		//permanently invisible (#757 review). The bare segment matches both
		//forms.
		reportURLDiagnostic(this.sort, 'sorted by the default instead, because "' + this.sort + '" is not a sort');
		return SORTS['default'];
	}

	//IF the collection wants to limit how many items to return, this will
	//return a number greater than zero, for where the collection should be
	//capped.
	get limit() {
		return this._limit;
	}

	get isRandom() {
		return this.sort == 'random';
	}

	//IF the collection wants to offset how many items to return, this will
	//return a number greater than zero, for how many items should be skipped at
	//the front.
	get offset() {
		return this._offset;
	}

	get configuration() : CollectionConfiguration {
		return {
			setName: this.set,
			filterNames: this.filters,
			sortName: this.sort,
			sortReversed: this.sortReversed,
			viewMode: this.viewMode,
			viewModeExtra: this.viewModeExtra
		};
	}

	serialize() {
		return this._serialized;
	}

	serializeOriginalOrder() {
		return this._serialize(true);
	}

	//serialize returns a canonical string representing this collection
	//description, which if used as a component of the URL will match these
	//collection semantics. The string uniquely and precisely defines the
	//collection with the given semantics. It may include extra tings that are
	//not in the canonical URL because they are elided (like the default set
	//name). It also may be in  adifferent order than what is in the URL, since
	//all items are in a canonical sorted order but the URL is optimized to stay
	//as the user wrote it.
	_serialize(unsorted? : boolean) : string {
		let result : string[] = [this.set];

		const filterNames = [...this.filters];
		if (!unsorted) filterNames.sort();
	
		result = result.concat(filterNames);
	
		if (this.sort != 'default' || this.sortReversed) {
			result.push(SORT_URL_KEYWORD);
			if (this.sortReversed) result.push(SORT_REVERSED_URL_KEYWORD);
			result.push(this.sort);
		}

		if (this.viewMode != 'list') {
			result.push(VIEW_MODE_URL_KEYWORD);
			result.push(this.viewMode);
			if (this.viewModeExtra) result.push(this.viewModeExtra);
		}
	
		//Have a trailing slash
		result.push('');
		return result.join('/');
	}

	serializeShort() : string {
		return this._serializedShort;
	}

	serializeShortOriginalOrder() : string {
		return this._serializeShort(true);
	}

	//serializeShort is like serialize, but skips leading set name if it's
	//default.
	_serializeShort(unsorted? : boolean) : string {
		let result : string[] = [];

		if (this.set != 'main') result.push(this.set);

		const filterNames = [...this.filters];
		if (!unsorted) filterNames.sort();

		result = result.concat(filterNames);

		if (this.sort != 'default' || this.sortReversed) {
			result.push(SORT_URL_KEYWORD);
			if (this.sortReversed) result.push(SORT_REVERSED_URL_KEYWORD);
			result.push(this.sort);
		}

		if (this.viewMode != 'list') {
			result.push(VIEW_MODE_URL_KEYWORD);
			result.push(this.viewMode);
			if (this.viewModeExtra) result.push(this.viewModeExtra);
		}

		//Have a trailing slash
		result.push('');
		return result.join('/');
	}

	equivalent(other : CollectionDescription) : boolean {
		if (other instanceof CollectionDescription) {
			return this.serialize() == other.serialize();
		}
		return false;
	}

	//collection returns a new collection based on this description, with this
	//collection of all cards, this map of sets, and this filter definitions.
	//sections and fallbacks are optional. Sections are needed for accurate
	//sorting and labels of certain sorts. Fallbacks are consulted if there are
	//no cards matching the filters; then it will look up a fallback set based
	//on keying into optFallbacks by the serialization of the
	//collectiondescription. You can use selectCollectionConstructorArguments to
	//select all of the items at once.
	//Arguments: {cards, sets, filters, editingCard, sections, fallbacks, startCards}
	//If previousCollection is provided and every filtering/sorting input is
	//identity-equal to the previous collection's (only the live cards map for
	//expansion differing), the expensive filter/sort work is handed off from
	//the previous collection instead of being redone.
	collection(collectionArguments : CollectionConstructorArguments, previousCollection? : Collection | null) : Collection {
		if (previousCollection) {
			const handedOff = Collection.handoff(previousCollection, this, collectionArguments);
			if (handedOff) return handedOff;
		}
		return new Collection(this, collectionArguments);
	}

	static withConfiguration(config : CollectionConfiguration) : CollectionDescription {
		return new CollectionDescription(config.setName, config.filterNames, config.sortName, config.sortReversed, config.viewMode, config.viewModeExtra);
	}

	static deserialize(input : string) : CollectionDescription {
		const [result, ] = CollectionDescription.deserializeWithExtra(input);
		return result;
	}

	//deserializeWithExtra takes the output of serialize() (which is a part of a URL). It
	//returns an array with two items: 1) the CollectionDescription, and 2) the
	//'rest', which is likely the card ID or '' if nothing.
	static deserializeWithExtra(input : string) : [description : CollectionDescription, rest : string] {
		const parts = input.split('/');

		//We do not remove a trailing slash; we take a trailing slash to mean
		//"deafult item in the collection".

		//in some weird situations, like during editing commit, we might be at no
		//route even when our view is active. Not entirely clear how, but it
		//happens... for a second.
		const firstPart = parts.length ? parts[0] : '';

		let setName : SetName = 'main';

		for (const name of SET_NAMES) {
			if (name == firstPart) {
				setName = firstPart as SetName;
				parts.shift();
				break;
			}
		}

		//Get last part, which is the card selector (and might be "").
		const extra = parts.pop() || '';

		const [filters, sortName, sortReversed, viewMode, viewModeExtra] = extractFilterNamesSortAndView(parts, CONFIGURABLE_FILTER_URL_PARTS, CONFIGURABLE_FILTER_NAMES);

		return [new CollectionDescription(setName,filters,sortName,sortReversed, viewMode, viewModeExtra), extra];
	}
}

const filterNameIsUnionFilter = (filterName : FilterName) : boolean => {
	//the + can be include in a configurable filter, e.g `children/+ab123`
	return filterName.includes(UNION_FILTER_DELIMITER)  && !filterNameIsConfigurableFilter(filterName);
};

const filterNameIsConfigurableFilter = (filterName : FilterName) : filterName is ConfigurableFilterName => {
	return filterName.includes('/');
};

//This memo was DEAD from the day it was written: nothing ever assigned
//memoizedConfigurableFiltersExtras anything but null, so the guard below was
//always false, the cache was wiped on every call, and every configurable
//filter re-scanned the whole corpus on every collection run (#736). Results
//were being stored and never read.
//
//Turning it on is safe only because makeExtrasForFilterFunc is itself
//memoized over all of its inputs, so a stable `extras` identity really does
//mean "no filter input changed" — and extras is, by construction, the ENTIRE
//explicit input surface a configurable filter can see (see
//filterSetForFilterDefinitionItem, which passes nothing else).
//
//The one input NOT in extras is ambient: the current date. Relative-date
//filters like `created/after/7-days-ago` resolve against local midnight, and
//relativeDateKey reaches selectCollectionConstructorArguments but NOT
//Collection, so extras identity survives a midnight rollover unchanged.
//Keying on extras alone would therefore have served yesterday's answer to
//every relative-date filter on an idle tab — trading a performance bug for a
//correctness one. The day key closes that for DIRECT relative-date filters;
//it is three getters and a template string, once per configurable filter.
//
//It does NOT close it for the wrapper filters — exclude/, combine/, expand/ —
//which each hold their own memoize() keyed on extras identity alone, retained
//by the never-evicted by-name cache in filters.ts. So
//`exclude/created/after/today` still serves a pre-midnight answer. That is
//PRE-EXISTING (it reproduces with this memo dead, i.e. on master) and is
//tracked separately; it is called out here so nobody reads the paragraph
//above as a guarantee it does not make.
//Growth within a generation is bounded by distinct filter NAMES, not by
//filters-per-run, and nothing evicted them before this cap (#744).
//
//SIZING IS MEASURED, NOT GUESSED — the first attempt used 16 and was BELOW the
//real worst case. Driving the actual reference_blocks definitions through
//expandReferenceBlocks: a content card view touches 13 distinct names in one
//generation, a CONCEPT card view touches 18. At 16 the concept card never
//converged — every pass evicted exactly what the next pass needed, 7 hits and
//16 misses forever, giving back about half of what #736 won (~85ms/pass
//against ~45ms uncapped and ~135ms with no memo at all, on a 20k corpus).
//
//64 clears the measured worst case (18, plus tab-count collections and a query
//name, ~24-28) with real headroom, while still bounding a burst. A Map is
//insertion-ordered, so evicting keys().next() is oldest-first; a hit reorders,
//making this LRU rather than FIFO, which measured strictly better under the
//thrash case (7 hits vs 5) at 67ns per hit.
//
//That worst case lives on the MAIN-THREAD expandReferenceBlocks path — live
//when corpusWorkerCanRunCollections() is false, i.e. the corpus-worker=off
//rollback, a worker circuit-break, or the mid-flight fallbacks in card-view
//and card-info-panel. In the default worker-served mode each block is its own
//runCollection and no generation gets close.
const MAX_MEMOIZED_CONFIGURABLE_FILTERS = 64;

//The memo keys on a generation NUMBER via a WeakMap, not on the extras object,
//so this cache holds no strong reference to the corpus (extras holds `cards`).
//
//An earlier version of this comment recorded that this bought nothing
//measurable, because makeExtrasForFilterFunc was memoize(fn, 3) and retained
//the cards map STRONGLY for three generations regardless. That other memo is
//now memoizeWeakFirstArg keyed on the cards map itself (#749), so NEITHER OF
//THESE TWO CACHES is a corpus retainer any more — the fixed memo was the one
//pinning up to three swapped-out generations. Scope the claim honestly: a
//handful of one-generation-deep module retainers still hold the LAST corpus
//until displaced (reference_blocks' workerExpansionMemo and per-card maps,
//selectors' _previousActiveCollection); those are tracked separately.
const extrasGenerations = new WeakMap<FilterExtras, number>();
let nextExtrasGeneration = 0;
const generationForExtras = (extras : FilterExtras) : number => {
	const existing = extrasGenerations.get(extras);
	if (existing !== undefined) return existing;
	const generation = ++nextExtrasGeneration;
	extrasGenerations.set(extras, generation);
	return generation;
};

let memoizedConfigurableFiltersGeneration = 0;
let memoizedConfigurableFiltersDayKey = '';
let memoizedConfigurableFilters : Map<string, ConfigurableFilterResult> = new Map();

//Both write sites go through here, so the cap cannot be applied to one and
//forgotten on the other — the enumerate() early-return is easy to miss.
const storeMemoizedConfigurableFilter = (name : string, result : ConfigurableFilterResult) : void => {
	memoizedConfigurableFilters.set(name, result);
	while (memoizedConfigurableFilters.size > MAX_MEMOIZED_CONFIGURABLE_FILTERS) {
		const oldest = memoizedConfigurableFilters.keys().next();
		if (oldest.done) break;
		memoizedConfigurableFilters.delete(oldest.value);
	}
};

//Exposed for tests, following the TESTING idiom in nlp.ts. The memo's size is
//not observable from outside otherwise: a counting getter on a card field fires
//during card PROCESSING (which is separately memoized), not during filter
//evaluation, so it cannot distinguish a memo hit from a miss. Two tests were
//written that way and measured nothing.
export const TESTING = {
	memoizedConfigurableFilterCount: () => memoizedConfigurableFilters.size,
	maxMemoizedConfigurableFilters: () => MAX_MEMOIZED_CONFIGURABLE_FILTERS,
	memoHasFilter: (name : string) => memoizedConfigurableFilters.has(name)
};

//The first filter here means 'map of card id to bools', not 'filter func'
//TODO: make it return the exclusion as second item
const makeFilterFromConfigurableFilter = (name : ConfigurableFilterName, extras : FilterExtras) : ConfigurableFilterResult => {
	const dayKey = relativeDateCacheKey();
	const generation = generationForExtras(extras);
	if (memoizedConfigurableFiltersGeneration === generation && memoizedConfigurableFiltersDayKey === dayKey) {
		const cached = memoizedConfigurableFilters.get(name);
		if (cached) {
			//Refresh recency so a filter in active use is not evicted by a burst
			//of one-shot query/ names typed alongside it.
			memoizedConfigurableFilters.delete(name);
			memoizedConfigurableFilters.set(name, cached);
			return cached;
		}
	} else {
		memoizedConfigurableFiltersGeneration = generation;
		memoizedConfigurableFiltersDayKey = dayKey;
		memoizedConfigurableFilters = new Map();
	}

	const [func, reverse, enumerate] = makeConfigurableFilter(name);

	//Filters that can enumerate their matching set directly (e.g. the
	//reference-graph filters, whose BFS map already is the answer) skip the
	//whole-corpus scan below — at 40k cards this turns each ~100ms
	//materialization into an O(references) one.
	if (enumerate && !reverse) {
		const {matches, sortValues} = enumerate(extras);
		const enumeratedResult : ConfigurableFilterResult = [matches, reverse, sortValues, null, false];
		storeMemoizedConfigurableFilter(name, enumeratedResult);
		return enumeratedResult;
	}

	const result : FilterMap = {};
	let sortValues : SortExtra | null = {};
	let partialMatches : CardBooleanMap | null = {};
	let hasPreview = false;
	for (const [id, card] of TypedObject.entries(extras.cards)) {
		const {matches, sortExtra, partialMatch, preview} = func(card, extras);
		//TODO: this doesn't handle cases where the func is a reversed func,
		//right? This isn't currently exercised, since none of the reversed
		//configurable filters emit sortValues.
		if (matches) {
			result[id] = true;
			if (sortExtra !== undefined) sortValues[id] = sortExtra;
			if (partialMatch) partialMatches[id] = true;
		}
		if (preview) hasPreview = true;
	}

	if (Object.keys(sortValues).length == 0) sortValues = null;
	if (Object.keys(partialMatches).length == 0) partialMatches = null;

	const fullResult : ConfigurableFilterResult = [result, reverse, sortValues, partialMatches, hasPreview];

	storeMemoizedConfigurableFilter(name, fullResult);

	return fullResult;
};

//Instead of keeping the filter inverse, this actually expands it into a literal
//filter. allCardsFilter should be the result of selectAllCardsFilter.
//inverseFilter is the concrete filter that you want to be the opposite of.
//Typically inverse filters are represented as the opposite concrete filter and
//never made literal like this, this is most useful for creating
//unionFilterSets. allCardsFilter can also just be the full set of id =>
//fullCard.
export const makeConcreteInverseFilter = (inverseFilter : FilterMap, allCardsFilter : CardIDMap) : FilterMap => {
	return Object.fromEntries(Object.entries(allCardsFilter).filter(entry => !inverseFilter[entry[0]]).map(entry => [entry[0], true]));
};

//makeFilterUnionSet takes a definition like "starred+in-reading-list" and
//returns a synthetic filter object that is the union of all of the filters
//named. The individual names may be normal filters or inverse filters.
//
//MEMOIZED per union name (#769): a union containing an INVERSE member
//expands via makeConcreteInverseFilter, which walks the entire cards map —
//measured ~22ms per evaluation at 40k cards — and this ran unmemoized on
//every collection evaluation. With #745's default-ON sticky search filter
//(`prioritized+published`, whose first member is an inverse), that was a
//whole-corpus walk per debounced find keystroke. The memo keys on
//everything the result depends on: each member's membership identity (in
//order) and, when any member is inverse, the cards identity. Returning the
//SAME object on a hit also stabilizes result identity, which downstream
//identity-keyed memos (the extras memo) were measured busting on.
type UnionSetMemoEntry = {
	sources : unknown[],
	result : FilterMap,
};

//Weakly keyed on the FIRST resolvable member's membership map, the #749
//pattern (and the one this codebase's lib target supports — no WeakRef):
//when a corpus is dropped, its filter membership maps go unreferenced and
//every entry hanging off them — including the corpus-sized result and the
//cards token — is collected with them. This memo's first version held all
//of that STRONGLY in a module Map, reintroducing exactly the retention
//class #749 fixed; its adversarial review measured the pin by execution.
//While the key map is alive its sibling sources are alive anyway (they are
//maps of the same filters state), so nothing outlives its corpus.
const unionSetMemo = new WeakMap<object, Map<UnionFilterName, UnionSetMemoEntry>>();

//Distinct union names come from URLs and the sticky search expression — a
//handful in practice — but cap each corpus's inner map so a pathological
//URL stream cannot grow it without bound. LRU: a hit refreshes recency
//(delete+set), matching the configurable-filter memo, whose sizing note
//records that LRU measured strictly better than FIFO.
const UNION_SET_MEMO_MAX_ENTRIES = 32;

const makeFilterUnionSet = (unionFilterDefinition : UnionFilterName, filterSetMemberships : Filters, cards : CardIDMap, cardsContentToken : unknown) : FilterMap => {
	const subFilterNames = unionFilterDefinition.split(UNION_FILTER_DELIMITER);
	//The identity sources, in member order: the membership map for a normal
	//member, the membership map of the INVERSE for an inverse member. The
	//cards CONTENT TOKEN — never the cards identity, which the worker keeps
	//stable while mutating contents in place (#769 review: identity-keying
	//made newly-synced prioritized unpublished cards invisible to the
	//default sticky filter) — is appended only when an inverse member makes
	//the result depend on the full card set, so unions of normal filters
	//don't recompute on unrelated card churn.
	const sources : unknown[] = subFilterNames.map(filterName => {
		if (filterSetMemberships[filterName]) return filterSetMemberships[filterName];
		if (INVERSE_FILTER_NAMES[filterName]) return filterSetMemberships[INVERSE_FILTER_NAMES[filterName]];
		return undefined;
	});
	if (subFilterNames.some(filterName => !filterSetMemberships[filterName] && INVERSE_FILTER_NAMES[filterName])) {
		//BOTH the cards identity and the content token. The token catches
		//in-place mutation behind a stable identity (the worker's full
		//corpus). The identity catches a DIFFERENT cards map under the SAME
		//token: the worker's narrowed query runs evaluate against a fresh
		//restricted proxy with the same version counter, and keying on the
		//token alone let a full-corpus run hit a narrowed run's
		//under-inclusive result.
		sources.push(cards, cardsContentToken);
	}
	const compute = () : FilterMap => {
		const subFilters = subFilterNames.map(filterName => {
			if (filterSetMemberships[filterName]) return filterSetMemberships[filterName];
			if (INVERSE_FILTER_NAMES[filterName]) return makeConcreteInverseFilter(filterSetMemberships[INVERSE_FILTER_NAMES[filterName]], cards);
			return {};
		});
		return Object.fromEntries(subFilters.map(filter => Object.entries(filter)).reduce((accum, val) => accum.concat(val),[]));
	};
	const weakKey = sources.find(source => typeof source === 'object' && source !== null);
	//No resolvable member: the result is {} (or the inverse of everything
	//with no anchor) and there is nothing safe to key on — just compute.
	if (!weakKey) return compute();
	let byName = unionSetMemo.get(weakKey as object);
	if (!byName) {
		byName = new Map();
		unionSetMemo.set(weakKey as object, byName);
	}
	const memoized = byName.get(unionFilterDefinition);
	if (memoized && memoized.sources.length === sources.length && memoized.sources.every((source, index) => source === sources[index])) {
		//LRU refresh.
		byName.delete(unionFilterDefinition);
		byName.set(unionFilterDefinition, memoized);
		return memoized.result;
	}
	const result = compute();
	if (memoized) byName.delete(unionFilterDefinition);
	if (byName.size >= UNION_SET_MEMO_MAX_ENTRIES) {
		const oldest = byName.keys().next().value;
		if (oldest !== undefined) byName.delete(oldest);
	}
	byName.set(unionFilterDefinition, {sources, result});
	return result;
};

//Returns a function that takes an item and returns true if it's in ALL
//includeSets and not in any exclude sets.
const makeCombinedFilter = (includeSets : FilterMap[], excludeSets : FilterMap[]) : FilterFunc => {
	return function(item) {
		for (const set of includeSets) {
			if (!set[item]) return false;
		}
		for (const set of excludeSets) {
			if (set[item]) return false;
		}
		return true;
	};
};

export const filterSetForFilterDefinitionItem = (filterDefinitionItem : FilterName, extras : FilterExtras) : ConfigurableFilterResult => {
	const filterSetMemberships = extras.filterSetMemberships;
	if (filterNameIsUnionFilter(filterDefinitionItem)) {
		return [makeFilterUnionSet(filterDefinitionItem, filterSetMemberships, extras.cards, extras.cardsContentToken), false, null, null, false];
	}
	if (filterNameIsConfigurableFilter(filterDefinitionItem)) {
		return makeFilterFromConfigurableFilter(filterDefinitionItem, extras);
	}
	if (filterSetMemberships[filterDefinitionItem]) {
		//A name resolving NOW may have been reported earlier in this
		//process: section/tag filter names load async, so an early boot
		//recompute can record a diagnostic against a valid URL. Retract on
		//success so the user-facing notice self-corrects (#757).
		retractURLDiagnostic(filterDefinitionItem);
		return [filterSetMemberships[filterDefinitionItem], false, null, null, false];
	}
	if (INVERSE_FILTER_NAMES[filterDefinitionItem]) {
		retractURLDiagnostic(filterDefinitionItem);
		return [filterSetMemberships[INVERSE_FILTER_NAMES[filterDefinitionItem]], true, null, null, false];
	}
	//If unknown, then just treat it like a no op, excluding nothing.
	//
	//This is also how /c/linear/ ends up showing an unrelated card (#754): a
	//trailing slash means "default item in the collection" (deliberate, and
	//documented in collection_description_base), so `linear` is read as a
	//COLLECTION part, lands here as an unknown filter, no-ops, and the default
	//card of the resulting collection is shown -- under a URL that names a
	//specific card. The grammar is intentional; silently showing a different
	//card is not, so say what happened.
	reportURLDiagnostic(filterDefinitionItem, 'ignored it, because it is not a filter or set — if you meant a card, the URL should not end in a slash');
	return [{}, true, null, null, false];
};

//makeExtrasForFilterFunc makes a new extras object containing the extra
//information passed to the configurable filter funcs. Many filter funcs only
//need some subset of the information, and information that ANY func needs must
//be passed to all. Wiring through the arguments through the whole filter func
//path is error prone each time a new type of data needs to be wired through, so
//we use an extras object that the filter func can unpack as necessary. The
//extras object is memoized so you can check for equality to see if any
//individual portion changed.
//
//Weakly keyed on the CARDS map, which is the first parameter for exactly
//this reason (#749): the plain memoize held its last three argument tuples
//STRONGLY, so the last three distinct extras each pinned a whole processed
//corpus — measured 51.0 → 30.6 MB on flushing it — and outlived every
//app-side reference on sign-out or account switch, which made #744's
//weak-keying of the downstream configurable-filter cache deliver zero net
//benefit. The per-cards entry budget (8) covers several concurrent
//distinct rest-tuples (active + query + reference-block runs with
//differing keyCardID/cardSimilarity) without thrashing that downstream
//memo, which keys on this function's RESULT IDENTITY.
const makeExtrasForFilterFunc = memoizeWeakFirstArg((cards : ProcessedCards, filterSetMemberships : Filters, keyCardID : CardID, editingCard : ProcessedCard | null, userID : Uid, randomSalt : string, cardSimilarity: CardSimilarityMap, editingCardSimilarity : SortExtra | null, idfMap : IDFMap | null, cardsContentToken : unknown = cards) : FilterExtras => {
	return {
		filterSetMemberships,
		cards,
		keyCardID,
		editingCard,
		userID,
		randomSalt,
		cardSimilarity,
		editingCardSimilarity,
		idfMap,
		cardsContentToken
	};
}, 8);

type FilterFunc = (id : CardID) => boolean;

type FilterDefinition = FilterName[];

//True if computing this description's numCards requires the full Collection
//machinery (because a filter is configurable and needs real card objects).
export const descriptionRequiresFullCollectionCount = (description : CollectionDescription) : boolean => {
	return description.filters.some(filterName => filterNameIsConfigurableFilter(filterName));
};

//Cheaply computes what description.collection(args).numCards would return,
//without instantiating a Collection or expanding/sorting any cards — just set
//intersection over precomputed filter membership maps. Only legal when
//descriptionRequiresFullCollectionCount is false. allCardIDs may be any map
//keyed by every card ID; it is only consulted to concretize inverse filters
//inside union filters.
export const countForDescription = (description : CollectionDescription, sets : Sets, filters : Filters, allCardIDs : CardIDMap) : number => {
	const baseSet = sets[description.set] || [];
	let count = baseSet.length;
	if (description.filters.length) {
		//Safe cast: with no configurable filters, extras.cards is only ever
		//used as an ID map (see makeFilterUnionSet).
		const extras : FilterExtras = {
			filterSetMemberships: filters,
			cards: allCardIDs as ProcessedCards,
			cardsContentToken: allCardIDs,
			keyCardID: '',
			editingCard: null,
			userID: '',
			randomSalt: '',
			cardSimilarity: {},
			editingCardSimilarity: null,
			idfMap: null
		};
		const [combinedFilter] = combinedFilterForFilterDefinition(description.filters, extras);
		count = 0;
		for (const id of baseSet) {
			if (combinedFilter(id)) count++;
		}
	}
	//Mirror the numCards getter's offset/limit math exactly, clamp included
	//(#752: an oversized offset must count 0, not negative).
	let len = Math.max(0, count - description.offset);
	if (description.limit) len = Math.min(len, description.limit);
	return len;
};

//filterDefinition is an array of filter-set names (concrete or inverse or union-set)
const combinedFilterForFilterDefinition = (filterDefinition : FilterDefinition, extras : FilterExtras) : [filter : FilterFunc, sortExtras : SortExtras, partialMatches : CardBooleanMap, preview: boolean] => {
	const includeSets = [];
	const excludeSets = [];
	const sortExtras : SortExtras = {};
	let partialExtras : CardBooleanMap = {};
	let hasPreview = false;
	for (const name of filterDefinition) {
		const [filterSet, reverse, sortInfos, partialMatches, preview] = filterSetForFilterDefinitionItem(name, extras);
		if (reverse) {
			excludeSets.push(filterSet);
		} else {
			includeSets.push(filterSet);
		}
		const configurableFilterFirstPart = name.split('/')[0];
		if (sortInfos) sortExtras[configurableFilterFirstPart] = sortInfos;
		if (partialMatches) partialExtras = {...partialExtras, ...partialMatches};
		if (preview) hasPreview = true;
	}
	return [makeCombinedFilter(includeSets, excludeSets), sortExtras, partialExtras, hasPreview];
};

//Removes labels that are the same as the one htat came before them.
const removeUnnecessaryLabels = (arr : string[]) : string[] => {
	const result = [];
	let lastLabel = '';
	let labelCount = 0;
	for (const item of arr) {
		if (item === lastLabel) {
			result.push('');
			continue;
		}
		lastLabel = item;
		result.push(item);
		labelCount++;
	}
	//If all the labels are the same for each card then there's no reason to
	//show them.
	if (labelCount == 1) return result.map(() => '');
	return result;
};

const expandCardCollection = (collection : CardID[], cards : ProcessedCards) : ProcessedCard[] => collection.map(id => cards[id] || null).filter(card => card ? true : false);

//Exported to resolve typescript warnings, but don't create directly, get one from CollectionDescription.collection()
export class Collection {

	_description : CollectionDescription;
	_keyCardID : CardID | '';
	_arguments : CollectionConstructorArguments;
	_cardsForFiltering : ProcessedCards;
	_cardsForExpansion : ProcessedCards;
	_sets : Sets;
	_filters : Filters;
	_filtersSnapshot : Filters | null;
	_editingCard? : ProcessedCard;
	_sections : Sections;
	_fallbacks : SerializedDescriptionToCardList;
	_startCardsConfig : SerializedDescriptionToCardList;
	_userID : Uid;
	_randomSalt : string;
	_cardSimilarity : CardSimilarityMap;
	_editingCardSimilarity? : SortExtra;
	_idfMap : IDFMap | null;
	_filteredCards : ProcessedCard[] | null;
	_cachedFilterExtras : FilterExtras;
	//See FilterExtras.cardsContentToken.
	_cardsContentToken : unknown;
	_collectionIsFallback : boolean;
	_sortedCards : ProcessedCard[] | null;
	_labels : string[] | null;
	_startCards : ProcessedCard[] | null;
	_finalSortedCards : ProcessedCard[] | null;
	_finalLabels : string[] | null;
	//TODO: correct title casing
	_preLimitlength : number;
	_sortExtras : SortExtras;
	//True when this collection came from a worker result, so sortExtras were
	//never computed. 'empty' and 'unknown' must not be confused (see reorderable).
	_sortExtrasUnknown : boolean;
	_partialMatches : CardBooleanMap;
	_preview = false;
	//True only for the main thread's transitional placeholder in cutover
	//mode: the description just changed and the worker's matching result has
	//not arrived yet, so ids/numCards/isFallback are NOT authoritative.
	//Consumers whose behavior branches on collection state (e.g. hiding the
	//drawer for a fallback collection) should hold their previous answer
	//while this is true rather than acting on placeholder values (#762).
	_transitional = false;
	_sortInfo : Map<CardID, [sortValue : number, label : string]> | null;
	_webInfo : WebInfo | null;

	//See CollectionDescription.collection() for the shape of the
	//collectionArguments object. It's passed in as an object and not as an
	//unpacked array so we can maintain the object identity so that memoizing
	//machinery can keep track. You can get one from selectCollectionConstructorArguments
	constructor(description : CollectionDescription, collectionArguments : CollectionConstructorArguments) {
		this._arguments = collectionArguments;
		Object.freeze(this._arguments);
		this._description = description;
		this._keyCardID = collectionArguments.keyCardID || '';
		//Most of our logic operates on the old snapshot of cards, so when
		//things are edited they don't pop out of the collection but rather get
		//ghosted.
		this._cardsForFiltering = collectionArguments.cardsSnapshot || collectionArguments.cards;
		//This is the most recent version of cards. We use it for the expanded
		//cards, and also when doing pendingFilters.
		this._cardsForExpansion = collectionArguments.cards;
		//Defaults to the filtering map's identity, correct wherever cards
		//update immutably; the worker overrides with its mutation counter.
		this._cardsContentToken = collectionArguments.cardsContentToken ?? this._cardsForFiltering;
		this._sets = collectionArguments.sets;
		this._filters = collectionArguments.filters;
		this._filtersSnapshot = collectionArguments.filtersSnapshot || null;
		this._editingCard = collectionArguments.editingCard;
		//Needed for sort info :-(
		this._sections = collectionArguments.sections || {};
		this._fallbacks = collectionArguments.fallbacks || {};
		this._startCardsConfig = collectionArguments.startCards || {};
		this._userID = collectionArguments.userID || '';
		this._randomSalt = collectionArguments.randomSalt || '';
		this._cardSimilarity = collectionArguments.cardSimilarity || {};
		this._editingCardSimilarity = collectionArguments.editingCardSimilarity;
		this._idfMap = collectionArguments.idfMap || null;
		//The filtered cards... before any size limit has been applied, if necessary
		this._filteredCards = null;
		this._preLimitlength = 0;
		this._collectionIsFallback = false;
		this._sortInfo = null;
		this._sortedCards = null;
		this._labels = null;
		this._startCards = null;
		this._finalSortedCards = null;
		this._finalLabels = null;
		this._webInfo = null;
		//sortExtras is extra information that configurable filters can
		//optionally return and then make use of in special sorts later.
		this._sortExtras = {};
		this._partialMatches = {};
	}

	//If the new arguments differ from the previous collection's ONLY in the
	//live cards map (the common case after a single-card edit echo: cards
	//changes identity, but the ghosting snapshot inputs that filtering and
	//sorting actually consume are untouched), build a new Collection that
	//carries over the previous collection's computed filter/sort work and only
	//re-expands card objects (O(collection length) map lookups). Returns null
	//when a full rebuild is required.
	static handoff(previous : Collection, description : CollectionDescription, args : CollectionConstructorArguments) : Collection | null {
		const prevArgs = previous._arguments;
		//Nothing to hand off if the previous collection never did its work.
		if (!previous._filteredCards) return null;
		if (!description.equivalent(previous._description)) return null;
		//Filtering ran over cardsSnapshot (if present) — it must be identical.
		//Without a snapshot, filtering ran over the live cards map, which is
		//exactly what changed, so no handoff is possible.
		if (!args.cardsSnapshot || args.cardsSnapshot !== prevArgs.cardsSnapshot) return null;
		//Filter extras used filtersSnapshot when present, else live filters.
		if (args.filtersSnapshot) {
			if (args.filtersSnapshot !== prevArgs.filtersSnapshot) return null;
		} else {
			if (prevArgs.filtersSnapshot) return null;
			if (args.filters !== prevArgs.filters) return null;
		}
		if (args.sets !== prevArgs.sets) return null;
		if (args.sections !== prevArgs.sections) return null;
		if (args.fallbacks !== prevArgs.fallbacks) return null;
		if (args.startCards !== prevArgs.startCards) return null;
		if ((args.keyCardID || '') !== (prevArgs.keyCardID || '')) return null;
		if (args.editingCard !== prevArgs.editingCard) return null;
		if ((args.userID || '') !== (prevArgs.userID || '')) return null;
		if ((args.randomSalt || '') !== (prevArgs.randomSalt || '')) return null;
		if (args.cardSimilarity !== prevArgs.cardSimilarity) return null;
		if (args.editingCardSimilarity !== prevArgs.editingCardSimilarity) return null;
		//The idf map feeds filter extras (the similar-cards fallback), so a
		//changed identity — a new epoch — must not reuse the old filter work.
		if ((args.idfMap || null) !== (prevArgs.idfMap || null)) return null;

		const result = new Collection(description, args);
		//Carry over everything _makeFilteredCards computed; only the expansion
		//against the (changed) live cards map is redone.
		const filteredIDs = previous._filteredCards.map(card => card.id);
		result._filteredCards = expandCardCollection(filteredIDs, result._cardsForExpansion);
		result._sortExtras = previous._sortExtras;
		result._partialMatches = previous._partialMatches;
		result._preview = previous._preview;
		result._collectionIsFallback = previous._collectionIsFallback;
		result._preLimitlength = previous._preLimitlength;
		//Sort info was extracted from snapshot cards, so it's still valid —
		//except for cards that weren't in the snapshot (e.g. created since the
		//last snapshot commit), whose entries were extracted from the live
		//card. In that rare case leave sort state lazy for a full recompute.
		const allInSnapshot = filteredIDs.every(id => previous._cardsForFiltering[id]);
		if (allInSnapshot) {
			if (previous._sortInfo) result._sortInfo = previous._sortInfo;
			if (previous._sortInfo && previous._sortedCards) {
				result._sortedCards = expandCardCollection(previous._sortedCards.map(card => card.id), result._cardsForExpansion);
				if (previous._labels) result._labels = previous._labels;
			}
		}
		perfCount('collection:handoff');
		return result;
	}

	//Builds a Collection whose expensive computed state is pre-seeded from a
	//result the corpus worker already computed, so no filtering or sorting
	//happens on the UI thread. Because this is a REAL Collection, every
	//consumer keeps its exact type and getter surface; any getter that isn't
	//pre-seeded (e.g. sortValueForCard, webInfo) lazily computes on the UI
	//thread as a graceful fallback.
	static fromWorkerResult(description : CollectionDescription, args : CollectionConstructorArguments, result : WorkerCollectionResult) : Collection {
		const collection = new Collection(description, args);
		const cards = args.cards;
		const expand = (ids : CardID[]) => expandCardCollection(ids, cards);
		const finalCards = expand(result.ids);
		const startCards = finalCards.slice(0, result.numStartCards);
		const sortedCards = finalCards.slice(result.numStartCards);
		//Pre-seed so every _ensure* no-ops.
		collection._startCards = startCards;
		collection._sortedCards = sortedCards;
		collection._finalSortedCards = finalCards;
		collection._labels = result.labels.slice(result.numStartCards);
		collection._finalLabels = result.labels;
		//filteredCards feeds numCards via _preLimitlength; reconstruct the
		//pre-limit count from the numCards math (numCards = preLimit - offset,
		//capped by limit — the cap can't be inverted, so prefer the raw list
		//length when no limit applies).
		collection._filteredCards = sortedCards;
		collection._preLimitlength = result.numCards + description.offset;
		collection._collectionIsFallback = result.isFallback;
		collection._preview = result.preview;
		collection._transitional = Boolean(result.transitional);
		collection._partialMatches = result.partialMatches;
		//Sort info is deliberately left lazy; sortExtras stays empty (label
		//functions for exotic sorts may degrade — acceptable while gated).
		//But `reorderable` also reads _sortExtras, and sort/default's predicate
		//is "reorderable iff there are no sortExtras" — so an empty map made
		//EVERY worker-served collection reorderable, including the
		//reference-graph ones (children/descendants/parents/similar) that
		//master correctly refused. Dropping a thumbnail there permanently
		//rewrites that card's sort_order in its section, based on a drag
		//inside a BFS-ordered view. Record that sortExtras is unknown rather
		//than empty so reorderable can fail closed.
		collection._sortExtrasUnknown = true;
		perfCount('collection:fromWorkerResult');
		return collection;
	}

	get description() {
		return this._description;
	}


	get _filterExtras() : FilterExtras {
		if (!this._cachedFilterExtras) {
			this._cachedFilterExtras = makeExtrasForFilterFunc(this._cardsForFiltering, this._filtersSnapshot || this._filters, this._keyCardID, this._editingCard || null, this._userID, this._randomSalt, this._cardSimilarity, this._editingCardSimilarity || null, this._idfMap, this._cardsContentToken);
		}
		return this._cachedFilterExtras;
	}

	//This will return true if any card in any filter used to make this collection returned preview:true
	get preview() : boolean {
		this._ensureFilteredCards();
		return this._preview;
	}

	_makeFilteredCards() {
		const start = performance.now();
		const baseSet = this._sets[this._description.set] || [];
		let filteredItems = baseSet;
		//Only bother filtering down the items if there are filters defined.
		if (this._description.filters && this._description.filters.length) {
			const [combinedFilter, sortExtras, partialMatches, preview] = combinedFilterForFilterDefinition(this._description.filters, this._filterExtras);
			filteredItems = baseSet.filter(item => combinedFilter(item));
			this._sortExtras = sortExtras;
			this._partialMatches = partialMatches;
			this._preview = preview;
		}
		this._preLimitlength = filteredItems.length;
		if (filteredItems.length == 0) {
			this._collectionIsFallback = true;
			filteredItems = this._fallbacks[this._description.serialize()] || [];
		}
		const result = expandCardCollection(filteredItems, this._cardsForExpansion);
		logSlowCollectionWork('filter', this._description, baseSet.length, start);
		return result;
	}

	_ensureFilteredCards() {
		if (this._filteredCards) return;
		this._filteredCards = this._makeFilteredCards();
	}

	//constructorArguments gets the constructor arguments passed as the second
	//argument to this collection's consturctor. That allows it to be passed to
	//other things that need it easily.
	get constructorArguments() {
		return this._arguments;
	}

	//numCards is the number of cards that matched, excluding fallbacks or
	//start_cards or anything like that.
	get numCards() {
		this._ensureFilteredCards();
		//The default offset is 0. It's how many items to skip at the front.
		//Clamped: an offset past the match count used to render a negative
		//count ("-761 cards") in the drawer header (#752).
		let len = Math.max(0, this._preLimitlength - this._description.offset);
		//A limit of 0 means no limit.
		if (this._description.limit) len = Math.min(len, this._description.limit);
		return len;
	}

	get _preLimitFilteredCards() {
		this._ensureFilteredCards();
		if (!this._filteredCards) throw new Error('ensurefilteredCards didn\'t work');
		return this._filteredCards;
	}

	get filteredCards() {
		this._ensureFilteredCards();
		if (!this._filteredCards) throw new Error('ensurefilteredCards didn\'t work');
		//a limit of 0 is 'all cards'. If there is a limit (or a non-zero
		//offset), we have to sort the cards before taking the limit/offset.
		//this.sortedCards will also include the limited subset.
		return (this._description.limit || this._description.offset) ? this.sortedCards : this._filteredCards;
	}

	get isFallback() {
		//Make sure that filteredCollection has been created, which will have
		//set collectionIsFallback correctly;
		this._ensureFilteredCards();
		return this._collectionIsFallback;
	}

	//True while this collection is the cutover-mode placeholder awaiting the
	//worker's authoritative result. See the _transitional field comment.
	get isTransitional() {
		return this._transitional;
	}

	//Returns a map of card_id --> true for all cards that are in filteredCards
	//but would be removed if filters were used instead of filtersSnapshot.
	cardsThatWillBeRemoved() {

		if (!this._filtersSnapshot) return {};

		let filterDefinition = this._description.filters;

		//Extend the filter definition with the filter equilvanet for the set
		//we're using. This makes reading-list work correctly, and any changes
		//in cards that might change what set they're in. Basically we use all
		//cards and then filter them down to the list that was in the set
		//originally. This is OK because we're returning a set, not an array,
		//from this method, so order doesn't matter.

		const filterEquivalentForActiveSet = SET_INFOS[this._description.set].filterEquivalent;
		if (filterEquivalentForActiveSet) filterDefinition = [...filterDefinition, filterEquivalentForActiveSet];

		const [currentFilterFunc,,] = combinedFilterForFilterDefinition(filterDefinition, makeExtrasForFilterFunc(this._cardsForFiltering, this._filtersSnapshot, this._keyCardID, this._editingCard || null, this._userID, this._randomSalt, this._cardSimilarity, this._editingCardSimilarity || null, this._idfMap, this._cardsContentToken));
		const [pendingFilterFunc,,] = combinedFilterForFilterDefinition(filterDefinition, makeExtrasForFilterFunc(this._cardsForExpansion, this._filters, this._keyCardID, this._editingCard || null, this._userID, this._randomSalt, this._cardSimilarity, this._editingCardSimilarity || null, this._idfMap, this._cardsContentToken));
		//Return the set of items that pass the current filters but won't pass the pending filters.
		const itemsThatWillBeRemoved = Object.keys(this._cardsForFiltering).filter(item => currentFilterFunc(item) && !pendingFilterFunc(item));
		return Object.fromEntries(itemsThatWillBeRemoved.map(item => [item, true]));
	}

	_makeSortInfo() {
		const config = this._description.sortConfig;
		//_prelimitFilteredCards uses the most up to date version of the card, but we want to use the snapshot version.
		const entries : [CardID, SortExtractorResult][] = this._preLimitFilteredCards.map((card : ProcessedCard) => {
			//In almost all cases we want to use the precise card that the
			//filtering machinery saw (which is possibly a snapshot). however,
			//there are some cases where the card does exist in the set but is
			//not in the snapshot, e.g. when you're viewing a section and a card
			//was just created in that section but a snapshot updating event
			//hasn't happened. In that case, the best fallback is to pass the
			//card even though it's not in the cards, to avoid downstream
			//machinery freaking out with an undefined card.
			const cardToPass = this._cardsForFiltering[card.id] || card;
			return [card.id, config.extractor(cardToPass, this._sections, this._cardsForFiltering, this._sortExtras, this._filterExtras)];
		});
		return new Map(entries);
	}

	_ensureSortInfo() {
		if(this._sortInfo) return;
		this._sortInfo = this._makeSortInfo();
	}

	_makeSortedCards() {
		const start = performance.now();
		const collection = this._preLimitFilteredCards;
		this._ensureSortInfo();
		//Skip the work of sorting in the default case, as everything is already
		//sorted. No-op collections still might be created and should be fast.
		if (this._description.set == 'main' && this._description.sort == 'default' && !this._description.sortReversed && (!this._sortExtras || Object.keys(this._sortExtras).length == 0)) {
			logSlowCollectionWork('sort-skip', this._description, collection.length, start);
			return collection;
		}
		const sortInfo = this._sortInfo;
		if (!sortInfo) throw new Error('no sortInfo as expected');
		const sort = (left : ProcessedCard, right : ProcessedCard) => {
			if(!left || !right) return 0;
			//Info is the underlying sort value, then the label value.
			const leftInfo = sortInfo.get(left.id);
			const rightInfo = sortInfo.get(right.id);
			if (!leftInfo || !rightInfo) return 0;
			return rightInfo[0] - leftInfo[0];
		};
		const sortedCards = [...collection].sort(sort);
		if (this._description.sortReversed) sortedCards.reverse();
		logSlowCollectionWork('sort', this._description, collection.length, start);
		return sortedCards;
	}

	_ensureSortedCards() {
		if(this._sortedCards) return;
		this._sortedCards = this._makeSortedCards();
	}

	//The raw numerical value for a card. Note that this might not be reversed as desired.
	sortValueForCard(id : CardID) : number {
		this._ensureSortInfo();
		const sortInfo = this._sortInfo;
		if (!sortInfo) throw new Error('no sort info as expected');
		const record = sortInfo.get(id);
		if (!record) return Number.MIN_SAFE_INTEGER;
		return record[0];
	}

	get reorderable() {
		const config = this._description.sortConfig;
		if (!config.reorderable) return false;
		//Fail closed when sortExtras were never computed (worker-served
		//collections): "no sortExtras" is indistinguishable from "not yet
		//known", and guessing wrong here writes a bogus sort_order to the
		//server. Sorts that are unconditionally reorderable are unaffected
		//because their predicate ignores the argument.
		if (this._sortExtrasUnknown && config.reorderable.length > 0) return false;
		return config.reorderable(this._sortExtras);
	}

	get sortLabelName() {
		this._ensureFilteredCards();
		const config = this._description.sortConfig;
		let labelName = config.labelName;
		if (typeof labelName == 'function') {
			labelName = labelName(this._sortExtras);
		}
		return labelName;
	}

	_ensureStartCards() {
		if(this._startCards) return;
		this._startCards = expandCardCollection(this._startCardsConfig[this._description.serialize()] || [], this._cardsForExpansion);
	}

	//sortedCards is the sorted cards, WITHOUT any applicable startCards
	//prepended. See also finalSortedCards.
	get sortedCards() {
		this._ensureSortedCards();
		//A limit of 0 is 'all cards'; This is where the actual limit / offset
		//filter happens, since the cards have to be sorted first before taking
		//the limit or offset. filteredCards will return the results from this if there's
		//a limit in place.
		const rawSortedCards = this._sortedCards;
		if (!rawSortedCards) throw new Error('no sorted cards as expected');
		let sortedCards = rawSortedCards.slice(this._description.offset);
		if (this._description.limit) sortedCards = sortedCards.slice(0, this._description.limit);
		return sortedCards;
	}

	get finalSortedCards() : ProcessedCard[] {
		if (this._finalSortedCards) return this._finalSortedCards;
		this._ensureStartCards();
		const startCards = this._startCards;
		if (!startCards) throw new Error('No start cards as expected');
		this._finalSortedCards = [...startCards, ...this.sortedCards];
		return this._finalSortedCards;
	}

	get numStartCards() {
		this._ensureStartCards();
		const startCards = this._startCards;
		if (!startCards) throw new Error('No start cards as expected');
		return startCards.length;
	}

	get partialMatches() {
		this._ensureFilteredCards();
		return this._partialMatches;
	}

	_makeLabels() {
		const sortedCards = this.sortedCards;
		//sortedCards requires sortInfo to be created so we can just grab it.
		const sortInfo = this._sortInfo;
		if (!sortInfo) throw new Error('no sort info as expected');
		const rawLabels = sortedCards.map(card => {
			const info = sortInfo.get(card.id);
			if (!info) return '';
			return info[1];
		});
		return removeUnnecessaryLabels(rawLabels);
	}

	_ensureLabels() {
		if(this._labels) return;
		this._labels = this._makeLabels();
	}

	//labels is the labels for the collection WITHOUT start cards. See also finalLabels
	get labels() {
		this._ensureLabels();
		const labels = this._labels;
		if (!labels) throw new Error('no labels as expected');
		return labels;
	}

	get finalLabels() {
		if (this._finalLabels) return this._finalLabels;
		this._ensureStartCards();
		const startCards = this._startCards;
		if (!startCards) throw new Error('no start cards as expected');
		this._finalLabels = [...startCards.map(() => ''), ...this.labels];
		return this._finalLabels;
	}

	_ensureWebInfo() {
		if (this._webInfo) return;
		if (this._description.viewMode != 'web') {
			this._webInfo = {nodes:[], edges:[]};
			return;
		}
		const nodes = this.filteredCards.map(card => ({id: card.id, name: card.title || card.id}));
		const nodeMap = Object.fromEntries(nodes.map(o => [o.id, true]));
		const edges = [];
		for (const card of this.filteredCards) {
			const refs = references(card);
			for (const edge of refs.substantiveArray()) {
				//Skip edes that point to nodes not currently selected
				if (!nodeMap[edge]) continue;
				//TODO: include similarity in shape
				edges.push({source: card.id, target: edge, value: 1});
			}
		}
		this._webInfo = {
			nodes,
			edges,
		};
	}

	//information necessary to build a visual graph of cards in the collection.
	get webInfo() {
		this._ensureWebInfo();
		return this._webInfo;
	}

	// Note: Pagination support was removed because Collection instances are recreated
	// on every state change, which loses pagination state. A proper fix would store
	// pagination state in Redux, but for Phase 4 we're using client-side filtering only.

}

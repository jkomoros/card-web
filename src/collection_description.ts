import {
	INVERSE_FILTER_NAMES,
	SORTS,
	SORT_URL_KEYWORD,
	SORT_REVERSED_URL_KEYWORD,
	SET_NAMES,
	UNION_FILTER_DELIMITER,
	CONFIGURABLE_FILTER_URL_PARTS,
	CONFIGURABLE_FILTER_NAMES,
	LIMIT_FILTER_NAME,
	OFFSET_FILTER_NAME,
	VIEW_MODE_URL_KEYWORD,
	LEGAL_VIEW_MODES,
	makeConfigurableFilter,
	queryConfigurableFilterText,
	queryTextFromQueryFilter,
	SET_INFOS,
} from './filters.js';

import {
	TypedObject
} from './typed_object.js';

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
	SetName,
	Sets,
	SortName,
	ViewMode,
	Uid,
	WebInfo,
	FilterMap,
	FilterExtras,
	CardIDMap,
	CardBooleanMap,
	FilterName,
	URLPart,
	ConfigurableFilterName,
	UnionFilterName,
	CardSimilarityMap,
	ConfigurableFilterResult,
	viewMode as viewModeSchema
} from './types.js';

import {
	KEY_CARD_ID_PLACEHOLDER	
} from './card_fields.js';

import {
	memoize
} from './memoize.js';

import { references } from './references.js';

const extractFilterNamesSortAndView = (parts : URLPart[]) : [FilterName[], SortName, boolean, ViewMode, string] => {
	//returns the filter names, the sort name, and whether the sort is reversed
	//parts is all of the unconsumed portions of the path that aren't the set
	//name or the card name.
	if (!parts.length) return [[], 'default', false, 'list', ''];
	const filters : FilterName[] = [];
	let sortName : SortName = 'default';
	let sortReversed = false;
	let viewMode : ViewMode = 'list';
	let viewModeExtra = '';
	let nextPartIsSort = false;
	let nextPartIsView = false;
	let nextPartIsViewExtra = false;
	//The actual multi-part filter we're accumulating
	let multiPartFilter = [];
	//How many more ports we need until multiPartFilter is done.
	let expectedRemainingMultiParts = 0;
	for (let i = 0; i < parts.length; i++) {
		const part = parts[i];
		if (part == '') continue;
		if (part == SORT_URL_KEYWORD) {
			nextPartIsSort = true;
			//handle the case where there was already one sort, and only listen
			//to the last reversed.
			sortReversed = false;
			continue;
		}
		if (nextPartIsSort) {
			if (part == SORT_REVERSED_URL_KEYWORD) {
				sortReversed = true;
				//Note that we requested a reverse, and then expect the  next
				//part to be the sort name
				continue;
			}
			//We don't know what sort names are valid, so we'll just assume it's fine.
			sortName = part as SortName;
			nextPartIsSort = false;
			continue;
		}
		if (part == VIEW_MODE_URL_KEYWORD) {
			nextPartIsView = true;
			nextPartIsViewExtra = false;
			continue;
		}
		if (nextPartIsView) {
			viewMode = viewModeSchema.parse(part);
			nextPartIsView = false;
			//LEGA_VIEW_MODES is a map of view mode to whether or not it expects
			//an extra. Note that we have no way of signaling an error, so we
			//just assume the viewMode is legal.
			if (LEGAL_VIEW_MODES[viewMode]) nextPartIsViewExtra = true;
			continue;
		}
		if (nextPartIsViewExtra) {
			viewModeExtra = part;
			nextPartIsViewExtra = false;
			continue;
		}
		if (CONFIGURABLE_FILTER_URL_PARTS[part]) {
			//It's the beginning of a collection.
			//No matter what we add this on.
			multiPartFilter.push(part);
			//First, if we're already in a multi-count section, keep track that
			//we got another piece, which might have satisfied all of it
			if (expectedRemainingMultiParts) {
				expectedRemainingMultiParts--;
			}
			//Now keep track of how many more pieces the new thing needs to eat
			expectedRemainingMultiParts += CONFIGURABLE_FILTER_URL_PARTS[part];
			continue;
		}
		if (expectedRemainingMultiParts) {
			multiPartFilter.push(part);
			expectedRemainingMultiParts--;
			if (expectedRemainingMultiParts == 0) {
				//Only add multi-part filters that started with one of the valid
				//start filter names. We process up until this point, so even if
				//the URL started in the middle of a multi-part parsing, we
				//still consume it.
				if (CONFIGURABLE_FILTER_NAMES[multiPartFilter[0]]) filters.push(multiPartFilter.join('/'));
				multiPartFilter = [];
			}
			continue;
		}
		filters.push(part);
	}
	return [filters, sortName, sortReversed, viewMode, viewModeExtra];
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
	const newFilters = [];
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
	return collectionDescriptionWithConfigurableFilter(description, queryConfigurableFilterText(queryText));
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
		for (const filter of filterNames) {
			if (filter.startsWith(LIMIT_FILTER_NAME + '/')){
				limit = parseInt(filter.split('/')[1]);
				if (isNaN(limit)) limit = 0;
				if (limit < 0) limit = 0;
			} else if (filter.startsWith(OFFSET_FILTER_NAME + '/')) {
				offset = parseInt(filter.split('/')[1]);
				if (isNaN(offset)) offset = 0;
				if (offset < 0) offset = 0;
			}
		}

		this._setNameExplicitlySet = setNameExplicitlySet;
		this._set = setName,
		this._filters = filterNames,
		this._sort = sortName,
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
		return SORTS[this.sort];
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
		let result = [];

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
	collection(collectionArguments : CollectionConstructorArguments) : Collection {
		return new Collection(this, collectionArguments);
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

		const [filters, sortName, sortReversed, viewMode, viewModeExtra] = extractFilterNamesSortAndView(parts);

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

let memoizedConfigurableFiltersExtras : FilterExtras | null = null;
let memoizedConfigurableFilters : {[name : string] : ConfigurableFilterResult} = {};

//The first filter here means 'map of card id to bools', not 'filter func'
//TODO: make it return the exclusion as second item
const makeFilterFromConfigurableFilter = (name : ConfigurableFilterName, extras : FilterExtras) : ConfigurableFilterResult => {
	if (memoizedConfigurableFiltersExtras == extras) {
		if (memoizedConfigurableFilters[name]) {
			return memoizedConfigurableFilters[name];
		}
	} else {
		memoizedConfigurableFiltersExtras = null;
		memoizedConfigurableFilters = {};
	}

	const [func, reverse] = makeConfigurableFilter(name);
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

	memoizedConfigurableFilters[name] = fullResult;

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
const makeFilterUnionSet = (unionFilterDefinition : UnionFilterName, filterSetMemberships : Filters, cards : CardIDMap) : FilterMap => {
	const subFilterNames = unionFilterDefinition.split(UNION_FILTER_DELIMITER);
	const subFilters = subFilterNames.map(filterName => {
		if (filterSetMemberships[filterName]) return filterSetMemberships[filterName];
		if (INVERSE_FILTER_NAMES[filterName]) return makeConcreteInverseFilter(filterSetMemberships[INVERSE_FILTER_NAMES[filterName]], cards);
		return {};
	});
	return Object.fromEntries(subFilters.map(filter => Object.entries(filter)).reduce((accum, val) => accum.concat(val),[]));
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
		return [makeFilterUnionSet(filterDefinitionItem, filterSetMemberships, extras.cards), false, null, null, false];
	}
	if (filterNameIsConfigurableFilter(filterDefinitionItem)) {
		return makeFilterFromConfigurableFilter(filterDefinitionItem, extras);
	}
	if (filterSetMemberships[filterDefinitionItem]) {
		return [filterSetMemberships[filterDefinitionItem], false, null, null, false];
	}
	if (INVERSE_FILTER_NAMES[filterDefinitionItem]) {
		return [filterSetMemberships[INVERSE_FILTER_NAMES[filterDefinitionItem]], true, null, null, false];
	}
	//If unknown, then just treat it like a no op, excluding nothing
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
const makeExtrasForFilterFunc = memoize((filterSetMemberships : Filters, cards : ProcessedCards, keyCardID : CardID, editingCard : ProcessedCard | null, userID : Uid, randomSalt : string, cardSimilarity: CardSimilarityMap, editingCardSimilarity : SortExtra | null) : FilterExtras => {
	return {
		filterSetMemberships,
		cards,
		keyCardID,
		editingCard,
		userID,
		randomSalt,
		cardSimilarity,
		editingCardSimilarity
	};
});

type FilterFunc = (id : CardID) => boolean;

type FilterDefinition = FilterName[];

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
	_filteredCards : ProcessedCard[] | null;
	_cachedFilterExtras : FilterExtras;
	_collectionIsFallback : boolean;
	_sortedCards : ProcessedCard[] | null;
	_labels : string[] | null;
	_startCards : ProcessedCard[] | null;
	//TODO: correct title casing
	_preLimitlength : number;
	_sortExtras : SortExtras;
	_partialMatches : CardBooleanMap;
	_preview = false;
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
		//The filtered cards... before any size limit has been applied, if necessary
		this._filteredCards = null;
		this._preLimitlength = 0;
		this._collectionIsFallback = false;
		this._sortInfo = null;
		this._sortedCards = null;
		this._labels = null;
		this._startCards = null;
		this._webInfo = null;
		//sortExtras is extra information that configurable filters can
		//optionally return and then make use of in special sorts later.
		this._sortExtras = {};
		this._partialMatches = {};
	}

	get description() {
		return this._description;
	}

	get _filterExtras() : FilterExtras {
		if (!this._cachedFilterExtras) {
			this._cachedFilterExtras = makeExtrasForFilterFunc(this._filtersSnapshot || this._filters, this._cardsForFiltering, this._keyCardID, this._editingCard || null, this._userID, this._randomSalt, this._cardSimilarity, this._editingCardSimilarity || null);
		}
		return this._cachedFilterExtras;
	}

	//This will return true if any card in any filter used to make this collection returned preview:true
	get preview() : boolean {
		this._ensureFilteredCards();
		return this._preview;
	}

	_makeFilteredCards() {
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
		return expandCardCollection(filteredItems, this._cardsForExpansion);
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
		let len = this._preLimitlength - this._description.offset;
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

		const [currentFilterFunc,,] = combinedFilterForFilterDefinition(filterDefinition, makeExtrasForFilterFunc(this._filtersSnapshot, this._cardsForFiltering, this._keyCardID, this._editingCard || null, this._userID, this._randomSalt, this._cardSimilarity, this._editingCardSimilarity || null));
		const [pendingFilterFunc,,] = combinedFilterForFilterDefinition(filterDefinition, makeExtrasForFilterFunc(this._filters, this._cardsForExpansion, this._keyCardID, this._editingCard || null, this._userID, this._randomSalt, this._cardSimilarity, this._editingCardSimilarity || null));
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
		const collection = this._preLimitFilteredCards;
		this._ensureSortInfo();
		//Skip the work of sorting in the default case, as everything is already
		//sorted. No-op collections still might be created and should be fast.
		if (this._description.set == 'main' && this._description.sort == 'default' && !this._description.sortReversed && (!this._sortExtras || Object.keys(this._sortExtras).length == 0)) {
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
		this._ensureStartCards();
		const startCards = this._startCards;
		if (!startCards) throw new Error('No start cards as expected');
		return [...startCards, ...this.sortedCards];
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
		return this._labels;
	}

	get finalLabels() {
		this._ensureStartCards();
		return [...this._startCards.map(() => ''), ...this.labels];
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

}
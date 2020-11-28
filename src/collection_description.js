import {
	INVERSE_FILTER_NAMES,
	SORTS,
	DEFAULT_SORT_NAME,
	SORT_URL_KEYWORD,
	SORT_REVERSED_URL_KEYWORD,
	DEFAULT_SET_NAME,
	SET_NAMES,
	UNION_FILTER_DELIMITER,
	FILTER_EQUIVALENTS_FOR_SET,
	CONFIGURABLE_FILTER_URL_PARTS,
	CONFIGURABLE_FILTER_NAMES,
	LIMIT_FILTER_NAME,
	makeConfigurableFilter,
} from './filters.js';

const extractFilterNamesAndSort = (parts) => {
	//returns the filter names, the sort name, and whether the sort is reversed
	//parts is all of the unconsumed portions of the path that aren't the set
	//name or the card name.
	if (!parts.length) return [[], DEFAULT_SORT_NAME, false];
	let filters = [];
	let sortName = DEFAULT_SORT_NAME;
	let sortReversed = false;
	let nextPartIsSort = false;
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
			sortName = part;
			nextPartIsSort = false;
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
	return [filters, sortName, sortReversed];
};

export const CollectionDescription = class {

	constructor(setName, filterNames, sortName, sortReversed) {
		let setNameExplicitlySet = true;
		if (!setName) {
			setName = DEFAULT_SET_NAME;
			setNameExplicitlySet = false;
		}
		if (!sortName) sortName = DEFAULT_SORT_NAME;
		if (!sortReversed) sortReversed = false;
		if (!filterNames) filterNames = [];

		if (typeof sortReversed != 'boolean') throw new TypeError();
		if (typeof setName != 'string') throw new TypeError();
		if (typeof sortName != 'string') throw new TypeError();
		if (!Array.isArray(filterNames)) throw new TypeError();
		if (!filterNames.every(item => typeof item == 'string')) throw new TypeError();

		let limit = 0;
		for (let filter of filterNames) {
			if (!filter.startsWith(LIMIT_FILTER_NAME + '/')) continue;
			limit = parseInt(filter.split('/')[1]);
			if (isNaN(limit)) limit = 0;
		}

		this._setNameExplicitlySet = setNameExplicitlySet;
		this._set = setName,
		this._filters = filterNames,
		this._sort = sortName,
		this._sortReversed = sortReversed;
		this._limit = limit;
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

	get sortConfig() {
		return SORTS[this.sort] || SORTS[DEFAULT_SORT_NAME];
	}

	//IF the collection wants to limit how many items to return, this will
	//return a number greater than zero, for where the collection should be
	//capped.
	get limit() {
		return this._limit;
	}

	//serialize returns a canonical string representing this collection
	//description, which if used as a component of the URL will match these
	//collection semantics. The string uniquely and precisely defines the
	//collection with the given semantics. It may include extra tings that are
	//not in the canonical URL because they are elided (like the default set
	//name). It also may be in  adifferent order than what is in the URL, since
	//all items are in a canonical sorted order but the URL is optimized to stay
	//as the user wrote it.
	serialize() {
		let result = [this.set];

		let filterNames = [...this.filters];
		filterNames.sort();
	
		result = result.concat(filterNames);
	
		if (this.sort != DEFAULT_SORT_NAME || this.sortReversed) {
			result.push(SORT_URL_KEYWORD);
			if (this.sortReversed) result.push(SORT_REVERSED_URL_KEYWORD);
			result.push(this.sort);
		}
	
		//Have a trailing slash
		result.push('');
		return result.join('/');
	}

	//serializeShort is like serialize, but skips leading set name if it's
	//default.
	serializeShort() {
		let result = [];

		if (this.set != DEFAULT_SET_NAME) result.push(this.set);

		let filterNames = [...this.filters];
		filterNames.sort();

		result = result.concat(filterNames);

		if (this.sort != DEFAULT_SORT_NAME || this.sortReversed) {
			result.push(SORT_URL_KEYWORD);
			if (this.sortReversed) result.push(SORT_REVERSED_URL_KEYWORD);
			result.push(this.sort);
		}

		//Have a trailing slash
		result.push('');
		return result.join('/');
	}

	equivalent(other) {
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
	collection(cards, sets, filters, optSections, optFallbacks, optStartCards) {
		return new Collection(this, cards, sets, filters, optSections, optFallbacks, optStartCards);
	}

	static deserialize(input) {
		let [result, ] = CollectionDescription.deserializeWithExtra(input);
		return result;
	}

	//deserializeWithExtra takes the output of serialize() (which is a part of a URL). It
	//returns an array with two items: 1) the CollectionDescription, and 2) the
	//'rest', which is likely the card ID or '' if nothing.
	static deserializeWithExtra(input) {
		let parts = input.split('/');

		//We do not remove a trailing slash; we take a trailing slash to mean
		//"deafult item in the collection".

		//in some weird situations, like during editing commit, we might be at no
		//route even when our view is active. Not entirely clear how, but it
		//happens... for a second.
		let firstPart = parts.length ? parts[0] : '';

		let setName = '';

		for (let name of SET_NAMES) {
			if (name == firstPart) {
				setName = firstPart;
				parts.shift();
				break;
			}
		}

		//Get last part, which is the card selector (and might be "").
		let extra = parts.pop();

		let [filters, sortName, sortReversed] = extractFilterNamesAndSort(parts);

		return [new CollectionDescription(setName,filters,sortName,sortReversed), extra];
	}
};

const filterNameIsUnionFilter = (filterName) => {
	//the + can be include in a configurable filter, e.g `children/+ab123`
	return filterName.includes(UNION_FILTER_DELIMITER)  && !filterNameIsConfigurableFilter(filterName);
};

const filterNameIsConfigurableFilter = (filterName) => {
	return filterName.includes('/');
};

let memoizedConfigurableFiltersCards = null;
let memoizedConfigurableFilterSetMemberships = null;
let memoizedConfigurableFilters = {};

//The first filter here means 'map of card id to bools', not 'filter func'
//TODO: make it return the exclusion as second item
const makeFilterFromConfigurableFilter = (name, filterSetMemberships, cards) => {
	if (memoizedConfigurableFiltersCards == cards && memoizedConfigurableFilterSetMemberships == filterSetMemberships) {
		if (memoizedConfigurableFilters[name]) {
			return memoizedConfigurableFilters[name];
		}
	} else {
		memoizedConfigurableFiltersCards = cards;
		memoizedConfigurableFilterSetMemberships = filterSetMemberships;
		memoizedConfigurableFilters = {};
	}

	const [func, reverse] = makeConfigurableFilter(name);
	const result = {};
	let sortValues = {};
	let partialMatches = {};
	for (let [id, card] of Object.entries(cards)) {
		let funcResult = func(card, cards, filterSetMemberships);
		let matches = funcResult;
		let sortValue = undefined;
		let partialMatch = false;
		if (Array.isArray(funcResult)) {
			matches = funcResult[0];
			sortValue = funcResult[1];
			if (funcResult.length >= 3) partialMatch = funcResult[2];
		}
		//TODO: this doesn't handle cases where the func is a reversed func,
		//right? This isn't currently exercised, since none of the reversed
		//configurable filters emit sortValues.
		if (matches) {
			result[id] = true;
			if (sortValue !== undefined) sortValues[id] = sortValue;
			if (partialMatch) partialMatches[id] = true;
		}
	}

	if (Object.keys(sortValues).length == 0) sortValues = null;
	if (Object.keys(partialMatches).length == 0) partialMatches = null;

	let fullResult = [result, reverse, sortValues, partialMatches];

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
const makeConcreteInverseFilter = (inverseFilter, allCardsFilter) => {
	return Object.fromEntries(Object.entries(allCardsFilter).filter(entry => !inverseFilter[entry[0]]).map(entry => [entry[0], true]));
};

//makeFilterUnionSet takes a definition like "starred+in-reading-list" and
//returns a synthetic filter object that is the union of all of the filters
//named. The individual names may be normal filters or inverse filters.
const makeFilterUnionSet = (unionFilterDefinition, filterSetMemberships, cards) => {
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
const makeCombinedFilter = (includeSets, excludeSets) => {
	return function(item) {
		for (let set of includeSets) {
			if (!set[item]) return false;
		}
		for (let set of excludeSets) {
			if (set[item]) return false;
		}
		return true;
	};
};

export const filterSetForFilterDefinitionItem = (filterDefinitionItem, filterSetMemberships, cards) => {
	if (filterNameIsUnionFilter(filterDefinitionItem)) {
		return [makeFilterUnionSet(filterDefinitionItem, filterSetMemberships, cards), false, null, null];
	}
	if (filterNameIsConfigurableFilter(filterDefinitionItem)) {
		return makeFilterFromConfigurableFilter(filterDefinitionItem, filterSetMemberships, cards);
	}
	if (filterSetMemberships[filterDefinitionItem]) {
		return [filterSetMemberships[filterDefinitionItem], false, null, null];
	}
	if (INVERSE_FILTER_NAMES[filterDefinitionItem]) {
		return [filterSetMemberships[INVERSE_FILTER_NAMES[filterDefinitionItem]], true, null, null];
	}
	//If unknown, then just treat it like a no op, excluding nothing
	return [{}, true, null, null];
};

//filterDefinition is an array of filter-set names (concrete or inverse or union-set)
const combinedFilterForFilterDefinition = (filterDefinition, filterSetMemberships, cards) => {
	let includeSets = [];
	let excludeSets = [];
	let sortExtras = {};
	let partialExtras = {};
	for (let name of filterDefinition) {
		let [filterSet, reverse, sortInfos, partialMatches] = filterSetForFilterDefinitionItem(name, filterSetMemberships, cards);
		if (reverse) {
			excludeSets.push(filterSet);
		} else {
			includeSets.push(filterSet);
		}
		const configurableFilterFirstPart = name.split('/')[0];
		if (sortInfos) sortExtras[configurableFilterFirstPart] = sortInfos;
		if (partialMatches) partialExtras = {...partialExtras, ...partialMatches};
	}
	return [makeCombinedFilter(includeSets, excludeSets), sortExtras, partialExtras];
};

//Removes labels that are the same as the one htat came before them.
const removeUnnecessaryLabels = (arr) => {
	let result = [];
	let lastLabel = '';
	let labelCount = 0;
	for (let item of arr) {
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

const expandCardCollection = (collection, cards) => collection.map(id => cards[id] || null).filter(card => card ? true : false);

const Collection = class {
	constructor(description, cards, sets, filters, optSections, optFallbacks, optStartCards) {
		this._description = description;
		this._cards = cards;
		this._sets = sets;
		this._filters = filters;
		//Needed for sort info :-(
		this._sections = optSections || {};
		this._fallbacks = optFallbacks || {};
		this._startCardsConfig = optStartCards || {};
		//The filtered cards... before any size limit has been applied, if necessary
		this._filteredCards = null;
		this._preLimitlength = 0;
		this._collectionIsFallback = null;
		this._sortInfo = null;
		this._sortedCards = null;
		this._labels = null;
		this._startCards = null;
		//sortExtras is extra information that configurable filters can
		//optionally return and then make use of in special sorts later.
		this._sortExtras = {};
		this._partialMatches = {};
	}

	_makeFilteredCards() {
		const baseSet = this._sets[this._description.set] || [];
		let filteredItems = baseSet;
		//Only bother filtering down the items if there are filters defined.
		if (this._description.filters && this._description.filters.length) {
			const [combinedFilter, sortExtras, partialMatches] = combinedFilterForFilterDefinition(this._description.filters, this._filters, this._cards);
			filteredItems = baseSet.filter(item => combinedFilter(item));
			this._sortExtras = sortExtras;
			this._partialMatches = partialMatches;
		}
		this._preLimitlength = filteredItems.length;
		if (filteredItems.length == 0) {
			this._collectionIsFallback = true;
			filteredItems = this._fallbacks[this._description.serialize()] || [];
		}
		return expandCardCollection(filteredItems, this._cards);
	}

	_ensureFilteredCards() {
		if (this._filteredCards) return;
		this._filteredCards = this._makeFilteredCards();
	}

	//numCards is the number of cards that matched, excluding fallbacks or
	//start_cards or anything like that.
	get numCards() {
		this._ensureFilteredCards();
		//A limit of 0 means 
		return this._description.limit ? Math.min(this._preLimitlength, this._description.limit) : this._preLimitlength;
	}

	get _preLimitFilteredCards() {
		this._ensureFilteredCards();
		return this._filteredCards;
	}

	get filteredCards() {
		this._ensureFilteredCards();
		//a limit of 0 is 'all cards'. If there is a limit, we have to sort the
		//cards before taking the limit. this.sortedCards will also include the
		//limited subset.
		return this._description.limit ? this.sortedCards : this._filteredCards;
	}

	get isFallback() {
		//Make sure that filteredCollection has been created, which will have
		//set collectionIsFallback correctly;
		this._ensureFilteredCards();
		return this._collectionIsFallback;
	}

	//Returns a map of card_id --> true for all cards that are in filteredCards
	//but would be removed if pendingFilters were used instead.
	cardsThatWillBeRemoved(pendingFilters) {
		let filterDefinition = this._description.filters;

		//Extend the filter definition with the filter equilvanet for the set
		//we're using. This makes reading-list work correctly, and any changes
		//in cards that might change what set they're in. Basically we use all
		//cards and then filter them down to the list that was in the set
		//originally. This is OK because we're returning a set, not an array,
		//from this method, so order doesn't matter.
		const filterEquivalentForActiveSet = FILTER_EQUIVALENTS_FOR_SET[this._description.set];
		if (filterEquivalentForActiveSet) filterDefinition = [...filterDefinition, filterEquivalentForActiveSet];

		const [currentFilterFunc,,] = combinedFilterForFilterDefinition(filterDefinition, this._filters, this._cards);
		const [pendingFilterFunc,,] = combinedFilterForFilterDefinition(filterDefinition, pendingFilters, this._cards);
		//Return the set of items that pass the current filters but won't pass the pending filters.
		const itemsThatWillBeRemoved = Object.keys(this._cards).filter(item => currentFilterFunc(item) && !pendingFilterFunc(item));
		return Object.fromEntries(itemsThatWillBeRemoved.map(item => [item, true]));
	}

	_makeSortInfo() {
		const config = this._description.sortConfig;
		let entries = this._preLimitFilteredCards.map(card => [card.id, config.extractor(card, this._sections, this._cards, this._sortExtras)]);
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
		if (this._description.set == DEFAULT_SET_NAME && this._description.sort == DEFAULT_SORT_NAME && !this._description.sortReversed && (!this._sortExtras || Object.keys(this._sortExtras).length == 0)) {
			return collection;
		}
		const sortInfo = this._sortInfo;
		let sort = (left, right) => {
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
		this._startCards = expandCardCollection(this._startCardsConfig[this._description.serialize()] || [], this._cards);
	}

	//sortedCards is the sorted cards, WITHOUT any applicable startCards
	//prepended. See also finalSortedCards.
	get sortedCards() {
		this._ensureSortedCards();
		//A limit of 0 is 'all cards'; This is where the actual limit filter
		//happens, since the cards have to be sorted first before taking the
		//limit. filteredCards will return the results from this if there's a
		//limit in place.
		return this._description.limit ? this._sortedCards.slice(0, this._description.limit) : this._sortedCards;
	}

	get finalSortedCards() {
		this._ensureStartCards();
		return [...this._startCards, ...this.sortedCards];
	}

	get numStartCards() {
		this._ensureStartCards();
		return this._startCards.length;
	}

	get partialMatches() {
		this._ensureFilteredCards();
		return this._partialMatches;
	}

	_makeLabels() {
		const sortedCards = this.sortedCards;
		//sortedCards requires sortInfo to be created so we can just grab it.
		const sortInfo = this._sortInfo;
		const rawLabels = sortedCards.map(card => sortInfo.get(card.id) ? sortInfo.get(card.id)[1] : '');
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

};
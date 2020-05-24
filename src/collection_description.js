export const DEFAULT_SET_NAME = 'all';
//reading-list is a set (as well as filters, e.g. `in-reading-list`) since the
//order matters and is customizable by the user. Every other collection starts
//from the `all` set and then filters and then maybe sorts, but reading-list
//lets a custom order.
export const READING_LIST_SET_NAME = 'reading-list';

//Note: every time you add a new set name, add it here too and make sure that a
//filter of that name is kept updated.
export const FILTER_EQUIVALENTS_FOR_SET = {
	[DEFAULT_SET_NAME]: 'in-all-set',
	[READING_LIST_SET_NAME]: 'in-reading-list',
};

//If filter names have this character in them then they're actually a union of
//the filters
export const UNION_FILTER_DELIMITER = '+';

export const SET_NAMES = Object.entries(FILTER_EQUIVALENTS_FOR_SET).map(entry => entry[0]);

//The word in the URL That means "the part after this is a sort".
export const SORT_URL_KEYWORD = 'sort';
export const SORT_REVERSED_URL_KEYWORD = 'reverse';

export const DEFAULT_SORT_NAME = 'default';
export const RECENT_SORT_NAME = 'recent';

import {
	INVERSE_FILTER_NAMES,
	SORTS,
} from './filters.js';

import {
	makeCombinedFilter,
	makeConcreteInverseFilter,
} from './util.js';

const extractFilterNamesAndSort = (parts) => {
	//returns the filter names, the sort name, and whether the sort is reversed
	//parts is all of the unconsumed portions of the path that aren't the set
	//name or the card name.
	if (!parts.length) return [[], DEFAULT_SORT_NAME, false];
	let filters = [];
	let sortName = DEFAULT_SORT_NAME;
	let sortReversed = false;
	let nextPartIsSort = false;
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

		this._setNameExplicitlySet = setNameExplicitlySet;
		this._set = setName,
		this._filters = filterNames,
		this._sort = sortName,
		this._sortReversed = sortReversed;
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
	//collectiondescription.
	collection(cards, sets, filters, optSections, optFallbacks) {
		return new Collection(this, cards, sets, filters, optSections, optFallbacks);
	}

	static deserialize(input) {
		let [result, ] = CollectionDescription.deserialize(input);
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
	return filterName.includes(UNION_FILTER_DELIMITER);
};

//makeFilterUnionSet takes a definition like "starred+in-reading-list" and
//returns a synthetic filter object that is the union of all of the filters
//named. The individual names may be normal filters or inverse filters.
const makeFilterUnionSet = (unionFilterDefinition, filterSetMemberships, allCardsFilter) => {
	const subFilterNames = unionFilterDefinition.split(UNION_FILTER_DELIMITER);
	const subFilters = subFilterNames.map(filterName => {
		if (filterSetMemberships[filterName]) return filterSetMemberships[filterName];
		if (INVERSE_FILTER_NAMES[filterName]) return makeConcreteInverseFilter(filterSetMemberships[INVERSE_FILTER_NAMES[filterName]], allCardsFilter);
		return {};
	});
	return Object.fromEntries(subFilters.map(filter => Object.entries(filter)).reduce((accum, val) => accum.concat(val),[]));
};

//filterDefinition is an array of filter-set names (concrete or inverse or union-set)
const combinedFilterForFilterDefinition = (filterDefinition, filterSetMemberships, allCardsFilter) => {
	let includeSets = [];
	let excludeSets = [];
	for (let name of filterDefinition) {
		if (filterNameIsUnionFilter(name)) {
			includeSets.push(makeFilterUnionSet(name, filterSetMemberships, allCardsFilter));
			continue;
		}
		if (filterSetMemberships[name]) {
			includeSets.push(filterSetMemberships[name]);
			continue;
		}
		if (INVERSE_FILTER_NAMES[name]) {
			excludeSets.push(filterSetMemberships[INVERSE_FILTER_NAMES[name]]);
			continue;
		}
	}
	return makeCombinedFilter(includeSets, excludeSets);
};

//TODO: this is duplicated in selectors.js
//expandCardCollection should be used any time we have a list of IDs of cards and a bundle of cards to expand.
const expandCardCollection = (collection, cards) => collection.map(id => cards[id] || null).filter(card => card ? true : false);

//Removes labels that are the same as the one htat came before them.
const removeUnnecessaryLabels = (arr) => {
	let result = [];
	let lastLabel = '';
	let labelCount = 0;
	for (let item of arr) {
		if (item == lastLabel) {
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

const Collection = class {
	constructor(description, cards, sets, filters, optSections, optFallbacks) {
		this._description = description;
		this._cards = cards;
		this._allCardsFilter = Object.fromEntries(Object.entries(cards).map(entry => [entry[0], true]));
		this._sets = sets;
		this._filters = filters;
		//Needed for sort info :-(
		this._sections = optSections || {};
		this._fallbacks = optFallbacks || {};
		this._filteredCards = null;
		this._collectionIsFallback = null;
		this._sortInfo = null;
		this._sortedCards = null;
		this._labels = null;
	}

	_makeFilteredCards() {
		const combinedFilter = combinedFilterForFilterDefinition(this._description.filters, this._filters, this._allCardsFilter);
		const baseSet = this._sets[this._description.set] || [];
		let filteredItems = baseSet.filter(item => combinedFilter(item));
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

	get filteredCards() {
		this._ensureFilteredCards();
		return this._filteredCards;
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

		const currentFilterFunc = combinedFilterForFilterDefinition(filterDefinition, this._filters, this._allCardsFilter);
		const pendingFilterFunc = combinedFilterForFilterDefinition(filterDefinition, pendingFilters, this._allCardsFilter);
		//Return the set of items that pass the current filters but won't pass the pending filters.
		const itemsThatWillBeRemoved = Object.keys(this._cards).filter(item => currentFilterFunc(item) && !pendingFilterFunc(item));
		return Object.fromEntries(itemsThatWillBeRemoved.map(item => [item, true]));
	}

	_makeSortInfo() {
		const config = this._description.sortConfig;
		let entries = this.filteredCards.map(card => [card.id, config.extractor(card, this._sections, this._allCardsFilter)]);
		return new Map(entries);
	}

	_ensureSortInfo() {
		if(this._sortInfo) return;
		this._sortInfo = this._makeSortInfo();
	}

	_makeSortedCards() {
		const collection = this.filteredCards;
		this._ensureSortInfo();
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

	get sortedCards() {
		this._ensureSortedCards();
		return this._sortedCards;
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

	get labels() {
		this._ensureLabels();
		return this._labels;
	}

};
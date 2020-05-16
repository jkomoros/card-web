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

//Returns a collectionDescription with the given configuration.
export const makeCollectionDescription = (setName, filterNames, sortName, sortReversed) => {
	if (!setName) setName = DEFAULT_SET_NAME;
	if (!sortReversed) sortReversed = false;
	if (typeof sortReversed != 'boolean') return null;
	if (typeof setName != 'string') return null;
	if (typeof sortName != 'string') return null;
	return {
		set: setName,
		filters: filterNames,
		sort: sortName,
		sortReversed,
	};
};

//TODO: make a serializeCollectionDescription() that returns the canonical serialization of it

//TODO: make a collectionDescriptionEquivalent() bool 

//checks if a given argument can be treated as a collection description
const isCollectionDescription = (obj) => {
	if (typeof obj !== 'object') return false;
	if (!obj.set) return false;
	if (typeof obj.set !== 'string') return false;
	if (!obj.filters) return false;
	if (obj.sort == undefined) return false;
	if (typeof obj.sort !== 'string') return false;
	if (obj.sortReversed === undefined) return false;
	return true;
};
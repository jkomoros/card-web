//Returns a collectionDescription with the given configuration.
export const makeCollectionDescription = (setName, filterNames, sortName, sortReversed) => {
	//TODO: set the defaults here 
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
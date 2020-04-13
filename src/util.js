import snarkdown from 'snarkdown';
import dompurify from 'dompurify';

//define this here and then re-export form app.js so this file doesn't need any
//other imports.
export const _PAGE_BASIC_CARD = 'basic-card';

//The limit that Firebase enacts for writes in one batch. MultiBatch will count
//writes correctly, including double-counting updates that use one of the
//readback sentinels.
const FIRESTORE_BATCH_LIMIT = 500;

//MultiBatch is a thing that can be used as a drop-in replacement firebase db
//batch, and will automatically split into multiple underlying batches if it's
//getting close to the limit. Note that unlike a normal batch, it's possible for
//a partial failure if one batch fails and others don't.
export const MultiBatch = class {
	constructor(db) {
		this._db = db;
		this._currentBatchOperationCount = 0;
		this._currentBatch = null;
		this._batches = [];
	}

	get _batch() {
		if (this._currentBatchOperationCount >= FIRESTORE_BATCH_LIMIT) {
			this._currentBatch = null;
		}
		if (!this._currentBatch) {
			this._currentBatch = this._db.batch();
			this._batches.push(this._currentBatch);
			this._currentBatchOperationCount = 0;
		}
		return this._currentBatch;
	}

	_writeCountForUpdate(update) {
		//Firestore treats updates as counting for 1, unless there are 1 or more
		//of {serverTimestamp, arrayUnion, or arrayRemove}.
		
		//Note: this function is very tied to the implementation of
		//firestore.FieldValue and may need to change if it changes.
		for (let val of Object.values(update)) {
			if (typeof val !== 'object') continue;
			if (!val['_methodName']) continue;
			if (typeof val['_methodName'] !== 'string') continue;
			const parts = val['_methodName'].split('.');
			if (parts.length !== 2) continue;
			if (parts[0] !== 'FieldValue') continue;
			if (parts[1] !== 'serverTimestamp' && parts[1] !== 'arrayRemove' && parts[1] != 'arrayUnion') continue;
			return 2;
		}
		return 1;
	}

	delete(ref) {
		this._batch.delete(ref);
		this._currentBatchOperationCount++;
		return this;
	}

	set(ref, data, options) {
		this._batch.set(ref, data, options);
		this._currentBatchOperationCount += this._writeCountForUpdate(data);
		return this;
	}

	update(ref, data) {
		//TODO: the signature in the documentation is kind of weird for this
		//one. Are there two different modes?
		this._batch.update(ref, data);
		this._currentBatchOperationCount += this._writeCountForUpdate(data);
		return this;
	}

	commit() {
		return Promise.all(this._batches.map(batch => batch.commit()));
	}

};

const randomCharSetNumbers = '0123456789';
const randomCharSetLetters = 'abcdef';
const randomCharSet = randomCharSetNumbers + randomCharSetLetters;

export const randomString = (length, charSet) => {
	if (!charSet) {
		charSet = randomCharSet;
	}
	let text = '';
	for (let i = 0; i < length; i++) {
		text += charSet.charAt(Math.floor(Math.random() * charSet.length));
	}
	return text;
};

//TODO: consider renaming this, because we also use it in selectFullDataNeeded.
export const pageRequiresMainView = (pageName) => {
	return pageName != _PAGE_BASIC_CARD;
};

export const capitalizeFirstLetter = (str) => {
	return str.charAt(0).toUpperCase() + str.slice(1);
};

export const toTitleCase = (str) => {
	//Based on https://gomakethings.com/converting-a-string-to-title-case-with-vanilla-javascript/
	str = str.toLowerCase().split(' ');
	for (var i = 0; i < str.length; i++) {
		str[i] = str[i].charAt(0).toUpperCase() + str[i].slice(1);
	}
	return str.join(' ');
};

const slugRegularExpression = /^[a-zA-Z0-9-_]+$/;

export const normalizeSlug = (slug) => {
	slug = slug.trim();
	slug = slug.toLowerCase();
	slug = slug.split(' ').join('-');
	slug = slug.split('_').join('-');

	if (!slugRegularExpression.test(slug)) slug = '';

	return slug;
};

export const newID = () => {
	return normalizeSlug('c_' + randomString(3, randomCharSetNumbers) + '_' + randomString(3, randomCharSetLetters) + randomString(3, randomCharSetNumbers));
};

export const urlForTweet = (tweet) => {
	return 'https://twitter.com/' + tweet.user_screen_name + '/status/' + tweet.id;
};

export const cardHasContent = (card) => {
	if (!card) return false;
	//We treat all non-content cards as having content, since the main reason to
	//count a card has not having content is if there's nothing to see on it.
	if (card.card_type != 'content') return true;
	let content = card.body ? card.body.trim() : '';
	return content ? true : false;
};

export const cardHasNotes = (card) => {
	if (!card) return false;
	let content = card.notes ? card.notes.trim() : '';
	return content ? true : false;
};

export const cardHasTodo = (card) => {
	if (!card) return false;
	let content = card.todo ? card.todo.trim() : '';
	return content ? true : false;
};

//cardMissingReciprocalLinks returns the links that point to a card that are not
//reciprocated and not explicitly listed as OK to skip.
export const cardMissingReciprocalLinks = (card) => {
	if (!card) return [];
	let links = new Map();
	if (card.links_inbound) {
		for (let link of card.links_inbound) {
			links.set(link, true);
		}
	}
	if (card.links) {
		for (let link of card.links) {
			links.delete(link);
		}
	}
	if (card.auto_todo_skipped_links_inbound) {
		for (let link of card.auto_todo_skipped_links_inbound) {
			links.delete(link);
		}
	}
	return [...links.keys()];
};

//other can be a card ID or a card
export const cardNeedsReciprocalLinkTo = (card, other) => {
	if (typeof other == 'object') other = other.id;
	if (!card || !other) return false;
	const missingReciprocalLinks = cardMissingReciprocalLinks(card);
	for (let link of missingReciprocalLinks) {
		if (link == other) return true;
	}
	return false;
};

export const extractCardLinksFromBody = (body) => {
	let ele = document.createElement('section');
	ele.innerHTML = body;
	let result = [];
	let nodes = ele.querySelectorAll('card-link[card]');
	nodes.forEach(link => result.push(link.getAttribute('card')));
	return arrayUnique(result);
};

//Returns true or false. filterName can be a filter or inverse filtername, if
//optInverseFilterNames is passed.
export const cardInFilter = (card, filterName, filters, optInverseFilterNames) => {
	//Idelaly optInverseFilterNames would just use the direct one from
	//reducers/collection.js. But that introudces a circular import.
	if (optInverseFilterNames && optInverseFilterNames[filterName]) {
		//inverse mode
		let inverseFilter = filters[optInverseFilterNames[filterName]];
		if (!inverseFilter) return false;
		return !inverseFilter[card.id];
	}
	let filter = filters[filterName];
	if (!filter) return false;
	return filter[card.id];
};

//Returns a set of name: true for each non-inverse filter that matches the given
//card, wherre filters is the set of filters to use, and if optFilterNames has
//any keys then only the keys in that set are considered.
export const cardMatchingFilters = (card, filters, optFilterNames, optInverseFilterNames) => {
	let filterNames = optFilterNames ? Object.keys(optFilterNames) : Object.keys(filters);
	let result = [];
	//We have ot iterat through the optFilterNames that were passed, insteaed of
	//tilers, in case optFilterNames includes inverse filters, otherwise none of
	//them would have matched.
	for (let name of filterNames) {
		if (cardInFilter(card, name, filters, optInverseFilterNames)) result.push(name);
	}
	return result;
};

export const arrayRemove = (arr, items) => {
	let itemsToRemove = new Map();
	for (let item of Object.values(items)) {
		itemsToRemove.set(item, true);
	}
	let result = [];
	for (let val of Object.values(arr)) {
		if (itemsToRemove.has(val)) continue;
		result.push(val);
	}
	return result;
};

export const arrayUnion = (arr, items) => {
	let result = [];
	let seenItems = new Map();
	for (let val of Object.values(arr)) {
		seenItems.set(val, true);
		result.push(val);
	}
	for (let val of Object.values(items)) {
		if (seenItems.has(val)) continue;
		result.push(val);
	}	
	return result;
};

export const arrayUnique = (arr) => {
	let seenItems = new Map();
	let result = [];
	for (let item of arr) {
		if (seenItems.has(item)) continue;
		result.push(item);
		seenItems.set(item, true);
	}
	return result;
};

export const arrayToSet = (arr) => {
	let result = {};
	for (let item of arr) {
		result[item] = true;
	}
	return result;
};

export const arrayDiffAsSets = (before, after) => {
	let [additions, deletions] = arrayDiff(before,after);
	return [arrayToSet(additions), arrayToSet(deletions)];
};

export const arrayDiff = (before, after) => {
	if (!before) before = [];
	if (!after) after = [];
	let afterMap = new Map();
	for (let item of after) {
		afterMap.set(item, true);
	}
	let deletions = [];
	for (let item of before) {
		if (afterMap.has(item)) {
			//Keep track of that we've seen this one
			afterMap.delete(item);
		} else {
			deletions.push(item);
		}
	}
	//Additions is the keys not remved in afterMap
	let additions = [...afterMap.keys()];
	return [additions, deletions];
};

//triStateMapDiff operates on objects that have keys that are either true or
//false. It returns keys to explicit set to true, keys to explicitly set to
//false, and keys to remove.
export const triStateMapDiff = (before, after) => {
	if (!before) before = {};
	if (!after) after = {};
	//Generat the list of removals by looking for keys that do not exist in
	//after but are in before.
	let removals = [];
	for (let beforeKey of Object.keys(before)) {
		if (after[beforeKey] === undefined) {
			removals.push(beforeKey);
		}
	}

	let enabled = [];
	let disabled = [];
	for (let afterKey of Object.keys(after)) {
		//If before has the after key undefined or false it doesn't matter; in
		//either case it requires an explicit set.
		if(before[afterKey] != after[afterKey]) {
			if (after[afterKey]) {
				enabled.push(afterKey);
			} else {
				disabled.push(afterKey);
			}
		}
	}

	return [enabled, disabled, removals];
};

/*
//Uncomment this block to test tri state.
function testTriStateMapDiff() {
	//TODO: do this in a proper testing framework
	const tests = [
		[
			'No op',
			{a: true, b: false},
			{a: true, b: false},
			[[],[],[]]
		],
		[
			'add c enabled',
			{a: true, b: false},
			{a: true, b: false, c: true},
			[['c'],[],[]],
		],
		[
			'add c disabled',
			{a: true, b: false},
			{a: true, b: false, c: false},
			[[],['c'],[]],
		],
		[
			'remove a',
			{a: true, b: false},
			{b: false},
			[[],[],['a']]
		],
		[
			'disable a',
			{a: true, b: false},
			{a: false, b: false},
			[[],['a'],[]]
		],
		[
			'remove a add c',
			{a: true, b: false},
			{b: false, c: false},
			[[],['c'],['a']]
		],
	];
	for (let test of tests) {
		const description = test[0];
		let [enabled, disabled, deleted] = triStateMapDiff(test[1], test[2]);
		let [goldenEnabled, goldenDisabled, goldenDeleted] = test[3];

		let [enabledAdditions, enabledDeletions] = arrayDiff(goldenEnabled, enabled);
		if (enabledAdditions.length != 0 || enabledDeletions.length != 0) console.warn(description + ' failed enabled didn\'t match: ' + enabled.toString());

		let [disabledAdditions, disabledDeletions] = arrayDiff(goldenDisabled, disabled);
		if (disabledAdditions.length != 0 || disabledDeletions.length != 0) console.warn(description + ' failed disabled didn\'t match: ' + disabled.toString());

		let [deletedAdditions, deletedDeletions] = arrayDiff(goldenDeleted, deleted);
		if (deletedAdditions.length != 0 || deletedDeletions.length != 0) console.warn(description + ' failed deletions didn\'t match: ' + deleted.toString());
	}
	console.log('Tristate tests passed');
}
testTriStateMapDiff();
*/

//items is an array
export const setRemove = (obj, items) => {
	let result = {};
	for (let key of Object.keys(obj)) {
		result[key] = true;
	}
	for (let item of items) {
		delete result[item];
	}
	return result;
};

//items is an array
export const setUnion = (obj, items) => {
	let result = {};
	for (let key of Object.keys(obj)) {
		result[key] = true;
	}
	for (let item of items) {
		result[item] = true;
	}
	return result;
};

const unionSet = (...sets) => {
	let result = {};
	for (let set of sets) {
		if (!set) continue;
		for (let key of Object.keys(set)) {
			result[key] = true;
		}
	}
	return result;
};

export const intersectionSet = (...sets) => {
	let union = unionSet(...sets);
	let result = {};
	for (let key of Object.keys(union)) {
		//Only include keys that are in every set.
		let doInclude = true;
		for (let set of sets) {
			if (!set) continue;
			if (!set[key]) {
				doInclude = false;
				break;
			}
		}
		if (doInclude) result[key] = true;
	}
	return result;
};

//This logic is finicky and we have a few defaults we want to have, so wrap it
//in a util.
export const makeElementContentEditable = (ele) => {
	ele.contentEditable = 'true';
	//It's OK if we have already done these commands to do them again

	//styleWithCSS turns off styling spans with CSS and just uses presentational
	//attributes. 
	document.execCommand('styleWithCSS', false, false);
	//Browsers currently insert a "<div>" as default paragraph separator but we
	//want 'p'; 
	document.execCommand('defaultParagraphSeparator', false, 'p');
};

//Returns a safe markdown element that can be emitted in a lit-html template.
export const markdownElement = (content) => {
	let div = document.createElement('div');
	let html = snarkdown(content);
	let sanitizedHTML = dompurify.sanitize(html);
	div.innerHTML = sanitizedHTML;
	return div;
};

//Returns a function that takes an item and returns true if it's in ALL
//includeSets and not in any exclude sets.
export const makeCombinedFilter = (includeSets, excludeSets) => {
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

//Instead of keeping the filter inverse, this actually expands it into a literal
//filter. allCardsFilter should be the result of selectAllCardsFilter.
//inverseFilter is the concrete filter that you want to be the opposite of.
//Typically inverse filters are represented as the opposite concrete filter and
//never made literal like this, this is most useful for creating
//unionFilterSets.
export const makeConcreteInverseFilter = (inverseFilter, allCardsFilter) => {
	return Object.fromEntries(Object.entries(allCardsFilter).filter(entry => !inverseFilter[entry[0]]));
};

//date may be a firestore timestamp or a date object.
export const prettyTime = (date) => {
	if (!date) return '';
	if (typeof date.toDate == 'function') date = date.toDate();
	return date.toDateString();
};

export const killEvent = (e) => {
	if (e) {
		e.preventDefault();
	}
	return true;
};

export const isWhitespace = (s) => {
	return /^\s*$/.test(s);
};

//Items in the reads and stars collections are stored at a canonical id given
//a uid and card id.
export const idForPersonalCardInfo = (uid, cardId) => {
	return '' + uid + '+' + cardId;
};
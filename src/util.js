import snarkdown from 'snarkdown';
import dompurify from 'dompurify';

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

export const cardHasContent = (card) => {
	//We treat all non-content cards as having content, since the main reason to
	//count a card has not having content is if there's nothing to see on it.
	if (card.card_type != 'content') return true;
	let content = card.body ? card.body.trim() : '';
	return content ? true : false;
};

export const cardHasNotes = (card) => {
	let content = card.notes ? card.notes.trim() : '';
	return content ? true : false;
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
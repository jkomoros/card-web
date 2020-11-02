import {
	stemmer
} from './stemmer.js';

//We import these only to get deleteSentinel without importing from firebase.js.
import firebase from '@firebase/app';
import '@firebase/firestore';
const deleteSentinel = firebase.firestore.FieldValue.delete;

export const TEXT_FIELD_BODY = 'body';
export const TEXT_FIELD_TITLE = 'title';
export const TEXT_FIELD_SUBTITLE = 'subtitle';
export const TEXT_FIELD_REFERENCES_INBOUND = 'references_inbound';

export const CARD_TYPE_CONTENT = 'content';
export const CARD_TYPE_SECTION_HEAD = 'section-head';
export const CARD_TYPE_WORKING_NOTES = 'working-notes';

/*

invertContentPublishWarning: if true, then the 'There's content but unpublished,
are you sure?' will not trigger... unelss you try to publish in which case it
will ask for confirmation.

invertOrphanWarning: if true, then the confirmation of 'You're about to make
this card orphaned' will be flipped

*/

export const CARD_TYPE_CONFIGURATION = {
	[CARD_TYPE_CONTENT]: {},
	[CARD_TYPE_SECTION_HEAD]: {},
	[CARD_TYPE_WORKING_NOTES]: {
		invertContentPublishWarning: true,
		invertOrphanWarning: true,
	},
};

//The propery on cardObj where references are stored. The final keys are
//strings, which might be ''. This is the primary fields, the sentinel fields
//are derived off of them
//NOTE: this next one is duplicated in tweet-helpers.js and both are in
//functions/updates.js;
export const REFERENCES_CARD_PROPERTY = 'references';
export const REFERENCES_INBOUND_CARD_PROPERTY = 'references_inbound';
//These two properties are exactly like the normal references fields exccept
//it's a map of cardID -> true for cards that are referenced.
export const REFERENCES_SENTINEL_CARD_PROPERTY = 'references_sentinel';
export const REFERENCES_INBOUND_SENTINEL_CARD_PROPERTY = 'references_inbound_sentinel';

//For card-links within body content
//NOTE: duplicated in tweet-helpers.js
export const REFERENCE_TYPE_LINK = 'link';
//For cards that are dupes of another card
export const REFERENCE_TYPE_DUPE_OF = 'dupe-of';

export const LEGAL_REFERENCE_TYPES = {
	[REFERENCE_TYPE_LINK]: true,
	[REFERENCE_TYPE_DUPE_OF]: true,
};

/*
html: whether or not the field allows html. NOTE: currently it's only supported
for a single field to be marked as html, and it must be called 'body'. See #345
for fixing that.

container: the type of container element the field should be printed out into
(the actual card custom element will decide whether to print it out in the first
place)

legalCardTypes: a map of CARD_TYPE constant to true for cards it is legal on. If
this field is null, it signals it's legal on all card types.

derivedForCardTypes: a map of CARD_TYPE constant to true for card types for
which the field is fully derived based on OTHER enumrated fields. Derived fields
are already "counted" so should be skipped when extracting normalized card
details for example in indexes.

readOnly: if true, a form field to edit this won't be printed out in cardEditor.

matchWeight: if a match is found when searching in that field, how much weight
should it receive?

*/

export const TEXT_FIELD_CONFIGURATION = {
	[TEXT_FIELD_TITLE]: {
		html: false,
		container: 'h1',
		legalCardTypes: {[CARD_TYPE_CONTENT]: true, [CARD_TYPE_SECTION_HEAD]: true},
		derivedForCardTypes: {[CARD_TYPE_WORKING_NOTES]: true},
		matchWeight: 1.0,
	},
	[TEXT_FIELD_BODY]: {
		html: true,
		container: 'section',
		legalCardTypes: {[CARD_TYPE_CONTENT]: true, [CARD_TYPE_WORKING_NOTES]: true},
		derivedForCardTypes: {},
		matchWeight:0.5,
	},
	[TEXT_FIELD_SUBTITLE]: {
		html: false,
		container: 'h2',
		legalCardTypes: {[CARD_TYPE_SECTION_HEAD]: true},
		derivedForCardTypes: {},
		matchWeight:0.75,
	},
	[TEXT_FIELD_REFERENCES_INBOUND]: {
		html: false,
		readOnly: true,
		//null signals it's legal for all card types
		legalCardTypes: null,
		derivedForCardTypes: {},
		matchWeight:0.95,
	}
};

export const DERIVED_FIELDS_FOR_CARD_TYPE = Object.fromEntries(Object.keys(CARD_TYPE_CONFIGURATION).map(typ => {
	return [typ, Object.fromEntries(Object.entries(TEXT_FIELD_CONFIGURATION).filter(entry => (entry[1].derivedForCardTypes || {})[typ]).map(entry => [entry[0], true]))];
}));

//types of card that have a body
export const BODY_CARD_TYPES = TEXT_FIELD_CONFIGURATION[TEXT_FIELD_BODY].legalCardTypes;

export const editableFieldsForCardType = (cardType) => {
	let result = {};
	for (let key of Object.keys(TEXT_FIELD_CONFIGURATION)) {
		const config = TEXT_FIELD_CONFIGURATION[key];
		//Items with null for legalCardTypes are legal in all card types
		if (config.legalCardTypes && !config.legalCardTypes[cardType]) continue;
		if (config.readOnly) continue;
		result[key] = config;
	}
	return result;
};

export const normalizedWords = (str) => {
	if (!str) str = '';

	//Pretend like em-dashes are just spaces
	str = str.split('--').join(' ');
	str = str.split('&emdash;').join(' ');

	const splitWords = str.toLowerCase().split(/\s+/);
	let result = [];
	for (let word of splitWords) {
		word = word.replace(/^\W*/, '');
		word = word.replace(/\W*$/, '');
		if (!word) continue;
		result.push(word);
	}
	return result;
};

let memoizedStemmedWords = {};
const memorizedStemmer = (word) => {
	if (!memoizedStemmedWords[word]) {
		memoizedStemmedWords[word] = stemmer(word);
	}
	
	return memoizedStemmedWords[word];
};

//A more aggressive form of normalization
export const stemmedNormalizedWords = (str) => {
	//Assumes the words are already run through nomralizedWords

	//We split the words the same way in destemmedWordMap. We have to split
	//within here due to complex logic about where '-' is treated as a word
	//split and where it isnt in queries.
	const splitWords = str.split('-').join(' ').split(' ');
	let result = [];
	for (let word of splitWords) {
		result.push(memorizedStemmer(word));
	}
	return result;
};

const innerTextForHTML = (body) => {
	let ele = document.createElement('section');
	//TODO: is there an XSS vulnerability here?
	ele.innerHTML = body;
	return ele.innerText;
};

//Returns a string, where if it's an array or object (or any of their subkeys
//are) they're joined by ' '. This allows it to work straightforwardly for
//normal text properties, as well as arrays, objects, or even nested objects
//that have string values at the terminus.
const extractFieldValueForIndexing = (fieldValue) => {
	if (typeof fieldValue !== 'object') return fieldValue;
	if (!fieldValue) return '';
	return Object.values(fieldValue).map(item => extractFieldValueForIndexing(item)).join(' ');
};

//extractContentWords returns an object with the field to the non-de-stemmed
//normalized words for each of the main properties.
const extractContentWords = (card) => {
	const cardType = card.card_type || '';
	//These three properties are expected to be set by TEXT_SEARCH_PROPERTIES
	//Fields that are derived are calculated based on other fields of the card
	//and should not be considered to be explicit set on the card by the author.
	//For thse fields, skip them in normalized*, since they'll otherwise be part
	//of the fingerprint, and for cards with not much content that use the
	//fingerprint in a derived field that can create reinforcing loops.
	const obj = {};
	for (let [fieldName, config] of Object.entries(TEXT_FIELD_CONFIGURATION)) {
		let value = '';
		if (!DERIVED_FIELDS_FOR_CARD_TYPE[cardType][fieldName]) {
			const fieldValue = extractFieldValueForIndexing(card[fieldName]);
			const content = config.html ? innerTextForHTML(fieldValue) : fieldValue;
			const words = normalizedWords(content);
			value = words.join(' ');
		}
		obj[fieldName] = value;
	}
	return obj;
};

//destemmedWordMap returns a map of where each given destemmed word is mapped to
//its most common stemmed variant from within this card.
export const destemmedWordMap = (card) => {
	const content = extractContentWords(card);
	const counts = {};
	for (let str of Object.values(content)) {
		//We split the words the same way in stemmedNormalizedWords.
		const words = str.split('-').join(' ').split(' ');
		for (let word of words) {
			const stemmedWord = memorizedStemmer(word);
			if (!counts[stemmedWord]) counts[stemmedWord] = {};
			counts[stemmedWord][word] = (counts[stemmedWord][word] || 0) + 1;
		}
	}
	//counts is now a map of destemmedWord to word.
	const result = {};
	for (let [destemmedWord, wordCounts] of Object.entries(counts)) {
		let maxCount = 0;
		let maxWord = '';
		for (let [word, count] of Object.entries(wordCounts)) {
			if (count <= maxCount) continue;
			maxCount = count;
			maxWord = word;
		}
		result[destemmedWord] = maxWord;
	}
	return result;
};

//cardSetNormalizedTextProperties sets the properties that search and
//fingerprints work over. It sets them on the same card object sent.
export const cardSetNormalizedTextProperties = (card) => {
	//Basically it takes the output of extractContentWords and then stems them.
	card.normalized = Object.fromEntries(Object.entries(extractContentWords(card)).map(entry => [entry[0], stemmedNormalizedWords(entry[1]).join(' ')]));
};

//cardGetLinksArray returns an array of CARD_IDs this card points to via links.
//NOTE: this is duplicated manually in tweet-helpers.js
export const cardGetLinksArray = (cardObj) => {
	if (!cardObj) return [];
	const references = cardObj[REFERENCES_CARD_PROPERTY];
	if (!references) return [];
	//Remember that the falsey '' is still considered a set key
	return Object.entries(references).filter(entry => entry[1][REFERENCE_TYPE_LINK] !== undefined).map(entry => entry[0]);
};

//cardGetReferencesArray returns an array of CARD_IDs this card points to via any type of reference.
export const cardGetReferencesArray = (cardObj) => {
	if (!cardObj) return [];
	const references = cardObj[REFERENCES_CARD_PROPERTY];
	if (!references) return [];
	return Object.keys(references);
};

//cardGetInboundLinksArray returns an array of CARD_IDs that point to this card via links.
export const cardGetInboundLinksArray = (cardObj) => {
	if (!cardObj) return [];
	const references = cardObj[REFERENCES_INBOUND_CARD_PROPERTY];
	if (!references) return [];
	//Remember that the falsey '' is still considered a set key
	return Object.entries(references).filter(entry => entry[1][REFERENCE_TYPE_LINK] !== undefined).map(entry => entry[0]);
};

//cardGetInboundReferencesArray returns an array of CARD_IDs this card points to via any type of reference.
export const cardGetInboundReferencesArray = (cardObj) => {
	if (!cardObj) return [];
	const references = cardObj[REFERENCES_INBOUND_CARD_PROPERTY];
	if (!references) return [];
	return Object.keys(references);
};

//linksObj should be a object with CARD_ID: link text (or '' if no link text).
//Any previously-existing links on the card are cleared.
export const cardSetLinks = (cardObj, linksObj) => {
	//This function can assume cardObj is OK to be directly modified, but none
	//of its sub-properites may be. If its references field is going to be
	//modified, for example, we'd have to clone it first and set that on the new
	//one.
	if (!cardObj) return;
	cardCloneReferencesFromOther(cardObj, cardObj);
	let references = cardObj[REFERENCES_CARD_PROPERTY];
	for (let cardReferences of Object.values(references)) {
		if (cardReferences[REFERENCE_TYPE_LINK]) {
			delete cardReferences[REFERENCE_TYPE_LINK];
		}
	}
	for (let [cardID, cardText] of Object.entries(linksObj)) {
		if (!references[cardID]) references[cardID] = {};
		references[cardID][REFERENCE_TYPE_LINK] = cardText;
	}
	referencesCleanEmptyCards(references);
	//Sanity check
	if (!referencesLegal(references)) {
		throw new Error('References not valid');
	}
};

//Removes any empty cards from references block
const referencesCleanEmptyCards = (referencesBlock) => {
	for (let key of Object.keys(referencesBlock)) {
		if (Object.values(referencesBlock[key]).length == 0) {
			delete referencesBlock[key];
		}
	}
};

const cardCloneReferencesFromOther = (cardObj, otherCardObj) => {
	if (!cardObj || !otherCardObj) return;
	cardObj.references = cloneReferences(otherCardObj.references);
};

//cardEnsureReferences will make sure cardLikeObj has a references block. If it
//doesn't, it will clone one from otherCardObj.
export const cardEnsureReferences = (cardLikeObj, otherCardObj) => {
	if (!cardLikeObj || !otherCardObj) return;
	if (cardLikeObj.references) return;
	cardCloneReferencesFromOther(cardLikeObj, otherCardObj);
};

//referencesLegal is a sanity check that the referencesBlock looks like it's expected to.
//Copied to functions/update.js
export const referencesLegal = (referencesBlock) => {
	if (!referencesBlock) return false;
	if (typeof referencesBlock !== 'object') return false;
	if (Array.isArray(referencesBlock)) return false;
	//It's OK for it to have no keys.
	if (Object.keys(referencesBlock).length === 0) return true;
	for (let cardBlock of Object.values(referencesBlock)) {
		if (!cardBlock) return false;
		if (typeof cardBlock !== 'object') return false;
		if (Array.isArray(referencesBlock)) return false;
		//If a card block is empty is shouldn't exist
		if (Object.keys(cardBlock).length === 0) return false;
		for (let [key, value] of Object.entries(cardBlock)) {
			//The only types of keys that are allowed are the explicitly defined reference types
			if (!LEGAL_REFERENCE_TYPES[key]) return false;
			if (typeof value !== 'string') return false;
		}
	}
	return true;
};

export const cloneReferences = (referencesBlock) => {
	if (!referencesLegal(referencesBlock)) return null;
	let result = {};
	for (let [key, value] of Object.entries(referencesBlock)) {
		result[key] = {...value};
	}
	return result;
};

export const referencesDiffIsEmpty = (diff) => {
	if (!Array.isArray(diff)) return false;
	if (diff.length != 4) return false;
	return diff.every(item => Object.keys(item).length == 0);
};

//Returns a 4-tuple of [additions, modifications, leafDeletions, cardDeletions].
//Each one is a dotted property name. If a given cardDeletion is included, then
//no leafDeletions that start with that CARD_ID will be included. Additions will
//not create new card objects, it will assume the dotted accesor that implies it
//in the path will create it.
export const referencesDiff = (before, after) => {
	const result = [{}, {}, {}, {}];
	if (!referencesLegal(before)) return result;
	if (!referencesLegal(after)) return result;
	//For cards that were not in before but are in after
	let cardAdditions = {};
	//For card blocks that exist in both before and after... but might have modifications within them
	let cardSame = {};
	//For card blocks that are not in after but were in before.
	let cardDeletions = {};
	for (let cardID of Object.keys(before)) {
		if (after[cardID]) {
			cardSame[cardID] = true;
		} else {
			cardDeletions[cardID] = true;
		}
	}
	for (let cardID of Object.keys(after)) {
		if (!before[cardID]) {
			cardAdditions[cardID] = true;
		}
	}

	for (let cardID of Object.keys(cardAdditions)) {
		//All of the properties in the cardID block are additions.
		for (let [key, value] of Object.entries(after[cardID])) {
			result[0][cardID + '.' + key] = value;
		}
	}

	//NOTE: this logic can assume that if all of the keys for a card were
	//deleted, the cardID block also was, since referencesLegal validates that.

	//Now look at the cardBlocks that exist in both and compare the leaf values
	//to see what changed.
	for (let cardID of Object.keys(cardSame)) {
		let beforeCardBlock = before[cardID];
		let afterCardBlock = after[cardID];

		//Whether keys exist (even if the string value for them is different) in
		//before and after.
		let keyAdditions = {};
		let keySame = {};
		let keyDeletions = {};
		for (let key of Object.keys(beforeCardBlock)) {
			if (afterCardBlock[key] === undefined) {
				keyDeletions[key] = true;
			} else {
				keySame[key] = true;
			}
		}
		for (let key of Object.keys(afterCardBlock)) {
			if (beforeCardBlock[key] === undefined) {
				keyAdditions[key] = true;
			}
		}

		for (let key of Object.keys(keyAdditions)) {
			result[0][cardID + '.' + key] = afterCardBlock[key];
		}

		for (let key of Object.keys(keyDeletions)) {
			result[2][cardID + '.' + key] = true;
		}

		for (let key of Object.keys(keySame)) {
			if (beforeCardBlock[key] === afterCardBlock[key]) continue;
			result[1][cardID + '.' + key] = afterCardBlock[key];
		}
	}

	result[3] = cardDeletions;

	return result;
};

const cardReferenceBlockHasDifference = (before, after) => {
	for(let linkType of Object.keys(before)) {
		if (after[linkType] === undefined) return true;
		if (after[linkType] !== before[linkType]) return true;
	}
	for (let linkType of Object.keys(after)) {
		if (before[linkType] === undefined) return true;
	}
	return false;
};

//Inspired by referencesDiff from card_fields.js Returns
//[cardIDAdditionsOrModifications, cardIDDeletions]. each is a map of cardID =>
//true, and say that you should copy over the whole block.
//Duplicated in functions/update.js
export const referencesCardsDiff = (before, after) => {
	const result = [{}, {}];
	if (!referencesLegal(before)) return result;
	if (!referencesLegal(after)) return result;
	//For card blocks that exist in both before and after... but might have modifications within them
	let cardSame = {};
	for (let cardID of Object.keys(before)) {
		if (after[cardID]) {
			cardSame[cardID] = true;
		} else {
			result[1][cardID] = true;
		}
	}
	for (let cardID of Object.keys(after)) {
		if (!before[cardID]) {
			result[0][cardID] = true;
		}
	}

	//For cards that are bin both before and after, are there any things that changed?
	for (let cardID of Object.keys(cardSame)) {
		if (cardReferenceBlockHasDifference(before[cardID], after[cardID])) result[0][cardID] = true;
	}

	return result;
};

//applyReferencesDiff will generate the modifications necessary to go from
//references.before to references.after, and accumulate them IN PLACE as keys on
//update, including using deleteSentinel. update should be a cardUpdateObject,
//so the keys this sets will have references. This also sets the necessary keys
//on references_sentinels. prepended. update object is also returned as a
//convenience.
export const applyReferencesDiff = (before, after, update) => {
	if (!update) update = {};
	let [additions, modifications, leafDeletions, cardDeletions] = referencesDiff(before,after);
	for (let [key, val] of Object.entries(additions)) {
		let parts = key.split('.');
		let cardID = parts[0];
		update[REFERENCES_CARD_PROPERTY + '.' + key] = val;
		update[REFERENCES_SENTINEL_CARD_PROPERTY + '.' + cardID] = true;
	}
	for (let [key, val] of Object.entries(modifications)) {
		update[REFERENCES_CARD_PROPERTY + '.' + key] = val;
	}
	for (let key of Object.keys(leafDeletions)) {
		update[REFERENCES_CARD_PROPERTY + '.' + key] = deleteSentinel();
	}
	for (let key of Object.keys(cardDeletions)) {
		update[REFERENCES_CARD_PROPERTY + '.' + key] = deleteSentinel();
		update[REFERENCES_SENTINEL_CARD_PROPERTY + '.' + key] = deleteSentinel();
	}
	return update;
};
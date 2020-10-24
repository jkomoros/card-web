import {
	stemmer
} from './stemmer.js';

export const TEXT_FIELD_BODY = 'body';
export const TEXT_FIELD_TITLE = 'title';
export const TEXT_FIELD_SUBTITLE = 'subtitle';
export const TEXT_FIELD_LINKS_INBOUND_TEXT = 'links_inbound_text';

export const CARD_TYPE_CONTENT = 'content';
export const CARD_TYPE_SECTION_HEAD = 'section-head';
export const CARD_TYPE_WORKING_NOTES = 'working-notes';

export const VALID_CARD_TYPES = Object.fromEntries([
	CARD_TYPE_CONTENT,
	CARD_TYPE_SECTION_HEAD,
	CARD_TYPE_WORKING_NOTES
].map(key => [key, true]));

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
	[TEXT_FIELD_LINKS_INBOUND_TEXT]: {
		html: false,
		readOnly: true,
		//null signals it's legal for all card types
		legalCardTypes: null,
		derivedForCardTypes: {},
		matchWeight:0.95,
	}
};

export const DERIVED_FIELDS_FOR_CARD_TYPE = Object.fromEntries(Object.keys(VALID_CARD_TYPES).map(typ => {
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
	const splitWords = str.split('-').join(' ').split(' ');
	let result = [];
	for (let word of splitWords) {
		result.push(memorizedStemmer(word));
	}
	return result;
};

const fullyNormalizedWords = (str) => {
	let words = normalizedWords(str).join(' ');
	return stemmedNormalizedWords(words);
};

const innerTextForHTML = (body) => {
	let ele = document.createElement('section');
	//TODO: is there an XSS vulnerability here?
	ele.innerHTML = body;
	return ele.innerText;
};

//cardSetNormalizedTextProperties sets the properties that search and
//fingerprints work over. It sets them on the same card object sent.
export const cardSetNormalizedTextProperties = (card) => {
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
			const rawFieldValue = card[fieldName];
			const fieldValue = typeof rawFieldValue === 'object' ? Object.values(rawFieldValue).join(' ') : rawFieldValue;
			const content = config.html ? innerTextForHTML(fieldValue) : fieldValue;
			const normalizedWords = fullyNormalizedWords(content);
			value = normalizedWords.join(' ');
		}
		obj[fieldName] = value;
	}
	card.normalized = obj;
};
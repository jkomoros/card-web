import {
	stemmer
} from './stemmer.js';

import {
	TEXT_FIELD_CONFIGURATION,
	DERIVED_FIELDS_FOR_CARD_TYPE,
} from './card_fields.js';

export const normalizedWords = (str) => {
	if (!str) str = '';

	//Pretend like em-dashes are just spaces
	str = str.split('--').join(' ');
	str = str.split('&emdash;').join(' ');
	str = str.split('-').join(' ');

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

	const splitWords = str.split(' ');
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
		const words = str.split(' ');
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
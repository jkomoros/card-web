import {
	stemmer
} from './stemmer.js';

import {
	TEXT_FIELD_CONFIGURATION,
	DERIVED_FIELDS_FOR_CARD_TYPE,
	BODY_CARD_TYPES,
	TEXT_FIELD_REFERENCES_NON_LINK_OUTBOUND,
	TEXT_FIELD_RERERENCES_CONCEPT_OUTBOUND,
	TEXT_FIELD_STRONG_BODY_TEXT,
	REFERENCE_TYPE_LINK,
	TEXT_FIELD_BODY,
	REFERENCE_TYPE_CONCEPT,
	CARD_TYPE_CONCEPT,
	TEXT_FIELD_TITLE,
} from './card_fields.js';

import {
	references,
} from './references.js';

import {
	getDocument
} from './document.js';

import {
	normalizeLineBreaks,
} from './contenteditable.js';

import {
	extractStrongTextFromBody
} from './util.js';

export const getConceptStringFromConceptCard = (conceptCard) => {
	if (conceptCard.card_type != CARD_TYPE_CONCEPT) return '';
	return conceptCard[TEXT_FIELD_TITLE];
};

//allCardsOrConceptCards can be the map of allCards, or filtered down to just
//concept cards for speed.
export const getConceptCardForConcept = (allCardsOrConceptCards, conceptStr) => {
	for (const card of Object.values(allCardsOrConceptCards)) {
		if (card.card_type !== CARD_TYPE_CONCEPT) continue;
		if (cardMatchesString(card, TEXT_FIELD_TITLE, conceptStr)) return card;
	}
	return null;
};

//STOP_WORDS are words that are so common that we should basically skip them. We
//skip them when generating multi-word queries, and also for considering words
//for ngrams, since these words are so common that if they're considered than a
//distinctive word + a stop word will show up twice
const STOP_WORDS = {
	'a' : true,
	'an' : true,
	'the' : true,
	'in' : true,
	'is' : true,
	'and': true,
	'of': true,
	'to': true,
	'that': true,
	'you': true,
	'it': true,
	'ar': true,
	'be': true,
	'on': true,
	'can': true,
	'have': true,
	'for':true,
};

const lowercaseSplitWords = (str) => {
	return str.toLowerCase().split(/\s+/);
};

//splitSlashNonURLs will return an array of words, with either a single item, or
//n items, split on '/'. If the item looks like a URL it won't split slashes. It
//assumes text is lowercase.
const splitSlashNonURLs = (word) => {
	if (!word || !word.includes('/')) return [word];
	const distinctiveURLParts = ['http:', '.com', '.net', '.org'];
	for (let urlPart of distinctiveURLParts) {
		if (word.includes(urlPart)) return [word];
	}
	return word.split('/');
};

const normalizedWords = (str) => {
	if (!str) str = '';

	//Pretend like em-dashes are just spaces
	str = str.split('--').join(' ');
	str = str.split('&emdash;').join(' ');
	str = str.split('-').join(' ');
	str = str.split('+').join(' ');

	const splitWords = lowercaseSplitWords(str);
	let result = [];
	for (let word of splitWords) {
		for (let subWord of splitSlashNonURLs(word)) {
			subWord = subWord.replace(/^\W*/, '');
			subWord = subWord.replace(/\W*$/, '');
			if (!subWord) continue;
			result.push(subWord);
		}
	}
	return result.join(' ');
};

let memoizedStemmedWords = {};
//Inverse: the stemmed result, to a map of words and their counts with how often
//they're handed out
let reversedStemmedWords = {};
const memorizedStemmer = (word) => {
	if (!memoizedStemmedWords[word]) {
		const stemmedWord = stemmer(word);
		memoizedStemmedWords[word] = stemmedWord;
		if (!reversedStemmedWords[stemmedWord]) reversedStemmedWords[stemmedWord] = {};
		reversedStemmedWords[stemmedWord][word] = 0;
	}
	const stemmedWord = memoizedStemmedWords[word];
	reversedStemmedWords[stemmedWord][word]++;
	return stemmedWord;
};

//A more aggressive form of normalization
const stemmedNormalizedWords = (str) => {
	//Assumes the words are already run through nomralizedWords

	const splitWords = str.split(' ');
	let result = [];
	for (let word of splitWords) {
		result.push(memorizedStemmer(word));
	}
	return result.join(' ');
};

const memoizedFullyNormalizedString = {};

const fullyNormalizedString = (rawStr) => {
	if (!memoizedFullyNormalizedString[rawStr]) {
		memoizedFullyNormalizedString[rawStr] = stemmedNormalizedWords(normalizedWords(rawStr));
	}
	return memoizedFullyNormalizedString[rawStr];
};

//returns true if the card includes precisely the given str in the given field,
//with fully normalized/stemmed words. fieldName must be a field in
//TEXT_FIELD_CONFIGURATION
export const cardMatchesString = (card,fieldName, str) => {
	const normalizedString = fullyNormalizedString(str);
	if (!card) return false;
	if (!card.normalized) return false;
	if (!TEXT_FIELD_CONFIGURATION[fieldName]) return false;
	const fieldValues = card.normalized[fieldName] || [];
	for (const fieldValue of fieldValues) {
		if (fieldValue.includes(normalizedString)) return true;
	}
	return false;
};

const innerTextForHTML = (body) => {
	//This shouldn't be an XSS vulnerability even though body is supplied by
	//users and thus untrusted, because the temporary element is never actually
	//appended into the DOM
	let ele = getDocument().createElement('section');
	// makes sure line breaks are in the right place after each legal block level element
	body = normalizeLineBreaks(body);
	ele.innerHTML = body;
	//textContent would return things like style and script contents, but those shouldn't be included anyway.
	return ele.textContent;
};

//Returns a string, where if it's an array or object (or any of their subkeys
//are) they're joined by ' '. This allows it to work straightforwardly for
//normal text properties, as well as arrays, objects, or even nested objects
//that have string values at the terminus.
const extractFieldValueForIndexing = (fieldValue) => {
	if (typeof fieldValue !== 'object') return fieldValue;
	if (!fieldValue) return '';
	//Join multi ones with the split character
	return Object.values(fieldValue).map(item => extractFieldValueForIndexing(item)).filter(str => str).join('\n');
};

//Text is non-normalized raw text. Runs are distinct bits of text that are
//logically separate from one another, such that a word at the end of one run
//shouldn't be considered to be 'next to' the beginning word of the next run.
//Block-level elements, separate links, etc, all are considered new runs.
const splitRuns = (text) => {
	if (!text) return [];
	//TODO: also split for e.g. parantheses, quotes, etc
	return text.split('\n').filter(str => str);
};

//This is the set of card field extractors for any field types that have
//overrideExtractor in card_fields.js. The function should take a card. It will
//use the stashed fallbackTextMap if it exists.
const OVERRIDE_EXTRACTORS = {
	[TEXT_FIELD_REFERENCES_NON_LINK_OUTBOUND]: (card) => {
		const refsByType = references(card).withFallbackText(card.fallbackTextMap).byType;
		let result = [];
		for (const [referenceType, cardMap] of Object.entries(refsByType)) {
			//Skip links because they're already represented in body
			if (referenceType == REFERENCE_TYPE_LINK) continue;
			for (const str of Object.values(cardMap)) {
				if (str) result.push(str);
			}
		}
		return result.join('\n');
	},
	[TEXT_FIELD_STRONG_BODY_TEXT]: (card) => {
		const body = card[TEXT_FIELD_BODY];
		if (!body) return '';
		return extractStrongTextFromBody(body).join('\n');
	},
	[TEXT_FIELD_RERERENCES_CONCEPT_OUTBOUND]: (card) => {
		const conceptRefs = references(card).withFallbackText(card.fallbackTextMap).byType[REFERENCE_TYPE_CONCEPT];
		if (!conceptRefs) return '';
		let result = [];
		for (const str of Object.values(conceptRefs)) {
			if (str) result.push(str);
		}
		return result.join('\n');
	},
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
		let runs = [];
		if (!DERIVED_FIELDS_FOR_CARD_TYPE[cardType][fieldName]) {
			let fieldValue = '';
			if (config.overrideExtractor) {
				const extractor = OVERRIDE_EXTRACTORS[fieldName];
				if (!extractor) throw new Error(fieldName + ' had overrideExtractor set, but no entry in OVERRIDE_EXTRACTORS');
				fieldValue = extractor(card);
			} else {
				fieldValue = extractFieldValueForIndexing(card[fieldName]);
			}
			const content = config.html ? innerTextForHTML(fieldValue) : fieldValue;
			runs = splitRuns(content);
			//splitRuns checks for empty runs, but they could be things that will be normalized to nothing, so filter again
			runs = runs.map(str => normalizedWords(str)).filter(str => str);
		}
		obj[fieldName] = runs;
	}
	return obj;
};

//destemmedWordMap returns a map of where each given destemmed word is mapped to
//its most common stemmed variant. If a cardObj is provided, it will use the
//words from that cardObj--either a single cardObj or an array of them. If not, it will use the most common destemmed variant
//from the corpus.
const destemmedWordMap = (cardOrCards) => {
	let counts = reversedStemmedWords; 
	if (cardOrCards) {
		counts = {};
		let cards = Array.isArray(cardOrCards) ? cardOrCards : [cardOrCards];
		for (let card of cards) {
			const content = extractContentWords(card);
			for (let runs of Object.values(content)) {
				const str = runs.join(' ');
				const words = str.split(' ');
				for (let word of words) {
					const stemmedWord = memorizedStemmer(word);
					if (!counts[stemmedWord]) counts[stemmedWord] = {};
					counts[stemmedWord][word] = (counts[stemmedWord][word] || 0) + 1;
				}
			}
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



//if true, will print out debug statistics about how often card normalized count
//is happening, which can help verify that the memoization is working.s
const DEBUG_COUNT_NORMALIZED_TEXT_PROPERTIES = false;
let normalizedCount = {};

//cardWithNormalizedTextProperties sets the properties that search and
//fingerprints work over, on a copy of the card it returns. If
//optFallbackTextMap is set, the result will also have that stashed on the
//returned card obj.
export const cardWithNormalizedTextProperties = (card, optFallbackTextMap) => {
	if (!card) return card;
	if (DEBUG_COUNT_NORMALIZED_TEXT_PROPERTIES) {
		normalizedCount[card.id] = (normalizedCount[card.id] || 0) + 1;
		if(normalizedCount[card.id] > 1) console.log(card.id, card, normalizedCount[card.id]);
	}
	const result = {...card};
	if (optFallbackTextMap) result.fallbackTextMap = optFallbackTextMap;
	//Basically it takes the output of extractContentWords and then stems each run.
	result.normalized = Object.fromEntries(Object.entries(extractContentWords(result)).map(entry => [entry[0], entry[1].map(str => stemmedNormalizedWords(str))]));
	return result;
};

//text should be normalized
const ngrams = (text, size = 2) => {
	if (!text) return [];
	const pieces = text.split(' ');
	if (pieces.length < size) return [];
	const result = [];
	for (let i = 0; i < (pieces.length - size + 1); i++) {
		let subPieces = [];
		for (let j = 0; j < size; j++) {
			subPieces.push(pieces[i + j]);
		}
		result.push(subPieces.join(' '));
	}
	return result;
};

//Returns the words and filters in the text.
export const extractFiltersFromQuery = (queryTextIncludingFilters) => {
	return queryWordsAndFilters(rewriteQueryFilters(queryTextIncludingFilters));
};

export class PreparedQuery {
	//queryText should not include any filters, but be a raw string
	constructor(queryText) {
		this.text = {};
		if (!queryText) return;
		this.text = textSubQueryForWords(stemmedNormalizedWords(normalizedWords(lowercaseSplitWords(queryText).join(' '))));
	}

	cardScore(card) {
		if (!card) return [0.0, false];
		let score = 0.0;
		let fullMatch = false;
	
		for (let key of Object.keys(TEXT_FIELD_CONFIGURATION)) {
			const propertySubQuery = this.text[key];
			if(!propertySubQuery || !card.normalized[key]) continue;
			const runs = card.normalized[key];
			if (runs.length == 0) continue;
			const singleRun = runs.join(' ');
			//propertyFullMatch should be across ALL runs. Even if no one run
			//has all of the words, as long as together they all do, it's OK.
			const [, propertyFullMatch] = stringPropertyScoreForStringSubQuery(singleRun, propertySubQuery);
			if (!fullMatch && propertyFullMatch) fullMatch = true;
			let scoreAddition = runs.map(run => stringPropertyScoreForStringSubQuery(run, propertySubQuery)[0]).reduce((prev, curr) => prev + curr, 0.0);
			score += scoreAddition;
		}
	
		//Give a boost to cards that have more inbound cards, implying they're more
		//important cards.
		let inboundLinks = references(card).inboundSubstantiveArray();
		if (inboundLinks.length > 0) {
			//Tweak the score, but only by a very tiny amount. Once the 'juice' is
			//not just the count of inbound-links, but the transitive count, then
			//this can be bigger.
			score *= 1.0 + (inboundLinks.length * 0.02);
		}
	
		return [score, fullMatch];
	}
}

const SIMPLE_FILTER_REWRITES = ['is:', 'section:', 'tag:'];
const HAS_FILTER_PREFIX = 'has:';

//rewriteQueryFilters rewrites things like 'has:comments` to `filter:has-comments`
const rewriteQueryFilters = (query) => {
	let result = [];
	for (let word of query.split(' ')) {
		for (let prefix of SIMPLE_FILTER_REWRITES) {
			if (word.toLowerCase().startsWith(prefix)) {
				word = FILTER_PREFIX + word.slice(prefix.length);
			}
		}
		//Replace 'has:'. Things like 'has:comments' expand to
		//'filter:has-comments', whereas things like 'has:no-comments' expand to
		//'filter:no-comments'.
		if (word.toLowerCase().startsWith(HAS_FILTER_PREFIX)) {
			let rest = word.slice(HAS_FILTER_PREFIX.length);
			if (!rest.toLowerCase().startsWith('no-')) {
				rest = 'has-' + rest;
			}
			word = FILTER_PREFIX + rest;
		}
		result.push(word);
	}
	return result.join(' ');
};

const textSubQueryForWords = (words) => {
	return Object.fromEntries(Object.entries(TEXT_FIELD_CONFIGURATION).map(entry => [entry[0], textPropertySubQueryForWords(words, entry[1].matchWeight)]));
};

const textPropertySubQueryForWords = (joinedWords, startValue) => {
	const words = joinedWords.split(' ');

	//The format of the return value is a list of items that could match. For
	//each item, the first item is an array of strings, all of which have to
	//independently match; if they do, the second item score is added to the
	//running score for the card, and the third item is whether if it matches
	//this clause it should be considered a full match.

	//Full exact matches are the best, but if you have all of the sub-words,
	//that's good too, just less good.
	let result = [[[joinedWords], startValue, true]];

	if (words.length > 1) {
		result.push([words, startValue / 2, true]);

		//Also return partial matches, but at a much lower rate.
		for (let word of words) {
			if (STOP_WORDS[word]) continue;
			//Words that are longer should count for more (as a crude proxy for how
			//rare they are).
			result.push([[word], startValue / 8 * Math.log10(word.length), false]);
		}
	}

	let bigrams = ngrams(joinedWords);
	//if there's one bigram, then it's just equivalent to the full query
	if (bigrams.length > 1) {
		for (let bigram of bigrams) {
			//Bigrams are much better than a single word matching
			result.push([[bigram], startValue * 0.75, false]);
		}
	}

	return result;
};

const stringPropertyScoreForStringSubQuery = (propertyValue, preparedSubquery) => {
	const value = propertyValue.toLowerCase();
	let result = 0.0;
	let fullMatch = false;
	for (let item of preparedSubquery) {
		//strings is a list of strings that all must match independently
		const strings = item[0];
		if (strings.every(str => value.indexOf(str) >= 0)) {
			result += item[1];
			if (!fullMatch && item[2]) fullMatch = true;
		}
	}
	return [result, fullMatch];
};

const FILTER_PREFIX = 'filter:';

const filterForWord = (word) => {
	if (word.indexOf(FILTER_PREFIX) < 0) return '';
	return word.split(FILTER_PREFIX).join('');
};

//extracts the raw, non filter words from a query, then also the filters.
const queryWordsAndFilters = (queryString) => {
	let words = [];
	let filters = [];
	for (let word of lowercaseSplitWords(queryString)) {
		if (!word) continue;
		let filter = filterForWord(word);
		if (filter) {
			filters.push(filter);
		} else {
			words.push(word);
		}
	}
	return [words.join(' '), filters];
};

//The max number of words to include in the semantic fingerprint
const SEMANTIC_FINGERPRINT_SIZE = 35;

const SEMANTIC_FINGERPRINT_MATCH_CONSTANT = 1.0;

//Returns the 'overlap' between two semantic fingerprints (which can be fetched
//from e.g. selectCardsSemanticFingerprint). Higher nubmers are better. The
//numbers may be any number greater than 0, and only have meaning when compared
//to other numbers from this function.
const semanticOverlap = (fingerprintOne, fingerprintTwo) => {
	if (!fingerprintOne) fingerprintOne = new Map();
	if (!fingerprintTwo) fingerprintTwo = new Map();

	let union = new Set([...fingerprintOne.keys(), ...fingerprintTwo.keys()]);
	let intersection = new Map();
	for (let key of union) {
		if (fingerprintOne.has(key) && fingerprintTwo.has(key)) {
			//If they match, add the tfidf for the two terms, plus a bonus
			//constant for them having matched. This gives a big bonus for any
			//match, but gives a higher score for better matches.
			intersection.set(key, SEMANTIC_FINGERPRINT_MATCH_CONSTANT + fingerprintOne.get(key) + fingerprintTwo.get(key));
		}
	}
	const total = [...intersection.values()].reduce((p, c) => p + c, 0);
	return total;
};

//How high to go for n-grams in fingerprint. 2 = bigrams and monograms.
const MAX_N_GRAM_FOR_FINGERPRINT = 2;
//ngrams will additionally return an ngram of the full string if the number of
//terms is this or smaller.
const WHOLE_NGRAM_MAX_SIZE = 6;

const wordCountsForSemantics = (strsMap) => {
	const cardMap = {};
	for (const [fieldName, strs] of Object.entries(strsMap)) {
		const textFieldConfig = TEXT_FIELD_CONFIGURATION[fieldName] || {};
		const totalIndexingCount = (textFieldConfig.extraIndexingCount || 0) + 1;
		for (const str of strs) {
			const words = str.split(' ').filter(word => !STOP_WORDS[word]).join(' ');
			for (let n = 1; n <= MAX_N_GRAM_FOR_FINGERPRINT; n++) {
				for (const ngram of ngrams(words, n)) {
					if (!ngram) continue;
					//Each additional word in the lenght of the ngram makes them stand
					//out more as distinctive, so pretend like you see them less, in
					//proprition with how many there are.
					const baseAmount = 1/n;
					cardMap[ngram] = (cardMap[ngram] || 0) + (baseAmount * totalIndexingCount);
				}
			}
			const splitWords = words.split(' ');

			if (textFieldConfig.indexFullRun) {
				//If we're told to index the full run, then index the whole
				//thing... and count it as 1.0, not discounting for wordCount.
				cardMap[words] = (cardMap[words] || 0) + totalIndexingCount;
			} else if (splitWords.length > MAX_N_GRAM_FOR_FINGERPRINT && splitWords.length < WHOLE_NGRAM_MAX_SIZE) {
				//even if index full run wasn't true, if the run only has a few
				//words, index them as though they were valid ngrams.
				
				//if the entire text snippet is small enough to be totally counted, and
				//it wouldn't be automatically geneated (since it's larger than the
				//ngram size), include it. This means that short snippets of text, like
				//in references, will get fully indexed as an ngram.
				const baseAmount = 1/splitWords.length;
				cardMap[words] = (cardMap[words] || 0) + (baseAmount * totalIndexingCount);
			}
		}
	}
	return cardMap;
};

const semanticFingerprint = (tfidf) => {
	//Pick the keys for the items with the highest tfidf (the most important and specific to that card)
	let keys = Object.keys(tfidf).sort((a, b) => tfidf[b] - tfidf[a]).slice(0, SEMANTIC_FINGERPRINT_SIZE);
	return new Map(keys.map(key => [key, tfidf[key]]));
};

//prettyFingerprintItem returns a version of the fingerprint suitable for
//showing to a user, by de-stemming words based on the words that are most
//common in cardObj. Returns an arary of items in Title case. cardObj can be
//omitted to use word frequencies from the whole corpus.
export const prettyFingerprintItems = (fingerprint, cardObj) => {
	if (!fingerprint) return '';
	const destemmedMap = destemmedWordMap(cardObj);
	let result = [];
	//Since words might be in ngrams, and they might overlap with the same
	//words, check for duplicates
	for (let ngram of fingerprint.keys()) {
		let item = [];
		for (let word of ngram.split(' ')) {
			//There are some cases where there won't be a destemmedWord, like
			//for example backported text, since we didn't pass fallbackTextMap
			//to destemmedWordMap above.
			let destemmedWord = destemmedMap[word] || word;
			let titleCaseDestemmedWord = destemmedWord.charAt(0).toUpperCase() + destemmedWord.slice(1);
			item.push(titleCaseDestemmedWord);
		}
		result.push(item.join(' '));
	}
	return result;
};

//dedupedPrettyFingerprint returns a version of the fingerprint suitable for
//showing to a user, by de-stemming words based on the words that are most
//common in cardObj. Returns a string where any dupcliates have been removed.
//cardObj can be omitted to use word frequencies from the whole corpus.
export const dedupedPrettyFingerprint = (fingerprint, cardObj) => {
	const fingerprintItems = prettyFingerprintItems(fingerprint, cardObj);
	const seenItems = {};
	let dedupedFingerprint = [];
	//Since words might be in ngrams, and they might overlap with the same
	//words, check for duplicates
	for (let ngram of fingerprintItems) {
		for (let word of ngram.split(' ')) {
			if (seenItems[word]) continue;
			seenItems[word] = true;
			dedupedFingerprint.push(word);
		}
	}
	return dedupedFingerprint.join(' ');
};

export const emptyWordCloud = () => {
	return [[],{}];
};

//cardObj can be null, a single card, or an array of cards.
export const wordCloudFromFingerprint = (fingerprint, cardObj) => {
	if (!fingerprint || fingerprint.keys().length == 0) return emptyWordCloud();
	const displayItems = prettyFingerprintItems(fingerprint, cardObj);
	const maxAmount = Math.max(...fingerprint.values());
	const infos = Object.fromEntries([...fingerprint.entries()].map((entry,index) => {
		const amount = entry[1] / maxAmount * 100;
		return [entry[0], {title: displayItems[index], suppressLink:true, filter: 'opacity(' + amount + '%)'}];
	}));
	return [[...fingerprint.keys()], infos];
};

export class FingerprintGenerator {
	constructor(cards) {

		this._idfMap = {};
		this._fingerprints = {};

		if (!cards || Object.keys(cards).length == 0) return;

		//only consider cards that have a body, even if we were provided a set that included others
		cards = Object.fromEntries(Object.entries(cards).filter(entry => BODY_CARD_TYPES[entry[1].card_type]));

		const numCards = Object.keys(cards).length;

		//cardWords is a object that contains an object for each card id of
		//words to their count in that card. This uses all words htat could be
		//searched over, and is the input to the IDF calculation pipeline and
		//others.
		let cardWordCounts = {};
		for (const [key, cardObj] of Object.entries(cards)) {
			cardWordCounts[key] = this._wordCountsForCardObj(cardObj);
		}

		//corpusWords is a set of word => totalWordCount (how many times that
		//word occurs) for all words across all cards in corpus.
		let corpusWords = {};
		for (const words of Object.values(cardWordCounts)) {
			for (const [word, count] of Object.entries(words)) {
				corpusWords[word] = (corpusWords[word] || 0) + count;
			}
		}

		//idf (inverse document frequency) of every word in the corpus. See
		//https://en.wikipedia.org/wiki/Tf%E2%80%93idf
		const idf = {};
		let maxIDF = 0;
		for (const [word, count] of Object.entries(corpusWords)) {
			idf[word] = Math.log10(numCards / (count + 1));
			if (idf[word] > maxIDF) maxIDF = idf[word];
		}
		//This is useful often so stash it
		this._idfMap = idf;
		this._maxIDF = maxIDF;

		//A map of cardID to the semantic fingerprint for that card.
		const fingerprints = {};
		for (const [cardID, cardWordCount] of Object.entries(cardWordCounts)) {
			//See https://en.wikipedia.org/wiki/Tf%E2%80%93idf for more on
			//TF-IDF.
			const tfidf = this._cardTFIDF(cardWordCount);
			fingerprints[cardID] = semanticFingerprint(tfidf);
		}
		this._fingerprints = fingerprints;
	}

	_wordCountsForCardObj(cardObj) {
		//Filter out empty items for properties that don't have any items
		return wordCountsForSemantics(Object.fromEntries(Object.keys(TEXT_FIELD_CONFIGURATION).map(prop => [prop, cardObj.normalized[prop]]).filter(entry => entry[1])));
	}

	_cardTFIDF(cardWordCounts) {
		const resultTFIDF = {};
		const cardWordCount = Object.values(cardWordCounts).reduce((prev, curr) => prev + curr, 0);
		for (const [word, count] of Object.entries(cardWordCounts)) {
			//_idfMap should very often have all of the terms, but it can be
			//missing one if we're using fingerprintForCardObj for a live
			//editing card, and if it just had text added to it that inludes
			//uni-grams or bigrams that are so distinctive that they haven't
			//been seen before. In that case we'll use the highest IDF we've
			//seen in this corpus.
			resultTFIDF[word] = (count / cardWordCount) * (this._idfMap[word] || this._maxIDF);
		}
		return resultTFIDF;
	}

	fingerprintForCardID(cardID) {
		return this.fingerprints()[cardID];
	}

	fingerprintForCardObj(cardObj) {
		if (!cardObj || Object.keys(cardObj).length == 0) return new Map();
		const wordCounts = this._wordCountsForCardObj(cardObj);
		const tfidf = this._cardTFIDF(wordCounts);
		const fingerprint = semanticFingerprint(tfidf);
		return fingerprint;
	}

	fingerprintForCardIDList(cardIDs) {
		if (!cardIDs || !cardIDs.length) return new Map();
		let joinedMap = new Map();
		for (const cardID of cardIDs) {
			const fingerprint = this.fingerprintForCardID(cardID);
			if (!fingerprint) continue;
			for (const [word, idf] of fingerprint.entries()) {
				joinedMap.set(word, (joinedMap.get(word) || 0) + idf);
			}
		}
		const sortedKeys = [...joinedMap.keys()].sort((a, b) => joinedMap.get(b) - joinedMap.get(a)).slice(0, SEMANTIC_FINGERPRINT_SIZE);
		return new Map(sortedKeys.map(key => [key, joinedMap.get(key)]));
	}

	//returns a map of cardID => fingerprint for the cards that were provided to the constructor
	fingerprints() {
		return this._fingerprints;
	}

	//Returns a map sorted by how many other items match semantically, skipping ourselves.
	//keyID - id of item that is self, so skip matching that item. May be null if optKeyFingerprint is not null.
	//optKeyFingerprint - if not null, will use that for the key item's fingerprint instead of optFingerprintsToMatchOver[keyID]
	//optFingerprintsToMatchOver - object mapping ID to fingerprint, the collection of things to match over. If empty, will use this.fingerprints()
	closestOverlappingItems(keyID, optKeyFingerprint, optFingerprintsToMatchOver) {
		const fingerprints = optFingerprintsToMatchOver || this.fingerprints();
		const keyFingerprint = optKeyFingerprint || fingerprints[keyID];

		if (!fingerprints || !keyFingerprint) return new Map();
		const overlaps = {};
		for (const otherID of Object.keys(fingerprints)) {
			if (otherID === keyID) continue;
			overlaps[otherID] = semanticOverlap(keyFingerprint, fingerprints[otherID]);
		}
		const sortedIDs = Object.keys(overlaps).sort((a, b) => overlaps[b] - overlaps[a]);
		return new Map(sortedIDs.map(id => [id, overlaps[id]]));
	}
}

//Methods and constants that are only exported for testing and should not be
//relied on by other code
export const TESTING = {
	splitRuns,
	ngrams,
	destemmedWordMap,
};
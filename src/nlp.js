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
	REFERENCE_TYPE_ACK,
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

//allCards can be raw or normalized
export const conceptCardsFromCards = (allCards) => {
	return Object.fromEntries(Object.entries(allCards).filter(entry => entry[1].card_type == CARD_TYPE_CONCEPT));
};

export const getConceptStringFromConceptCard = (conceptCard) => {
	if (conceptCard.card_type != CARD_TYPE_CONCEPT) return '';
	return conceptCard[TEXT_FIELD_TITLE];
};

export const getConceptsFromConceptCards = (conceptCards) => {
	return Object.fromEntries(Object.values(conceptCards).map(card => [getConceptStringFromConceptCard(card), true]));
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

//OVERRIDE_STEMS are words that stem 'wrong' and we want to have a manual
//replacement instead of using the real stemmer. If the word being stemmed
//starts with the key in this map, it will be 'stemmed' to the word on the
//right.
const OVERRIDE_STEMS = {
	//optimism-family words and optimized-familyl words stem to the same thing
	//but they're very different.
	'optimiz': 'optimiz'
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
		let stemmedWord = stemmer(word);
		for (const [prefix, replacement] of Object.entries(OVERRIDE_STEMS)) {
			if (!word.startsWith(prefix)) continue;
			stemmedWord = replacement;
		}
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

const withoutStopWords = (str) => {
	return str.split(' ').filter(word => !STOP_WORDS[word]).join(' ');
};

const memoizedFullyNormalizedString = {};

const fullyNormalizedString = (rawStr) => {
	if (!memoizedFullyNormalizedString[rawStr]) {
		memoizedFullyNormalizedString[rawStr] = withoutStopWords(stemmedNormalizedWords(normalizedWords(rawStr)));
	}
	return memoizedFullyNormalizedString[rawStr];
};

//returns true if the card includes precisely the given str in the given field,
//with fully normalized/stemmed words. fieldName must be a field in
//TEXT_FIELD_CONFIGURATION
export const cardMatchesString = (card,fieldName, str) => {
	const normalizedString = fullyNormalizedString(str);
	if (!card) return false;
	if (!card.nlp) return false;
	if (!TEXT_FIELD_CONFIGURATION[fieldName]) return false;
	const fieldValues = card.nlp.withoutStopWords[fieldName] || [];
	for (const fieldValue of fieldValues) {
		if (fieldValue == normalizedString) return true;
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
//use the stashed fallbackText if it exists.
const OVERRIDE_EXTRACTORS = {
	[TEXT_FIELD_REFERENCES_NON_LINK_OUTBOUND]: (card) => {
		const refsByType = references(card).withFallbackText(card.fallbackText).byType;
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
		const conceptRefs = references(card).withFallbackText(card.fallbackText).byType[REFERENCE_TYPE_CONCEPT];
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
			if (!fieldValue) fieldValue = '';
			const content = config.html ? innerTextForHTML(fieldValue) : fieldValue;
			runs = splitRuns(content);
			//splitRuns checks for empty runs, but they could be things that will be normalized to nothing, so filter again
			runs = runs.map(str => normalizedWords(str)).filter(str => str);
		}
		obj[fieldName] = runs;
	}
	return obj;
};

let memoizedNormalizedNgramMaps = new Map();

const normalizeNgramMap = (ngramMap) => {
	if (!memoizedNormalizedNgramMaps.has(ngramMap)) {
		//The normalizedMap both has stemmed/normalized words. We filter out
		//stop words (via fullyNormalizedString) because the
		//wordCountsForSemantics will be comparing it to strings with stop words
		//removed, too.
		const normalizedMap = Object.fromEntries(Object.entries(ngramMap).map(entry => [fullyNormalizedString(entry[0]), entry[1]]));
		memoizedNormalizedNgramMaps.set(ngramMap, normalizedMap);
	}
	return memoizedNormalizedNgramMaps.get(ngramMap);
};

//if true, will print out debug statistics about how often card normalized count
//is happening, which can help verify that the memoization is working.s
const DEBUG_COUNT_NORMALIZED_TEXT_PROPERTIES = false;
let normalizedCount = {};

//cardWithNormalizedTextProperties sets the properties that search and
//fingerprints work over, on a copy of the card it returns. fallbackText will be
//stashed on the the result so that override field extractors can access it.
//importantNgrams should be a map of strings to true, specifying strings that,
//if their normalized/stemmed text overlaps with the ngrams on a card--no matter
//the length--that ngram should be indexed at a non-length discounted match
//rate.
//
// The objects set on the resulting card will be:
// * card.fallbackText = the fallbackText map passed, without modification
// * card.importantNgrams = normalized importantNgrams
// * card.nlp = object with: 
//
//  (for each property below, a map of TEXT_FIELD_NAME -> arrays of strings.
//   each property will have precisely the same TEXT_FIELD_NAMES, and precisely
//   the same number of strings. Each phase in the list below builds on each
//   other, adding an extra processing step.)
//
//      normalized: the extracted text runs for that field, with all words normalized. Note that some logical runs from the original text field may already have been filtered by this step. punctuation between words will be removed, everything will be lower case.
//		stemmed: the normalized values, but also each word will have been stemmed. Each word will still line up with each word in normalized (stemming never removes words)
//		withoutStopWords: the stemmed values, but also with stop words removed. The number of words in this field set will likely be smaller than the two above.
export const cardWithNormalizedTextProperties = (card, fallbackText, importantNgrams) => {
	if (!card) return card;
	if (DEBUG_COUNT_NORMALIZED_TEXT_PROPERTIES) {
		normalizedCount[card.id] = (normalizedCount[card.id] || 0) + 1;
		if(normalizedCount[card.id] > 1) console.log(card.id, card, normalizedCount[card.id]);
	}
	const result = {...card};
	if (fallbackText) result.fallbackText = fallbackText;
	if (importantNgrams) result.importantNgrams = normalizeNgramMap(importantNgrams);
	//Basically it takes the output of extractContentWords and then stems each run.
	const normalizedFields = extractContentWords(result);
	const stemmedFields = Object.fromEntries(Object.entries(normalizedFields).map(entry => [entry[0], entry[1].map(str => stemmedNormalizedWords(str))]));
	const withoutStopWordsFields = Object.fromEntries(Object.entries(stemmedFields).map(entry => [entry[0], entry[1].map(str => withoutStopWords(str))]));
	result.nlp = {
		normalized: normalizedFields,
		stemmed: stemmedFields,
		withoutStopWords: withoutStopWordsFields,
	};
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
			if(!propertySubQuery || !card.nlp || !card.nlp.stemmed || !card.nlp.stemmed[key]) continue;
			const runs = card.nlp.stemmed[key];
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

const ngramWithinOther =(ngram, container) => {
	return wordBoundaryRegExp(ngram).test(container);
};

const memoizedWordBoundaryRegExp = {};

//from https://stackoverflow.com/a/3561711
const escapeRegex = (string) => {
	// eslint-disable-next-line no-useless-escape
	return string.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
};

const wordBoundaryRegExp = (ngram) => {
	if (!memoizedWordBoundaryRegExp[ngram]) {
		//we have to escape any special characters in the ngram so they aren't
		//interpreted as regex control characters. Those characters are rare,
		//but can happen if they're inside a word.
		memoizedWordBoundaryRegExp[ngram] = new RegExp('(^| )' + escapeRegex(ngram) + '( |$)');
	}
	return memoizedWordBoundaryRegExp[ngram];
};

//How high to go for n-grams in fingerprint by default. 2 = bigrams and monograms.
const MAX_N_GRAM_FOR_FINGERPRINT = 2;
//ngrams will additionally return an ngram of the full string if the number of
//terms is this or smaller.
const WHOLE_NGRAM_MAX_SIZE = 6;

//strsMap is card.nlp.withoutStopWords. See cardWithNormalizedTextProperties documentation for more.
const wordCountsForSemantics = (strsMap, cardObj, maxFingerprintSize) => {
	//Yes, it's weird that we stash the additionalNgramsMap on a cardObj and
	//then pass that around instead of just passing the ngram map to FingerPrint
	//generator. But it we did it another way, it would break the `similar/`
	//configurable filter.
	const cardMap = {};
	const importantNgrams = cardObj.importantNgrams || {};
	for (const [fieldName, strs] of Object.entries(strsMap)) {
		const textFieldConfig = TEXT_FIELD_CONFIGURATION[fieldName] || {};
		const totalIndexingCount = (textFieldConfig.extraIndexingCount || 0) + 1;
		for (const words of strs) {
			for (let n = 1; n <= maxFingerprintSize; n++) {
				for (const ngram of ngrams(words, n)) {
					if (!ngram) continue;
					//If we'll count it full later, don't count it now.
					if (importantNgrams[ngram]) continue;
					//Each additional word in the lenght of the ngram makes them stand
					//out more as distinctive, so pretend like you see them less, in
					//proprition with how many there are.
					const baseAmount = 1/n;
					cardMap[ngram] = (cardMap[ngram] || 0) + (baseAmount * totalIndexingCount);
				}
			}

			//Don't count the full words if we'll count them later.
			if (!importantNgrams[words]) {
				const splitWords = words.split(' ');
				if (textFieldConfig.indexFullRun) {
					//If we're told to index the full run, then index the whole
					//thing... and count it as 1.0, not discounting for wordCount.
					cardMap[words] = (cardMap[words] || 0) + totalIndexingCount;
				} else if (splitWords.length > maxFingerprintSize && splitWords.length < WHOLE_NGRAM_MAX_SIZE) {
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

			//Count any of the importantNgrams that are present, and count
			//them without discounting for length. We skipped counting them in
			//any of the 'typical' times above.
			for (let ngram of Object.keys(importantNgrams)) {
				//Only match on word boundaries, not within an ngram
				if (ngramWithinOther(ngram, words)) {
					//This is an ngram we wouldn't necessarily have indexed by
					//default (it might have been too long to be automatically
					//extracted, for example), but we've been told it's
					//important when we see it, so take note of it, at full
					//value.
					cardMap[ngram] = (cardMap[ngram] || 0) + totalIndexingCount;
				}
			}
		}
	}
	return cardMap;
};

const semanticFingerprint = (tfidf, fingerprintSize) => {
	//Pick the keys for the items with the highest tfidf (the most important and specific to that card)
	let keys = Object.keys(tfidf).sort((a, b) => tfidf[b] - tfidf[a]).slice(0, fingerprintSize);
	return new Map(keys.map(key => [key, tfidf[key]]));
};

//targetNgram is the targted, withoutStopWords ngram to look for. *Run
//properties are the same run, indexed out of nlp.normalized, nlp.stemmed, and
//nlp.withoutStopWords, respectively. The result will be a substring out of
//normalizedRun corresponding to targetNgram. This will return '' if the
//targetNgram doesn't exist as a word-boundary subset of withoutStopWordsRun.
const extractOriginalNgramFromRun = (targetNgram, normalizedRun, stemmedRun, withoutStopWordsRun) => {
	if (!ngramWithinOther(targetNgram, withoutStopWordsRun)) return '';
	//We know that targetNgram is within withoutStopWordsRun. Now, look for its
	//word index (start and length) within stemmedRun.
	let stemmedRunWords = stemmedRun.split(' ');
	let targetNgramWords = targetNgram.split(' ');

	//which piece of the targetNgramPieces we're looking to match now
	let targetNgramIndex = 0;
	//Which piece the match starts on. Less than 0 if not currently matching.
	let startWordIndex = -1;
	//How many pieces we've matched in stemmedRunPieces. Note that this increments for stop words, too.
	let wordCount = 0;

	let i = 0;
	while (i < stemmedRunWords.length) {
		const word = stemmedRunWords[i];
		//Increment i now to make sure we don't forget, which would get us in an infinite loop
		i++;
		if (STOP_WORDS[[word]]) {
			//If we're not currently matching, just ignore it
			if (startWordIndex < 0) continue;
			//If we're currently matching, include this in the match and contineu to next word
			wordCount++;
			continue;
		}
		//Is the next piece a match for the next word of targetNgram we were looking to match?
		if (word == targetNgramWords[targetNgramIndex]) {
			//Found a match!

			//If it's the first word in the targetNgram, keep track of where it
			//started.
			//Note that i is already incremented so we have to decrement it
			if (targetNgramIndex == 0) startWordIndex = i - 1;
			targetNgramIndex++;
			wordCount++;
			//Was that the last piece we needed?
			if (targetNgramIndex >= targetNgramWords.length) break;
			continue;
		}
		
		//If we get to here it wasn't a stop word and it wasn't a match.

		//If we were in a match but just fell out of it, DON'T advance to the
		//next word; this current word might have started a match!
		if (startWordIndex >= 0) i--;
		startWordIndex = -1;
		targetNgramIndex = 0;
		wordCount = 0;
	}

	//Did we get a full match? If we didn't, something's wrong somewhere.
	if (targetNgramIndex < targetNgramWords.length) {
		console.warn('Whoops we should have matched it, something went wrong');
		return '';
	}

	//If we get to here, we have a startWordIndex and wordCount that index into normalizedRun.
	return normalizedRun.split(' ').slice(startWordIndex, startWordIndex + wordCount).join(' ');

};

//The fingerprint must have been generated for the given cardOrCards, so that we
//know there are ngrams to recover, otherwise you might see weird stemmed words.
export const prettyFingerprintItems = (fingerprint, cardOrCards) => {
	const result = [];
	const cardArray = Array.isArray(cardOrCards) ? cardOrCards : [cardOrCards];
	for (const ngram of fingerprint.keys()) {
		const originalNgrams = {};
		for (const card of cardArray) {
			for (const [fieldName, runs] of Object.entries(card.nlp.normalized)) {
				for (let i = 0; i < runs.length; i++) {
					const normalizedRun = runs[i];
					const stemmedRun = card.nlp.stemmed[fieldName][i];
					const withoutStopWordsRun = card.nlp.withoutStopWords[fieldName][i];
					const originalNgram = extractOriginalNgramFromRun(ngram, normalizedRun,stemmedRun,withoutStopWordsRun);
					if (originalNgram) {
						originalNgrams[originalNgram] = (originalNgrams[originalNgrams] || 0) + 1;
					}
				}
			}
		}
		let maxCount = 0;
		//defaul to the passed ngram if we have nothing else
		let maxOriginalNgram = '';
		for (const [originalNgram, count] of Object.entries(originalNgrams)) {
			if (count < maxCount) continue;
			maxCount = count;
			maxOriginalNgram = originalNgram;
		}
		//If there were no original ngrams, then cardOrCards was likely
		//diffferent than what was used for fingerprint.
		if (!maxOriginalNgram) {
			maxOriginalNgram = ngram.split(' ').map(word => reversedStemmedWords[word]).join(' ');
		}

		const titleCaseOriginalNgram = maxOriginalNgram.split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
		result.push(titleCaseOriginalNgram);
	}
	return result;
};

//dedupedPrettyFingerprint returns a version of the fingerprint suitable for
//showing to a user, by de-stemming words based on the words that are most
//common in cardObj. Returns a string where any dupcliates have been removed.
export const dedupedPrettyFingerprint = (fingerprint, cardObj) => {
	const fingerprintItems = prettyFingerprintItems(fingerprint, cardObj);
	const seenItems = {};
	let dedupedFingerprint = [];
	//Since words might be in ngrams, and they might overlap with the same
	//words, check for duplicates
	for (let ngram of fingerprintItems) {
		for (let word of ngram.split(' ')) {
			if (seenItems[word]) continue;
			if (STOP_WORDS[word.toLowerCase()]) continue;
			seenItems[word] = true;
			dedupedFingerprint.push(word);
		}
	}
	return dedupedFingerprint.join(' ');
};

const MAX_MISSING_POSSIBLE_CONCEPTS = 100;

//Enable while debugging possibleMissingConcepts.
const DEBUG_PRINT_MISSING_CONCEPTS_INFO = false;

export const possibleMissingConcepts = (cards) => {
	//Turn the size of ngrams we generate up to 11! This will help us find very long ngrams, but will use a LOT of memory and compuation.
	const maximumFingerprintGenerator = new FingerprintGenerator(cards, SEMANTIC_FINGERPRINT_SIZE * 5, MAX_N_GRAM_FOR_FINGERPRINT + 5);
	let cardIDsForNgram = {};
	let cumulativeTFIDFForNgram = {};

	for (const [cardID, fingerprint] of Object.entries(maximumFingerprintGenerator.fingerprints())) {
		for (const [ngram, tfidf] of fingerprint.entries()) {
			cardIDsForNgram[ngram] = [...(cardIDsForNgram[ngram] || []), cardID];
			cumulativeTFIDFForNgram[ngram] = (cumulativeTFIDFForNgram[ngram] || 0) + tfidf;
		}
	}

	//Filter out any ngrams that didn't show up in at least 3 cards
	cardIDsForNgram = Object.fromEntries(Object.entries(cardIDsForNgram).filter(entry => entry[1].length > 3));
	cumulativeTFIDFForNgram = Object.fromEntries(Object.keys(cardIDsForNgram).map(key => [key, cumulativeTFIDFForNgram[key]]));

	let ngramWordCount = {};
	for (const ngram of Object.keys(cardIDsForNgram)) {
		ngramWordCount[ngram] = ngram.split(' ').length;
	}

	//Resort ngramWordCount by ascending number of words
	const ngramWordCountSortedKeys = Object.keys(ngramWordCount).sort((a, b) => ngramWordCount[a] - ngramWordCount[b]);

	/*
		each ngramBundle has:
		* ngram: the ngram at the root of this bundle
		* individualTFIDF: the tfidf of the ngram at the root of this bundle
		* cumulativeTFIDF: the cumulativeTFIDF of the root ngram PLUS all
		  sub-bundles
		* subNgrams: an array of ngrams. Each one must be a strict subset of the
		  bundles ngram, and also a valid key into ngramBundles. No subNgram may
		  be a strict subset of any other subNgram in the set. (This property
		  guarantees that even though subNgrams aren't all of the same
		  ngram-size, we always use the largest ones that cover it)
		//TODO: document the rest of the bundle meanings
	*/
	const ngramBundles = {};

	// We construct the ngramBundles in order going up by ngram word count, so
	// the subBundles are already constructed and finalized by the time the
	// larger bundles are being constructed.

	for (const ngram of ngramWordCountSortedKeys) {
		const individualTFIDF = cumulativeTFIDFForNgram[ngram];

		const cardIDs = cardIDsForNgram[ngram];
		const cardsExpanded = cardIDs.map(id => cards[id]);
		const cardCount = cardIDs.length;

		//The only keys already in ngramBundles will be either the same size as
		//our ngram, or smaller.
		const subNgramCandidates = Object.keys(ngramBundles).filter(candidateNgram => ngramWithinOther(candidateNgram, ngram)).sort((a, b) => b.length - a.length);

		//Now we have all candidates that might plausibly be in our subNgram
		//set, in descending order of size. We need to pick the 'spanning' set,
		//where no subNgram in the final set may be a strict subset of any other
		//subNgram in the set.

		const subNgrams = [];
		for (const candidate of subNgramCandidates) {
			if (subNgrams.some(includedNgram => ngramWithinOther(candidate, includedNgram))) continue;
			subNgrams.push(candidate);
		}

		const cumulativeSubNgramCumulativeTFIDF = subNgrams.map(subNgram => ngramBundles[subNgram].cumulativeTFIDF).reduce((sum, x) => sum + x, 0);

		//TODO: what if we discount the cumulative tfidf based on number of individual words total in all of hte subngrams?

		const averageSubNgramCumulativeTFIDF = subNgrams.length ? (cumulativeSubNgramCumulativeTFIDF / subNgrams.length) : 0;
		const subNgramTFIDFForCumulative = averageSubNgramCumulativeTFIDF;
		const cumulativeTFIDF =  individualTFIDF + subNgramTFIDFForCumulative;
		const individualToCumulativeRatio = individualTFIDF / cumulativeTFIDF;
		//TODO: 'mind growth` shows up high because `mind` and `growth` are both
		//popular words, but `mind growth` is really not. Ideally we'd punish terms
		//that are very uncommon on their own but just have popular children.

		//sort the ngram into a canonical order so any permuation can be detected
		const sortedNgram = ngram.split(' ').sort().join(' ');

		//Reward ngrams that are not leafs that are popular themselves, instead
		//of just freeloading off of being a rare combination of individually
		//popular words. And so that leaf ngrams can still show up, give them a
		//tuned boost.
		const scoreForBundle = cumulativeTFIDF + (subNgrams.length > 0 ? individualToCumulativeRatio : individualTFIDF / 5);

		//TODO: remove the properties that are unnecessary
		ngramBundles[ngram] = {
			ngram,
			scoreForBundle,
			individualTFIDF,
			averageSubNgramCumulativeTFIDF,
			subNgramTFIDFForCumulative,
			cumulativeSubNgramCumulativeTFIDF,
			individualToCumulativeRatio,
			cumulativeTFIDF,
			cardIDs,
			cardsExpanded,
			cardCount,
			sortedNgram,
			subNgrams,
			//TODO: this is very expensive to include
			subNgramsObject: Object.fromEntries(subNgrams.map(ngram => [ngram, ngramBundles[ngram]]))
		};
	}

	const sortedNgramBundleKeys = Object.keys(ngramBundles).sort((a, b) => ngramBundles[b].scoreForBundle - ngramBundles[a].scoreForBundle);
	
	//TODO: don't retain this debug informatio (maybe behind a debug flag?)
	const knockedOutNgrams = [];

	//Sometimes an ngram that is being considered is a superset of one that's
	//already been included. We can keep those... as long as the extra words it
	//adds don't bring much diff individually. (Scorediff is a DECLINE in score)
	const DIFF_PER_EXTRA_WORD_CUTOFF = 0.5;

	const finalNgrams = [];
	for (const ngram of sortedNgramBundleKeys) {
		let knockedOut = null;
		//Skip ngrams that are full supersets or subsets of ones that have already been selected, or ones that are just permutations of an ngram that was already selected
		for (const includedNgram of finalNgrams) {
			if (ngramWithinOther(ngram, includedNgram)) {
				//TODO: Consider doing the diffPerExtraWord cutoff here, too, like in superset?
				knockedOut = {
					self: ngram,
					other: includedNgram,
					reason: 'subset',
				};
				break;
			}
			if (ngramWithinOther(includedNgram, ngram)) {

				//We are a superset of one that's already included. But those
				//extra words might add a lot of meaning.
				const extraWordCount = ngram.split(' ').length - includedNgram.split(' ').length;
				//The includedNgram bundle score must be larger because it was already included.
				const scoreDiff = ngramBundles[includedNgram].scoreForBundle - ngramBundles[ngram].scoreForBundle;
				const diffPerExtraWord = scoreDiff / extraWordCount;

				const knockOutObj = {
					self: ngram,
					other: includedNgram,
					reason: 'superset',
					//TODO: don't include this extra debug info
					scoreDiff,
					diffPerExtraWord,
				};

				if (diffPerExtraWord > DIFF_PER_EXTRA_WORD_CUTOFF) {
					knockedOut = knockOutObj;
					break;
				} else {
					if (DEBUG_PRINT_MISSING_CONCEPTS_INFO) console.log('Was going to knock out a word but decided not to', knockOutObj);
				}
			}
			if (ngramBundles[ngram].sortedNgram == ngramBundles[includedNgram].sortedNgram) {
				knockedOut = {
					self: ngram,
					other: includedNgram,
					reason: 'permutation',
				};
				break;
			}
		}

		if (knockedOut) {
			knockedOut.otherBundle = ngramBundles[knockedOut.other];
			knockedOut.selfBundle = ngramBundles[knockedOut.self];
			knockedOutNgrams.push(knockedOut);
			continue;
		}
		finalNgrams.push(ngram);
		if (finalNgrams.length >= MAX_MISSING_POSSIBLE_CONCEPTS) break;
	}

	if (DEBUG_PRINT_MISSING_CONCEPTS_INFO) {
		console.log('Knocked out', knockedOutNgrams);
		console.log(finalNgrams.map(ngram => ngramBundles[ngram]));
	}

	//TODO: factor out ngrams that already exist as cards (and maybe earlier in the pipeline, to get sub and superset conflicts?)

	//TODO: what's the system to say 'nah I don't want X to be a concept'?

	return new Map(finalNgrams.map(ngram => [ngram, ngramBundles[ngram].scoreForBundle]));

};

export const suggestedConceptReferencesForCard = (card, fingerprint, allCardsOrConceptCards, concepts) => {
	const result = [];
	if (!card || !fingerprint) return [];
	if (!BODY_CARD_TYPES[card.card_type]) return [];
	const itemsFromConceptReferences = fingerprintItemsFromConceptReferences(fingerprint, card);
	const ackReferences = references(card).byType[REFERENCE_TYPE_ACK] || {};
	const normalizedConcepts = normalizeNgramMap(concepts);
	for (let fingerprintItem of fingerprint.keys()) {
		//Skip items we already point to
		if (itemsFromConceptReferences[fingerprintItem]) continue;
		if (!normalizedConcepts[fingerprintItem]) continue;
		//OK, we think there's a card that matches this fingerprint item.
		const conceptCard = getConceptCardForConcept(allCardsOrConceptCards, fingerprintItem);
		//false alarm
		if (!conceptCard) continue;
		//Don't suggest that concept cards reference themselves
		if (conceptCard.id == card.id) continue;
		//Having an ACK reference to the other card is how you say that you opt
		//out of a suggested concept card.
		if (ackReferences[conceptCard.id] !== undefined) continue;
		result.push(conceptCard.id);
	}
	return result;
};

//returns a map of fingerprintItem -> true for the fingerprint items that
//overlap with the text in concept references for the given card obj. That is,
//they don't just _happen_ to overlap with a concept, they come (at least
//partially) from that explicit reference.
const fingerprintItemsFromConceptReferences = (fingerprint, cardObj) => {
	if (!cardObj) return {};
	//sometimes cardObj is an array of cardObjs
	let objs = Array.isArray(cardObj) ? cardObj : [cardObj];
	let result = {};
	for (let obj of objs) {
		let strs = obj.nlp.withoutStopWords[TEXT_FIELD_RERERENCES_CONCEPT_OUTBOUND];
		for (let str of strs) {
			//The fingerprint will have STOP_WORDs filtered, since it's
			//downstream of wordCountsForSemantics, so do the same to check for
			//a match.
			if (fingerprint.has(str)) {
				result[str] = true;
			}
		}
	}
	return result;
};

export const emptyWordCloud = () => {
	return [[],{}];
};

//cardObj can be a single card, or an array of cards.
export const wordCloudFromFingerprint = (fingerprint, cardObj) => {
	if (!fingerprint || fingerprint.keys().length == 0) return emptyWordCloud();
	const displayItems = prettyFingerprintItems(fingerprint, cardObj);
	const maxAmount = Math.max(...fingerprint.values());
	const conceptItems = fingerprintItemsFromConceptReferences(fingerprint, cardObj);
	const infos = Object.fromEntries([...fingerprint.entries()].map((entry,index) => {
		const amount = entry[1] / maxAmount * 100;
		const info = {title: displayItems[index],suppressLink:true, filter: 'opacity(' + amount + '%)'};
		if (conceptItems[entry[0]]) info.color = 'var(--app-secondary-color)';
		return [entry[0], info];
	}));
	return [[...fingerprint.keys()], infos];
};

export class FingerprintGenerator {
	constructor(cards, optFingerprintSize = SEMANTIC_FINGERPRINT_SIZE, optNgramSize = MAX_N_GRAM_FOR_FINGERPRINT) {

		this._idfMap = {};
		this._fingerprints = {};
		this._fingerprintSize = optFingerprintSize;
		this._ngramSize = optNgramSize;

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
			fingerprints[cardID] = semanticFingerprint(tfidf, this._fingerprintSize);
		}
		this._fingerprints = fingerprints;
	}

	_wordCountsForCardObj(cardObj) {
		//Filter out empty items for properties that don't have any items
		return wordCountsForSemantics(Object.fromEntries(Object.keys(TEXT_FIELD_CONFIGURATION).map(prop => [prop, cardObj.nlp.withoutStopWords[prop]]).filter(entry => entry[1])), cardObj, this._ngramSize);
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
		const fingerprint = semanticFingerprint(tfidf, this._fingerprintSize);
		return fingerprint;
	}

	fingerprintForCardIDList(cardIDs) {
		if (!cardIDs || !cardIDs.length) return new Map();
		let combinedTFIDF = {};
		for (const cardID of cardIDs) {
			const fingerprint = this.fingerprintForCardID(cardID);
			if (!fingerprint) continue;
			for (const [word, idf] of fingerprint.entries()) {
				combinedTFIDF[word] = (combinedTFIDF[word] || 0) + idf;
			}
		}
		return semanticFingerprint(combinedTFIDF, this._fingerprintSize);
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
	extractOriginalNgramFromRun,
	fullyNormalizedString,
	normalizedWords,
	stemmedNormalizedWords,
	withoutStopWords,
};
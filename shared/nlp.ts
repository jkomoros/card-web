import { stemmer } from './stemmer.js';
import {
	TEXT_FIELD_CONFIGURATION,
	BODY_CARD_TYPES,
	DERIVED_FIELDS_FOR_CARD_TYPE,
	CARD_TYPE_CONFIGURATION
} from './card_fields.js';
import { TypedObject } from './typed_object.js';
import { innerTextForHTML } from './util.js';
import type {
	Card,
	ProcessedCard,
	CardFieldType,
	CardID
} from './types.js';

type WordNumbers = { [word: string]: number };
export type IDFMap = {
	idf: WordNumbers;
	maxIDF: number;
};

export type ProcessedCards = {
	[id: CardID]: ProcessedCard
};

interface ProcessedRunInterface {
	normalized : string,
	original : string,
	stemmed : string,
	withoutStopWords : string,
	uppercaseRanges? : number[],
	readonly empty : boolean
}

type NLPInfo = {
	[field in CardFieldType]: ProcessedRunInterface[]
};

//STOP_WORDS are words that are so common that we should basically skip them. We
//skip them when generating multi-word queries, and also for considering words
//for ngrams, since these words are so common that if they're considered than a
//distinctive word + a stop word will show up twice. This stop word list is a
//lightly processed version of NLTK's english stop word list, from
//https://gist.github.com/sebleier/554280, filtered to cut off things from
//"once" and downward, and also prononuns like `I`, 'my', 'mine', `myself` and
//the 2nd and 3rd person variations.
export const STOP_WORDS : {[word : string] : boolean} = {
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
	'which': true,
	'who': true,
	'whom': true,
	'thi': true,
	'these': true,
	'those': true,
	'am': true,
	'wa': true,
	'were': true,
	'been': true,
	'ha': true,
	'had': true,
	'do': true,
	'doe': true,
	'did': true,
	'but': true,
	'if': true,
	'or': true,
	'becaus': true,
	'as': true,
	'until': true,
	'while': true,
	'at': true,
	'by': true,
	'with': true,
	'about': true,
	'against': true,
	'between': true,
	'into': true,
	'through': true,
	'dure': true,
	'befor': true,
	'after': true,
	'abov': true,
	'below': true,
	'from': true,
	'up': true,
	'down': true,
	'out': true,
	'off': true,
	'over': true,
	'under': true,
	'again': true,
	'further': true,
	'then': true,
};

//OVERRIDE_STEMS are words that stem 'wrong' and we want to have a manual
//replacement instead of using the real stemmer. If the word being stemmed
//starts with the key in this map, it will be 'stemmed' to the word on the
//right.
export const OVERRIDE_STEMS : {[prefix : string] : string} = {
	//optimism-family words and optimized-familyl words stem to the same thing
	//but they're very different.
	'optimiz': 'optimiz',
	//generally and generative stem to the same thing otherwise
	'generativ': 'generativ',
	//Organization and organied stem to the same word otherwise
	'organiza': 'organiza',
	//Organic and organized stem to the same word
	'organic': 'organic',
	//Polarized and polarity stem to the same thing otherwise
	'polarit': 'polarit',
	//Useful and use all reduce down to 'us'
	'usef': 'usef',
	//communicate and community reduce to the same stem otherwise
	'communit': 'communit',
	//later and lateral reduce to the same
	'lateral': 'lateral'
};

//How high to go for n-grams in fingerprint by default. 2 = bigrams and monograms.
export const MAX_N_GRAM_FOR_FINGERPRINT = 2;
//how much more important to consider an important ngram. 1.0 is no boost, 2.0
//would be double the size.
const IMPORTANT_NGRAM_BOOST_FACTOR = 1.1;
//ngrams will additionally return an ngram of the full string if the number of
//terms is this or smaller.
const WHOLE_NGRAM_MAX_SIZE = 6;

//If originalCase is not true, then lowercases everything.
const lowercaseSplitWords = (str : string, originalCase = false) : string[] => {
	if (!originalCase) str = str.toLowerCase();
	return str.split(/\s+/);
};

const wordIsUrl = (word : string) : boolean => {
	if (!word || !word.includes('/')) return false;
	const distinctiveURLParts = ['http:', 'https:', '.com', '.net', '.org'];
	for (const urlPart of distinctiveURLParts) {
		if (word.includes(urlPart)) return true;
	}
	return false;
};

//splitSlashNonURLs will return an array of words, with either a single item, or
//n items, split on '/'. If the item looks like a URL it won't split slashes. It
//assumes text is lowercase.
const splitSlashNonURLs = (word : string) : string[]  => {
	if (!word || !word.includes('/')) return [word];
	return wordIsUrl(word) ? [word] : word.split('/');
};

export const normalizedWords = (str : string, originalCase = false) : string => {
	if (!str) str = '';

	const splitWords = lowercaseSplitWords(str, originalCase);
	const result = [];
	for (const word of splitWords) {
		for (let subWord of splitSlashNonURLs(word)) {
			//Leave URLS totally in place.
			if (wordIsUrl(subWord)) {
				result.push(subWord);
				continue;
			}
			subWord = subWord.replace(/^\W*/, '');
			subWord = subWord.replace(/\W*$/, '');
			//Pretend like em-dashes are just spaces
			subWord = subWord.split('--').join(' ');
			subWord = subWord.split('&emdash;').join(' ');
			subWord = subWord.split('-').join(' ');
			subWord = subWord.split('+').join(' ');
			if (!subWord) continue;
			result.push(subWord);
		}
	}
	return result.join(' ');
};

// Simple Map-based cache for stemming
const memoizedStemmedWords = new Map<string, string>();

const stemWord = (word : string) : string => {
	if (!memoizedStemmedWords.has(word)) {
		let stemmedWord = stemmer(word);
		for (const [prefix, replacement] of Object.entries(OVERRIDE_STEMS)) {
			if (!word.startsWith(prefix)) continue;
			stemmedWord = replacement;
		}
		memoizedStemmedWords.set(word, stemmedWord);
	}
	return memoizedStemmedWords.get(word)!;
};

//A more aggressive form of normalization
export const stemmedNormalizedWords = (str : string) : string => {
	//Assumes the words are already run through nomralizedWords

	const splitWords = str.split(' ');
	const result = [];
	for (const word of splitWords) {
		result.push(stemWord(word));
	}
	return result.join(' ');
};

export const withoutStopWords = (str : string) : string => {
	return str.split(' ').filter(word => !STOP_WORDS[word]).join(' ');
};

//Returns a string, where if it's an array or object (or any of their subkeys
//are) they're joined by ' '. This allows it to work straightforwardly for
//normal text properties, as well as arrays, objects, or even nested objects
//that have string values at the terminus.
const extractFieldValueForIndexing = (fieldValue : string | object) : string => {
	if (typeof fieldValue !== 'object') return fieldValue;
	if (!fieldValue) return '';
	//Join multi ones with the split character
	return Object.values(fieldValue).map(item => extractFieldValueForIndexing(item)).filter(str => str).join('\n');
};

//Text is non-normalized raw text. Runs are distinct bits of text that are
//logically separate from one another, such that a word at the end of one run
//shouldn't be considered to be 'next to' the beginning word of the next run.
//Block-level elements, separate links, etc, all are considered new runs.
const splitRuns = (text : string) : string[] => {
	if (!text) return [];
	//TODO: also split for e.g. parantheses, quotes, etc
	return text.split('\n').filter(str => str);
};

const extractRawContentRunsForCardField = (card : Card, fieldName : CardFieldType) : string[] => {
	const cardType = card.card_type;
	const config = TEXT_FIELD_CONFIGURATION[fieldName];
	if (config.skipIndexing) return [];
	if ((DERIVED_FIELDS_FOR_CARD_TYPE[cardType] || {})[fieldName]) return [];

	let fieldValue = '';
	// For server-side, we skip override extractors (which depend on references.ts)
	if (config.overrideExtractor) {
		// Skip these fields on the server
		return [];
	} else {
		//eslint-disable-next-line @typescript-eslint/no-explicit-any
		fieldValue = extractFieldValueForIndexing((card as any)[fieldName] || '');
	}
	if (!fieldValue) fieldValue = '';
	//If the text is the defaultBody for that card type, just pretend
	//like it doesn't exist. Otherwise it will show up VERY high in the
	//various NLP pipelines.
	if (fieldName == 'body' && (CARD_TYPE_CONFIGURATION[cardType] || {}).defaultBody == fieldValue) fieldValue = '';
	if (config.extraRunDelimiter) fieldValue = fieldValue.split(config.extraRunDelimiter).join('\n');
	const content = config.html ? innerTextForHTML(fieldValue) : fieldValue;
	return splitRuns(content);
};

// Compute uppercase ranges by comparing case-preserved vs lowercase normalized.
// Returns a flat array of [startIndex, length] pairs encoding runs of uppercase
// characters, or undefined if there are none.
export const computeUppercaseRanges = (normalizedLower: string, normalizedOrigCase: string): number[] | undefined => {
	const ranges: number[] = [];
	let i = 0;
	while (i < normalizedLower.length) {
		if (normalizedOrigCase[i] !== normalizedLower[i]) {
			const start = i;
			while (i < normalizedLower.length && normalizedOrigCase[i] !== normalizedLower[i]) i++;
			ranges.push(start, i - start);
		} else {
			i++;
		}
	}
	return ranges.length > 0 ? ranges : undefined;
};

// Reconstruct case-preserved normalized text from lowercase + uppercase ranges.
export const applyCaseMap = (normalized: string, uppercaseRanges?: number[]): string => {
	if (!uppercaseRanges || uppercaseRanges.length === 0) return normalized;
	const chars = normalized.split('');
	for (let r = 0; r < uppercaseRanges.length; r += 2) {
		const start = uppercaseRanges[r];
		const len = uppercaseRanges[r + 1];
		for (let i = start; i < start + len && i < chars.length; i++) {
			chars[i] = chars[i].toUpperCase();
		}
	}
	return chars.join('');
};

class ProcessedRun {

	original : string;
	normalized : string;
	uppercaseRanges? : number[];
	stemmed : string;
	withoutStopWords : string;

	constructor(originalText : string) {
		this.original = originalText;
		this.normalized = normalizedWords(originalText);
		const hasUppercase = originalText !== originalText.toLowerCase();
		if (hasUppercase) {
			const normalizedOrigCase = normalizedWords(originalText, true);
			this.uppercaseRanges = computeUppercaseRanges(this.normalized, normalizedOrigCase);
		} else {
			this.uppercaseRanges = undefined;
		}
		this.stemmed = stemmedNormalizedWords(this.normalized);
		this.withoutStopWords = withoutStopWords(this.stemmed);
	}

	get empty() : boolean {
		return this.normalized == '';
	}
}

//extractContentWords returns an object with the field to the non-de-stemmed
//normalized words for each of the main properties.
const extractContentWords = (card : Card) : NLPInfo => {

	//These three properties are expected to be set by TEXT_SEARCH_PROPERTIES
	//Fields that are derived are calculated based on other fields of the card
	//and should not be considered to be explicit set on the card by the author.
	//For thse fields, skip them in normalized*, since they'll otherwise be part
	//of the fingerprint, and for cards with not much content that use the
	//fingerprint in a derived field that can create reinforcing loops.
	const obj : {[field in CardFieldType]: ProcessedRun[]} = {
		body: [],
		title: [],
		subtitle: [],
		commentary: [],
		title_alternates: [],
		external_link: [],
		references_info_inbound: [],
		non_link_references: [],
		concept_references: []
	};
	for (const fieldName of TypedObject.keys(TEXT_FIELD_CONFIGURATION)) {
		const runs = extractRawContentRunsForCardField(card, fieldName);
		//splitRuns checks for empty runs, but they could be things that will be normalized to nothing, so filter again
		obj[fieldName] = runs.map(str => new ProcessedRun(str)).filter(run => !run.empty);
	}
	return obj;
};

//Simplified version for server-side use without fallbackText, importantNgrams, or synonymMap
export const cardWithNormalizedTextPropertiesSimple = (card: Card): ProcessedCard => {
	return {
		...card,
		fallbackText: {},
		importantNgrams: {},
		synonymMap: {},
		nlp: extractContentWords(card)
	};
};

//text should be normalized
export const ngrams = (text : string, size  = 2) : string[]  => {
	if (!text) return [];
	const pieces = text.split(' ');
	if (pieces.length < size) return [];
	const result = [];
	for (let i = 0; i < (pieces.length - size + 1); i++) {
		const subPieces = [];
		for (let j = 0; j < size; j++) {
			subPieces.push(pieces[i + j]);
		}
		result.push(subPieces.join(' '));
	}
	return result;
};

export const ngramWithinOther =(ngram : string, container : string) : boolean => {
	//ngramWithinOther is _extremely_ hot. We'll add padding to make sure that
	//matches only happen at word boundaries.
	const paddedNgram = ' ' + ngram + ' ';
	const paddedContainer = ' ' + container + ' ';
	return paddedContainer.includes(paddedNgram);
};

//strsMap is card.nlp.withoutStopWords. See cardWithNormalizedTextProperties documentation for more.
//Simplified version: no memoization, no synonym processing
const wordCountsForSemantics = (cardObj : ProcessedCard, maxFingerprintSize : number = MAX_N_GRAM_FOR_FINGERPRINT, optFieldList? : CardFieldType[]) => {
	const fieldsToIndex = optFieldList ? Object.fromEntries(optFieldList.map(fieldName => [fieldName, true])) : TEXT_FIELD_CONFIGURATION;
	const strsMap : {[type in CardFieldType]+?: string[]} = Object.fromEntries(TypedObject.keys(TEXT_FIELD_CONFIGURATION)
		.filter(fieldName => fieldsToIndex[fieldName])
		.map(prop => [prop, cardObj.nlp[prop].map(run => run.withoutStopWords)]).filter(entry => entry[1]));
	//Yes, it's weird that we stash the additionalNgramsMap on a cardObj and
	//then pass that around instead of just passing the ngram map to FingerPrint
	//generator. But it we did it another way, it would break the `similar/`
	//configurable filter.
	const cardMap : {[str : string] : number}= {};
	const importantNgrams = cardObj.importantNgrams || {};
	for (let [fieldName, strs] of TypedObject.entries(strsMap)) {
		if (!strs) strs = [];
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
					const baseAmount = 1/(n + 1);
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
					const baseAmount = 1/(splitWords.length + 1);
					cardMap[words] = (cardMap[words] || 0) + (baseAmount * totalIndexingCount);
				}
			}

			//Count any of the importantNgrams that are present, and count
			//them without discounting for length. We skipped counting them in
			//any of the 'typical' times above.
			for (const ngram of Object.keys(importantNgrams)) {
				//Only match on word boundaries, not within an ngram
				if (ngramWithinOther(ngram, words)) {
					//This is an ngram we wouldn't necessarily have indexed by
					//default (it might have been too long to be automatically
					//extracted, for example), but we've been told it's
					//important when we see it, so take note of it, at a boost
					//above how important it would normally be to make it more
					//likely it shows up
					const splitNgram = ngram.split(' ');
					const baseAmount = 1 / (splitNgram.length + 1);
					cardMap[ngram] = (cardMap[ngram] || 0) + (baseAmount * totalIndexingCount * IMPORTANT_NGRAM_BOOST_FACTOR);
				}
			}
		}
	}
	// Synonym processing removed for server-side simplicity
	return cardMap;
};

export const calcIDFMapForCards = (cards : ProcessedCards, ngramSize: number) : IDFMap => {
	//only consider cards that have a body, even if we were provided a set that included others
	cards = Object.fromEntries(Object.entries(cards).filter(entry => BODY_CARD_TYPES[entry[1].card_type]));

	const numCards = Object.keys(cards).length;

	//cardWords is a object that contains an object for each card id of
	//words to their count in that card. This uses all words htat could be
	//searched over, and is the input to the IDF calculation pipeline and
	//others.
	const cardWordCounts : {[cardID : CardID]: {[word : string] : number}} = {};
	for (const [key, cardObj] of Object.entries(cards)) {
		cardWordCounts[key] = wordCountsForSemantics(cardObj, ngramSize);
	}

	//corpusWords is a set of word => numCardsContainWord, that is, the
	//number of cards that contain the term at least once. This is how idf
	//is normally calculated; we previously used the raw count of times it
	//showed up.
	const corpusWords : WordNumbers = {};
	for (const words of Object.values(cardWordCounts)) {
		for (const word of Object.keys(words)) {
			corpusWords[word] = (corpusWords[word] || 0) + 1;
		}
	}

	//idf (inverse document frequency) of every word in the corpus. See
	//https://en.wikipedia.org/wiki/Tf%E2%80%93idf
	const idf : WordNumbers = {};
	let maxIDF = 0;
	for (const [word, count] of Object.entries(corpusWords)) {
		idf[word] = Math.log10(numCards / (count + 1));
		if (idf[word] > maxIDF) maxIDF = idf[word];
	}
	return {idf, maxIDF};
};

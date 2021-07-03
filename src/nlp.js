import {
	stemmer
} from './stemmer.js';

import {
	TEXT_FIELD_CONFIGURATION,
	DERIVED_FIELDS_FOR_CARD_TYPE,
	BODY_CARD_TYPES,
	TEXT_FIELD_REFERENCES_NON_LINK_OUTBOUND,
	TEXT_FIELD_RERERENCES_CONCEPT_OUTBOUND,
	TEXT_FIELD_TITLE_ALTERNATES,
	REFERENCE_TYPE_LINK,
	TEXT_FIELD_BODY,
	REFERENCE_TYPE_ACK,
	CARD_TYPE_CONCEPT,
	TEXT_FIELD_TITLE,
	REFERENCE_TYPES,
	CARD_TYPE_CONFIGURATION,
	REFERENCE_TYPE_SYNONYM,
	REFERENCE_TYPE_CONCEPT,
	REFERENCE_TYPES_EQUIVALENCE_CLASSES
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
	memoizeFirstArg
} from './memoize.js';

//allCards can be raw or normalized. Memoized so downstream memoizing things will get the same thing for the same values
export const conceptCardsFromCards = memoizeFirstArg((allCards) => {
	return Object.fromEntries(Object.entries(allCards).filter(entry => entry[1].card_type == CARD_TYPE_CONCEPT));
});

//Rturns the primary concept string only (the title). See also getAllConceptStringsFromConceptCard
export const getConceptStringFromConceptCard = (rawConceptCard) => {
	if (rawConceptCard.card_type != CARD_TYPE_CONCEPT) return '';
	return rawConceptCard[TEXT_FIELD_TITLE];
};

const extractSynonymsFromCardTitleAlternates = (rawCard) => {
	return extractRawContentRunsForCardField(rawCard,TEXT_FIELD_TITLE_ALTERNATES).map(str => str.trim()).filter(str => str);
};

const getAllNormalizedConceptStringsFromConceptCard = (processedConceptCard) => {
	if (processedConceptCard.card_type != CARD_TYPE_CONCEPT) return [];
	return [...processedConceptCard.nlp[TEXT_FIELD_TITLE].map(run => run.withoutStopWords), ...processedConceptCard.nlp[TEXT_FIELD_TITLE_ALTERNATES].map(run => run.withoutStopWords)];
};

//REturns all strings that cardMatchesConcept would work for.
export const getAllConceptStringsFromConceptCard = (rawConceptCard) => {
	if (rawConceptCard.card_type != CARD_TYPE_CONCEPT) return [];
	return [getConceptStringFromConceptCard(rawConceptCard), ...extractSynonymsFromCardTitleAlternates(rawConceptCard)];
};

//Returns all concept strings that, if provided to getConceptCardForConcept,
//would return a card. Note that this is not a one-to-one erlationship to
//concept cards, it might include multiple entries for each concept card if it
//has title alternates. memoized so downstream memoizing things will get object
//equality.
export const getConceptsFromConceptCards = memoizeFirstArg((conceptCards) => {
	const result = {};
	for (const card of Object.values(conceptCards)) {
		for (const conceptStr of getAllConceptStringsFromConceptCard(card)) {
			result[conceptStr] = card.id;
		}
	}
	return result;
});

const cardMatchesConcept = (card, conceptStr) => {
	if (card.card_type !== CARD_TYPE_CONCEPT) return false;
	if (cardMatchesString(card, TEXT_FIELD_TITLE, conceptStr)) return true;
	if (cardMatchesString(card, TEXT_FIELD_TITLE_ALTERNATES, conceptStr)) return true;
	return false;
};

//getAllConceptCardsForConcept is like getConceptCardForConcept, but it will
//return all of them that might exist, which helps find possible overlaps.
export const getAllConceptCardsForConcept = (allCardsOrConceptCards, conceptStr) => {
	return Object.values(allCardsOrConceptCards).filter(card => cardMatchesConcept(card, conceptStr));
};

//allCardsOrConceptCards can be the map of allCards, or filtered down to just
//concept cards for speed.
export const getConceptCardForConcept = (allCardsOrConceptCards, conceptStr) => {
	for (const card of Object.values(allCardsOrConceptCards)) {
		if (cardMatchesConcept(card, conceptStr)) return card;
	}
	return null;
};

//Returns a map of str => [synonym1, synonym2, ...]. The words won't be normalized.
export const synonymMap = (rawCards) => {
	const conceptCards = conceptCardsFromCards(rawCards);
	const result = {};
	//NOTE: this logic relies on synonym only being legal to/from concept cards.
	for (const card of Object.values(conceptCards)) {
		const title = getConceptStringFromConceptCard(card);
		//We treat synonym as a bidirectional link, so if a card links to US as
		//a synonym, we'll also consider them our sysnonym.
		//TODO: handle bidirectional linking more resiliently
		const synonymReferencesOutbound = references(card).byType[REFERENCE_TYPE_SYNONYM] || {};
		const synonymReferencesInbound = references(card).byTypeInbound[REFERENCE_TYPE_SYNONYM] || {};
		//We'll use a map so we get a unique result. In particular, the card we
		//point to as a synonym might point to us as a synonym, too.
		const synonyms = {};
		for (const otherCardID of [...Object.keys(synonymReferencesOutbound), ...Object.keys(synonymReferencesInbound)]) {
			const otherCard = rawCards[otherCardID];
			if (!otherCard) continue;
			const otherCardTitle = getConceptStringFromConceptCard(otherCard);
			//This shouldn't happen, but could if the other card somehow isn't a concept card
			if (!otherCardTitle) continue;
			synonyms[otherCardTitle] = true;
		}
		for (const synonym of extractSynonymsFromCardTitleAlternates(card)) {
			synonyms[synonym] = true;
		}
		if (Object.keys(synonyms).length == 0) continue;
		result[title] = [...Object.keys(synonyms)];
	}
	//TODO: do expansion of synonyms to synonyms so we get transitive synonyms
	//until it stabalizes (or a count of 5 or something as a sanity check)
	return result;
};

//STOP_WORDS are words that are so common that we should basically skip them. We
//skip them when generating multi-word queries, and also for considering words
//for ngrams, since these words are so common that if they're considered than a
//distinctive word + a stop word will show up twice. This stop word list is a
//lightly processed version of NLTK's english stop word list, from
//https://gist.github.com/sebleier/554280, filtered to cut off things from
//"once" and downward, and also prononuns like `I`, 'my', 'mine', `myself` and
//the 2nd and 3rd person variations.
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

//STOP_WORDS that should be lowercased in fingerprint.prettyItems.
const LOWERCASE_STOP_WORDS = {
	'a' : true,
	'an' : true,
	'the' : true,
	'in' : true,
	'and': true,
	'of': true,
	'to': true,
	'it': true,
	'on': true,
	'for':true,
};

//OVERRIDE_STEMS are words that stem 'wrong' and we want to have a manual
//replacement instead of using the real stemmer. If the word being stemmed
//starts with the key in this map, it will be 'stemmed' to the word on the
//right.
const OVERRIDE_STEMS = {
	//optimism-family words and optimized-familyl words stem to the same thing
	//but they're very different.
	'optimiz': 'optimiz',
	//generally and generative stem to the same word otherwise
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
	'communit': 'communit'
};

//we can't use memoizeFirstArg because that uses WeakMap which requires an
//object as a key.
const memoizedRegularExpressionForOriginalNgram = {};

//Returns a regular expression that could be run over original, unprocessed text
//and match the ngram given by normalizedNgram. Note that normalizedNgram is
//before any stemming or stop word removal. Memoized so the RE can be compiled
//and cached.
const regularExpressionForOriginalNgram = (normalizedNgram) => {
	let result = memoizedRegularExpressionForOriginalNgram[normalizedNgram];
	if (!result) {
		//This needs to 'undo' the normalization of normalizeString. Luckily all
		//of that special casing is just handled by the \W character class, plus
		//any escaped codes like &gt;
		const betweenWordsRE = '(\\W|&(\\w*);)*';
		//Make sure the start and end are not word characters, so we don't match wihtin a word.
		const wholeRE = '(?<!\\w)(' + normalizedNgram.split(' ').map(word => escapeRegex(word)).join(betweenWordsRE) + ')(?!\\w)';
		result = new RegExp(wholeRE, 'ig');
		memoizedRegularExpressionForOriginalNgram[normalizedNgram] = result;
	}
	return result;
};

//Returns the HTML string, with the strings for any concept references this card
//makes with highlighting styling. This is very expensive, so it's memoized. It
//wraps things in a <card-highlight card="CARDID">content</card-highlight>, so
//include components/card-highlight wherever you use it. Also, make sure to
//sanitize the result for XSS. extraIDs should be an array of cardIDs to
//highlight as alternates if found (and to proactively pretend are on card)
export const highlightConceptReferences = memoizeFirstArg((card, fieldName, extraIDs) => {
	if (!card || Object.keys(card).length == 0) return '';
	if (!extraIDs) extraIDs = [];
	const fieldConfig = TEXT_FIELD_CONFIGURATION[fieldName];
	if (!fieldConfig) return '';
	if (!fieldConfig.html) return card[fieldName];
	const extraIDMap = Object.fromEntries(extraIDs.map(id => [id, true]));
	const conceptCardReferences = Object.fromEntries(references(card).typeClassArray(REFERENCE_TYPE_CONCEPT).map(item => [item, true]));
	const allConceptCardReferences = {...extraIDMap, ...conceptCardReferences};
	const filteredHighlightMap = Object.fromEntries(Object.entries(card.importantNgrams || {}).filter(entry => allConceptCardReferences[entry[1]]));
	return highlightHTMLForCard(card, fieldName, filteredHighlightMap, extraIDMap);
});

const highlightHTMLForCard = (card, fieldName, filteredHighlightMap, alternateIDMap) => {

	//filteredHighlightMap is a map of fullyNormalized string -> cardID. First
	//we go through each run of the field and identify the normalized
	//representation of that ngram in that run, if it exists. So for example
	//'forc graviti' would be backed out to 'force of gravity' within the run.

	const originalConceptStrs = {};
	for (const [fullyNormalizedConceptStr, cardID] of Object.entries(filteredHighlightMap)) {
		const runs = card.nlp[fieldName];
		for (let run of runs) {
			const originalNgram = extractOriginalNgramFromRun(fullyNormalizedConceptStr, run);
			if (originalNgram) {
				//TODO: look for clobbering of overlapping concepts e.g. force, external force
				originalConceptStrs[originalNgram] = cardID;
			}
		}
	}
	//sort the concept strings so the biggest ones go first, because if the
	//smaller ones go first they'll interfere with the bigger ones.
	const sortedOriginalConceptStrs = [...Object.keys(originalConceptStrs)].sort((a,b) => b.length - a.length);
	//Now we have a map of all original runs of text (in normalized, not
	//destemmed, not stop-word-removed) form, mapped to the concept they come
	//from. We need to replace every occurance of them in the whole text, but
	//there might be arbitrary whitespace or punctuation in between.
	let result = card[fieldName];
	for (const originalConceptStr of sortedOriginalConceptStrs) {
		const cardID = originalConceptStrs[originalConceptStr];
		result = highlightStringInHTML(result,originalConceptStr, cardID, alternateIDMap[cardID] || false);
	}
	return result;
};

//targetStr is knownto exist, modulo non-word characters, in the html. (Although it might not exist as a raw run)
const highlightStringInHTML = (html, targetStr, cardID, isAlternate) => {
	//even though html, targetStr, and cardID aren't necessarily sanitized, it's
	//OK as long as we never put the element into the DOM.
	const ele = getDocument().createElement('section');
	ele.innerHTML = html;
	const re = regularExpressionForOriginalNgram(targetStr);
	highlightStringInEle(ele, re, cardID, false, isAlternate);
	//reading back innerHTML replaces control characters like '&gt;' with '&amp;gt;
	return ele.innerHTML.split('&amp;').join('&');
};

//withinLink is whether we're within the link context, isAlternate should be
//true if it should be alternate
const highlightStringInEle = (ele, re, cardID, withinLink, isAlternate) => {
	//don't highlight if it's inside a card-highlight, or a card-link, because that gets confusing.
	if (ele.localName == 'card-highlight') return;
	withinLink = withinLink || ele.localName == 'card-link';
	if (ele.children.length == 0) {
		if (!ele.innerHTML) return;
		//A leaf node.
		//We read back out of textContent because in innerHTML escape & will be replaced by &amp;
		ele.innerHTML = ele.textContent.replace(re,(wholeMatch) => '<card-highlight ' + (withinLink ? 'disabled ' : '' ) + (isAlternate ? 'alternate ' : '') + 'card="' + cardID + '">' + wholeMatch + '</card-highlight>');
		return;
	}
	//ele.childNodes is a live node list but we'll be adding nodes potentially
	//so take a snapshot.
	for (let node of [...ele.childNodes]) {
		if (node.nodeType == node.ELEMENT_NODE) {
			highlightStringInEle(node, re, cardID, withinLink, isAlternate);
		} else if (node.nodeType == node.TEXT_NODE) {
			if (!re.test(node.textContent)) continue;
			//OK, the text is in there. We need to swap out this text node with multiple children (up to three).
			const tempEle = getDocument().createElement('span');
			tempEle.innerHTML = node.textContent;
			highlightStringInEle(tempEle, re, cardID, withinLink, isAlternate);
			//Now, read back out tempEle's children and reparent in place to our parent.
			node.replaceWith(...tempEle.childNodes);
			
		}
	}
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
	const runs = card.nlp[fieldName] || [];
	for (const run of runs) {
		if (run.withoutStopWords == normalizedString) return true;
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
	[TEXT_FIELD_RERERENCES_CONCEPT_OUTBOUND]: (card) => {
		const conceptRefs = references(card).withFallbackText(card.fallbackText).byTypeClass(REFERENCE_TYPE_CONCEPT);
		if (!conceptRefs) return '';
		let result = [];
		for (const cardMap of Object.values(conceptRefs)) {
			for (const str of Object.values(cardMap)) {
				if (str) result.push(str);
			}
		}
		return result.join('\n');
	},
};

const extractRawContentRunsForCardField = (card, fieldName) => {
	const cardType = card.card_type || '';
	const config = TEXT_FIELD_CONFIGURATION[fieldName];
	if (DERIVED_FIELDS_FOR_CARD_TYPE[cardType][fieldName]) return [];
	let fieldValue = '';
	if (config.overrideExtractor) {
		const extractor = OVERRIDE_EXTRACTORS[fieldName];
		if (!extractor) throw new Error(fieldName + ' had overrideExtractor set, but no entry in OVERRIDE_EXTRACTORS');
		fieldValue = extractor(card);
	} else {
		fieldValue = extractFieldValueForIndexing(card[fieldName]);
	}
	if (!fieldValue) fieldValue = '';
	//If the text is the defaultBody for that card type, just pretend
	//like it doesn't exist. Otherwise it will show up VERY high in the
	//various NLP pipelines.
	if (fieldName == TEXT_FIELD_BODY && CARD_TYPE_CONFIGURATION[cardType].defaultBody == fieldValue) fieldValue = '';
	if (config.extraRunDelimiter) fieldValue = fieldValue.split(config.extraRunDelimiter).join('\n');
	const content = config.html ? innerTextForHTML(fieldValue) : fieldValue;
	return splitRuns(content);
};

class ProcessedRun {
	constructor(originalText) {
		this.original = originalText;
		this.normalized = normalizedWords(originalText);
		this.stemmed = stemmedNormalizedWords(this.normalized);
		this.withoutStopWords = withoutStopWords(this.stemmed);
	}

	get empty() {
		return this.normalized == '';
	}
}

//returns an object with original, normalized, stemmed, withoutStopWords fields.
const processedRun = (originalText) => {
	return new ProcessedRun(originalText);
};

//extractContentWords returns an object with the field to the non-de-stemmed
//normalized words for each of the main properties.
const extractContentWords = (card) => {
	
	//These three properties are expected to be set by TEXT_SEARCH_PROPERTIES
	//Fields that are derived are calculated based on other fields of the card
	//and should not be considered to be explicit set on the card by the author.
	//For thse fields, skip them in normalized*, since they'll otherwise be part
	//of the fingerprint, and for cards with not much content that use the
	//fingerprint in a derived field that can create reinforcing loops.
	const obj = {};
	for (let fieldName of Object.keys(TEXT_FIELD_CONFIGURATION)) {
		let runs = extractRawContentRunsForCardField(card, fieldName);
		//splitRuns checks for empty runs, but they could be things that will be normalized to nothing, so filter again
		runs = runs.map(str => processedRun(str)).filter(run => !run.empty);
		obj[fieldName] = runs;
	}
	return obj;
};

let memoizedNormalizedSynonymMaps = new Map();

const normalizeSynonymMap = (synonyms) => {
	//synonyms is word => [synonym_word,...]
	if (!memoizedNormalizedSynonymMaps.has(synonyms)) {
		const normalizedMap = Object.fromEntries(Object.entries(synonyms).map(entry => [fullyNormalizedString(entry[0]), entry[1].map(str => fullyNormalizedString(str))]));
		memoizedNormalizedSynonymMaps.set(synonyms, normalizedMap);
	}
	return memoizedNormalizedSynonymMaps.get(synonyms);
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
// * card.synonymMap = normalized synonyms
// * card.nlp = object with: 
//
//  one per field type, an array of ProcessedRuns objects (see processedRun). Each has the following fields:
//		original: the original text
//      normalized: the extracted text runs for that field, with all words normalized. Note that some logical runs from the original text field may already have been filtered by this step. punctuation between words will be removed, everything will be lower case.
//		stemmed: the normalized values, but also each word will have been stemmed. Each word will still line up with each word in normalized (stemming never removes words)
//		withoutStopWords: the stemmed values, but also with stop words removed. The number of words in this field set will likely be smaller than the two above.
export const cardWithNormalizedTextProperties = memoizeFirstArg((card, fallbackText, importantNgrams, synonyms) => {
	if (!card) return card;
	if (DEBUG_COUNT_NORMALIZED_TEXT_PROPERTIES) {
		normalizedCount[card.id] = (normalizedCount[card.id] || 0) + 1;
		if(normalizedCount[card.id] > 1) console.log(card.id, card, normalizedCount[card.id]);
	}
	const result = {...card};
	if (fallbackText) result.fallbackText = fallbackText;
	if (importantNgrams) result.importantNgrams = normalizeNgramMap(importantNgrams);
	if (synonyms) result.synonymMap = normalizeSynonymMap(synonyms);
	result.nlp = extractContentWords(result);
	return result;
});

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
			if(!propertySubQuery || !card.nlp || !card.nlp[key]) continue;
			const runs = card.nlp[key];
			if (runs.length == 0) continue;
			const singleRun = runs.map(run => run.stemmed).join(' ');
			if (singleRun.length == 0) continue;
			//propertyFullMatch should be across ALL runs. Even if no one run
			//has all of the words, as long as together they all do, it's OK.
			const [, propertyFullMatch] = stringPropertyScoreForStringSubQuery(singleRun, propertySubQuery);
			if (!fullMatch && propertyFullMatch) fullMatch = true;
			let scoreAddition = runs.map(run => stringPropertyScoreForStringSubQuery(run.stemmed, propertySubQuery)[0]).reduce((prev, curr) => prev + curr, 0.0);
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

const ngramWithinOther =(ngram, container) => {
	//ngramWithinOther is _extremely_ hot. First we'll check if the whole ngram
	//is even a strict subset of the container. If it is, then we'll
	//additionally do the extra check to make sure that match happens at word
	//boundaries, not within words.
	if (!container.includes(ngram)) return false;
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
//How much to discount a 'word count' of a synonym that's not literally on the card.
const SYNONYM_DISCOUNT_FACTOR = 0.75;

//strsMap is card.nlp.withoutStopWords. See cardWithNormalizedTextProperties documentation for more.
const wordCountsForSemantics = memoizeFirstArg((cardObj, maxFingerprintSize) => {
	const strsMap = Object.fromEntries(Object.keys(TEXT_FIELD_CONFIGURATION).map(prop => [prop, cardObj.nlp[prop].map(run => run.withoutStopWords)]).filter(entry => entry[1]));
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
			for (let ngram of Object.keys(importantNgrams)) {
				//Only match on word boundaries, not within an ngram
				if (ngramWithinOther(ngram, words)) {
					//This is an ngram we wouldn't necessarily have indexed by
					//default (it might have been too long to be automatically
					//extracted, for example), but we've been told it's
					//important when we see it, so take note of it, at more than
					//full value to ensure it shows up in fingerprints even it
					//it wouldn't have otherwise.
					cardMap[ngram] = (cardMap[ngram] || 0) + totalIndexingCount;
				}
			}
		}
	}
	//Pretend we saw synonym expansions on each card
	if (cardObj.synonymMap) {
		for (const [keyWord, synonyms] of Object.entries(cardObj.synonymMap)) {
			const keyWordValue = cardMap[keyWord];
			//If that keyword wasn't on this card, skip it
			if (keyWordValue === undefined) continue;
			for (const synonym of synonyms) {
				const proposedValue = keyWordValue * SYNONYM_DISCOUNT_FACTOR;
				//Add this synonym count to existing natural counts.
				cardMap[synonym] = (cardMap[synonym] || 0) + proposedValue;
			}
		}
	}
	return cardMap;
});

//targetNgram is the targted, withoutStopWords ngram to look for. Run is the
//processedRun to look within. The result will be a substring out of
//normalizedRun corresponding to targetNgram. This will return '' if the
//targetNgram doesn't exist as a word-boundary subset of withoutStopWordsRun.
const extractOriginalNgramFromRun = (targetNgram, run) => {
	if (!ngramWithinOther(targetNgram, run.withoutStopWords)) return '';
	//We know that targetNgram is within withoutStopWordsRun. Now, look for its
	//word index (start and length) within stemmedRun.
	let stemmedRunWords = run.stemmed.split(' ');
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
	return run.normalized.split(' ').slice(startWordIndex, startWordIndex + wordCount).join(' ');

};

const MAX_MISSING_POSSIBLE_CONCEPTS = 100;

//Enable while debugging possibleMissingConcepts.
const DEBUG_PRINT_MISSING_CONCEPTS_INFO = false;

export const possibleMissingConcepts = (cards) => {
	//Turn the size of ngrams we generate up to 11! This will help us find very long ngrams, but will use a LOT of memory and compuation.
	const maximumFingerprintGenerator = new FingerprintGenerator(cards, SEMANTIC_FINGERPRINT_SIZE * 5, MAX_N_GRAM_FOR_FINGERPRINT + 5);
	let cardIDsForNgram = {};
	let cumulativeTFIDFForNgram = {};

	const conceptCards = conceptCardsFromCards(cards);
	const existingConcepts = normalizeNgramMap(getConceptsFromConceptCards(conceptCards));

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

	//The ngrams we'll return
	const finalNgrams = [];
	//The ngrams to skip if we come across them. Start off with the existing
	//concept ngrams, but add items as we add more things to finalNgrams.
	const excludeNgrams = Object.keys(existingConcepts);
	for (const ngram of sortedNgramBundleKeys) {
		let knockedOut = null;
		//Skip ngrams that are full supersets or subsets of ones that have already been selected, or ones that are just permutations of an ngram that was already selected
		for (const includedNgram of excludeNgrams) {
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
			//some ngrams are concepts but weren't processed as serious candidates
			if (ngramBundles[includedNgram]) {
				if (ngramBundles[ngram].sortedNgram == ngramBundles[includedNgram].sortedNgram) {
					knockedOut = {
						self: ngram,
						other: includedNgram,
						reason: 'permutation',
					};
					break;
				}
			}
		}

		if (knockedOut) {
			knockedOut.otherBundle = ngramBundles[knockedOut.other];
			knockedOut.selfBundle = ngramBundles[knockedOut.self];
			knockedOutNgrams.push(knockedOut);
			continue;
		}
		finalNgrams.push(ngram);
		excludeNgrams.push(ngram);
		if (finalNgrams.length >= MAX_MISSING_POSSIBLE_CONCEPTS) break;
	}

	if (DEBUG_PRINT_MISSING_CONCEPTS_INFO) {
		console.log('Knocked out', knockedOutNgrams);
		console.log(finalNgrams.map(ngram => ngramBundles[ngram]));
	}

	const resultMap = new Map(finalNgrams.map(ngram => [ngram, ngramBundles[ngram].scoreForBundle]));
	return new Fingerprint(resultMap, Object.values(cards), maximumFingerprintGenerator);
};

//suggestConceptReferencesForCard is very expensive, so memoize it.
export const suggestedConceptReferencesForCard = memoizeFirstArg((card, fingerprint, allCardsOrConceptCards, concepts) => {
	const candidates = {};
	if (!card || !fingerprint) return [];
	if (!BODY_CARD_TYPES[card.card_type]) return [];
	const itemsFromConceptReferences = fingerprint.itemsFromConceptReferences();
	const existingReferences = references(card).byType;
	const REFERENCE_TYPES_THAT_SUPPRESS_SUGGESTED_CONCEPT = Object.keys(REFERENCE_TYPES).filter(key => REFERENCE_TYPES_EQUIVALENCE_CLASSES[REFERENCE_TYPE_CONCEPT][key] || key == REFERENCE_TYPE_ACK);
	const normalizedConcepts = normalizeNgramMap(concepts);
	const itemsNotFromCard = fingerprint.itemsNotFromCard();
	const conceptStrForCandidateCard = {};
	for (let fingerprintItem of fingerprint.keys()) {
		//Skip items we know weren't on card. This helps not suggest concept
		//cards for synonyms if we don't literally use that word on this card or
		//one of its backported references.
		if (itemsNotFromCard[fingerprintItem]) continue;
		//Skip items that aren't concepts
		if (!normalizedConcepts[fingerprintItem]) continue;

		//OK, we think there's a card that matches this fingerprint item.
		const conceptCard = getConceptCardForConcept(allCardsOrConceptCards, fingerprintItem);
		//false alarm
		if (!conceptCard) continue;
		//Don't suggest that concept cards reference themselves
		if (conceptCard.id == card.id) continue;

		//Skip items we already point to... but only if it expands to the same
		//card as we'll suggest. For example, if a card mentions 'agent' and
		//'system' (synonyms) explicitly, and we already link to 'agent', but
		//not yet 'system', system should be allowed because it expands to a
		//different card.
		if (itemsFromConceptReferences[fingerprintItem] == card.id) continue;

		let skipSuggestion = false;
		//Don't suggest concepts that are full subsets of concepts we already accepted
		for (const containingNgram of Object.keys(itemsFromConceptReferences)) {
			//If there are multiple cards that are synonyms of one another, then
			//we might get the same fingerpintItem and containingItem, but that
			//check should be handled the line above, where we check if that
			//precise card id has already been included.
			if (fingerprintItem == containingNgram) continue;
			if (ngramWithinOther(fingerprintItem, containingNgram)) {
				skipSuggestion = true;
				break;
			}
		}
		if (skipSuggestion) continue;

		//Skip ones that we've already included as a suggestion (which could have happened if we
		//already saw a synonym item)
		if (candidates[conceptCard.id]) continue;
		//Don't suggest things that already have references of type concept (and sub-types like syonym), or the generic ack.
		for (const referenceType of REFERENCE_TYPES_THAT_SUPPRESS_SUGGESTED_CONCEPT) {
			const referencesOfType = existingReferences[referenceType];
			if (!referencesOfType) continue;
			if (referencesOfType[conceptCard.id] !== undefined) {
				skipSuggestion = true;
				break;
			}
		}
		if (skipSuggestion) continue;
		conceptStrForCandidateCard[conceptCard.id] = fingerprintItem;
		candidates[conceptCard.id] = true;
	}
	//Now we want to make sure we don't suggest any concepts that are subsets of
	//larger concepts we might also suggest, since if the user were to select
	//the larger concept then it would suppress the smaller concepts.

	//consider largest concepts down to smallest to guarantee that we pick the
	//larger ones first. We'll sort a copy because we still want to keep the
	//original order so we suggest higher fingerprint items first
	let sortedCandidates = [...Object.keys(candidates)];
	sortedCandidates.sort((a, b) => conceptStrForCandidateCard[b].length - conceptStrForCandidateCard[a].length);

	let cardsToIncludeInResult = {};
	for (const candidate of sortedCandidates) {
		let skipCandidate = false;
		for (const includedItem of Object.keys(cardsToIncludeInResult)) {
			if (ngramWithinOther(conceptStrForCandidateCard[candidate], conceptStrForCandidateCard[includedItem])) {
				skipCandidate = true;
				break;
			}
		}
		if (skipCandidate) continue;
		cardsToIncludeInResult[candidate] = true;
	}

	return [...Object.keys(candidates)].filter(id => cardsToIncludeInResult[id]);
});

export const emptyWordCloud = () => {
	return [[],{}];
};

const capitalizeTitleWord = (word) => {
	const stemmedWord = stemmedNormalizedWords(word);
	return !LOWERCASE_STOP_WORDS[stemmedWord];
};

const titleCase = (str) => str.split(' ').map(word => capitalizeTitleWord(word) ? word.charAt(0).toUpperCase() + word.slice(1) : word).join(' ');

//The max number of words to include in the semantic fingerprint
const SEMANTIC_FINGERPRINT_SIZE = 50;

const SEMANTIC_FINGERPRINT_MATCH_CONSTANT = 1.0;

class Fingerprint {
	constructor(items, cardOrCards, generator) {
		this._cards = Array.isArray(cardOrCards) ? cardOrCards : (cardOrCards ? [cardOrCards] : []);
		this._generator = generator;
		this._items = items || new Map();
		this._memoizedWordCloud = null;
		this._memoizedFullWordCloud = null;
	}

	keys() {
		return this._items.keys();
	}

	values() {
		return this.items.values();
	}

	entries() {
		return this._items.entries();
	}

	wordCloud() {
		if (!this._memoizedWordCloud) {
			this._memoizedWordCloud = this._generatewordCloud(true);
		}
		return this._memoizedWordCloud;
	}

	fullWordCloud() {
		if (!this._memoizedFullWordCloud) {
			this._memoizedFullWordCloud = this._generatewordCloud(false);
		}
		return this._memoizedFullWordCloud;
	}

	_generatewordCloud(hideItemsNotFromCard) {
		if (!this._items || this._items.keys().length == 0) return emptyWordCloud();
		const displayItems = this.prettyItems();
		const maxAmount = Math.max(...this._items.values());
		const conceptItems = this.itemsFromConceptReferences();
		const infos = Object.fromEntries([...this._items.entries()].map((entry,index) => {
			const amount = entry[1] / maxAmount * 100;
			const info = {title: displayItems[index],suppressLink:true, filter: 'opacity(' + amount + '%)'};
			if (conceptItems[entry[0]]) {
				info.color = 'var(--app-secondary-color)';
				info.previewCard = conceptItems[entry[0]];
			}
			return [entry[0], info];
		}));
		const itemsToHide = hideItemsNotFromCard ? this.itemsNotFromCard() : {};
		return [[...this._items.keys()].filter(key => !itemsToHide[key]), infos];
	}

	//returns a map of item => true for fingerprint items that were not
	//explicitly on the card, either direclty or via backporting reference text.
	//This could happen for example because of synonym expansion. 
	itemsNotFromCard() {
		//For each ngram we only have to search until we find a single occurance of it to know it's included.
		return Object.fromEntries(
			[...this._items.keys()].filter(ngram => {
				return !this._cards.some(card => {
					const fieldsToSkip = DERIVED_FIELDS_FOR_CARD_TYPE[card.card_type] || {};
					return Object.entries(card.nlp).filter(entry => !fieldsToSkip[entry[0]]).map(entry => entry[1]).some(runs => runs.some(run => ngramWithinOther(ngram, run.withoutStopWords)));
				});
			}).map(ngram => [ngram, true])
		);
	}

	prettyItems() {
		const result = [];
		const itemsNotFromCard = this.itemsNotFromCard();
		for (const ngram of this._items.keys()) {
			const originalNgrams = {};
			if (!itemsNotFromCard[ngram]) {
				for (const card of this._cards) {
					for (const runs of Object.values(card.nlp)) {
						for (const run of runs) {
							const originalNgram = extractOriginalNgramFromRun(ngram, run);
							if (originalNgram) {
								originalNgrams[originalNgram] = (originalNgrams[originalNgram] || 0) + 1;
							}
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
				maxOriginalNgram = ngram.split(' ').map(word => {
					const candidateMap = reversedStemmedWords[word];
					let max = 0;
					let maxWord = '';
					for (const [word, count] of Object.entries(candidateMap)) {
						if (count < max) continue;
						max = count;
						maxWord = word;
					}
					return maxWord;
				}).join(' ');
			}

			result.push(titleCase(maxOriginalNgram));
		}
		return result;
	}

	//dedupedPrettyItems returns a version of the fingerprint suitable for
	//showing to a user, by de-stemming words based on the words that are most
	//common in cardObj. Returns a string where any dupcliates have been removed.
	dedupedPrettyItems() {
		const fingerprintItems = this.prettyItems();
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
	}

	//returns a map of fingerprintItem -> true for the fingerprint items that
	//overlap with the text in concept references for the given card obj. That is,
	//they don't just _happen_ to overlap with a concept, they come (at least
	//partially) from that explicit reference.
	itemsFromConceptReferences() {
		if (!this._cards) return {};
		let result = {};
		for (let obj of this._cards) {
			//A concept card should count its own title/title-alts as coming
			//from itself. getAllNormalizedConceptStringsFromConceptCard will
			//return an empty array if the card is not a concept card.
			let strs = [...obj.nlp[TEXT_FIELD_RERERENCES_CONCEPT_OUTBOUND].map(run => run.withoutStopWords), ...getAllNormalizedConceptStringsFromConceptCard(obj)];
			for (let str of strs) {
				//The fingerprint will have STOP_WORDs filtered, since it's
				//downstream of wordCountsForSemantics, so do the same to check for
				//a match.
				if (this._items.has(str)) {
					result[str] = obj.importantNgrams[str] || '?INVALID-CARDID?';
				}
				const synonyms = obj.synonymMap[str];
				if (!synonyms) continue;
				for (const synonym of synonyms) {
					if (this._items.has(synonym)) {
						result[synonym] = obj.importantNgrams[str] || '?INVALID-CARDID?';
					}
				}
			}
		}
		return result;
	}

	//Returns the 'overlap' between two semantic fingerprints (which can be fetched
	//from e.g. selectCardsSemanticFingerprint). Higher nubmers are better. The
	//numbers may be any number greater than 0, and only have meaning when compared
	//to other numbers from this function.
	semanticOverlap(otherFingerprint) {

		const fingerprintOne = this._items ? this._items : new Map();
		const fingerprintTwo = otherFingerprint && otherFingerprint._items ? otherFingerprint._items : new Map();

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
	}

}

export class FingerprintGenerator {
	constructor(cards, optFingerprintSize = SEMANTIC_FINGERPRINT_SIZE, optNgramSize = MAX_N_GRAM_FOR_FINGERPRINT) {

		this._cards = cards;
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

		//corpusWords is a set of word => numCardsContainWord, that is, the
		//number of cards that contain the term at least once. This is how idf
		//is normally calculated; we previously used the raw count of times it
		//showed up.
		let corpusWords = {};
		for (const words of Object.values(cardWordCounts)) {
			for (const word of Object.keys(words)) {
				corpusWords[word] = (corpusWords[word] || 0) + 1;
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
			fingerprints[cardID] = this._fingerprintForTFIDF(tfidf, cards[cardID]);
		}
		this._fingerprints = fingerprints;
	}

	_fingerprintForTFIDF(tfidf, cardOrCards) {
		//Pick the keys for the items with the highest tfidf (the most important and specific to that card)
		let keys = Object.keys(tfidf).sort((a, b) => tfidf[b] - tfidf[a]).slice(0, this.fingerprintSize());
		let items = new Map(keys.map(key => [key, tfidf[key]]));
		return new Fingerprint(items, cardOrCards, this);
	}

	_wordCountsForCardObj(cardObj) {
		//Filter out empty items for properties that don't have any items
		return wordCountsForSemantics(cardObj, this._ngramSize);
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
		if (!cardObj || Object.keys(cardObj).length == 0) return new Fingerprint();
		const wordCounts = this._wordCountsForCardObj(cardObj);
		const tfidf = this._cardTFIDF(wordCounts);
		const fingerprint = this._fingerprintForTFIDF(tfidf, cardObj);
		return fingerprint;
	}

	fingerprintForCardIDList(cardIDs) {
		if (!cardIDs || !cardIDs.length) return new Fingerprint();
		let combinedTFIDF = {};
		for (const cardID of cardIDs) {
			const fingerprint = this.fingerprintForCardID(cardID);
			if (!fingerprint) continue;
			for (const [word, idf] of fingerprint.entries()) {
				combinedTFIDF[word] = (combinedTFIDF[word] || 0) + idf;
			}
		}
		return this._fingerprintForTFIDF(combinedTFIDF, cardIDs.map(id => this._cards[id]));
	}

	//returns a map of cardID => fingerprint for the cards that were provided to the constructor
	fingerprints() {
		return this._fingerprints;
	}

	fingerprintSize() {
		return this._fingerprintSize;
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
			overlaps[otherID] = keyFingerprint.semanticOverlap(fingerprints[otherID]);
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
	processedRun,
	highlightStringInHTML,
};
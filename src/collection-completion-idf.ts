//THE DESCRIPTION TIER, WEIGHTED BY RARITY RATHER THAN BY LUCK.
//
//The old description tier was a word-prefix scan: a token matched if it started
//any word of any prose the candidate carried, and every such match was worth
//exactly the same. That is why typing 'or' reached every sort in the app (their
//generated prose all reads "Orders this collection by…"), and why typing 'card'
//reached the entire vocabulary — nearly every description in this product
//contains the word 'card'. A tier where a third of the corpus matches equally
//is not a ranking, it is a coin toss with extra steps.
//
//TF-IDF over STEMMED tokens fixes both halves at once. A stem that appears in
//most of the completion corpus ('card', 'select', 'or', 'collection') has an IDF
//near zero and contributes almost nothing; a stem that appears in two documents
//('epistemology', 'tweet', 'orphan') carries the match. The user did not type a
//rarer word by accident — they typed it because it identifies the thing.
//
//THE HOUSE IDIOM, REUSED RATHER THAN REINVENTED.
//
//  - Stemming and tokenization come from shared/nlp: `normalizedWords` then
//    `stemmedNormalizedWords`, the same pair the card pipeline runs before it
//    indexes anything, so 'updated'/'update'/'updating' collapse here exactly
//    the way they collapse in search. Stop words come from the same module's
//    STOP_WORDS table.
//  - The IDF formula is the one this codebase already uses everywhere —
//    `log10(N / (df + 1))` — documented in docs/visible-corpus-idf-design.md
//    and implemented in `calcIDFMapForCards` and `src/worker/idf-index.ts`.
//    A second spelling of "how rare is this term" is how two surfaces come to
//    disagree about what a word is worth.
//
//THE DOCUMENT SET IS THE COMPLETION CORPUS ITSELF. Each candidate — a filter,
//a family, a tag, a section, a person — contributes ONE document made of its
//name, its aliases and its description. That is the right corpus for the
//question being asked: rarity here should mean "rare among the things you could
//pick", not "rare among your cards". A word that is common in the cards but
//appears in exactly one filter's description is a perfect handle for that
//filter, and card-corpus IDF would say the opposite.
//
//COMPUTED ONCE PER CORPUS, NOT PER KEYSTROKE. The table is built from a list of
//documents and cached on that list's IDENTITY, which is stable while the
//selectors behind it are — so a session's worth of typing builds it once. A
//keystroke then costs one stem lookup per typed token per candidate, which is a
//map read.

import {
	STOP_WORDS,
	normalizedWords,
	stemmedNormalizedWords,
} from '../shared/nlp.js';

import {
	perfCount,
} from './perf.js';

//One candidate's searchable prose, as the table wants it.
export type CompletionDocument = {
	//The candidate id this document belongs to.
	id : string;
	//Name, aliases and description, already concatenated by the caller — the
	//caller is the only layer that knows which of those a given kind has.
	text : string;
};

export type CompletionIDFIndex = {
	//stem -> inverse document frequency.
	idf : Readonly<Record<string, number>>;
	//candidate id -> stem -> term frequency within that document.
	documents : Readonly<Record<string, Readonly<Record<string, number>>>>;
	//How many documents the table was built over. Named so a test can assert
	//the table saw what it was meant to see.
	documentCount : number;
};

//STEMS OF A STRING, the way the rest of the app stems, PAIRED WITH THE WORDS
//THEY CAME FROM. Stop words are dropped: they are the extreme case of the
//low-IDF problem, and dropping them keeps the table small as well as honest.
//
//The pairing exists so a row can say WHY it is here in the user's own word.
//'epistemolog' is what the matcher compares; 'epistemology' is what the person
//typed, and a row reading "matched epistemolog" looks like a bug rather than an
//explanation.
export const completionStemPairs = (text : string) : {word : string, stem : string}[] => {
	if (!text) return [];
	const normalized = normalizedWords(text);
	if (!normalized) return [];
	const words = normalized.split(' ');
	const stems = stemmedNormalizedWords(normalized).split(' ');
	const pairs : {word : string, stem : string}[] = [];
	for (const [index, stem] of stems.entries()) {
		if (!stem || STOP_WORDS[stem]) continue;
		pairs.push({word: words[index] || stem, stem});
	}
	return pairs;
};

export const completionStems = (text : string) : string[] =>
	completionStemPairs(text).map(pair => pair.stem);

const EMPTY_INDEX : CompletionIDFIndex = {idf: {}, documents: {}, documentCount: 0};

export const buildCompletionIDFIndex = (documents : readonly CompletionDocument[]) : CompletionIDFIndex => {
	if (!documents.length) return EMPTY_INDEX;
	const perDocument : Record<string, Record<string, number>> = {};
	const documentFrequency : Record<string, number> = {};
	for (const document of documents) {
		//A repeated id is one document, not two: the caller's vocabulary can
		//contain the same filter reached two ways, and counting it twice would
		//quietly halve the IDF of every word it contains.
		if (perDocument[document.id]) continue;
		const counts : Record<string, number> = {};
		for (const stem of completionStems(document.text)) {
			counts[stem] = (counts[stem] || 0) + 1;
		}
		perDocument[document.id] = counts;
		for (const stem of Object.keys(counts)) {
			documentFrequency[stem] = (documentFrequency[stem] || 0) + 1;
		}
	}
	const total = Object.keys(perDocument).length;
	const idf : Record<string, number> = {};
	for (const [stem, frequency] of Object.entries(documentFrequency)) {
		//The house formula. Clamped at zero: a stem in every document has
		//log10(N/(N+1)) < 0, and a NEGATIVE weight would make a candidate score
		//worse for containing a common word than for not containing it at all.
		idf[stem] = Math.max(0, Math.log10(total / (frequency + 1)));
	}
	return {idf, documents: perDocument, documentCount: total};
};

//THE SCORE FOR ONE CANDIDATE AGAINST ONE TYPED TOKEN: the summed TF-IDF of every
//stem of the token that the candidate's document contains. Zero can mean two
//different things and the caller must not confuse them — "no stem of the token
//is in this document" (no match) and "the stems that are in it are in most of
//the vocabulary too" (a match worth nothing). completionDescriptionMatchedWord
//is what answers the first question; this answers only the second.
//
//TF is the raw count, which is right at this scale: these documents are one to
//three sentences long, so a word appearing twice really is twice as much of what
//the document is about, and there is no length to normalize away.
export const completionDescriptionScore = (
	index : CompletionIDFIndex,
	candidateID : string,
	tokenStems : readonly string[]
) : number => {
	const document = index.documents[candidateID];
	if (!document) return 0;
	let score = 0;
	for (const stem of tokenStems) {
		const frequency = document[stem];
		if (!frequency) continue;
		score += frequency * (index.idf[stem] || 0);
	}
	return score;
};

//WHICH OF THE TYPED WORDS ACTUALLY LANDED, so a row can say why it is here. The
//rarest one, because that is the word doing the work — a row that matched
//'epistemology' and 'cards' should say epistemology. Reported in the WORD the
//user typed rather than in its stem.
//
//A non-empty answer is also what DECIDES the tier: the description tier fires on
//PRESENCE and ranks on TF-IDF. Those are deliberately two questions. A stem in
//most of the vocabulary weighs nothing, and weighing nothing must mean "ranks
//last within its tier", not "did not match" — a user who typed a common word and
//got an empty list would be told, wrongly, that the app has nothing about it.
//The tier below is where the guessing lives; this tier is still a real hit.
export const completionDescriptionMatchedWord = (
	index : CompletionIDFIndex,
	candidateID : string,
	tokenPairs : readonly {word : string, stem : string}[]
) : string => {
	const document = index.documents[candidateID];
	if (!document) return '';
	let best = '';
	let bestWeight = -1;
	for (const pair of tokenPairs) {
		if (!document[pair.stem]) continue;
		const weight = index.idf[pair.stem] || 0;
		if (weight > bestWeight) {
			bestWeight = weight;
			best = pair.word;
		}
	}
	return best;
};

//The table is expensive to build and its inputs change rarely, so it is cached
//on the identity of the document list. One entry: the composer has one
//vocabulary at a time, and a second slot would only ever hold the previous
//corpus.
let indexMemo : {documents : readonly CompletionDocument[], index : CompletionIDFIndex} | null = null;

export const completionIDFIndexFor = (documents : readonly CompletionDocument[]) : CompletionIDFIndex => {
	if (indexMemo && indexMemo.documents === documents) return indexMemo.index;
	//The counter that makes "computed once per corpus, not per keystroke"
	//CHECKABLE rather than merely promised. It was not true — see the document
	//memo's key in collection-completion-index.ts — and nothing said so.
	perfCount('completion-idf-index:build');
	const index = buildCompletionIDFIndex(documents);
	indexMemo = {documents, index};
	return index;
};

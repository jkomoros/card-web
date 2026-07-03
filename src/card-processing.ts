//Card processing (raw Card → ProcessedCard with an nlp shape) shared by the
//main thread's selectors and the corpus worker's query engine. Store-free and
//DOM-free on the fast path: cards with current stored nlp_tokens (validated
//via nlp_source_fingerprint) reconstruct their nlp runs from the stored
//tokens; only cards without valid stored NLP take the slow full-NLP path
//(which needs an HTML-capable document for content extraction).

import {
	TypedObject
} from '../shared/typed_object.js';

import {
	TEXT_FIELD_CONFIGURATION
} from '../shared/card_fields.js';

import {
	stemmedNormalizedWords,
	withoutStopWords,
	CURRENT_NLP_VERSION,
	nlpSourceFingerprintForCard
} from '../shared/nlp.js';

import {
	ProcessedRunInterface,
	CardFieldType
} from '../shared/types.js';

import {
	cardWithNormalizedTextProperties,
	processedRunsForCardField
} from './nlp.js';

import {
	backportFallbackTextMapForCard
} from './util.js';

import {
	perfCount
} from './perf.js';

import {
	Card,
	Cards,
	CardID,
	ProcessedCard,
	ProcessedCards
} from './types.js';

// Per-card processing cache keyed on the Card object reference. When a card
// is updated, a new Card object is created — the old one's cache entry
// becomes unreachable and is garbage-collected by WeakMap. When the cards map
// changes (any card update), we iterate all entries but only reprocess the
// cards whose object reference actually changed.
const _processedCardCache = new WeakMap<Card, ProcessedCard>();

//Shared frozen empties: with tens of thousands of processed cards, per-card
//empty object literals add up to real memory and GC pressure.
const EMPTY_FALLBACK_TEXT = Object.freeze({}) as ProcessedCard['fallbackText'];
const EMPTY_IMPORTANT_NGRAMS = Object.freeze({}) as ProcessedCard['importantNgrams'];
const EMPTY_SYNONYM_MAP = Object.freeze({}) as ProcessedCard['synonymMap'];

export const processCard = (card : Card, allCards : Cards) : ProcessedCard => {
	const cached = _processedCardCache.get(card);
	if (cached) return cached;

	perfCount('processCard:miss');

	const fallbackText = backportFallbackTextMapForCard(card, allCards) || EMPTY_FALLBACK_TEXT;

	let processed : ProcessedCard;
	if (card.nlp_tokens && card.nlp_version === CURRENT_NLP_VERSION && card.nlp_source_fingerprint === nlpSourceFingerprintForCard(card)) {
		// Fast path: use stored NLP tokens for ordinary fields while preserving
		// the full nlp shape expected by downstream semantic code.
		const nlp = Object.fromEntries(TypedObject.keys(TEXT_FIELD_CONFIGURATION).map(fieldName => [fieldName, []])) as unknown as {[field in CardFieldType]: ProcessedRunInterface[]};
		for (const [fieldName, storedRuns] of TypedObject.entries(card.nlp_tokens)) {
			if (storedRuns) {
				nlp[fieldName] = storedRuns.map(storedRun => {
					let cachedStemmed : string | undefined;
					let cachedWithoutStopWords : string | undefined;
					const getStemmed = () => {
						if (cachedStemmed === undefined) cachedStemmed = stemmedNormalizedWords(storedRun.normalized);
						return cachedStemmed;
					};
					return {
						normalized: storedRun.normalized,
						original: '',
						get stemmed() { return getStemmed(); },
						get withoutStopWords() {
							if (cachedWithoutStopWords === undefined) cachedWithoutStopWords = withoutStopWords(getStemmed());
							return cachedWithoutStopWords;
						},
						uppercaseRanges: storedRun.uppercaseRanges,
						get empty() { return storedRun.normalized === ''; }
					};
				});
			}
		}
		// Compute reference-derived fields locally so all-cards local search sees
		// the current raw-card reference state even when stored NLP was generated
		// before an inbound/outbound reference side effect.
		const cardWithFallback = {...card, fallbackText};
		nlp.references_info_inbound = processedRunsForCardField(cardWithFallback, 'references_info_inbound');
		nlp.non_link_references = processedRunsForCardField(cardWithFallback, 'non_link_references');
		nlp.concept_references = processedRunsForCardField(cardWithFallback, 'concept_references');
		processed = {
			...card,
			fallbackText,
			importantNgrams: EMPTY_IMPORTANT_NGRAMS,
			synonymMap: EMPTY_SYNONYM_MAP,
			nlp: nlp as ProcessedCard['nlp']
		} as ProcessedCard;
	} else {
		// Slow path: full NLP computation
		perfCount('processCard:slowPath');
		processed = cardWithNormalizedTextProperties(card, fallbackText, {}, {});
	}

	_processedCardCache.set(card, processed);
	return processed;
};

export const processCards = (rawCards : Cards) : ProcessedCards => {
	const result : ProcessedCards = {} as ProcessedCards;
	for (const [id, card] of Object.entries(rawCards) as [CardID, Card][]) {
		result[id] = processCard(card, rawCards);
	}
	return result;
};

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

//The corpus worker genuinely needs every processed card to build its indexes,
//so processCards above deliberately remains eager. The main thread is
//different: in worker-owned mode most consumers either look up one card by ID
//or expand the comparatively small list of IDs the worker returned. Eagerly
//materializing the whole 40k-card map on the first such lookup made a warm boot
//spend many seconds in one uninterruptible selector call.
//
//This proxy preserves the ordinary object surface. Direct property access is
//lazy, while Object.keys/values/entries, spread, and JSON serialization still
//enumerate the complete map and therefore produce the same result as
//processCards when a caller really needs the whole corpus.
const _lazyProcessedCardsCache = new WeakMap<Cards, ProcessedCards>();

export const lazyProcessCards = (rawCards : Cards) : ProcessedCards => {
	const cached = _lazyProcessedCardsCache.get(rawCards);
	if (cached) return cached;

	const target = {} as ProcessedCards;
	const result = new Proxy(target, {
		get: (_target, property, receiver) => {
			if (typeof property === 'string' && Object.prototype.hasOwnProperty.call(rawCards, property)) {
				return processCard(rawCards[property] as Card, rawCards);
			}
			return Reflect.get(target, property, receiver);
		},
		has: (_target, property) => Object.prototype.hasOwnProperty.call(rawCards, property) || Reflect.has(target, property),
		ownKeys: () => Reflect.ownKeys(rawCards),
		getOwnPropertyDescriptor: (_target, property) => {
			if (!Object.prototype.hasOwnProperty.call(rawCards, property)) return undefined;
			//An accessor descriptor keeps Object.keys cheap: it can inspect
			//enumerability without processing the card. Object.values/entries,
			//spread, and JSON subsequently perform [[Get]], which hits the trap.
			return {
				configurable: true,
				enumerable: true,
				get: () => typeof property === 'string'
					? processCard(rawCards[property] as Card, rawCards)
					: undefined,
			};
		},
	}) as ProcessedCards;

	_lazyProcessedCardsCache.set(rawCards, result);
	return result;
};

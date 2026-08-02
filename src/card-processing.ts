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
	ProcessedRunStorage,
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

//The stored-token fast path. It MUST be a class with prototype getters, not an
//object literal with accessors.
//
//Accessors declared in an object literal give EVERY INSTANCE its own
//AccessorPairs — the closures differ per run — and therefore its own
//DescriptorArray and its own hidden-class Map. A heap snapshot of a real
//session found 7.8M object shapes for ~3.5M objects and ~830MB of the 1,031MB
//heap in V8 hidden-class metadata, with 129,156 objects each named
//`get stemmed` / `get withoutStopWords` / `get empty` and 404,155 AccessorPairs
//— almost exactly three per run object. This is the DEFAULT path for every
//migrated card, so the optimization made the common case far more expensive in
//metadata than the slow path it replaced (nlp.ts's ProcessedRun, which is a
//class with plain fields and prototype getters, and shares one shape across
//all instances).
//
//Laziness is preserved — stemming is still deferred — but the memo lives in
//plain instance fields, so all instances share one hidden class. Every field is
//assigned in the constructor, in a fixed order, so there is exactly one shape
//rather than one per property-addition sequence.
class StoredProcessedRun implements ProcessedRunInterface {
	normalized : string;
	original : string;
	uppercaseRanges? : number[];
	_stemmed : string | undefined;
	_withoutStopWords : string | undefined;

	constructor(storedRun : ProcessedRunStorage) {
		this.normalized = storedRun.normalized;
		this.original = '';
		this.uppercaseRanges = storedRun.uppercaseRanges;
		this._stemmed = undefined;
		this._withoutStopWords = undefined;
	}

	get stemmed() : string {
		if (this._stemmed === undefined) this._stemmed = stemmedNormalizedWords(this.normalized);
		return this._stemmed;
	}

	get withoutStopWords() : string {
		if (this._withoutStopWords === undefined) this._withoutStopWords = withoutStopWords(this.stemmed);
		return this._withoutStopWords;
	}

	get empty() : boolean {
		return this.normalized === '';
	}
}

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
				nlp[fieldName] = storedRuns.map(storedRun => new StoredProcessedRun(storedRun));
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

//allCards defaults to rawCards but may be the full corpus when rawCards is a
//narrowed view (e.g. search-recall candidates): reference/fallback backport
//must always resolve against every card, both for correctness and because the
//per-card cache is shared — an entry backported against a partial map would
//poison later full-corpus consumers.
export const lazyProcessCards = (rawCards : Cards, allCards : Cards = rawCards) : ProcessedCards => {
	const cached = allCards === rawCards ? _lazyProcessedCardsCache.get(rawCards) : undefined;
	if (cached) return cached;

	const target = {} as ProcessedCards;
	const result = new Proxy(target, {
		get: (_target, property, receiver) => {
			if (typeof property === 'string' && Object.prototype.hasOwnProperty.call(rawCards, property)) {
				return processCard(rawCards[property] as Card, allCards);
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
					? processCard(rawCards[property] as Card, allCards)
					: undefined,
			};
		},
	}) as ProcessedCards;

	if (allCards === rawCards) _lazyProcessedCardsCache.set(rawCards, result);
	return result;
};

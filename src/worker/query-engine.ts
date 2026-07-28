//The worker-side query engine: maintains filter membership state by replaying
//the SAME reducer the main thread uses (so filter semantics can't drift),
//processes cards with the SAME shared card-processing fast path, and runs
//collections with the SAME CollectionDescription/Collection machinery. The
//only thing that differs from the main thread is where the work happens.
//
//DOM-free for cards with valid stored NLP tokens (the overwhelming majority);
//cards without them take the slow full-NLP path whose HTML extraction
//degrades gracefully without a document (fields extract to empty text), which
//can cause shadow divergence for exactly those cards — divergence logging
//makes them visible.
//
//Also runnable in Node for testing: no Firestore, no DOM, no store.

import collectionReducer from '../reducers/collection.js';

import {
	UPDATE_CARDS,
	REMOVE_CARDS,
	UPDATE_SECTIONS,
	UPDATE_TAGS,
	UPDATE_STARS,
	UPDATE_READS,
	UPDATE_READING_LIST,
	UPDATE_SERVER_IDF,
	SELECT_CARDS,
	SomeAction
} from '../actions.js';

import {
	INITIAL_STATE,
	CARD_FILTER_FUNCS,
	SELECTED_FILTER_NAME,
	QUERY_STRICT_FILTER_NAME
} from '../filters.js';

import {
	QUERY_FILTER_NAME
} from '../filter-constants.js';

import {
	normalizedWords,
	stemmedNormalizedWords,
	withoutStopWords,
	ngrams
} from '../../shared/nlp.js';

import {
	SearchIndex
} from './search-index.js';

import {
	CollectionDescription
} from '../collection_description.js';

import {
	lazyProcessCards
} from '../card-processing.js';

import {
	Fingerprint,
	FingerprintGenerator,
	conceptCardsFromCards,
	getConceptsFromConceptCards,
	synonymMap
} from '../nlp.js';

import {
	computeDefaultSet,
	makeEverythingSetFromCards
} from '../set-projections.js';

import {
	Cards,
	CardBooleanMap,
	CardID,
	Tags,
	ServerIDFData,
	CollectionState,
	CollectionConstructorArguments,
	ProcessedCard,
	SortExtra,
	Sections,
	CardSimilarityMap,
	Filters,
	ProcessedCards,
	SerializedDescriptionToCardList,
	Uid
} from '../types.js';

import {
	CollectionStateHydration
} from './worker-protocol.js';

export type RunCollectionOptions = {
	keyCardID? : CardID,
	uid? : Uid,
	randomSalt? : string,
	cardSimilarity? : CardSimilarityMap
};

//Tokenize a query string into the same space as nlp_search_tokens (stemmed,
//stop-word-free unigrams plus bigrams). Used for search-recall narrowing and
//by the worker's debug query API.
export const queryTokensForText = (text : string) : string[] => {
	const normalized = withoutStopWords(stemmedNormalizedWords(normalizedWords(text)));
	if (!normalized) return [];
	const unigrams = normalized.split(' ').filter(word => Boolean(word));
	return [...unigrams, ...ngrams(normalized, 2)];
};

//Above this fraction of the corpus, narrowing saves too little to justify the
//restricted-view bookkeeping; run the ordinary full path instead.
const RECALL_NARROWING_MAX_FRACTION = 0.75;

export type RunCollectionResult = {
	ids : CardID[],
	labels : string[],
	numCards : number,
	numStartCards : number,
	isFallback : boolean,
	preview : boolean,
	partialMatches : CardBooleanMap
};

export class QueryEngine {

	_cards : Cards;
	//Bumped whenever _cards actually changes. Memo guards compare this rather
	//than object identity, which a per-batch rebuild invalidated every time.
	_cardsVersion : number;
	//Bumped only when a change could alter the default/everything sets.
	_setsVersion : number;
	_collectionState : CollectionState;
	_sections : Sections;
	_tags : Tags;
	_serverIDF : ServerIDFData | null;
	_readingList : CardID[];
	_fallbacks : SerializedDescriptionToCardList;
	_startCards : SerializedDescriptionToCardList;

	//Identity-keyed memos so repeated runCollection calls don't redo
	//O(corpus) work when nothing changed.
	_processedForCards : number;
	_processedCards : ProcessedCards | null;
	_setsForCards : number;
	_setsForSections : Sections | null;
	_setsForReadingList : CardID[] | null;
	_sets : {[name : string] : CardID[]} | null;

	constructor() {
		this._cards = {};
		this._cardsVersion = 0;
		this._setsVersion = 0;
		this._collectionState = INITIAL_STATE;
		this._sections = {};
		this._tags = {};
		this._serverIDF = null;
		this._readingList = [];
		this._fallbacks = {};
		this._startCards = {};
		this._processedForCards = -1;
		this._processedCards = null;
		this._setsForCards = -1;
		this._setsForSections = null;
		this._setsForReadingList = null;
		this._sets = null;
	}

	get cardCount() : number {
		return Object.keys(this._cards).length;
	}

	//The engine's raw (stripped) card mirror — the backport source for
	//reference-derived recall tokens.
	get rawCards() : Cards {
		return this._cards;
	}

	//The main thread needs these exact maps for badges, counts, editing
	//fallbacks, and worker-failure fallback. The worker has already paid to
	//derive them while ingesting the prime, so hand them across rather than
	//running every card test over the 40k corpus a second time.
	cardDerivedFilters() : Filters {
		return Object.fromEntries(Object.keys(CARD_FILTER_FUNCS).map(name =>
			[name, this._collectionState.filters[name] || {}]
		)) as Filters;
	}

	hydrateCollectionState(hydration : CollectionStateHydration) : void {
		this._collectionState = INITIAL_STATE;
		//Rebuild card-derived filters from the corpus already held by this worker,
		//then layer the complete main-thread snapshot on top. Merely resetting
		//INITIAL_STATE would silently empty filters until every card changed again.
		this._collectionState = collectionReducer(this._collectionState, {type: UPDATE_CARDS, cards: this._cards, fetchType: 'published'});
		this._collectionState = collectionReducer(this._collectionState, {type: UPDATE_SECTIONS, sections: hydration.sections});
		this._collectionState = collectionReducer(this._collectionState, {type: UPDATE_TAGS, tags: hydration.tags});
		this._collectionState = collectionReducer(this._collectionState, {type: UPDATE_STARS, starsToAdd: hydration.starredCardIDs, starsToRemove: []});
		this._collectionState = collectionReducer(this._collectionState, {type: UPDATE_READS, readsToAdd: hydration.readCardIDs, readsToRemove: []});
		this._collectionState = collectionReducer(this._collectionState, {type: UPDATE_READING_LIST, list: hydration.readingList});
		this._collectionState = collectionReducer(this._collectionState, {type: SELECT_CARDS, cards: hydration.selectedCardIDs});
		this._sections = {...hydration.sections};
		this._tags = {...hydration.tags};
		this._serverIDF = hydration.serverIDF || null;
		this._readingList = [...hydration.readingList];
		this._setsForSections = null;
		this._setsForReadingList = null;
		this._sets = null;
		this._editingCard = null;
		this._editingCardSimilarity = null;
	}

	//Replays a forwarded (already whitelisted, wire-decoded) action through
	//the real collection reducer, plus engine-local raw-state tracking for
	//the pieces the reducer doesn't keep (sections map, reading list order).
	applyAction(action : SomeAction) : void {
		this._collectionState = collectionReducer(this._collectionState, action);
		if (action.type === UPDATE_SECTIONS) {
			this._sections = {...this._sections, ...action.sections};
		}
		if (action.type === UPDATE_TAGS) {
			this._tags = {...this._tags, ...action.tags};
		}
		if (action.type === UPDATE_SERVER_IDF) {
			this._serverIDF = action.serverIDF || null;
		}
		if (action.type === UPDATE_READING_LIST) {
			this._readingList = action.list;
		}
	}

	updateCards(cards : Cards, removedIDs : CardID[]) : void {
		//MUTATE IN PLACE, then bump a version. Rebuilding the whole ~40k map
		//per batch cost ~15-18ms of spread on its own AND changed _cards
		//identity, which invalidated four O(corpus) memos (processed cards,
		//the default/everything sets, the suggestion generator, tag
		//fingerprints) — about 55ms of fixed rework per batch even when a
		//single card changed. Consumers of the `rawCards` getter read it
		//synchronously and do not retain it across batches, so in-place
		//mutation is safe; memo guards now compare _cardsVersion.
		let changed = false;
		//The default/everything sets depend ONLY on membership, `sort_order`
		//and `section` (see computeDefaultSet and makeEverythingSetFromCards),
		//so an ordinary body/title/tags edit leaves both byte-identical.
		//Invalidating them on every content change meant a single-card save
		//paid two O(corpus) rebuilds for nothing. Track set-relevance
		//separately from content change.
		let setsChanged = false;
		for (const [id, card] of Object.entries(cards)) {
			const previous = this._cards[id];
			if (previous === card) continue;
			if (!previous || previous.sort_order !== card.sort_order || previous.section !== card.section) setsChanged = true;
			this._cards[id] = card;
			changed = true;
		}
		for (const id of removedIDs) {
			if (!(id in this._cards)) continue;
			delete this._cards[id];
			changed = true;
			setsChanged = true;
		}
		if (changed) this._cardsVersion++;
		if (setsChanged) this._setsVersion++;
		this._collectionState = collectionReducer(this._collectionState, {type: UPDATE_CARDS, cards, fetchType: 'published'});
		if (removedIDs.length) {
			this._collectionState = collectionReducer(this._collectionState, {type: REMOVE_CARDS, cardIDs: removedIDs});
		}
	}

	configureCollections(fallbacks : SerializedDescriptionToCardList, startCards : SerializedDescriptionToCardList) : void {
		this._fallbacks = fallbacks;
		this._startCards = startCards;
	}

	_ensureProcessedCards() {
		if (this._processedForCards === this._cardsVersion && this._processedCards) return this._processedCards;
		//Most collections start from a bounded set/filter and only need to
		//process the IDs that survive to filtering/sorting. The lazy view remains
		//fully enumerable for global query/concept filters, preserving exactness,
		//without making every ordinary 90-card subscription eagerly process 40k.
		this._processedCards = lazyProcessCards(this._cards);
		this._processedForCards = this._cardsVersion;
		return this._processedCards;
	}

	_ensureSets() {
		if (this._sets && this._setsForCards === this._setsVersion && this._setsForSections === this._sections && this._setsForReadingList === this._readingList) return this._sets;
		this._sets = {
			main: computeDefaultSet(this._sections, this._cards),
			everything: makeEverythingSetFromCards(this._cards),
			'reading-list': this._readingList,
		};
		this._setsForCards = this._setsVersion;
		this._setsForSections = this._sections;
		this._setsForReadingList = this._readingList;
		return this._sets;
	}

	//Mirrors selectFilters: base filter membership plus the synthetic
	//selected filter.
	_filters() : Filters {
		return {
			...this._collectionState.filters,
			[SELECTED_FILTER_NAME]: this._collectionState.selectedCards
		};
	}

	//The signed-in landing tab is the unfiltered everything set ordered by the
	//raw star_count field. Running that through lazyProcessCards needlessly
	//normalizes every card in the corpus before the first card can render. At
	//12k cards that dominates warm boot (~17s) even though this sort needs no
	//processed fields. Keep this deliberately narrow so every richer filter or
	//sort continues through the shared Collection implementation.
	_runRawStarsCollection(description : CollectionDescription) : RunCollectionResult | null {
		if (description.set !== 'everything' || description.filters.length || description.sort !== 'stars') return null;
		const sets = this._ensureSets();
		const baseIDs = sets.everything || [];
		const preLimitLength = baseIDs.length;
		const sourceIDs = preLimitLength ? baseIDs : (this._fallbacks[description.serialize()] || []);
		const sorted = [...sourceIDs].sort((left, right) =>
			(this._cards[right]?.star_count || 0) - (this._cards[left]?.star_count || 0)
		);
		if (description.sortReversed) sorted.reverse();
		let limited = sorted.slice(description.offset);
		if (description.limit) limited = limited.slice(0, description.limit);
		const startIDs = this._startCards[description.serialize()] || [];
		const ids = [...startIDs, ...limited];
		let numCards = preLimitLength - description.offset;
		if (description.limit) numCards = Math.min(numCards, description.limit);
		return {
			ids,
			labels: ids.map(() => ''),
			numCards,
			numStartCards: startIDs.length,
			isFallback: preLimitLength === 0,
			preview: false,
			partialMatches: {},
		};
	}

	//The card currently being edited on the main thread (normalized), plus
	//its content-derived similarity — threaded into every collection run so
	//similar-card filters reflect live editing content, exactly like the
	//main thread's selectCollectionConstructorArgumentsWithEditingCard.
	_editingCard : ProcessedCard | null = null;
	_editingCardSimilarity : SortExtra | null = null;

	//Search-recall narrowing: an inverted index over token-current cards plus
	//the set of cards that must ALWAYS be scanned (missing/stale tokens).
	//Configured by the worker only once its chunked build covers the whole
	//corpus; null means every query takes the full-scan path.
	_searchRecallIndex : SearchIndex | null = null;
	_searchRecallAlwaysScan : Set<CardID> | null = null;

	setSearchRecall(index : SearchIndex | null, alwaysScanIDs : Set<CardID> | null) : void {
		this._searchRecallIndex = index;
		this._searchRecallAlwaysScan = alwaysScanIDs;
	}

	get searchRecallEnabled() : boolean {
		return Boolean(this._searchRecallIndex);
	}

	//Recall must be a SUPERSET of every card that could score. cardScore
	//matches by SUBSTRING, so candidates come from substring containment over
	//indexed unigrams (see SearchIndex.substringCandidates — exact-token
	//union silently dropped mid-typing prefixes like 'zebr'), plus every
	//always-scan card plus this description's fallback/start cards (the
	//Collection maps those through `cards`).
	_narrowedUniverseForQuery(description : CollectionDescription) : Set<CardID> | null {
		if (!this._searchRecallIndex) return null;
		if (description.set !== 'everything') return null;
		const queryFilters = description.filters.filter(filterName =>
			filterName.startsWith(QUERY_FILTER_NAME + '/') || filterName.startsWith(QUERY_STRICT_FILTER_NAME + '/'));
		if (queryFilters.length !== 1) return null;
		//Filter shape is `<name>/<encodeURIComponent text>`; '/' inside the text
		//is percent-escaped, so the payload is exactly the second segment.
		const rawQueryString = queryFilters[0].split('/')[1] || '';
		const text = decodeURIComponent(rawQueryString).split('+').join(' ');
		const tokens = queryTokensForText(text);
		//Stop-word-only/empty queries have no index signal; full scan.
		if (!tokens.length) return null;
		//Unigram words only: a spaceless query word cannot span stemmed-word
		//boundaries, and bigram containment adds no recall beyond its words.
		const words = tokens.filter(token => token.indexOf(' ') < 0);
		if (!words.length) return null;
		const universe = this._searchRecallIndex.substringCandidates(words);
		if (this._searchRecallAlwaysScan) {
			for (const id of this._searchRecallAlwaysScan) universe.add(id);
		}
		if (universe.size >= this.cardCount * RECALL_NARROWING_MAX_FRACTION) return null;
		const serialized = description.serialize();
		for (const id of this._fallbacks[serialized] || []) universe.add(id);
		for (const id of this._startCards[serialized] || []) universe.add(id);
		return universe;
	}

	//Returns whether anything changed, so callers know to re-push
	//subscriptions.
	setEditingCard(card : ProcessedCard | null, similarity : SortExtra | null) : boolean {
		if (card === this._editingCard && similarity === this._editingCardSimilarity) return false;
		this._editingCard = card;
		this._editingCardSimilarity = similarity;
		return true;
	}

	get editingCard() : ProcessedCard | null {
		return this._editingCard;
	}

	get tags() : Tags {
		return this._tags;
	}

	//Memoized fingerprint machinery for tag suggestions. The generator is
	//keyed on card/IDF/concept identity; the per-tag fingerprints additionally
	//on tags identity. First build over the tagged subset of the corpus costs
	//real time (seconds without a server IDF) — but it runs on the WORKER
	//thread, which is the whole point: master computed this on the UI thread
	//and stalled it for seconds at production scale.
	_suggestGeneratorForCards = -1;
	_suggestGeneratorServerIDF : ServerIDFData | null = null;
	_suggestGenerator : FingerprintGenerator | null = null;
	_tagFingerprintsForTags : Tags | null = null;
	_tagFingerprintsForCards = -1;
	_tagFingerprints : {[tagID : string] : Fingerprint} | null = null;

	_ensureSuggestGenerator() : FingerprintGenerator {
		if (this._suggestGenerator && this._suggestGeneratorForCards === this._cardsVersion && this._suggestGeneratorServerIDF === this._serverIDF) return this._suggestGenerator;
		const processed = this._ensureProcessedCards();
		const conceptCards = conceptCardsFromCards(this._cards);
		const concepts = getConceptsFromConceptCards(conceptCards);
		const synonyms = synonymMap(this._cards);
		const idfMap = this._serverIDF && this._serverIDF.idf && typeof this._serverIDF.maxIDF === 'number'
			? {idf: this._serverIDF.idf, maxIDF: this._serverIDF.maxIDF}
			: null;
		this._suggestGenerator = new FingerprintGenerator(processed, undefined, undefined, idfMap, concepts, synonyms);
		this._suggestGeneratorForCards = this._cardsVersion;
		this._suggestGeneratorServerIDF = this._serverIDF;
		this._tagFingerprints = null;
		return this._suggestGenerator;
	}

	_ensureTagFingerprints() : {[tagID : string] : Fingerprint} {
		const generator = this._ensureSuggestGenerator();
		if (this._tagFingerprints && this._tagFingerprintsForTags === this._tags && this._tagFingerprintsForCards === this._cardsVersion) return this._tagFingerprints;
		const result : {[tagID : string] : Fingerprint} = {};
		for (const [tagID, tag] of Object.entries(this._tags)) {
			result[tagID] = generator.fingerprintForCardIDList(tag.cards || []);
		}
		this._tagFingerprints = result;
		this._tagFingerprintsForTags = this._tags;
		this._tagFingerprintsForCards = this._cardsVersion;
		return result;
	}

	//Mirrors the main thread's selectEditingCardSuggestedTags exactly: rank
	//tags by fingerprint overlap with the editing card, excluding tags the
	//card already has. Returns [] when there is no editing card mirrored in.
	suggestTags(count = 3) : CardID[] {
		const card = this._editingCard;
		if (!card || Object.keys(card).length === 0) return [];
		const tagFingerprints = this._ensureTagFingerprints();
		if (Object.keys(tagFingerprints).length === 0) return [];
		const generator = this._ensureSuggestGenerator();
		const cardFingerprint = generator.fingerprintForCardObj(card);
		const closestTags = generator.closestOverlappingItems('', cardFingerprint, tagFingerprints);
		if (closestTags.size === 0) return [];
		const excludeIDs = new Set(card.tags || []);
		const result : CardID[] = [];
		for (const tagID of closestTags.keys()) {
			if (excludeIDs.has(tagID)) continue;
			result.push(tagID);
			if (result.length >= count) break;
		}
		return result;
	}

	runCollection(serializedDescription : string, options : RunCollectionOptions = {}) : RunCollectionResult {
		const description = CollectionDescription.deserialize(serializedDescription);
		const rawStarsResult = this._runRawStarsCollection(description);
		if (rawStarsResult) return rawStarsResult;
		const universe = this._narrowedUniverseForQuery(description);
		let processed : ProcessedCards;
		let sets : {[name : string] : CardID[]};
		if (universe) {
			const restrictedRaw : Cards = {};
			for (const id of universe) {
				const card = this._cards[id];
				if (card) restrictedRaw[id] = card;
			}
			const fullSets = this._ensureSets();
			sets = {
				...fullSets,
				//Preserve the full set's relative order so tie-breaking and
				//labeling match the unnarrowed path bit-for-bit.
				everything: (fullSets.everything || []).filter(id => universe.has(id)),
			};
			//The full corpus stays the backport source so processed entries are
			//identical to (and shared with, via the per-card cache) the ones the
			//full-scan path would produce.
			processed = lazyProcessCards(restrictedRaw, this._cards);
		} else {
			processed = this._ensureProcessedCards();
			sets = this._ensureSets();
		}
		const args = {
			cards: processed,
			sets,
			filters: this._filters(),
			sections: this._sections,
			fallbacks: this._fallbacks,
			startCards: this._startCards,
			userID: options.uid || '',
			randomSalt: options.randomSalt || '',
			cardSimilarity: options.cardSimilarity || {},
			editingCard: this._editingCard || undefined,
			editingCardSimilarity: this._editingCardSimilarity || undefined,
			keyCardID: options.keyCardID || ''
		} as CollectionConstructorArguments;
		const collection = description.collection(args);
		return {
			ids: collection.finalSortedCards.map(card => card.id),
			labels: collection.finalLabels,
			numCards: collection.numCards,
			numStartCards: collection.numStartCards,
			isFallback: collection.isFallback,
			preview: collection.preview,
			partialMatches: collection.partialMatches
		};
	}
}

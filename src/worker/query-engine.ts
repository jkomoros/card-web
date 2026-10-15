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
	PENDING_IDF_MAP,
	getConceptsFromConceptCards,
	synonymMap
} from '../nlp.js';

import {
	computeDefaultSet,
	makeEverythingSetFromCards,
	updateEverythingSet,
	INCREMENTAL_EVERYTHING_SET_MAX_TOUCHED,
	existingCardsOnly
} from '../set-projections.js';

import {
	Cards,
	CardBooleanMap,
	CardID,
	Tags,
	IDFMap,
	CollectionState,
	CollectionConstructorArguments,
	ProcessedCard,
	SortExtra,
	Sections,
	CardSimilarityMap,
	Filters,
	ProcessedCards,
	SerializedDescriptionToCardList,
	Uid,
	StringCardMap,
	SynonymMap
} from '../types.js';

import {
	CollectionStateHydration
} from './worker-protocol.js';

import {
	generatedWorkingNotesTitle
} from '../working-notes-title-kernel.js';

import {deepEqual} from '../util.js';
import {perfCount} from '../perf.js';

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

const sameCardList = (a : CardID[], b : CardID[]) : boolean => {
	if (a === b) return true;
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
	return true;
};

export class QueryEngine {

	_cards : Cards;
	//Concept helpers memoize by map identity. Keep this subset immutable even
	//though the full corpus is mutated in place, and reuse enrichment maps
	//across ordinary edits so the per-card fingerprint cache survives saves.
	_conceptCards : Cards = {};
	_suggestConceptCards : Cards | null = null;
	_suggestConcepts : StringCardMap = {};
	_suggestSynonyms : SynonymMap = {};
	//Bumped whenever _cards actually changes. Memo guards compare this rather
	//than object identity, which a per-batch rebuild invalidated every time.
	_cardsVersion : number;
	//Bumped only when a change could alter the default/everything sets.
	_setsVersion : number;
	//The everything set carried forward incrementally by updateCards (see
	//updateEverythingSet): a full re-sort of the corpus per card save was
	//the worker's largest fixed cost on the Save→New path. Valid only while
	//_everythingSetVersion === _setsVersion; _ensureEverythingSet rebuilds
	//otherwise (first use, or a delta too large to carry).
	_everythingSet : CardID[] | null;
	_everythingSetVersion : number;
	//Full rebuilds so far (test/query-engine pins that a small batch carries
	//instead of rebuilding; a lazily rebuilt set would pass every result
	//check while paying the sort).
	_everythingSetRebuilds : number;
	_collectionState : CollectionState;
	_sections : Sections;
	_tags : Tags;
	//The frozen per-epoch map from the worker's IDF index (installed via
	//setIDFMap at each publication); null until the initial build publishes.
	_idfMap : IDFMap | null;
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
	_filtersForFilters : Filters | null;
	_filtersForSelected : CardBooleanMap | null;
	_cachedFilters : Filters | null;

	constructor() {
		this._cards = {};
		this._cardsVersion = 0;
		this._setsVersion = 0;
		this._everythingSet = null;
		this._everythingSetVersion = -1;
		this._everythingSetRebuilds = 0;
		this._collectionState = INITIAL_STATE;
		this._sections = {};
		this._tags = {};
		this._idfMap = null;
		this._readingList = [];
		this._fallbacks = {};
		this._startCards = {};
		this._processedForCards = -1;
		this._processedCards = null;
		this._setsForCards = -1;
		this._setsForSections = null;
		this._setsForReadingList = null;
		this._sets = null;
		//Guarded by identity of their inputs, so no explicit invalidation is
		//needed anywhere _collectionState is replaced.
		this._filtersForFilters = null;
		this._filtersForSelected = null;
		this._cachedFilters = null;
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
			//Mirror the main reducer: a complete delivery REPLACES, so a tag
			//deleted upstream leaves the engine too. Merging it kept dead tags
			//(and their fingerprints) in the worker forever.
			this._tags = action.complete ? {...action.tags} : {...this._tags, ...action.tags};
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
		let conceptsChanged = false;
		//The everything set's own delta: membership and sort_order only (a
		//section change moves a card in the main set, not here).
		const everythingDelta = {upserted: [] as CardID[], removed: [] as CardID[]};
		for (const [id, card] of Object.entries(cards)) {
			const previous = this._cards[id];
			if (previous === card) continue;
			if (previous?.card_type === 'concept' || card.card_type === 'concept') conceptsChanged = true;
			if (!previous || previous.sort_order !== card.sort_order) everythingDelta.upserted.push(id);
			if (!previous || previous.sort_order !== card.sort_order || previous.section !== card.section) setsChanged = true;
			this._cards[id] = card;
			this._markTagsDirtyForCard(id);
			this._noteSimilarityCardChanged(id, false);
			changed = true;
		}
		for (const id of removedIDs) {
			if (!(id in this._cards)) continue;
			if (this._cards[id].card_type === 'concept') conceptsChanged = true;
			this._markTagsDirtyForCard(id);
			this._noteSimilarityCardChanged(id, true);
			delete this._cards[id];
			changed = true;
			setsChanged = true;
			everythingDelta.removed.push(id);
		}
		if (changed) this._cardsVersion++;
		//Preserve corpus iteration order: duplicate titles use the last card.
		//Appending a newly promoted concept to an incremental subset would
		//change that winner compared with a fresh load of the same corpus.
		if (conceptsChanged) this._conceptCards = Object.fromEntries(Object.entries(this._cards).filter(([, card]) => card.card_type === 'concept'));
		if (setsChanged) {
			//Carry the everything set across this batch while it is current
			//and the batch is small. A big batch (a cold-sweep page) leaves it
			//stale to be rebuilt lazily on the next use, as before — carrying
			//eagerly would sort the corpus per page whether or not a
			//collection runs in between.
			const touched = everythingDelta.upserted.length + everythingDelta.removed.length;
			const carried = this._everythingSet && this._everythingSetVersion === this._setsVersion && touched <= INCREMENTAL_EVERYTHING_SET_MAX_TOUCHED
				? updateEverythingSet(this._everythingSet, this._cards, everythingDelta)
				: null;
			this._setsVersion++;
			if (carried) {
				this._everythingSet = carried;
				this._everythingSetVersion = this._setsVersion;
			}
		}
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

	_ensureEverythingSet() : CardID[] {
		if (this._everythingSet && this._everythingSetVersion === this._setsVersion) return this._everythingSet;
		this._everythingSetRebuilds++;
		this._everythingSet = makeEverythingSetFromCards(this._cards);
		this._everythingSetVersion = this._setsVersion;
		return this._everythingSet;
	}

	_ensureSets() {
		if (this._sets && this._setsForCards === this._setsVersion && this._setsForSections === this._sections && this._setsForReadingList === this._readingList) return this._sets;
		this._sets = {
			main: computeDefaultSet(this._sections, this._cards),
			everything: this._ensureEverythingSet(),
			//Gated like the other sets (#752): a stored reading-list entry
			//can outlive its card, and counting it while rendering drops it
			//made /c/reading-list/ claim more cards than it shows.
			'reading-list': existingCardsOnly(this._readingList, this._cards),
		};
		this._setsForCards = this._setsVersion;
		this._setsForSections = this._sections;
		this._setsForReadingList = this._readingList;
		return this._sets;
	}

	//Mirrors selectFilters: base filter membership plus the synthetic
	//selected filter.
	//
	//The IDENTITY of what this returns matters, not just its value. It is the
	//first argument to makeExtrasForFilterFunc, which memoizes on ===, and the
	//resulting `extras` object is in turn the cache key for the
	//configurable-filter memo (#736). This used to return a fresh object
	//literal on every call, so `extras` was fresh on every runCollection and
	//that memo could never hit — on the worker-served path, which is the
	//DEFAULT and the entire case #736 is about. Enabling the memo without
	//fixing this would have been pure bookkeeping.
	_filters() : Filters {
		const filters = this._collectionState.filters;
		const selected = this._collectionState.selectedCards;
		if (!this._cachedFilters || this._filtersForFilters !== filters || this._filtersForSelected !== selected) {
			this._cachedFilters = {
				...filters,
				[SELECTED_FILTER_NAME]: selected
			};
			this._filtersForFilters = filters;
			this._filtersForSelected = selected;
		}
		return this._cachedFilters;
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

	//Installed by the worker at every epoch publication (and cleared with
	//null on a scope/generation reset). The engine deliberately consumes the
	//SAME frozen published map the main thread receives, so worker-served
	//suggestions and main-thread word clouds agree within an epoch.
	setIDFMap(idfMap : IDFMap | null) : void {
		this._idfMap = idfMap;
	}

	get idfMap() : IDFMap | null {
		return this._idfMap;
	}

	//The map every engine consumer scores with: the frozen epoch map, or the
	//pending-empty convention (TF-only ranking) before the initial build
	//publishes. NEVER null — null would make FingerprintGenerator run a
	//synchronous whole-corpus IDF build, exactly the stall the worker index
	//exists to remove.
	_effectiveIDFMap() : IDFMap {
		return this._idfMap || PENDING_IDF_MAP;
	}

	//The working-notes display title for one card, over the same enriched
	//generator (corpus IDF, concepts, synonyms) tag suggestions use — the
	//viewer's own inputs, since this worker's corpus is the viewer's. Null
	//for anything but an untitled working-notes card.
	generatedDisplayTitle(id : CardID) : string | null {
		const card = this._ensureProcessedCards()[id];
		if (!card || card.card_type !== 'working-notes' || card.title) return null;
		return generatedWorkingNotesTitle(card, this._ensureSuggestGenerator());
	}

	//Memoized fingerprint machinery for tag suggestions. The generator is
	//keyed on card/IDF/concept identity; the per-tag fingerprints additionally
	//on tags identity. It runs on the WORKER thread, which is the whole point:
	//master computed this on the UI thread and stalled it for seconds at
	//production scale.
	_suggestGeneratorForCards = -1;
	_suggestGeneratorIDFMap : IDFMap | null = null;
	_suggestGenerator : FingerprintGenerator | null = null;
	_tagFingerprintsForTags : Tags | null = null;
	_tagFingerprintsForCards = -1;
	_tagFingerprints : {[tagID : string] : Fingerprint} | null = null;
	//Per-tag combined fingerprints survive card changes that cannot affect
	//them. A tag's fingerprint sorts the union vocabulary of every member
	//card, so rebuilding EVERY tag after ANY card change (the previous
	//_cardsVersion guard) was the dominant per-edit cost at corpus scale:
	//7–8s of worker CPU per save at 30k cards, measured in a signed-in
	//profile, with the first edit after boot stalling the worker for over a
	//minute. A card change can only alter the fingerprints of tags that list
	//the card, so only those are recomputed. The worker's tags listener
	//delivers the COMPLETE map with fresh objects on every tag snapshot
	//(corpus-worker.ts attach(): "Every doc, not just the changed ones"), so
	//object identity never survives a tag write; the cache is keyed on the
	//contents of tag.cards, the only tag input a fingerprint depends on.
	_tagFingerprintCache : Map<string, {cards : CardID[], fingerprint : Fingerprint}> = new Map();
	_dirtyTagIDs : Set<string> = new Set();
	//Reverse index card → tags, derived from the SAME tag.cards lists the
	//fingerprints are built over (not card.tags, which can lag or disagree).
	_cardTagIndex : Map<CardID, string[]> | null = null;
	_cardTagIndexForTags : Tags | null = null;
	//The generator inputs the cache was built against; a new IDF epoch or a
	//concept/synonym change invalidates every tag.
	_tagFingerprintsGenerator : FingerprintGenerator | null = null;
	_tagFingerprintsIDFMap : IDFMap | null = null;
	_tagFingerprintsConcepts : StringCardMap | null = null;
	_tagFingerprintsSynonyms : SynonymMap | null = null;

	//The similar-cards fallback scores a key fingerprint against every
	//card's. Before this map existed each run called
	//FingerprintGenerator.fingerprints(), which enumerated all ~40k cards
	//through the lazy processing Proxy and built a fresh 40k-entry object
	//every time the corpus version changed. Measured on the real corpus that
	//rebuild is ~95ms per corpus change (per similar block), so the map is a
	//modest per-change saving; its real value is that it can be built in
	//idle slices after boot (warmSimilarityFingerprints) instead of as a
	//~9s synchronous pass on the first similar request. The engine owns one
	//map and updates only the cards that changed; the entries are the very
	//Fingerprint objects the filter's own generator would return (both are
	//un-enriched and fingerprintForCardObj memoizes per processed card
	//object), so results are identical. The map is rebuilt from scratch only
	//when the IDF epoch changes.
	_similarityFingerprints : {[id : string] : Fingerprint} | null = null;
	_similarityIDFMap : IDFMap | null = null;
	_similarityPending : Set<CardID> = new Set();
	_similarityRemoved : Set<CardID> = new Set();
	//Stable identity: filter memos key on it.
	_fingerprintsProvider = () : {[id : string] : Fingerprint} => this._ensureSimilarityFingerprints();

	_noteSimilarityCardChanged(id : CardID, removed : boolean) : void {
		if (!this._similarityFingerprints) return;
		if (removed) {
			this._similarityPending.delete(id);
			this._similarityRemoved.add(id);
		} else {
			this._similarityRemoved.delete(id);
			this._similarityPending.add(id);
		}
	}

	//Un-enriched and on the frozen epoch map: exactly what
	//filters.ts memoizedFingerprintGenerator builds, so the shared per-card
	//memo serves both. Cached per IDF map (the lazy proxy is stable and
	//reads cards live): constructing one per delta re-registered the shared
	//fingerprint cache under this generator's fresh `{}` concepts and evicted
	//the enriched suggestion generator's entry every time.
	_similarityGeneratorCache : FingerprintGenerator | null = null;
	_similarityGeneratorIDFMap : IDFMap | null = null;
	_similarityGenerator() : FingerprintGenerator {
		const idfMap = this._effectiveIDFMap();
		if (!this._similarityGeneratorCache || this._similarityGeneratorIDFMap !== idfMap) {
			this._similarityGeneratorCache = new FingerprintGenerator(this._ensureProcessedCards(), undefined, undefined, idfMap);
			this._similarityGeneratorIDFMap = idfMap;
		}
		return this._similarityGeneratorCache;
	}

	_resetSimilarityFingerprintsIfStale() : void {
		const idfMap = this._effectiveIDFMap();
		if (this._similarityFingerprints && this._similarityIDFMap === idfMap) return;
		this._similarityFingerprints = {};
		this._similarityIDFMap = idfMap;
		this._similarityRemoved.clear();
		this._similarityPending = new Set(Object.keys(this._cards));
	}

	//Applies pending work for up to budgetMs; returns true when nothing is
	//left. The budget is checked every 64 cards: performance.now() per card
	//would cost as much as the lookups it meters.
	_applySimilarityDelta(budgetMs : number) : boolean {
		const map = this._similarityFingerprints as {[id : string] : Fingerprint};
		for (const id of this._similarityRemoved) delete map[id];
		this._similarityRemoved.clear();
		if (!this._similarityPending.size) return true;
		const generator = this._similarityGenerator();
		const start = performance.now();
		let n = 0;
		for (const id of this._similarityPending) {
			this._similarityPending.delete(id);
			if (id in this._cards) map[id] = generator.fingerprintForCardID(id);
			else delete map[id];
			if ((++n & 63) === 0 && performance.now() - start >= budgetMs) return this._similarityPending.size === 0;
		}
		return true;
	}

	_ensureSimilarityFingerprints() : {[id : string] : Fingerprint} {
		this._resetSimilarityFingerprintsIfStale();
		if (this._similarityPending.size || this._similarityRemoved.size) this._applySimilarityDelta(Infinity);
		return this._similarityFingerprints as {[id : string] : Fingerprint};
	}

	//Builds the map in slices so the first similar-cards request after boot
	//does not stall the worker for the whole-corpus fingerprint pass. Stops
	//early when shouldContinue says so (reconnect, newer epoch); a later
	//_ensureSimilarityFingerprints finishes whatever is left synchronously.
	async warmSimilarityFingerprints(yieldFn : () => Promise<void>, shouldContinue : () => boolean, sliceMs = 12) : Promise<boolean> {
		this._resetSimilarityFingerprintsIfStale();
		while (!this._applySimilarityDelta(sliceMs)) {
			await yieldFn();
			if (!shouldContinue()) return false;
			//A new epoch mid-warm: start over on the new map.
			this._resetSimilarityFingerprintsIfStale();
		}
		return true;
	}

	//Warms the enriched per-card fingerprints of every tagged card and then
	//each tag's combined fingerprint, in slices, so suggestTags on the first
	//edit after boot finds everything cached (a single 2.6s worker task on
	//the real corpus otherwise, 5.6s before the ngram lookup change).
	async warmTagFingerprints(yieldFn : () => Promise<void>, shouldContinue : () => boolean, sliceMs = 12) : Promise<boolean> {
		//Re-taken after every yield: the suggestion generator is rebuilt on
		//any card change, and a live session sees arrivals during a warm-up.
		//The per-card memo is keyed on the processed card, so work done under
		//the previous generator is not lost.
		let generator = this._ensureSuggestGenerator();
		const seen = new Set<CardID>();
		let start = performance.now();
		for (const tag of Object.values(this._tags)) {
			for (const id of tag.cards || []) {
				if (seen.has(id)) continue;
				seen.add(id);
				generator.fingerprintForCardID(id);
				if ((seen.size & 63) === 0 && performance.now() - start >= sliceMs) {
					await yieldFn();
					if (!shouldContinue()) return false;
					generator = this._ensureSuggestGenerator();
					start = performance.now();
				}
			}
		}
		//One tag per slice. This is the coarse step: the combine over the
		//largest real tag (9k cards) is ~150ms in one go.
		for (const tagID of Object.keys(this._tags)) {
			this._ensureTagFingerprint(tagID);
			await yieldFn();
			if (!shouldContinue()) return false;
		}
		this._ensureTagFingerprints();
		return true;
	}

	_ensureCardTagIndex() : Map<CardID, string[]> {
		if (this._cardTagIndex && this._cardTagIndexForTags === this._tags) return this._cardTagIndex;
		const index = new Map<CardID, string[]>();
		for (const [tagID, tag] of Object.entries(this._tags)) {
			for (const cardID of tag.cards || []) {
				const existing = index.get(cardID);
				if (existing) existing.push(tagID);
				else index.set(cardID, [tagID]);
			}
		}
		this._cardTagIndex = index;
		this._cardTagIndexForTags = this._tags;
		return index;
	}

	_markTagsDirtyForCard(cardID : CardID) : void {
		//Nothing cached yet means nothing to invalidate; the first build
		//computes every tag anyway.
		if (this._tagFingerprintCache.size === 0) return;
		const tagIDs = this._ensureCardTagIndex().get(cardID);
		if (!tagIDs) return;
		for (const tagID of tagIDs) this._dirtyTagIDs.add(tagID);
	}

	_ensureSuggestGenerator() : FingerprintGenerator {
		const idfMap = this._effectiveIDFMap();
		if (this._suggestGenerator && this._suggestGeneratorForCards === this._cardsVersion && this._suggestGeneratorIDFMap === idfMap) return this._suggestGenerator;
		const processed = this._ensureProcessedCards();
		if (this._suggestConceptCards !== this._conceptCards) {
			this._suggestConcepts = getConceptsFromConceptCards(this._conceptCards);
			const synonyms = synonymMap(this._conceptCards);
			//Metadata-only concept edits must keep the same fingerprint cache
			//too. Concept extraction already preserves equal outputs; synonyms
			//need the same check because their helper always allocates a map.
			if (!deepEqual(synonyms, this._suggestSynonyms)) this._suggestSynonyms = synonyms;
			this._suggestConceptCards = this._conceptCards;
		}
		this._suggestGenerator = new FingerprintGenerator(processed, undefined, undefined, idfMap, this._suggestConcepts, this._suggestSynonyms);
		this._suggestGeneratorForCards = this._cardsVersion;
		this._suggestGeneratorIDFMap = idfMap;
		return this._suggestGenerator;
	}

	_ensureTagFingerprints() : {[tagID : string] : Fingerprint} {
		const generator = this._ensureSuggestGenerator();
		//The generator is rebuilt on a new IDF epoch (setIDFMap) without any
		//card or tag change, so the memo must key on it too.
		if (this._tagFingerprints && this._tagFingerprintsGenerator === generator && this._tagFingerprintsForTags === this._tags && this._tagFingerprintsForCards === this._cardsVersion) return this._tagFingerprints;
		this._tagFingerprintsGenerator = generator;
		this._syncTagFingerprintInputs(generator);
		const result : {[tagID : string] : Fingerprint} = {};
		const live = new Set<string>();
		for (const tagID of Object.keys(this._tags)) {
			live.add(tagID);
			result[tagID] = this._ensureTagFingerprint(tagID, generator);
		}
		for (const tagID of this._tagFingerprintCache.keys()) {
			if (!live.has(tagID)) this._tagFingerprintCache.delete(tagID);
		}
		this._dirtyTagIDs.clear();
		this._tagFingerprints = result;
		this._tagFingerprintsForTags = this._tags;
		this._tagFingerprintsForCards = this._cardsVersion;
		return result;
	}

	//A new IDF epoch or a concept/synonym change invalidates every cached tag.
	_syncTagFingerprintInputs(generator : FingerprintGenerator) : void {
		if (this._tagFingerprintsIDFMap === generator._idfMap &&
			this._tagFingerprintsConcepts === generator._concepts &&
			this._tagFingerprintsSynonyms === generator._synonyms) return;
		this._tagFingerprintCache.clear();
		this._dirtyTagIDs.clear();
		this._tagFingerprintsIDFMap = generator._idfMap;
		this._tagFingerprintsConcepts = generator._concepts;
		this._tagFingerprintsSynonyms = generator._synonyms;
	}

	//One tag's combined fingerprint, from the cache when its membership is
	//unchanged and no member card changed since.
	_ensureTagFingerprint(tagID : string, generator? : FingerprintGenerator) : Fingerprint {
		if (!generator) {
			generator = this._ensureSuggestGenerator();
			this._syncTagFingerprintInputs(generator);
		}
		const tag = this._tags[tagID];
		const cards = tag?.cards || [];
		const cached = this._tagFingerprintCache.get(tagID);
		if (cached && !this._dirtyTagIDs.has(tagID) && sameCardList(cached.cards, cards)) {
			//Adopt the newest array so the next comparison is by identity.
			cached.cards = cards;
			return cached.fingerprint;
		}
		perfCount('tagFingerprints:recompute');
		const fingerprint = generator.fingerprintForCardIDList(cards);
		this._tagFingerprintCache.set(tagID, {cards, fingerprint});
		this._dirtyTagIDs.delete(tagID);
		return fingerprint;
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
			//The engine mutates its cards map in place and serves ONE stable
			//proxy for its whole life, so content-sensitive memos must key on
			//this counter, never on the cards identity (#769 review: the
			//identity-keyed version served stale inverse-union results — a
			//newly-synced prioritized unpublished card was invisible to the
			//default sticky search filter until an unrelated membership
			//changed).
			cardsContentToken: this._cardsVersion,
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
			keyCardID: options.keyCardID || '',
			//The similar-cards fingerprint fallback scores with the same
			//frozen epoch map as everything else (TF-only via the pending
			//convention before the first publication).
			idfMap: this._effectiveIDFMap(),
			//...and matches over the engine's incrementally maintained map
			//(kept current across edits, unlike the memoized per-proxy
			//generator, which served the fingerprints of its first run until
			//the epoch rolled). A narrowed universe keeps the old path: it
			//fingerprints only the restricted map, built fresh per run, and a
			//whole-corpus map would cost more there, not less.
			fingerprintsProvider: universe ? null : this._fingerprintsProvider
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

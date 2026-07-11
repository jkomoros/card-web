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
	UPDATE_READING_LIST,
	SomeAction
} from '../actions.js';

import {
	INITIAL_STATE,
	SELECTED_FILTER_NAME
} from '../filters.js';

import {
	CollectionDescription
} from '../collection_description.js';

import {
	processCards
} from '../card-processing.js';

import {
	computeDefaultSet,
	makeEverythingSetFromCards
} from '../set-projections.js';

import {
	Cards,
	CardBooleanMap,
	CardID,
	CollectionState,
	CollectionConstructorArguments,
	ProcessedCard,
	SortExtra,
	Sections,
	CardSimilarityMap,
	Filters,
	SerializedDescriptionToCardList,
	Uid
} from '../types.js';

export type RunCollectionOptions = {
	keyCardID? : CardID,
	uid? : Uid,
	randomSalt? : string,
	cardSimilarity? : CardSimilarityMap
};

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
	_collectionState : CollectionState;
	_sections : Sections;
	_readingList : CardID[];
	_fallbacks : SerializedDescriptionToCardList;
	_startCards : SerializedDescriptionToCardList;

	//Identity-keyed memos so repeated runCollection calls don't redo
	//O(corpus) work when nothing changed.
	_processedForCards : Cards | null;
	_processedCards : ReturnType<typeof processCards> | null;
	_setsForCards : Cards | null;
	_setsForSections : Sections | null;
	_setsForReadingList : CardID[] | null;
	_sets : {[name : string] : CardID[]} | null;

	constructor() {
		this._cards = {};
		this._collectionState = INITIAL_STATE;
		this._sections = {};
		this._readingList = [];
		this._fallbacks = {};
		this._startCards = {};
		this._processedForCards = null;
		this._processedCards = null;
		this._setsForCards = null;
		this._setsForSections = null;
		this._setsForReadingList = null;
		this._sets = null;
	}

	get cardCount() : number {
		return Object.keys(this._cards).length;
	}

	//Replays a forwarded (already whitelisted, wire-decoded) action through
	//the real collection reducer, plus engine-local raw-state tracking for
	//the pieces the reducer doesn't keep (sections map, reading list order).
	applyAction(action : SomeAction) : void {
		this._collectionState = collectionReducer(this._collectionState, action);
		if (action.type === UPDATE_SECTIONS) {
			this._sections = {...this._sections, ...action.sections};
		}
		if (action.type === UPDATE_READING_LIST) {
			this._readingList = action.list;
		}
	}

	updateCards(cards : Cards, removedIDs : CardID[]) : void {
		const next = {...this._cards, ...cards};
		for (const id of removedIDs) delete next[id];
		this._cards = next;
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
		if (this._processedForCards === this._cards && this._processedCards) return this._processedCards;
		this._processedCards = processCards(this._cards);
		this._processedForCards = this._cards;
		return this._processedCards;
	}

	_ensureSets() {
		if (this._sets && this._setsForCards === this._cards && this._setsForSections === this._sections && this._setsForReadingList === this._readingList) return this._sets;
		this._sets = {
			main: computeDefaultSet(this._sections, this._cards),
			everything: makeEverythingSetFromCards(this._cards),
			'reading-list': this._readingList,
		};
		this._setsForCards = this._cards;
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

	//The card currently being edited on the main thread (normalized), plus
	//its content-derived similarity — threaded into every collection run so
	//similar-card filters reflect live editing content, exactly like the
	//main thread's selectCollectionConstructorArgumentsWithEditingCard.
	_editingCard : ProcessedCard | null = null;
	_editingCardSimilarity : SortExtra | null = null;

	//Returns whether anything changed, so callers know to re-push
	//subscriptions.
	setEditingCard(card : ProcessedCard | null, similarity : SortExtra | null) : boolean {
		if (card === this._editingCard && similarity === this._editingCardSimilarity) return false;
		this._editingCard = card;
		this._editingCardSimilarity = similarity;
		return true;
	}

	runCollection(serializedDescription : string, options : RunCollectionOptions = {}) : RunCollectionResult {
		const description = CollectionDescription.deserialize(serializedDescription);
		const processed = this._ensureProcessedCards();
		const sets = this._ensureSets();
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

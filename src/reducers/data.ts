import {
	UPDATE_CARDS,
	ENQUEUE_CARD_UPDATES,
	UPDATE_SECTIONS,
	UPDATE_TAGS,
	UPDATE_AUTHORS,
	UPDATE_TWEETS,
	REMOVE_CARDS,
	TWEETS_LOADING,
	MODIFY_CARD,
	MODIFY_CARD_SUCCESS,
	MODIFY_CARD_FAILURE,
	BULK_TAG_OPERATION_PROGRESS,
	REORDER_STATUS,
	EXPECT_NEW_CARD,
	EXPECTED_NEW_CARD_FAILED,
	NAVIGATED_TO_NEW_CARD,
	EXPECT_CARD_DELETIONS,
	COMMITTED_PENDING_FILTERS_WHEN_FULLY_LOADED,
	EXPECT_FETCHED_CARDS,
	SomeAction,
	UPDATE_CARD_SIMILARITY,
	UPDATE_WORKER_IDF,
	STOP_EXPECTING_FETCHED_CARDS,
	CLEAR_ENQUEUED_CARD_UPDATES,
	UPDATE_CORPUS_STATUS,
	UPDATE_CORPUS_DETAIL,
	UPDATE_PENDING_AUX_WRITE_COUNT,
} from '../actions.js';

import {
	UPDATE_COLLECTION_SHAPSHOT,
	UPDATE_CARD_META
} from '../actions.js';

import {
	DataState,
	CardID,
	Cards,
	CardSimilarityMap,
	Slug,
	State,
	SectionID
} from '../types.js';

import {
	TypedObject
} from '../../shared/typed_object.js';

//Removes only the similarity entries that mention one of the changed cards,
//either as the key card or within the ranked results. Preserves the map's
//identity when no entry is affected.
//Keep the most recently used similarity results only. Insertion order in a JS
//object is stable for string keys, so re-inserting on touch gives LRU order for
//free; 64 key cards is far more than any view needs (reference blocks fan out a
//handful per card) while keeping the worker payload small.
const MAX_CARD_SIMILARITY_ENTRIES = 64;

const boundedCardSimilarity = (previous : CardSimilarityMap, cardID : CardID, similarity : CardSimilarityMap[CardID]) : CardSimilarityMap => {
	const next : CardSimilarityMap = {};
	for (const [id, value] of Object.entries(previous)) {
		if (id === cardID) continue;
		next[id] = value;
	}
	next[cardID] = similarity;
	const keys = Object.keys(next);
	if (keys.length <= MAX_CARD_SIMILARITY_ENTRIES) return next;
	for (const id of keys.slice(0, keys.length - MAX_CARD_SIMILARITY_ENTRIES)) delete next[id];
	return next;
};

const pruneCardSimilarityByIDs = (similarity : CardSimilarityMap, changedIDs : CardID[]) : CardSimilarityMap => {
	if (changedIDs.length === 0) return similarity;
	const changedIDSet = new Set(changedIDs);
	const keysToDelete : CardID[] = [];
	for (const [keyCardID, scores] of TypedObject.entries(similarity)) {
		if (changedIDSet.has(keyCardID)) {
			keysToDelete.push(keyCardID);
			continue;
		}
		for (const id of Object.keys(scores)) {
			if (changedIDSet.has(id)) {
				keysToDelete.push(keyCardID);
				break;
			}
		}
	}
	if (keysToDelete.length === 0) return similarity;
	const result = {...similarity};
	for (const key of keysToDelete) delete result[key];
	return result;
};

const pruneCardSimilarity = (similarity : CardSimilarityMap, changedCards : Cards) : CardSimilarityMap =>
	pruneCardSimilarityByIDs(similarity, Object.keys(changedCards));

const INITIAL_STATE : DataState = {
	cards:{},
	authors:{},
	sections: {},
	tags: {},
	slugIndex: {},
	cardMeta: {},
	cardsSnapshot: {},
	tweetsLoading: false,
	tweets: {},
	//We start off saying that published cards are expected to be fetched.
	loadingCardFetchTypes: {
		published: true
	},
	corpusStatus: 'off',
	corpusStatusMessage: '',
	corpusSize: 0,
	corpusSnapshotAgeMs: null,
	expectedCorpusSize: null,
	corpusComplete: false,
	verifyDone: null,
	verifyTotal: null,
	pendingAuxWriteCount: 0,
	sectionsLoaded: false,
	tagsLoaded: false,
	alreadyCommittedModificationsWhenFullyLoaded: false,
	cardModificationError: null,
	pendingModifications: false,
	pendingModificationCount: 0,
	bulkTagOperationProgress: null,
	pendingNewCardID: '',
	pendingNewCardType: 'content',
	pendingNewCardIDToNavigateTo: '',
	pendingDeletions: {},
	pendingReorder: false,
	enqueuedCards: {},
	cardSimilarity: {},
	workerIDF: null
};

const app = (state: DataState = INITIAL_STATE, action : SomeAction) : DataState => {
	switch (action.type) {
	case UPDATE_CORPUS_STATUS:
		return {
			...state,
			corpusStatus: action.status,
			corpusStatusMessage: action.message,
		};
	case UPDATE_CORPUS_DETAIL:
		return {
			...state,
			corpusSize: action.corpusSize,
			corpusSnapshotAgeMs: action.snapshotAgeMs,
			expectedCorpusSize: action.expectedCorpusSize,
			corpusComplete: action.corpusComplete,
			verifyDone: action.verifyDone ?? null,
			verifyTotal: action.verifyTotal ?? null,
		};
	case UPDATE_PENDING_AUX_WRITE_COUNT:
		return {
			...state,
			pendingAuxWriteCount: action.count,
		};
	case EXPECT_NEW_CARD:
		//This means that although we may think we're fully loaded now, there's
		//a new card that was just added to database that firebase hasn't yet
		//told us about.
		if (!action.navigate) {
			return {
				...state,
				pendingNewCardID: action.ID,
				pendingNewCardType: action.cardType
			};
		}
		const newState : DataState = {
			...state,
			//by default we assume we need a section to load, but if it's a card
			//without a section, that won't happen.
			sectionsLoaded: action.noSectionChange ? true : false,
			pendingReorder: true,
			pendingNewCardID: action.ID,
			pendingNewCardIDToNavigateTo: action.ID,
			pendingNewCardType: action.cardType,
			//We'll be modifying them in the next few lines
			loadingCardFetchTypes: {...state.loadingCardFetchTypes}
		};
		newState.loadingCardFetchTypes[action.cardLoadingChannel] = true;
		return newState;
	case NAVIGATED_TO_NEW_CARD:
		return {
			...state,
			pendingReorder: false,
			pendingNewCardID: '',
			pendingNewCardType: 'content',
			pendingNewCardIDToNavigateTo: '',
		};
	case ENQUEUE_CARD_UPDATES:
		return {
			...state,
			enqueuedCards: {
				...state.enqueuedCards,
				[action.fetchType]: {
					...state.enqueuedCards[action.fetchType],
					...action.cards
				}
			}
		};
	case CLEAR_ENQUEUED_CARD_UPDATES:
		return {
			...state,
			enqueuedCards: {},
			pendingModificationCount: 0
		};
	case UPDATE_CARDS:
		const result = {
			...state,
			//Only actually change cards identity (which kicks of many
			//downstream recalculations) if the update actually has items. If it
			//doesn't, it's primarily about setting the flag down for loading of
			//a certain type.
			cards: Object.keys(action.cards).length ? {...state.cards, ...action.cards} : state.cards,
			slugIndex: {...state.slugIndex, ...extractSlugIndex(action.cards)},
		};
		result.loadingCardFetchTypes = {...state.loadingCardFetchTypes};
		if (result.loadingCardFetchTypes[action.fetchType]) delete result.loadingCardFetchTypes[action.fetchType];
		if (Object.keys(action.cards).some(key => key === state.pendingNewCardID)) {
			result.pendingNewCardID = '';
			result.pendingNewCardType = 'content';
		}
		//Similarity entries that mention a changed card are now invalid, but
		//unrelated entries (and the map's identity, if nothing matched) are
		//still good — resetting the whole map here used to force downstream
		//collection rebuilds on every single-card update.
		result.cardSimilarity = pruneCardSimilarity(state.cardSimilarity, action.cards);
		return result;
	case UPDATE_COLLECTION_SHAPSHOT:
		return {
			...state,
			cardsSnapshot: state.cards,
		};
	case UPDATE_CARD_META: {
		const cardMeta = {...state.cardMeta, ...action.metas};
		for (const id of action.removedIDs) delete cardMeta[id];
		return {
			...state,
			cardMeta,
		};
	}
	case REMOVE_CARDS:
		return removeCardIDs(action.cardIDs, state);
	case EXPECTED_NEW_CARD_FAILED:
		return {
			...state,
			pendingReorder: false,
			sectionsLoaded: true,
			loadingCardFetchTypes: {},
			pendingNewCardID: '',
			pendingNewCardType: 'content',
			pendingNewCardIDToNavigateTo: '',
		};
	case EXPECT_CARD_DELETIONS:
		return {
			...state,
			pendingDeletions: {...state.pendingDeletions, ...action.cards}
		};
	//MERGE for a partial (delta) delivery, REPLACE for a complete one. These used
	//to always merge, which was right when the main thread sent only changed
	//docs — but the worker sends the whole map, and a snapshot-primed entry that
	//the server no longer has could therefore never be removed by any later
	//delivery. A section deleted elsewhere reappeared in navigation on every
	//boot until a save happened to rewrite the record.
	case UPDATE_SECTIONS:
		return {
			...state,
			sections: action.complete ? {...action.sections} : {...state.sections, ...action.sections},
			sectionsLoaded: true,
		};
	case UPDATE_TAGS:
		return {
			...state,
			tags: action.complete ? {...action.tags} : {...state.tags, ...action.tags},
			tagsLoaded: true,
		};
	case UPDATE_AUTHORS:
		return {
			...state,
			authors: {...state.authors, ...action.authors},
		};
	case UPDATE_TWEETS:
		return {
			...state,
			tweets: {...state.tweets, ...action.tweets},
			tweetsLoading: false,
		};
	case TWEETS_LOADING:
		return {
			...state,
			tweetsLoading: action.loading,
		};
	case MODIFY_CARD:
		return {
			...state,
			pendingModifications: true,
			pendingModificationCount: action.modificationCount,
			cardModificationError: null,
		}; 
	case BULK_TAG_OPERATION_PROGRESS:
		return {
			...state,
			bulkTagOperationProgress: {
				total: action.total,
				completed: action.completed,
				tag: action.tag,
				adding: action.adding,
				description: action.description,
				serverConfirmed: action.serverConfirmed,
			},
		};
	case MODIFY_CARD_SUCCESS:
		return {
			...state,
			pendingModifications: false,
			//The commit has fully settled: every echo that will ever arrive
			//for it has already been enqueued or deduped away (echoes are
			//awaited before commit()). Zero the gate. An earlier revision
			//kept min(planned, modifiedCount), but dedupe silently drops
			//updated-only echoes (a tag sweep over cards that mostly already
			//have the tag), so the enqueued count could NEVER satisfy the
			//planned count and every subsequent listener delivery froze in
			//the queue.
			pendingModificationCount: 0,
			bulkTagOperationProgress: null,
		};
	case MODIFY_CARD_FAILURE:
		return {
			...state,
			pendingModifications: false,
			pendingModificationCount: 0,
			bulkTagOperationProgress: null,
			cardModificationError: action.error
		};
	case REORDER_STATUS:
		return {
			...state,
			pendingReorder: action.pending
		};
	case COMMITTED_PENDING_FILTERS_WHEN_FULLY_LOADED:
		return {
			...state,
			alreadyCommittedModificationsWhenFullyLoaded: true,
		};
	case EXPECT_FETCHED_CARDS:
		return {
			...state,
			loadingCardFetchTypes: {
				...state.loadingCardFetchTypes,
				[action.fetchType] : true
			},
			alreadyCommittedModificationsWhenFullyLoaded: false,
		};
	case STOP_EXPECTING_FETCHED_CARDS:
		const loading = {...state.loadingCardFetchTypes};
		delete loading[action.fetchType];
		return {
			...state,
			loadingCardFetchTypes: loading
		};
	case UPDATE_CARD_SIMILARITY:
		return {
			...state,
			//BOUNDED. Each entry holds up to DEFAULT_SIMLIAR_POINTS_LIMIT (500)
			//scores and one arrives per card visited, so browsing 200 cards
			//accumulated ~100,000 entries — which are then structured-cloned to
			//the worker on EVERY one-shot collection run and every subscription
			//(one per reference block per card). Master avoided this by wiping
			//the whole map on every UPDATE_CARDS; the surgical prune that
			//replaced it is better for churn but removed the only bound.
			cardSimilarity: boundedCardSimilarity(state.cardSimilarity, action.card_id, action.similarity)
		};
	case UPDATE_WORKER_IDF:
		return {
			...state,
			workerIDF: action.workerIDF
		};
	default:
		return state;
	}
};

//Returns a data subState that doesn't have the given cardIDs. If no
//modifications need to be made, it simply return subState, otherwise it will
//return a copy. cardIDs is an array of cardIDs to remove
const removeCardIDs = (cardIDs : CardID[], subState : DataState) : DataState => {
	const newCards = {...subState.cards};
	const newCardsSnapshot = {...subState.cardsSnapshot};
	const newSlugIndex = {...subState.slugIndex};
	const newExpectedDeletions = {...subState.pendingDeletions};
	const newCardMeta = {...subState.cardMeta};
	const newEnqueuedCards = Object.fromEntries(
		TypedObject.entries(subState.enqueuedCards).map(([fetchType, cards]) => [fetchType, {...cards}])
	) as DataState['enqueuedCards'];
	let changesMade = false;
	for (const id of cardIDs) {
		const cardToDelete = newCards[id];
		if (cardToDelete) {
			delete newCards[id];
			for (const slug of cardToDelete.slugs || []) delete newSlugIndex[slug];
			changesMade = true;
		}
		if (newCardsSnapshot[id]) { delete newCardsSnapshot[id]; changesMade = true; }
		if (newExpectedDeletions[id]) { delete newExpectedDeletions[id]; changesMade = true; }
		if (newCardMeta[id]) { delete newCardMeta[id]; changesMade = true; }
		for (const cards of Object.values(newEnqueuedCards)) {
			if (cards?.[id]) { delete cards[id]; changesMade = true; }
		}
	}
	const cardSimilarity = pruneCardSimilarityByIDs(subState.cardSimilarity, cardIDs);
	if (cardSimilarity !== subState.cardSimilarity) changesMade = true;
	if (!changesMade) return subState;
	return {
		...subState,
		cards: newCards,
		cardsSnapshot: newCardsSnapshot,
		slugIndex: newSlugIndex,
		pendingDeletions: newExpectedDeletions,
		cardMeta: newCardMeta,
		enqueuedCards: newEnqueuedCards,
		cardSimilarity,
		...(cardIDs.includes(subState.pendingNewCardID) ? {
			pendingNewCardID: '',
			pendingNewCardType: 'content' as const,
		} : {}),
		...(cardIDs.includes(subState.pendingNewCardIDToNavigateTo) ? {
			pendingNewCardIDToNavigateTo: '',
			pendingReorder: false,
		} : {}),
	};
};

const extractSlugIndex = (cards : Cards) : {[slug : Slug]: CardID} => {
	const result : {[slug : Slug]: CardID} = {};

	for (const cardID of TypedObject.keys(cards) as CardID[]) {
		const card = cards[cardID];
		const slugs = card.slugs;
		if (!slugs) continue;
		for (const val of slugs) {
			result[val] = cardID;
		}
	}

	return result;
};

export const sectionTitle = (state : State, sectionId : SectionID) : string => {
	const section = state.data.sections[sectionId];
	if (!section) return '';
	return section.title;
};

export default app;

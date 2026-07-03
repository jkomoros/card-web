//Typed message protocol between the main thread (corpus-bridge) and the
//corpus worker. Every message crossing the boundary is one of these
//discriminated unions, so both sides stay honest and debugging has one place
//to look.

import {
	Card,
	Cards,
	CardID,
	CardFetchType,
	CardSimilarityMap,
	SerializedDescriptionToCardList
} from '../types.js';

import {
	UPDATE_STARS,
	UPDATE_READS,
	UPDATE_READING_LIST,
	UPDATE_SECTIONS,
	UPDATE_TAGS,
	SELECT_CARDS,
	UNSELECT_CARDS,
	CLEAR_SELECTED_CARDS
} from '../actions.js';

//User-state actions forwarded verbatim (wire-encoded) from the main thread to
//the worker's query engine, which replays them through the real collection
//reducer. Card actions are NOT forwarded — the worker gets cards from its own
//Firestore listeners.
export const FORWARDED_ACTION_TYPES : {[actionType : string] : true} = {
	[UPDATE_STARS]: true,
	[UPDATE_READS]: true,
	[UPDATE_READING_LIST]: true,
	[UPDATE_SECTIONS]: true,
	[UPDATE_TAGS]: true,
	[SELECT_CARDS]: true,
	[UNSELECT_CARDS]: true,
	[CLEAR_SELECTED_CARDS]: true,
};

//A generation counter accompanies every worker→main message. The bridge bumps
//the generation on auth/permission changes and drops stale messages, so a
//teardown/reconnect can never interleave stale data.
export type WorkerGeneration = number;

//--------------------------------------------------------------------------
// Main thread → worker
//--------------------------------------------------------------------------

export type MainToWorkerMessage =
	//Boot the worker's Firebase app. devMode picks the dev/prod config; the
	//worker reads persisted auth credentials from IndexedDB (written by the
	//main thread's interactive sign-in).
	| {type: 'connect', generation: WorkerGeneration, devMode : boolean, mayViewUnpublished : boolean, uid : string}
	//Auth or permissions changed: tear down listeners, clear state, and
	//reconnect under the new generation.
	| {type: 'reconnect', generation: WorkerGeneration, mayViewUnpublished : boolean, uid : string}
	//Run a spike benchmark: build the index over everything loaded so far and
	//report timings.
	| {type: 'spike', generation: WorkerGeneration}
	//Recall query against the index.
	| {type: 'query', generation: WorkerGeneration, id : number, text : string}
	//A whitelisted user-state Redux action (wire-encoded), replayed through
	//the worker's collection reducer.
	| {type: 'action', generation: WorkerGeneration, action : unknown}
	//Tab-config fallbacks/startCards needed by the Collection machinery.
	| {type: 'configureCollections', generation: WorkerGeneration, fallbacks : SerializedDescriptionToCardList, startCards : SerializedDescriptionToCardList}
	//Run a collection in the worker for shadow comparison against the UI.
	| {type: 'shadowCollection', generation: WorkerGeneration, id : number, description : string, keyCardID : CardID | '', uid : string, randomSalt : string, cardSimilarity : CardSimilarityMap};

//--------------------------------------------------------------------------
// Worker → main thread
//--------------------------------------------------------------------------

export type CardBatch = {
	cards : Cards,
	removedIDs : CardID[],
	fetchType : CardFetchType,
	//True for deliveries that are expected to be redeliveries of cards the
	//main thread already holds (initial listener delivery after priming).
	fastDedupe : boolean
};

export type SpikeReport = {
	cardCount : number,
	tokenCount : number,
	indexedCardCount : number,
	//Cards indexed from stored nlp_search_tokens vs. skipped for lacking them.
	cardsWithStoredTokens : number,
	indexBuildMs : number,
	authUid : string | null,
	firestoreSource : 'cache' | 'server' | 'mixed' | 'unknown'
};

export type WorkerToMainMessage =
	| {type: 'ready', generation: WorkerGeneration}
	| {type: 'status', generation: WorkerGeneration, message : string}
	| {type: 'error', generation: WorkerGeneration, message : string}
	| {type: 'cards', generation: WorkerGeneration, batch : CardBatch}
	| {type: 'spikeReport', generation: WorkerGeneration, report : SpikeReport}
	| {type: 'queryResult', generation: WorkerGeneration, id : number, ids : CardID[], ms : number, fullScanFallback : boolean}
	| {type: 'shadowCollectionResult', generation: WorkerGeneration, id : number, ids : CardID[], labels : string[], numCards : number, isFallback : boolean, preview : boolean, ms : number};

//Tokens used for index recall for a single card: its stored search tokens if
//current, or empty if the card has none (those cards always go through the
//caller's full-scan fallback).
export const searchTokensForCard = (card : Card) : readonly string[] => {
	if (!card.nlp_search_tokens || !Array.isArray(card.nlp_search_tokens)) return [];
	return card.nlp_search_tokens;
};

//Typed message protocol between the main thread (corpus-bridge) and the
//corpus worker. Every message crossing the boundary is one of these
//discriminated unions, so both sides stay honest and debugging has one place
//to look.

import {
	Card,
	Cards,
	CardBooleanMap,
	CardID,
	CardFetchType,
	CardMeta,
	CardMetas,
	CardSimilarityMap,
	Filters,
	ProcessedCard,
	SerializedDescriptionToCardList,
	SortExtra,
	Sections,
	Tags
} from '../types.js';

//Increment this for a wire-incompatible change. Missing version means a
//pre-handshake worker/page (v0), which must be rejected: silently accepting it
//would skip authoritative collection hydration on a mixed cached build.
//4: per-user state (stars/reads/reading-list) moved into the worker, which is
//the only context holding Firestore's persistent cache and therefore the only
//one whose re-attach costs deltas rather than the whole result set.
//5: sections and tags moved into the worker, and the page REMOVED its
//main-thread fallback for them. A stale v4 worker against a v5 page would pass
//the old handshake, never send sections/tags, and wedge `*Loaded` silently —
//the quiet variant of exactly what an exact-match handshake exists to prevent.
//The bump costs nothing; not bumping cost a silent wedge.
//6: IDF moved into the worker (the visible-corpus map; see
//docs/visible-corpus-idf-design.md): new worker→main `idfMap` delivery, new
//main→worker `refreshIDF`, and the server-IDF plumbing REMOVED — hydration
//no longer carries the server map and the server-map action is no longer
//forwarded. A stale v5 worker against a v6 page would never deliver a map
//and would wait forever for hydration fields the page no longer sends.
//7: new worker→main `corpusProgress` message carrying the expected corpus
//total during a cold sweep, so the status indicator can show "12.4k of
//~40.2k" instead of a bare ticking count.
//8: `corpusProgress` fields became optional and gained `verifyDone`/
//`verifyTotal` — discrete verification-checkpoint progress for the
//loadComplete→live window (trust-gate partition counts, tombstone catch-up,
//per-plane health, the delta listener's first server delivery and the
//post-delta re-gate), so "Verifying…" can show a fraction instead of an
//opaque wait. The expected total is now also sent for a compact-snapshot
//prime, giving warm boots a real download fraction.
export const CORPUS_WORKER_PROTOCOL_VERSION = 8;
export const LEGACY_CORPUS_WORKER_PROTOCOL_VERSION = 0;

export const corpusWorkerProtocolVersion = (value : unknown) : number =>
	typeof value === 'number' ? value : LEGACY_CORPUS_WORKER_PROTOCOL_VERSION;

export const corpusWorkerProtocolCompatible = (value : unknown) : boolean =>
	corpusWorkerProtocolVersion(value) === CORPUS_WORKER_PROTOCOL_VERSION;

//Extracts the compact metadata the main thread keeps for every card.
export const metaForCard = (card : Card) : CardMeta => ({
	id: card.id,
	name: card.name,
	title: card.title || '',
	card_type: card.card_type,
	section: card.section,
	tags: card.tags || [],
	slugs: card.slugs || [],
	published: Boolean(card.published),
	sort_order: card.sort_order,
	author: card.author,
	collaborators: card.collaborators || [],
});

export const metasEquivalent = (a : CardMeta, b : CardMeta) : boolean => {
	if (a.name !== b.name || a.title !== b.title || a.card_type !== b.card_type || a.section !== b.section || a.published !== b.published || a.sort_order !== b.sort_order || a.author !== b.author) return false;
	if (a.tags.length !== b.tags.length || a.tags.some((tag, i) => tag !== b.tags[i])) return false;
	if (a.slugs.length !== b.slugs.length || a.slugs.some((slug, i) => slug !== b.slugs[i])) return false;
	if (a.collaborators.length !== b.collaborators.length || a.collaborators.some((uid, i) => uid !== b.collaborators[i])) return false;
	return true;
};

import {
	UPDATE_STARS,
	UPDATE_READS,
	UPDATE_READING_LIST,
	UPDATE_SECTIONS,
	UPDATE_TAGS,
	SELECT_CARDS,
	UNSELECT_CARDS,
	CLEAR_SELECTED_CARDS,
	ECHO_LOCAL_CARD_MODIFICATIONS,
	RECONCILE_CARDS_AFTER_FAILED_COMMIT
} from '../actions.js';

//User-state actions forwarded verbatim (wire-encoded) from the main thread to
//the worker's query engine, which replays them through the real collection
//reducer. Card actions are NOT forwarded — the worker gets cards from its own
//Firestore listeners. The one exception is ECHO_LOCAL_CARD_MODIFICATIONS: the
//just-committed card state, applied straight to the worker's corpus so it
//doesn't serve stale collections during the server-echo round trip (or while
//a dropped Listen stream is re-attaching).
export const FORWARDED_ACTION_TYPES : {[actionType : string] : true} = {
	[UPDATE_STARS]: true,
	[UPDATE_READS]: true,
	[UPDATE_READING_LIST]: true,
	[UPDATE_SECTIONS]: true,
	[UPDATE_TAGS]: true,
	[SELECT_CARDS]: true,
	[UNSELECT_CARDS]: true,
	[CLEAR_SELECTED_CARDS]: true,
	[ECHO_LOCAL_CARD_MODIFICATIONS]: true,
	[RECONCILE_CARDS_AFTER_FAILED_COMMIT]: true,
};

//A generation counter accompanies every worker→main message. The bridge bumps
//the generation on auth/permission changes and drops stale messages, so a
//teardown/reconnect can never interleave stale data.
export type WorkerGeneration = number;

export type CollectionStateHydration = {
	sections : Sections,
	tags : Tags,
	starredCardIDs : CardID[],
	readCardIDs : CardID[],
	readingList : CardID[],
	selectedCardIDs : CardID[]
};

//--------------------------------------------------------------------------
// Main thread → worker
//--------------------------------------------------------------------------

export type MainToWorkerMessage =
	//Boot the worker's Firebase app. devMode picks the dev/prod config; the
	//worker reads persisted auth credentials from IndexedDB (written by the
	//main thread's interactive sign-in).
	//persist: whether the worker should claim the PERSISTENT Firestore cache
	//(single-tab force-ownership — the only persistence mode the SDK supports
	//in a dedicated worker). Computed by the bridge (the worker has no
	//localStorage to read the mode itself): true only when the worker OWNS
	//ingestion, because in spike mode the main thread still holds the same
	//persistence DB and a force-owning worker would fight its lease — the
	//exact interference that broke app boot in the failed multi-tab
	//experiment.
	//syncMode: 'listen' = legacy full-corpus partitioned listeners;
	//'watermark' = the delta plane (docs/corpus-sync-design.md). Computed by
	//the bridge (no localStorage in workers).
	//emulatorTarget (PERF HARNESS ONLY, host:firestorePort e.g. `localhost:8089`)
	//is forwarded from the main thread's `firebase-emulator` localStorage flag —
	//the worker has no localStorage, so the bridge reads it and passes it here.
	//Absent (undefined) in every real dev/prod connection.
	//`ownsUserState`: whether THIS worker should run the stars/reads/reading-list
	//listeners. The page is the authority — it knows the corpus mode and whether
	//the session is anonymous — so the worker does not have to infer either.
	//Absent means false, which is the pre-v4 behaviour of not running them.
	| {type: 'connect', generation: WorkerGeneration, protocolVersion : number, devMode : boolean, persist : boolean, syncMode : 'listen' | 'watermark', mayViewUnpublished : boolean, uid : string, ownerID : string, ownershipEpoch : number, emulatorTarget? : string, purgePersistence? : boolean, ownsUserState? : boolean, ownsSupplementalData? : boolean}
	//Auth or permissions changed: tear down listeners, clear state, and
	//reconnect under the new generation.
	//`reconnect` MUST carry the ownership flags too. They used to travel only on
	//`connect`, and the worker kept its first-connect values for life — but the
	//first connect is almost always PRE-AUTH, when the session is not yet known
	//to be anonymous. So the flags latched against a state that no longer
	//applied: either the worker ran per-user listeners for an anonymous uid
	//(the billed reads that removing them was meant to avoid), or it never ran
	//them for a signed-in one.
	| {type: 'reconnect', generation: WorkerGeneration, mayViewUnpublished : boolean, uid : string, ownsUserState? : boolean, ownsSupplementalData? : boolean}
	//Run a spike benchmark: build the index over everything loaded so far and
	//report timings.
	| {type: 'spike', generation: WorkerGeneration}
	//Recall query against the index.
	| {type: 'query', generation: WorkerGeneration, id : number, text : string}
	//Compute suggested tags for the mirrored editing card (worker-side
	//fingerprinting; master ran this on the UI thread and stalled it).
	| {type: 'suggestTags', generation: WorkerGeneration, id : number, count : number}
	//A whitelisted user-state Redux action (wire-encoded), replayed through
	//the worker's collection reducer.
	| {type: 'action', generation: WorkerGeneration, action : unknown}
	//Replace the query engine's user/config state from one authoritative Redux
	//snapshot. Used on every activation/reconnect so handoff and auth changes
	//never depend on which incremental actions happened to be buffered here.
	//Wire-encoded because section/tag documents contain Firestore Timestamps.
	| {type: 'hydrateCollectionState', generation: WorkerGeneration, hydration : unknown}
	//Tab-config fallbacks/startCards needed by the Collection machinery.
	| {type: 'configureCollections', generation: WorkerGeneration, fallbacks : SerializedDescriptionToCardList, startCards : SerializedDescriptionToCardList}
	//Subscribe to live results for a collection description; the worker
	//pushes a collectionResult whenever the ordered result changes.
	| {type: 'subscribeCollection', generation: WorkerGeneration, subscriptionID : number, description : string, keyCardID : CardID | '', uid : string, randomSalt : string, cardSimilarity : CardSimilarityMap}
	| {type: 'unsubscribeCollection', generation: WorkerGeneration, subscriptionID : number}
	//One-shot collection run (e.g. the active card's reference blocks).
	| {type: 'runCollection', generation: WorkerGeneration, id : number, description : string, keyCardID : CardID | '', uid : string, randomSalt : string, cardSimilarity : CardSimilarityMap}
	//The live editing card (normalized on the main thread) and its
	//content-derived similarity, mirrored so collection runs reflect unsaved
	//content — null card when editing ends.
	| {type: 'setEditingCard', generation: WorkerGeneration, card : ProcessedCard | null, similarity : SortExtra | null}
	//Ask for the full set of card IDs in the worker's corpus, so the bridge
	//can reconcile away cards the local-cache prime served that no longer
	//exist (deleted while the app was closed — the worker never saw them, so
	//it can never send a removal for them).
	| {type: 'requestCorpusIDs', generation: WorkerGeneration}
	//PERF HARNESS ONLY: snapshot the worker's per-label timing accumulator
	//(request/response, mirroring the query path). perfMiddleware only sees the
	//MAIN-thread store, so in worker (on/shadow) modes the O(corpus) compute —
	//ingest, index build, collection runs/pushes, query — is otherwise invisible
	//and would make worker mode look artificially fast. See src/perf.ts.
	| {type: 'perfData', generation: WorkerGeneration, id : number}
	//PERF HARNESS ONLY: zero the accumulator (the harness resets before driving
	//the interaction script, then reads after — like DEBUG_PERF.reset()/data()).
	| {type: 'perfReset', generation: WorkerGeneration}
	//Console-API escape hatch: recount the IDF index from scratch and publish
	//a fresh epoch (the map is otherwise frozen per session; see
	//src/worker/idf-index.ts). Also heals accumulated ±1 cross-card
	//reference-vocabulary drift, which only a recount can.
	| {type: 'refreshIDF', generation: WorkerGeneration};

//--------------------------------------------------------------------------
// Worker → main thread
//--------------------------------------------------------------------------

export type CardBatch = {
	cards : Cards,
	//Present only on the final compact-prime batch. These are the worker's
	//complete card-derived filter maps for the same atomic corpus generation.
	cardFilters? : Filters,
	//Exact domain for cardFilters. Main Redux must already hold or receive
	//every one of these IDs and no extras before it may install the snapshot.
	cardFilterCorpusIDs? : CardID[],
	removedIDs : CardID[],
	fetchType : CardFetchType,
	//True for deliveries that are expected to be redeliveries of cards the
	//main thread already holds (initial listener delivery after priming).
	fastDedupe : boolean,
	//True for the empty batch forwarded when a listener ERRORS (so loading
	//indicators clear). Crucially it does NOT signify real data for the
	//fetchType — the bridge must not treat it as corpus-completeness
	//evidence (observed live: a quota outage error-forwarded every fetch
	//type, which would otherwise have declared an empty worker corpus
	//"ready" and let reconciliation remove every locally-primed card).
	errorFallback? : boolean,
	//The worker's corpus size AFTER applying this batch, so the bridge can
	//continuously judge whether the worker corpus is trustworthy relative to
	//what Redux holds (recovers readiness after an outage as re-attached
	//listeners refill the corpus).
	corpusSize : number
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

//PERF HARNESS ONLY: worker-scoped timing, shaped like src/perf.ts's actionStats
//({count, totalMs, maxMs} per label) so the harness can compute avg/max/p-values
//the same way for both threads. Labels are worker compute phases: 'ingest',
//'indexBuild', 'runCollection', 'collectionPush', 'query'.
export type WorkerActionStats = {[label : string] : {count : number, totalMs : number, maxMs : number}};

export type WorkerToMainMessage =
	| {type: 'ready', generation: WorkerGeneration, protocolVersion? : number}
	| {type: 'protocolMismatch', generation: WorkerGeneration, expectedProtocolVersion : number, receivedProtocolVersion : number}
	| {type: 'status', generation: WorkerGeneration, message : string}
	| {type: 'error', generation: WorkerGeneration, message : string}
	//`blocking: false` means the app remains fully usable — the page must NOT
	//put up the full-viewport lockout panel for it. A snapshot-persistence
	//failure is the motivating case: it only makes the NEXT boot slow.
	| {type: 'degraded', generation: WorkerGeneration, reason : string, blocking? : boolean}
	//Outcome of the signed-out Firestore cache purge. Only a CONFIRMED purge
	//clears the bridge's pending request, which makes "try again next boot" the
	//automatic retry policy rather than a separate mechanism.
	| {type: 'persistencePurge', generation : WorkerGeneration, result : 'purged' | 'blocked' | 'failed'}
	| {type: 'cards', generation: WorkerGeneration, batch : CardBatch}
	| {type: 'spikeReport', generation: WorkerGeneration, report : SpikeReport}
	| {type: 'queryResult', generation: WorkerGeneration, id : number, ids : CardID[], ms : number, fullScanFallback : boolean}
	//Worker-computed tag suggestions for the mirrored editing card.
	| {type: 'suggestTagsResult', generation: WorkerGeneration, id : number, tags : CardID[]}
	//Pushed whenever a subscribed collection's ordered result changes.
	| {type: 'collectionResult', generation: WorkerGeneration, subscriptionID : number, ids : CardID[], labels : string[], numCards : number, numStartCards : number, isFallback : boolean, preview : boolean, partialMatches : CardBooleanMap, ms : number}
	//Response to a one-shot runCollection. failed:true means the run threw —
	//the bridge resolves the pending promise with null so callers take their
	//local-fallback path instead of waiting forever on a reply that (before
	//this flag) never carried the request id.
	| {type: 'runCollectionResult', generation: WorkerGeneration, id : number, ids : CardID[], labels : string[], numCards : number, numStartCards : number, isFallback : boolean, preview : boolean, partialMatches : CardBooleanMap, ms : number, failed? : boolean}
	//Announced exactly once per (re)connect, when every fetch type the
	//connection parameters call for has had its initial delivery (or terminal
	//error): the worker's corpus is as complete as this connection can make
	//it. THE readiness signal — inferring completeness from per-batch
	//arrivals declared partial corpora ready (the first of five partition
	//flushes, or an offline worker's empty from-cache snapshots).
	//snapshotAgeMs is the age of the compact snapshot this session primed from,
	//or null when it primed from the server. It was computed and logged to the
	//console only, so a device that had been offline for weeks served a
	//months-old corpus with no staleness signal anywhere in the UI.
	| {type: 'loadComplete', generation: WorkerGeneration, corpusSize : number, snapshotAgeMs : number | null}
	//Sent when the worker learns roughly how many cards the finished corpus
	//will hold (at the start of a cold sweep, from the trust gate's
	//per-partition server count()s plus the published cards already in hand;
	//and at a compact-snapshot prime, where the primed count IS the total).
	//Approximate by construction — the published listener may still be
	//filling and writes can land mid-sweep — so the page renders it with a
	//'~'. null clears it (teardown/reconnect).
	//verifyDone/verifyTotal: discrete verification-checkpoint progress for
	//the window between loadComplete and live. The total is FIXED at connect
	//(partitions + a fixed phase count, per mode) and done is monotonic —
	//each named checkpoint latches once, so a re-run phase (repair, plane
	//re-heal) clamps rather than regresses. All fields are optional; a send
	//carries only the ones it is updating.
	| {type: 'corpusProgress', generation: WorkerGeneration, expectedCorpusSize? : number | null, verifyDone? : number, verifyTotal? : number}
	//Progress of the background search-recall build (find narrowing). `ready`
	//flips true exactly once per connection when the whole corpus is indexed.
	| {type: 'searchRecall', generation: WorkerGeneration, built : number, total : number, ready : boolean}
	//Delta-sync health: 'unverified' = serving a cache prime the trust gate
	//hasn't blessed yet (e.g. offline); 'live' = gate passed, listeners
	//healthy; 'stale' = corpus complete but the delta channel is erroring
	//(quota/outage) — content is correct as of the last delivery.
	| {type: 'syncState', generation: WorkerGeneration, state : 'unverified' | 'live' | 'stale'}
	//Per-user state. Deltas rather than whole sets, mirroring exactly what the
	//main thread's own listeners used to derive from docChanges().
	//`authoritative` marks a FULL re-delivery — the first snapshot after a
	//listener attaches, which Firestore reports as every document `added`. A
	//delta cannot express a removal in that case, so the page must REPLACE the
	//set rather than union into it. See receiveAuthoritative* in actions/user.
	| {type: 'userStars', generation: WorkerGeneration, added : CardID[], removed : CardID[], authoritative? : boolean}
	| {type: 'userReads', generation: WorkerGeneration, added : CardID[], removed : CardID[], authoritative? : boolean}
	| {type: 'userReadingList', generation: WorkerGeneration, list : CardID[]}
	//Sections and tags. Small (single figures and dozens), and sent WHOLE rather
	//than as deltas: the page merges them exactly as it did from its own
	//listener, and a full map removes any question of expressing a removal.
	| {type: 'sections', generation: WorkerGeneration, sections : {[id : string] : unknown}}
	| {type: 'tags', generation: WorkerGeneration, tags : {[id : string] : unknown}}
	//Delta-pushed compact per-card metadata (changed entries + removals).
	| {type: 'cardMeta', generation: WorkerGeneration, metas : CardMetas, removedIDs : CardID[]}
	//The worker's similar-card filters need server similarity for this card;
	//only the main thread can fetch it (see src/similarity-request.ts).
	//forEditingCard: the fetch is for live editing-card content; the main
	//thread resolves its own canonical editing card (the worker's copy is a
	//structured clone with dead Timestamp prototypes).
	| {type: 'requestSimilarity', generation: WorkerGeneration, cardID : CardID, forEditingCard? : boolean}
	//Response to requestCorpusIDs: every card ID currently in the corpus.
	| {type: 'corpusIDs', generation: WorkerGeneration, ids : CardID[]}
	//The worker-computed visible-corpus IDF map, delivered once per epoch
	//(after the initial sliced build; republished only on reconnect, >10%
	//corpus drift, or an explicit refreshIDF). idf is already df==1-trimmed;
	//cardCount is the body-card count it was materialized over and termCount
	//the shipped vocabulary size (diagnostics + drift bookkeeping).
	| {type: 'idfMap', generation: WorkerGeneration, epoch : number, cardCount : number, termCount : number, idf : {[word : string] : number}, maxIDF : number}
	//PERF HARNESS ONLY: response to perfData — the worker's timing snapshot.
	| {type: 'perfDataResult', generation: WorkerGeneration, id : number, actionStats : WorkerActionStats, indexBuildMs : number};

//Tokens used for index recall for a single card: its stored search tokens if
//current, or empty if the card has none (those cards always go through the
//caller's full-scan fallback).
export const searchTokensForCard = (card : Card) : readonly string[] => {
	if (!card.nlp_search_tokens || !Array.isArray(card.nlp_search_tokens)) return [];
	return card.nlp_search_tokens;
};

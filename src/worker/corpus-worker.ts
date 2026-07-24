//The corpus worker: owns a Firestore SDK instance and (eventually) the full
//card corpus + search index + query engine, keeping all O(corpus) work off
//the UI thread. See docs/fast-corpus-design-doc.md (Plan B) and
//docs/fast-corpus-implementation-log.md.
//
//IMPORTANT: this module must never import src/firebase.ts (it touches window
//at module load) or anything that assumes a DOM. It initializes its own
//Firebase app; auth comes from the credential the main thread persisted to
//IndexedDB during interactive sign-in.

import {
	initializeApp,
	FirebaseApp
} from 'firebase/app';

import {
	initializeFirestore,
	memoryLocalCache,
	persistentLocalCache,
	persistentSingleTabManager,
	CACHE_SIZE_UNLIMITED,
	getPersistentCacheIndexManager,
	enablePersistentCacheIndexAutoCreation,
	connectFirestoreEmulator,
	onSnapshot,
	getDocsFromServer,
	getDocsFromCache,
	getDocFromServer,
	getCountFromServer,
	query,
	collection,
	where,
	documentId,
	orderBy,
	startAfter,
	limit,
	doc,
	Firestore,
	Query,
	QuerySnapshot,
	Timestamp,
	QueryConstraint,
	terminate
} from 'firebase/firestore';

import {
	deriveWatermark,
	advanceWatermark,
	compareTimestamps,
	watermarkQueryBound,
	WireTimestamp
} from './watermark.js';

import {
	SyncMetaStore,
	SyncMeta
} from './sync-meta.js';

import {
	COLD_SWEEP_PAGE_SIZE,
	COLD_SWEEP_PRIORITY_COUNT,
	initialPaceState,
	concurrencyForPace,
	paceOnThrottle,
	paceOnCleanPage,
	throttleBackoffMs,
	isResourceExhausted
} from './cold-pace.js';

import {
	retryWithBackoff
} from './retry.js';

import {
	dropCardsAlreadyAtUpdatedVersion,
	dropCachedCardsNotNewerThanExisting
} from './fast-dedupe.js';

import {
	listenerDocumentTrusted
} from './listener-trust.js';

import {
	safePublishedRemovals,
	publishedGhostIDs
} from './published-removals.js';

import {
	initializeAuth,
	indexedDBLocalPersistence,
	connectAuthEmulator,
	Auth
} from 'firebase/auth';

import {
	FIREBASE_DEV_CONFIG,
	FIREBASE_PROD_CONFIG
} from '../config.GENERATED.SECRET.js';

import {
	normalizedWords,
	stemmedNormalizedWords,
	withoutStopWords,
	ngrams
} from '../../shared/nlp.js';

import {
	Card,
	Cards,
	CardID,
	CardFetchType,
	Filters
} from '../types.js';

import {
	MainToWorkerMessage,
	WorkerToMainMessage,
	WorkerActionStats,
	WorkerGeneration,
	searchTokensForCard,
	metaForCard,
	metasEquivalent,
	CORPUS_WORKER_PROTOCOL_VERSION,
	corpusWorkerProtocolCompatible,
	corpusWorkerProtocolVersion
} from './worker-protocol.js';

import {
	CardMetas
} from '../types.js';

import {
	SearchIndex
} from './search-index.js';

import {
	QueryEngine
} from './query-engine.js';

import {
	SubscriptionManager
} from './subscription-manager.js';

import {
	SomeAction,
	ECHO_LOCAL_CARD_MODIFICATIONS,
	RECONCILE_CARDS_AFTER_FAILED_COMMIT
} from '../actions.js';

import {
	setSimilarityRequestHandler
} from '../similarity-request.js';

import {
	UNPUBLISHED_CARD_PARTITIONS,
	UnpublishedCardPartition,
	partitionLabel
} from '../card-partitions.js';

import {
	TOMBSTONES_COLLECTION
} from '../../shared/collection-constants.js';

import {
	toWire,
	fromWire
} from './wire-format.js';

import {
	CorpusSnapshotStore
} from './corpus-snapshot.js';

//The name of the cards collection; mirrored from src/actions/database.ts
//(not imported: that module pulls in the store and DOM-touching deps).
const CARDS_COLLECTION = 'cards';

//Mirrored from src/actions/database.ts — permission key for editor listeners.
const PERMISSION_EDIT_CARD = 'editCard';

//How long ingestion batches accumulate before being flushed to the main
//thread during the initial load (mirrors A4's boot coalescing).
const COALESCE_INTERVAL_MS = 750;

//Narrow view of the dedicated-worker global scope, to avoid needing the
//"webworker" tsconfig lib (which conflicts with "dom" in the same program).
const workerScope = globalThis as unknown as {
	postMessage: (message : WorkerToMainMessage) => void,
	addEventListener: (type : 'message', listener : (event : {data : MainToWorkerMessage}) => void) => void,
	close: () => void,
};

let app : FirebaseApp | null = null;
let db : Firestore | null = null;
let auth : Auth | null = null;
let firebaseReady : Promise<void> | null = null;

let generation : WorkerGeneration = 0;
//Internal connection generation, bumped on every (re)connect to invalidate
//in-flight partition fetches (mirrors unpublishedConnectionGeneration).
let connectionGeneration = 0;

const corpus : Map<CardID, Card> = new Map();
let authoritativePublishedIDs : Set<CardID> | null = null;
let index = new SearchIndex();
//The compact snapshot already carries the server-generated search tokens, but
//rebuilding their inverted index eagerly costs several seconds on a 40k-card
//warm boot. Navigation, collections, editing, and saves do not consult this
//index, so defer that purely-derived work until the first search request. The
//worker event loop makes the rebuild atomic with respect to card deltas.
let searchIndexNeedsRebuild = false;
const engine = new QueryEngine();
//See the watermark invariant below. Kept next to corpus because the compact
//snapshot must persist and restore this set atomically with the cards.
const clientClockCardIDs : Set<CardID> = new Set();
const subscriptions = new SubscriptionManager(engine, push => {
	recordWorkerPerf('collectionPush', push.ms);
	send({
		type: 'collectionResult',
		generation,
		subscriptionID: push.subscriptionID,
		ids: push.ids,
		labels: push.labels,
		numCards: push.numCards,
		numStartCards: push.numStartCards,
		isFallback: push.isFallback,
		preview: push.preview,
		partialMatches: push.partialMatches,
		ms: push.ms
	});
});
let cardsWithStoredTokens = 0;
let indexBuildMs = 0;

const unsubscribes : (() => void)[] = [];

const send = (message : WorkerToMainMessage) => workerScope.postMessage(message);

const status = (message : string) => send({type: 'status', generation, message});

//PERF HARNESS ONLY: worker-scoped timing accumulator, mirroring src/perf.ts's
//actionStats shape ({count, totalMs, maxMs} per label). perfMiddleware wraps the
//MAIN-thread store only, so without this the worker's O(corpus) compute is
//invisible and worker mode looks artificially fast. Snapshotted via the
//`perfData` message, zeroed via `perfReset`. Default-off cost: a Map write per
//worker compute event, negligible relative to the work being timed.
let workerPerf : WorkerActionStats = {};
const recordWorkerPerf = (label : string, ms : number) => {
	const s = workerPerf[label] || (workerPerf[label] = {count: 0, totalMs: 0, maxMs: 0});
	s.count++;
	s.totalMs += ms;
	if (ms > s.maxMs) s.maxMs = ms;
};

const isTimestamp = (value : unknown) : boolean => value instanceof Timestamp;
const getTime = (timestamp : unknown) => {
	const ts = timestamp as Timestamp;
	return {seconds: ts.seconds, nanoseconds: ts.nanoseconds};
};

//Fields stored on the doc for server-side querying only; stripped before
//forwarding to the main thread (mirrors stripEphemeralCardFields in
//src/util.ts). The worker keeps the tokens for its own index first.
const stripForWire = (card : Card) : Card => {
	if (!('nlp_search_tokens' in card)) return card;
	const result = {...card};
	delete result.nlp_search_tokens;
	return result;
};

//Compact snapshot persistence is enabled only after the server trust gate and
//all three watermark planes are healthy. Until then the loaded snapshot is
//merely an unverified fast prime and must not overwrite the last known-good
//record. Subsequent edits are coalesced into a background atomic replacement.
const SNAPSHOT_SAVE_DELAY_MS = 15 * 1000;
let corpusSnapshotStore : CorpusSnapshotStore | null = null;
let corpusSnapshotPersistenceEnabled = false;
let corpusSnapshotSaveTimer : ReturnType<typeof setTimeout> | null = null;
let corpusSnapshotSaveInFlight = false;
let corpusSnapshotSavePending = false;
let ownershipEpochGuard : ReturnType<typeof setInterval> | null = null;

const saveCorpusSnapshot = async () : Promise<void> => {
	if (!corpusSnapshotPersistenceEnabled || !corpusSnapshotStore || !syncMetaState) return;
	if (corpusSnapshotSaveInFlight) {
		corpusSnapshotSavePending = true;
		return;
	}
	corpusSnapshotSaveInFlight = true;
	corpusSnapshotSavePending = false;
	const startedAt = performance.now();
	//Keep search tokens in this worker-only representation: rebuilding them
	//from content would erase most of the warm-boot win. Timestamp markers make
	//the record independent of Firestore prototype structured-cloning behavior.
	const cards = Object.fromEntries([...corpus.entries()].map(([id, card]) =>
		[id, toWire(card, isTimestamp, getTime)]));
	const contaminatedIDs = [...clientClockCardIDs].filter(id => corpus.has(id));
	//Capture every safety field synchronously with the cards, before the first
	//await. A later worker event may mutate live state, but the record remains a
	//coherent earlier checkpoint rather than cards from one instant plus bounds
	//from another.
	const processedTombstoneIDs = [...syncMetaState.processedTombstoneIDs];
	const tombstoneCursor = syncMetaState.tombstoneCursor ? {...syncMetaState.tombstoneCursor} : null;
	const watermarkClamp = syncMetaState.watermarkClamp ? {...syncMetaState.watermarkClamp} : null;
	try {
		await corpusSnapshotStore.save(cards, contaminatedIDs, processedTombstoneIDs, tombstoneCursor, watermarkClamp);
		status(`compact snapshot saved: ${Object.keys(cards).length} cards in ${(performance.now() - startedAt).toFixed(0)}ms`);
	} catch (e) {
		status(`compact snapshot save unavailable (${String(e)})`);
	} finally {
		corpusSnapshotSaveInFlight = false;
		if (corpusSnapshotSavePending) {
			corpusSnapshotSavePending = false;
			corpusSnapshotSaveTimer = setTimeout(() => {
				corpusSnapshotSaveTimer = null;
				void saveCorpusSnapshot();
			}, SNAPSHOT_SAVE_DELAY_MS);
		}
	}
};

const scheduleCorpusSnapshotSave = (delayMs = SNAPSHOT_SAVE_DELAY_MS) => {
	if (!corpusSnapshotPersistenceEnabled || !corpusSnapshotStore) return;
	if (corpusSnapshotSaveInFlight) {
		corpusSnapshotSavePending = true;
		return;
	}
	if (corpusSnapshotSaveTimer) clearTimeout(corpusSnapshotSaveTimer);
	corpusSnapshotSaveTimer = setTimeout(() => {
		corpusSnapshotSaveTimer = null;
		void saveCorpusSnapshot();
	}, delayMs);
};

const disableCorpusSnapshotPersistence = () => {
	corpusSnapshotPersistenceEnabled = false;
	corpusSnapshotSavePending = false;
	if (corpusSnapshotSaveTimer) clearTimeout(corpusSnapshotSaveTimer);
	corpusSnapshotSaveTimer = null;
	corpusSnapshotStore = null;
	if (ownershipEpochGuard) clearInterval(ownershipEpochGuard);
	ownershipEpochGuard = null;
};

const stopSupersededWorker = async (message : string) => {
	//Stop listeners first so no more application work is admitted, then ask
	//the Firebase SDK to close its streams and persistence handles before the
	//worker exits. This narrows the forced-takeover overlap to the ownership
	//poll interval and avoids relying on an abrupt worker close for cleanup.
	teardownListeners();
	disableCorpusSnapshotPersistence();
	status(message);
	const database = db;
	db = null;
	if (database) {
		try {
			await terminate(database);
		} catch (error) {
			status(`superseded worker Firestore shutdown reported ${String(error)}`);
		}
	}
	workerScope.close();
};

const parseSnapshot = (snapshot : QuerySnapshot) : {cards : Cards, removedIDs : CardID[]} => {
	const cards : Cards = {};
	const removedIDs : CardID[] = [];
	snapshot.docChanges().forEach(change => {
		if (change.type === 'removed') {
			removedIDs.push(change.doc.id);
			return;
		}
		const id : CardID = change.doc.id;
		const card : Card = {...change.doc.data({serverTimestamps: 'estimate'}), id} as Card;
		cards[id] = card;
	});
	return {cards, removedIDs};
};

const updateLocalState = (cards : Cards, removedIDs : CardID[], suppressMetaSend = false, deferSearchIndex = false) => {
	const indexStart = performance.now();
	if (deferSearchIndex) searchIndexNeedsRebuild = true;
	for (const [id, card] of Object.entries(cards)) {
		const previous = corpus.get(id);
		if (previous && searchTokensForCard(previous).length) cardsWithStoredTokens--;
		corpus.set(id, card);
		const tokens = searchTokensForCard(card);
		if (tokens.length) {
			cardsWithStoredTokens++;
			if (!searchIndexNeedsRebuild) index.updateCard(id, tokens);
		} else if (!searchIndexNeedsRebuild) {
			index.removeCard(id);
		}
	}
	for (const id of removedIDs) {
		corpus.delete(id);
		if (!searchIndexNeedsRebuild) index.removeCard(id);
	}
	//The engine keeps its own plain-object mirror (identity-preserving per
	//card) plus filter membership via the real reducer. Strip the ephemeral
	//search tokens just like main-thread Redux does, so processing and filter
	//behavior match exactly.
	engine.updateCards(Object.fromEntries(Object.entries(cards).map(([id, card]) => [id, stripForWire(card)])), removedIDs);
	subscriptions.markDirty();
	pushMetaDeltas(cards, removedIDs, suppressMetaSend);
	const indexElapsed = performance.now() - indexStart;
	indexBuildMs += indexElapsed;
	recordWorkerPerf('indexBuild', indexElapsed);
	scheduleCorpusSnapshotSave();
};

//The compact metadata already pushed to the main thread; only genuinely
//changed entries are re-pushed.
const pushedMetas : CardMetas = {};

const pushMetaDeltas = (cards : Cards, removedIDs : CardID[], suppressSend = false) => {
	const changed : CardMetas = {};
	for (const [id, card] of Object.entries(cards)) {
		const meta = metaForCard(card);
		const previous = pushedMetas[id];
		if (previous && metasEquivalent(previous, meta)) continue;
		pushedMetas[id] = meta;
		if (!suppressSend) changed[id] = meta;
	}
	const removed : CardID[] = [];
	for (const id of removedIDs) {
		if (!pushedMetas[id]) continue;
		delete pushedMetas[id];
		if (!suppressSend) removed.push(id);
	}
	//The compact warm prime is followed immediately (in the same worker turn)
	//by an atomic full-card handoff. Recording the metas keeps later deltas
	//correct, but sending and Redux-installing a second 40k-entry corpus first
	//only blocks the UI; card-link safely falls back to the full card map until
	//a genuinely changed meta arrives.
	if (suppressSend || (Object.keys(changed).length === 0 && removed.length === 0)) return;
	send({type: 'cardMeta', generation, metas: changed, removedIDs: removed});
};

const forwardBatch = (cards : Cards, removedIDs : CardID[], fetchType : CardFetchType, fastDedupe : boolean, errorFallback = false, cardFilters? : Filters, cardFilterCorpusIDs? : CardID[]) => {
	const wireCards = Object.fromEntries(Object.entries(cards).map(([id, card]) => [id, toWire(stripForWire(card), isTimestamp, getTime)])) as Cards;
	send({
		type: 'cards',
		generation,
		batch: {cards: wireCards, removedIDs, fetchType, fastDedupe, errorFallback, corpusSize: corpus.size, cardFilters, cardFilterCorpusIDs}
	});
};

//----------------------------------------------------------------------------
// Initial-load tracking
//
// The bridge must not serve collections (or reconcile) from this corpus
// until the initial load for the CURRENT connection parameters is done.
// Inferring that from per-batch arrivals was wrong twice over: the first of
// five partition flushes marked 'unpublished' delivered at ~20% corpus, and
// an offline worker's empty from-cache snapshots read as normal deliveries.
// Instead each connect declares which fetch types it will load, and
// loadComplete is announced exactly once when all have had their initial
// delivery (or terminal error — the corpusSize it carries lets the bridge
// judge an error-riddled load as untrustworthy).
//----------------------------------------------------------------------------

let initialLoadPending : Set<CardFetchType> | null = null;
let initialLoadConnectionGeneration = -1;

const expectInitialLoad = (fetchTypes : CardFetchType[]) => {
	initialLoadPending = new Set(fetchTypes);
	initialLoadConnectionGeneration = connectionGeneration;
};

const markInitialDelivered = (fetchType : CardFetchType) => {
	if (!initialLoadPending) return;
	if (initialLoadConnectionGeneration !== connectionGeneration) return;
	if (!initialLoadPending.delete(fetchType)) return;
	if (initialLoadPending.size) return;
	initialLoadPending = null;
	send({type: 'loadComplete', generation, corpusSize: corpus.size});
	status(`initial load complete: ${corpus.size} cards in corpus`);
};

//Ingests a snapshot: updates worker-local corpus/index and forwards the batch
//to the main thread. Empty batches are forwarded too — the main thread's
//UPDATE_CARDS clears loading indicators for the fetchType even with no cards,
//matching the behavior of a main-thread listener receiving an empty snapshot.
const ingestSnapshot = (snapshot : QuerySnapshot, fetchType : CardFetchType, fastDedupe = false) => {
	const start = performance.now();
	const parsed = parseSnapshot(snapshot);
	const cards = parsed.cards;
	const removedIDs = fetchType === 'published'
		? safePublishedRemovals(parsed.removedIDs, corpus)
		: parsed.removedIDs;
	//Server delivery: these entries are no longer client-clock contaminated.
	if (!snapshot.metadata.fromCache) {
		for (const id of Object.keys(cards)) clientClockCardIDs.delete(id);
		for (const id of removedIDs) clientClockCardIDs.delete(id);
	}
	//Initial listeners following an exact prime overwhelmingly redeliver the
	//same documents. `updated` is enforced on every persisted card mutation;
	//matching server timestamps therefore prove the worker already has this
	//version. Drop those cards before the search/filter engines instead of
	//re-running every derived predicate. The empty batch is still forwarded so
	//normal listener-completion semantics remain intact.
	if (snapshot.metadata.fromCache) dropCachedCardsNotNewerThanExisting(cards, corpus);
	else if (fastDedupe) dropCardsAlreadyAtUpdatedVersion(cards, corpus);
	updateLocalState(cards, removedIDs);
	const count = Object.keys(cards).length;
	forwardBatch(cards, removedIDs, fetchType, fastDedupe);
	//For the privileged 'unpublished' load, completion is marked explicitly
	//at the end of connectUnpublishedPrivileged (the prime, not the
	//listeners, defines done); marking here is idempotent and covers the
	//single-listener fetch types.
	markInitialDelivered(fetchType);
	const ingestElapsed = performance.now() - start;
	recordWorkerPerf('ingest', ingestElapsed);
	if (count || removedIDs.length) {
		status(`ingested ${count} cards (${removedIDs.length} removed, ${fetchType}) in ${ingestElapsed.toFixed(1)}ms; corpus=${corpus.size}`);
	}
};

//A listener that errors (e.g. permission denied for anonymous users on
//author/editor queries) will never deliver a snapshot; forward an empty batch
//so the main thread's loading indicators clear rather than spinning forever.
const listenerError = (fetchType : CardFetchType, context : string, errorCompletesInitialLoad = true) => (error : {message : string}) => {
	send({type: 'error', generation, message: `${context}: ${error.message}`});
	//errorFallback: clears loading indicators but is NOT evidence the worker
	//holds this fetchType's data.
	forwardBatch({}, [], fetchType, false, true);
	//A terminal error still resolves this fetch type's INITIAL load — the
	//loadComplete it may trigger carries the (small) corpusSize, which is
	//what tells the bridge not to trust the corpus for serving.
	if (errorCompletesInitialLoad) markInitialDelivered(fetchType);
};

const teardownListeners = () => {
	connectionGeneration++;
	for (const unsubscribe of unsubscribes) unsubscribe();
	unsubscribes.length = 0;
};

//Backoff for re-attaching snapshot listeners after an error. The SDK
//TERMINATES a listener whose error callback fires — it will never deliver
//again — and the worker's memory cache means there is no persistent-cache
//cushion hiding the outage. Without re-attachment a single backend blip
//(e.g. "datastore operation timed out", observed live on dev) would leave
//the worker serving a silently-incomplete corpus forever.
const LISTENER_RETRY_BASE_MS = 5000;
const LISTENER_RETRY_MAX_MS = 60000;

//Attaches a snapshot listener that re-attaches itself with backoff when it
//errors. listenerError still runs on each error (reporting + forwarding an
//empty batch so main-thread loading indicators clear); the re-attached
//listener's initial delivery then supplies the real data. makeHandler is
//called per attachment so per-attachment state (like the fastDedupe
//first-delivery flag) resets on re-attach.
const attachResilientListener = (
	context : string,
	fetchType : CardFetchType,
	makeQuery : () => Query,
	makeHandler : () => (snapshot : QuerySnapshot) => void,
	onError? : () => void,
	errorCompletesInitialLoad = true
) => {
	const myConnectionGeneration = connectionGeneration;
	let delay = LISTENER_RETRY_BASE_MS;
	const attach = () => {
		if (myConnectionGeneration !== connectionGeneration) return;
		const handler = makeHandler();
		unsubscribes.push(onSnapshot(
			makeQuery(),
			{includeMetadataChanges: true},
			snapshot => {
				delay = LISTENER_RETRY_BASE_MS;
				handler(snapshot);
			},
			error => {
				if (onError) onError();
				listenerError(fetchType, context, errorCompletesInitialLoad)(error);
				//permission-denied is terminal until auth changes, and auth
				//changes arrive as a reconnect (new generation → fresh
				//attach); retrying it would just spam empty batches.
				if ((error as {code? : string}).code === 'permission-denied') return;
				const thisDelay = delay;
				delay = Math.min(delay * 2, LISTENER_RETRY_MAX_MS);
				status(`${context} re-attaching in ${thisDelay / 1000}s`);
				setTimeout(attach, thisDelay);
			}
		));
	};
	attach();
};

//PERF HARNESS ONLY: the fixed demo project the emulator namespaces the seeded
//corpus under. Must match src/firebase.ts's PERF_EMULATOR_PROJECT_ID so the
//worker, the main thread, and the seeded corpus all share one emulator
//namespace (the Firestore emulator namespaces data by projectId).
const PERF_EMULATOR_PROJECT_ID = 'demo-perf';

const connectFirebase = (devMode : boolean, persist : boolean, emulatorTarget? : string) => {
	if (app) return;
	//PERF HARNESS ONLY: when the main thread forwards the `firebase-emulator`
	//flag (host:firestorePort, e.g. `localhost:8089`) in the connect message,
	//override projectId to the fixed demo project and point Firestore + Auth at
	//the local emulators — mirroring src/firebase.ts's own emulator branch. The
	//worker has no localStorage, so it cannot read the flag itself; the bridge
	//reads it and passes it here. DEFAULT OFF — an absent target is a complete
	//no-op, so real dev/prod worker connections are unaffected.
	const baseConfig = devMode ? FIREBASE_DEV_CONFIG : FIREBASE_PROD_CONFIG;
	const config = emulatorTarget ? {...baseConfig, projectId: PERF_EMULATOR_PROJECT_ID} : baseConfig;
	//IMPORTANT: the app must use the DEFAULT name. Auth persistence keys in
	//IndexedDB include the app name, so a custom-named app would read an
	//empty credential slot instead of the one the main thread's interactive
	//sign-in persisted (observed as permission-denied on unpublished reads).
	app = initializeApp(config);
	//The main thread signs in interactively and persists the credential to
	//IndexedDB; initializeAuth here picks it up and receives refreshes.
	auth = initializeAuth(app, {persistence: indexedDBLocalPersistence});
	//Point Firestore + Auth at the emulators once db is created (below).
	//connectFirestoreEmulator must run before the first Firestore operation, so
	//it is invoked immediately after each initializeFirestore call.
	//Transport: force long-polling against REAL Firestore (OOM avoidance with
	//long documents — issue #4416/#659). But against the perf EMULATOR, forced
	//long-polling shares ONE WebChannel transport across the partitioned getDocs
	//prime AND the delta listeners, and a 40k cold prime saturates it (observed:
	//'transport errored: Qd', HTTP 400, prime returns ~0 cards). Auto-detect lets
	//the SDK use the streaming transport against localhost, which handles the
	//load. Emulator-only; real connections are unchanged.
	const longPolling = emulatorTarget
		? {experimentalAutoDetectLongPolling: true}
		: {experimentalForceLongPolling: true};
	const hookEmulator = () => {
		if (!emulatorTarget || !db || !auth) return;
		try {
			const [emuHost, emuPort] = emulatorTarget.split(':');
			const host = emuHost || 'localhost';
			connectFirestoreEmulator(db, host, parseInt(emuPort || '8089', 10));
			connectAuthEmulator(auth, `http://${host}:9099`, {disableWarnings: true});
			status(`EMULATOR MODE (perf harness): project ${PERF_EMULATOR_PROJECT_ID}, firestore ${host}:${emuPort || '8089'}, auth ${host}:9099`);
		} catch (e) {
			send({type: 'error', generation, message: `emulator connect failed (${String(e)})`});
		}
	};
	//THE CACHE HANDOFF (the fix for ~40k billed reads per worker boot): when
	//the worker owns ingestion, it also owns the PERSISTENT cache —
	//single-tab with forceOwnership, the only persistence mode the SDK
	//supports in a dedicated worker (the multi-tab manager needs LocalStorage
	//and is `unimplemented` here; without forceOwnership the ownership lease
	//needs visibility/unload events a worker doesn't have). Safe because
	//src/firebase.ts steps the main thread down to a memory cache in worker
	//modes — exactly one client touches the persistence DB. The DB is the
	//same one the main thread's off-mode sessions populated (same default
	//app name), so the first persistent boot may already be warm, and
	//per-query resume tokens persisted across sessions make listener
	//re-attach bill ~deltas instead of the full result set.
	//
	//Persistence failures fall back to the memory cache: the boot works but
	//pays the full network load. A second tab never gets this far: the bridge's
	//Web Lock gate keeps it workerless until ownership is transferred.
	if (persist) {
		try {
			db = initializeFirestore(app, {
				...longPolling,
				//UNLIMITED: the default cache is 40MB with LRU garbage
				//collection — a 40-60k-card corpus (~240-480MB) gets mostly
				//evicted, silently turning every warm boot back into a cold
				//one (observed live: caches holding 1-5k of 39k cards).
				localCache: persistentLocalCache({
					tabManager: persistentSingleTabManager({forceOwnership: true}),
					cacheSizeBytes: CACHE_SIZE_UNLIMITED
				})
			});
			// Emulator settings must be applied before any Firestore API starts
			// this instance. Reading the index manager below counts as first use.
			hookEmulator();
			//Firestore does not build persistent local-query indexes unless an
			//application opts in. Without them, both published==true and
			//published==false warm primes scan and decode the entire 40k-card
			//remote-document cache on every reload (observed on DEV: ~8s for the
			//published listener plus ~21s for the unpublished prime, again on an
			//immediate second reload). The worker is the sole persistent-cache
			//owner, so it is also the correct place to enable the index manager.
			//The first query can still pay to build its index; later warm boots
			//reuse the persisted index instead of repeating the full scan.
			const indexManager = getPersistentCacheIndexManager(db);
			if (indexManager) {
				enablePersistentCacheIndexAutoCreation(indexManager);
				status('persistent cache query indexes enabled');
			}
			status('persistent single-tab cache (force-ownership) initialized');
			return;
		} catch (e) {
			send({type: 'error', generation, message: `persistent cache init failed (${String(e)}); falling back to memory cache`});
		}
	}
	db = initializeFirestore(app, {
		...longPolling,
		localCache: memoryLocalCache()
	});
	hookEmulator();
};

const connectPublished = () => {
	if (!db) return;
	const database = db;
	attachResilientListener('published listener', 'published',
		() => query(collection(database, CARDS_COLLECTION), where('published', '==', true)),
		() => {
			let firstDelivery = true;
			let firstServerDelivery = true;
			return snapshot => {
				ingestSnapshot(snapshot, 'published', firstDelivery);
				firstDelivery = false;
				if (!snapshot.metadata.fromCache) {
					//The compact snapshot is outside Firestore's query view, so its
					//published ghosts cannot produce Firestore `removed` changes.
					//The first server-confirmed snapshot contains the authoritative
					//full result set; explicitly reconcile those ghosts before this
					//plane can contribute to `live`.
					if (firstServerDelivery) {
						firstServerDelivery = false;
						const serverIDs = new Set(snapshot.docs.map(docSnapshot => docSnapshot.id));
						authoritativePublishedIDs = serverIDs;
						const ghosts = publishedGhostIDs(corpus, serverIDs);
						if (ghosts.length) {
							updateLocalState({}, ghosts);
							forwardBatch({}, ghosts, 'published', false);
							status(`published reconciliation removed ${ghosts.length} snapshot ghosts`);
						}
					}
					markWatermarkPlane('published', true);
				}
			};
		},
		() => markWatermarkPlane('published', false));
	status('published listener attached');
};

//Builds the Firestore query for one shared unpublished partition. gte ''
//means unbounded below; every partition has an explicit upper bound.
const unpublishedPartitionQuery = (database : Firestore, partition : UnpublishedCardPartition) : Query => {
	if (!partition.gte) {
		return query(collection(database, CARDS_COLLECTION),
			where('published', '==', false),
			where(documentId(), '<', partition.lt));
	}
	return query(collection(database, CARDS_COLLECTION),
		where('published', '==', false),
		where(documentId(), '>=', partition.gte),
		where(documentId(), '<', partition.lt));
};

//Mirrors the partitioned unpublished fetch in src/actions/database.ts:
//parallel getDocs by document-ID range (a single query on 38k+ docs hits the
//~60s Firestore timeout), coalesced into batched forwards, then a full
//onSnapshot whose initial delivery is flagged for fast dedupe.
//Attaches the phase-2 per-partition listeners and marks the initial
//unpublished load complete. Shared tail of both boot paths (warm cache
//prime and cold server prime).
const attachUnpublishedListeners = (database : Firestore, myConnectionGeneration : number) => {
	if (myConnectionGeneration !== connectionGeneration) return;
	//One listener per document-ID partition rather than a single 38k-doc
	//Listen: a full-corpus Listen stream died with "datastore operation
	//timed out" ~2min after attach on the dev backend (observed repeatedly),
	//and with per-partition listeners a drop only costs re-attaching and
	//redelivering ~1/5 of the corpus (or, with persisted resume tokens, just
	//the delta).
	for (const partition of UNPUBLISHED_CARD_PARTITIONS) {
		attachResilientListener(`unpublished listener ${partitionLabel(partition)}`, 'unpublished',
			() => unpublishedPartitionQuery(database, partition),
			() => {
				//Per attachment: only the initial delivery right after the
				//prime is overwhelmingly-redundant; re-attached listeners
				//get a fresh flag (their initial delivery redelivers
				//everything already in the worker corpus, which fast dedupe
				//also handles correctly).
				let firstDelivery = true;
				return snapshot => {
					const fastDedupe = firstDelivery;
					firstDelivery = false;
					ingestSnapshot(snapshot, 'unpublished', fastDedupe);
				};
			});
	}
	status(`unpublished listeners attached (${UNPUBLISHED_CARD_PARTITIONS.length} partitions)`);
	//The prime (or its terminal failure) plus attached listeners IS the
	//initial unpublished load — not any individual batch arrival.
	markInitialDelivered('unpublished');
};

//Below this many cached unpublished cards, the cache is treated as cold and
//the full partitioned server prime runs (first-ever boot, cleared site
//data). Above it, the cache serves the boot and the listeners' persisted
//resume tokens deliver just the catch-up delta.
const WARM_CACHE_THRESHOLD = 1000;

const connectUnpublishedPrivileged = async () => {
	if (!db) return;
	const database = db;
	const myConnectionGeneration = connectionGeneration;

	//Warm-boot fast path (persistent worker cache): serve the previous
	//session's corpus straight from IndexedDB — zero billed reads — and let
	//the phase-2 listeners reconcile via their persisted resume tokens.
	//Replaces the ~40k-billed-read getDocsFromServer prime that made every
	//worker boot cost most of a free-tier day.
	try {
		const cachedSnapshot = await getDocsFromCache(query(collection(database, CARDS_COLLECTION), where('published', '==', false)));
		if (myConnectionGeneration !== connectionGeneration) return;
		if (cachedSnapshot.size >= WARM_CACHE_THRESHOLD) {
			const start = performance.now();
			const {cards} = parseSnapshot(cachedSnapshot);
			updateLocalState(cards, []);
			forwardBatch(cards, [], 'unpublished', false);
			status(`warm boot: ${cachedSnapshot.size} unpublished cards from the persistent cache in ${(performance.now() - start).toFixed(0)}ms; listeners reconcile via resume tokens`);
			attachUnpublishedListeners(database, myConnectionGeneration);
			return;
		}
		status(`cache prime skipped (${cachedSnapshot.size} cached < ${WARM_CACHE_THRESHOLD}); doing server prime`);
	} catch (e) {
		//Memory-cache fallback boots land here (getDocsFromCache on an empty
		//cache) — the server prime below is the correct path for them.
		status(`cache prime unavailable (${String(e)}); doing server prime`);
	}

	const pendingCards : Cards = {};
	let flushTimeout : ReturnType<typeof setTimeout> | null = null;
	const flushPending = () => {
		if (flushTimeout) {
			clearTimeout(flushTimeout);
			flushTimeout = null;
		}
		if (myConnectionGeneration !== connectionGeneration) return;
		const ids = Object.keys(pendingCards);
		if (ids.length === 0) return;
		const cards = {...pendingCards};
		for (const id of ids) delete pendingCards[id];
		updateLocalState(cards, []);
		//fastDedupe: when the main thread primed Redux from its local cache,
		//this flush overwhelmingly redelivers cards it already holds —
		//matching updated timestamps prove equivalence without a 39k-card
		//deep-compare sweep. On an unprimed (empty-Redux) boot the flag is
		//moot: nothing to dedupe against.
		forwardBatch(cards, [], 'unpublished', true);
		status(`flushed ${ids.length} coalesced unpublished cards; corpus=${corpus.size}`);
	};

	const startTime = performance.now();
	try {
		const partitionPromises = UNPUBLISHED_CARD_PARTITIONS.map(async (partition) => {
			const partitionQuery = unpublishedPartitionQuery(database, partition);
			//From the SERVER, with retry: plain getDocs silently falls back
			//to the (memory, i.e. empty) cache when the backend has a blip,
			//which reads as a successful zero-card partition. Observed live
			//on dev: "complete: 0 cards" with no error during a datastore
			//outage.
			const snapshot = await retryWithBackoff(
				() => getDocsFromServer(partitionQuery),
				{
					attempts: 5,
					baseDelayMs: 2000,
					shouldContinue: () => myConnectionGeneration === connectionGeneration,
					onRetry: (error, attempt, delayMs) => status(`unpublished partition ${partitionLabel(partition)} attempt ${attempt} failed (${String(error)}); retrying in ${delayMs}ms`)
				}
			);
			if (myConnectionGeneration !== connectionGeneration) return 0;
			if (snapshot.size > 0) {
				const {cards} = parseSnapshot(snapshot);
				Object.assign(pendingCards, cards);
				if (!flushTimeout) flushTimeout = setTimeout(flushPending, COALESCE_INTERVAL_MS);
			}
			return snapshot.size;
		});
		const sizes = await Promise.all(partitionPromises);
		if (myConnectionGeneration !== connectionGeneration) return;
		flushPending();
		status(`unpublished getDocs complete: ${sizes.reduce((a, b) => a + b, 0)} cards in ${(performance.now() - startTime).toFixed(0)}ms`);
	} catch (e) {
		flushPending();
		send({type: 'error', generation, message: `unpublished getDocs: ${String(e)}`});
	}

	attachUnpublishedListeners(database, myConnectionGeneration);
};

const connectUnpublishedAuthorEditor = (uid : string) => {
	if (!db || !uid) return;
	const database = db;
	//These two error with permission-denied for users without the right
	//grants (expected, e.g. anonymous users); attachResilientListener treats
	//that as terminal, so the only effect is the empty-batch forward that
	//keeps loading indicators clear — same as before.
	attachResilientListener('unpublished-author listener', 'unpublished-author',
		() => query(collection(database, CARDS_COLLECTION), where('author', '==', uid), where('published', '==', false)),
		() => snapshot => ingestSnapshot(snapshot, 'unpublished-author'));
	attachResilientListener('unpublished-editor listener', 'unpublished-editor',
		() => query(collection(database, CARDS_COLLECTION), where('permissions.' + PERMISSION_EDIT_CARD, 'array-contains', uid), where('published', '==', false)),
		() => snapshot => ingestSnapshot(snapshot, 'unpublished-editor'));
	status('author/editor listeners attached');
};

//----------------------------------------------------------------------------
// Watermark delta sync (docs/corpus-sync-design.md)
//
// Instead of full-corpus partitioned listeners (whose >30-min re-attach is
// BILLED as a brand-new query — the whole ~39-59k result set, per boot), the
// unpublished corpus syncs via: free cache prime → per-boot count() trust
// gate (partial caches are real: observed live) → ONE delta listener
// `published==false AND updated > watermark` whose result set IS the change
// set → tombstones for deletions. Billed reads scale with changes, not
// corpus size.
//----------------------------------------------------------------------------

let syncMode : 'listen' | 'watermark' = 'listen';
let currentDevMode = false;
let currentUid = '';
let currentOwnerID = '';
let currentOwnershipEpoch = 0;
let sessionWatermark : WireTimestamp | null = null;
let syncMetaStore : SyncMetaStore | null = null;
let syncMetaState : SyncMeta | null = null;
let currentSyncState : 'unverified' | 'live' | 'stale' | '' = '';
let currentMayViewUnpublished = false;
type WatermarkPlane = 'published' | 'tombstone' | 'delta';
const healthyWatermarkPlanes = new Set<WatermarkPlane>();

const setSyncState = (state : 'unverified' | 'live' | 'stale') => {
	if (currentSyncState === state) return;
	currentSyncState = state;
	send({type: 'syncState', generation, state});
};

const markWatermarkPlane = (plane : WatermarkPlane, healthy : boolean) => {
	if (syncMode !== 'watermark' || !currentMayViewUnpublished) return;
	if (healthy) healthyWatermarkPlanes.add(plane);
	else healthyWatermarkPlanes.delete(plane);
	status(`watermark plane ${plane} ${healthy ? 'healthy' : 'stale'} (${[...healthyWatermarkPlanes].join(',') || 'none'})`);
	if (healthyWatermarkPlanes.size === 3) {
		markInitialDelivered('unpublished');
		const becameLive = currentSyncState !== 'live';
		setSyncState('live');
		//Only a server-verified, fully-live corpus may replace the last known-good
		//compact snapshot. Save immediately once; later changes are debounced.
		if (becameLive && corpusSnapshotStore) {
			corpusSnapshotPersistenceEnabled = true;
			scheduleCorpusSnapshotSave(0);
		}
	} else if (currentSyncState === 'live') {
		setSyncState('stale');
	}
};

//Per-partition tolerance for the trust gate: writes can land between the
//cache snapshot and the count query.
const GATE_PARTITION_TOLERANCE = 5;

const partitionIndexForID = (id : string) : number => {
	for (let i = 0; i < UNPUBLISHED_CARD_PARTITIONS.length; i++) {
		const partition = UNPUBLISHED_CARD_PARTITIONS[i];
		if ((partition.gte === '' || id >= partition.gte) && id < partition.lt) return i;
	}
	return UNPUBLISHED_CARD_PARTITIONS.length - 1;
};

//IDs of unpublished cards currently in the corpus, bucketed by partition.
const corpusUnpublishedPerPartition = () : Set<CardID>[] => {
	const buckets = UNPUBLISHED_CARD_PARTITIONS.map(() => new Set<CardID>());
	for (const [id, card] of corpus.entries()) {
		if (card.published) continue;
		buckets[partitionIndexForID(id)].add(id);
	}
	return buckets;
};

//The per-boot trust gate: per-partition server count()s vs the corpus in
//hand. Returns the mismatched partition indexes, or null when the counts
//couldn't be fetched (offline/quota). Cost: 1 read per 1000 index entries
//per partition — ~40-60 reads total at 40-60k cards. Per-partition (not one
//total) so a ghost in one range can't mask a missing doc in another.
const runTrustGate = async (database : Firestore, myConnectionGeneration : number) : Promise<{mismatched : number[], serverTotal : number} | null> => {
	try {
		const buckets = corpusUnpublishedPerPartition();
		const counts = await Promise.all(UNPUBLISHED_CARD_PARTITIONS.map(partition =>
			getCountFromServer(unpublishedPartitionQuery(database, partition)).then(snapshot => snapshot.data().count)));
		if (myConnectionGeneration !== connectionGeneration) return null;
		const mismatched : number[] = [];
		let serverTotal = 0;
		for (let i = 0; i < counts.length; i++) {
			serverTotal += counts[i];
			const local = buckets[i].size;
			//DIRECTIONAL: missing docs (server > local) tolerate small
			//in-flight churn — a card created seconds ago has updated > W
			//and the delta listener delivers it anyway. Ghosts (local >
			//server) get NO tolerance: the tombstone catch-up already ran,
			//so any surplus is a real ghost (console delete, stale prime)
			//that nothing else will ever remove — the old ±tolerance let up
			//to 5 ghosts per partition persist forever.
			if (counts[i] - local > GATE_PARTITION_TOLERANCE || local > counts[i]) mismatched.push(i);
		}
		status(`trust gate: server=${serverTotal} local=${buckets.reduce((a, b) => a + b.size, 0)} mismatchedPartitions=${mismatched.length}`);
		return {mismatched, serverTotal};
	} catch (e) {
		status(`trust gate unavailable (${String(e)})`);
		return null;
	}
};

//Repairs mismatched partitions by re-reading them from the server: missing
//docs get ingested, ghost docs (local-only — console deletes, stale primes)
//get removed. Bounded to the mismatched ranges (~1/10 of the corpus each)
//instead of a full re-read.
const repairPartitions = async (database : Firestore, myConnectionGeneration : number, mismatched : number[]) : Promise<boolean> => {
	for (const index of mismatched) {
		const partition = UNPUBLISHED_CARD_PARTITIONS[index];
		let snapshot : QuerySnapshot;
		try {
			snapshot = await retryWithBackoff(
				() => getDocsFromServer(unpublishedPartitionQuery(database, partition)),
				{attempts: 3, baseDelayMs: 2000, shouldContinue: () => myConnectionGeneration === connectionGeneration});
		} catch (e) {
			status(`partition ${partitionLabel(partition)} repair failed (${String(e)})`);
			return false;
		}
		if (myConnectionGeneration !== connectionGeneration) return false;
		const {cards} = parseSnapshot(snapshot);
		const serverIDs = new Set(Object.keys(cards));
		const ghosts : CardID[] = [];
		for (const id of corpusUnpublishedPerPartition()[index]) {
			if (!serverIDs.has(id)) ghosts.push(id);
		}
		updateLocalState(cards, ghosts);
		forwardBatch(cards, ghosts, 'unpublished', true);
		status(`partition ${partitionLabel(partition)} repaired: ${serverIDs.size} server docs, ${ghosts.length} ghosts removed`);
	}
	return true;
};

//Card IDs whose corpus entry carries a CLIENT-CLOCK timestamp rather than a
//server-confirmed one, and therefore must never feed the watermark (the
//no-gap proof dies otherwise — a fast client clock could push the bound
//past genuine server commits, permanently skipping them):
//- optimistic echoes (ECHO_LOCAL_CARD_MODIFICATIONS materializes sentinels
//  with the local clock; commits can land during boot windows), and
//- cache-primed docs overlaid by a PENDING persisted mutation (the shared
//  persistence DB can hold an unacknowledged offline write from a prior
//  session; serverTimestamps:'estimate' fills it with localWriteTime).
//Entries clear when a server-confirmed snapshot delivers the doc.
//Derive the session watermark from the corpus actually in hand — NEVER from
//clocks, read times, or client-clock-contaminated entries (see
//src/worker/watermark.ts for the invariant).
const deriveSessionWatermark = () : WireTimestamp | null => {
	const values : (WireTimestamp | null)[] = [];
	for (const [id, card] of corpus.entries()) {
		if (card.published) continue;
		if (clientClockCardIDs.has(id)) continue;
		const updated = card.updated as Timestamp | undefined;
		values.push(updated && typeof updated.seconds === 'number' ? {seconds: updated.seconds, nanoseconds: updated.nanoseconds} : null);
	}
	return deriveWatermark(values);
};

//Derive the watermark honoring a pending post-sweep clamp (see sync-meta.ts
//watermarkClamp for why an unclamped derivation after a docID-ordered sweep
//can skip mid-sweep edits).
const deriveClampedWatermark = () : WireTimestamp | null => {
	const derived = deriveSessionWatermark();
	const clamp = syncMetaState ? syncMetaState.watermarkClamp : null;
	if (!derived || !clamp) return derived;
	return compareTimestamps(clamp, derived) < 0 ? clamp : derived;
};

//Once the delta listener is attached under the clamped watermark the clamp
//has served its purpose; clearing it keeps later boots from re-replaying
//everything since the sweep forever.
const clearWatermarkClamp = async () : Promise<void> => {
	if (!syncMetaState || !syncMetaState.watermarkClamp) return;
	syncMetaState.watermarkClamp = null;
	if (syncMetaStore) await syncMetaStore.save(syncMetaState);
};

//Processes tombstone docs: remove from corpus/engine, forward removals,
//launder the SDK cache (getDocFromServer overwrites the cached ghost with
//not-exists — client code cannot delete cache entries directly), and track
//unlaundered IDs so a re-prime can't resurrect a ghost.
type CorpusTombstone = {id : CardID, deleted : WireTimestamp, published? : boolean};

const processTombstones = (database : Firestore, tombstones : CorpusTombstone[]) => {
	if (!tombstones.length || !syncMetaState || !syncMetaStore) return;
	const myConnectionGeneration = connectionGeneration;
	const meta = syncMetaState;
	const publishedRemovals : CardID[] = [];
	const unpublishedRemovals : CardID[] = [];
	const newerResidentIDs = new Set<CardID>();
	for (const tombstone of tombstones) {
		const existing = corpus.get(tombstone.id);
		if (!existing) continue;
		const updated = existing.updated as Timestamp | undefined;
		if (updated && compareTimestamps(
			{seconds: updated.seconds, nanoseconds: updated.nanoseconds},
			tombstone.deleted,
		) > 0) {
			newerResidentIDs.add(tombstone.id);
			continue;
		}
		const wasPublished = tombstone.published ?? existing.published;
		(wasPublished ? publishedRemovals : unpublishedRemovals).push(tombstone.id);
	}
	const removals = [...publishedRemovals, ...unpublishedRemovals];
	if (removals.length) {
		updateLocalState({}, removals);
		if (publishedRemovals.length) forwardBatch({}, publishedRemovals, 'published', false);
		if (unpublishedRemovals.length) forwardBatch({}, unpublishedRemovals, 'unpublished', false);
	}
	for (const tombstone of tombstones) {
		meta.tombstoneCursor = advanceWatermark(meta.tombstoneCursor, tombstone.deleted);
		if (!newerResidentIDs.has(tombstone.id) && !meta.processedTombstoneIDs.includes(tombstone.id)) meta.processedTombstoneIDs.push(tombstone.id);
		//Launder asynchronously; on confirmation the suppress entry drops.
		getDocFromServer(doc(database, CARDS_COLLECTION, tombstone.id)).then(snapshot => {
			if (myConnectionGeneration !== connectionGeneration) return;
			//Laundered (not-exists overwrote the cached ghost) OR the card
			//was recreated under the same ID — either way suppression must
			//lift (suppressing a recreated card made it permanently
			//invisible on this device).
			meta.processedTombstoneIDs = meta.processedTombstoneIDs.filter(id => id !== tombstone.id);
			if (snapshot.exists()) {
				const card = {...snapshot.data({serverTimestamps: 'estimate'}), id: snapshot.id} as Card;
				const updated = card.updated as Timestamp | undefined;
				if (updated && compareTimestamps({seconds: updated.seconds, nanoseconds: updated.nanoseconds}, tombstone.deleted) > 0) {
					updateLocalState({[card.id]: card}, []);
					forwardBatch({[card.id]: card}, [], card.published ? 'published' : 'unpublished', false);
				}
			}
			if (syncMetaStore) void syncMetaStore.save(meta);
		}).catch(() => {
			//Launder unconfirmed: keep suppressing; retryPendingLaunders
			//re-attempts at every boot.
		});
	}
	void syncMetaStore.save(meta);
	if (removals.length) status(`tombstones: removed ${removals.length} deleted cards`);
};

//One-shot tombstone catch-up, run BEFORE the trust gate so deletions-while-
//away don't read as partition mismatches (a monthly cleanup could otherwise
//trigger a ~5k-read partition repair to remove ghosts a dozen tombstone
//reads handle). Non-fatal on failure — the gate's ghost handling remains
//the backstop.
const catchUpTombstones = async (database : Firestore) : Promise<void> => {
	try {
		const cursor = syncMetaState?.tombstoneCursor;
		const bound = cursor ? watermarkQueryBound(cursor) : {seconds: 0, nanoseconds: 0};
		const snapshot = await getDocsFromServer(query(collection(database, TOMBSTONES_COLLECTION), where('deleted', '>', new Timestamp(bound.seconds, bound.nanoseconds))));
		const tombstones : CorpusTombstone[] = [];
		snapshot.docs.forEach(docSnapshot => {
			const data = docSnapshot.data({serverTimestamps: 'estimate'});
			const deleted = data.deleted as Timestamp | undefined;
			if (!deleted || typeof deleted.seconds !== 'number') return;
			tombstones.push({id: docSnapshot.id, deleted: {seconds: deleted.seconds, nanoseconds: deleted.nanoseconds}, published: typeof data.published === 'boolean' ? data.published : undefined});
		});
		processTombstones(database, tombstones);
	} catch (e) {
		status(`tombstone catch-up unavailable (${String(e)})`);
	}
};

//Boot-time retry of cache laundering for tombstones whose earlier launder
//never confirmed (their IDs are still suppressed at prime; without this the
//poisoned cache entries and suppression list persisted forever once the
//cursor moved past them).
const retryPendingLaunders = (database : Firestore) => {
	const meta = syncMetaState;
	if (!meta || !syncMetaStore) return;
	for (const id of [...meta.processedTombstoneIDs]) {
		getDocFromServer(doc(database, CARDS_COLLECTION, id)).then(snapshot => {
			meta.processedTombstoneIDs = meta.processedTombstoneIDs.filter(other => other !== id);
			if (snapshot.exists()) {
				//Recreated under the same ID: stop suppressing so the live
				//card can serve again (it arrives via prime/delta).
				status(`tombstoned card ${id} was recreated; suppression lifted`);
			}
			if (syncMetaStore) void syncMetaStore.save(meta);
		}).catch(() => {
			//Still unreachable; retried again next boot.
		});
	}
};

const attachTombstoneListener = (database : Firestore, onInitialDelivery : () => void) => {
	let first = true;
	attachResilientListener('tombstone listener', 'unpublished',
		() => {
			const cursor = syncMetaState?.tombstoneCursor;
			const bound = cursor ? watermarkQueryBound(cursor) : {seconds: 0, nanoseconds: 0};
			return query(collection(database, TOMBSTONES_COLLECTION), where('deleted', '>', new Timestamp(bound.seconds, bound.nanoseconds)));
		},
		() => snapshot => {
			//A cached tombstone can carry a locally-estimated serverTimestamp.
			//Wait for its server-confirmed delivery before deleting or advancing
			//the durable cursor.
			if (snapshot.metadata.fromCache) return;
			const tombstones : CorpusTombstone[] = [];
			snapshot.docChanges().forEach(change => {
				if (change.type === 'removed') return; //pruning, not un-deletion
				//A server-backed snapshot can still contain an individual
				//locally-pending document. Its estimated serverTimestamp uses
				//the client clock and must not advance the durable cursor.
				if (!listenerDocumentTrusted(
					snapshot.metadata.fromCache,
					change.doc.metadata.hasPendingWrites,
				)) return;
				const data = change.doc.data({serverTimestamps: 'estimate'});
				const deleted = data.deleted as Timestamp | undefined;
				if (!deleted || typeof deleted.seconds !== 'number') return;
				tombstones.push({id: change.doc.id, deleted: {seconds: deleted.seconds, nanoseconds: deleted.nanoseconds}, published: typeof data.published === 'boolean' ? data.published : undefined});
			});
			processTombstones(database, tombstones);
			markWatermarkPlane('tombstone', true);
			if (first) {
				first = false;
				onInitialDelivery();
			}
		},
		() => markWatermarkPlane('tombstone', false),
		//The delta listener is attached only after the tombstone listener's
		//real initial snapshot. An error must never satisfy unpublished
		//completeness or let a stale cache be served as live.
		false);
};

const attachDeltaListener = (database : Firestore) => {
	let firstServerDelivery = true;
	const myConnectionGeneration = connectionGeneration;
	attachResilientListener('unpublished delta listener', 'unpublished',
		() => {
			//Read the CURRENT watermark at (re)attach, so a re-attach after a
			//drop catches up from the latest coverage — a tiny result set —
			//instead of re-reading from the boot bound.
			const bound = sessionWatermark ? watermarkQueryBound(sessionWatermark) : {seconds: 0, nanoseconds: 0};
			return query(collection(database, CARDS_COLLECTION),
				where('published', '==', false),
				where('updated', '>', new Timestamp(bound.seconds, bound.nanoseconds)));
		},
		() => snapshot => {
			//Removed events here are advisory only: a doc leaves this result
			//set on publish-flip (the published listener re-adds it) — and
			//real deletions arrive via tombstones. Never remove on them.
			//Restore 'live' BEFORE the empty-delivery early-return: a
			//re-attach after a blip in a quiet period delivers an empty (or
			//tiny) snapshot, and gating the restore on count>0 left 'stale'
			//latched until the next real edit.
			const {cards} = parseSnapshot(snapshot);
			const untrustedIDs = new Set(snapshot.docChanges()
				.filter(change => change.type !== 'removed' && !listenerDocumentTrusted(
					snapshot.metadata.fromCache,
					change.doc.metadata.hasPendingWrites,
				))
				.map(change => change.doc.id));
			const count = Object.keys(cards).length;
			if (count) {
				for (const id of Object.keys(cards)) {
					if (untrustedIDs.has(id)) clientClockCardIDs.add(id);
					else clientClockCardIDs.delete(id);
				}
				updateLocalState(cards, []);
				forwardBatch(cards, [], 'unpublished', false);
				for (const [id, card] of Object.entries(cards)) {
					if (untrustedIDs.has(id)) continue;
					const updated = card.updated as Timestamp | undefined;
					if (updated && typeof updated.seconds === 'number') {
						sessionWatermark = advanceWatermark(sessionWatermark, {seconds: updated.seconds, nanoseconds: updated.nanoseconds});
					}
				}
				status(`delta: ${count} changed cards; corpus=${corpus.size}`);
			}
			if (!snapshot.metadata.fromCache) {
				if (firstServerDelivery) {
					firstServerDelivery = false;
					void clearWatermarkClamp().then(() => {
						if (myConnectionGeneration === connectionGeneration) markWatermarkPlane('delta', true);
					});
				} else {
					markWatermarkPlane('delta', true);
				}
			}
		},
		() => markWatermarkPlane('delta', false));
};

//----------------------------------------------------------------------------
// Cold sweep (FAST COLD BOOT): first-ever fill of the corpus on a device
// with no usable cache. Reads the whole corpus ONCE — unavoidable (the
// client SDK reads whole docs) — as fast as the backend allows: a priority
// phase of the most recent cards (usable in seconds), then ALL partitions in
// parallel with per-partition resumable cursors and ADAPTIVE PACING (halve
// concurrency + exponential backoff on RESOURCE_EXHAUSTED backpressure,
// restore after a run of clean pages). On Blaze there is no quota to budget
// against — the full 60k load costs ~4 cents. See cold-pace.ts.
//----------------------------------------------------------------------------

//A primed corpus holding less than this fraction of the server total is
//treated as cold (full sweep) rather than repaired partition-by-partition:
//repairing nearly everything IS a full read of everything.
const COLD_FRACTION = 0.5;

//A page of one partition, ordered by documentId with a resumable cursor.
//Served by the same (published ==, __name__) index shape as
//unpublishedPartitionQuery.
const unpublishedPartitionPageQuery = (database : Firestore, partition : UnpublishedCardPartition, afterDocID : string) : Query => {
	const constraints : QueryConstraint[] = [where('published', '==', false)];
	if (partition.gte) constraints.push(where(documentId(), '>=', partition.gte));
	constraints.push(where(documentId(), '<', partition.lt));
	constraints.push(orderBy(documentId(), 'asc'));
	if (afterDocID) constraints.push(startAfter(afterDocID));
	constraints.push(limit(COLD_SWEEP_PAGE_SIZE));
	return query(collection(database, CARDS_COLLECTION), ...constraints);
};

const coldSweep = async (database : Firestore, myConnectionGeneration : number) : Promise<boolean> => {
	if (!syncMetaStore || !syncMetaState) return false;
	const meta = syncMetaState;
	const metaStore = syncMetaStore;

	//Priority phase (fresh sweeps only): the most recently updated cards
	//first, so a knowledge garden is USABLE in seconds while the parallel
	//sweep fills the rest.
	if (!meta.coldSweep) {
		let prioritySnapshot : QuerySnapshot;
		try {
			prioritySnapshot = await retryWithBackoff(
				() => getDocsFromServer(query(collection(database, CARDS_COLLECTION),
					where('published', '==', false), orderBy('updated', 'desc'), limit(COLD_SWEEP_PRIORITY_COUNT))),
				{
					attempts: 5,
					baseDelayMs: 2000,
					shouldContinue: () => myConnectionGeneration === connectionGeneration,
					onRetry: (error, attempt, delayMs) => status(`cold sweep priority attempt ${attempt} failed (${String(error)}); retrying in ${delayMs}ms`)
				}
			);
		} catch (e) {
			status(`cold sweep priority phase failed (${String(e)}); gate will retry`);
			return false;
		}
		if (myConnectionGeneration !== connectionGeneration) return false;
		const {cards} = parseSnapshot(prioritySnapshot);
		updateLocalState(cards, []);
		forwardBatch(cards, [], 'unpublished', false);
		//startBound: max(updated) at sweep START, server-confirmed. The
		//post-sweep watermark is clamped to it — the docID-ordered pages
		//below can read a doc BEFORE a mid-sweep edit lands on it, so an
		//unclamped max(updated) could advance past an unseen edit and the
		//delta listener would permanently skip it.
		let startBound : WireTimestamp | null = null;
		for (const card of Object.values(cards)) {
			const updated = card.updated as Timestamp | undefined;
			if (updated && typeof updated.seconds === 'number') {
				startBound = advanceWatermark(startBound, {seconds: updated.seconds, nanoseconds: updated.nanoseconds});
			}
		}
		meta.coldSweep = {
			startBound,
			cursors: UNPUBLISHED_CARD_PARTITIONS.map(() => ''),
			done: UNPUBLISHED_CARD_PARTITIONS.map(() => false)
		};
		void metaStore.save(meta);
		status(`cold sweep: priority phase served ${prioritySnapshot.size} recent cards; parallel partition sweep follows`);
	}

	//All partitions in parallel, each page gated by an adaptive semaphore.
	//RESOURCE_EXHAUSTED is server-side backpressure against the burst shape
	//(verified NOT a quota — both projects are Blaze with no caps): halve
	//concurrency and back off; a run of clean pages restores it. Other
	//errors back off without downshifting. Generation-guarded; otherwise
	//never gives up and never pauses.
	const sweep = meta.coldSweep;
	let pace = initialPaceState();
	let activePages = 0;
	let waiters : (() => void)[] = [];
	const wake = () => {
		const pending = waiters;
		waiters = [];
		for (const waiter of pending) waiter();
	};
	const acquirePageSlot = async () => {
		while (activePages >= concurrencyForPace(pace)) {
			await new Promise<void>(resolve => waiters.push(resolve));
		}
		activePages++;
	};
	const releasePageSlot = () => {
		activePages--;
		wake();
	};
	const sleep = (ms : number) => new Promise<void>(resolve => setTimeout(resolve, ms));

	const sweepPartition = async (index : number) : Promise<void> => {
		const partition = UNPUBLISHED_CARD_PARTITIONS[index];
		let errorBackoffMs = 1000;
		while (!sweep.done[index]) {
			if (myConnectionGeneration !== connectionGeneration) return;
			await acquirePageSlot();
			let page : QuerySnapshot;
			try {
				page = await getDocsFromServer(unpublishedPartitionPageQuery(database, partition, sweep.cursors[index]));
			} catch (e) {
				releasePageSlot();
				if (myConnectionGeneration !== connectionGeneration) return;
				if (isResourceExhausted(e)) {
					pace = paceOnThrottle(pace);
					const backoff = throttleBackoffMs(pace.consecutiveThrottles);
					status(`cold sweep ${partitionLabel(partition)} throttled; concurrency now ${concurrencyForPace(pace)}, retrying in ${Math.round(backoff / 1000)}s`);
					await sleep(backoff);
				} else {
					status(`cold sweep ${partitionLabel(partition)} page failed (${String(e)}); retrying in ${Math.round(errorBackoffMs / 1000)}s`);
					await sleep(errorBackoffMs);
					errorBackoffMs = Math.min(errorBackoffMs * 2, 60 * 1000);
				}
				continue;
			}
			if (myConnectionGeneration !== connectionGeneration) {
				releasePageSlot();
				return;
			}
			errorBackoffMs = 1000;
			pace = paceOnCleanPage(pace);
			const {cards} = parseSnapshot(page);
			if (page.size) {
				updateLocalState(cards, []);
				forwardBatch(cards, [], 'unpublished', true);
				sweep.cursors[index] = page.docs[page.docs.length - 1].id;
			}
			if (page.size < COLD_SWEEP_PAGE_SIZE) sweep.done[index] = true;
			//Persist-late per page: an over-old cursor just re-reads a page.
			void metaStore.save(meta);
			releasePageSlot();
		}
	};

	await Promise.all(UNPUBLISHED_CARD_PARTITIONS.map((_, index) => sweepPartition(index)));
	if (myConnectionGeneration !== connectionGeneration) return false;
	//Promote the start bound to the persisted clamp BEFORE clearing the
	//sweep state, so a crash between here and the delta-listener attach
	//still clamps the next boot's watermark.
	meta.watermarkClamp = sweep.startBound;
	meta.coldSweep = null;
	void metaStore.save(meta);
	status(`cold sweep complete; corpus=${corpus.size}`);
	return true;
};

//Tail shared by the sweep's completion paths: RE-VERIFY with the gate (the
//sweep's cursor lives in a different IndexedDB than the swept docs — a
//cache eviction mid-sweep could otherwise let a tail-only corpus complete
//as trustworthy), then bring up the normal delta plane.
const afterColdSweep = async (database : Firestore, myConnectionGeneration : number) : Promise<void> => {
	if (myConnectionGeneration !== connectionGeneration) return;
	const gate = await runTrustGate(database, myConnectionGeneration);
	if (myConnectionGeneration !== connectionGeneration) return;
	if (!gate || gate.mismatched.length) {
		if (gate && gate.mismatched.length) {
			const repaired = await repairPartitions(database, myConnectionGeneration, gate.mismatched);
			if (myConnectionGeneration !== connectionGeneration || !repaired) {
				setTimeout(() => void afterColdSweep(database, myConnectionGeneration), 60 * 1000);
				return;
			}
		} else {
			setTimeout(() => void afterColdSweep(database, myConnectionGeneration), 60 * 1000);
			return;
		}
	}
	sessionWatermark = deriveClampedWatermark();
	attachTombstoneListener(database, () => {
		attachDeltaListener(database);
	});
};

//Retry cadence for the trust gate when it can't reach the server (offline,
//quota exhaustion): the app keeps serving the unverified prime locally.
const GATE_RETRY_MS = 60 * 1000;

const connectUnpublishedWatermark = async (deferPublishedUntilAfterPrime = false) => {
	if (!db) return;
	const database = db;
	const myConnectionGeneration = connectionGeneration;
	setSyncState('unverified');

	const projectID = app?.options.projectId || (currentDevMode ? 'dev' : 'prod');
	const ownership = {ownerID: currentOwnerID, epoch: currentOwnershipEpoch};
	syncMetaStore = new SyncMetaStore(`${projectID}:${currentUid}:privileged`, ownership);
	//Chromium serializes IndexedDB opens aggressively during Firestore startup.
	//Do not even enqueue the tiny sync-meta open until the compact snapshot has
	//loaded and forwarded; enqueueing it first delayed the snapshot by ~16s on
	//the real 40k-card DEV corpus. The snapshot carries its own last-known
	//tombstone suppressions, and newer metadata is still reconciled before live.
	let syncMetaLoad : ReturnType<SyncMetaStore['load']> | null = null;
	let syncMetaOwnershipClaim : Promise<boolean> | null = null;
	const loadSyncMeta = async () => {
		//Do not open the sync-meta DB until the compact-snapshot DB has loaded;
		//Chromium serializes these opens and the competing open added ~16s to
		//warm boot on the real corpus.
		syncMetaOwnershipClaim ||= syncMetaStore!.claimOwnership();
		if (!await syncMetaOwnershipClaim) throw new Error('worker sync metadata ownership was superseded');
		return syncMetaLoad || (syncMetaLoad = syncMetaStore!.load());
	};
	corpusSnapshotStore = new CorpusSnapshotStore(`${projectID}:${currentUid}:privileged`, ownership);
	if (!await corpusSnapshotStore.claimOwnership()) {
		await stopSupersededWorker('worker superseded by a newer ownership epoch; stopping before local persistence writes');
		return;
	}

	//1. Prime from the compact materialized snapshot. On its first-ever run,
	//fall back to Firestore's persistent cache and create the compact snapshot
	//only after this corpus passes the trust gate. Either source is served in
	//the 'unverified' state (trust slow, serve fast).
	const primeStartedAt = performance.now();
	let cacheQueryFinishedAt = primeStartedAt;
	const primedCards : Cards = {};
	let primeSource = 'persistent cache';
	let compactTombstoneIDs : string[] = [];
	try {
		const compactSnapshot = await corpusSnapshotStore.load();
		if (myConnectionGeneration !== connectionGeneration) return;
		if (compactSnapshot && Object.keys(compactSnapshot.cards).length) {
			primeSource = 'compact snapshot';
			compactTombstoneIDs = compactSnapshot.processedTombstoneIDs || [];
			if (compactSnapshot.schemaVersion === 2) {
				//Cards and safety bounds are one atomic checkpoint. Ignore any newer
				//separate-DB progress and conservatively replay from this checkpoint.
				syncMetaState = {
					schemaVersion: 1,
					tombstoneCursor: compactSnapshot.tombstoneCursor,
					processedTombstoneIDs: [...compactSnapshot.processedTombstoneIDs],
					coldSweep: null,
					watermarkClamp: compactSnapshot.watermarkClamp,
				};
			}
			const restored = fromWire(compactSnapshot.cards,
				(seconds, nanoseconds) => new Timestamp(seconds, nanoseconds)) as Cards;
			//A published cache listener may have won the race while IndexedDB
			//loaded. Never overwrite fresher listener data with the saved base.
			for (const [id, card] of Object.entries(restored)) {
				if (!corpus.has(id)) primedCards[id] = card;
			}
			for (const id of compactSnapshot.clientClockCardIDs) {
				if (primedCards[id]) clientClockCardIDs.add(id);
			}
			for (const id of compactTombstoneIDs) delete primedCards[id];
		} else {
			//There is no compact fast path to protect from Firestore cache
			//contention. Attach published now so a slow legacy cache recovery
			//cannot leave the public corpus needlessly blank.
			if (deferPublishedUntilAfterPrime) {
				connectPublished();
				deferPublishedUntilAfterPrime = false;
			}
			syncMetaState = await loadSyncMeta();
			if (myConnectionGeneration !== connectionGeneration) return;
			const snapshot = await getDocsFromCache(query(collection(database, CARDS_COLLECTION), where('published', '==', false)));
			for (const docSnapshot of snapshot.docs) {
				const id : CardID = docSnapshot.id;
				primedCards[id] = {...docSnapshot.data({serverTimestamps: 'estimate'}), id} as Card;
				//A pending persisted mutation overlays the cached doc with its
				//LOCAL write time — poison for the watermark (see
				//clientClockCardIDs). The doc still serves; it just can't set
				//the delta bound until server-confirmed.
				if (docSnapshot.metadata.hasPendingWrites) clientClockCardIDs.add(id);
			}
		}
		cacheQueryFinishedAt = performance.now();
	} catch {
		//Empty/unavailable cache: the gate below classifies this as cold.
	}
	if (myConnectionGeneration !== connectionGeneration) return;
	//Do not poll this same IndexedDB while its single, very large compact
	//snapshot record is loading. Chromium serializes the transactions and the
	//poll turned a ~1.4s 40k-card warm read into 7–21s in real DEV. Revalidate
	//once immediately after the read, then start the steady-state guard.
	if (!await corpusSnapshotStore.ownsCurrentOwnership()) {
		await stopSupersededWorker('worker ownership changed during compact snapshot load; stopping before handoff');
		return;
	}
	ownershipEpochGuard = setInterval(() => {
		const store = corpusSnapshotStore;
		if (!store) return;
		void store.ownsCurrentOwnership().then(current => {
			if (current) return;
			void stopSupersededWorker('worker ownership epoch changed; listeners stopped before further application persistence');
		});
	}, 1000);
	if (syncMetaState) for (const id of syncMetaState.processedTombstoneIDs) delete primedCards[id];
	//The published server snapshot can beat this independent IndexedDB load.
	//Apply its authoritative ID set before merging the compact prime so ghosts
	//cannot arrive after the listener's one-shot reconciliation.
	if (authoritativePublishedIDs) {
		for (const [id, card] of Object.entries(primedCards)) {
			if (card.published && !authoritativePublishedIDs.has(id)) delete primedCards[id];
		}
	}
	const primedCount = Object.keys(primedCards).length;
	if (primedCount) {
		const parseFinishedAt = performance.now();
		updateLocalState(primedCards, [], true, primeSource === 'compact snapshot');
		const workerStateFinishedAt = performance.now();
		const primedPublished : Cards = {};
		const primedUnpublished : Cards = {};
		for (const [id, card] of Object.entries(primedCards)) {
			(card.published ? primedPublished : primedUnpublished)[id] = card;
		}
		const cardFilters = engine.cardDerivedFilters();
		const cardFilterCorpusIDs = [...corpus.keys()];
		if (primedCount >= 10000) status(`watermark prime handoff starting: ${primedCount} cards`);
		const hasUnpublished = Object.keys(primedUnpublished).length > 0;
		if (Object.keys(primedPublished).length) forwardBatch(primedPublished, [], 'published', true, false, hasUnpublished ? undefined : cardFilters, hasUnpublished ? undefined : cardFilterCorpusIDs);
		if (hasUnpublished) forwardBatch(primedUnpublished, [], 'unpublished', false, false, cardFilters, cardFilterCorpusIDs);
		const forwardFinishedAt = performance.now();
		status(`watermark prime: ${primedCount} cards from the ${primeSource}; load=${(cacheQueryFinishedAt - primeStartedAt).toFixed(0)}ms parse=${(parseFinishedAt - cacheQueryFinishedAt).toFixed(0)}ms workerState=${(workerStateFinishedAt - parseFinishedAt).toFixed(0)}ms forward=${(forwardFinishedAt - workerStateFinishedAt).toFixed(0)}ms total=${(forwardFinishedAt - primeStartedAt).toFixed(0)}ms`);
	}
	//The published listener's first persistent-cache query can scan and decode
	//nearly the whole Firestore cache. Starting it beside the compact-snapshot
	//read made Chromium serialize the two IndexedDB workloads and turned a
	//~1.4s real-DEV snapshot load into 10–21s. The compact prime is explicitly
	//unverified, so serving it first does not weaken correctness: `live` still
	//requires the subsequently attached published listener plus the tombstone
	//and delta planes to become server-confirmed.
	if (deferPublishedUntilAfterPrime) connectPublished();
	if (!syncMetaState) syncMetaState = await loadSyncMeta();
	if (myConnectionGeneration !== connectionGeneration) return;
	//The separately-persisted metadata may be newer than the snapshot (for
	//example, a crash during the snapshot's debounce window). Remove any newly
	//known ghosts before catch-up, the server trust gate, or live readiness.
	const lateTombstoneIDs = syncMetaState.processedTombstoneIDs.filter(id => corpus.has(id) && !compactTombstoneIDs.includes(id));
	if (lateTombstoneIDs.length) {
		const publishedRemovals = lateTombstoneIDs.filter(id => corpus.get(id)?.published);
		const unpublishedRemovals = lateTombstoneIDs.filter(id => !corpus.get(id)?.published);
		updateLocalState({}, lateTombstoneIDs);
		if (publishedRemovals.length) forwardBatch({}, publishedRemovals, 'published', false);
		if (unpublishedRemovals.length) forwardBatch({}, unpublishedRemovals, 'unpublished', false);
	}

	//2. Tombstone catch-up FIRST (deletions-while-away must not read as
	//partition mismatches) + retry any unconfirmed cache launders.
	await catchUpTombstones(database);
	if (myConnectionGeneration !== connectionGeneration) return;
	retryPendingLaunders(database);

	//3. Trust gate. A cache prime's completeness is UNKNOWABLE client-side
	//(observed live: a 5,001-card partial-mode residue blessed as warm while
	//34k docs were missing — and max(updated) over such a cache can equal
	//the true corpus max, so the delta query would never heal it). Only a
	//server count can bless it.
	const gateAndProceed = async () : Promise<void> => {
		const gate = await runTrustGate(database, myConnectionGeneration);
		if (myConnectionGeneration !== connectionGeneration) return;
		if (gate === null) {
			//Offline or quota-starved: keep serving the prime locally,
			//unverified; retry. loadComplete is withheld so the bridge never
			//serves worker collections from an unverified corpus.
			setTimeout(() => {
				if (myConnectionGeneration !== connectionGeneration) return;
				void gateAndProceed();
			}, GATE_RETRY_MS);
			return;
		}
		//COLD: a corpus holding under half the server total is a first fill
		//(or catastrophic cache loss) — run the budgeted sweep, not a
		//partition-by-partition repair (which would be a full unbudgeted
		//read of nearly everything).
		const localTotal = corpusUnpublishedPerPartition().reduce((total, bucket) => total + bucket.size, 0);
		if (gate.serverTotal > 0 && localTotal < gate.serverTotal * COLD_FRACTION) {
			status(`cold corpus (${localTotal} of ${gate.serverTotal}); starting budgeted sweep`);
			const done = await coldSweep(database, myConnectionGeneration);
			if (myConnectionGeneration !== connectionGeneration) return;
			if (!done) {
				//An exhausted priority-phase retry does not own a timer. Re-run the
				//gate (and therefore the still-cold sweep) instead of leaving a fresh
				//device unverified until its next page reload.
				setTimeout(() => {
					if (myConnectionGeneration !== connectionGeneration) return;
					void gateAndProceed();
				}, GATE_RETRY_MS);
				return;
			}
			void afterColdSweep(database, myConnectionGeneration);
			return;
		}
		if (gate.mismatched.length) {
			const repaired = await repairPartitions(database, myConnectionGeneration, gate.mismatched);
			if (myConnectionGeneration !== connectionGeneration) return;
			if (!repaired) {
				setTimeout(() => {
					if (myConnectionGeneration !== connectionGeneration) return;
					void gateAndProceed();
				}, GATE_RETRY_MS);
				return;
			}
		}
		//A gate pass without the sweep means any persisted sweep cursor is
		//stale — clearing it prevents a FUTURE cold event from resuming
		//mid-corpus and "completing" with only the tail.
		if (syncMetaState && syncMetaState.coldSweep) {
			syncMetaState.coldSweep = null;
			if (syncMetaStore) void syncMetaStore.save(syncMetaState);
		}
		//4. Watermark from the (verified) corpus in hand — clamped if a
		//completed sweep's clamp is still pending (crash recovery).
		sessionWatermark = deriveClampedWatermark();
		//5. Tombstone listener (catch-up already ran); then the delta
		//listener from the watermark; then complete.
		attachTombstoneListener(database, () => {
			attachDeltaListener(database);
		});
	};
	void gateAndProceed();
};

const connectCards = (mayViewUnpublished : boolean, uid : string) => {
	teardownListeners();
	if (!uid && currentUid && corpusSnapshotStore) void corpusSnapshotStore.clear();
	disableCorpusSnapshotPersistence();
	//A (re)connect changes what this corpus MEANS (different permissions ⇒
	//different visible card set): live subscriptions computed under the old
	//parameters must not keep pushing (they survived reconnects before,
	//serving stale-uid results for the whole reload), and pending similarity
	//dedupe state belongs to the old world.
	subscriptions.clear();
	requestedSimilarityCardIDs.clear();
	//The worker outlives Firebase auth transitions, so its in-memory corpus is
	//NOT automatically scoped to the new user. Keeping even one card from the
	//old authorization world can expose unpublished content through search or
	//collection results. Rebuild every corpus-derived structure from the new
	//listeners instead. Published cards are harmless to retain in Redux on the
	//main thread, but the worker must start from a single, coherent scope.
	const staleCardIDs = [...corpus.keys()];
	if (staleCardIDs.length) updateLocalState({}, staleCardIDs);
	currentUid = uid;
	currentMayViewUnpublished = mayViewUnpublished;
	healthyWatermarkPlanes.clear();
	currentSyncState = '';
	authoritativePublishedIDs = null;
	syncMetaState = null;
	sessionWatermark = null;
	clientClockCardIDs.clear();
	const expected : CardFetchType[] = ['published'];
	if (mayViewUnpublished) expected.push('unpublished');
	else if (uid) expected.push('unpublished-author', 'unpublished-editor');
	expectInitialLoad(expected);
	if (mayViewUnpublished) {
		if (syncMode === 'watermark') void connectUnpublishedWatermark(true);
		else {
			connectPublished();
			void connectUnpublishedPrivileged();
		}
	} else if (uid) {
		connectPublished();
		connectUnpublishedAuthorEditor(uid);
	} else {
		connectPublished();
	}
};

const spike = () => {
	send({
		type: 'spikeReport',
		generation,
		report: {
			cardCount: corpus.size,
			tokenCount: index.tokenCount,
			indexedCardCount: index.cardCount,
			cardsWithStoredTokens,
			indexBuildMs: Math.round(indexBuildMs * 10) / 10,
			authUid: auth?.currentUser?.uid || null,
			firestoreSource: 'unknown'
		}
	});
};

//Tokenize a query string the same way nlp_search_tokens are generated at save
//time: stemmed, stop-word-free unigrams plus bigrams.
const queryTokens = (text : string) : string[] => {
	const normalized = withoutStopWords(stemmedNormalizedWords(normalizedWords(text)));
	if (!normalized) return [];
	const unigrams = normalized.split(' ').filter(word => Boolean(word));
	return [...unigrams, ...ngrams(normalized, 2)];
};

const ensureSearchIndex = () => {
	if (!searchIndexNeedsRebuild) return;
	const startedAt = performance.now();
	const rebuilt = new SearchIndex();
	for (const [id, card] of corpus) {
		const tokens = searchTokensForCard(card);
		if (tokens.length) rebuilt.updateCard(id, tokens);
	}
	index = rebuilt;
	searchIndexNeedsRebuild = false;
	const elapsed = performance.now() - startedAt;
	indexBuildMs += elapsed;
	recordWorkerPerf('indexBuild', elapsed);
	status(`search index built on demand: ${index.cardCount} cards in ${elapsed.toFixed(0)}ms`);
};

const runQuery = (id : number, text : string) => {
	const start = performance.now();
	const tokens = queryTokens(text);
	//An empty/stop-word-only query has no index candidates and uses the existing
	//full-scan fallback, so it should not accidentally trigger the deferred work.
	if (tokens.length) ensureSearchIndex();
	const candidates = index.candidates(tokens);
	const ms = performance.now() - start;
	recordWorkerPerf('query', ms);
	send({
		type: 'queryResult',
		generation,
		id,
		ids: candidates ? [...candidates] : [],
		ms: Math.round(ms * 100) / 100,
		fullScanFallback: candidates === null
	});
};

workerScope.addEventListener('message', event => {
	const message = event.data;
	switch (message.type) {
	case 'connect':
		if (!corpusWorkerProtocolCompatible(message.protocolVersion)) {
			send({
				type: 'protocolMismatch',
				generation: message.generation,
				expectedProtocolVersion: CORPUS_WORKER_PROTOCOL_VERSION,
				receivedProtocolVersion: corpusWorkerProtocolVersion(message.protocolVersion)
			});
			break;
		}
		generation = message.generation;
		syncMode = message.syncMode;
		currentDevMode = message.devMode;
		currentOwnerID = message.ownerID;
		currentOwnershipEpoch = message.ownershipEpoch;
		if (!firebaseReady) {
			//The page acquired the origin-wide lease before this worker was
			//created, so persistent single-tab ownership is safe to claim here.
			firebaseReady = Promise.resolve(connectFirebase(message.devMode, message.persist, message.emulatorTarget));
		}
		void firebaseReady.then(() => {
			if (generation === message.generation) connectCards(message.mayViewUnpublished, message.uid);
		});
		break;
	case 'reconnect':
		generation = message.generation;
		void (firebaseReady || Promise.resolve()).then(() => {
			if (generation === message.generation) connectCards(message.mayViewUnpublished, message.uid);
		});
		break;
	case 'spike':
		spike();
		break;
	case 'query':
		runQuery(message.id, message.text);
		break;
	case 'action': {
		const action = fromWire(message.action, (seconds, nanoseconds) => new Timestamp(seconds, nanoseconds)) as SomeAction;
		if (action.type === RECONCILE_CARDS_AFTER_FAILED_COMMIT) {
			//Authoritative content for the CORPUS — but NOT for the
			//watermark: this can arrive before boot derives sessionWatermark
			//(polluting the bound with ~now and permanently skipping
			//edits-while-away), and the snapshot is serialized from the main
			//thread's SDK view, which overlays pending local writes with
			//client-clock estimates. Keep the ids excluded until a real
			//server listener snapshot confirms them (the delta listener
			//clears the exclusion on delivery).
			for (const id of Object.keys(action.cards)) clientClockCardIDs.add(id);
			for (const id of action.removedIDs) clientClockCardIDs.delete(id);
			updateLocalState(action.cards, action.removedIDs);
			break;
		}
		if (action.type === ECHO_LOCAL_CARD_MODIFICATIONS) {
			//The main thread just committed these cards; apply them to the
			//corpus immediately instead of waiting for the server echo. The
			//cards were materialized from Redux state, which strips
			//nlp_search_tokens — preserve the corpus copy's tokens so a
			//non-content change doesn't knock the card out of the index.
			const echoCards : Cards = {};
			for (const [id, card] of Object.entries(action.cards)) {
				const previous = corpus.get(id);
				echoCards[id] = (previous && searchTokensForCard(previous).length && !searchTokensForCard(card).length)
					? {...card, nlp_search_tokens: previous.nlp_search_tokens}
					: card;
			}
			//Echo timestamps are client-clock sentinels: exclude these ids
			//from watermark derivation until a server snapshot confirms them.
			for (const id of Object.keys(echoCards)) clientClockCardIDs.add(id);
			updateLocalState(echoCards, []);
			break;
		}
		engine.applyAction(action);
		subscriptions.markDirty();
		break;
	}
	case 'hydrateCollectionState':
		engine.hydrateCollectionState(fromWire(message.hydration, (seconds, nanoseconds) => new Timestamp(seconds, nanoseconds)) as import('./worker-protocol.js').CollectionStateHydration);
		subscriptions.markDirty();
		break;
	case 'configureCollections':
		engine.configureCollections(message.fallbacks, message.startCards);
		subscriptions.markDirty();
		break;
	case 'subscribeCollection':
		subscriptions.subscribe(message.subscriptionID, {
			description: message.description,
			keyCardID: message.keyCardID,
			uid: message.uid,
			randomSalt: message.randomSalt,
			cardSimilarity: message.cardSimilarity
		});
		break;
	case 'unsubscribeCollection':
		subscriptions.unsubscribe(message.subscriptionID);
		break;
	case 'setEditingCard':
		//Re-push subscriptions so open collections and reference blocks
		//reflect the new editing content immediately.
		if (engine.setEditingCard(message.card, message.similarity)) subscriptions.markDirty();
		break;
	case 'runCollection': {
		const start = performance.now();
		try {
			const result = engine.runCollection(message.description, {
				keyCardID: message.keyCardID,
				uid: message.uid,
				randomSalt: message.randomSalt,
				cardSimilarity: message.cardSimilarity
			});
			recordWorkerPerf('runCollection', performance.now() - start);
			send({
				type: 'runCollectionResult',
				generation,
				id: message.id,
				ids: result.ids,
				labels: result.labels,
				numCards: result.numCards,
				numStartCards: result.numStartCards,
				isFallback: result.isFallback,
				preview: result.preview,
				partialMatches: result.partialMatches,
				ms: Math.round((performance.now() - start) * 10) / 10
			});
		} catch (e) {
			send({type: 'error', generation, message: `runCollection(${message.description}): ${String(e)}`});
			//The failure reply MUST carry the request id: an error without it
			//left the bridge's pending promise unresolved forever, freezing
			//reference blocks on the previous card's results and leaking a
			//Map entry per state change while a throwing description stayed
			//active.
			send({type: 'runCollectionResult', generation, id: message.id, ids: [], labels: [], numCards: 0, numStartCards: 0, isFallback: false, preview: false, partialMatches: {}, ms: 0, failed: true});
		}
		break;
	}
	case 'requestCorpusIDs':
		send({type: 'corpusIDs', generation, ids: [...corpus.keys()]});
		break;
	case 'perfData':
		//PERF HARNESS ONLY: reply with a snapshot of worker-scoped timing.
		send({type: 'perfDataResult', generation, id: message.id, actionStats: workerPerf, indexBuildMs: Math.round(indexBuildMs * 10) / 10});
		break;
	case 'perfReset':
		//PERF HARNESS ONLY: zero the accumulator before the interaction script.
		//indexBuildMs is a cumulative boot metric; leave it (it reflects ingest
		//cost incurred before the reset and is reported alongside, not reset).
		workerPerf = {};
		break;
	}
});

//The engine's similar-card filters trigger similarity fetches as a side
//effect; only the main thread can perform them, so forward the request over
//the bridge. Deduped with a TTL rather than a permanent set: the filter
//re-fires on every run until similarity data arrives, so a permanent entry
//meant one failed fetch disabled similarity for that card until reload.
//After the TTL, a later filter run may re-request; the TTL itself is not a
//timer and deliberately does not create background work. Once data lands the
//filter stops asking entirely, so a satisfied request generates no further
//traffic.
const SIMILARITY_REQUEST_RETRY_MS = 60 * 1000;
const requestedSimilarityCardIDs : Map<CardID, number> = new Map();
setSimilarityRequestHandler((cardID, editingCard) => {
	if (editingCard) {
		//Editing-card content requests: the filter's own editing-card
		//identity guard already dedupes per content version, and each new
		//version SHOULD refetch — so the cardID TTL below must not apply.
		send({type: 'requestSimilarity', generation, cardID, forEditingCard: true});
		return;
	}
	const now = Date.now();
	const requestedAt = requestedSimilarityCardIDs.get(cardID);
	if (requestedAt !== undefined && now - requestedAt < SIMILARITY_REQUEST_RETRY_MS) return;
	requestedSimilarityCardIDs.set(cardID, now);
	send({type: 'requestSimilarity', generation, cardID});
});

send({type: 'ready', generation, protocolVersion: CORPUS_WORKER_PROTOCOL_VERSION});

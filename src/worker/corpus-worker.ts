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
	SyncMeta,
	emptySyncMeta
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
	ngrams,
	CURRENT_NLP_VERSION,
	nlpSourceFingerprintForCard
} from '../../shared/nlp.js';

import {
	processedRunsForCardField
} from '../nlp.js';

import {
	backportFallbackTextMapForCard
} from '../util.js';

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
	QueryEngine,
	queryTokensForText
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
	CorpusSnapshotStore,
	CorpusSnapshot,
	corpusSnapshotKey,
	snapshotEligibleCard,
	snapshotScopeForSession
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

//Same global, typed for the failure listeners below. Kept separate so the
//message-handling surface above stays exactly as narrow as it was.
const workerFailureScope = globalThis as unknown as {
	addEventListener: (type : 'unhandledrejection' | 'error', listener : (event : {reason? : unknown, message? : unknown}) => void) => void,
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
//Search-recall lifecycle. The index narrows every find query from O(corpus)
//to O(candidates) (see search-index.ts), but building it over 40k cards costs
//seconds — so it is built CHUNKED in the background after the prime hands
//off, never synchronously on a query. Until 'ready' the engine runs full
//scans exactly as before; card updates meanwhile accumulate in the dirty set
//and are drained before the flip to ready.
type SearchRecallState = 'idle' | 'building' | 'ready';
let searchRecallState : SearchRecallState = 'idle';
let searchRecallBuildToken = 0;
const searchRecallAlwaysScan : Set<CardID> = new Set();
const searchRecallDirtyIDs : Set<CardID> = new Set();
const engine = new QueryEngine();
//See the watermark invariant below. Kept next to corpus because the compact
//snapshot must persist and restore this set atomically with the cards.
const clientClockCardIDs : Set<CardID> = new Set();

//Mark every parsed doc that is overlaid by a locally pending write as
//watermark-poison. Applies to EVERY ingest path — listeners, cache primes,
//partition repairs, and cold-sweep server reads all receive latency-
//compensated overlays whose serverTimestamp() fields carry the client clock.
const contaminatePendingWriteIDs = (pendingWriteIDs : Set<CardID>) => {
	for (const id of pendingWriteIDs) clientClockCardIDs.add(id);
};
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

//--- Search recall (find narrowing) -----------------------------------------

//Fields whose query-scorable text is derived locally at load time (from
//references/backported titles) rather than covered by the save-time
//nlp_search_tokens or the nlp fingerprint. Their tokens must be indexed here
//or a card matching only via, say, a newly added inbound reference title
//would be recall-missed.
const REFERENCE_RECALL_FIELDS = ['references_info_inbound', 'non_link_references', 'concept_references'] as const;

const referenceRecallTokens = (card : Card) : string[] => {
	const allCards = engine.rawCards;
	const fallbackText = backportFallbackTextMapForCard(card, allCards) || {};
	const withFallback = {...card, fallbackText};
	const out : string[] = [];
	for (const fieldName of REFERENCE_RECALL_FIELDS) {
		for (const run of processedRunsForCardField(withFallback, fieldName)) {
			const stemmed = run.stemmed;
			if (!stemmed) continue;
			for (const word of stemmed.split(' ')) {
				if (word) out.push(word);
			}
			for (const bigram of ngrams(stemmed, 2)) out.push(bigram);
		}
	}
	return out;
};

//null → the card must always be scanned: missing or stale stored tokens mean
//the full processing path would re-derive text the index cannot see.
const recallTokensForCard = (card : Card) : string[] | null => {
	if (card.nlp_version !== CURRENT_NLP_VERSION) return null;
	//Cards saved or migrated before the fingerprint field existed carry
	//current tokens with NO fingerprint (observed: virtually the whole real
	//corpus): token generation and content were last written together, so
	//absence is not drift. A PRESENT-but-mismatched fingerprint is — every
	//post-fingerprint client save stamps both, so a mismatch means the
	//content changed through a path that skipped token regeneration.
	if (card.nlp_source_fingerprint !== undefined && card.nlp_source_fingerprint !== nlpSourceFingerprintForCard(card)) return null;
	const stored = searchTokensForCard(card);
	if (!stored.length) return null;
	return [...stored, ...referenceRecallTokens(card)];
};

const applyRecallEntry = (id : CardID, card : Card) => {
	const tokens = recallTokensForCard(card);
	if (tokens) {
		searchRecallAlwaysScan.delete(id);
		index.updateCard(id, tokens);
	} else {
		index.removeCard(id);
		searchRecallAlwaysScan.add(id);
	}
};

//MessageChannel yield: unlike nested setTimeout(0) it is not 4ms-clamped, so
//slices keep a high duty cycle while still letting every queued message
//(runCollection, deltas, teardown) run between them.
const yieldToWorkerQueue = () : Promise<void> => new Promise(resolve => {
	const channel = new MessageChannel();
	channel.port1.onmessage = () => resolve();
	channel.port2.postMessage(0);
});

const SEARCH_RECALL_SLICE_MS = 12;
//Low duty cycle while the initial load is still delivering: boot work owns
//the loop; recall is strictly background.
const SEARCH_RECALL_BOOT_GAP_MS = 40;
let searchRecallProgressSentAt = 0;

const sendSearchRecallProgress = (built : number, total : number, force = false) => {
	const now = performance.now();
	if (!force && now - searchRecallProgressSentAt < 400) return;
	searchRecallProgressSentAt = now;
	send({type: 'searchRecall', generation, built, total, ready: searchRecallState === 'ready'});
};

const scheduleSearchRecallBuild = () => {
	if (searchRecallState !== 'idle') return;
	searchRecallState = 'building';
	void buildSearchRecall();
};

const resetSearchRecall = () => {
	searchRecallBuildToken++;
	searchRecallState = 'idle';
	searchRecallDirtyIDs.clear();
	searchRecallAlwaysScan.clear();
	index = new SearchIndex();
	engine.setSearchRecall(null, null);
};

const buildSearchRecall = async () => {
	const myConnectionGeneration = connectionGeneration;
	const myToken = ++searchRecallBuildToken;
	const startedAt = performance.now();
	const ids = [...corpus.keys()];
	const total = ids.length;
	let built = 0;
	let sliceStart = performance.now();
	const aborted = () => myConnectionGeneration !== connectionGeneration || myToken !== searchRecallBuildToken;
	for (const id of ids) {
		if (aborted()) return;
		const card = corpus.get(id);
		if (card) applyRecallEntry(id, card);
		searchRecallDirtyIDs.delete(id);
		built++;
		if (performance.now() - sliceStart >= SEARCH_RECALL_SLICE_MS) {
			sendSearchRecallProgress(built, total);
			if (initialLoadPending) await new Promise<void>(resolve => setTimeout(resolve, SEARCH_RECALL_BOOT_GAP_MS));
			await yieldToWorkerQueue();
			sliceStart = performance.now();
		}
	}
	//Drain updates that landed mid-build before declaring the index complete.
	while (searchRecallDirtyIDs.size) {
		if (aborted()) return;
		for (const id of [...searchRecallDirtyIDs].slice(0, 200)) {
			searchRecallDirtyIDs.delete(id);
			const card = corpus.get(id);
			if (card) applyRecallEntry(id, card);
			else {
				index.removeCard(id);
				searchRecallAlwaysScan.delete(id);
			}
		}
		await yieldToWorkerQueue();
	}
	if (aborted()) return;
	searchRecallState = 'ready';
	engine.setSearchRecall(index, searchRecallAlwaysScan);
	const elapsed = performance.now() - startedAt;
	indexBuildMs += elapsed;
	recordWorkerPerf('indexBuild', elapsed);
	sendSearchRecallProgress(total, total, true);
	status(`search recall ready: ${index.cardCount} indexed, ${searchRecallAlwaysScan.size} always-scan, in ${elapsed.toFixed(0)}ms wall (chunked)`);
};

//Every boot-timing estimate about the path to `live` was unfalsifiable because
//status lines carried no time at all. Stamp each one with ms since this
//connection started, and emit one summary on `live` — so the decomposition of
//"8s to usable, ~27s to live" is a measurement rather than an argument.
let connectStartedAt = 0;
const bootCheckpoints : {label : string, at : number}[] = [];

const sinceConnect = () : number => connectStartedAt ? Math.round(performance.now() - connectStartedAt) : 0;

export const markBootCheckpoint = (label : string) : void => {
	if (!connectStartedAt) return;
	bootCheckpoints.push({label, at: sinceConnect()});
};

const status = (message : string) => send({type: 'status', generation, message: `+${sinceConnect()}ms ${message}`});

//Age of the compact snapshot this session primed from; null when primed from
//the server. Reported with loadComplete so the UI can show staleness.
let primedSnapshotAgeMs : number | null = null;

//Terminal, user-visible degradation. The protocol, the bridge handler and a
//proper "Cards could not load / Reload and retry" panel all existed, but NO
//worker code ever sent this message — every worker-side failure exited as a
//`status` that reached only console.log. Anything that leaves this worker
//unable to keep the corpus in sync must say so here.
const degraded = (reason : string, blocking = true) => send({type: 'degraded', generation, reason, blocking});

//A worker's unhandled rejection does NOT propagate to worker.onerror on the
//page, and there was no handler here — so a throw inside any of the several
//`void`ed boot-critical promises (gateAndProceed, connectUnpublishedWatermark,
//afterColdSweep) stopped verification permanently with no retry armed and no
//error visible anywhere, on either thread. At minimum, say so.
workerFailureScope.addEventListener('unhandledrejection', event => {
	const reason = event.reason;
	status(`unhandled worker rejection: ${String((reason as Error)?.stack || reason)}`);
	degraded('Card sync hit an unexpected error and may be incomplete. Reload to retry.');
});

workerFailureScope.addEventListener('error', event => {
	status(`worker error: ${String(event.message || event)}`);
	degraded('Card sync hit an unexpected error and may be incomplete. Reload to retry.');
});

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
//Same duty-cycle shape as the search-recall build: long enough to make
//progress, short enough that a queued message is never starved.
const SNAPSHOT_SERIALIZE_SLICE_MS = 12;
//Incremented by updateLocalState, the ONLY place the corpus is mutated.
let corpusMutationVersion = 0;
let corpusSnapshotStore : CorpusSnapshotStore | null = null;
let corpusSnapshotPersistenceEnabled = false;
let corpusSnapshotSaveTimer : ReturnType<typeof setTimeout> | null = null;
let corpusSnapshotSaveInFlight = false;
let corpusSnapshotSavePending = false;
let ownershipEpochGuard : ReturnType<typeof setInterval> | null = null;
//Give up persisting after this many consecutive failures. Retrying a quota
//error forever costs a full-corpus deep clone per attempt and never succeeds.
const MAX_SNAPSHOT_SAVE_FAILURES = 3;
let consecutiveSnapshotSaveFailures = 0;
//Bound the abandon-and-retry loop; see saveCorpusSnapshot.
const MAX_SNAPSHOT_ABANDONS = 3;
let consecutiveSnapshotAbandons = 0;

const saveCorpusSnapshot = async () : Promise<void> => {
	//A READER (published-only) session legitimately has no syncMetaState: it
	//runs no tombstone or delta plane, because its published listener is a
	//FULL-SET query whose first server-confirmed delivery is the complete
	//authoritative corpus for this scope. Reconciliation against that set
	//repairs any stale snapshot wholesale, so there is no cursor to carry.
	if (!corpusSnapshotPersistenceEnabled || !corpusSnapshotStore) return;
	if (!syncMetaState && currentMayViewUnpublished) return;
	if (corpusSnapshotSaveInFlight) {
		corpusSnapshotSavePending = true;
		return;
	}
	corpusSnapshotSaveInFlight = true;
	corpusSnapshotSavePending = false;
	const startedAt = performance.now();
	//The serialization below yields, so a connection change mid-walk must
	//abandon this record rather than persist a mixture.
	const myGeneration = generation;
	//Keep search tokens in this worker-only representation: rebuilding them
	//from content would erase most of the warm-boot win. Timestamp markers make
	//the record independent of Firestore prototype structured-cloning behavior.
	//Sliced, not one uninterruptible run: the walk allocates a wire object per
	//card (~2.6s at 40,225) and blocked every collection push — keyboard
	//navigation and find results both waited.
	//
	//But yielding mid-walk means the corpus can CHANGE under us, and an earlier
	//comment here wrongly claimed the result was still coherent "because the
	//cards are read from `corpus` as we go" — that is precisely what makes it
	//incoherent. A delta landing after a card was serialized yields a record
	//mixing versions; the watermark derived from it on the next boot could then
	//be newer than an update the snapshot is missing, and the count-based trust
	//gate compares membership, not versions, so nothing would catch it.
	//
	//So: abandon and reschedule if the corpus mutates during the walk. The 15s
	//debounce means the retry coalesces with whatever else is happening, and an
	//actively-churning corpus simply defers persistence rather than persisting
	//a lie. Progress is guaranteed because edits are bursty, not continuous.
	const startVersion = corpusMutationVersion;
	const cards : {[id : string] : unknown} = {};
	//A published-only session's snapshot is keyed WITHOUT a uid, because
	//published content is identical for every viewer and is therefore safely
	//shared between them. That sharing is only sound if the record contains
	//nothing viewer-specific: a signed-in non-privileged user also runs
	//author/editor listeners, so their own unpublished cards are in this
	//corpus, and writing those into the shared record would leak them to the
	//next anonymous visitor on this device. Persist only the published subset.
	//Same single decision that chose the key this record is written under.
	const scope = snapshotScopeForSession(currentMayViewUnpublished);
	let sliceStart = performance.now();
	for (const [id, card] of corpus.entries()) {
		if (!snapshotEligibleCard(card, scope)) continue;
		cards[id] = toWire(card, isTimestamp, getTime);
		if (performance.now() - sliceStart < SNAPSHOT_SERIALIZE_SLICE_MS) continue;
		await yieldToWorkerQueue();
		//These early returns are ABOVE the try/finally that clears the in-flight
		//flag, so they must clear it themselves or every later save is blocked
		//for the life of the worker.
		if (myGeneration !== generation) {
			corpusSnapshotSaveInFlight = false;
			return;
		}
		if (corpusMutationVersion !== startVersion) {
			corpusSnapshotSaveInFlight = false;
			consecutiveSnapshotAbandons++;
			//Do not abandon forever. Under continuous mutation every attempt
			//would restart and the snapshot would never be written at all,
			//which is worse than a slightly-mixed record: the next boot falls
			//back to an ever-older snapshot, and a crash loses everything since
			//the last successful save. After a few tries, let the walk complete
			//— the trust gate and delta catch-up heal a mixed record, they
			//cannot heal a missing one.
			if (consecutiveSnapshotAbandons >= MAX_SNAPSHOT_ABANDONS) {
				status(`compact snapshot: ${consecutiveSnapshotAbandons} restarts from concurrent edits; completing this one anyway`);
			} else {
				status('compact snapshot save restarted: the corpus changed while serializing');
				scheduleCorpusSnapshotSave();
				return;
			}
		}
		sliceStart = performance.now();
	}
	//Re-check after the final slice too: the last yield may have been followed
	//by a mutation before the loop ended.
	if (corpusMutationVersion !== startVersion && consecutiveSnapshotAbandons < MAX_SNAPSHOT_ABANDONS) {
		corpusSnapshotSaveInFlight = false;
		consecutiveSnapshotAbandons++;
		status('compact snapshot save restarted: the corpus changed while serializing');
		scheduleCorpusSnapshotSave();
		return;
	}
	consecutiveSnapshotAbandons = 0;
	const contaminatedIDs = [...clientClockCardIDs].filter(id => corpus.has(id));
	//Capture every safety field synchronously with the cards, before the first
	//await. A later worker event may mutate live state, but the record remains a
	//coherent earlier checkpoint rather than cards from one instant plus bounds
	//from another.
	const processedTombstoneIDs = syncMetaState ? [...syncMetaState.processedTombstoneIDs] : [];
	const tombstoneCursor = syncMetaState?.tombstoneCursor ? {...syncMetaState.tombstoneCursor} : null;
	const watermarkClamp = syncMetaState?.watermarkClamp ? {...syncMetaState.watermarkClamp} : null;
	try {
		await corpusSnapshotStore.save(cards, contaminatedIDs, processedTombstoneIDs, tombstoneCursor, watermarkClamp,
			(latestSections || latestTags) ? {sections: latestSections || {}, tags: latestTags || {}} : undefined);
		consecutiveSnapshotSaveFailures = 0;
		status(`compact snapshot saved: ${Object.keys(cards).length} cards in ${(performance.now() - startedAt).toFixed(0)}ms`);
	} catch (e) {
		//`transaction.error` is null on a deliberate abort, so String(e) can
		//read literally "null"; name the case instead.
		const reason = String(e) === 'null' ? 'ownership changed during the write' : String(e);
		consecutiveSnapshotSaveFailures++;
		status(`compact snapshot save unavailable (${reason})`);
		if (consecutiveSnapshotSaveFailures >= MAX_SNAPSHOT_SAVE_FAILURES) {
			//Stop. Each attempt deep-clones the whole ~40k-card corpus before
			//its first await and then structured-clones it again, so an
			//unfixable failure (quota exhausted, storage disabled) was an
			//endless full-corpus copy every 15s, forever, while the user was
			//never told that warm boot had silently stopped working.
			corpusSnapshotPersistenceEnabled = false;
			//NON-BLOCKING: everything the user can do still works; only the next
			//boot is slower. Routing this through the blocking path put the
			//whole app behind a modal headlined "Cards could not load" whose own
			//body said the app still works, offering a reload that cannot fix a
			//quota condition. The raw exception stays in the log, not on screen.
			console.warn('[corpus-worker] snapshot persistence disabled:', reason);
			degraded('Card sync can\'t save its local cache, so startup will be slow until browser storage is available again. Everything else works normally.', false);
			return;
		}
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

//The debounce RESETS on every corpus mutation, and updateLocalState calls this
//on every delivery — so during sustained mutation (a bulk sweep, a heavy editing
//hour, a listener re-attach storm) the timer could be pushed forward forever and
//the snapshot would simply never be written. The abandon-on-mutation guard in
//saveCorpusSnapshot compounds it. The justification for the plain debounce was
//"edits are bursty, not continuous", which is a t=0 assumption that a long
//session violates. A max-wait bounds the deferral: once the FIRST deferral is
//this old, the next schedule fires immediately regardless of churn. Same shape
//as card-view's reference-block scheduler, which already had this guard.
const SNAPSHOT_SAVE_MAX_WAIT_MS = 90 * 1000;
let corpusSnapshotFirstDeferralAt = 0;

const scheduleCorpusSnapshotSave = (delayMs = SNAPSHOT_SAVE_DELAY_MS) => {
	if (!corpusSnapshotPersistenceEnabled || !corpusSnapshotStore) return;
	if (corpusSnapshotSaveInFlight) {
		corpusSnapshotSavePending = true;
		return;
	}
	const now = Date.now();
	if (!corpusSnapshotSaveTimer) corpusSnapshotFirstDeferralAt = now;
	const waited = now - corpusSnapshotFirstDeferralAt;
	const effectiveDelay = waited >= SNAPSHOT_SAVE_MAX_WAIT_MS ? 0 : Math.min(delayMs, SNAPSHOT_SAVE_MAX_WAIT_MS - waited);
	if (corpusSnapshotSaveTimer) clearTimeout(corpusSnapshotSaveTimer);
	corpusSnapshotSaveTimer = setTimeout(() => {
		corpusSnapshotSaveTimer = null;
		corpusSnapshotFirstDeferralAt = 0;
		void saveCorpusSnapshot();
	}, effectiveDelay);
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
	//ANNOUNCE BEFORE CLOSING. workerScope.close() fires no `error` event on the
	//parent and the parent never calls terminate(), so without this the page
	//kept `worker` truthy, `workerLoadComplete` true and `lastSyncState` at
	//'live' — a green "Card sync: live" dot over a worker that no longer
	//exists, with saves still enabled and every newly-requested collection
	//permanently empty. A superseded worker is a legitimate state, but the page
	//has to know it happened.
	degraded(`Card sync stopped in this tab: ${message}`);
	workerScope.close();
};

const parseSnapshot = (snapshot : QuerySnapshot) : {cards : Cards, removedIDs : CardID[], pendingWriteIDs : Set<CardID>} => {
	const cards : Cards = {};
	const removedIDs : CardID[] = [];
	const pendingWriteIDs = new Set<CardID>();
	snapshot.docChanges().forEach(change => {
		if (change.type === 'removed') {
			removedIDs.push(change.doc.id);
			return;
		}
		const id : CardID = change.doc.id;
		const card : Card = {...change.doc.data({serverTimestamps: 'estimate'}), id} as Card;
		cards[id] = card;
		//Even getDocsFromServer results overlay locally pending writes, whose
		//serverTimestamp() fields materialize with the CLIENT clock. Callers
		//must treat these ids as watermark-poison (clientClockCardIDs).
		if (change.doc.metadata.hasPendingWrites) pendingWriteIDs.add(id);
	});
	return {cards, removedIDs, pendingWriteIDs};
};

//KNOWN LATENT, deliberately NOT guarded here. ingestSnapshot version-guards its
//writes, but five paths reach the corpus without it (server prime, cold-sweep
//priority phase, each cold-sweep page, partition repair, the delta listener), so
//a page read at t0 landing after a listener delivered a newer version at t1 can
//roll a card backward.
//
//A monotonic `updated` filter here was tried and REVERTED, because it is wrong
//in two ways that are worse than the disease:
//  1. Every server-delivery path clears the card's clientClockCardIDs exemption
//     IMMEDIATELY BEFORE calling this (see ingestSnapshot and the delta
//     listener), so the comparison the exemption exists to prevent — a
//     client-clock `previous` against a server `incoming` — is exactly the one
//     that runs. With any positive client clock skew, the authoritative server
//     version of the user's own just-saved card is the thing that gets dropped.
//  2. Callers invoke forwardBatch with the SAME cards object, so a card filtered
//     out here still reaches Redux. The worker corpus and the main thread would
//     silently disagree — and the worker's stale copy then feeds
//     deriveSessionWatermark, poisoning the delta bound.
//A correct fix has to filter the batch at the call sites (so the corpus and the
//forward agree) and compare against a timestamp that is known to be
//server-issued. Left as a tracked item rather than shipped half-right.
const updateLocalState = (cards : Cards, removedIDs : CardID[], suppressMetaSend = false) => {
	const indexStart = performance.now();
	//Bumped on every corpus mutation. The compact-snapshot serialization yields
	//mid-walk, so it needs to know whether the thing it is copying changed
	//underneath it (see saveCorpusSnapshot).
	if (Object.keys(cards).length || removedIDs.length) corpusMutationVersion++;
	for (const [id, card] of Object.entries(cards)) {
		const previous = corpus.get(id);
		if (previous && searchTokensForCard(previous).length) cardsWithStoredTokens--;
		corpus.set(id, card);
		if (searchTokensForCard(card).length) cardsWithStoredTokens++;
	}
	for (const id of removedIDs) {
		corpus.delete(id);
	}
	//The engine keeps its own plain-object mirror (identity-preserving per
	//card) plus filter membership via the real reducer. Strip the ephemeral
	//search tokens just like main-thread Redux does, so processing and filter
	//behavior match exactly.
	engine.updateCards(Object.fromEntries(Object.entries(cards).map(([id, card]) => [id, stripForWire(card)])), removedIDs);
	//Recall maintenance runs AFTER the engine mirror updates so reference
	//backport for this batch resolves against current sibling cards.
	if (searchRecallState === 'ready') {
		for (const [id, card] of Object.entries(cards)) applyRecallEntry(id, card);
		for (const id of removedIDs) {
			index.removeCard(id);
			searchRecallAlwaysScan.delete(id);
		}
	} else {
		for (const id of Object.keys(cards)) searchRecallDirtyIDs.add(id);
		for (const id of removedIDs) searchRecallDirtyIDs.add(id);
	}
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
	send({type: 'loadComplete', generation, corpusSize: corpus.size, snapshotAgeMs: primedSnapshotAgeMs});
	status(`initial load complete: ${corpus.size} cards in corpus`);
	//The corpus is settled: promote the background search-recall build to its
	//full duty cycle (idempotent if the prime handoff already kicked it).
	scheduleSearchRecallBuild();
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
	//Server delivery: these entries are no longer client-clock contaminated —
	//EXCEPT docs still overlaid by a pending local write, whose estimate
	//timestamps remain client-clock even in server snapshots.
	if (!snapshot.metadata.fromCache) {
		for (const id of Object.keys(cards)) {
			if (!parsed.pendingWriteIDs.has(id)) clientClockCardIDs.delete(id);
		}
		for (const id of removedIDs) clientClockCardIDs.delete(id);
	}
	contaminatePendingWriteIDs(parsed.pendingWriteIDs);
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
	//Per-connection repair bookkeeping; a genuine reconnect should be allowed
	//to repair the same partitions again.
	lastRepairSignature = '';
	for (const unsubscribe of unsubscribes) unsubscribe();
	unsubscribes.length = 0;
	//These are not in `unsubscribes`: that list belongs to the resilient
	//card-listener machinery, whose re-attach logic does not apply here.
	disconnectUserState();
	disconnectSupplementalData();
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
	//Replaced on every re-attach so the dead handle is dropped rather than
	//accumulating: with a 60s max backoff an 8-hour outage left ~2,400 stale
	//closures in `unsubscribes`, all of which teardownListeners then invoked.
	let myUnsubscribe : (() => void) | null = null;
	const attach = () => {
		if (myConnectionGeneration !== connectionGeneration) return;
		const handler = makeHandler();
		if (myUnsubscribe) {
			const index = unsubscribes.indexOf(myUnsubscribe);
			if (index >= 0) unsubscribes.splice(index, 1);
			myUnsubscribe = null;
		}
		myUnsubscribe = onSnapshot(
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
		);
		unsubscribes.push(myUnsubscribe);
	};
	attach();
};

//PERF HARNESS ONLY: the fixed demo project the emulator namespaces the seeded
//corpus under. Must match src/firebase.ts's PERF_EMULATOR_PROJECT_ID so the
//worker, the main thread, and the seeded corpus all share one emulator
//namespace (the Firestore emulator namespaces data by projectId).
const PERF_EMULATOR_PROJECT_ID = 'demo-perf';

//S4, the half sign-out cannot do. Firestore's persistentLocalCache is a second,
//larger copy of the privileged corpus and it survives sign-out. Clearing it in
//place is impossible here for TWO reasons, not one:
//
//  1. clearIndexedDbPersistence() is legal only on an uninitialized or
//     terminated instance, and connectCards proceeds synchronously to
//     connectPublished() for the signed-out reader, which needs a live `db`.
//  2. It does not work in a worker AT ALL. SimpleDb.delete calls
//     `window.indexedDB.deleteDatabase` (@firebase/firestore 4.6.0,
//     dist/index.esm2017.js:1664) and a dedicated worker has no `window`, so
//     the call rejects with a ReferenceError inside the SDK's own catch and the
//     cache SILENTLY SURVIVES. An earlier attempt at this would have logged
//     success while deleting nothing. Re-check that line on any SDK upgrade.
//
//So the bridge records the intent at sign-out and it is honored HERE, before
//initializeApp, in the one moment when nothing has opened the database yet.
//
//Name mirrors the SDK's indexedDbStoragePrefix(databaseId, persistenceKey) +
//'main'. The persistence key is the Firebase app NAME, which we deliberately
//keep at the default (see the comment on initializeApp below).
const firestorePersistenceDatabaseName = (projectID : string) => `firestore/[DEFAULT]/${projectID}/main`;

//deleteDatabase does NOT error when another connection holds the database open:
//it fires `blocked` and then waits, indefinitely. Boot must not hang on that,
//so give up after a bounded wait and leave the request for the next boot.
const PERSISTENCE_PURGE_TIMEOUT_MS = 5000;

const deleteDatabaseWithTimeout = (name : string) : Promise<'purged' | 'blocked' | 'failed'> => new Promise(resolve => {
	let settled = false;
	const finish = (result : 'purged' | 'blocked' | 'failed') => {
		if (settled) return;
		settled = true;
		resolve(result);
	};
	const timer = setTimeout(() => finish('blocked'), PERSISTENCE_PURGE_TIMEOUT_MS);
	try {
		const request = indexedDB.deleteDatabase(name);
		request.onsuccess = () => { clearTimeout(timer); finish('purged'); };
		request.onerror = () => { clearTimeout(timer); finish('failed'); };
		//Deliberately does not settle: `blocked` only means someone else still
		//holds it open, and the delete may yet complete when they close. Let
		//the timeout decide.
		request.onblocked = () => status(`Firestore cache purge blocked by another connection (${name}); waiting`);
	} catch {
		clearTimeout(timer);
		finish('failed');
	}
});

const connectFirebase = async (devMode : boolean, persist : boolean, emulatorTarget? : string, purgePersistence = false) => {
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
	//Honored before initializeApp: no listeners exist, nothing has opened the
	//database, and everything downstream already waits on firebaseReady — so
	//this only makes that promise slower to resolve, and only on the one boot
	//that follows a sign-out.
	if (purgePersistence) {
		const result = await deleteDatabaseWithTimeout(firestorePersistenceDatabaseName(config.projectId || ''));
		//Per-uid metadata for the signed-out account: tombstone id lists and
		//cursors rather than card bodies, but it is the same account's data and
		//the cache it describes is going anyway.
		await deleteDatabaseWithTimeout('corpus-worker-meta');
		status(`signed-out Firestore cache purge: ${result}`);
		send({type: 'persistencePurge', generation, result});
	}
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

//Exactly ONE reader tab writes the shared published snapshot.
//
//The privileged path is single-tab by construction — the bridge's ownership
//lease keeps other tabs workerless — but readers deliberately have no lease,
//because a public visitor's second tab must keep working rather than be told
//the app moved. Two reader workers would therefore both write: their epoch is
//0, so CorpusSnapshotStore.claimOwnership accepts both (`epoch <= epoch`), and
//each save serializes the entire published corpus.
//
//A Web Lock is the right primitive and is deliberately requested WITHOUT
//`ifAvailable`: the request simply waits, so when the writing tab closes the
//role transfers to a waiting tab instead of being lost until the next boot.
//Held for the life of the worker; termination releases it.
const PUBLISHED_SNAPSHOT_WRITER_LOCK = 'corpus-published-snapshot-writer';

const claimPublishedSnapshotWriter = () => {
	//CorpusSnapshotStore.save() aborts its transaction unless a stored owner
	//record matches this instance's token, so a path that never claims writes
	//NOTHING — silently, reported only as "ownership changed during the write".
	//The privileged path claims as part of its epoch handshake; the reader path
	//has no epoch, so it must claim explicitly. The default token (ownerID '',
	//epoch 0) is sufficient BECAUSE the Web Lock below already guarantees a
	//single writer; the claim is what makes the write legal, not what arbitrates
	//between tabs.
	const enable = async () => {
		if (!corpusSnapshotStore) return;
		try {
			if (!await corpusSnapshotStore.claimOwnership()) {
				status('published snapshot ownership refused; not persisting this session');
				return;
			}
		} catch (err) {
			status(`published snapshot ownership unavailable (${String(err)}); not persisting this session`);
			return;
		}
		corpusSnapshotPersistenceEnabled = true;
		scheduleCorpusSnapshotSave(0);
	};
	const locks = navigator.locks;
	if (!locks) {
		//No Web Locks (older browser, or a non-secure context). Writing from
		//every reader tab is wasteful but not incorrect: each writer only
		//reaches here having passed the same server-confirmed trust gate, so
		//they agree on the contents.
		void enable();
		return;
	}
	void locks.request(PUBLISHED_SNAPSHOT_WRITER_LOCK, async () => {
		if (!corpusSnapshotStore) return;
		await enable();
		//Hold for the life of this worker.
		await new Promise<void>(() => { /* released on worker termination */ });
	}).catch(err => {
		status(`published snapshot writer lock unavailable (${String(err)}); persisting anyway`);
		void enable();
	});
};

//Prime a PUBLISHED-ONLY (reader) session from a compact snapshot, then attach
//the published listener.
//
//Anonymous visitors are the public site's primary audience and, before this,
//persisted nothing at all: Firestore inside a dedicated worker supports only
//persistentSingleTabManager({forceOwnership: true}), so a reader cannot be
//given the Firestore cache without contending for the one lease a signed-in
//owner tab will steal. The compact snapshot has no such constraint — it is the
//application's own IndexedDB record, already keyed by scope — so the published
//scope is served here and Firestore's cache stays exclusively the owner's.
//
//The record needs no uid: published content is identical for every viewer, so
//one shared record serves them all and survives anonymous-uid churn. See
//saveCorpusSnapshot for what keeps that sharing sound, and the read-side filter
//below, which is the half that makes a bad record recoverable.
//
//That sharing assumes `published == publicly readable`, which is true here but
//is a per-deployment property: the rules gate reads on userMayViewApp(), so a
//deployment that closes `viewApp` to a signed-in audience would be sharing a
//record between accounts that are all entitled to it — still sound — while a
//deployment that made `published` mean something narrower would not be.
//
//Staleness needs no cursor. The published listener is a FULL-SET query, so its
//first server-confirmed delivery is the complete authoritative corpus for this
//scope and publishedGhostIDs already reconciles anything the snapshot holds
//that the server does not — machinery that predates this and was written for
//exactly this shape.
const connectPublishedFromSnapshot = async () => {
	const myConnectionGeneration = connectionGeneration;
	try {
		const projectID = app?.options.projectId || (currentDevMode ? 'dev' : 'prod');
		corpusSnapshotStore = new CorpusSnapshotStore(corpusSnapshotKey(projectID, '', snapshotScopeForSession(currentMayViewUnpublished)));
	} catch {
		corpusSnapshotStore = null;
	}
	let compactSnapshot : CorpusSnapshot | null = null;
	try {
		compactSnapshot = corpusSnapshotStore ? await corpusSnapshotStore.load() : null;
	} catch (err) {
		//An unusable IndexedDB costs persistence only, never the session.
		status(`published compact snapshot unavailable (${String(err)}); serving from the network`);
		corpusSnapshotStore = null;
	}
	if (myConnectionGeneration !== connectionGeneration) return;
	const primedCards : Cards = {};
	primedSnapshotAgeMs = null;
	if (compactSnapshot && Object.keys(compactSnapshot.cards).length) {
		const ageMs = Date.now() - (compactSnapshot.savedAt || 0);
		primedSnapshotAgeMs = compactSnapshot.savedAt ? ageMs : null;
		const restored = fromWire(compactSnapshot.cards,
			(seconds, nanoseconds) => new Timestamp(seconds, nanoseconds)) as Cards;
		for (const [id, card] of Object.entries(restored)) {
			//RE-FILTER ON READ, not only on write. Both reconciliation paths
			//that could later remove a bad entry (publishedGhostIDs here, and
			//published-removals) are themselves conditioned on
			//`card.published`, so an unpublished card that ever reached this
			//SHARED record could never be removed by any of them — a permanent
			//leak. Checking again here costs one predicate per card and makes
			//the failure self-healing instead: a bad record is ignored on the
			//next boot and overwritten by the next save.
			if (!snapshotEligibleCard(card, snapshotScopeForSession(currentMayViewUnpublished))) continue;
			//Never overwrite fresher listener data with the saved base.
			if (!corpus.has(id)) primedCards[id] = card;
		}
		//The listener can beat this independent IndexedDB read; apply its
		//authoritative set so ghosts cannot arrive after its one-shot
		//reconciliation has already run.
		if (authoritativePublishedIDs) {
			for (const [id, card] of Object.entries(primedCards)) {
				if (card.published && !authoritativePublishedIDs.has(id)) delete primedCards[id];
			}
		}
	}
	//Serve sections and tags from the record too, so navigation exists offline
	//rather than sitting behind a stuck "Loading…". The listeners overwrite
	//these the moment the network answers.
	if (compactSnapshot && compactSnapshot.schemaVersion === 2) {
		if (compactSnapshot.sections && Object.keys(compactSnapshot.sections).length) {
			latestSections = compactSnapshot.sections;
			send({type: 'sections', generation, sections: compactSnapshot.sections});
		}
		if (compactSnapshot.tags && Object.keys(compactSnapshot.tags).length) {
			latestTags = compactSnapshot.tags;
			send({type: 'tags', generation, tags: compactSnapshot.tags});
		}
	}
	const primedCount = Object.keys(primedCards).length;
	if (primedCount) {
		updateLocalState(primedCards, [], true);
		forwardBatch(primedCards, [], 'published', true, false,
			engine.cardDerivedFilters(), [...corpus.keys()]);
		status(`published compact snapshot prime: ${primedCount} cards`);
		//Same reasoning as the privileged path: a compact snapshot is only ever
		//written after its corpus passed a trust gate, so it is known-complete
		//and the UI may render it while verification continues.
		if (primedCount >= WARM_CACHE_THRESHOLD) markInitialDelivered('published');
	}
	if (myConnectionGeneration !== connectionGeneration) return;
	connectPublished();
};

//PER-USER STATE (stars / reads / reading list).
//
//These used to run on the MAIN thread, which in worker modes holds only a
//memoryLocalCache — so it has no resume tokens and every boot re-read the whole
//result set. Measured on DEV for the owner's account: 608 `reads` documents,
//re-fetched in full on every single boot. The worker is the one context holding
//Firestore's persistent cache, so re-attaching here bills deltas instead.
//
//Deliberately forwarded as the same add/remove DELTAS the main thread used to
//derive from docChanges(), so the reducers on the other side are unchanged.
const STARS_COLLECTION = 'stars';
const READS_COLLECTION = 'reads';
const READING_LISTS_COLLECTION = 'reading_lists';

let userStateUnsubscribes : (() => void)[] = [];

//Backoff for re-attaching a per-user listener. Bounded and generation-checked so
//a superseded connection cannot resurrect listeners for the old session.
let userStateReattachDelayMs = 1000;
const MAX_USER_STATE_REATTACH_DELAY_MS = 30 * 1000;

const scheduleUserStateReattach = (attach : () => void) => {
	const myConnectionGeneration = connectionGeneration;
	const delay = userStateReattachDelayMs;
	userStateReattachDelayMs = Math.min(userStateReattachDelayMs * 2, MAX_USER_STATE_REATTACH_DELAY_MS);
	setTimeout(() => {
		if (myConnectionGeneration !== connectionGeneration) return;
		attach();
	}, delay);
};

const disconnectUserState = () => {
	for (const unsubscribe of userStateUnsubscribes) {
		try { unsubscribe(); } catch { /* already torn down */ }
	}
	userStateUnsubscribes = [];
};

//SECTIONS AND TAGS, for the same reason per-user state moved: the main thread
//runs a memoryLocalCache in worker modes, so these were re-read from the network
//on every boot and were simply ABSENT offline — while their `*Loaded` flags
//still said true and corpusStatus still said `live`, so navigation sat behind a
//stuck "Loading…" and anything gated on "sections loaded" ran against an empty
//set. The worker holds the persistent cache, so here they survive offline and
//re-attach on deltas.
const SECTIONS_COLLECTION = 'sections';
const TAGS_COLLECTION = 'tags';

let supplementalUnsubscribes : (() => void)[] = [];
//Latest sections/tags, kept so the compact snapshot can carry them. A reader's
//only persistence is that record, so without this they were absent offline.
let latestSections : {[id : string] : unknown} | null = null;
let latestTags : {[id : string] : unknown} | null = null;

const disconnectSupplementalData = () => {
	for (const unsubscribe of supplementalUnsubscribes) {
		try { unsubscribe(); } catch { /* already torn down */ }
	}
	supplementalUnsubscribes = [];
};

const connectSupplementalData = () => {
	disconnectSupplementalData();
	if (!db) return;
	const database = db;
	const myConnectionGeneration = connectionGeneration;
	const attach = (collectionName : string, type : 'sections' | 'tags', build : () => Query) => {
		supplementalUnsubscribes.push(onSnapshot(build(),
			snapshot => {
				if (myConnectionGeneration !== connectionGeneration) return;
				//Every doc, not just the changed ones. These maps are tiny, and
				//the page merges them, so a full map is a superset of what the
				//delta carried and removes any delta bookkeeping.
				const docs : {[id : string] : unknown} = {};
				for (const docSnapshot of snapshot.docs) docs[docSnapshot.id] = {...docSnapshot.data(), id: docSnapshot.id};
				if (type === 'sections') {
					latestSections = docs;
					send({type, generation, sections: docs});
				} else {
					latestTags = docs;
					send({type, generation, tags: docs});
				}
				//These arrive after the corpus is already live, so the record on
				//disk predates them until it is rewritten.
				scheduleCorpusSnapshotSave();
			},
			error => {
				status(`${collectionName} listener error: ${String(error)}; re-attaching`);
				scheduleUserStateReattach(() => attach(collectionName, type, build));
			}));
	};
	attach(SECTIONS_COLLECTION, 'sections', () => query(collection(database, SECTIONS_COLLECTION), orderBy('order')));
	attach(TAGS_COLLECTION, 'tags', () => query(collection(database, TAGS_COLLECTION)));
	status('sections and tags listeners attached');
};

const connectUserState = (uid : string) => {
	disconnectUserState();
	userStateReattachDelayMs = 1000;
	if (!db || !uid) return;
	const database = db;
	const myConnectionGeneration = connectionGeneration;
	//A card id per document, added or removed. Identical shape for stars and
	//reads, so one helper serves both.
	const cardIDDeltaListener = (collectionName : string, type : 'userStars' | 'userReads') => {
		//The FIRST snapshot after an attach is the whole result set, reported as
		//every document `added`. Sending that as a delta was wrong: the page
		//unions it in, and a union cannot express a removal — so a re-attach
		//re-added a star the user had just removed while their removal was still
		//queued, silently reversing the last thing they did. Send the full set
		//and say so.
		let firstDelivery = true;
		userStateUnsubscribes.push(onSnapshot(
			query(collection(database, collectionName), where('owner', '==', uid)),
			snapshot => {
				if (myConnectionGeneration !== connectionGeneration) return;
				if (firstDelivery) {
					firstDelivery = false;
					const all : CardID[] = [];
					for (const docSnapshot of snapshot.docs) {
						const cardID = docSnapshot.data().card as CardID;
						if (cardID) all.push(cardID);
					}
					send({type, generation, added: all, removed: [], authoritative: true});
					return;
				}
				const added : CardID[] = [];
				const removed : CardID[] = [];
				for (const change of snapshot.docChanges()) {
					const cardID = change.doc.data().card as CardID;
					if (!cardID) continue;
					if (change.type === 'removed') removed.push(cardID);
					else added.push(cardID);
				}
				//Send even when EMPTY. The main thread's reducers set
				//`starsLoaded`/`readsLoaded` from receiving the message at all,
				//so suppressing an empty first snapshot left an account with no
				//stars permanently "not loaded" — which is most accounts, and
				//was invisible until this ran against a real one.
				send({type, generation, added, removed});
			},
			error => {
				//The SDK TERMINATES a listener whose error callback fires — it
				//will never deliver again. Logging and moving on meant one
				//backend blip silently froze stars or reads for the rest of the
				//session while syncState still reported `live`. Re-attach with
				//backoff, as the card listeners already do.
				status(`${collectionName} listener error: ${String(error)}; re-attaching`);
				scheduleUserStateReattach(() => cardIDDeltaListener(collectionName, type));
			}));
	};
	cardIDDeltaListener(STARS_COLLECTION, 'userStars');
	cardIDDeltaListener(READS_COLLECTION, 'userReads');
	//The reading list is ONE document holding an ordered array, so it is sent
	//whole rather than as a delta -- order is meaningful and a delta cannot
	//express a reorder.
	const attachReadingList = () => userStateUnsubscribes.push(onSnapshot(
		query(collection(database, READING_LISTS_COLLECTION), where('owner', '==', uid)),
		snapshot => {
			if (myConnectionGeneration !== connectionGeneration) return;
			let list : CardID[] = [];
			for (const change of snapshot.docChanges()) {
				if (change.type === 'removed') continue;
				list = (change.doc.data().cards || []) as CardID[];
			}
			send({type: 'userReadingList', generation, list});
		},
		error => {
			status(`${READING_LISTS_COLLECTION} listener error: ${String(error)}; re-attaching`);
			scheduleUserStateReattach(attachReadingList);
		}));
	attachReadingList();
	status(`per-user state listeners attached for ${uid}`);
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
						//THE READER'S TRUST GATE. markWatermarkPlane below is a
						//no-op without unpublished scope, so a published-only
						//session has no other moment at which its corpus is
						//known-good. This one is exactly as strong as the
						//privileged path's three-plane gate: the published
						//listener is a FULL-SET query, so a server-confirmed
						//delivery is the complete authoritative corpus for this
						//scope, and the ghost reconciliation just above has
						//already removed anything the snapshot held that the
						//server does not.
						if (!currentMayViewUnpublished && corpusSnapshotStore) {
							claimPublishedSnapshotWriter();
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
			const {cards, pendingWriteIDs} = parseSnapshot(cachedSnapshot);
			contaminatePendingWriteIDs(pendingWriteIDs);
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
				const {cards, pendingWriteIDs} = parseSnapshot(snapshot);
				contaminatePendingWriteIDs(pendingWriteIDs);
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
//Set from the connect message; see the note on `ownsUserState` in the protocol.
let currentOwnsUserState = false;
let currentOwnsSupplementalData = false;
type WatermarkPlane = 'published' | 'tombstone' | 'delta';
const healthyWatermarkPlanes = new Set<WatermarkPlane>();

const setSyncState = (state : 'unverified' | 'live' | 'stale') => {
	if (currentSyncState === state) return;
	currentSyncState = state;
	if (state === 'live' && bootCheckpoints.length) {
		//One line with the whole path, so the expensive stretch is obvious
		//without correlating a dozen separate log lines by hand.
		const deltas = bootCheckpoints.map((checkpoint, index) =>
			`${checkpoint.label}=${checkpoint.at - (index ? bootCheckpoints[index - 1].at : 0)}ms`);
		status(`boot to live: total=${sinceConnect()}ms | ${deltas.join(' ')}`);
	}
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
//`countDeficits` is false for the BOOT gate and true for the post-delta re-gate.
//The deficit tolerance was always a RECENCY argument — a card created seconds
//ago has `updated > W` and the delta listener delivers it regardless — but it
//was applied as an unconditional COUNT tolerance, which had two costs. Old
//absences under the tolerance were blessed permanently, and deficits over it
//triggered a full-partition re-read (~3,900 docs, no limit, no `updated >`
//bound) at boot: away long enough for ~60 new cards spread evenly and all ten
//partitions cross, spending ~39,000 billed reads to learn about 60 cards the
//delta listener was about to deliver for ~60. So the boot gate judges GHOSTS
//only (zero tolerance, as before — a surplus is real and nothing else removes
//it), and deficits are judged once, exactly, after delta has caught up.
const runTrustGate = async (database : Firestore, myConnectionGeneration : number, countDeficits = false) : Promise<{mismatched : number[], serverTotal : number} | null> => {
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
			//Ghosts: always, zero tolerance. Deficits: only in the re-gate, and
			//there with NO tolerance, because delta has already delivered
			//everything recent — any remaining absence is genuine.
			if (local > counts[i] || (countDeficits && counts[i] > local)) mismatched.push(i);
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
	//One O(corpus) pass for the whole repair. Ghost detection below compares
	//against the corpus as it stood when the repair began, which is also the
	//right basis: each partition's server read is a snapshot from that moment.
	const bucketsForRepair = corpusUnpublishedPerPartition();
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
		const {cards, pendingWriteIDs} = parseSnapshot(snapshot);
		contaminatePendingWriteIDs(pendingWriteIDs);
		const serverIDs = new Set(Object.keys(cards));
		const ghosts : CardID[] = [];
		//Computed ONCE for the whole repair, not per partition: this is an
		//O(corpus) sweep, so a ten-partition repair did 400k iterations to
		//answer a question one pass already answers.
		for (const id of bucketsForRepair[index]) {
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
//Second-chance gate, run once the delta listener has caught up. The boot gate
//forgives a small per-partition deficit because a card created moments ago has
//`updated > W` and delta delivers it regardless — but that argument is about
//RECENCY and was applied as an unconditional COUNT tolerance, so an old
//absence was blessed forever and persisted into the next snapshot. By this
//point delta has delivered, so any surviving deficit is genuine.
//Partition set most recently repaired on this connection; reset per connect.
let lastRepairSignature = '';

const verifyDeficitsAfterDeltaCatchUp = async (database : Firestore, myConnectionGeneration : number) : Promise<void> => {
	const gate = await runTrustGate(database, myConnectionGeneration, true);
	if (!gate || myConnectionGeneration !== connectionGeneration) return;
	if (!gate.mismatched.length) return;
	//A repair cannot fix every mismatch. A locally-pending write that CREATES
	//an unpublished card makes local > server (the server count cannot see it)
	//while getDocsFromServer overlays that same pending write, so the repair
	//removes nothing and the mismatch survives — and repeating it costs a
	//full-partition re-read (~3,900 docs) every boot for as long as the write
	//stays unacknowledged. Repair a given partition set once per connection.
	const signature = gate.mismatched.join(',');
	if (signature === lastRepairSignature) {
		status(`post-delta re-gate still reports partitions ${signature}; a repair already ran this connection, not repeating`);
		return;
	}
	lastRepairSignature = signature;
	status(`post-delta re-gate found ${gate.mismatched.length} mismatched partition(s); repairing`);
	await repairPartitions(database, myConnectionGeneration, gate.mismatched);
	if (myConnectionGeneration !== connectionGeneration) return;
	//Confirm the repair actually converged; if not, say so rather than
	//silently re-running the same expensive read on the next boot.
	const after = await runTrustGate(database, myConnectionGeneration, true);
	if (after && after.mismatched.length) {
		status(`partitions ${after.mismatched.join(',')} still mismatched after repair (likely an unacknowledged local write); leaving as-is`);
	}
};

//A single card whose `updated` is far in the future permanently poisons the
//delta bound: the query becomes `updated > (future - 5min)`, matches nothing,
//and an EMPTY but server-confirmed delivery still marks the plane healthy — so
//the corpus goes live, the poisoned card is written into the snapshot, and every
//future boot re-derives the same dead bound. Silent, permanent staleness
//reported as 'live'. In-app writes use serverTimestamp() and cannot cause this;
//an out-of-band admin or migration write can. Ignore implausible futures when
//deriving the bound (the card itself is still served — only its timestamp is
//distrusted for watermark purposes).
const WATERMARK_FUTURE_TOLERANCE_SECONDS = 60 * 60;

const deriveSessionWatermark = () : WireTimestamp | null => {
	const values : (WireTimestamp | null)[] = [];
	const futureBoundSeconds = Math.floor(Date.now() / 1000) + WATERMARK_FUTURE_TOLERANCE_SECONDS;
	let ignoredFutureCards = 0;
	for (const [id, card] of corpus.entries()) {
		if (card.published) continue;
		if (clientClockCardIDs.has(id)) continue;
		const updated = card.updated as Timestamp | undefined;
		if (updated && typeof updated.seconds === 'number' && updated.seconds > futureBoundSeconds) {
			ignoredFutureCards++;
			continue;
		}
		values.push(updated && typeof updated.seconds === 'number' ? {seconds: updated.seconds, nanoseconds: updated.nanoseconds} : null);
	}
	if (ignoredFutureCards) status(`ignored ${ignoredFutureCards} card(s) with an implausibly future 'updated' when deriving the watermark`);
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
	//Mirrors meta.processedTombstoneIDs for membership tests; the array itself
	//stays the persisted representation.
	const processedTombstoneIDSet = new Set(meta.processedTombstoneIDs);
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
		//Set membership, not Array.includes: this runs per tombstone over a list
		//that is persisted into every snapshot and grows monotonically, so the
		//linear scan made processTombstones O(n^2).
		if (!newerResidentIDs.has(tombstone.id) && !processedTombstoneIDSet.has(tombstone.id)) {
			processedTombstoneIDSet.add(tombstone.id);
			meta.processedTombstoneIDs.push(tombstone.id);
		}
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
				//A pending local overlay carries a client-clock `updated`;
				//serve it but keep it out of the watermark derivation.
				if (snapshot.metadata.hasPendingWrites) clientClockCardIDs.add(card.id);
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
		//This measured 18.9s on real DEV — 61% of the whole path to `live` — so
		//report what it actually fetched rather than leaving that unexplained.
		const catchUpStartedAt = performance.now();
		const snapshot = await getDocsFromServer(query(collection(database, TOMBSTONES_COLLECTION), where('deleted', '>', new Timestamp(bound.seconds, bound.nanoseconds))));
		status(`tombstone catch-up: cursor=${cursor ? cursor.seconds : 'NONE (full scan)'} docs=${snapshot.size} in ${Math.round(performance.now() - catchUpStartedAt)}ms`);
		const tombstones : CorpusTombstone[] = [];
		snapshot.docs.forEach(docSnapshot => {
			//A pending local tombstone write materializes `deleted` with the
			//CLIENT clock; advancing the durable tombstoneCursor from it could
			//permanently skip older server tombstones (same invariant as the
			//tombstone listener). Defer it to its server acknowledgement.
			if (docSnapshot.metadata.hasPendingWrites) return;
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
	//Capture the store and generation. Reading module-level `syncMetaStore` in
	//the callback let an in-flight retry from a previous account write ITS
	//cursor and suppression list into the NEXT account's record after a user
	//switch (the store is re-keyed per uid on connect).
	const store = syncMetaStore;
	const myConnectionGeneration = connectionGeneration;
	if (!meta || !store) return;
	for (const id of [...meta.processedTombstoneIDs]) {
		getDocFromServer(doc(database, CARDS_COLLECTION, id)).then(snapshot => {
			if (myConnectionGeneration !== connectionGeneration) return;
			meta.processedTombstoneIDs = meta.processedTombstoneIDs.filter(other => other !== id);
			if (snapshot.exists()) {
				//Recreated under the same ID. Lifting suppression WITHOUT
				//ingesting made the card permanently invisible on this device:
				//the prime deletes it (it was still suppressed when the
				//snapshot was written), the delta query only returns
				//`updated > watermark` so an older recreate is never
				//redelivered, and the trust gate's missing-doc tolerance can
				//absorb a single absence. Re-ingest, exactly as the inline
				//launder at processTombstones does.
				const card = {...snapshot.data({serverTimestamps: 'estimate'}), id: snapshot.id} as Card;
				if (snapshot.metadata.hasPendingWrites) clientClockCardIDs.add(card.id);
				if (!corpus.has(card.id)) {
					updateLocalState({[card.id]: card}, []);
					forwardBatch({[card.id]: card}, [], card.published ? 'published' : 'unpublished', false);
					status(`tombstoned card ${id} was recreated; suppression lifted and card re-ingested`);
				} else {
					status(`tombstoned card ${id} was recreated; suppression lifted`);
				}
			}
			void store.save(meta);
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
			//A tombstoned card can still be RESIDENT in the Firestore persistent
			//cache until its launder confirms, and it matches this query
			//whenever its `updated` falls inside the delta window — so a cached
			//first delivery could re-ingest a card the tombstone catch-up just
			//removed. Suppression was otherwise applied only at prime time,
			//leaving this covered by a RACE: the unawaited laundering read
			//happening to land before this listener attaches. Make it an
			//invariant instead. Entries drop from processedTombstoneIDs the
			//moment the launder confirms, including the recreate case, which
			//re-ingests explicitly.
			if (syncMetaState) {
				for (const id of syncMetaState.processedTombstoneIDs) delete cards[id];
			}
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
					void clearWatermarkClamp().then(async () => {
						if (myConnectionGeneration !== connectionGeneration) return;
						//BEFORE 'live', not after. markWatermarkPlane flips the
						//corpus to live and fires an immediate snapshot save, so
						//re-gating afterwards meant a corpus still missing cards
						//could be written as the "known-complete" compact
						//snapshot — which the next boot then trusts enough to
						//grant loadComplete — and could hold mass-removal
						//authority in the meantime. Delta has caught up by now,
						//so this is the one moment a deficit is provably real.
						await verifyDeficitsAfterDeltaCatchUp(database, myConnectionGeneration);
						if (myConnectionGeneration !== connectionGeneration) return;
						markWatermarkPlane('delta', true);
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
		const {cards, pendingWriteIDs} = parseSnapshot(prioritySnapshot);
		contaminatePendingWriteIDs(pendingWriteIDs);
		updateLocalState(cards, []);
		forwardBatch(cards, [], 'unpublished', false);
		//startBound: max(updated) at sweep START, server-confirmed. The
		//post-sweep watermark is clamped to it — the docID-ordered pages
		//below can read a doc BEFORE a mid-sweep edit lands on it, so an
		//unclamped max(updated) could advance past an unseen edit and the
		//delta listener would permanently skip it. Pending-write overlays
		//carry client-clock estimates and must not raise the bound either.
		let startBound : WireTimestamp | null = null;
		for (const [id, card] of Object.entries(cards)) {
			if (pendingWriteIDs.has(id)) continue;
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
			const {cards, pendingWriteIDs} = parseSnapshot(page);
			contaminatePendingWriteIDs(pendingWriteIDs);
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
	markBootCheckpoint('trustGate');
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
		//An IndexedDB failure is NOT a supersession. claimOwnership rejects on
		//open/transaction errors (private browsing, eviction, storage pressure,
		//versionchange); treating that as "superseded" would stop a healthy
		//worker, and letting it reject would surface as an unhandled rejection
		//inside a voided promise and hang boot with no error anywhere.
		//Degrade instead: no metadata persistence, but keep syncing.
		let syncMetaOwned : boolean;
		try {
			syncMetaOwned = await syncMetaOwnershipClaim;
		} catch (err) {
			//DEGRADE, do not abort. Returning null here made the caller's
			//`if (!syncMetaState) return;` fire, which skipped tombstone
			//catch-up, the trust gate, the cold sweep, AND both the tombstone
			//and delta listeners — leaving the session with zero live sync
			//planes, permanently 'unverified', so every save was refused
			//forever with nothing on screen to say why. An unusable IndexedDB
			//must cost persistence only: carry empty metadata in memory and
			//keep syncing.
			status(`sync metadata store unavailable (${String(err)}); continuing without metadata persistence`);
			syncMetaStore = null;
			return emptySyncMeta();
		}
		if (!syncMetaOwned) {
			//A throw here would be swallowed by the prime path's cache
			//try/catch (and would surface as an unhandled rejection from the
			//post-prime call), leaving a superseded worker's listeners live.
			//Tear down explicitly instead; callers detect the generation bump.
			await stopSupersededWorker('worker sync metadata ownership was superseded; stopping before local persistence writes');
			return null;
		}
		return syncMetaLoad || (syncMetaLoad = syncMetaStore!.load());
	};
	corpusSnapshotStore = new CorpusSnapshotStore(corpusSnapshotKey(projectID, currentUid, snapshotScopeForSession(currentMayViewUnpublished)), ownership);
	//See the sync-meta claim above: a rejected claim means IndexedDB is
	//unusable, not that another tab won the epoch. Serving from the network
	//without a local snapshot is a slow boot; hanging forever on "Loading…"
	//with no error is a broken app.
	let snapshotOwned : boolean;
	try {
		snapshotOwned = await corpusSnapshotStore.claimOwnership();
	} catch (err) {
		status(`compact snapshot store unavailable (${String(err)}); continuing without snapshot persistence`);
		corpusSnapshotStore = null;
		snapshotOwned = true;
	}
	if (!snapshotOwned) {
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
	//Reset per prime: a reconnection that primes from the server must not
	//report the previous connection's snapshot age.
	primedSnapshotAgeMs = null;
	try {
		//null when IndexedDB is unusable (see the claim above): there is simply
		//no local snapshot to prime from, so fall through to the server prime.
		const compactSnapshot = corpusSnapshotStore ? await corpusSnapshotStore.load() : null;
		if (myConnectionGeneration !== connectionGeneration) return;
		if (compactSnapshot && Object.keys(compactSnapshot.cards).length) {
			primeSource = 'compact snapshot';
			markBootCheckpoint('snapshotRead');
			//`savedAt` was written on every save and never read. A device that
			//has been offline for weeks primes from a months-old snapshot, is
			//granted loadComplete for it, and serves it with no staleness
			//signal anywhere. Verification still gates `live`, so this is a
			//visibility gap rather than a correctness one — but it should not
			//be invisible.
			const ageMs = Date.now() - (compactSnapshot.savedAt || 0);
			const ageDays = ageMs / (24 * 60 * 60 * 1000);
			primedSnapshotAgeMs = compactSnapshot.savedAt ? ageMs : null;
			if (compactSnapshot.savedAt && ageDays >= 1) {
				status(`compact snapshot is ${ageDays.toFixed(1)} days old; serving it while verification catches up`);
			}
			compactTombstoneIDs = compactSnapshot.processedTombstoneIDs || [];
			if (compactSnapshot.schemaVersion === 2) {
				//Claim sync-meta ownership even though we are not READING from
				//it: without this the store is never claimed on this path, so
				//every later save() aborts against a prior session's owner
				//record and silently drops the tombstone cursor, the
				//processed-tombstone list and each cold-sweep page cursor. An
				//interrupted sweep then restarted from page zero every time.
				void syncMetaStore?.claimOwnership().catch(() => {
					status('sync metadata ownership unavailable on the snapshot path; metadata will not persist this session');
					syncMetaStore = null;
				});
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
	//Only a DEFINITE false is supersession; 'unknown' means IndexedDB could not
	//answer, and stopping on that would silently kill a healthy worker.
	if (corpusSnapshotStore && await corpusSnapshotStore.ownsCurrentOwnership() === false) {
		await stopSupersededWorker('worker ownership changed during compact snapshot load; stopping before handoff');
		return;
	}
	let consecutiveUnknownOwnershipPolls = 0;
	ownershipEpochGuard = setInterval(() => {
		const store = corpusSnapshotStore;
		if (!store) return;
		void store.ownsCurrentOwnership().then(current => {
			if (current === 'unknown') {
				//Do not stop, but do not stay silent either: a store that can
				//never answer means the epoch guard is no longer protecting
				//anything, and the page should hear about it once.
				consecutiveUnknownOwnershipPolls++;
				if (consecutiveUnknownOwnershipPolls === 30) status('ownership epoch guard cannot read IndexedDB; single-tab enforcement is degraded for this session');
				return;
			}
			consecutiveUnknownOwnershipPolls = 0;
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
		updateLocalState(primedCards, [], true);
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
		//Start the background search-recall build now, at low duty: the trust
		//gate ahead is network-bound dead time, ideal for chunked CPU work.
		scheduleSearchRecallBuild();
		//A substantial prime from the COMPACT SNAPSHOT is the initial load,
		//exactly as master treated a listener's first (cache-served) snapshot:
		//the cards are present, so the UI may render them. Verification
		//continues in the background and `live` still requires all three
		//watermark planes — but withholding loadComplete until then left every
		//card sitting in the store for ~19s behind a "Loading…" screen
		//(measured on the real 40k corpus).
		//
		//The SOURCE matters, not just the size. A compact snapshot is only ever
		//written after this corpus passed the trust gate, so its contents are
		//known-complete. The Firestore persistent-cache fallback carries no
		//such guarantee: a partial-mode residue (5,001 cards observed live,
		//with 34k missing) clears any size threshold, and max(updated) over
		//such a cache can equal the true corpus max, so the delta query never
		//heals it. Marking that as the initial load would let the app serve a
		//fraction of the corpus as if it were whole — "no card by that name"
		//for cards that exist, and navigation away from valid ones.
		if (primeSource === 'compact snapshot' && primedCount >= WARM_CACHE_THRESHOLD) {
			if (Object.keys(primedPublished).length) markInitialDelivered('published');
			markInitialDelivered('unpublished');
		}
	}
	//The published listener's first persistent-cache query can scan and decode
	//nearly the whole Firestore cache. Starting it beside the compact-snapshot
	//read made Chromium serialize the two IndexedDB workloads and turned a
	//~1.4s real-DEV snapshot load into 10–21s. The compact prime is explicitly
	//unverified, so serving it first does not weaken correctness: `live` still
	//requires the subsequently attached published listener plus the tombstone
	//and delta planes to become server-confirmed.
	markBootCheckpoint('primeCPU');
	//On the compact-snapshot path syncMetaState is already populated, so this
	//is a no-op and the tombstone catch-up below can be issued FIRST, on an
	//idle transport. Only the LEGACY path needs the sync-meta store opened
	//here — and on that path published was already attached earlier, so keep
	//the old attach order rather than leaving the public corpus blank across
	//an IndexedDB open.
	if (!syncMetaState) {
		if (deferPublishedUntilAfterPrime) {
			connectPublished();
			deferPublishedUntilAfterPrime = false;
		}
		syncMetaState = await loadSyncMeta();
	}
	if (myConnectionGeneration !== connectionGeneration) return;
	//Only the SUPERSEDED path returns null now, and it has already torn down
	//and bumped the generation (caught above). An unusable IndexedDB degrades
	//to in-memory empty metadata instead of returning null, so this no longer
	//doubles as the storage-failure exit.
	if (!syncMetaState) return;
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
	//ISSUE ORDER IS LOAD-BEARING. Real Firestore runs on ONE forced
	//long-polling transport, and getDocsFromServer is a temporary Listen target
	//on that same stream. Issued after the published listener, this
	//SINGLE-DOCUMENT read measured 13.9-16.7s on real DEV — queued behind
	//published's ~1.2k-document initial sync. catchUpTombstones calls
	//getDocsFromServer synchronously before its first await, so calling it here
	//enqueues the tombstone target FIRST and the two overlap instead.
	//
	//The AWAIT stays exactly where it was. Everything that consumes the
	//catch-up's guarantee — the trust gate's zero-tolerance ghost verdict and
	//the watermark derived after it — is inside gateAndProceed, still strictly
	//downstream. The laundering read is also issued earlier, widening its head
	//start over attachDeltaListener.
	const tombstoneCatchUp = catchUpTombstones(database);
	if (deferPublishedUntilAfterPrime) connectPublished();
	markBootCheckpoint('publishedAttached');
	await tombstoneCatchUp;
	markBootCheckpoint('tombstoneCatchUp');
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
			//unverified; retry. Serving an unverified corpus is deliberate
			//(trust slow, serve fast) — loadComplete is NO LONGER withheld
			//here, but it is only granted for a compact-snapshot prime, which
			//by construction already passed this gate on an earlier run. A
			//persistent-cache prime still waits, so a partial residue cannot
			//be served as if it were the whole corpus.
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
			//PROMOTE the start bound first, exactly as the completion path
			//does. Discarding it lost the clamp: an interrupted sweep whose
			//next boot classifies warm would derive its watermark from the
			//corpus in hand, so a card edited DURING the interrupted sweep
			//with `updated` older than watermark-5min is never re-read and is
			//served stale at syncState=live, permanently — the count-based
			//trust gate is membership-only and cannot see a mutation.
			//Clamping only ever costs extra server replay.
			const interrupted = syncMetaState.coldSweep;
			//min(), not overwrite: two crashes plus a cache loss in the right
			//order could otherwise replace an OLDER clamp with a newer one for
			//a sweep that did not re-read everything. A clamp that is too old
			//only costs extra replay; one that is too new loses cards.
			const existingClamp = syncMetaState.watermarkClamp;
			const candidate = interrupted.startBound;
			if (candidate) {
				const candidateOlder = !existingClamp ||
					candidate.seconds < existingClamp.seconds ||
					(candidate.seconds === existingClamp.seconds && candidate.nanoseconds < existingClamp.nanoseconds);
				if (candidateOlder) syncMetaState.watermarkClamp = candidate;
			}
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

//On sign-out, remove the materialized privileged corpus from disk.
//
//C11: this used to be `if (corpusSnapshotStore) store.clear()`, but that object
//only exists after a PRIVILEGED connect — a permission revocation reconnects
//non-privileged first, so by the time the `uid === ''` connect arrived the
//reference was already null and the snapshot silently survived. Construct the
//store from the outgoing uid instead, so the purge does not depend on which
//path we arrived by. `clear()` also now removes the `:owner` record, which it
//previously left behind.
//
//S4 is closed elsewhere, not here: Firestore's own persistentLocalCache is a
//second, larger copy of the same data, and it CANNOT be cleared in place —
//clearIndexedDbPersistence refuses an initialized instance, the signed-out
//reader needs a live `db` in this same tick, and the SDK's implementation
//calls `window.indexedDB` which does not exist in a worker at all. The bridge
//records the outgoing uid at sign-out and the NEXT boot deletes the database
//before initializeApp. See connectFirebase's purgePersistence branch.
const purgePrivilegedSnapshot = async (outgoingUid : string) => {
	if (!outgoingUid) return;
	try {
		const projectID = app?.options.projectId || (currentDevMode ? 'dev' : 'prod');
		//ALWAYS construct from the outgoing uid. This used to fall back to the
		//live `corpusSnapshotStore`, which was safe only while that variable
		//could hold nothing but the privileged store. The published-scope
		//reader path now assigns it too, so the fallback aimed the purge at the
		//SHARED `:published` record: a non-privileged sign-out wiped the public
		//reader cache, and — the case that matters — an admin whose permissions
		//were revoked reconnects non-privileged, signs out, and the 38,986-card
		//privileged record survives on disk in plaintext IndexedDB while the
		//purge reports success. That is the S4/C11 threat model exactly.
		const store = new CorpusSnapshotStore(corpusSnapshotKey(projectID, outgoingUid, 'privileged'));
		await store.clear();
		status('cleared the materialized privileged corpus for the signed-out account');
	} catch (e) {
		status(`compact snapshot purge failed (${String(e)})`);
	}
};

const connectCards = (mayViewUnpublished : boolean, uid : string) => {
	teardownListeners();
	connectStartedAt = performance.now();
	bootCheckpoints.length = 0;
	if (!uid && currentUid) void purgePrivilegedSnapshot(currentUid);
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
	//Reset recall FIRST so the mass removal below is bookkeeping-free rather
	//than 40k incremental index removals, and so no in-flight chunked build
	//survives into the new authorization scope.
	resetSearchRecall();
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
		void connectPublishedFromSnapshot();
		connectUnpublishedAuthorEditor(uid);
	} else {
		void connectPublishedFromSnapshot();
	}
	//Only when the PAGE says this worker owns per-user state. It is false for an
	//ANONYMOUS session — an anonymous sign-in yields a real uid, so the earlier
	//"costs nothing" reasoning was wrong: the three queries attach and deliver
	//empty, and three empty queries still bill a read each, on exactly the cost
	//axis the anonymous work was about. It is also false in spike mode, where
	//the main thread keeps its own listeners and this worker would otherwise
	//double-subscribe.
	if (uid && currentOwnsUserState) connectUserState(uid);
	//Not uid-gated: an anonymous reader needs navigation too.
	if (currentOwnsSupplementalData) connectSupplementalData();
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

const runQuery = (id : number, text : string) => {
	const start = performance.now();
	const tokens = queryTokensForText(text);
	//A query is the strongest possible intent signal for the chunked build;
	//until it completes, answer with the full-scan fallback rather than
	//stalling the worker loop on a synchronous rebuild.
	if (tokens.length) scheduleSearchRecallBuild();
	const candidates = searchRecallState === 'ready' ? index.candidates(tokens) : null;
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
		currentOwnsUserState = Boolean(message.ownsUserState);
		currentOwnsSupplementalData = Boolean(message.ownsSupplementalData);
		if (!firebaseReady) {
			//The page acquired the origin-wide lease before this worker was
			//created, so persistent single-tab ownership is safe to claim here.
			firebaseReady = Promise.resolve(connectFirebase(message.devMode, message.persist, message.emulatorTarget, message.purgePersistence));
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
	case 'suggestTags': {
		const start = performance.now();
		let tags : CardID[] = [];
		try {
			tags = engine.suggestTags(message.count);
		} catch (e) {
			status(`suggestTags failed (${String(e)})`);
		}
		const elapsed = performance.now() - start;
		status(`tag suggestions: ${tags.length} tags in ${elapsed.toFixed(0)}ms (editingCard=${engine.editingCard ? 'present' : 'MISSING'}, tagCount=${Object.keys(engine.tags).length})`);
		send({type: 'suggestTagsResult', generation, id: message.id, tags});
		break;
	}
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
		//A query subscription (find dialog) is an intent signal: kick the
		//chunked recall build so by the next keystroke it may be narrowing.
		if (message.description.includes('query/')) scheduleSearchRecallBuild();
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
//Above this many tracked cards, expired entries are swept on the next request.
const SIMILARITY_REQUEST_CACHE_SOFT_CAP = 512;
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
	//Drop entries that are already past the retry window rather than keeping one
	//per card ever requested for the life of the worker. Only runs when a new
	//request is actually being made, so it costs nothing on the hot path.
	if (requestedSimilarityCardIDs.size > SIMILARITY_REQUEST_CACHE_SOFT_CAP) {
		for (const [id, at] of requestedSimilarityCardIDs) {
			if (now - at >= SIMILARITY_REQUEST_RETRY_MS) requestedSimilarityCardIDs.delete(id);
		}
	}
	requestedSimilarityCardIDs.set(cardID, now);
	send({type: 'requestSimilarity', generation, cardID});
});

send({type: 'ready', generation, protocolVersion: CORPUS_WORKER_PROTOCOL_VERSION});

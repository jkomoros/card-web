//Main-thread client for the corpus worker. See
//docs/fast-corpus-implementation-log.md (Plan B).
//
//Rollout is gated by localStorage key 'corpus-worker':
//  'off' (or unset) — worker never spawns; zero behavior change.
//  'spike'          — worker spawns and loads cards + index in the
//                     background, purely for benchmarking via the
//                     window.CORPUS_WORKER console API. The main thread's own
//                     Firestore card listeners run exactly as before.
//  'shadow'         — the WORKER owns card ingestion: the main thread's card
//                     listeners don't attach, and the worker forwards parsed
//                     card batches which the bridge dispatches through the
//                     exact same receiveCards path. Redux/selector behavior
//                     is unchanged; only who talks to Firestore changes.
//  'on'             — reserved for B3 cutover.
//
//Console API (any mode): CORPUS_WORKER.setMode('shadow'), .spike(),
//.query('some text'), .setMode('off'). Mode changes require a reload to fully
//re-wire listeners.

import {
	Timestamp
} from 'firebase/firestore';

import {
	store
} from './store.js';

import {
	receiveCards,
	removeCards
} from './actions/data.js';

import {
	UPDATE_WORKER_COLLECTION,
	UPDATE_CARD_META,
	REMOVE_CARDS,
	STOP_EXPECTING_FETCHED_CARDS,
	UPDATE_CORPUS_STATUS
} from './actions.js';

import {
	fetchTypeIsUnpublished
} from './util.js';

import {
	Cards
} from './types.js';

import {
	MainToWorkerMessage,
	WorkerToMainMessage,
	WorkerActionStats,
	WorkerGeneration,
	CardBatch,
	FORWARDED_ACTION_TYPES
} from './worker/worker-protocol.js';

import {
	toWire,
	fromWire
} from './worker/wire-format.js';

import {
	setActionListener
} from './action-forwarder.js';

import {
	readCorpusWorkerMode,
	writeCorpusWorkerMode,
	corpusWorkerOwnsCardIngestion,
	readCorpusSyncMode,
	writeCorpusSyncMode,
	CorpusWorkerMode,
	CorpusSyncMode,
	markCorpusWorkerUnavailable
} from './corpus-mode.js';

import {
	corpusSizeTrustworthy,
	corpusSyncReady
} from './corpus-readiness.js';

import {
	DEV_MODE,
	EMULATOR_TARGET
} from './firebase.js';

import {
	selectActiveCollectionDescription,
	selectCollectionConstructorArguments,
	selectCollectionDescriptionForQuery,
	selectEditingCardSimilarity,
	selectEditingNormalizedCard,
	selectFindDialogOpen,
	selectIsEditing,
	selectRandomSalt,
	selectCardSimilarity,
	selectLoadingCardFetchTypes,
	selectRawCards,
	selectTabCollectionFallbacks,
	selectTabCollectionStartCards
} from './selectors.js';

import {
	CardBooleanMap,
	CardID,
	CardFetchType,
	ProcessedCard,
	SortExtra,
	State,
	WorkerCollectionSlot
} from './types.js';

import {
	CollectionDescription
} from './collection_description.js';

//Absolute path that resolves in both dev (wds serves the repo root; tsc
//emits to lib/) and prod (build/ is the web root; rollup emits a
//self-contained worker bundle at the same relative location).
const WORKER_URL = '/lib/src/worker/corpus-worker.js';

const readMode = readCorpusWorkerMode;

//Re-exported for src/actions/database.ts (historical import site).
export {corpusWorkerOwnsCardIngestion};

let worker : Worker | null = null;
let generation : WorkerGeneration = 0;
let queryCounter = 0;
const pendingQueries : Map<number, (result : {ids : string[], ms : number, fullScanFallback : boolean}) => void> = new Map();
//PERF HARNESS ONLY: pending CORPUS_WORKER.perfData() requests (worker timing).
let perfDataCounter = 0;
const pendingPerfData : Map<number, (result : {actionStats : WorkerActionStats, indexBuildMs : number}) => void> = new Map();
//The most recent ingestion parameters, so auth/permission changes can
//reconnect the worker.
let lastMayViewUnpublished = false;
let lastUid = '';
let connectSent = false;
let workerStartupTimeout : ReturnType<typeof setTimeout> | null = null;
let workerFailureRecoveryStarted = false;

const clearWorkerStartupTimeout = () => {
	if (!workerStartupTimeout) return;
	clearTimeout(workerStartupTimeout);
	workerStartupTimeout = null;
};

const makeTimestamp = (seconds : number, nanoseconds : number) : Timestamp => new Timestamp(seconds, nanoseconds);

const isTimestamp = (value : unknown) : boolean => value instanceof Timestamp;
const getTime = (timestamp : unknown) => {
	const ts = timestamp as Timestamp;
	return {seconds: ts.seconds, nanoseconds: ts.nanoseconds};
};

//----------------------------------------------------------------------------
// Action forwarding (shadow/on modes)
//
// Whitelisted user-state actions are forwarded to the worker's query engine,
// which replays them through the real collection reducer. The listener is
// installed at module load (when the mode calls for it) so early actions
// aren't missed; they buffer until the worker spawns.
//----------------------------------------------------------------------------

const bufferedActions : unknown[] = [];

const forwardAction = (action : unknown) => {
	const type = (action as {type : string}).type;
	if (!FORWARDED_ACTION_TYPES[type]) return;
	const wireAction = toWire(action, isTimestamp, getTime);
	if (worker) {
		post({type: 'action', generation, action: wireAction});
	} else {
		bufferedActions.push(wireAction);
	}
};

const flushBufferedActions = () => {
	if (!worker) return;
	for (const action of bufferedActions) {
		post({type: 'action', generation, action});
	}
	bufferedActions.length = 0;
};

//----------------------------------------------------------------------------
// One-shot collection runs (reference blocks etc.)
//----------------------------------------------------------------------------

let runCollectionCounter = 0;
type RunCollectionResolution = {
	ids : string[],
	labels : string[],
	numCards : number,
	numStartCards : number,
	isFallback : boolean,
	preview : boolean,
	partialMatches : CardBooleanMap,
	ms : number
};
const pendingRunCollections : Map<number, (result : RunCollectionResolution | null) => void> = new Map();

//Resolves every in-flight one-shot run with null (callers fall back to
//local computation). Called on generation bumps and worker teardown, where
//replies would otherwise be dropped as stale and the promises would hang
//forever — freezing reference blocks on the previous card's results.
const flushPendingRunCollections = () => {
	for (const resolve of pendingRunCollections.values()) resolve(null);
	pendingRunCollections.clear();
};

//Whether the worker announced loadComplete for the current generation, and
//its corpus size (updated on every batch thereafter, so readiness recovers
//as re-attached listeners refill the corpus after an outage).
let workerLoadComplete = false;
let workerCorpusSize = 0;
//Delta-sync health as last reported by the worker (watermark mode).
let lastSyncState : 'unverified' | 'live' | 'stale' | '' = '';

//True when the worker holds a corpus it is safe to SERVE from. Two parts:
//the worker must have announced that the initial load for the current
//connection parameters finished (loadComplete — per-batch inference was
//satisfiable by the first of five partition flushes, at ~20% corpus), and
//the resulting corpus must be plausibly complete relative to what Redux
//already holds (an offline worker "completes" with an EMPTY corpus from its
//memory cache; serving that would blank out the warm-boot-primed app).
export const corpusWorkerCanRunCollections = () : boolean => {
	if (!worker || !corpusWorkerOwnsCardIngestion()) return false;
	if (!workerLoadComplete) return false;
	if (!corpusSyncReady(readCorpusSyncMode(), lastMayViewUnpublished, lastSyncState)) return false;
	const reduxCount = Object.keys(selectRawCards(store.getState() as State)).length;
	return corpusSizeTrustworthy(workerCorpusSize, reduxCount);
};

//Runs a collection description in the worker; resolves with the ordered
//result. Returns null when the worker isn't available; resolves null when
//the run fails or the connection is torn down mid-flight (caller should
//fall back to local computation).
export const corpusWorkerRunCollection = (description : string, keyCardID : string) : Promise<RunCollectionResolution | null> | null => {
	if (!corpusWorkerCanRunCollections()) return null;
	const state = store.getState() as State;
	const id = ++runCollectionCounter;
	const promise = new Promise<RunCollectionResolution | null>(resolve => {
		pendingRunCollections.set(id, resolve);
	});
	post({
		type: 'runCollection',
		generation,
		id,
		description,
		keyCardID,
		uid: lastUid,
		randomSalt: selectRandomSalt(state),
		cardSimilarity: selectCardSimilarity(state)
	});
	return promise;
};

//----------------------------------------------------------------------------
// Shadow comparator ('shadow' mode)
//
// Periodically asks the worker to run the active collection and compares its
// ordered ID list against the UI's. Comparisons are gated to moments when the
// ghosting snapshot is in sync with live state and nothing is being edited,
// so both sides are answering the same question.
//----------------------------------------------------------------------------

const SHADOW_COMPARE_INTERVAL_MS = 1000;

let shadowComparatorStarted = false;
let shadowCompareTimeout : ReturnType<typeof setTimeout> | null = null;

//Live worker subscriptions: one per served collection slot. The active
//collection is subscribed in shadow and on modes; the find dialog's query
//collection only in 'on' mode (and only while the dialog is open and no card
//is being edited — link-searching while editing depends on the editing card,
//which the worker doesn't have).
let subscriptionCounter = 0;

//Tracks identity changes of the cardSimilarity map so subscription keys
//change (→ resubscribe with fresh data) whenever new similarity data lands.
let lastSeenCardSimilarity : ReturnType<typeof selectCardSimilarity> | null = null;
let cardSimilaritySerial = 0;

type BridgeSubscription = {
	slot : WorkerCollectionSlot,
	id : number,
	key : string,
	descriptionSerialized : string,
	latest : {ids : string[], ms : number} | null,
};

const bridgeSubscriptions : {[slot in WorkerCollectionSlot] : BridgeSubscription} = {
	active: {slot: 'active', id: 0, key: '', descriptionSerialized: '', latest: null},
	query: {slot: 'query', id: 0, key: '', descriptionSerialized: '', latest: null},
};

//Subscribe (or resubscribe, or unsubscribe when description is null) the
//given slot. The key incorporates everything that changes results besides
//engine-internal state.
const ensureSubscription = (slot : WorkerCollectionSlot, description : CollectionDescription | null, state : State) => {
	const subscription = bridgeSubscriptions[slot];
	if (!description) {
		if (subscription.id) {
			post({type: 'unsubscribeCollection', generation, subscriptionID: subscription.id});
			subscription.id = 0;
			subscription.key = '';
			subscription.latest = null;
			if (readMode() === 'on') {
				store.dispatch({type: UPDATE_WORKER_COLLECTION, slot, result: null});
			}
		}
		return;
	}
	//cardSimilarity is snapshotted into the worker-side subscription at
	//subscribe time, so a similarity identity change must resubscribe.
	const similarity = selectCardSimilarity(state);
	if (similarity !== lastSeenCardSimilarity) {
		lastSeenCardSimilarity = similarity;
		cardSimilaritySerial++;
	}
	const key = description.serialize() + '|' + selectRandomSalt(state) + '|' + lastUid + '|' + cardSimilaritySerial;
	if (key === subscription.key) return;
	if (subscription.id) {
		post({type: 'unsubscribeCollection', generation, subscriptionID: subscription.id});
	}
	subscription.key = key;
	subscription.descriptionSerialized = description.serialize();
	subscription.id = ++subscriptionCounter;
	subscription.latest = null;
	post({
		type: 'subscribeCollection',
		generation,
		subscriptionID: subscription.id,
		description: description.serialize(),
		keyCardID: '',
		uid: lastUid,
		randomSalt: selectRandomSalt(state),
		cardSimilarity: selectCardSimilarity(state)
	});
};

const handleCollectionResult = (message : {subscriptionID : number, ids : string[], labels : string[], numCards : number, numStartCards : number, isFallback : boolean, preview : boolean, partialMatches : CardBooleanMap, ms : number}) => {
	const subscription = Object.values(bridgeSubscriptions).find(candidate => candidate.id === message.subscriptionID);
	if (!subscription) return;
	//A push computed over a corpus we no longer trust (mid-reload, outage
	//recovery) must not reach the UI — 'on' mode would render it directly.
	if (!corpusWorkerCanRunCollections()) return;
	subscription.latest = {ids: message.ids, ms: message.ms};
	if (readMode() === 'on') {
		//Cutover mode: pushed results feed Redux directly; the UI renders
		//from them instead of computing collections.
		store.dispatch({
			type: UPDATE_WORKER_COLLECTION,
			slot: subscription.slot,
			result: {
				description: subscription.descriptionSerialized,
				ids: message.ids,
				labels: message.labels,
				numCards: message.numCards,
				numStartCards: message.numStartCards,
				isFallback: message.isFallback,
				preview: message.preview,
				partialMatches: message.partialMatches
			}
		});
	}
	scheduleShadowCompare();
};

//Drop worker-served results as soon as watermark coverage becomes uncertain.
//Also unsubscribe so a transition back to live creates a fresh push even when
//the ordered IDs happen to match the last pre-outage result.
const invalidateWorkerCollections = () => {
	for (const subscription of Object.values(bridgeSubscriptions)) {
		if (subscription.id) {
			post({type: 'unsubscribeCollection', generation, subscriptionID: subscription.id});
		}
		subscription.id = 0;
		subscription.key = '';
		subscription.descriptionSerialized = '';
		subscription.latest = null;
		if (readMode() === 'on') {
			store.dispatch({type: UPDATE_WORKER_COLLECTION, slot: subscription.slot, result: null});
		}
	}
};

const scheduleShadowCompare = () => {
	if (shadowCompareTimeout) return;
	shadowCompareTimeout = setTimeout(() => {
		shadowCompareTimeout = null;
		runShadowCompare();
	}, SHADOW_COMPARE_INTERVAL_MS);
};

//The last tab-config maps sent to the worker; re-sent when their identity
//changes (e.g. sections finishing loading changes section start cards).
let sentFallbacks : ReturnType<typeof selectTabCollectionFallbacks> | null = null;
let sentStartCards : ReturnType<typeof selectTabCollectionStartCards> | null = null;

const sendCollectionConfigIfChanged = (state : State) => {
	const fallbacks = selectTabCollectionFallbacks(state);
	const startCards = selectTabCollectionStartCards(state);
	if (fallbacks === sentFallbacks && startCards === sentStartCards) return;
	sentFallbacks = fallbacks;
	sentStartCards = startCards;
	post({type: 'configureCollections', generation, fallbacks, startCards});
};

const runShadowCompare = () => {
	const mode = readMode();
	if (!worker || (mode !== 'shadow' && mode !== 'on')) return;
	const state = store.getState() as State;
	sendCollectionConfigIfChanged(state);
	//Don't subscribe (or serve pushed results) until the worker's corpus is
	//complete: with the local cache prime, Redux holds the FULL cached corpus
	//while the worker is still loading, and a partial worker push would
	//visibly shrink the rendered collection in 'on' mode.
	if (!corpusWorkerCanRunCollections()) return;
	ensureSubscription('active', selectActiveCollectionDescription(state), state);
	if (mode === 'on') {
		//Serve the find dialog's query collection from the worker too, but
		//only while the dialog is open and nothing is being edited (the
		//editing-card-dependent variant must stay local).
		const queryDescription = (selectFindDialogOpen(state) && !selectIsEditing(state)) ? selectCollectionDescriptionForQuery(state) : null;
		ensureSubscription('query', queryDescription, state);
	}
	//In cutover mode there's nothing to compare against — the pushed result
	//IS the collection.
	if (mode !== 'shadow') return;
	//Don't compare while card loading is still in progress — the two sides
	//are guaranteed to be at different points of the load.
	const loading = selectLoadingCardFetchTypes(state);
	if (Object.keys(loading).length) return;
	if (!state.data || !state.data.sectionsLoaded || !state.data.tagsLoaded) return;
	//Only compare when both sides are answering the same question.
	if (selectIsEditing(state)) return;
	const description = selectActiveCollectionDescription(state);
	if (!description) return;
	const active = bridgeSubscriptions.active;
	if (!active.latest || active.descriptionSerialized !== description.serialize()) return;
	//The rendered active collection uses ghosting snapshots, which routinely
	//lag live state (they recommit only on collection-level events), so it
	//can't be compared against the worker's live results. Instead compute a
	//LIVE (non-ghosting) UI collection for the comparison. This costs one
	//filter+sort on the UI thread per comparison — acceptable for the
	//diagnostic shadow mode, and exactly what makes the comparison
	//apples-to-apples.
	const liveArgs = selectCollectionConstructorArguments(state);
	const liveCollection = description.collection(liveArgs);
	const uiIDs = liveCollection.finalSortedCards.map(card => card.id);
	compareShadowResult(description.serialize(), uiIDs, active.latest.ids, active.latest.ms);
};

//Deduplicates identical consecutive log lines so a stable MATCH doesn't spam
//the console on every state change.
let lastShadowLogLine = '';

const compareShadowResult = (description : string, uiIDs : string[], workerIDs : string[], ms : number) => {
	if (uiIDs.length === workerIDs.length && uiIDs.every((cardID, i) => cardID === workerIDs[i])) {
		const line = `[corpus-shadow] MATCH for ${description}: ${uiIDs.length} cards`;
		if (line !== lastShadowLogLine) {
			lastShadowLogLine = line;
			console.log(`${line} (worker ${ms}ms)`);
		}
		return;
	}
	const uiSet = new Set(uiIDs);
	const workerSet = new Set(workerIDs);
	const onlyUI = uiIDs.filter(cardID => !workerSet.has(cardID)).slice(0, 5);
	const onlyWorker = workerIDs.filter(cardID => !uiSet.has(cardID)).slice(0, 5);
	const orderOnly = onlyUI.length === 0 && onlyWorker.length === 0;
	const line = `[corpus-shadow] DIVERGENCE for ${description}: ui=${uiIDs.length} worker=${workerIDs.length}${orderOnly ? ' (ordering only)' : ''}`;
	if (line !== lastShadowLogLine) {
		lastShadowLogLine = line;
		console.warn(line, {onlyUI, onlyWorker});
	}
};

//Resubscribe the active-collection slot IMMEDIATELY when its description
//changes, instead of waiting for the debounced comparator tick: that tick
//(up to 1s) plus worker compute was the first-paint lag on every collection
//switch in 'on' mode — the UI fell back to a ~3s local filter+sort at 40k
//while a worker result was only a subscription away. Cheap on every state
//change (one serialize + string compare; ensureSubscription dedupes by
//key), heavy work only when the description ACTUALLY changed.
const fastResubscribeOnDescriptionChange = () => {
	if (!worker) return;
	//CHEAP check first: this runs on every dispatch, and
	//corpusWorkerCanRunCollections() enumerates the whole raw-cards map —
	//paying that on the no-change common path (every keystroke, every
	//batch) is a hot-path tax. The memoized description + precomputed
	//serialize costs a string compare.
	const state = store.getState() as State;
	const description = selectActiveCollectionDescription(state);
	if (!description) return;
	if (description.serialize() === bridgeSubscriptions.active.descriptionSerialized) return;
	if (!corpusWorkerCanRunCollections()) return;
	sendCollectionConfigIfChanged(state);
	ensureSubscription('active', description, state);
};

//Identity of the last editing card + similarity sent to the worker, so the
//boundary is only crossed when the (extraction-version-memoized) normalized
//editing card or its fetched similarity actually changes — at most about
//once a second while typing.
let lastSentEditingCard : ProcessedCard | null = null;
let lastSentEditingCardSimilarity : SortExtra | null = null;

//Mirrors the live editing card into the worker so its collection runs (and
//thus worker-served reference blocks) reflect unsaved content — the
//pipeline where related cards refresh every few seconds while typing.
const maybeSendEditingCard = () => {
	if (!worker) return;
	const state = store.getState() as State;
	const card = selectEditingNormalizedCard(state) || null;
	const similarity = selectEditingCardSimilarity(state) || null;
	if (card === lastSentEditingCard && similarity === lastSentEditingCardSimilarity) return;
	lastSentEditingCard = card;
	lastSentEditingCardSimilarity = similarity;
	post({type: 'setEditingCard', generation, card, similarity});
};

const startShadowComparator = () => {
	if (shadowComparatorStarted) return;
	const mode = readMode();
	if (mode !== 'shadow' && mode !== 'on') return;
	shadowComparatorStarted = true;
	store.subscribe(() => {
		fastResubscribeOnDescriptionChange();
		maybeSendEditingCard();
		scheduleShadowCompare();
	});
	scheduleShadowCompare();
	if (mode === 'shadow') {
		console.log('[corpus-shadow] comparator active (compares at most every ' + (SHADOW_COMPARE_INTERVAL_MS / 1000) + 's)');
	}
};

//The generation a corpus-ID reconciliation has been requested for, so it
//runs once per connection — requested only once the worker's corpus is BOTH
//load-complete and trustworthy, so it can't fire against a partial corpus
//(where the mass-removal guard would skip it and, being once-per-generation,
//it would never retry).
let reconciliationRequestedGeneration : WorkerGeneration = -1;

const maybeRequestReconciliation = () => {
	if (reconciliationRequestedGeneration === generation) return;
	if (!corpusWorkerCanRunCollections()) return;
	reconciliationRequestedGeneration = generation;
	post({type: 'requestCorpusIDs', generation});
};

const handleCardBatch = (batch : CardBatch) => {
	if (!corpusWorkerOwnsCardIngestion()) return;
	workerCorpusSize = batch.corpusSize;
	const cards = fromWire(batch.cards, makeTimestamp) as Cards;
	//Dispatch even when empty: UPDATE_CARDS clears the loading indicator for
	//the fetchType regardless of card count, exactly like a main-thread
	//listener receiving an empty snapshot.
	store.dispatch(receiveCards(cards, batch.fetchType, batch.fastDedupe));
	//NOTE: an earlier revision re-raised EXPECT_FETCHED_CARDS here after
	//every pre-loadComplete batch ("first batch is progress, not
	//completion"). That was REMOVED: the worker has designed paths that
	//withhold loadComplete indefinitely while still forwarding batches (the
	//second-tab Web-Locks loser; a boot whose trust gate is unreachable and
	//retrying) — the re-raise turned both into a permanently
	//never-fully-loaded app (dead new-card/random navigation, suggestions,
	//snapshot commits). It also ran AFTER receiveCards, too late to stop
	//the same-tick observers it was written for. First-batch-clears-loading
	//is the long-standing main-thread-listener semantic; keep it.
	if (batch.removedIDs.length) {
		store.dispatch(removeCards(batch.removedIDs, fetchTypeIsUnpublished(batch.fetchType)));
	}
	//Once the worker's corpus is complete AND trustworthy, reconcile once:
	//the local-cache prime may have served cards that were deleted while the
	//app was closed, and the worker can never send removals for docs it
	//never saw. Checked per batch (not just at loadComplete) so recovery
	//from a degraded load — corpus refilling via re-attached listeners —
	//still triggers it.
	maybeRequestReconciliation();
};

//Removes cards from Redux that the (fully-loaded) worker corpus doesn't
//have. Normal case: zero. Non-zero happens when the local-cache prime served
//since-deleted cards, or when permissions narrowed between sessions.
const handleCorpusIDs = (ids : CardID[]) => {
	if (!corpusWorkerOwnsCardIngestion()) return;
	const workerIDs = new Set(ids);
	const cards = selectRawCards(store.getState() as State);
	const stalePublished : CardID[] = [];
	const staleUnpublished : CardID[] = [];
	for (const [id, card] of Object.entries(cards)) {
		if (workerIDs.has(id)) continue;
		if (card.published) stalePublished.push(id);
		else staleUnpublished.push(id);
	}
	if (!stalePublished.length && !staleUnpublished.length) {
		console.log(`[corpus-worker] corpus reconciliation: clean (${workerIDs.size} cards)`);
		return;
	}
	//Sanity guard: genuine while-you-were-away deletions are rare and small.
	//A large stale set means the worker corpus is somehow partial despite
	//claiming completeness — never mass-remove on that signal.
	const staleCount = stalePublished.length + staleUnpublished.length;
	const reduxCount = Object.keys(cards).length;
	if (staleCount > Math.max(50, reduxCount * 0.1)) {
		console.warn(`[corpus-worker] corpus reconciliation: SKIPPED — ${staleCount} of ${reduxCount} Redux cards missing from the worker corpus (${workerIDs.size} ids); corpus looks partial`);
		return;
	}
	console.log(`[corpus-worker] corpus reconciliation: removing ${stalePublished.length} published + ${staleUnpublished.length} unpublished cards the worker corpus doesn't have`);
	if (stalePublished.length) store.dispatch(removeCards(stalePublished, false));
	if (staleUnpublished.length) store.dispatch(removeCards(staleUnpublished, true));
};

const handleMessage = (event : MessageEvent<WorkerToMainMessage>) => {
	const message = event.data;
	//'ready' is emitted at module bottom under the worker's own (pre-connect)
	//generation and would be dropped as stale below — but it proves exactly
	//what the startup timeout watches for (the module loaded and is
	//running), so clear the timeout BEFORE the generation gate or a slow
	//module init gets a healthy worker terminated at 15s.
	if (message.type === 'ready') clearWorkerStartupTimeout();
	if (message.generation !== generation) {
		console.log('[corpus-worker] dropped stale message', message.type);
		return;
	}
	//Any current-generation reply proves the module loaded and processed the
	//connect message; cold data loading itself may legitimately take minutes.
	clearWorkerStartupTimeout();
	switch (message.type) {
	case 'ready':
		console.log('[corpus-worker] ready');
		break;
	case 'status':
		console.log('[corpus-worker]', message.message);
		break;
	case 'error':
		console.warn('[corpus-worker]', message.message);
		break;
	case 'degraded':
		store.dispatch({type: UPDATE_CORPUS_STATUS, status: 'degraded', message: message.reason});
		break;
	case 'spikeReport':
		console.table([message.report]);
		break;
	case 'queryResult': {
		const resolver = pendingQueries.get(message.id);
		if (resolver) {
			pendingQueries.delete(message.id);
			resolver({ids: message.ids, ms: message.ms, fullScanFallback: message.fullScanFallback});
		}
		break;
	}
	case 'perfDataResult': {
		//PERF HARNESS ONLY: resolve a pending CORPUS_WORKER.perfData() request.
		const resolver = pendingPerfData.get(message.id);
		if (resolver) {
			pendingPerfData.delete(message.id);
			resolver({actionStats: message.actionStats, indexBuildMs: message.indexBuildMs});
		}
		break;
	}
	case 'cards':
		handleCardBatch(message.batch);
		break;
	case 'collectionResult':
		handleCollectionResult(message);
		break;
	case 'runCollectionResult': {
		const resolve = pendingRunCollections.get(message.id);
		if (resolve) {
			pendingRunCollections.delete(message.id);
			//failed → resolve null so the caller takes its local fallback.
			resolve(message.failed ? null : {
				ids: message.ids,
				labels: message.labels,
				numCards: message.numCards,
				numStartCards: message.numStartCards,
				isFallback: message.isFallback,
				preview: message.preview,
				partialMatches: message.partialMatches,
				ms: message.ms
			});
		}
		break;
	}
	case 'loadComplete':
		workerLoadComplete = true;
		workerCorpusSize = message.corpusSize;
		console.log(`[corpus-worker] load complete: ${message.corpusSize} cards`);
		for (const fetchType of Object.keys(selectLoadingCardFetchTypes(store.getState() as State)) as CardFetchType[]) {
			store.dispatch({type: STOP_EXPECTING_FETCHED_CARDS, fetchType});
		}
		if (!lastSyncState) {
			store.dispatch({type: UPDATE_CORPUS_STATUS, status: 'live', message: ''});
		}
		maybeRequestReconciliation();
		//Kick the comparator so subscriptions attach promptly now that
		//serving is allowed (rather than waiting for the next state change).
		scheduleShadowCompare();
		break;
	case 'syncState':
		lastSyncState = message.state;
		console.log(`[corpus-worker] sync state: ${message.state}`);
		store.dispatch({
			type: UPDATE_CORPUS_STATUS,
			status: message.state === 'live' ? 'live' : message.state === 'stale' ? 'stale' : 'loading',
			message: message.state === 'stale'
				? 'Card sync is interrupted; showing the latest locally available data.'
				: message.state === 'unverified' ? 'Verifying the local card corpus…' : ''
		});
		if (message.state !== 'live') invalidateWorkerCollections();
		else scheduleShadowCompare();
		break;
	case 'cardMeta':
		if (corpusWorkerOwnsCardIngestion()) {
			store.dispatch({type: UPDATE_CARD_META, metas: message.metas, removedIDs: message.removedIDs});
		}
		break;
	case 'corpusIDs':
		handleCorpusIDs(message.ids);
		break;
	case 'requestSimilarity':
		//The worker's similar-card filters can't fetch server similarity
		//themselves; perform the fetch here. When it lands,
		//UPDATE_CARD_SIMILARITY changes selectCardSimilarity's identity,
		//which re-keys the live subscriptions below so the worker recomputes
		//with the fresh data. Failures are logged, not rethrown — the
		//worker's TTL dedupe re-requests after a minute, restoring the
		//retry-per-filter-run behavior off mode always had.
		void import('./actions/similarity.js').then(module => {
			try {
				if (message.forEditingCard) {
					//Resolve the CANONICAL editing card from main-thread
					//state (the worker's copy is a structured clone with
					//dead Timestamp prototypes); fall through to the
					//committed-card fetch if editing ended meanwhile.
					const editingCard = selectEditingNormalizedCard(store.getState() as State);
					if (editingCard) {
						module.fetchSimilarCardsForCardIfEnabled(editingCard);
						return;
					}
				}
				module.fetchSimilarCardsIfEnabled(message.cardID);
			} catch (e) {
				console.warn(`[corpus-worker] similarity fetch for ${message.cardID} failed:`, e);
			}
		}).catch(e => console.warn('[corpus-worker] similarity module load failed:', e));
		break;
	}
};

const post = (message : MainToWorkerMessage) => {
	if (!worker) return;
	worker.postMessage(message);
};

const recoverFromWorkerFailure = (reason : string) => {
	if (workerFailureRecoveryStarted) return;
	workerFailureRecoveryStarted = true;
	console.warn(`[corpus-worker] unavailable (${reason}); falling back to main-thread card listeners`);
	clearWorkerStartupTimeout();
	stopWorker();
	markCorpusWorkerUnavailable();
	store.dispatch({type: UPDATE_CORPUS_STATUS, status: 'fallback', message: 'Background card sync is unavailable; using standard loading. Reload to retry.'});
	store.dispatch({type: UPDATE_WORKER_COLLECTION, slot: 'active', result: null});
	store.dispatch({type: UPDATE_WORKER_COLLECTION, slot: 'query', result: null});
	//Dynamic import avoids making the database↔bridge dependency cycle eager.
	//At this point corpusWorkerOwnsCardIngestion() is false, so these functions
	//take their established main-thread paths.
	void import('./actions/database.js').then(database => {
		database.connectLivePublishedCards();
		void database.connectLiveUnpublishedCards();
	}).catch(error => console.error('[corpus-worker] fallback listeners failed:', error));
};

const spawnWorker = () : boolean => {
	if (worker) return true;
	try {
		worker = new Worker(WORKER_URL, {type: 'module'});
	} catch (error) {
		recoverFromWorkerFailure(String(error));
		return false;
	}
	worker.addEventListener('message', handleMessage);
	worker.addEventListener('error', event => {
		//Auto-recover only during startup (the timeout window): a worker
		//that fails to boot is useless. AFTER startup, workers survive
		//uncaught exceptions — terminating a healthy worker holding the
		//whole corpus over one cosmetic bug means a session-long slow path
		//plus a full billed main-thread re-read. Log and keep running; a
		//genuinely wedged worker is covered by runCollection null-fallbacks
		//and the reconnect machinery.
		if (workerStartupTimeout) {
			recoverFromWorkerFailure(event.message || 'uncaught worker error');
			return;
		}
		console.warn('[corpus-worker] uncaught worker exception (worker continues):', event.message);
	});
	return true;
};

const stopWorker = () => {
	if (worker) worker.terminate();
	worker = null;
	connectSent = false;
	pendingQueries.clear();
	pendingPerfData.clear();
	flushPendingRunCollections();
	workerLoadComplete = false;
	workerCorpusSize = 0;
};

//Resets local subscription bookkeeping across a (re)connect. The worker
//clears its own SubscriptionManager on connect/reconnect, so the old
//subscription ids are already dead worker-side; without this reset the
//bridge would keep serving the last pushed result (computed under the OLD
//parameters) and never resubscribe under the new ones.
const resetSubscriptionsForReconnect = () => {
	//A fresh generation starts with no editing card; re-send if still editing.
	lastSentEditingCard = null;
	lastSentEditingCardSimilarity = null;
	for (const subscription of Object.values(bridgeSubscriptions)) {
		if (!subscription.id) continue;
		subscription.id = 0;
		subscription.key = '';
		subscription.descriptionSerialized = '';
		subscription.latest = null;
		if (readMode() === 'on') {
			store.dispatch({type: UPDATE_WORKER_COLLECTION, slot: subscription.slot, result: null});
		}
	}
};

//Ensures the worker is running and (re)connected with the given ingestion
//parameters. Called by src/actions/database.ts when the worker owns
//ingestion, in exactly the places the main-thread listeners would otherwise
//attach; also used by spike mode with default (published-only) parameters.
export const corpusWorkerConnectCards = (mayViewUnpublished : boolean, uid : string) => {
	if (!spawnWorker()) return;
	//Both published and unpublished connect paths funnel here; don't tear
	//down and reconnect when nothing changed.
	if (connectSent && mayViewUnpublished === lastMayViewUnpublished && uid === lastUid) return;
	store.dispatch({type: UPDATE_CORPUS_STATUS, status: 'loading', message: 'Loading card corpus…'});
	if (connectSent) {
		//Authorization scope changed without a page reload. Redux is deliberately
		//long-lived, so remove every unpublished card received under the previous
		//scope immediately; the new worker connection will re-deliver only those
		//the new identity may see. Do not use removeCards() here: its delayed
		//published/unpublished transition guard could remove a newly re-authorized
		//card three seconds after it is delivered.
		const staleUnpublishedIDs = Object.values(selectRawCards(store.getState() as State))
			.filter(card => !card.published)
			.map(card => card.id);
		if (staleUnpublishedIDs.length) {
			store.dispatch({type: REMOVE_CARDS, cardIDs: staleUnpublishedIDs});
		}
	}
	lastMayViewUnpublished = mayViewUnpublished;
	lastUid = uid;
	generation++;
	//A (re)connect restarts the worker's ingestion from scratch; its corpus
	//is incomplete again until it announces loadComplete for the new
	//parameters. In-flight one-shot runs would reply under the old
	//generation (dropped as stale) — resolve them to their fallbacks now.
	workerLoadComplete = false;
	workerCorpusSize = 0;
	flushPendingRunCollections();
	resetSubscriptionsForReconnect();
	if (!connectSent) {
		connectSent = true;
		//DEV_MODE comes from src/firebase.ts — the SAME flag that chose the
		//main thread's Firebase project, not a re-derived hostname sniff
		//(the two copies of that heuristic could drift, silently pointing
		//the worker's 40k-doc-per-boot loader at a different project).
		//persist: the worker claims the persistent cache only when it owns
		//ingestion — in spike mode the main thread still holds that cache.
		//emulatorTarget (PERF HARNESS ONLY): forward the main thread's
		//`firebase-emulator` flag so the worker points at the SAME emulator; null
		//→ omitted, so real connections are unaffected.
		post({type: 'connect', generation, devMode: DEV_MODE, persist: corpusWorkerOwnsCardIngestion(), syncMode: readCorpusSyncMode(), mayViewUnpublished, uid, ...(EMULATOR_TARGET ? {emulatorTarget: EMULATOR_TARGET} : {})});
		clearWorkerStartupTimeout();
		workerStartupTimeout = setTimeout(() => recoverFromWorkerFailure('startup timed out'), 15000);
	} else {
		post({type: 'reconnect', generation, mayViewUnpublished, uid});
	}
	flushBufferedActions();
	if (corpusWorkerOwnsCardIngestion()) {
		//Reset so the config is re-sent under the new generation.
		sentFallbacks = null;
		sentStartCards = null;
		sendCollectionConfigIfChanged(store.getState() as State);
		startShadowComparator();
	}
};

//Called once at app startup (from main-view). Spawns the worker only when the
//user has opted in via localStorage. In 'spike' mode the worker loads
//published cards for benchmarking; in 'shadow'/'on' modes the real ingestion
//wiring in src/actions/database.ts drives it instead.
export const maybeStartCorpusWorker = () => {
	const mode = readMode();
	if (mode !== 'spike') return;
	corpusWorkerConnectCards(false, '');
};

declare global {
	interface Window {
		CORPUS_WORKER: {
			setMode: (mode : CorpusWorkerMode) => void,
			mode: () => CorpusWorkerMode,
			setSyncMode: (mode : CorpusSyncMode) => void,
			syncMode: () => CorpusSyncMode,
			syncState: () => string,
			//True once the worker has announced loadComplete — its corpus is as
			//complete as the current connection can make it. The universal
			//readiness signal across both sync modes (syncState is watermark-only).
			loadComplete: () => boolean,
			//The worker's OWN corpus size (last reported via batch/loadComplete).
			//Distinguishes "worker loaded N but didn't forward" from "worker's
			//own prime yielded ~0" when the main store is empty.
			corpusSize: () => number,
			spike: () => void,
			query: (text : string) => Promise<{ids : string[], ms : number, fullScanFallback : boolean}>,
			//PERF HARNESS ONLY: worker-scoped timing (perfMiddleware sees only the
			//main thread). perfReset() before driving, perfData() after.
			perfData: () => Promise<{actionStats : WorkerActionStats, indexBuildMs : number}>,
			perfReset: () => void,
		};
	}
}

//Install the action-forwarding tap at module load when the worker will own
//ingestion, so no early user-state actions are missed (they buffer until the
//worker spawns).
if (typeof window !== 'undefined' && corpusWorkerOwnsCardIngestion()) {
	setActionListener(forwardAction);
}

if (typeof window !== 'undefined') {
	window.CORPUS_WORKER = {
		setMode: (mode : CorpusWorkerMode) => {
			writeCorpusWorkerMode(mode);
			if (mode === 'off') stopWorker();
			console.log(`[corpus-worker] mode set to ${mode}; reload for it to take full effect`);
		},
		mode: readMode,
		setSyncMode: (mode : CorpusSyncMode) => {
			writeCorpusSyncMode(mode);
			console.log(`[corpus-worker] sync mode set to ${mode}; reload for it to take full effect`);
		},
		syncMode: readCorpusSyncMode,
		syncState: () => lastSyncState,
		loadComplete: () => workerLoadComplete,
		corpusSize: () => workerCorpusSize,
		spike: () => {
			if (!worker) {
				console.log('[corpus-worker] not running; call CORPUS_WORKER.setMode(\'spike\') (or \'shadow\') and reload');
				return;
			}
			post({type: 'spike', generation});
		},
		query: (text : string) => {
			if (!worker) return Promise.reject(new Error('corpus worker not running'));
			const id = ++queryCounter;
			const promise = new Promise<{ids : string[], ms : number, fullScanFallback : boolean}>(resolve => {
				pendingQueries.set(id, resolve);
			});
			post({type: 'query', generation, id, text});
			return promise;
		},
		perfData: () => {
			if (!worker) return Promise.reject(new Error('corpus worker not running'));
			const id = ++perfDataCounter;
			const promise = new Promise<{actionStats : WorkerActionStats, indexBuildMs : number}>(resolve => {
				pendingPerfData.set(id, resolve);
			});
			post({type: 'perfData', generation, id});
			return promise;
		},
		perfReset: () => {
			if (!worker) return;
			post({type: 'perfReset', generation});
		},
	};
}

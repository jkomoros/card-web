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
	UPDATE_CARD_META
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
	CorpusWorkerMode
} from './corpus-mode.js';

import {
	selectActiveCollectionDescription,
	selectCollectionConstructorArguments,
	selectCollectionDescriptionForQuery,
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
//The most recent ingestion parameters, so auth/permission changes can
//reconnect the worker.
let lastMayViewUnpublished = false;
let lastUid = '';
let connectSent = false;

const devMode = () : boolean => {
	if (window.location.hostname == 'localhost') return true;
	if (window.location.hostname.indexOf('dev-') >= 0) return true;
	return false;
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
const pendingRunCollections : Map<number, (result : RunCollectionResolution) => void> = new Map();

//Fetch types the worker has delivered at least one batch for under the
//current generation. This — not the Redux loading flags — is the signal that
//the worker's corpus is complete enough to serve collection runs: the local
//cache prime (see primeCardsFromLocalCacheForWorkerModes) fills Redux and
//clears the loading flags long before the worker finishes its own load.
let workerDeliveredFetchTypes : {[fetchType : string] : true} = {};

//True when the worker holds the corpus and can answer collection runs: it
//must have delivered every fetch type its connection parameters call for
//(empty batches count — they signal an attached-but-empty listener or a
//permission failure, exactly like the main-thread path).
export const corpusWorkerCanRunCollections = () : boolean => {
	if (!worker || !corpusWorkerOwnsCardIngestion()) return false;
	if (!workerDeliveredFetchTypes['published']) return false;
	if (lastMayViewUnpublished) return Boolean(workerDeliveredFetchTypes['unpublished']);
	if (lastUid) return Boolean(workerDeliveredFetchTypes['unpublished-author'] && workerDeliveredFetchTypes['unpublished-editor']);
	return true;
};

//Runs a collection description in the worker; resolves with the ordered
//result. Returns null when the worker isn't available (caller should fall
//back to local computation).
export const corpusWorkerRunCollection = (description : string, keyCardID : string) : Promise<RunCollectionResolution> | null => {
	if (!corpusWorkerCanRunCollections()) return null;
	const state = store.getState() as State;
	const id = ++runCollectionCounter;
	const promise = new Promise<RunCollectionResolution>(resolve => {
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

const startShadowComparator = () => {
	if (shadowComparatorStarted) return;
	const mode = readMode();
	if (mode !== 'shadow' && mode !== 'on') return;
	shadowComparatorStarted = true;
	store.subscribe(scheduleShadowCompare);
	scheduleShadowCompare();
	if (mode === 'shadow') {
		console.log('[corpus-shadow] comparator active (compares at most every ' + (SHADOW_COMPARE_INTERVAL_MS / 1000) + 's)');
	}
};

//The generation a corpus-ID reconciliation has been requested for, so it
//runs once per connection.
let reconciliationRequestedGeneration : WorkerGeneration = -1;

const handleCardBatch = (batch : CardBatch) => {
	if (!corpusWorkerOwnsCardIngestion()) return;
	//Error-fallback batches clear loading indicators but are NOT evidence the
	//worker actually holds this fetchType's data (e.g. a quota outage
	//error-forwards every fetch type with nothing loaded).
	if (!batch.errorFallback) workerDeliveredFetchTypes[batch.fetchType] = true;
	const cards = fromWire(batch.cards, makeTimestamp) as Cards;
	//Dispatch even when empty: UPDATE_CARDS clears the loading indicator for
	//the fetchType regardless of card count, exactly like a main-thread
	//listener receiving an empty snapshot.
	store.dispatch(receiveCards(cards, batch.fetchType, batch.fastDedupe));
	if (batch.removedIDs.length) {
		store.dispatch(removeCards(batch.removedIDs, fetchTypeIsUnpublished(batch.fetchType)));
	}
	//Once the worker's corpus is complete, reconcile once: the local-cache
	//prime may have served cards that were deleted while the app was closed,
	//and the worker can never send removals for docs it never saw.
	if (reconciliationRequestedGeneration !== generation && corpusWorkerCanRunCollections()) {
		reconciliationRequestedGeneration = generation;
		post({type: 'requestCorpusIDs', generation});
	}
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
	if (message.generation !== generation) {
		console.log('[corpus-worker] dropped stale message', message.type);
		return;
	}
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
			resolve({
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
		//with the fresh data.
		void import('./actions/similarity.js').then(module => module.fetchSimilarCardsIfEnabled(message.cardID));
		break;
	}
};

const post = (message : MainToWorkerMessage) => {
	if (!worker) return;
	worker.postMessage(message);
};

const spawnWorker = () => {
	if (worker) return;
	worker = new Worker(WORKER_URL, {type: 'module'});
	worker.addEventListener('message', handleMessage);
	worker.addEventListener('error', event => {
		console.warn('[corpus-worker] worker error:', event.message);
	});
};

const stopWorker = () => {
	if (!worker) return;
	worker.terminate();
	worker = null;
	connectSent = false;
	pendingQueries.clear();
};

//Ensures the worker is running and (re)connected with the given ingestion
//parameters. Called by src/actions/database.ts when the worker owns
//ingestion, in exactly the places the main-thread listeners would otherwise
//attach; also used by spike mode with default (published-only) parameters.
export const corpusWorkerConnectCards = (mayViewUnpublished : boolean, uid : string) => {
	spawnWorker();
	//Both published and unpublished connect paths funnel here; don't tear
	//down and reconnect when nothing changed.
	if (connectSent && mayViewUnpublished === lastMayViewUnpublished && uid === lastUid) return;
	lastMayViewUnpublished = mayViewUnpublished;
	lastUid = uid;
	generation++;
	//A (re)connect restarts the worker's ingestion from scratch; its corpus
	//is incomplete again until batches for the new parameters arrive.
	workerDeliveredFetchTypes = {};
	if (!connectSent) {
		connectSent = true;
		post({type: 'connect', generation, devMode: devMode(), mayViewUnpublished, uid});
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
			spike: () => void,
			query: (text : string) => Promise<{ids : string[], ms : number, fullScanFallback : boolean}>,
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
	};
}

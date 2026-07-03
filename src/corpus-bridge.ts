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
	selectActiveCollection,
	selectActiveCollectionDescription,
	selectIsEditing,
	selectRandomSalt,
	selectCardSimilarity,
	selectTabCollectionFallbacks,
	selectTabCollectionStartCards
} from './selectors.js';

import {
	State
} from './types.js';

const LOCAL_STORAGE_KEY = 'corpus-worker';

//Absolute path that resolves in both dev (wds serves the repo root; tsc
//emits to lib/) and prod (build/ is the web root; rollup emits a
//self-contained worker bundle at the same relative location).
const WORKER_URL = '/lib/src/worker/corpus-worker.js';

export type CorpusWorkerMode = 'off' | 'spike' | 'shadow' | 'on';

const readMode = () : CorpusWorkerMode => {
	try {
		const value = window.localStorage.getItem(LOCAL_STORAGE_KEY);
		if (value === 'spike' || value === 'shadow' || value === 'on') return value;
	} catch {
		//Best effort
	}
	return 'off';
};

//True when the worker (not the main thread) should own the Firestore card
//listeners. src/actions/database.ts consults this before attaching.
export const corpusWorkerOwnsCardIngestion = () : boolean => {
	const mode = readMode();
	return mode === 'shadow' || mode === 'on';
};

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
// Shadow comparator ('shadow' mode)
//
// Periodically asks the worker to run the active collection and compares its
// ordered ID list against the UI's. Comparisons are gated to moments when the
// ghosting snapshot is in sync with live state and nothing is being edited,
// so both sides are answering the same question.
//----------------------------------------------------------------------------

const SHADOW_COMPARE_INTERVAL_MS = 5000;

let shadowComparatorStarted = false;
let shadowCompareTimeout : ReturnType<typeof setTimeout> | null = null;
let shadowRequestID = 0;
//Description + UI ids captured when the request was sent, compared on reply.
const pendingShadowRequests : Map<number, {description : string, uiIDs : string[]}> = new Map();

const scheduleShadowCompare = () => {
	if (shadowCompareTimeout) return;
	shadowCompareTimeout = setTimeout(() => {
		shadowCompareTimeout = null;
		runShadowCompare();
	}, SHADOW_COMPARE_INTERVAL_MS);
};

const runShadowCompare = () => {
	if (!worker || readMode() !== 'shadow') return;
	const state = store.getState() as State;
	//Only compare when both sides are answering the same question.
	if (selectIsEditing(state)) return;
	if (state.data && state.data.cardsSnapshot !== state.data.cards) return;
	if (state.collection && state.collection.filtersSnapshot !== state.collection.filters) return;
	const description = selectActiveCollectionDescription(state);
	if (!description) return;
	const collection = selectActiveCollection(state);
	if (!collection) return;
	const id = ++shadowRequestID;
	pendingShadowRequests.set(id, {
		description: description.serialize(),
		uiIDs: collection.finalSortedCards.map(card => card.id)
	});
	post({
		type: 'shadowCollection',
		generation,
		id,
		description: description.serialize(),
		keyCardID: '',
		uid: lastUid,
		randomSalt: selectRandomSalt(state),
		cardSimilarity: selectCardSimilarity(state)
	});
};

const handleShadowResult = (id : number, workerIDs : string[], ms : number) => {
	const pending = pendingShadowRequests.get(id);
	pendingShadowRequests.delete(id);
	if (!pending) return;
	const {description, uiIDs} = pending;
	if (uiIDs.length === workerIDs.length && uiIDs.every((cardID, i) => cardID === workerIDs[i])) {
		console.log(`[corpus-shadow] MATCH for ${description}: ${uiIDs.length} cards (worker ${ms}ms)`);
		return;
	}
	const uiSet = new Set(uiIDs);
	const workerSet = new Set(workerIDs);
	const onlyUI = uiIDs.filter(cardID => !workerSet.has(cardID)).slice(0, 5);
	const onlyWorker = workerIDs.filter(cardID => !uiSet.has(cardID)).slice(0, 5);
	const orderOnly = onlyUI.length === 0 && onlyWorker.length === 0;
	console.warn(`[corpus-shadow] DIVERGENCE for ${description}: ui=${uiIDs.length} worker=${workerIDs.length}${orderOnly ? ' (ordering only)' : ''}`, {onlyUI, onlyWorker});
};

const startShadowComparator = () => {
	if (shadowComparatorStarted) return;
	if (readMode() !== 'shadow') return;
	shadowComparatorStarted = true;
	store.subscribe(scheduleShadowCompare);
	scheduleShadowCompare();
	console.log('[corpus-shadow] comparator active (compares at most every ' + (SHADOW_COMPARE_INTERVAL_MS / 1000) + 's)');
};

const handleCardBatch = (batch : CardBatch) => {
	if (!corpusWorkerOwnsCardIngestion()) return;
	const cards = fromWire(batch.cards, makeTimestamp) as Cards;
	if (Object.keys(cards).length) {
		store.dispatch(receiveCards(cards, batch.fetchType, batch.fastDedupe));
	}
	if (batch.removedIDs.length) {
		store.dispatch(removeCards(batch.removedIDs, fetchTypeIsUnpublished(batch.fetchType)));
	}
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
	case 'shadowCollectionResult':
		handleShadowResult(message.id, message.ids, message.ms);
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
	if (!connectSent) {
		connectSent = true;
		post({type: 'connect', generation, devMode: devMode(), mayViewUnpublished, uid});
	} else {
		post({type: 'reconnect', generation, mayViewUnpublished, uid});
	}
	flushBufferedActions();
	if (corpusWorkerOwnsCardIngestion()) {
		const state = store.getState() as State;
		post({
			type: 'configureCollections',
			generation,
			fallbacks: selectTabCollectionFallbacks(state),
			startCards: selectTabCollectionStartCards(state)
		});
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
			try {
				if (mode === 'off') {
					window.localStorage.removeItem(LOCAL_STORAGE_KEY);
				} else {
					window.localStorage.setItem(LOCAL_STORAGE_KEY, mode);
				}
			} catch {
				//Best effort
			}
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

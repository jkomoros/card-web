//Main-thread client for the corpus worker. See
//docs/fast-corpus-implementation-log.md (Plan B).
//
//Rollout is gated by localStorage key 'corpus-worker':
//  'off' (or unset) — worker never spawns; zero behavior change.
//  'spike'          — worker spawns and loads published cards + index in the
//                     background, purely for benchmarking via the
//                     window.CORPUS_WORKER console API. No app behavior
//                     change.
//  'shadow' / 'on'  — reserved for B2/B3.
//
//Console API (any mode): CORPUS_WORKER.setMode('spike'), .spike(),
//.query('some text'), .setMode('off').

import {
	MainToWorkerMessage,
	WorkerToMainMessage,
	WorkerGeneration
} from './worker/worker-protocol.js';

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

let worker : Worker | null = null;
let generation : WorkerGeneration = 0;
let queryCounter = 0;
const pendingQueries : Map<number, (result : {ids : string[], ms : number, fullScanFallback : boolean}) => void> = new Map();

const devMode = () : boolean => {
	if (window.location.hostname == 'localhost') return true;
	if (window.location.hostname.indexOf('dev-') >= 0) return true;
	return false;
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
		//B1: forwarded ingestion batches. Ignored in spike mode.
		break;
	}
};

const post = (message : MainToWorkerMessage) => {
	if (!worker) return;
	worker.postMessage(message);
};

const spawnWorker = () => {
	if (worker) return;
	generation++;
	worker = new Worker(WORKER_URL, {type: 'module'});
	worker.addEventListener('message', handleMessage);
	worker.addEventListener('error', event => {
		console.warn('[corpus-worker] worker error:', event.message);
	});
	post({type: 'connect', generation, devMode: devMode(), mayViewUnpublished: false, uid: ''});
};

const stopWorker = () => {
	if (!worker) return;
	worker.terminate();
	worker = null;
	pendingQueries.clear();
};

//Called once at app startup (from main-view). Spawns the worker only when the
//user has opted in via localStorage.
export const maybeStartCorpusWorker = () => {
	const mode = readMode();
	if (mode === 'off') return;
	spawnWorker();
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
			if (mode === 'off') {
				stopWorker();
			} else {
				spawnWorker();
			}
			console.log(`[corpus-worker] mode set to ${mode}`);
		},
		mode: readMode,
		spike: () => {
			if (!worker) {
				console.log('[corpus-worker] not running; call CORPUS_WORKER.setMode(\'spike\') first');
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

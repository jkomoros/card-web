//Leaf module (no app imports) for reading the corpus-worker rollout mode, so
//selectors, actions, and the bridge can all consult it without import cycles.
//
//  'off'           — worker never spawns; the main thread does everything.
//  'spike'         — worker runs for benchmarking only.
//  'shadow'        — worker owns card ingestion and results are compared
//                    against the UI's; behavior unchanged.
//  'on' (default)  — cutover: worker owns ingestion AND serves the active
//                    collection; the UI renders pushed results.
//
//DEFAULT FLIPPED 2026-07-11 (owner directive): 'on' + 'watermark' are the
//defaults; localStorage is now the opt-OUT. Windowless contexts (tests,
//tools) still resolve to the legacy modes so Node-side code never assumes
//a worker exists.

const LOCAL_STORAGE_KEY = 'corpus-worker';

//Session-only circuit breaker. If the worker cannot start or crashes, the
//bridge flips this and reconnects the legacy main-thread listeners. Keeping
//the persisted preference unchanged means the next reload can try the worker
//again after a transient deployment/cache problem.
let corpusWorkerUnavailable = false;

export const markCorpusWorkerUnavailable = () : void => {
	corpusWorkerUnavailable = true;
};

export type CorpusWorkerMode = 'off' | 'spike' | 'shadow' | 'on';

export const readCorpusWorkerMode = () : CorpusWorkerMode => {
	if (typeof window === 'undefined') return 'off';
	try {
		const value = window.localStorage.getItem(LOCAL_STORAGE_KEY);
		if (value === 'off' || value === 'spike' || value === 'shadow' || value === 'on') return value;
	} catch {
		//Best effort
	}
	return 'on';
};

export const writeCorpusWorkerMode = (mode : CorpusWorkerMode) : void => {
	try {
		if (mode === 'on') {
			//The default: clearing the key keeps fresh and reset profiles
			//identical.
			window.localStorage.removeItem(LOCAL_STORAGE_KEY);
		} else {
			window.localStorage.setItem(LOCAL_STORAGE_KEY, mode);
		}
	} catch {
		//Best effort
	}
};

//True when the worker (not the main thread) owns the Firestore card
//listeners.
export const corpusWorkerOwnsCardIngestion = () : boolean => {
	if (corpusWorkerUnavailable) return false;
	const mode = readCorpusWorkerMode();
	return mode === 'shadow' || mode === 'on';
};

//How the worker syncs the unpublished corpus (docs/corpus-sync-design.md):
//  'listen'    — (legacy) full-corpus partitioned listeners. O(corpus)
//                billed reads per boot (>30-min listener re-attach bills the
//                whole result set).
//  'watermark' — delta plane: cache prime + per-boot count() trust gate +
//                one `updated > watermark` delta listener + tombstones.
//                O(changes) billed reads per boot.
const SYNC_LOCAL_STORAGE_KEY = 'corpus-sync';

export type CorpusSyncMode = 'listen' | 'watermark';

export const readCorpusSyncMode = () : CorpusSyncMode => {
	if (typeof window === 'undefined') return 'listen';
	try {
		const value = window.localStorage.getItem(SYNC_LOCAL_STORAGE_KEY);
		if (value === 'listen' || value === 'watermark') return value;
	} catch {
		//Best effort
	}
	return 'watermark';
};

export const writeCorpusSyncMode = (mode : CorpusSyncMode) : void => {
	try {
		if (mode === 'watermark') {
			//The default: clearing the key keeps fresh and reset profiles
			//identical.
			window.localStorage.removeItem(SYNC_LOCAL_STORAGE_KEY);
		} else {
			window.localStorage.setItem(SYNC_LOCAL_STORAGE_KEY, mode);
		}
	} catch {
		//Best effort
	}
};

//True when the active collection is served from worker-pushed results.
export const corpusWorkerServesCollections = () : boolean => !corpusWorkerUnavailable && readCorpusWorkerMode() === 'on';

//Leaf module (no app imports) for reading the corpus-worker rollout mode, so
//selectors, actions, and the bridge can all consult it without import cycles.
//
//  'off' (default) — worker never spawns; the main thread does everything.
//  'spike'         — worker runs for benchmarking only.
//  'shadow'        — worker owns card ingestion and results are compared
//                    against the UI's; behavior unchanged.
//  'on'            — cutover: worker owns ingestion AND serves the active
//                    collection; the UI renders pushed results.

const LOCAL_STORAGE_KEY = 'corpus-worker';

export type CorpusWorkerMode = 'off' | 'spike' | 'shadow' | 'on';

export const readCorpusWorkerMode = () : CorpusWorkerMode => {
	if (typeof window === 'undefined') return 'off';
	try {
		const value = window.localStorage.getItem(LOCAL_STORAGE_KEY);
		if (value === 'spike' || value === 'shadow' || value === 'on') return value;
	} catch {
		//Best effort
	}
	return 'off';
};

export const writeCorpusWorkerMode = (mode : CorpusWorkerMode) : void => {
	try {
		if (mode === 'off') {
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
		if (window.localStorage.getItem(SYNC_LOCAL_STORAGE_KEY) === 'watermark') return 'watermark';
	} catch {
		//Best effort
	}
	return 'listen';
};

export const writeCorpusSyncMode = (mode : CorpusSyncMode) : void => {
	try {
		if (mode === 'listen') {
			window.localStorage.removeItem(SYNC_LOCAL_STORAGE_KEY);
		} else {
			window.localStorage.setItem(SYNC_LOCAL_STORAGE_KEY, mode);
		}
	} catch {
		//Best effort
	}
};

//True when the active collection is served from worker-pushed results.
export const corpusWorkerServesCollections = () : boolean => readCorpusWorkerMode() === 'on';

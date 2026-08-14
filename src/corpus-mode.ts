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

//THE KILL SWITCH. This used to restrict diagnostic modes to localhost and the
//dev host, which meant production had NO in-browser escape hatch: readCorpusWorkerMode
//returned 'on' unconditionally and writeCorpusWorkerMode refused anything else.
//The only remedy for a bad cutover was redeploying master — which strands the
//durable write queue and drops drafts, turning an outage into data loss.
//
//For a single-admin product that trade is backwards. The one person who would
//ever flip this is the owner, who can open devtools; giving them
//`corpus-worker=off` is an instant, no-deploy, per-browser rollback to the
//legacy main-thread path, which still exists and still works here (only
//master's PARTIAL mode was removed). Anonymous readers are unaffected: the
//default is unchanged, and their blast radius is read-only either way.
//
//Enumerating production hostnames was the alternative and is fragile — prod
//answers to both thecompendium.cards and its firebase web.app domain, and a
//missed alias silently restores the old no-escape-hatch behaviour on exactly
//the host that needs it.
//
//REVISIT if this ever grows a second admin: a footgun one person can reach is
//a support burden two people can.
const diagnosticModesAllowed = () => true;

//Session-only circuit breaker for diagnostic modes. Normal `on` mode fails
//closed instead: it never reconnects the legacy main-thread corpus listeners.
//Keeping the persisted preference unchanged means a reload can retry after a
//transient deployment/cache problem.
let corpusWorkerUnavailable = false;

export const markCorpusWorkerUnavailable = () : void => {
	corpusWorkerUnavailable = true;
};

export type CorpusWorkerMode = 'off' | 'spike' | 'shadow' | 'on';

export const readCorpusWorkerMode = () : CorpusWorkerMode => {
	if (typeof window === 'undefined') return 'off';
	if (!diagnosticModesAllowed()) return 'on';
	try {
		const value = window.localStorage.getItem(LOCAL_STORAGE_KEY);
		if (value === 'off' || value === 'spike' || value === 'shadow' || value === 'on') return value;
	} catch {
		//Best effort
	}
	return 'on';
};

export const writeCorpusWorkerMode = (mode : CorpusWorkerMode) : void => {
	if (!diagnosticModesAllowed() && mode !== 'on') {
		console.warn('Diagnostic corpus modes are disabled on production hosting');
		return;
	}
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
	if (!diagnosticModesAllowed()) return 'watermark';
	try {
		const value = window.localStorage.getItem(SYNC_LOCAL_STORAGE_KEY);
		if (value === 'listen' || value === 'watermark') return value;
	} catch {
		//Best effort
	}
	return 'watermark';
};

export const writeCorpusSyncMode = (mode : CorpusSyncMode) : void => {
	if (!diagnosticModesAllowed() && mode !== 'watermark') {
		console.warn('Diagnostic corpus sync modes are disabled on production hosting');
		return;
	}
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

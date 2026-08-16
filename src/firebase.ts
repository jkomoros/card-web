//This is the only place that should import firebase, to make sure every use is
//intiialized by the time of use.

import { initializeApp } from 'firebase/app';

import {
	serverTimestamp,
	deleteField,
	Timestamp,
	initializeFirestore,
	persistentLocalCache,
	persistentMultipleTabManager,
	memoryLocalCache,
	CACHE_SIZE_UNLIMITED,
	connectFirestoreEmulator,
} from 'firebase/firestore';

import {
	corpusWorkerOwnsCardIngestion
} from './corpus-mode.js';

import {
	getAuth,
	connectAuthEmulator
} from 'firebase/auth';

import {
	getFunctions
} from 'firebase/functions';

import {
	getStorage,
	ref as storageRef
} from 'firebase/storage';

import { deepEqual } from './util.js';

import {
	FIREBASE_DEV_CONFIG,
	FIREBASE_PROD_CONFIG,
	FIREBASE_REGION,
} from './config.GENERATED.SECRET.js';

import {
	FirestoreLeafValue
} from './types.js';

export let DEV_MODE = false;
//Deliberately only do devmode if the host is localhost. If you want it
//in local mode, just do 127.0.0.1 instead.
if (window.location.hostname == 'localhost') DEV_MODE = true;
if (window.location.hostname.indexOf('dev-') >= 0) DEV_MODE = true;

//PERF HARNESS ONLY: the `firebase-emulator` localStorage flag (host:firestorePort,
//e.g. `localhost:8089`) points Firestore + Auth at the local emulators. Read once
//here, BEFORE init, because in emulator mode the projectId is overridden to a
//fixed demo project so the app and the seeded corpus share one emulator namespace
//(the Firestore emulator namespaces data by projectId). DEFAULT OFF — an absent
//flag is a complete no-op, so real dev/prod connections are unaffected. Set
//pre-boot via Playwright addInitScript.
//HOST-GATED. This flag redirects BOTH Firestore and Auth to an arbitrary host,
//so ungated it turned a one-shot XSS or a moment of device access into an
//indefinite silent MITM — and pointing Auth at an attacker's emulator makes
//signInWithPopup open THEIR account chooser, which is a durable
//credential-phishing surface. The host allowlist mirrors corpus-mode.ts's
//diagnosticModesAllowed(), and the target itself is restricted to loopback:
//the harness only ever needs localhost.
const emulatorHostAllowed = () => {
	if (typeof window === 'undefined') return false;
	const host = window.location.hostname;
	return host === 'localhost' || host === '127.0.0.1' || host === 'dev-complexity-compendium.web.app';
};

const emulatorTargetIsLoopback = (target : string) => {
	const host = target.split(':')[0] || 'localhost';
	return host === 'localhost' || host === '127.0.0.1';
};

let emulatorTarget : string | null = null;
try {
	const requested = emulatorHostAllowed() ? window.localStorage.getItem('firebase-emulator') : null;
	if (requested && !emulatorTargetIsLoopback(requested)) {
		console.warn(`[firebase] ignoring firebase-emulator target ${requested}: only loopback targets are permitted`);
		emulatorTarget = null;
	} else {
		emulatorTarget = requested;
	}
} catch { emulatorTarget = null; }
const PERF_EMULATOR_PROJECT_ID = 'demo-perf';

//Exported so the corpus worker (shadow/on modes) can point at the SAME emulator.
//The worker has no localStorage; the bridge forwards this value in its `connect`
//message rather than re-reading the flag (a second read could drift from the one
//that chose the main thread's project — the same single-source-of-truth reason
//DEV_MODE is exported). Null (the default) means no emulator: a complete no-op.
export const EMULATOR_TARGET = emulatorTarget;

const baseConfig = DEV_MODE ? FIREBASE_DEV_CONFIG : FIREBASE_PROD_CONFIG;
const config = emulatorTarget ? {...baseConfig, projectId: PERF_EMULATOR_PROJECT_ID} : baseConfig;

// Initialize Firebase
const firebaseApp = initializeApp(config);

//Firestore without long polling has a potential to OOM during load with lots of
//long document. See
//https://github.com/firebase/firebase-js-sdk/issues/4416#issuecomment-788225325
//and #659.
//
//CACHE OWNERSHIP: exactly one client may hold the persistent cache. In
//worker modes (corpus-worker = shadow/on) the CORPUS WORKER owns it — with
//the single-tab force-ownership manager, the only persistence mode Firestore
//supports inside a dedicated worker — because the corpus (40k cards) is what
//actually needs resume tokens: without them every worker boot re-reads the
//whole corpus from the server (~40k billed reads, i.e. a full free-tier day
//per boot, observed as a real resource-exhausted outage). The main thread
//steps down to a memory cache in those modes; its reads (sections, tags,
//user state) are small and online-only. Off/spike modes are unchanged:
//main-thread multi-tab persistence, exactly as before.
export const db = initializeFirestore(firebaseApp, {
	//Force long-polling against REAL Firestore (OOM avoidance with long docs —
	//#4416/#659). Against the perf EMULATOR, forced long-polling collapses under
	//a 40k cold prime ('transport errored: Qd'); auto-detect uses the streaming
	//transport against localhost. Emulator-only; real connections unchanged.
	...(emulatorTarget ? {experimentalAutoDetectLongPolling: true} : {experimentalForceLongPolling: true}),
	//cacheSizeBytes UNLIMITED: the default is 40MB with LRU garbage
	//collection, which silently evicts most of an all-cards-local corpus
	//(~240-480MB at 40-60k cards) — master never noticed because its ~6k
	//partial-mode corpus fit under 40MB.
	localCache: corpusWorkerOwnsCardIngestion() ? memoryLocalCache() : persistentLocalCache({
		tabManager: persistentMultipleTabManager(),
		cacheSizeBytes: CACHE_SIZE_UNLIMITED
	})
});

export const auth = getAuth(firebaseApp);
export const functions = getFunctions(firebaseApp, FIREBASE_REGION);
export const storage = getStorage(firebaseApp);

//Re-exported for the perf harness's page-context sign-in (test/perf-harness/),
//which must reach Auth through this served module — a runtime `import('firebase/auth')`
//from injected page code is a bare specifier wds will not resolve.
export { signInWithCustomToken } from 'firebase/auth';

//PERF HARNESS ONLY (test/perf-harness/): when the `firebase-emulator`
//localStorage flag is set to `host:firestorePort` (e.g. `localhost:8089`),
//point Firestore + Auth at the local emulators instead of the real project.
//DEFAULT OFF — an absent flag is a complete no-op, so real dev/prod connections
//are unaffected. The harness sets it pre-boot via Playwright addInitScript.
//Only the main thread reads this; the corpus worker has no localStorage, so
//the bridge forwards EMULATOR_TARGET in its connect message (see above) —
//worker (shadow/on) modes run against the same emulator, and admin-on-*
//baselines exercise exactly that path.
if (emulatorTarget) {
	try {
		const [emuHost, emuPort] = emulatorTarget.split(':');
		const host = emuHost || 'localhost';
		connectFirestoreEmulator(db, host, parseInt(emuPort || '8089', 10));
		connectAuthEmulator(auth, `http://${host}:9099`, {disableWarnings: true});
		console.warn(`[firebase] EMULATOR MODE (perf harness): project ${PERF_EMULATOR_PROJECT_ID}, firestore ${host}:${emuPort || '8089'}, auth ${host}:9099`);
	} catch {
		//Best effort — never break a real boot.
	}
}

const UPLOADS_FOLDER_NAME = 'uploads';

export const uploadsRef = storageRef(storage, UPLOADS_FOLDER_NAME);

export const currentTimestamp = Timestamp.now;

const deleteSentinelJSON = JSON.stringify(deleteField());
const serverTimestampSentinelJSON = JSON.stringify(serverTimestamp());

export const isDeleteSentinel = (value : FirestoreLeafValue) : boolean => {
	if (typeof value !== 'object') return false;
	//deleteSentinel returns new objects every time, but for now (at least) they
	//at least stringify the same.
	return JSON.stringify(value) == deleteSentinelJSON;
};

//Returns an object like object, but where every top-level value that passes
//isServerTimestampSentinel is ensured to be a literal serverTimestamp. This
//allows serverTimestampSentinel() objects to be converted to serverTimestamps
//right before setting. This is called automatically before set or update
//operations in MultiBatch.
export const installServerTimestamps = (value : object) : object => {
	if (!Object.values(value).some(value => fieldNeedsServerTimestamp(value))) return value;
	return Object.fromEntries(Object.entries(value).map(entry => [entry[0], fieldNeedsServerTimestamp(entry[1]) ? serverTimestamp() : entry[1]]));
};

//Also aware of normal Timestamps vended by serverTimestampSentinel.
export const isServerTimestampSentinel = (value : FirestoreLeafValue) : boolean => {
	if (typeof value !== 'object') return false;
	//Also normal timestamps that we vended from serverTimestampSentinel.
	if (vendedTimestamps.get(value)) return true;
	//serverTimestampSentinel returns new objects every time, but for now (at least) they
	//at least stringify the same.
	return JSON.stringify(value) == serverTimestampSentinelJSON;
};

//Fields that are already serverTimestamp don't need a new one.
const fieldNeedsServerTimestamp = (value : FirestoreLeafValue) : boolean => isServerTimestampSentinel(value) && !isLiteralServerTimestamp(value);

const isLiteralServerTimestamp = (value : FirestoreLeafValue) : boolean => {
	if (typeof value !== 'object') return false;
	//serverTimestampSentinel returns new objects every time, but for now (at least) they
	//at least stringify the same.
	return JSON.stringify(value) == serverTimestampSentinelJSON;
};

const vendedTimestamps : WeakMap<object, true> = new WeakMap();

//serverTimestampSentinel is like serverTimestamp, except instead of vending a
//FieldValue, it vends a normal currentTimestamp, but keeps track that its
//meaning is a serverTimestamp sentinel, so later calls to
//isServerTimestampSentinel will detect it as a sentinel. MultiBatch.set and
//.update are aware.
export const serverTimestampSentinel = () : Timestamp => {
	const result = currentTimestamp();
	vendedTimestamps.set(result, true);
	return result;
};

export const isFirestoreTimestamp = (value : FirestoreLeafValue) : boolean => value instanceof Timestamp;

export const deepEqualIgnoringTimestamps = (a : unknown, b : unknown) : boolean => deepEqual(a, b, isFirestoreTimestamp);

// Helper to get the current user's ID token
export const getIDToken = async (): Promise<string> => {
	const user = auth.currentUser;
	if (!user) throw new Error('User not authenticated');
	return await user.getIdToken();
};

/**
 * Makes an authenticated fetch request to a Firebase function endpoint
 * @param url The endpoint URL to fetch from
 * @param data The request data to send (will be JSON stringified)
 * @returns Promise that resolves to the JSON response
 */
export const authenticatedFetch = async <RequestData, ResponseData>(
	url: string,
	data: RequestData
): Promise<ResponseData> => {
	// Get Firebase auth token
	const token = await getIDToken();

	// Make the authenticated fetch request
	const response = await fetch(url, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'Authorization': `Bearer ${token}`
		},
		body: JSON.stringify(data)
	});

	// Check for HTTP errors
	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(`HTTP ${response.status}: ${errorText}`);
	}

	// Parse the JSON response
	const responseData = await response.json() as ResponseData;

	return responseData;
};
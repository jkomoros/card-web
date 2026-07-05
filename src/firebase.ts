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
} from 'firebase/firestore';

import {
	corpusWorkerOwnsCardIngestion
} from './corpus-mode.js';

import {
	getAuth
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
const config = DEV_MODE ? FIREBASE_DEV_CONFIG : FIREBASE_PROD_CONFIG;

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
	experimentalForceLongPolling: true,
	localCache: corpusWorkerOwnsCardIngestion() ? memoryLocalCache() : persistentLocalCache({
		tabManager: persistentMultipleTabManager()
	})
});

export const auth = getAuth(firebaseApp);
export const functions = getFunctions(firebaseApp, FIREBASE_REGION);
export const storage = getStorage(firebaseApp);

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
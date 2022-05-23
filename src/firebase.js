//This is the only place that should import firebase, to make sure every use is
//intiialized by the time of use.

import { initializeApp } from 'firebase/app';

import { 
	getFirestore,
	serverTimestamp,
	deleteField,
	Timestamp
} from 'firebase/firestore';

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
} from '../config.GENERATED.SECRET.js';

export let DEV_MODE = false;
//Deliberately only do devmode if the host is localhost. If you want it
//in local mode, just do 127.0.0.1 instead.
if (window.location.hostname == 'localhost') DEV_MODE = true;
if (window.location.hostname.indexOf('dev-') >= 0) DEV_MODE = true;
let config = DEV_MODE ? FIREBASE_DEV_CONFIG : FIREBASE_PROD_CONFIG;
// Initialize Firebase
const firebaseApp = initializeApp(config);

export const db = getFirestore(firebaseApp);
export const auth = getAuth(firebaseApp);
export const functions = getFunctions(firebaseApp, FIREBASE_REGION);
export const storage = getStorage(firebaseApp);

const UPLOADS_FOLDER_NAME = 'uploads';

export const uploadsRef = storageRef(storage, UPLOADS_FOLDER_NAME);

export const currentTimestamp = Timestamp.now;

const deleteSentinelJSON = JSON.stringify(deleteField());
const serverTimestampSentinelJSON = JSON.stringify(serverTimestamp());

export const isDeleteSentinel = (value) => {
	if (typeof value !== 'object') return false;
	//deleteSentinel returns new objects every time, but for now (at least) they
	//at least stringify the same.
	return JSON.stringify(value) == deleteSentinelJSON;
};

export const isServerTimestampSentinel = (value) => {
	if (typeof value !== 'object') return false;
	//serverTimestampSentinel returns new objects every time, but for now (at least) they
	//at least stringify the same.
	return JSON.stringify(value) == serverTimestampSentinelJSON;
};

export const isFirestoreTimestamp = (value) => value instanceof Timestamp;

export const deepEqualIgnoringTimestamps = (a, b) => deepEqual(a, b, isFirestoreTimestamp);
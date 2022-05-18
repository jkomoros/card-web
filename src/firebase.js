//This is the only place that should import firebase, to make sure every use is
//intiialized by the time of use.

import firebase from '@firebase/app';

import '@firebase/auth';
import '@firebase/firestore';
import '@firebase/functions';
import '@firebase/storage';

import { deepEqual } from './util.js';

import {
	FIREBASE_DEV_CONFIG,
	FIREBASE_PROD_CONFIG,
	FIREBASE_REGION,
	DISABLE_PERSISTENCE
} from '../../config.GENERATED.SECRET.js';

export let DEV_MODE = false;
//Deliberately only do devmode if the host is localhost. If you want it
//in local mode, just do 127.0.0.1 instead.
if (window.location.hostname == 'localhost') DEV_MODE = true;
if (window.location.hostname.indexOf('dev-') >= 0) DEV_MODE = true;
let config = DEV_MODE ? FIREBASE_DEV_CONFIG : FIREBASE_PROD_CONFIG;
// Initialize Firebase
const firebaseApp = firebase.initializeApp(config);

if (!DISABLE_PERSISTENCE) {
	firebase.firestore().enablePersistence()
		.catch(function(err) {
			if (err.code == 'failed-precondition') {
				console.warn('Offline doesn\'t work because multiple tabs are open or something else');
			} else if (err.code == 'unimplemented') {
				console.warn('This browser doesn\'t support offline storage');
			}
		});
}

export const db = firebaseApp.firestore();
export const auth = firebaseApp.auth();
export const functions = firebaseApp.functions(FIREBASE_REGION);
export const storage = firebaseApp.storage();

const UPLOADS_FOLDER_NAME = 'uploads';

export const uploadsRef = storage.ref(UPLOADS_FOLDER_NAME);

//These are the only reasons to import firebase, so just reexport them to avoid
//confusing needs for importing firebase directly
export const serverTimestampSentinel = firebase.firestore.FieldValue.serverTimestamp;
export const arrayUnionSentinel = firebase.firestore.FieldValue.arrayUnion;
export const arrayRemoveSentinel = firebase.firestore.FieldValue.arrayRemove;
export const incrementSentinel = firebase.firestore.FieldValue.increment;
export const deleteSentinel = firebase.firestore.FieldValue.delete;

export const currentTimestamp = firebase.firestore.Timestamp.now;

const deleteSentinelJSON = JSON.stringify(deleteSentinel());
const serverTimestampSentinelJSON = JSON.stringify(serverTimestampSentinel());

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

export const isFirestoreTimestamp = (value) => value instanceof firebase.firestore.Timestamp;

export const deepEqualIgnoringTimestamps = (a, b) => deepEqual(a, b, isFirestoreTimestamp);
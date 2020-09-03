import firebase from '@firebase/app';

import '@firebase/auth';
import '@firebase/firestore';
import '@firebase/functions';

import {
	FIREBASE_DEV_CONFIG,
	FIREBASE_PROD_CONFIG,
	FIREBASE_REGION
} from '../../config.GENERATED.SECRET.js';

export let DEV_MODE = false;
//Deliberately only do devmode if the host is localhost. If you want it
//in local mode, just do 127.0.0.1 instead.
if (window.location.hostname == 'localhost') DEV_MODE = true;
if (window.location.hostname.indexOf('dev-') >= 0) DEV_MODE = true;
let config = DEV_MODE ? FIREBASE_DEV_CONFIG : FIREBASE_PROD_CONFIG;
// Initialize Firebase
const firebaseApp = firebase.initializeApp(config);

firebase.firestore().enablePersistence()
	.catch(function(err) {
		if (err.code == 'failed-precondition') {
			console.warn('Offline doesn\'t work because multiple tabs are open or something else');
		} else if (err.code == 'unimplemented') {
			console.warn('This browser doesn\'t support offline storage');
		}
	});

export const db = firebaseApp.firestore();
export const auth = firebaseApp.auth();
export const functions = firebaseApp.functions(FIREBASE_REGION);
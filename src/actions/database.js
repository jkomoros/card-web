import firebaseImpl from '@firebase/app';

import '@firebase/auth';
import '@firebase/firestore';
import '@firebase/messaging';

import {
	FIREBASE_DEV_CONFIG,
	FIREBASE_PROD_CONFIG
} from '../../config/config.SECRET.js';

export const firebase = firebaseImpl;

export let DEV_MODE = false;
//Deliberately only do devmode if the host is localhost. If you want it
//in local mode, just do 127.0.0.1 instead.
if (window.location.hostname == 'localhost') DEV_MODE = true;
if (window.location.hostname.indexOf('dev-') >= 0) DEV_MODE = true;
let config = DEV_MODE ? FIREBASE_DEV_CONFIG : FIREBASE_PROD_CONFIG;
// Initialize Firebase
firebase.initializeApp(config);

const PROD_VAPID = 'BBXFZPnWiK_tO47-ES7lhkHK9Grlc4W8kA7IWiTsKQLMQIk9fFLiz1IhSnq9j2MwpzhlczmqSPcNiXRZvDIyFBE';
const DEV_VAPID = 'BO-C0PDdWRvIKSjZmpF_llbdyENpv6FRYGpze_aA0D63wQ7af2YggVXahyxWjD9Sd-vKfbxHVuJIXDlFtu1yBjA';

//messaging might be null in browsers that don't support push notifications,
//like Safari.
const messaging = firebase.messaging.isSupported() ? firebase.messaging() : null;
if (messaging) messaging.usePublicVapidKey(DEV_MODE ? DEV_VAPID : PROD_VAPID);
//NOTE: additional messaging setup is done within useServiceWorker.

//Notifications feature is enabled if the browser supports mesaging and we're in
//dev mode. TODO: in the future when we want to enable notifications in
//production, remove the DEV_MODE guard and just have it be whether messaging is
//non-null.
export const NOTIFICATIONS_FEATURE_ENABLED  = DEV_MODE && messaging; 

export const db = firebase.firestore();

firebase.firestore().enablePersistence()
	.catch(function(err) {
		if (err.code == 'failed-precondition') {
			console.warn('Offline doesn\'t work because multiple tabs are open or something else');
		} else if (err.code == 'unimplemented') {
			console.warn('This browser doesn\'t support offline storage');
		}
	});

import {
	updateCards,
	updateSections,
	updateAuthors,
	updateTags,
} from './data.js';

import {
	updateMessages,
	updateThreads
} from './comments.js';

import {
	updateStars,
	updateReads,
	updateNotificationsToken,
	updateReadingList
} from './user.js';

import {
	innerTextForHTML
} from '../util.js';

export const CARDS_COLLECTION = 'cards';
export const CARD_UPDATES_COLLECTION = 'updates';
export const SECTION_UPDATES_COLLECTION = 'updates';
export const SECTIONS_COLLECTION = 'sections';
export const TAGS_COLLECTION = 'tags';
export const TAG_UPDATES_COLLECTION = 'updates';
export const MAINTENANCE_COLLECTION = 'maintenance_tasks';
export const AUTHORS_COLLECTION = 'authors';
export const THREADS_COLLECTION = 'threads';
export const MESSAGES_COLLECTION = 'messages';
export const STARS_COLLECTION = 'stars';
export const READS_COLLECTION = 'reads';
//The user of this is actually clsoer to "userInfos", but that sounded weird.
//This is a cache of information related to users, like whether htey're
//anonymous, and when they were last seen. We never use it on the client, just
//report up so the info exists on the server.
export const USERS_COLLECTION = 'users';
export const READING_LISTS_COLLECTION = 'reading_lists';
export const READING_LISTS_UPDATES_COLLECTION = 'updates';
export const PERMISSIONS_COLLECTION = 'permissions';
export const TWEETS_COLLECTION = 'tweets';

import {
	store
} from '../store.js';

//useServiceWorker is called at boot time when the sevice worker registration is
//provided. We have to wait until then to do final initialization.
export const useServiceWorker = (registration) => {
	if (!messaging) return;
	messaging.useServiceWorker(registration);
	//Additional messages initalization
	//Initialize with current state of token. Don't bother telling the server.
	notificationsTokenUpdated(false);
	//if the token is refreshed then we should tell the server.
	messaging.onTokenRefresh(() => notificationsTokenUpdated(true));
};

//Not actually an action dispatcher; factored the logic into this file so
//messaging doesn't have to be exported.
export const requestNotificationsPermission = () => {
	if (!messaging) {
		console.warn('This browser doesn\'t support push notifications');
		return;
	}
	messaging.requestPermission().then(() => {
		notificationsTokenUpdated(true);
	}).catch(err => {
		console.warn('Couldn\'t get permission to notify:', err);
	});
};

//Not an action dispatcher; call any time it may have been updated. If
//notifyServer is true, that means that it's via a method where the server
//should be alerted.
const notificationsTokenUpdated = (notifyServer) => {
	if (notifyServer) {
		//TODO: reach out to server
	}
	if(!messaging) return;
	messaging.getToken().then(token => {
		store.dispatch(updateNotificationsToken(token));
	});
};

export const connectLiveMessages = (store) => {
	//Deliberately DO fetch deleted messages, so we can render stubs for them.
	db.collection(MESSAGES_COLLECTION).onSnapshot(snapshot => {
		let messages = {};
		snapshot.docChanges().forEach(change => {
			if (change.type === 'removed') return;
			let doc = change.doc;
			let id = doc.id;
			let message = doc.data();
			message.id = id;
			messages[id] = message;
		});

		store.dispatch(updateMessages(messages));
	});
};

export const connectLiveThreads = (store) => {
	db.collection(THREADS_COLLECTION).where('deleted', '==', false).where('resolved', '==', false).onSnapshot(snapshot => {
		let threads = {};
		let threadsToAdd = [];
		let threadsToRemove = [];
		snapshot.docChanges().forEach(change => {
			let doc = change.doc;
			if (change.type === 'removed') {
				threadsToRemove.push(doc.id);
				return;
			}
			let id = doc.id;
			let thread = doc.data();
			thread.id = id;
			threadsToAdd.push(id);
			threads[id] = thread;
		});
		store.dispatch(updateThreads(threads));
	});
};

let liveStarsUnsubscribe = null;
let liveReadsUnsubscribe = null;
let liveReadingListUnsubscribe = null;

export const disconnectLiveStars = () => {
	if (liveStarsUnsubscribe) {
		liveStarsUnsubscribe();
		liveStarsUnsubscribe = null;
	}
};

export const connectLiveStars = (store, uid) => {
	disconnectLiveStars();
	liveStarsUnsubscribe = db.collection(STARS_COLLECTION).where('owner', '==', uid).onSnapshot( snapshot => {
		let starsToAdd = [];
		let starsToRemove = [];
		snapshot.docChanges().forEach(change => {
			let doc = change.doc;
			if (change.type === 'removed') {
				starsToRemove.push(doc.data().card);
				return;
			}
			starsToAdd.push(doc.data().card);
		});
		store.dispatch(updateStars(starsToAdd, starsToRemove));
	});
};

export const disconnectLiveReads = () => {
	if (liveReadsUnsubscribe) {
		liveReadsUnsubscribe();
		liveReadsUnsubscribe = null;
	}
};

export const connectLiveReads = (store, uid) => {
	disconnectLiveReads();
	liveReadsUnsubscribe = db.collection(READS_COLLECTION).where('owner', '==', uid).onSnapshot( snapshot => {
		let readsToAdd = [];
		let readsToRemove = [];
		snapshot.docChanges().forEach(change => {
			let doc = change.doc;
			if (change.type === 'removed') {
				readsToRemove.push(doc.data().card);
				return;
			}
			readsToAdd.push(doc.data().card);
		});
		store.dispatch(updateReads(readsToAdd, readsToRemove));
	});
};

export const disconnectLiveReadingList = () => {
	if (liveReadingListUnsubscribe) {
		liveReadingListUnsubscribe();
		liveReadingListUnsubscribe = null;
	}
};

export const connectLiveReadingList = (store, uid) => {
	disconnectLiveReadingList();
	liveReadingListUnsubscribe = db.collection(READING_LISTS_COLLECTION).where('owner', '==', uid).onSnapshot( snapshot => {
		let list = [];
		snapshot.docChanges().forEach(change => {
			let doc = change.doc;
			if (change.type === 'removed') {
				return;
			}
			list = doc.data().cards;
		});
		store.dispatch(updateReadingList(list));
	});
};

export const connectLiveAuthors = (store) => {
	db.collection(AUTHORS_COLLECTION).onSnapshot(snapshot => {

		let authors = {};

		snapshot.docChanges().forEach(change => {
			if (change.type === 'removed') return;
			let doc = change.doc;
			let id = doc.id;
			let author = doc.data();
			author.id = id;
			authors[id] = author;
		});

		store.dispatch(updateAuthors(authors));

	});
};

export const connectLiveCards = (store) => {
	db.collection(CARDS_COLLECTION).onSnapshot(snapshot => {

		let cards = {};

		snapshot.docChanges().forEach(change => {
			if (change.type === 'removed') return;
			let doc = change.doc;
			let id = doc.id;
			let card = doc.data();
			card.id = id;
			card.bodyText = innerTextForHTML(card.body || '');
			cards[id] = card;
		});

		store.dispatch(updateCards(cards));

	});
};

export const connectLiveSections = (store) => {
	db.collection(SECTIONS_COLLECTION).orderBy('order').onSnapshot(snapshot => {

		let sections = {};

		snapshot.docChanges().forEach(change => {
			if (change.type === 'removed') return;
			let doc = change.doc;
			let id = doc.id;
			let section = doc.data();
			section.id = id;
			sections[id] = section;
		});

		store.dispatch(updateSections(sections));

	});
};

export const connectLiveTags = (store) => {
	db.collection(TAGS_COLLECTION).onSnapshot(snapshot => {

		let tags = {};

		snapshot.docChanges().forEach(change => {
			if (change.type === 'removed') return;
			let doc = change.doc;
			let id = doc.id;
			let tag = doc.data();
			tag.id = id;
			tags[id] = tag;
		});

		store.dispatch(updateTags(tags));

	});
};


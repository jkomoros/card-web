import firebase from '@firebase/app';

import '@firebase/auth';
import '@firebase/firestore';
import '@firebase/functions';

import {
	FIREBASE_DEV_CONFIG,
	FIREBASE_PROD_CONFIG,
	FIREBASE_REGION
} from '../../config.GENERATED.SECRET.js';

import {
	store
} from '../store.js';

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
	updateReadingList
} from './user.js';

import {
	cardSetNormalizedTextProperties
} from '../util.js';

import {
	selectUserMayViewApp
} from '../selectors.js';

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

const legalCallable = firebaseApp.functions(FIREBASE_REGION).httpsCallable('legal');

export const slugLegal = async (newSlug) => {
	const result = await legalCallable({type:'slug', value:newSlug});
	return result.data;
};

export const connectLiveMessages = () => {
	if (!selectUserMayViewApp(store.getState())) return;
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

export const connectLiveThreads = () => {
	if (!selectUserMayViewApp(store.getState())) return;
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

export const connectLiveStars = (uid) => {
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

export const connectLiveReads = (uid) => {
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

export const connectLiveReadingList = (uid) => {
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

export const connectLiveAuthors = () => {
	if (!selectUserMayViewApp(store.getState())) return;
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

const cardSnapshotReceiver = (snapshot) => {

	let cards = {};

	snapshot.docChanges().forEach(change => {
		if (change.type === 'removed') return;
		let doc = change.doc;
		let id = doc.id;
		let card = doc.data();
		card.id = id;
		cardSetNormalizedTextProperties(card);
		cards[id] = card;
	});

	store.dispatch(updateCards(cards, true));

};

export const connectLivePublishedCards = () => {
	if (!selectUserMayViewApp(store.getState())) return;
	db.collection(CARDS_COLLECTION).where('published', '==', true).onSnapshot(cardSnapshotReceiver);
};

let liveUnpublishedCardsForUserAuthorUnsubscribe = null;
let liveUnpublishedCardsForUserEditorUnsubscribe = null;

export const connectLiveUnpublishedCardsForUser = (uid) => {
	if (!selectUserMayViewApp(store.getState())) return;
	disconnectLiveUnpublishedCardsForUser();
	if (!uid) return;
	liveUnpublishedCardsForUserAuthorUnsubscribe = db.collection(CARDS_COLLECTION).where('author', '==', uid).where('published', '==', false).onSnapshot(cardSnapshotReceiver);
	liveUnpublishedCardsForUserEditorUnsubscribe = db.collection(CARDS_COLLECTION).where('editors', 'array-contains', uid).where('published', '==', false).onSnapshot(cardSnapshotReceiver);
};

const disconnectLiveUnpublishedCardsForUser = () => {
	if (liveUnpublishedCardsForUserAuthorUnsubscribe) {
		liveUnpublishedCardsForUserAuthorUnsubscribe();
		liveUnpublishedCardsForUserAuthorUnsubscribe = null;
	}
	if (liveUnpublishedCardsForUserEditorUnsubscribe) {
		liveUnpublishedCardsForUserEditorUnsubscribe();
		liveUnpublishedCardsForUserEditorUnsubscribe = null;
	}
};

export const connectLiveUnpublishedCards = () => {
	if (!selectUserMayViewApp(store.getState())) return;
	disconnectLiveUnpublishedCardsForUser();
	db.collection(CARDS_COLLECTION).where('published', '==', false).onSnapshot(cardSnapshotReceiver);
};

export const connectLiveSections = () => {
	if (!selectUserMayViewApp(store.getState())) return;
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

export const connectLiveTags = () => {
	if (!selectUserMayViewApp(store.getState())) return;
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


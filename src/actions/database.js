import firebaseImpl from '@firebase/app';

import '@firebase/auth';
import '@firebase/firestore';

import {
	FIREBASE_DEV_CONFIG,
	FIREBASE_PROD_CONFIG
} from '../../config.GENERATED.SECRET.js';

export const firebase = firebaseImpl;

export let DEV_MODE = false;
//Deliberately only do devmode if the host is localhost. If you want it
//in local mode, just do 127.0.0.1 instead.
if (window.location.hostname == 'localhost') DEV_MODE = true;
if (window.location.hostname.indexOf('dev-') >= 0) DEV_MODE = true;
let config = DEV_MODE ? FIREBASE_DEV_CONFIG : FIREBASE_PROD_CONFIG;
// Initialize Firebase
firebase.initializeApp(config);

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
	updateReadingList
} from './user.js';

import {
	innerTextForHTML,
	normalizedWords
} from '../util.js';

import {
	selectUserMayViewApp
} from '../selectors.js';

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

export const connectLiveMessages = (store) => {
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

export const connectLiveThreads = (store) => {
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

export const connectLivePublishedCards = (store) => {
	if (!selectUserMayViewApp(store.getState())) return;
	db.collection(CARDS_COLLECTION).where('published', '==', true).onSnapshot(snapshot => {

		let cards = {};

		snapshot.docChanges().forEach(change => {
			if (change.type === 'removed') return;
			let doc = change.doc;
			let id = doc.id;
			let card = doc.data();
			card.id = id;
			//These three properties are expected to be set by TEXT_SEARCH_PROPERTIES
			card.normalizedBody = normalizedWords(innerTextForHTML(card.body || '')).join(' ');
			card.normalizedTitle = normalizedWords(card.title).join(' ');
			card.normalizedSubtitle = normalizedWords(card.subtitle).join(' ');
			card.normalizedInboundLinksText = normalizedWords(Object.values(card.links_inbound_text).join(' ')).join(' ');
			cards[id] = card;
		});

		store.dispatch(updateCards(cards, false));

	});
};

export const connectLiveUnpublishedCards = (store) => {
	if (!selectUserMayViewApp(store.getState())) return;
	db.collection(CARDS_COLLECTION).where('published', '==', false).onSnapshot(snapshot => {

		let cards = {};

		snapshot.docChanges().forEach(change => {
			if (change.type === 'removed') return;
			let doc = change.doc;
			let id = doc.id;
			let card = doc.data();
			card.id = id;
			//These three properties are expected to be set by TEXT_SEARCH_PROPERTIES
			card.normalizedBody = normalizedWords(innerTextForHTML(card.body || '')).join(' ');
			card.normalizedTitle = normalizedWords(card.title).join(' ');
			card.normalizedSubtitle = normalizedWords(card.subtitle).join(' ');
			card.normalizedInboundLinksText = normalizedWords(Object.values(card.links_inbound_text).join(' ')).join(' ');
			cards[id] = card;
		});

		store.dispatch(updateCards(cards, true));

	});
};

export const connectLiveSections = (store) => {
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

export const connectLiveTags = (store) => {
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


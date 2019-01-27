import firebaseImpl from '../../node_modules/firebase/app';

import '../../node_modules/firebase/auth';
import '../../node_modules/firebase/firestore';
import '../../node_modules/firebase/messaging';

export const firebase = firebaseImpl;

export let DEV_MODE = false;
var config;
//Deliberately only do devmode if the host is localhost. If you want it
//in local mode, just do 127.0.0.1 instead.
if (window.location.hostname == 'localhost') DEV_MODE = true;
if (window.location.hostname.indexOf('dev-') >= 0) DEV_MODE = true;
if (DEV_MODE) {
	config = {
		apiKey: 'AIzaSyAMJMN0rfauE1fNmZtSktR1c9pOhjbj5wM',
		authDomain: 'dev-complexity-compendium.firebaseapp.com',
		databaseURL: 'https://dev-complexity-compendium.firebaseio.com',
		projectId: 'dev-complexity-compendium',
		storageBucket: 'dev-complexity-compendium.appspot.com',
		messagingSenderId: '833356784081'
	};
} else {
	config = {
		apiKey: 'AIzaSyApU8WmBkOLnqlCD6sRnbZgj3EUybOOZ54',
		authDomain: 'complexity-compendium.firebaseapp.com',
		databaseURL: 'https://complexity-compendium.firebaseio.com',
		projectId: 'complexity-compendium',
		storageBucket: 'complexity-compendium.appspot.com',
		messagingSenderId: '711980530249'
	};
}
// Initialize Firebase
firebase.initializeApp(config);

const PROD_VAPID = 'BBXFZPnWiK_tO47-ES7lhkHK9Grlc4W8kA7IWiTsKQLMQIk9fFLiz1IhSnq9j2MwpzhlczmqSPcNiXRZvDIyFBE';
const DEV_VAPID = 'BO-C0PDdWRvIKSjZmpF_llbdyENpv6FRYGpze_aA0D63wQ7af2YggVXahyxWjD9Sd-vKfbxHVuJIXDlFtu1yBjA';

export const messaging = firebase.messaging();
messaging.usePublicVapidKey(DEV_MODE ? DEV_VAPID : PROD_VAPID);
//NOTE: additional messaging setup is further down in this file.

export const db = firebase.firestore();

db.settings({
	timestampsInSnapshots:true,
});

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
	updateThreads,
	updateCardThreads
} from './comments.js';

import {
	updateStars,
	updateReads,
	updateNotificationsToken,
} from './user.js';

import {
	store 
} from '../store.js';

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

//Additional messages initalization

//Initalize with current state of token.
messaging.getToken().then(token => {
	store.dispatch(updateNotificationsToken(token));
});
//Update the store if the token is removed for some other reason.
messaging.onTokenRefresh(() => {
	messaging.getToken().then(token => {
		store.dispatch(updateNotificationsToken(token));
	});
});

let liveMessagesUnsubscribe = null;
let liveThreadsUnsubscribe = null;
let liveStarsUnsubscribe = null;
let liveReadsUnsubscribe = null;

export const connectLiveMessages = (store, cardId) => {
	if (liveMessagesUnsubscribe) {
		liveMessagesUnsubscribe();
		liveMessagesUnsubscribe = null;
	}
	//Deliberately DO fetch deleted messages, so we can render stubs for them.
	liveMessagesUnsubscribe = db.collection(MESSAGES_COLLECTION).where('card', '==', cardId).onSnapshot(snapshot => {
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

export const connectLiveThreads = (store, cardId) => {
	if (liveThreadsUnsubscribe) {
		liveThreadsUnsubscribe();
		liveThreadsUnsubscribe = null;
	}
	let firstUpdate = true;
	liveThreadsUnsubscribe = db.collection(THREADS_COLLECTION).where('card', '==', cardId).where('deleted', '==', false).where('resolved', '==', false).onSnapshot(snapshot => {
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
		store.dispatch(updateCardThreads(threadsToAdd, threadsToRemove, firstUpdate));
		firstUpdate = false;
	});
};

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


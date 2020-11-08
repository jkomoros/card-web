import {
	db,
	functions
} from '../firebase.js';

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
	updateMaintenanceModeEnabled
} from './app.js';

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
} from '../card_fields.js';

import {
	selectUserMayViewApp
} from '../selectors.js';

import {
	PERMISSION_EDIT_CARD
} from '../permissions.js';

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

const legalCallable = functions.httpsCallable('legal');
const statusCallable = functions.httpsCallable('status');

export const slugLegal = async (newSlug) => {
	const result = await legalCallable({type:'slug', value:newSlug});
	return result.data;
};

const warmupSlugLegal = (force) => {
	if (!force && !userHadActivity) return;
	//Mark that we've already triggered for that activity, and will need new
	//activity to trigger again.
	userHadActivity = false;
	return legalCallable({type:'warmup'});
};

let slugLegalInterval = 0;
const KEEP_WARM_INTERVAL = 2 * 60 * 1000;

let userHadActivity = false;

const userActivity = () => {
	userHadActivity = true;
};

//keepSlugLegalWarm should be called whenever we notice that the user should
//keep slugLegal warm. Repeated calls won't cause it to call extra times.
export const keepSlugLegalWarm = () => {
	//Only start the interval once.
	if (slugLegalInterval) return;
	document.addEventListener('mousemove', userActivity);
	document.addEventListener('keydown', userActivity);
	warmupSlugLegal(true);
	slugLegalInterval = setInterval(warmupSlugLegal, KEEP_WARM_INTERVAL);
};

const maintenanceModeEnabled = async () => {
	let result = await statusCallable({type:'maintenance_mode'});
	return result.data;
};

export const fetchMaintenanceModeEnabled = async () => {
	let maintenanceEnabled = false;
	try {
		maintenanceEnabled = await maintenanceModeEnabled();
	} catch(err) {
		//Every so often this deadline reports as exceeded for some reason, but
		//it should never show to a user.
		console.warn(err);
	}
	if (maintenanceEnabled) {
		console.warn('Maintenance mode is enabled, so cards cannot be edited. Run \'gulp turn-maintenance-mode-off\' to disable it.');
		store.dispatch(updateMaintenanceModeEnabled(true));
	}
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

const cardSnapshotReceiver = (unpublished) =>{
	
	return (snapshot) => {
		let cards = {};

		snapshot.docChanges().forEach(change => {
			if (change.type === 'removed') return;
			let doc = change.doc;
			let id = doc.id;
			//Ensure that timestamps are never null. If this isn't set, then
			//when cards are first created (and other times) they will have null
			//timestamps on some of the updates, an if we read them we'll get
			//confused. Without this you can't open a card immediately for
			//editing for example. See
			//https://medium.com/firebase-developers/the-secrets-of-firestore-fieldvalue-servertimestamp-revealed-29dd7a38a82b
			let card = doc.data({serverTimestamps: 'estimate'});
			card.id = id;
			cardSetNormalizedTextProperties(card);
			cards[id] = card;
		});

		store.dispatch(updateCards(cards, unpublished));
	};

};

export const connectLivePublishedCards = () => {
	if (!selectUserMayViewApp(store.getState())) return;
	db.collection(CARDS_COLLECTION).where('published', '==', true).onSnapshot(cardSnapshotReceiver(false));
};

let liveUnpublishedCardsForUserAuthorUnsubscribe = null;
let liveUnpublishedCardsForUserEditorUnsubscribe = null;

export const connectLiveUnpublishedCardsForUser = (uid) => {
	if (!selectUserMayViewApp(store.getState())) return;
	disconnectLiveUnpublishedCardsForUser();
	if (!uid) return;
	liveUnpublishedCardsForUserAuthorUnsubscribe = db.collection(CARDS_COLLECTION).where('author', '==', uid).where('published', '==', false).onSnapshot(cardSnapshotReceiver(true));
	liveUnpublishedCardsForUserEditorUnsubscribe = db.collection(CARDS_COLLECTION).where('permissions.' + PERMISSION_EDIT_CARD, 'array-contains', uid).where('published', '==', false).onSnapshot(cardSnapshotReceiver(true));
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
	db.collection(CARDS_COLLECTION).where('published', '==', false).onSnapshot(cardSnapshotReceiver(true));
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


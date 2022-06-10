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
	removeCards,
	expectUnpublishedCards,
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
	selectUserMayViewApp,
	selectSlugIndex
} from '../selectors.js';

import {
	PERMISSION_EDIT_CARD
} from '../permissions.js';

import {
	collection,
	onSnapshot,
	where,
	query,
	orderBy
} from 'firebase/firestore';

import {
	httpsCallable
} from 'firebase/functions';

import {
	DISABLE_CALLABLE_CLOUD_FUNCTIONS
} from '../config.GENERATED.SECRET.js';

import {
	State,
	Slug,
	CommentMessages,
	CommentMessage,
	CommentThreads,
	CommentThread,
	CommentThreadID,
	Uid,
	CardID
} from '../types.js';

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

const legalCallable = httpsCallable(functions, 'legal');

type LegalResult = {
	legal : boolean,
	reason : string,
}

//slugLegal returns an object with {legal: bool, reason: string}
export const slugLegal = async (newSlug : Slug) : Promise<LegalResult>  => {

	//First, early reject any slugs we already know exist.
	const slugIndex = selectSlugIndex(store.getState() as State);
	if (slugIndex[newSlug]) {
		return {
			legal: false,
			reason: 'The card with ID ' + slugIndex[newSlug] + ' already has that slug.'
		};
	}

	//TODO: this may technically be wrong; a card we can't see might have the same slug.
	if (DISABLE_CALLABLE_CLOUD_FUNCTIONS) return {legal: true, reason: ''};

	const result = await legalCallable({type:'slug', value:newSlug});
	return result.data as LegalResult;
};

const warmupSlugLegal = (force : boolean = false) : void => {
	if (DISABLE_CALLABLE_CLOUD_FUNCTIONS) return;
	if (!force && !userHadActivity) return;
	//Mark that we've already triggered for that activity, and will need new
	//activity to trigger again.
	userHadActivity = false;
	legalCallable({type:'warmup'});
	return;
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
	slugLegalInterval = window.setInterval(warmupSlugLegal, KEEP_WARM_INTERVAL);
};

export const connectLiveMessages = () => {
	if (!selectUserMayViewApp(store.getState() as State)) return;
	//Deliberately DO fetch deleted messages, so we can render stubs for them.
	onSnapshot(collection(db, MESSAGES_COLLECTION), snapshot => {
		let messages : CommentMessages = {};
		snapshot.docChanges().forEach(change => {
			if (change.type === 'removed') return;
			let doc = change.doc;
			let id = doc.id;
			let message : CommentMessage = {...doc.data(), id} as CommentMessage;
			messages[id] = message;
		});

		store.dispatch(updateMessages(messages));
	});
};

export const connectLiveThreads = () => {
	if (!selectUserMayViewApp(store.getState() as State)) return;
	onSnapshot(query(collection(db, THREADS_COLLECTION), where('deleted', '==', false), where('resolved', '==', false)), snapshot => {
		let threads : CommentThreads = {};
		let threadsToAdd : CommentThreadID[] = [];
		let threadsToRemove : CommentThreadID[] = [];
		snapshot.docChanges().forEach(change => {
			let doc = change.doc;
			if (change.type === 'removed') {
				threadsToRemove.push(doc.id);
				return;
			}
			let id = doc.id;
			let thread : CommentThread = {...doc.data(), id} as CommentThread;
			threadsToAdd.push(id);
			threads[id] = thread;
		});
		store.dispatch(updateThreads(threads));
	});
};

let liveStarsUnsubscribe : () => void = null;
let liveReadsUnsubscribe : () => void  = null;
let liveReadingListUnsubscribe : () => void = null;

export const disconnectLiveStars = () => {
	if (liveStarsUnsubscribe) {
		liveStarsUnsubscribe();
		liveStarsUnsubscribe = null;
	}
};

export const connectLiveStars = (uid : Uid) => {
	disconnectLiveStars();
	liveStarsUnsubscribe = onSnapshot(query(collection(db, STARS_COLLECTION), where('owner', '==', uid)), snapshot => {
		let starsToAdd : CardID[] = [];
		let starsToRemove : CardID[] = [];
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

export const connectLiveReads = (uid : Uid) => {
	disconnectLiveReads();
	liveReadsUnsubscribe = onSnapshot(query(collection(db, READS_COLLECTION), where('owner', '==', uid)),  snapshot => {
		let readsToAdd : CardID[] = [];
		let readsToRemove : CardID[] = [];
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

export const connectLiveReadingList = (uid : Uid) => {
	disconnectLiveReadingList();
	liveReadingListUnsubscribe = onSnapshot(query(collection(db, READING_LISTS_COLLECTION), where('owner', '==', uid)), snapshot => {
		let list : CardID[] = [];
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
	if (!selectUserMayViewApp(store.getState() as State)) return;
	onSnapshot(collection(db, AUTHORS_COLLECTION), snapshot => {

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
		let cardIDsToRemove = [];

		snapshot.docChanges().forEach(change => {
			if (change.type === 'removed') {
				cardIDsToRemove.push(change.doc.id);
				return;
			}
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
			cards[id] = card;
		});

		store.dispatch(updateCards(cards, unpublished));
		if (cardIDsToRemove.length) store.dispatch(removeCards(cardIDsToRemove, unpublished));
	};

};

export const connectLivePublishedCards = () => {
	if (!selectUserMayViewApp(store.getState() as State)) return;
	onSnapshot(query(collection(db, CARDS_COLLECTION), where('published', '==', true)), cardSnapshotReceiver(false));
};

let liveUnpublishedCardsForUserAuthorUnsubscribe = null;
let liveUnpublishedCardsForUserEditorUnsubscribe = null;

export const connectLiveUnpublishedCardsForUser = (uid) => {
	if (!selectUserMayViewApp(store.getState() as State)) return;
	disconnectLiveUnpublishedCardsForUser();
	if (!uid) return;
	//Tell the store to expect new unpublished cards to load, and that we shouldn't consider ourselves loaded yet
	store.dispatch(expectUnpublishedCards());
	liveUnpublishedCardsForUserAuthorUnsubscribe = onSnapshot(query(collection(db, CARDS_COLLECTION), where('author', '==', uid), where('published', '==', false)), cardSnapshotReceiver(true));
	liveUnpublishedCardsForUserEditorUnsubscribe = onSnapshot(query(collection(db, CARDS_COLLECTION), where('permissions.' + PERMISSION_EDIT_CARD, 'array-contains', uid), where('published', '==', false)), cardSnapshotReceiver(true));
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
	if (!selectUserMayViewApp(store.getState() as State)) return;
	disconnectLiveUnpublishedCardsForUser();
	//Tell the store to expect new unpublished cards to load, and that we shouldn't consider ourselves loaded yet
	store.dispatch(expectUnpublishedCards());
	onSnapshot(query(collection(db, CARDS_COLLECTION), where('published', '==', false)), cardSnapshotReceiver(true));
};

export const connectLiveSections = () => {
	if (!selectUserMayViewApp(store.getState() as State)) return;
	onSnapshot(query(collection(db, SECTIONS_COLLECTION), orderBy('order')), snapshot => {

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
	if (!selectUserMayViewApp(store.getState() as State)) return;
	onSnapshot(collection(db, TAGS_COLLECTION), snapshot => {

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


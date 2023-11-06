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
	orderBy,
	QuerySnapshot
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
	CardID,
	AuthorsMap,
	Author,
	Cards,
	Card,
	Sections,
	Tags,
	Section,
} from '../types.js';

import {
	MESSAGES_COLLECTION,
	THREADS_COLLECTION,
	STARS_COLLECTION,
	READS_COLLECTION,
	READING_LISTS_COLLECTION,
	AUTHORS_COLLECTION,
	CARDS_COLLECTION,
	SECTIONS_COLLECTION,
	TAGS_COLLECTION
} from '../type_constants.js';

//Replicated in `functions/src/types.ts`;
type LegalRequestData = {
	type: 'warmup'
} | {
	type: 'slug',
	value: string
};

//Replicated in `functions/src/types.ts`;
type LegalResponseData = {
	legal: boolean,
	reason: string
};

const legalCallable = httpsCallable<LegalRequestData, LegalResponseData>(functions, 'legal');

//slugLegal returns an object with {legal: bool, reason: string}
export const slugLegal = async (newSlug : Slug) : Promise<LegalResponseData>  => {

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
	return result.data;
};

const warmupSlugLegal = (force = false) : void => {
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
		const messages : CommentMessages = {};
		snapshot.docChanges().forEach(change => {
			if (change.type === 'removed') return;
			const doc = change.doc;
			const id = doc.id;
			const message : CommentMessage = {...doc.data(), id} as CommentMessage;
			messages[id] = message;
		});

		store.dispatch(updateMessages(messages));
	});
};

export const connectLiveThreads = () => {
	if (!selectUserMayViewApp(store.getState() as State)) return;
	onSnapshot(query(collection(db, THREADS_COLLECTION), where('deleted', '==', false), where('resolved', '==', false)), snapshot => {
		const threads : CommentThreads = {};
		const threadsToAdd : CommentThreadID[] = [];
		const threadsToRemove : CommentThreadID[] = [];
		snapshot.docChanges().forEach(change => {
			const doc = change.doc;
			if (change.type === 'removed') {
				threadsToRemove.push(doc.id);
				return;
			}
			const id = doc.id;
			const thread : CommentThread = {...doc.data(), id} as CommentThread;
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
		const starsToAdd : CardID[] = [];
		const starsToRemove : CardID[] = [];
		snapshot.docChanges().forEach(change => {
			const doc = change.doc;
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
		const readsToAdd : CardID[] = [];
		const readsToRemove : CardID[] = [];
		snapshot.docChanges().forEach(change => {
			const doc = change.doc;
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
			const doc = change.doc;
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

		const authors : AuthorsMap = {};

		snapshot.docChanges().forEach(change => {
			if (change.type === 'removed') return;
			const doc = change.doc;
			const id = doc.id;
			const author : Author = {...doc.data(), id} as Author;
			authors[id] = author;
		});

		store.dispatch(updateAuthors(authors));

	});
};

const cardSnapshotReceiver = (unpublished : boolean) =>{
	
	return (snapshot : QuerySnapshot) => {
		const cards : Cards = {};
		const cardIDsToRemove : CardID[] = [];

		snapshot.docChanges().forEach(change => {
			if (change.type === 'removed') {
				cardIDsToRemove.push(change.doc.id);
				return;
			}
			const doc = change.doc;
			const id : CardID = doc.id;
			//Ensure that timestamps are never null. If this isn't set, then
			//when cards are first created (and other times) they will have null
			//timestamps on some of the updates, an if we read them we'll get
			//confused. Without this you can't open a card immediately for
			//editing for example. See
			//https://medium.com/firebase-developers/the-secrets-of-firestore-fieldvalue-servertimestamp-revealed-29dd7a38a82b
			const card : Card = {...doc.data({serverTimestamps: 'estimate'}), id} as Card;
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

let liveUnpublishedCardsForUserAuthorUnsubscribe : () => void = null;
let liveUnpublishedCardsForUserEditorUnsubscribe : () => void  = null;

export const connectLiveUnpublishedCardsForUser = (uid : Uid) => {
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

		const sections : Sections = {};

		snapshot.docChanges().forEach(change => {
			if (change.type === 'removed') return;
			const doc = change.doc;
			const id = doc.id;
			const section = {...doc.data(), id} as Section;
			sections[id] = section;
		});

		store.dispatch(updateSections(sections));

	});
};

export const connectLiveTags = () => {
	if (!selectUserMayViewApp(store.getState() as State)) return;
	onSnapshot(collection(db, TAGS_COLLECTION), snapshot => {

		const tags : Tags = {};

		snapshot.docChanges().forEach(change => {
			if (change.type === 'removed') return;
			const doc = change.doc;
			const id = doc.id;
			const tag = {...doc.data(), id} as Section;
			tags[id] = tag;
		});

		store.dispatch(updateTags(tags));

	});
};


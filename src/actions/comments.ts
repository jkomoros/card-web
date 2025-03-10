import {
	AUTHORS_COLLECTION,
	THREADS_COLLECTION,
	MESSAGES_COLLECTION,
	CARDS_COLLECTION,
} from '../../shared/collection-constants.js';

import {
	doc,
	runTransaction,
	arrayUnion,
	serverTimestamp,
	DocumentReference
} from 'firebase/firestore';

import {
	db,
} from '../firebase.js';

import {
	selectActiveCard,
	selectUserMayComment,
	getUserMayResolveThread,
	getUserMayEditMessage,
	selectUser,
	selectActiveCollection,
} from '../selectors.js';

import {
	randomString
} from '../util.js';

import {
	refreshCommentRedirect
} from './app.js';

import {
	ThunkSomeAction
} from '../store.js';

import {
	CommentMessage,
	CommentMessages,
	CommentThread,
	CommentThreads,
	Uid,
	UserInfo
} from '../types.js';

import {
	MultiBatch
} from '../multi_batch.js';

import {
	COMMENTS_UPDATE_MESSAGES,
	COMMENTS_UPDATE_THREADS
} from '../actions.js';

type BatchLikeSet = {
	set(ref : DocumentReference, data : object) : void
}

export const ensureAuthor = (batch : BatchLikeSet, user : UserInfo) => {
	batch.set(doc(db, AUTHORS_COLLECTION, user.uid), {
		updated: serverTimestamp(),
		photoURL: user.photoURL,
		displayName: user.displayName
	});
};

export const createAuthorStub = (uid : Uid) => {
	//useful if you want to create an author stub to be filled in by that user
	//when they next login, for example to manually add an editor or
	//collaborator to a card.
	const batch = new MultiBatch(db);
	//By using set with merge:true, if it already exists, we won't overwrite any
	//fields, but will ensure a stub exists.
	batch.set(doc(db, AUTHORS_COLLECTION, uid), {}, {merge:true});
	batch.commit();
};

export const resolveThread = (thread : CommentThread) : ThunkSomeAction => (_, getState) => {
	const state = getState();

	if (!thread || !thread.id) {
		console.log('No thread provided');
		return;
	}

	if (!getUserMayResolveThread(state, thread)) {
		console.log('The user isn\'t allowd to resolve that thread');
		return;
	}

	const cardRef = doc(db, CARDS_COLLECTION, thread.card);
	const threadRef = doc(db, THREADS_COLLECTION, thread.id);

	runTransaction(db, async transaction => {
		const cardDoc = await transaction.get(cardRef);
		if (!cardDoc.exists()) {
			throw 'Doc doesn\'t exist!';
		}
		let newThreadCount = (cardDoc.data().thread_count || 0) - 1;
		if (newThreadCount < 0) newThreadCount = 0;
		const newThreadResolvedCount = (cardDoc.data().thread_resolved_count || 0) + 1;
		transaction.update(cardRef, {thread_count: newThreadCount, thread_resolved_count: newThreadResolvedCount});
		transaction.update(threadRef, {
			resolved: true,
			updated: serverTimestamp()
		});
	});
};

export const deleteMessage = (message : CommentMessage) : ThunkSomeAction => (_, getState) => {
	const state = getState();
	if (!getUserMayEditMessage(state, message)) {
		console.log('User isn\'t allowed to edit that message!');
		return;
	}

	if (!message || !message.id) {
		console.log('No message provided!');
		return;
	}

	const batch = new MultiBatch(db);

	batch.update(doc(db, MESSAGES_COLLECTION, message.id), {
		message: '',
		deleted: true,
		updated: serverTimestamp()
	});

	batch.commit();
};

export const editMessage = (message : CommentMessage, newMessage : string) : ThunkSomeAction => (_, getState) => {
  
	const state = getState();

	if (!getUserMayEditMessage(state, message)) {
		console.log('User isn\'t allowed to edit that message!');
		return;
	}

	if (!message || !message.id) {
		console.log('No message provided');
		return;
	}

	const batch = new MultiBatch(db);

	batch.update(doc(db, MESSAGES_COLLECTION, message.id), {
		message: newMessage,
		deleted: false,
		updated: serverTimestamp()
	});

	batch.commit();

};

export const addMessage = (thread : CommentThread, message : string) : ThunkSomeAction => (_, getState) => {
	const state = getState();
	const card = selectActiveCard(state);
	if (!card || !card.id) {
		console.warn('No active card!');
		return;
	}
	if (!selectUserMayComment(state)) {
		console.warn('You must be signed in to comment!');
		return;
	}

	if (!thread || !thread.id) {
		console.warn('No thread!');
		return;
	}

	if (!message) {
		console.warn('No message provided');
		return;
	}
  
	const user = selectUser(state);

	if (!user) {
		console.warn('No uid');
		return;
	}

	const activeCollection = selectActiveCollection(state);
	const collectionIsFallback = activeCollection && activeCollection.isFallback;
	if (collectionIsFallback) {
		console.log('Interacting with fallback content not allowed');
		return;
	}

	const messageId = randomString(16);
	const threadId = thread.id;

	const batch = new MultiBatch(db);

	ensureAuthor(batch, user);

	batch.update(doc(db, THREADS_COLLECTION, threadId), {
		updated: serverTimestamp(),
		messages: arrayUnion(messageId)
	});

	batch.update(doc(db, CARDS_COLLECTION, card.id),{
		updated_message: serverTimestamp(),
	});

	batch.set(doc(db, MESSAGES_COLLECTION, messageId), {
		card: card.id,
		message: message,
		thread: threadId,
		author: user.uid,
		created: serverTimestamp(),
		updated: serverTimestamp(),
		deleted: false
	});

	batch.commit();

};

export const createThread = (message : string) : ThunkSomeAction => (_, getState) => {
	const state = getState();
	const card = selectActiveCard(state);
	if (!card || !card.id) {
		console.warn('No active card!');
		return;
	}
	if (!selectUserMayComment(state)) {
		console.warn('You must be signed in to comment!');
		return;
	}

	if (!message) {
		console.warn('Empty message');
		return;
	}
  
	const user = selectUser(state);

	if (!user) {
		console.warn('No uid');
		return;
	}
	
	const activeCollection = selectActiveCollection(state);
	const collectionIsFallback = activeCollection && activeCollection.isFallback;
	if (collectionIsFallback) {
		console.log('Interacting with fallback content not allowed');
		return;
	}

	const messageId = randomString(16);
	const threadId = randomString(16);

	const cardRef = doc(db, CARDS_COLLECTION, card.id);
	const threadRef = doc(db, THREADS_COLLECTION, threadId);
	const messageRef = doc(db, MESSAGES_COLLECTION, messageId);

	runTransaction(db, async transaction => {
		const cardDoc = await transaction.get(cardRef);
		if (!cardDoc.exists()) {
			throw 'Doc doesn\'t exist!';
		}
		const newThreadCount = (cardDoc.data().thread_count || 0) + 1;
		transaction.update(cardRef, {
			thread_count: newThreadCount,
			updated_message: serverTimestamp(),
		});

		ensureAuthor(transaction, user);

		transaction.set(messageRef, {
			card: card.id,
			message: message,
			thread: threadId,
			author: user.uid,
			created: serverTimestamp(),
			updated: serverTimestamp(),
			deleted: false
		});

		transaction.set(threadRef, {
			card: card.id,
			parent_message: '',
			messages: [messageId],
			author: user.uid,
			created: serverTimestamp(),
			updated: serverTimestamp(),
			resolved: false,
			deleted: false
		});

	});

};

export const updateThreads = (threads : CommentThreads) : ThunkSomeAction => (dispatch) => {
	dispatch({
		type: COMMENTS_UPDATE_THREADS,
		threads
	});
	dispatch(refreshCommentRedirect());
};

export const updateMessages = (messages : CommentMessages) : ThunkSomeAction => (dispatch) => {
	dispatch({
		type: COMMENTS_UPDATE_MESSAGES,
		messages
	});
	dispatch(refreshCommentRedirect());
};
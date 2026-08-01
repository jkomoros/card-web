import {
	AUTHORS_COLLECTION,
	THREADS_COLLECTION,
	MESSAGES_COLLECTION,
	CARDS_COLLECTION,
} from '../../shared/collection-constants.js';

import {
	doc,
	getDocFromServer,
	runTransaction,
	arrayUnion,
	serverTimestamp,
	DocumentReference
} from 'firebase/firestore';

import {
	AuxWriteOutcome,
	makeAuxWriteIntent,
	registerAuxWriteExecutor,
	runDurableAuxWrite
} from '../aux-write-queue.js';

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
} from '../../shared/util.js';

import {
	refreshCommentRedirect
} from './app.js';

import {
	store,
	ThunkSomeAction
} from '../store.js';

import {
	State
} from '../types.js';

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

import {
	trackMutation
} from '../mutation-barrier.js';

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
	return batch.commit();
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

	//A voided promise here swallowed MutationFencedError entirely: in a fenced
	//tab the user got no feedback and no error, and there is no
	//unhandledrejection handler anywhere in src/. Say something.
	return trackMutation(() => runTransaction(db, async transaction => {
		const cardDoc = await transaction.get(cardRef);
		if (!cardDoc.exists()) {
			throw 'Doc doesn\'t exist!';
		}
		let newThreadCount = (cardDoc.data().thread_count || 0) - 1;
		if (newThreadCount < 0) newThreadCount = 0;
		const newThreadResolvedCount = (cardDoc.data().thread_resolved_count || 0) + 1;
		//updated-invariant: exempt — reader-driven thread counters
		//(cardEditMinor rules path). runTransaction bypasses the MultiBatch
		//guard, and counter drift is an accepted tradeoff (see sync design doc).
		transaction.update(cardRef, {thread_count: newThreadCount, thread_resolved_count: newThreadResolvedCount});
		transaction.update(threadRef, {
			resolved: true,
			updated: serverTimestamp()
		});
	})).catch(err => {
		console.warn('Comment write did not complete:', err);
		alert(`That comment action could not be saved: ${err instanceof Error ? err.message : String(err)}`);
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

	return batch.commit();
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

	return batch.commit();

};

//--- Durable comments ------------------------------------------------------
//C18: comments had no write-ahead record, so a crash or a close between the
//accepted UI action and the server ack lost what the user wrote — the one
//kind of loss where the content existed ONLY in the user's head and the DOM.
//
//Replay safety rests on the client-vended message id: its existence on the
//server proves whether the original write landed. That matters most for the
//new-thread path, which increments thread_count inside a transaction and is
//therefore not naturally idempotent.
const commentCommitted = async (messageRef : DocumentReference, label : string) : Promise<boolean> => {
	try {
		return (await getDocFromServer(messageRef)).exists();
	} catch (err) {
		//An unanswerable preflight is not a "no". Throwing without a `code`
		//keeps the queue from treating it as permanent and discarding the
		//user's comment.
		throw new Error(`${label} replay preflight could not be answered; retaining intent: ${String(err)}`);
	}
};

registerAuxWriteExecutor('comment-add', async (intent, isReplay) => {
	const payload = intent.payload;
	if (!payload || payload.kind !== 'comment-add') throw new Error('comment-add intent without its plan');
	const user = selectUser(store.getState() as State);
	if (!user) throw new Error('comment-add replayed with no signed-in user');
	const cardRef = doc(db, CARDS_COLLECTION, intent.cardID);
	const threadRef = doc(db, THREADS_COLLECTION, payload.threadID);
	const messageRef = doc(db, MESSAGES_COLLECTION, payload.messageID);
	if (isReplay && await commentCommitted(messageRef, 'comment-add')) return;

	const messageDoc = {
		card: intent.cardID,
		message: payload.message,
		thread: payload.threadID,
		author: user.uid,
		created: serverTimestamp(),
		updated: serverTimestamp(),
		deleted: false
	};

	if (!payload.newThread) {
		const batch = new MultiBatch(db);
		ensureAuthor(batch, user);
		batch.update(threadRef, {
			updated: serverTimestamp(),
			messages: arrayUnion(payload.messageID)
		});
		//updated-invariant: exempt — cardEditMinor rules path; commenters may
		//not touch `updated`, and message-count drift is an accepted tradeoff.
		batch.updateWithoutTimestampBump(cardRef, {
			updated_message: serverTimestamp(),
		});
		batch.set(messageRef, messageDoc);
		await batch.commit();
		return;
	}

	await trackMutation(() => runTransaction(db, async transaction => {
		const cardDoc = await transaction.get(cardRef);
		if (!cardDoc.exists()) throw new Error('Doc doesn\'t exist!');
		const newThreadCount = (cardDoc.data().thread_count || 0) + 1;
		//updated-invariant: exempt — reader-driven counters (thread_count,
		//updated_message); this cardEditMinor path may not touch `updated` and
		//runTransaction bypasses the MultiBatch guard. Accepted drift.
		transaction.update(cardRef, {
			thread_count: newThreadCount,
			updated_message: serverTimestamp(),
		});
		ensureAuthor(transaction, user);
		transaction.set(messageRef, messageDoc);
		transaction.set(threadRef, {
			card: intent.cardID,
			parent_message: '',
			messages: [payload.messageID],
			author: user.uid,
			created: serverTimestamp(),
			updated: serverTimestamp(),
			resolved: false,
			deleted: false
		});
	}));
});

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

	//Write-ahead, then attempt: the queue owns completion and replays this on
	//the next boot if the tab dies before the server acks.
	return runDurableAuxWrite(makeAuxWriteIntent(user.uid, 'comment-add', card.id, '', {
		kind: 'comment-add',
		messageID: messageId,
		threadID: threadId,
		message,
		newThread: false,
	})).then(reportCommentOutcome);

};

//Queuing is the feature, but saying nothing while the comment has not posted
//is not. The 'discarded' case already alerted from inside the queue.
const reportCommentOutcome = (outcome : AuxWriteOutcome) : void => {
	if (outcome !== 'queued') return;
	console.warn('Comment is queued and will post automatically when the connection recovers.');
	if (typeof window !== 'undefined') {
		window.setTimeout(() => alert('Your comment could not be posted right now. It has been saved and will post automatically when the connection recovers.'), 0);
	}
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

	//Write-ahead, then attempt. The new-thread path increments thread_count in
	//a transaction and is not naturally idempotent, so the executor preflights
	//the client-vended message id before replaying.
	return runDurableAuxWrite(makeAuxWriteIntent(user.uid, 'comment-add', card.id, '', {
		kind: 'comment-add',
		messageID: messageId,
		threadID: threadId,
		message,
		newThread: true,
	})).then(reportCommentOutcome);

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

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
	pendingCommentTextFor,
	readPendingAuxWrites,
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
	awaitInteractableCollection
} from './fallback-guard.js';

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

export const deleteMessage = (message : CommentMessage) : ThunkSomeAction => async (_, getState) => {
	const state = getState();
	//Unlike the edit path there is no compose box to reject into and nothing
	//awaits this dispatch, so failures REPORT rather than throw — a rejection
	//here would be unhandled, and there is no unhandledrejection handler in src/.
	try {
		if (!message || !message.id) throw new Error('No message provided');
		if (!getUserMayEditMessage(state, message)) throw new Error('You are not allowed to edit that message');
		//validIntent path-validates cardID and rejects the empty string, so an
		//intent built from a card-less message would be dropped on the next read.
		if (!message.card) throw new Error('That message is not attached to a card');
		const user = selectUser(state);
		if (!user) throw new Error('You must be signed in to delete a comment');
		if (message.deleted) return;

		const outcome = await runDurableAuxWrite(makeAuxWriteIntent(user.uid, 'comment-delete', message.card, '', {
			kind: 'comment-delete',
			messageID: message.id,
			baseMessage: pendingCommentTextFor(message.id) ?? message.message,
		}));
		//'discarded' already alerted from inside the queue via DISCARD_LABELS.
		if (outcome === 'queued' && typeof window !== 'undefined') {
			window.setTimeout(() => alert('That comment could not be deleted right now. The deletion has been saved and will apply automatically when the connection recovers.'), 0);
		}
	} catch (err) {
		console.warn('Comment delete did not complete:', err);
		alert(`That comment could not be deleted: ${err instanceof Error ? err.message : String(err)}`);
	}
};

export const editMessage = (message : CommentMessage, newMessage : string) : ThunkSomeAction => async (_, getState) => {
	const state = getState();
	//These guards used to console.log and return. composeCommit has ALREADY
	//dispatched PROMPT_COMPOSE_COMMIT by the time we run, so a silent return
	//closed the compose box and dropped the rewritten comment with nothing on
	//screen. Throwing is what runs composeCommit's restore path.
	if (!message || !message.id) throw new Error('No message provided');
	if (!getUserMayEditMessage(state, message)) throw new Error('You are not allowed to edit that message');
	if (!message.card) throw new Error('That message is not attached to a card');
	const user = selectUser(state);
	if (!user) throw new Error('You must be signed in to edit a comment');

	//Base on the QUEUE first: after a reload Redux shows the pre-edit server
	//text while an edit is still pending, and basing on that would make the
	//NEWER edit lose the conflict to the older one.
	const baseMessage = pendingCommentTextFor(message.id) ?? message.message;
	//A no-op edit should not burn an intent or bump `updated`.
	if (newMessage === baseMessage && !message.deleted) return;

	const outcome = await runDurableAuxWrite(makeAuxWriteIntent(user.uid, 'comment-edit', message.card, '', {
		kind: 'comment-edit',
		messageID: message.id,
		message: newMessage,
		baseMessage,
	}));
	reportCommentOutcome(outcome, 'edit');
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

//comment-add asks the server one question: does the message exist. An edit and
//a delete are UPDATEs on a document that already exists, so existence proves
//nothing — they need its VALUES.
const serverMessageState = async (messageRef : DocumentReference, label : string) : Promise<{message : string, deleted : boolean} | null> => {
	let snapshot;
	try {
		snapshot = await getDocFromServer(messageRef);
	} catch (err) {
		//Same discipline as commentCommitted: an unanswerable preflight is not
		//a "no", and throwing without a `code` keeps the queue from treating it
		//as permanent and discarding the user's text.
		throw new Error(`${label} replay preflight could not be answered; retaining intent: ${String(err)}`);
	}
	if (!snapshot.exists()) return null;
	const data = snapshot.data();
	return {
		message: typeof data.message === 'string' ? data.message : '',
		deleted: Boolean(data.deleted)
	};
};

//permanentFailure() in the queue classifies by Firestore error CODE only. A
//conflict IS permanent — no retry makes the server's text go back to what we
//planned against — so it must carry a code or the intent replays forever.
const permanentCommentError = (message : string) : Error => {
	const err = new Error(message) as Error & {code : string};
	err.code = 'failed-precondition';
	return err;
};

//An update against a message whose `set` has not landed returns not-found,
//which the queue calls permanent — it would DISCARD the edit. Replay normally
//runs the add first, but it SKIPS rather than stops at an intent still in
//flight in this session, so an `online` event inside the attempt window can
//reach the edit with the add unlanded. Refuse transiently instead.
const commentAddStillPending = (messageID : string) : boolean =>
	readPendingAuxWrites().some(intent =>
		intent.payload?.kind === 'comment-add' && intent.payload.messageID === messageID);

registerAuxWriteExecutor('comment-edit', async (intent, isReplay) => {
	const payload = intent.payload;
	if (!payload || payload.kind !== 'comment-edit') throw new Error('comment-edit intent without its plan');
	if (!selectUser(store.getState() as State)) throw new Error('comment-edit replayed with no signed-in user');
	if (commentAddStillPending(payload.messageID)) throw new Error('the comment this edit targets has not posted yet; retaining until it has');

	const messageRef = doc(db, MESSAGES_COLLECTION, payload.messageID);
	//Only on replay: on the first attempt the base was read moments ago, so a
	//preflight would cost a round trip on every edit and prove nothing.
	if (isReplay) {
		const current = await serverMessageState(messageRef, 'comment-edit');
		if (!current) throw permanentCommentError('the comment you edited no longer exists');
		//Already applied — by our own earlier attempt, or by someone who made
		//the identical edit. The outcome is what the intent asked for.
		if (current.message === payload.message && !current.deleted) return;
		//Changed after this edit was composed. Applying now would replace that
		//text silently.
		if (current.message !== payload.baseMessage) {
			throw permanentCommentError('this comment was changed elsewhere after you edited it here, so your edit was not applied');
		}
	}

	const batch = new MultiBatch(db);
	batch.update(messageRef, {
		message: payload.message,
		deleted: false,
		updated: serverTimestamp()
	});
	await batch.commit();
});

registerAuxWriteExecutor('comment-delete', async (intent, isReplay) => {
	const payload = intent.payload;
	if (!payload || payload.kind !== 'comment-delete') throw new Error('comment-delete intent without its plan');
	if (!selectUser(store.getState() as State)) throw new Error('comment-delete replayed with no signed-in user');
	if (commentAddStillPending(payload.messageID)) throw new Error('the comment this delete targets has not posted yet; retaining until it has');

	const messageRef = doc(db, MESSAGES_COLLECTION, payload.messageID);
	if (isReplay) {
		const current = await serverMessageState(messageRef, 'comment-delete');
		//Absence SATISFIES a delete, unlike an edit — the user asked for it to
		//be gone and it is. Silent success, no alert.
		if (!current || current.deleted) return;
		//A delete blanks `message` and nothing keeps the old text, so replaying
		//over words written after the delete was queued destroys them.
		if (current.message !== payload.baseMessage) {
			throw permanentCommentError('this comment was changed elsewhere after you deleted it here, so it was not deleted — delete it again if you still want it gone');
		}
	}

	const batch = new MultiBatch(db);
	batch.update(messageRef, {
		message: '',
		deleted: true,
		updated: serverTimestamp()
	});
	await batch.commit();
});

export const addMessage = (thread : CommentThread, message : string) : ThunkSomeAction => async (_, getState) => {
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

	//#767: the transitional cutover placeholder's isFallback:false is a
	//guess; wait for the concrete collection instead of acting on it. A
	//rejection (real fallback, or a cutover that never resolves) deliberately
	//propagates: composeCommit restores the typed text and tells the user,
	//where the old guard's silent return dropped the words on the floor.
	await awaitInteractableCollection(() => selectActiveCollection(getState()));

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

//Queuing is the feature, but saying nothing while the comment has not posted is
//not — and a DISCARDED comment must be thrown, not swallowed. composeCommit
//restores the typed text into the compose box on rejection; resolving here meant
//that path never ran and the user's words were gone. A comment on a card another
//device just deleted returns not-found, which the queue treats as permanent, so
//this is a reachable case rather than a theoretical one.
const reportCommentOutcome = (outcome : AuxWriteOutcome, what : 'post' | 'edit' = 'post') : void => {
	if (outcome === 'discarded') throw new Error(what === 'edit' ? 'That edit could not be saved.' : 'That comment could not be posted.');
	if (outcome !== 'queued') return;
	const noun = what === 'edit' ? 'edit' : 'comment';
	console.warn(`Comment ${noun} is queued and will save automatically when the connection recovers.`);
	if (typeof window !== 'undefined') {
		window.setTimeout(() => alert(`Your comment ${noun} could not be saved right now. It has been saved and will apply automatically when the connection recovers.`), 0);
	}
};

export const createThread = (message : string) : ThunkSomeAction => async (_, getState) => {
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
	
	//#767: the transitional cutover placeholder's isFallback:false is a
	//guess; wait for the concrete collection instead of acting on it. A
	//rejection (real fallback, or a cutover that never resolves) deliberately
	//propagates: composeCommit restores the typed text and tells the user,
	//where the old guard's silent return dropped the words on the floor.
	await awaitInteractableCollection(() => selectActiveCollection(getState()));

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

//This apends the threads in the whole local collection for all cards
export const COMMENTS_UPDATE_THREADS = 'COMMENTS_UPDATE_THREADS';
export const COMMENTS_UPDATE_MESSAGES = 'COMMENTS_UPDATE_MESSAGES';
//This is a list of the thread_ids for all top-level threads in this card.
export const COMMENTS_UPDATE_CARD_THREADS = 'COMMENTS_UPDATE_CARD_THREADS';

import {
  db,
  AUTHORS_COLLECTION,
  THREADS_COLLECTION,
  MESSAGES_COLLECTION,
  CARDS_COLLECTION,
} from './database.js';

import {
  cardSelector
} from '../reducers/data.js';

import {
  firebase
} from './database.js';

import {
  userMayComment,
  userMayResolveThread,
  userMayEditMessage,
  firebaseUser
} from '../reducers/user.js';

import {
  randomString
} from './util.js';

export const ensureAuthor = (batch, user) => {
  batch.set(db.collection(AUTHORS_COLLECTION).doc(user.uid), {
    updated: new Date(),
    photoURL: user.photoURL,
    displayName: user.displayName
  })
}

export const resolveThread = (thread) => (dispatch, getState) => {
  const state = getState();

  if (!thread || !thread.id) {
    console.log("No thread provided");
    return;
  }

  if (!userMayResolveThread(state, thread)) {
    console.log("The user isn't allowd to resolve that thread");
    return;
  }

  let cardRef = db.collection(CARDS_COLLECTION).doc(thread.card);
  let threadRef = db.collection(THREADS_COLLECTION).doc(thread.id);

  db.runTransaction(async transaction => {
    let cardDoc = await transaction.get(cardRef);
    if (!cardDoc.exists) {
      throw "Doc doesn't exist!"
    }
    let newThreadCount = (cardDoc.data().thread_count || 0) - 1;
    if (newThreadCount < 0) newThreadCount = 0;
    let newThreadResolvedCount = (cardDoc.data().thread_resolved_count || 0) + 1;
    transaction.update(cardRef, {thread_count: newThreadCount, thread_resolved_count: newThreadResolvedCount});
    transaction.update(threadRef, {
      resolved: true,
      updated: new Date()
    });
  })
}

export const deleteMessage = (message) => (dispatch, getState) => {
  const state = getState();
  if (!userMayEditMessage(state, message)) {
    console.log("User isn't allowed to edit that message!");
    return;
  }

  if (!message || !message.id) {
    console.log("No message provided!");
    return;
  }

  let batch = db.batch();

  batch.update(db.collection(MESSAGES_COLLECTION).doc(message.id), {
    message: "",
    deleted: true,
    updated: new Date()
  })

  batch.commit();
}

export const editMessage = (message, newMessage) => (dispatch, getState) => {
  
  const state = getState();

  if (!userMayEditMessage(state, message)) {
    console.log("User isn't allowed to edit that message!");
    return;
  }

  if (!message || !message.id) {
    console.log("No message provided");
    return;
  }

  let batch = db.batch();

  batch.update(db.collection(MESSAGES_COLLECTION).doc(message.id), {
    message: newMessage,
    deleted: false,
    updated: new Date()
  });

  batch.commit();

}

export const addMessage = (thread, message) => (dispatch, getState) => {
  const state = getState();
  const card = cardSelector(state);
  if (!card || !card.id) {
    console.warn("No active card!");
    return;
  }
  if (!userMayComment(state)) {
    console.warn("You must be signed in to comment!");
    return;
  }

  if (!thread || !thread.id) {
    console.warn("No thread!");
    return;
  }

  if (!message) {
    console.warn("No message provided");
    return;
  }
  
  let user = firebaseUser(state);

  if (!user) {
    console.warn("No uid");
    return;
  }

  let messageId = randomString(16);
  let threadId = thread.id;

  let batch = db.batch();

  ensureAuthor(batch, user);

  batch.update(db.collection(THREADS_COLLECTION).doc(threadId), {
    updated: new Date(),
    messages: firebase.firestore.FieldValue.arrayUnion(messageId)
  })

  batch.set(db.collection(MESSAGES_COLLECTION).doc(messageId), {
    card: card.id,
    message: message,
    thread: threadId,
    author: user.uid,
    created: new Date(),
    updated: new Date(),
    deleted: false
  })

  batch.commit();

}

export const createThread = (message) => (dispatch, getState) => {
  const state = getState();
  const card = cardSelector(state);
  if (!card || !card.id) {
    console.warn("No active card!");
    return;
  }
  if (!userMayComment(state)) {
    console.warn("You must be signed in to comment!");
    return;
  }

  if (!message) {
    console.warn("Empty message");
    return;
  }
  
  let user = firebaseUser(state);

  if (!user) {
    console.warn("No uid");
    return;
  }

  let messageId = randomString(16);
  let threadId = randomString(16);

  let cardRef = db.collection(CARDS_COLLECTION).doc(card.id);
  let threadRef = db.collection(THREADS_COLLECTION).doc(threadId);
  let messageRef = db.collection(MESSAGES_COLLECTION).doc(messageId);

  db.runTransaction(async transaction => {
    let cardDoc = await transaction.get(cardRef);
    if (!cardDoc.exists) {
      throw "Doc doesn't exist!"
    }
    let newThreadCount = (cardDoc.data().thread_count || 0) + 1;
    transaction.update(cardRef, {thread_count: newThreadCount});

    ensureAuthor(transaction, user);

    transaction.set(messageRef, {
      card: card.id,
      message: message,
      thread: threadId,
      author: user.uid,
      created: new Date(),
      updated: new Date(),
      deleted: false
    })

    transaction.set(threadRef, {
      card: card.id,
      parent_message: '',
      messages: [messageId],
      author: user.uid,
      created: new Date(),
      updated: new Date(),
      resolved: false,
      deleted: false
    })

  })

}

export const updateThreads = (threads) => {
  return {
    type: COMMENTS_UPDATE_THREADS,
    threads
  }
}

export const updateMessages = (messages) => {
  return {
    type: COMMENTS_UPDATE_MESSAGES,
    messages
  }
}

export const updateCardThreads = (threadsToAdd, threadsToRemove, firstUpdate) => {
  return {
    type: COMMENTS_UPDATE_CARD_THREADS,
    threadsToAdd,
    threadsToRemove,
    firstUpdate
  }
}
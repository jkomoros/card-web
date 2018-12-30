export const OPEN_COMMENTS_PANEL = 'OPEN_COMMENTS_PANEL';
export const CLOSE_COMMENTS_PANEL = 'CLOSE_COMMENTS_PANEL';
//This apends the threads in the whole local collection for all cards
export const COMMENTS_UPDATE_THREADS = 'COMMENTS_UPDATE_THREADS';
export const COMMENTS_UPDATE_MESSAGES = 'COMMENTS_UPDATE_MESSAGES';
//This is a list of the thread_ids for all top-level threads in this card.
export const COMMENTS_UPDATE_CARD_THREADS = 'COMMENTS_UPDATE_CARD_THREADS';

import {
  db,
  AUTHORS_COLLECTION,
  THREADS_COLLECTION,
  MESSAGES_COLLECTION
} from './database.js';

import {
  cardSelector
} from '../reducers/data.js';

import {
  firebase
} from './database.js';

import {
  userMayComment,
  firebaseUser
} from '../reducers/user.js';

import {
  randomString
} from './util.js';

const ensureAuthor = (batch, user) => {
  batch.set(db.collection(AUTHORS_COLLECTION).doc(user.uid), {
    updated: new Date(),
    photoURL: user.photoURL,
    displayName: user.displayName
  })
}

export const editMessage = (message, newMessage) => (dispatch) => {
  
  if (!message || !message.id);

  let batch = db.batch();

  batch.update(db.collection(MESSAGES_COLLECTION).doc(message.id), {
    message: newMessage,
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
  
  let user = firebaseUser(state);

  if (!user) {
    console.warn("No uid");
    return;
  }

  let messageId = randomString(16);
  let threadId = randomString(16);
  let batch = db.batch();

  //Ensure we have this user's picture
  ensureAuthor(batch, user);

  //Duplicated in addMessage.
  batch.set(db.collection(MESSAGES_COLLECTION).doc(messageId), {
    card: card.id,
    message: message,
    thread: threadId,
    author: user.uid,
    created: new Date(),
    updated: new Date(),
    deleted: false
  })

  batch.set(db.collection(THREADS_COLLECTION).doc(threadId), {
    card: card.id,
    parent_message: '',
    messages: [messageId],
    author: user.uid,
    created: new Date(),
    updated: new Date(),
    resolved: false,
    deleted: false
  })

  //No need to do anything else currently because we don' thave a
  //pendingCreateThread property on state.
  batch.commit().catch(err => console.warn("Couldn't create thread: ", err));

}

export const openCommentsPanel = () => {
  return {
    type: OPEN_COMMENTS_PANEL
  }
}

export const closeCommentsPanel = () => {
  return {
    type: CLOSE_COMMENTS_PANEL
  }
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
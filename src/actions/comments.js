export const OPEN_COMMENTS_PANEL = 'OPEN_COMMENTS_PANEL';
export const CLOSE_COMMENTS_PANEL = 'CLOSE_COMMENTS_PANEL';

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
  userMayComment,
  firebaseUser
} from '../reducers/user.js';

import {
  randomString
} from './maintenance.js';

export const createThread = (message) => (dipstch, getState) => {
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
  batch.set(db.collection(AUTHORS_COLLECTION).doc(user.uid), {
    updated: new Date(),
    photoURL: user.photoURL,
    displayName: user.displayName
  })

  batch.set(db.collection(MESSAGES_COLLECTION).doc(messageId), {
    card: card.id,
    message: message,
    author: user.uid,
    created: new Date(),
    updated: new Date()
  })

  batch.set(db.collection(THREADS_COLLECTION).doc(threadId), {
    card: card.id,
    parent_message: '',
    messages: [messageId]
  })

  //No need to do anything else currently because we don' thave a
  //pendingCreateThread property on state.
  batch.commmit().catch(err => console.warn("Couldn't create thread: ", err));

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
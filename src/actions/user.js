export const SIGNIN_USER = 'SIGNIN_USER';
export const SIGNIN_SUCCESS = 'SIGNIN_SUCCESS';
export const SIGNIN_FAILURE = 'SIGNIN_FAILURE';
export const SIGNOUT_USER = 'SIGNOUT_USER';
export const SIGNOUT_SUCCESS = 'SIGNOUT_SUCCESS';
export const UPDATE_STARS = 'UPDATE_STARS';
export const UPDATE_READS = 'UPDATE_READS';
export const AUTO_MARK_READ_PENDING_CHANGED = 'AUTO_MARK_READ_PENDING_CHANGED';

export const AUTO_MARK_READ_DELAY = 5000;

import {
  firebase,
  connectLiveStars,
  disconnectLiveStars,
  connectLiveReads,
  disconnectLiveReads
} from './database.js';

import {
  userId,
  cardIsRead,
} from '../reducers/user.js';

import {
  db,
  CARDS_COLLECTION,
  STARS_COLLECTION,
  READS_COLLECTION
} from './database.js';

import {
  idForPersonalCardInfo
} from './util.js';

import {
  selectActiveCard
} from '../selectors.js';

export const showNeedSignin = () => (dispatch) => {
  let doSignIn = confirm("Doing that action requires signing in with your Google account. Do you want to sign in?");
  if (!doSignIn) return;
  dispatch(signIn());
}

export const signIn = () => (dispatch) => {
  dispatch({type:SIGNIN_USER});

  let provider = new firebase.auth.GoogleAuthProvider();

  firebase.auth().signInWithRedirect(provider).catch(err => {
    dispatch({type:SIGNIN_FAILURE, error: err})
  });

}

export const signOutSuccess = () => (dispatch) =>  {
  dispatch({type: SIGNOUT_SUCCESS});
  disconnectLiveStars();
  disconnectLiveReads();
}

export const signInSuccess = (firebaseUser, store) => (dispatch) => {
  let info = _userInfo(firebaseUser)
   dispatch({
    type: SIGNIN_SUCCESS,
    user: info,
  });
  connectLiveStars(store,info.uid);
  connectLiveReads(store,info.uid);
}

const _userInfo = (info) => {
  return {
    uid: info.uid,
    photoURL: info.photoURL,
    displayName: info.displayName,
    email: info.email
  }
}

export const signOut = () => (dispatch) => {
  dispatch({type:SIGNOUT_USER})
  firebase.auth().signOut();
}

export const updateStars = (starsToAdd = [], starsToRemove = []) => {
  return {
    type: UPDATE_STARS,
    starsToAdd,
    starsToRemove
  }
}

export const addStar = (cardToStar) => (dispatch, getState) => {

  if (!cardToStar || !cardToStar.id) {
    console.log("Invalid card provided");
    return;
  }

  const state = getState();
  let uid = userId(state);

  if (!uid) {
    console.log("Not logged in");
    return;
  }

  let cardRef = db.collection(CARDS_COLLECTION).doc(cardToStar.id);
  let starRef = db.collection(STARS_COLLECTION).doc(idForPersonalCardInfo(uid, cardToStar.id));

  db.runTransaction(async transaction => {
    let cardDoc = await transaction.get(cardRef);
    if (!cardDoc.exists) {
      throw "Doc doesn't exist!"
    }
    let newStarCount = (cardDoc.data().star_count || 0) + 1;
    transaction.update(cardRef, {star_count: newStarCount});
    transaction.set(starRef, {created: new Date(), owner: uid, card:cardToStar.id});
  })
}

export const removeStar = (cardToStar) => (dispatch, getState) => {
  if (!cardToStar || !cardToStar.id) {
    console.log("Invalid card provided");
    return;
  }

  const state = getState();
  let uid = userId(state);

  if (!uid) {
    console.log("Not logged in");
    return;
  }

  let cardRef = db.collection(CARDS_COLLECTION).doc(cardToStar.id);
  let starRef = db.collection(STARS_COLLECTION).doc(idForPersonalCardInfo(uid, cardToStar.id));

  db.runTransaction(async transaction => {
    let cardDoc = await transaction.get(cardRef);
    if (!cardDoc.exists) {
      throw "Doc doesn't exist!"
    }
    let starDoc = await(transaction.get(starRef));
    if (!starDoc.exists) {
      throw "Star doesn't exist!";
    }
    let newStarCount = (cardDoc.data().star_count || 0) - 1;
    if (newStarCount < 0) newStarCount = 0;
    transaction.update(cardRef, {star_count: newStarCount});
    transaction.delete(starRef);
  })

}

export const updateReads = (readsToAdd = [], readsToRemove = []) => {
  return {
    type: UPDATE_READS,
    readsToAdd,
    readsToRemove
  }
}

let autoMarkReadTimeoutId = null;

export const scheduleAutoMarkRead = () => (dispatch, getState) => {

  cancelPendingAutoMarkRead();

  const state = getState();
  const uid = userId(state);
  if (!uid) return;

  const activeCard = selectActiveCard(state);
  if (!activeCard) return;
  if (cardIsRead(state, activeCard.id)) return;

  autoMarkReadTimeoutId = setTimeout(() => dispatch(markActiveCardReadIfLoggedIn()), AUTO_MARK_READ_DELAY);

  dispatch({type: AUTO_MARK_READ_PENDING_CHANGED, pending: true});
}

export const cancelPendingAutoMarkRead = () => (dispatch) => {
  if (autoMarkReadTimeoutId) {
    dispatch({type: AUTO_MARK_READ_PENDING_CHANGED, pending: false});
    clearTimeout(autoMarkReadTimeoutId);
    autoMarkReadTimeoutId = null;
  }
}

export const markActiveCardReadIfLoggedIn = () => (dispatch, getState) => {
  //It's the responsibility of the thing that scheduled this to ensure that it
  //only fires if the card we wnat to mark read is still active.
  const state = getState();
  const uid = userId(state);
  if (!uid) return;
  const activeCard = selectActiveCard(state);
  if (!activeCard) return;
  dispatch({type: AUTO_MARK_READ_PENDING_CHANGED, pending: false});
  dispatch(markRead(activeCard, true));
}

export const markRead = (cardToMarkRead, existingReadDoesNotError) => (dispatch, getState) => {

  if (!cardToMarkRead || !cardToMarkRead.id) {
    console.log("Invalid card provided");
    return;
  }

  const state = getState();
  let uid = userId(state);

  if (!uid) {
    console.log("Not logged in");
    return;
  }

  if (cardIsRead(state, cardToMarkRead.id)) {
    if (!existingReadDoesNotError) {
      console.log("The card is already read!");
      return;
    }
  }

  let readRef = db.collection(READS_COLLECTION).doc(idForPersonalCardInfo(uid, cardToMarkRead.id));

  let batch = db.batch();
  batch.set(readRef, {created: new Date(), owner: uid, card: cardToMarkRead.id});
  batch.commit();
}

export const markUnread = (cardToMarkUnread) => (dispatch, getState) => {
  if (!cardToMarkUnread || !cardToMarkUnread.id) {
    console.log("Invalid card provided");
    return;
  }

  const state = getState();
  let uid = userId(state);

  if (!uid) {
    console.log("Not logged in");
    return;
  }

  if (!cardIsRead(state, cardToMarkUnread.id)) {
    console.log("Card isn't read!");
    return;
  }

  //Just in case we were planning on setting this card as read.
  cancelPendingAutoMarkRead();

  let readRef = db.collection(READS_COLLECTION).doc(idForPersonalCardInfo(uid, cardToMarkUnread.id));

  let batch = db.batch();
  batch.delete(readRef);
  batch.commit();

}

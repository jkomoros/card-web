export const SIGNIN_USER = 'SIGNIN_USER';
export const SIGNIN_SUCCESS = 'SIGNIN_SUCCESS';
export const SIGNIN_FAILURE = 'SIGNIN_FAILURE';
export const SIGNOUT_USER = 'SIGNOUT_USER';
export const SIGNOUT_SUCCESS = 'SIGNOUT_SUCCESS';
export const UPDATE_STARS = 'UPDATE_STARS';
export const UPDATE_READS = 'UPDATE_READS';

import {
  firebase,
  connectLiveStars,
  disconnectLiveStars,
  connectLiveReads,
  disconnectLiveReads
} from './database.js';

import {
  userId
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

export const signIn = () => (dispatch) => {
  dispatch({type:SIGNIN_USER});

  let provider = new firebase.auth.GoogleAuthProvider();

  firebase.auth().signInWithPopup(provider).catch(err => {
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

export const markRead = (cardToMarkRead) => (dispatch, getState) => {

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

  let readRef = db.collection(READS_COLLECTION).doc(idForPersonalCardInfo(uid, cardToMarkUnread.id));

  let batch = db.batch();
  batch.delete(readRef);
  batch.commit();

}

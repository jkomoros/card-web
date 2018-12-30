export const SIGNIN_USER = 'SIGNIN_USER';
export const SIGNIN_SUCCESS = 'SIGNIN_SUCCESS';
export const SIGNIN_FAILURE = 'SIGNIN_FAILURE';
export const SIGNOUT_USER = 'SIGNOUT_USER';
export const SIGNOUT_SUCCESS = 'SIGNOUT_SUCCESS';

import {
  firebase 
} from './database.js';

export const signIn = () => (dispatch) => {
  dispatch({type:SIGNIN_USER});

  let provider = new firebase.auth.GoogleAuthProvider();

  firebase.auth().signInWithPopup(provider).catch(err => {
    dispatch({type:SIGNIN_FAILURE, error: err})
  });

}

export const signOutSuccess = () => {
  return {type: SIGNOUT_SUCCESS}
}

export const signInSuccess = (firebaseUser) => {
  return {
    type: SIGNIN_SUCCESS,
    user: _userInfo(firebaseUser)
  }
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
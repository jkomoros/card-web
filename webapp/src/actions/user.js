export const SIGNIN_USER = 'SIGNIN_USER';
export const SIGNIN_SUCCESS = 'SIGNIN_SUCCESS';
export const SIGNIN_FAILURE = 'SIGNIN_FAILURE';
export const SIGNOUT_USER = 'SIGNOUT_USER';
export const SIGNOUT_SUCCESS = 'SIGNOUT_SUCCESS';

export const signIn = () => (dispatch) => {
  dispatch({type:SIGNIN_USER});

  let provider = new firebase.auth.GoogleAuthProvider();
  firebase.auth().signInWithPopup(provider).then(result => {
    dispatch({type:SIGNIN_SUCCESS, user: result.user})
  }).catch(err => {
    dispatch({type:SIGNIN_FAILURE, error: err})
  })

}

export const signOut = () => (dispatch) => {
  dispatch({type:SIGNOUT_USER})

  firebase.auth().signOut().then(response => dispatch({type:SIGNOUT_SUCCESS}));
}
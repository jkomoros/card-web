import { SIGNIN_USER, SIGNIN_SUCCESS, SIGNIN_FAILURE, SIGNOUT_USER, SIGNOUT_SUCCESS } from '../actions/user.js';

const INITIAL_STATE = {
  user : null,
  pending: false,
  error: null
}

const app = (state = INITIAL_STATE, action) => {
  switch (action.type) {
    case SIGNIN_USER:
      return {
        ...state,
        pending: true
      }
    case SIGNIN_SUCCESS:
      return {
        ...state,
        pending:false,
        user: action.user
      }
    case SIGNIN_FAILURE:
      return {
        ...state,
        pending:false,
        error: action.error
      }
    case SIGNOUT_USER:
      return {
        ...state,
        pending:true
      }
    case SIGNOUT_SUCCESS:
      return {
        ...state,
        pending:false,
        user: null
      }
    default:
      return state;
  }
}

export const firebaseUser = state => {
  if (!state.user) return null;
  if (!state.user.user) return null;
  return state.user.user;
}

export const userId = state => {
  let user = firebaseUser(state);
  if (!user) return "";
  return user.uid;
}

export const userIsAdmin = state => userMayEdit(state);

export const userMayComment = state => userId(state) != "";

//TODO: more resilient testing
export const userMayEdit = state => {
  //This list is also recreated in firestore.rules
  const allowedIDs = [
    'TPo5MOn6rNX9k8K1bbejuBNk4Dr2', //Production main account
    'KteKDU7UnHfkLcXAyZXbQ6kRAk13' //dev- main account
  ]

  let uid = userId(state);

  if (!uid) {
    return false;
  }

  for (let val of Object.values(allowedIDs)) {
    if (val == uid) return true;
  }

  return false;
};

export default app;
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


export const uidMayResolveThread = (uid, thread) => {
  if (uidIsAdmin(uid)) return true;
  if (!uidMayComment(uid)) return false;
  if (!thread || typeof thread !== 'object') return false;
  return uid == thread.author.id;
}

export const uidIsAdmin = uid => uidMayEdit(uid);

export const uidMayComment = uid => uid != "";

export const uidMayEdit = uid => {
  //This list is also recreated in firestore.rules
  const allowedIDs = [
    'TPo5MOn6rNX9k8K1bbejuBNk4Dr2', //Production main account
    'KteKDU7UnHfkLcXAyZXbQ6kRAk13' //dev- main account
  ]

  if (!uid) {
    return false;
  }

  for (let val of Object.values(allowedIDs)) {
    if (val == uid) return true;
  }

  return false;
}

export const userMayResolveThread = (state, thread) => uidMayResolveThread(userId(state), thread);
export const userMayComment = state => uidMayComment(userId(state));
export const userIsAdmin = state => uidrMayEdit(userId(state));
export const userMayEdit = state => uidMayEdit(userId(state));


export default app;
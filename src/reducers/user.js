import { 
  SIGNIN_USER,
  SIGNIN_SUCCESS,
  SIGNIN_FAILURE,
  SIGNOUT_USER,
  SIGNOUT_SUCCESS,
  UPDATE_STARS,
  UPDATE_READS,
} from '../actions/user.js';

import {
  setRemove,
  setUnion
} from '../actions/util.js';

const INITIAL_STATE = {
  user : null,
  pending: false,
  error: null,
  stars : {},
  reads: {},
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
        user: action.user,
        stars: {},
        reads: {}
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
        user: null,
        stars: {},
        reads: {}
      }
    case UPDATE_STARS:
      return {
        ...state,
        stars: setUnion(setRemove(state.stars, action.starsToRemove), action.starsToAdd)
      }
    case UPDATE_READS:
      return {
        ...state,
        reads: setUnion(setRemove(state.reads, action.readsToRemove), action.readsToAdd)
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

export const cardHasStar = (state, cardId) => {
  return state.user.stars[cardId] || false;
}

export const cardIsRead = (state, cardId) => {
  return state.user.reads[cardId] || false
}

export const uidMayResolveThread = (uid, thread) => {
  if (uidIsAdmin(uid)) return true;
  if (!uidMayComment(uid)) return false;
  if (!thread || typeof thread !== 'object') return false;
  return uid == thread.author.id;
}

export const uidIsAdmin = uid => uidMayEdit(uid);

export const uidMayComment = uid => uid != "";

export const uidMayEditMessage = (uid, message) => {
  if (uidIsAdmin(uid)) return true;
  if (!message || !message.author || !message.author.id) return false;
  return uid == message.author.id;
}

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
export const userMayEditMessage = (state, message) => uidMayEditMessage(userId(state), message);
export const userMayComment = state => uidMayComment(userId(state));
export const userIsAdmin = state => uidMayEdit(userId(state));
export const userMayEdit = state => uidMayEdit(userId(state));
export const userMayStar = state => uidMayComment(userId(state));
export const userMayMarkRead = state => uidMayComment(userId(state));


export default app;
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
        user: userInfo(action.user)
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

const userInfo = (info) => {
  return {
    uid: info.uid,
    photoURL: info.photoURL,
    displayName: info.displayName,
    email: info.email
  }
}

export default app;
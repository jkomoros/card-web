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

export const userIsAdmin = state => userMayEdit(state);

//TODO: more resilient testing
export const userMayEdit = state => {
  if (!state.user) return false;
  if (!state.user.user) return false;

  const allowedIDs = [
    'TPo5MOn6rNX9k8K1bbejuBNk4Dr2', //Production main account
    'KteKDU7UnHfkLcXAyZXbQ6kRAk13' //dev- main account
  ]

  let uid = state.user.user.uid;

  for (let val of Object.values(allowedIDs)) {
    if (val == uid) return true;
  }

  return false;
};

export default app;
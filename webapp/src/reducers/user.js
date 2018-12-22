import { LOGIN_USER, LOGOUT_USER } from '../actions/user.js';

const INITIAL_STATE = {
  id: ''
}

const app = (state = INITIAL_STATE, action) => {
  switch (action.type) {
    default:
      return state;
  }
}

export default app;
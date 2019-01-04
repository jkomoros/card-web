import {
  FIND_DIALOG_OPEN,
  FIND_DIALOG_CLOSE,
  FIND_UPDATE_QUERY
} from '../actions/find.js';

const INITIAL_STATE = {
  open: false,
  query: ""
}

const app = (state = INITIAL_STATE, action) => {
  switch (action.type) {
    case FIND_DIALOG_OPEN:
      return {
        ...state,
        open: true
      }
    case FIND_DIALOG_CLOSE:
      return {
        ...state,
        open: false
      }
    case FIND_UPDATE_QUERY: 
      return {
        ...state,
        query: action.query
      }
    default:
      return state;
  }
}

export default app;
import {
  FIND_DIALOG_OPEN,
  FIND_DIALOG_CLOSE
} from '../actions/find.js';

const INITIAL_STATE = {
  open: false
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
    default:
      return state;
  }
}

export default app;
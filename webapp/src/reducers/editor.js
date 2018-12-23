import { EDITING_START, EDITING_FINISH } from '../actions/editor.js';

const INITIAL_STATE = {
  editing: false
}

const app = (state = INITIAL_STATE, action) => {
  switch (action.type) {
    case EDITING_START:
      return {
        ...state,
        editing: true
      }
    case EDITING_FINISH:
      return {
        ...state,
        editing:false
      }
    default:
      return state;
  }
}

export default app;
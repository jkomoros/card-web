import { EDITING_START, EDITING_FINISH } from '../actions/editor.js';

const INITIAL_STATE = {
  editing: false,
  card: null,
}

const app = (state = INITIAL_STATE, action) => {
  switch (action.type) {
    case EDITING_START:
      return {
        ...state,
        editing: true,
        card: action.card
      }
    case EDITING_FINISH:
      return {
        ...state,
        editing:false,
        card: null
      }
    default:
      return state;
  }
}

export default app;
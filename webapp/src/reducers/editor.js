import { 
  EDITING_START,
  EDITING_FINISH,
  EDITING_TITLE_UPDATED,
  EDITING_BODY_UPDATED,
} from '../actions/editor.js';

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
    case EDITING_TITLE_UPDATED:
      if (!state.card) return state;
      return {
        ...state,
        card: {...state.card, title:action.title},
      }
    case EDITING_BODY_UPDATED:
      if (!state.card) return state;
      return {
        ...state,
        card: {...state.card, body:action.body},
      }
    default:
      return state;
  }
}

export default app;
import {
  PROMPT_COMPOSE_SHOW,
  PROMPT_COMPOSE_CANCEL,
  PROMPT_COMPOSE_COMMIT
} from '../actions/prompt.js';

const INITIAL_STATE = {
  composeOpen: false
}

const app = (state = INITIAL_STATE, action) => {
  switch (action.type) {
    case PROMPT_COMPOSE_SHOW:
      return {
        ...state,
        composeOpen: true
      }
    case PROMPT_COMPOSE_CANCEL:
      return {
        ...state,
        composeOpen: false
      }
    case PROMPT_COMPOSE_COMMIT: 
      return {
        ...state,
        composeOpen: false
      }
    default:
      return state;
  }
}


export default app;
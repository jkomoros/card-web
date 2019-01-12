import {
  PROMPT_COMPOSE_SHOW,
  PROMPT_COMPOSE_CANCEL,
  PROMPT_COMPOSE_COMMIT,
  PROMPT_COMPOSE_UPDATE_CONTENT,
  PROMPT_CONFIGURE_ACTION,
} from '../actions/prompt.js';

const INITIAL_STATE = {
  composeOpen: false,
  content: "",
  message: "",
  action: "",
}

const app = (state = INITIAL_STATE, action) => {
  switch (action.type) {
    case PROMPT_COMPOSE_SHOW:
      return {
        ...state,
        composeOpen: true,
        message: action.message,
        content: action.content,
      }
    case PROMPT_CONFIGURE_ACTION:
      return {
        ...state,
        action: action.action
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
    case PROMPT_COMPOSE_UPDATE_CONTENT: 
      return {
        ...state,
        content: action.content
      }
    default:
      return state;
  }
}


export default app;
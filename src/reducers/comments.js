import { 
  OPEN_COMMENTS_PANEL,
  CLOSE_COMMENTS_PANEL,
  COMMENTS_UPDATE_THREADS,
  COMMENTS_UPDATE_MESSAGES
} from '../actions/comments.js';

const INITIAL_STATE = {
  panelOpen: true,
  messages: {},
  threads: {}
}

const app = (state = INITIAL_STATE, action) => {
  switch (action.type) {
    case OPEN_COMMENTS_PANEL:
      return {
        ...state,
        panelOpen: true
      }
    case CLOSE_COMMENTS_PANEL:
      return {
        ...state,
        panelOpen: false
      }
    case COMMENTS_UPDATE_MESSAGES: 
      return {
        ...state,
        messages: {...action.messages}
      }
    case COMMENTS_UPDATE_THREADS: 
      return {
        ...state,
        threads: {...action.threads}
      }
    default:
      return state;
  }
}

export default app;
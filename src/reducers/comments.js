import { 
  OPEN_COMMENTS_PANEL,
  CLOSE_COMMENTS_PANEL

} from '../actions/comments.js';

const INITIAL_STATE = {
  panelOpen: true
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
    default:
      return state;
  }
}

export default app;
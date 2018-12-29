import { 
  OPEN_COMMENTS_PANEL,
  CLOSE_COMMENTS_PANEL,
  COMMENTS_UPDATE_THREADS,
  COMMENTS_UPDATE_MESSAGES,
  COMMENTS_UPDATE_CARD_THREADS
} from '../actions/comments.js';

import {
  arrayUnion,
  arrayRemove
} from '../actions/util.js';

const INITIAL_STATE = {
  panelOpen: true,
  messages: {},
  threads: {},
  cardThreads: []
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
        messages: {...state.messages, ...action.messages}
      }
    case COMMENTS_UPDATE_THREADS: 
      return {
        ...state,
        threads: {...state.threads, ...action.threads}
      }
    case COMMENTS_UPDATE_CARD_THREADS:
      let newThreads = [];
      if (action.firstUpdate) {
        newThreads = [...action.threadsToAdd];
      } else {
        newThreads = arrayUnion(state.cardThreads, action.threadsToAdd);
        newThreads = arrayRemove(newThreads, action.threadsToRemove);
      }
      return {
        ...state,
        cardThreads: newThreads
      }
    default:
      return state;
  }
}

export default app;
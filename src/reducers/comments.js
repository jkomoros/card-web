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
  card_threads: []
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
        newThreads = arrayUnion(state.card_threads, action.threadsToAdd);
        newThreads = arrayRemove(newThreads, action.threadsToRemove);
      }
      return {
        ...state,
        card_threads: newThreads
      }
    default:
      return state;
  }
}

export const composedThreadsSelector = state => {
  let result = [];
  for (let threadId of Object.values(state.comments.card_threads)) {
    let thread = composedThread(threadId, state.comments.threads, state.comments.messages) 
    //It's possible that the thread has been deleted
    if (thread) result.push(thread);
  }
  return result;

}

const composedThread = (threadId, threads, messages) => {
  let originalThread = threads[threadId];
  if (!originalThread) return null;
  let thread = {...originalThread};
  let expandedMessages = [];
  for (let messageId of Object.values(thread.messages)) {
    let message = composedMessage(messageId, threads, messages);
    if (message) expandedMessages.push(message);
  }
  //TODO: also expand author
  thread.messages = expandedMessages;
  return thread;
}

const composedMessage = (messageId, threads, messages) => {
  //TODO: return composed children for threads if there are parents
  return messages[messageId] || {};
}

export default app;
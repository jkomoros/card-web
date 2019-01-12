export const PROMPT_COMPOSE_SHOW = 'PROMPT_COMPOSE_SHOW';
export const PROMPT_COMPOSE_CANCEL = 'PROMPT_COMPOSE_CANCEL';
export const PROMPT_COMPOSE_COMMIT = 'PROMPT_COMPOSE_COMMIT';
export const PROMPT_COMPOSE_UPDATE_CONTENT = 'PROMPT_COMPOSE_UPDATE_CONTENT';
export const PROMPT_CONFIGURE_ACTION = 'PROMPT_CONFIGURE_ACTION';

import {
  selectPromptAction,
  selectPromptContent,
  selectPromptAssociatedId,
  getMessageById,
  getThreadById,
} from '../selectors.js';

import {
  editMessage,
  addMessage,
  createThread,
} from './comments.js';

export const COMMIT_ACTIONS = {
  CONSOLE_LOG: 'CONSOLE_LOG',
  EDIT_MESSAGE: 'EDIT_MESSAGE',
  ADD_MESSAGE: 'ADD_MESSAGE',
  CREATE_THREAD: 'CREATE_THREAD',
}

export const configureCommitAction = (commitAction, associatedId) => {
  if (!associatedId) associatedId = "";
  return {
    type: PROMPT_CONFIGURE_ACTION,
    action: commitAction,
    associatedId,
  }
}

export const composeShow = (message, starterContent) => {
  if (!starterContent) starterContent = "";
  return {
    type: PROMPT_COMPOSE_SHOW,
    message: message,
    content: starterContent,
  }
}

export const composeCancel = () => {
  return {
    type: PROMPT_COMPOSE_CANCEL
  }
}

export const composeCommit = () => (dispatch, getState) => {

  const state = getState();

  dispatch({
    type: PROMPT_COMPOSE_COMMIT
  })

  doAction(dispatch, state, selectPromptAction(state), selectPromptContent(state), selectPromptAssociatedId(state));

}

export const composeUpdateContent = (content) => {
  return {
    type: PROMPT_COMPOSE_UPDATE_CONTENT,
    content
  }
}


const doAction = (dispatch, state, action, content, associatedId) => {
  if (!action) return;
  switch (action) {
    case COMMIT_ACTIONS.CONSOLE_LOG:
      console.log(content, associatedId);
      return;
    case COMMIT_ACTIONS.EDIT_MESSAGE:
      let message = getMessageById(state, associatedId);
      dispatch(editMessage(message, content));
      return;
    case COMMIT_ACTIONS.ADD_MESSAGE:
      let thread = getThreadById(state, associatedId);
      dispatch(addMessage(thread, content));
      return;
    case COMMIT_ACTIONS.CREATE_THREAD:
      dispatch(createThread(content));
      return;
  }
  console.warn("Unknown action: " + action);
}
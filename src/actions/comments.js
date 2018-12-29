export const OPEN_COMMENTS_PANEL = 'OPEN_COMMENTS_PANEL';
export const CLOSE_COMMENTS_PANEL = 'CLOSE_COMMENTS_PANEL';

import {
  db
} from './database.js';

import {
  cardSelector
} from '../reducers/data.js';

import {
  userMayComment
} from '../reducers/user.js';

export const createThread = (message) => (dipstch, getState) => {
  const state = getState();
  const card = cardSelector(state);
  if (!card || !card.id) {
    console.warn("No active card!");
    return;
  }
  if (!userMayComment(state)) {
    console.warn("You must be signed in to comment!");
    return;
  }
  console.log("TODO: actually create thread with message " + message);
}

export const openCommentsPanel = () => {
  return {
    type: OPEN_COMMENTS_PANEL
  }
}

export const closeCommentsPanel = () => {
  return {
    type: CLOSE_COMMENTS_PANEL
  }
}
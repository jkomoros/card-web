import {
  FIND_DIALOG_OPEN,
  FIND_DIALOG_CLOSE,
  FIND_UPDATE_QUERY
} from '../actions/find.js';

import {
  cardsForCollection
} from './data.js';

const INITIAL_STATE = {
  open: false,
  query: ""
}

const app = (state = INITIAL_STATE, action) => {
  switch (action.type) {
    case FIND_DIALOG_OPEN:
      return {
        ...state,
        open: true
      }
    case FIND_DIALOG_CLOSE:
      return {
        ...state,
        open: false
      }
    case FIND_UPDATE_QUERY: 
      return {
        ...state,
        query: action.query
      }
    default:
      return state;
  }
}

const cardMatchesQuery = (card, query) => {
    if (!card) return false;
    if (card.body && card.body.indexOf(query) >= 0) return true;
    if (card.title && card.title.indexOf(query) >= 0) return true;
    if (card.subtitle && card.subtitle.indexOf(query) >= 0) return true;
    return false;
}

export const collectionForQuery = (state) => {
  let collection = [];
  let query = state.find.query;

  let cards = state.data.cards;

  for (let card of Object.values(cards)) {
    if (cardMatchesQuery(card, query)) collection.push(card);
  }

  return collection;

}

export default app;
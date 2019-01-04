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
        open: false,
        query: ""
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

const cardScoreForQuery = (card, preparedQuery) => {
    if (!card) return 0.0;
    let score = 0.0;
    if (card.body && card.body.toLowerCase().indexOf(preparedQuery) >= 0) score += 0.5;
    if (card.title && card.title.toLowerCase().indexOf(preparedQuery) >= 0) score += 1.0;
    if (card.subtitle && card.subtitle.toLowerCase().indexOf(preparedQuery) >= 0) score += 0.75;
    return score;
}

const prepareQuery = (queryString) => {
  return queryString.toLowerCase();
}

export const collectionForQuery = (state) => {
  let scoredCollection = [];
  let query = state.find.query;

  if (!query) return [];

  let preparedQuery = prepareQuery(query);

  let cards = state.data.cards;

  for (let card of Object.values(cards)) {
    let score = cardScoreForQuery(card, preparedQuery);
    if (score > 0.0) {
      scoredCollection.push({
        score,
        card
      })
    }
  }

  scoredCollection.sort((left, right) => right.score - left.score);

  return scoredCollection.map(item => item.card);

}

export default app;
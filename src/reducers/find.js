import {
  FIND_DIALOG_OPEN,
  FIND_DIALOG_CLOSE,
  FIND_UPDATE_QUERY,
  FIND_CARD_TO_LINK
} from '../actions/find.js';

import {
  cardsForCollection
} from './data.js';

const INITIAL_STATE = {
  open: false,
  query: "",
  linking: false
}

const app = (state = INITIAL_STATE, action) => {
  switch (action.type) {
    case FIND_DIALOG_OPEN:
      return {
        ...state,
        linking: false,
        query: "",
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
    case FIND_CARD_TO_LINK:
      return {
        ...state,
        open: true,
        linking: true
      }
    default:
      return state;
  }
}

const stringPropertyScoreForStringSubQuery = (propertyValue, preparedSubquery) => {
  let value = propertyValue.toLowerCase();
  for (let item of preparedSubquery) {
    if (value.indexOf(item[0]) >= 0) return item[1];
  }
  return 0.0;
}

const cardScoreForQuery = (card, preparedQuery) => {
    if (!card) return 0.0;
    let score = 0.0;

    for (let key of ['title', 'body', 'subtitle']) {
      if(!preparedQuery[key] || !card[key]) continue;
      score += stringPropertyScoreForStringSubQuery(card[key], preparedQuery[key]);
    }

    return score;
}

const prepareQuery = (queryString) => {
  let query = queryString.toLowerCase();
  return {
    title: [[query, 1.0]],
    body: [[query, 0.5]],
    subtitle: [[query, 0.75]],
  }
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
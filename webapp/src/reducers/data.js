import { UPDATE_CARDS, SHOW_CARD } from '../actions/data.js';
import { createSelector } from 'reselect';

const INITIAL_STATE = {
  cards:{},
  slugIndex: {},
  collection: [],
  activeCard: ""
}

const app = (state = INITIAL_STATE, action) => {
  let json, value;
  switch (action.type) {
    case UPDATE_CARDS:
      return {
        ...state,
        cards: {...state.cards, ...action.cards},
        slugIndex: {...state.slugIndex, ...action.slugIndex},
        collection: extendCollection(state.collection, Object.keys(action.cards))
      }
    case SHOW_CARD:
      return {
        ...state,
        activeCard:idForActiveCard(state, action.card)
      }
    default:
      return state;
  }
}

const extendCollection = (collection, newItems) => {
  var result = [];

  var map = new Map();
  for (let key of newItems) {
    map.set(key, true);
  }

  for (let key of collection) {
    if (map.has(key)) map.delete(key);
    result.push(key);
  }

  for (let key of newItems) {
    if (!map.has(key)) continue;
    result.push(key);
  }

  return result;
}

const idForActiveCard = (state, idOrSlug) => state.slugIndex[idOrSlug] || idOrSlug;

const cardsSelector =  state => state.data.cards;
const activeCardSelector =  state => state.data.activeCard;

export const cardSelector = createSelector(
  cardsSelector,
  activeCardSelector,
  (cards, activeCard) => cards[activeCard]
);

const idCollectionSelector = state => state.data.collection;

export const collectionSelector = createSelector(
  cardsSelector,
  idCollectionSelector,
  (cards, collection) => collection.map(id => cards[id]),
)


export default app;
import { UPDATE_CARDS, SHOW_CARD } from '../actions/data.js';
import { createSelector } from 'reselect';

const INITIAL_STATE = {
  cards:{},
  slugIndex: {},
  collection: [],
  activeCardId: "",
  activeCardIndex: -1,
}

const app = (state = INITIAL_STATE, action) => {
  let json, value;
  switch (action.type) {
    case UPDATE_CARDS:
      return {
        ...state,
        cards: {...state.cards, ...action.cards},
        slugIndex: {...state.slugIndex, ...extractSlugIndex(action.cards)},
        collection: extendCollection(state.collection, Object.keys(action.cards))
      }
    case SHOW_CARD:
      let id = idForActiveCard(state, action.card)
      return {
        ...state,
        activeCardId:id,
        activeCardIndex: indexForActiveCard(state.collection, id),
      }
    default:
      return state;
  }
}

const extractSlugIndex = cards => {
  let result = {};

  Object.keys(cards).forEach(key => {
    let card = cards[key];
    let slugs = card.slugs;
    if (typeof slugs !== 'object') slugs = slugs.split(",");
    if (!slugs) return;
    for (let val of slugs) {
      result[val] = key;
    }
  })

  return result;
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
const indexForActiveCard = (collection, id) => {
  for (let i = 0; i < collection.length; i++) {
    if (collection[i] == id) return i;
  }
  return -1;
}

const cardsSelector =  state => state.data.cards;
const activeCardSelector =  state => state.data.activeCardId;

export const cardSelector = createSelector(
  cardsSelector,
  activeCardSelector,
  (cards, activeCard) => cards[activeCard] || {}
);

const idCollectionSelector = state => state.data.collection;

export const collectionSelector = createSelector(
  cardsSelector,
  idCollectionSelector,
  (cards, collection) => collection.map(id => cards[id]),
)


export default app;
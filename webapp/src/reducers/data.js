import { UPDATE_CARDS, SHOW_CARD } from '../actions/data.js';
import { createSelector } from 'reselect';

const INITIAL_STATE = {
  cards:{},
  activeCard: ""
}

const app = (state = INITIAL_STATE, action) => {
  let json, value;
  switch (action.type) {
    case UPDATE_CARDS:
      return {
        ...state,
        cards: {...state.cards, ...action.cards}
      }
    case SHOW_CARD:
      return {
        ...state,
        activeCard:action.card
      }
    default:
      return state;
  }
}

const cardsSelector =  state => state.data.cards;
const activeCardSelector =  state => state.data.activeCard;

export const cardSelector = createSelector(
  cardsSelector,
  activeCardSelector,
  (cards, activeCard) => cards[activeCard]
);

export default app;
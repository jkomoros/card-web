import {
  SHOW_CARD,
} from '../actions/collection.js';

const INITIAL_STATE = {
  requestedCard: "",
  activeSectionId: "",
  activeCardId: "",
  activeCardIndex: -1,
}

const app = (state = INITIAL_STATE, action) => {
  switch (action.type) {
    case SHOW_CARD:
      return {
        ...state,
        requestedCard: action.idOrSlug,
        activeCardId: action.card,
        activeSectionId: action.section,
        activeCardIndex: action.index,
      }
    default:
      return state;
  }
}

export const requestedCard = (state) => state.collection.requestedCard;
export const activeCardId = (state) => state.collection.activeCardId;
export const activeSectionId = (state) => state.collection.activeSectionId;
export const activeCardIndex = (state) => state.collection.activeCardIndex;

export default app;
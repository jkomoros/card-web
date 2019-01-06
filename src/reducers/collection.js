import {
  SHOW_CARD,
} from '../actions/collection.js';

const INITIAL_STATE = {
  activeSectionId: "",
  activeCardId: "",
  activeCardIndex: -1,
}

const app = (state = INITIAL_STATE, action) => {
  switch (action.type) {
    case SHOW_CARD:
      return {
        ...state,
        activeCardId: action.card,
        activeSectionId: action.section,
        activeCardIndex: action.index,
      }
    default:
      return state;
  }
}

export const activeCardId = (state) => state.collection.activeCardId;
export const activeSectionId = (state) => state.collection.activeSectionId;
export const activeCardIndex = (state) => state.collection.activeCardIndex;

export default app;
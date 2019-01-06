import {
  SHOW_CARD,
  UPDATE_COLLECTION
} from '../actions/collection.js';

import {
  UPDATE_SECTIONS
} from '../actions/data.js';

const DEFAULT_SET_NAME = 'default';

export const SET_NAMES = [DEFAULT_SET_NAME];

const INITIAL_STATE = {
  setName: DEFAULT_SET_NAME,
  filters: {},
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
    case UPDATE_COLLECTION:
      return {
        ...state,
        setName: action.setName
      }
    case UPDATE_SECTIONS:
      return {
        ...state,
        filters: {...state.filters, ...makeFilterFromSection(action.sections)}
      }
    default:
      return state;
  }
}

const makeFilterFromSection = (sections) => {
  let result = {};
  for (let key of Object.keys(sections)) {
    let filter = {};
    let section = sections[key];
    section.cards.forEach(card => filter[card] = true)
    result[key] = filter;
  }
  return result;
}

export const getSetName = (state) => state.collection.setName;
export const requestedCard = (state) => state.collection.requestedCard;
export const activeCardId = (state) => state.collection.activeCardId;
export const activeSectionId = (state) => state.collection.activeSectionId;
export const activeCardIndex = (state) => state.collection.activeCardIndex;

export default app;
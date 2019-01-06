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
  activeSetName: DEFAULT_SET_NAME,
  activeFilters: [],
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
        activeSetName: action.setName,
        activeFilters: [...action.filters]
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

export default app;
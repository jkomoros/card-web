import {
  UPDATE_CHANGES_CARDS,
  CHANGES_FETCHING
} from '../actions/changes.js';

const INITIAL_STATE = {
  cardsBySection: {},
  fetching: false
}

const app = (state = INITIAL_STATE, action) => {
  switch (action.type) {
    case UPDATE_CHANGES_CARDS:
      return {
        ...state,
        cardsBySection: action.cardsBySection,
        fetching: false
      }
    case CHANGES_FETCHING:
      return {
        ...state,
        fetching: action.isFetching
      }
    default:
      return state;
  }
}

export default app;
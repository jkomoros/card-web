import {
  UPDATE_CHANGES_CARDS
} from '../actions/changes.js';

const INITIAL_STATE = {
  cardsBySection: {}
}

const app = (state = INITIAL_STATE, action) => {
  switch (action.type) {
    case UPDATE_CHANGES_CARDS:
      return {
        ...state,
        cardsBySection: action.cardsBySection
      }
    default:
      return state;
  }
}

export default app;
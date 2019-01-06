import { 
  UPDATE_CARDS,
  UPDATE_SECTIONS,
  UPDATE_AUTHORS,
  MODIFY_CARD,
  MODIFY_CARD_SUCCESS,
  MODIFY_CARD_FAILURE,
  REORDER_STATUS
} from '../actions/data.js';

import { createSelector } from 'reselect';

import {
  activeCardId,
  activeSectionId,
} from './collection.js';

const INITIAL_STATE = {
  cards:{},
  authors:{},
  sections: {},
  slugIndex: {},
  //The modification that is pending
  cardModificationPending: "",
  cardModificationError: null,
  reorderPending: false
}

const app = (state = INITIAL_STATE, action) => {
  let json, value;
  switch (action.type) {
    case UPDATE_CARDS:
      return {
        ...state,
        cards: {...state.cards, ...action.cards},
        slugIndex: {...state.slugIndex, ...extractSlugIndex(action.cards)},
      }
    case UPDATE_SECTIONS:
      return {
        ...state,
        sections: {...state.sections, ...action.sections}
      }
    case UPDATE_AUTHORS:
      return {
        ...state,
        authors: {...state.authors, ...action.authors},
      }
    case MODIFY_CARD:
      return {
        ...state,
        cardModificationPending: action.cardId,
        cardModificationError: null,
      } 
    case MODIFY_CARD_SUCCESS:
      return {
        ...state,
        cardModificationPending: "",
      }
    case MODIFY_CARD_FAILURE:
      return {
        ...state,
        cardModificationPending: "",
        cardModificationError: action.error
      }
    case REORDER_STATUS:
      return {
        ...state,
        reorderPending: action.pending
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
    if (!slugs) return;
    if (typeof slugs !== 'object') slugs = slugs.split(",");
    for (let val of slugs) {
      result[val] = key;
    }
  })

  return result;
}

export const authorForId = (state, authorId) => {
  let author = state.data.authors[authorId];
  if (!author){
    return {displayName: "Unknown user"}
  }
  return author;
}

const sectionForActiveCard = (state, id) => {
  let card = state.cards[id];
  if (!card) return "";
  return card.section;
}

export const sectionTitle = (state, sectionId) => {
  let section = state.data.sections[sectionId];
  if (!section) return "";
  return section.title;
}

const cardsSelector =  state => state.data.cards;

export const cardById = (state, cardId) => {
  let cards = cardsSelector(state);
  if (!cards) return null;
  return cards[cardId];
}

export const cardSelector = createSelector(
  cardsSelector,
  activeCardId,
  (cards, activeCard) => cards[activeCard] || {}
);

export const collectionFromSection = (section) => {
  if (!section) return [];
  if (section.start_cards) {
    return [...section.start_cards, ...section.cards];
  }
  return section.cards
}

const collectionForSectionDataState = (dataState, sectionId) => {
  let section = dataState.sections[sectionId];
  return collectionFromSection(section);
}

export const collectionForSection = (state, sectionId) => {
  return collectionForSectionDataState(state.data, sectionId);
}

export const collectionForActiveSectionSelector = state => {
  return collectionForSection(state, activeSectionId(state));
};

export const collectionSelector = createSelector(
  cardsSelector,
  collectionForActiveSectionSelector,
  (cards, collection) => collection.map(id => cards[id]),
)

export const cardsForCollection = (state, collection) => {
  let cards = cardsSelector(state);
  return collection.map(id => cards[id]);
}

export const idForCard = (state, idOrSlug) => state.data.slugIndex[idOrSlug] || idOrSlug;

export default app;
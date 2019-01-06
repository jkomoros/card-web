export const SHOW_CARD = 'SHOW_CARD';
export const UPDATE_COLLECTION = 'UPDATE_COLLECTION';
export const RE_SHOW_CARD = 'RE_SHOW_CARD';

import {
  scheduleAutoMarkRead
} from './user.js';

import {
  collectionForSection,
} from '../reducers/data.js';

import {
  SET_NAMES,
} from '../reducers/collection.js';

import {
  getIdForCard,
  getCardById,
  getCard,
  getSetName,
  getActiveCardId,
  getActiveCardIndex,
  getActiveSectionId,
  getRequestedCard,
  getActiveFilters,
} from '../selectors.js';


export const updateCardSelector = (cardSelector) => (dispatch, getState) => {

    let parts = cardSelector.split("/");

    let firstPart = parts[0].toLowerCase();
    
    let setName = SET_NAMES[0];

    for (let name of SET_NAMES) {
      if (name == firstPart) {
        setName = firstPart;
        parts.unshift();
        break;
      }
    }

    let filters = [];

    //Get last part
    let cardIdOrSlug = parts.pop();

    //TODO: detect if it's one of the weird cardIdOrSlugs (e.g. '.', '.default');

    if (parts.length) {
      //If there are still parts, interpret them as filters.

      //TODO: support interpreting them as sorts.
      filters = parts;
    }

    if (filters.length == 0) {
      const state = getState();
      let card = getCard(state, cardIdOrSlug);
      if (card && card.section) {
        filters = [card.section]
      }
    }

    dispatch(updateCollection(setName, filters));
    dispatch(showCard(cardIdOrSlug));
}

export const updateCollection = (setName, filters) => (dispatch, getState) =>{
  const state = getState();
  let sameSetName = false;
  if (setName == getSetName(state)) sameSetName = true;

  let sameActiveFilters = false;
  let activeFilters = getActiveFilters(state);
  if (filters.length == activeFilters.length) {
    sameActiveFilters = true;
    for (let i = 0; i < filters.length; i++) {
      if (filters[i] != activeFilters[i]) {
        sameActiveFilters = false;
        break;
      }
    }
  }

  if (sameSetName && sameActiveFilters) return;
  dispatch({
    type: UPDATE_COLLECTION,
    setName,
    filters,
  })
}

export const reShowCard = () => (dispatch, getState) => {
  //Called when the sections or cards loaded and we should reshow card.
  const state = getState();
  dispatch(showCard(getRequestedCard(state)));
}

export const showCard = (cardIdOrSlug) => (dispatch, getState) => {

  const state = getState();

  let cardId = getIdForCard(state, cardIdOrSlug);

  let card = getCardById(state, cardId);

  let sectionId = "";
  if (card) sectionId = card.section;

  let sectionCollection = collectionForSection(state, sectionId);

  let index = indexForActiveCard(sectionCollection, cardId);

  //If it'll be a no op don't worry about it.
  if (getActiveCardId(state) == cardId && getActiveSectionId(state) == sectionId && getActiveCardIndex(state) == index) return;

  dispatch({
    type: SHOW_CARD,
    idOrSlug: cardIdOrSlug,
    card: cardId,
    section: sectionId,
    index: index,
  })
  dispatch(scheduleAutoMarkRead());
}

const indexForActiveCard = (collection, id) => {
  for (let i = 0; i < collection.length; i++) {
    if (collection[i] == id) return i;
  }
  return -1;
}
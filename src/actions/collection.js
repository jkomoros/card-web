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
} from '../selectors.js';


export const updateCardSelector = (cardSelector) => (dispatch) => {
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

    let cardIdOrSlug = parts[0];

    dispatch(updateCollection(setName));
    dispatch(showCard(cardIdOrSlug));
}

export const updateCollection = (setName) => (dispatch, getState) =>{
  const state = getState();
  if (setName == getSetName(state)) return;
  dispatch({
    type: UPDATE_COLLECTION,
    setName,
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
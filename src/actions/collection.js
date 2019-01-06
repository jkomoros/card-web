export const SHOW_CARD = 'SHOW_CARD';
export const RE_SHOW_CARD = 'RE_SHOW_CARD';

import {
  scheduleAutoMarkRead
} from './user.js';

import {
  idForCard,
  cardById,
  collectionForSection,
} from '../reducers/data.js';

import {
  activeCardId,
  activeCardIndex,
  activeSectionId,
  requestedCard,
} from '../reducers/collection.js';

export const updateCardSelector = (cardSelector) => (dispatch) => {
    let parts = cardSelector.split("/");
    let cardIdOrSlug = parts[0];
    dispatch(showCard(cardIdOrSlug));
}

export const reShowCard = () => (dispatch, getState) => {
  //Called when the sections or cards loaded and we should reshow card.
  const state = getState();
  dispatch(showCard(requestedCard(state)));
}

export const showCard = (cardIdOrSlug) => (dispatch, getState) => {

  const state = getState();

  let cardId = idForCard(state, cardIdOrSlug);

  let card = cardById(state, cardId);

  let sectionId = "";
  if (card) sectionId = card.section;

  let sectionCollection = collectionForSection(state, sectionId);

  let index = indexForActiveCard(sectionCollection, cardId);

  //If it'll be a no op don't worry about it.
  if (activeCardId(state) == cardId && activeSectionId(state) == sectionId && activeCardIndex(state) == index) return;

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
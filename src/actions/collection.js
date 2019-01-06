export const SHOW_CARD = 'SHOW_CARD';
export const UPDATE_COLLECTION = 'UPDATE_COLLECTION';
export const RE_SHOW_CARD = 'RE_SHOW_CARD';

import {
  scheduleAutoMarkRead
} from './user.js';

import {
  navigatePathTo
} from './app.js';

import {
  DEFAULT_SET_NAME,
  SET_NAMES,
} from '../reducers/collection.js';

import {
  getIdForCard,
  getCardById,
  getCard,
  selectActiveCollection,
  selectActiveSetName,
  selectActiveCardId,
  selectActiveSectionId,
  selectRequestedCard,
  selectActiveFilterNames,
  selectActiveCard,
  selectPage,
  selectPageExtra,
  getCardIndexForActiveCollection
} from '../selectors.js';


export const updateCardSelector = (cardSelector) => (dispatch, getState) => {

    let parts = cardSelector.split("/");

    let firstPart = parts[0].toLowerCase();
    
    let setName = DEFAULT_SET_NAME;

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

    let doUpdateCollection = true;

    if (filters.length == 0) {
      const state = getState();
      let card = getCard(state, cardIdOrSlug);
      if (card) {
        //If we had a default filter URL and the card is a member of the set
        //we're already in, leave the collection information the same.
        if (getCardIndexForActiveCollection(state, card.id) >= 0) {
          doUpdateCollection = false;
        } else if (card.section) {
          filters = [card.section]
        }
      }
    }

    if (doUpdateCollection) dispatch(updateCollection(setName, filters));
    dispatch(showCard(cardIdOrSlug));
}

export const updateCollection = (setName, filters) => (dispatch, getState) =>{
  const state = getState();
  let sameSetName = false;
  if (setName == selectActiveSetName(state)) sameSetName = true;

  let sameActiveFilters = false;
  let activeFilters = selectActiveFilterNames(state);
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

export const refreshCardSelector = () => (dispatch, getState) => {
  //Called when cards and sections update, just in case we now have information to do this better.
  const state = getState();

  let page = selectPage(state);
  if (page != 'c') return;
  let pageExtra = selectPageExtra(state);
  dispatch(updateCardSelector(pageExtra));
}

export const canonicalizeURL = () => (dispatch, getState) => {

  //Called to ensure that the URL is canonical given activeSet, activeFilters, etc.

  let state = getState();

  let card = selectActiveCard(state);

  if (!card) return;

  let activeSectionId = selectActiveSectionId(state);
  let activeFilterNames = selectActiveFilterNames(state);
  let activeSetName = selectActiveSetName(state);

  //TODO: this should be a constant somewhere
  let result = ["c"];

  if (activeSetName != DEFAULT_SET_NAME || activeFilterNames.lenght == 0) {
    result.push(activeSetName);
  }

  if (!activeSectionId) {
    //activeSectionId is only there if the only filter is the section name the
    //user is in, which can be omitted for brevity.
    result.push(...activeFilterNames);
  }

  result.push(card.name);

  let path = result.join("/");

  //Ensure that the article name that we're shwoing--no matter how they
  //havigated here--is the preferred slug name.
  dispatch(navigatePathTo(path, true));
}

export const showCard = (cardIdOrSlug) => (dispatch, getState) => {

  const state = getState();

  let cardId = getIdForCard(state, cardIdOrSlug);

  //If it'll be a no op don't worry about it.
  if (selectActiveCardId(state) == cardId) return;

  dispatch({
    type: SHOW_CARD,
    idOrSlug: cardIdOrSlug,
    card: cardId,
  })
  dispatch(canonicalizeURL());
  dispatch(scheduleAutoMarkRead());
}

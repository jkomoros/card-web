import { createSelector } from 'reselect';

/* 
 This is the collection of all getters and selectors for state. 

 Toberesilienttodatamodelstructurechanges,neveraccessstatedirectlyandinsteadus
 eoneofthese.

 functions that start with 'select' take a single argument, state, and are appropriate
 to use in compound selectors. Functions that start with 'get' take state and another argument.

*/

import {
	intersectionSet
} from './actions/util.js';

import {
	DEFAULT_SET_NAME
} from './reducers/collection.js';

export const selectPage = (state) => state.app.page;
export const selectPageExtra = (state) => state.app.pageExtra;

export const selectActiveSetName = (state) => state.collection.activeSetName;
export const selectRequestedCard = (state) => state.collection.requestedCard;
export const selectActiveCardId = (state) => state.collection.activeCardId;
export const selectActiveSectionId = (state) => state.collection.activeSectionId;
export const selectActiveCardIndex = (state) => state.collection.activeCardIndex;
export const selectActiveFilterNames = (state) => state.collection.activeFilterNames;
export const selectFilters = (state) => state.collection.filters;
export const selectSections = (state) => state.data ? statee.data.sections : null;
export const selectCards = (state) => state.data ? state.data.cards : null;

export const getCardById = (state, cardId) => {
  let cards = selectCards(state);
  if (!cards) return null;
  return cards[cardId];
}

export const getIdForCard = (state, idOrSlug) => {
	if (!state.data) return idOrSlug;
	if (!state.data.slugIndex) return idOrSlug;
	return state.data.slugIndex[idOrSlug] || idOrSlug;
}

export const getCard = (state, cardIdOrSlug)  => getCardById(state, getIdForCard(state, cardIdOrSlug));

export const selectActiveCard = createSelector(
  selectCards,
  selectActiveCardId,
  (cards, activeCard) => cards[activeCard] || null
);

export const selectDefaultSet = createSelector(
	selectSections,
	(sections) => {
		let result = [];
		for (let section of Object.values(sections)) {
			result = result.concat(section.cards)
		}
		return result;
	}
)

export const selectActiveFilter = createSelector(
	selectActiveFilterNames,
	selectFilters,
	(activeFilterNames, filters) => {
		let activeFilters = activeFilterNames.map(name => filters[name]);
		return intersectionSet(...activeFilters);
	});

//TODO: supprot other sets 
export const selectActiveSet = createSelector(
	selectActiveSetName,
	selectDefaultSet,
	(setName, defaultSet) => setName == DEFAULT_SET_NAME ? defaultSet : []
)

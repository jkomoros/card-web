import { createSelector } from 'reselect';


export const getSetName = (state) => state.collection.activeSetName;
export const getRequestedCard = (state) => state.collection.requestedCard;
export const getActiveCardId = (state) => state.collection.activeCardId;
export const getActiveSectionId = (state) => state.collection.activeSectionId;
export const getActiveCardIndex = (state) => state.collection.activeCardIndex;
export const getActiveFilters = (state) => state.collection.activeFilters;
export const getSections = (state) => state.data ? statee.data.sections : null;
export const getCards = (state) => state.data ? state.data.cards : null;

export const getCardById = (state, cardId) => {
  let cards = getCards(state);
  if (!cards) return null;
  return cards[cardId];
}

export const getIdForCard = (state, idOrSlug) => {
	if (!state.data) return idOrSlug;
	if (!state.data.slugIndex) return idOrSlug;
	return state.data.slugIndex[idOrSlug] || idOrSlug;
}

export const getCard = (state, cardIdOrSlug)  => getCardById(state, getIdForCard(state, cardIdOrSlug));

export const getActiveCard = createSelector(
  getCards,
  getActiveCardId,
  (cards, activeCard) => cards[activeCard] || null
);

export const getBaseSet = createSelector(
	getSections,
	(sections) => {
		let result = [];
		for (let section of Object.values(sections)) {
			result = result.concat(section.cards)
		}
		return result;
	}
)
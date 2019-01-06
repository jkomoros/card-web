import { createSelector } from 'reselect';


export const getSetName = (state) => state.collection.activeSetName;
export const getRequestedCard = (state) => state.collection.requestedCard;
export const getActiveCardId = (state) => state.collection.activeCardId;
export const getActiveSectionId = (state) => state.collection.activeSectionId;
export const getActiveCardIndex = (state) => state.collection.activeCardIndex;
export const getSections = (state) => state.data.sections;
export const getCards = (state) => state.data.cards;

export const getCardById = (state, cardId) => {
  let cards = getCards(state);
  if (!cards) return null;
  return cards[cardId];
}

export const getIdForCard = (state, idOrSlug) => state.data.slugIndex[idOrSlug] || idOrSlug;

export const getCard = (state, cardIdOrSlug)  => getCardById(state, getIdForCard(cardIdOrSlug));

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
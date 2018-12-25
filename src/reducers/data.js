import { 
  UPDATE_CARDS,
  UPDATE_SECTIONS,
  SHOW_CARD,
  SHOW_SECTION,
  MODIFY_CARD,
  MODIFY_CARD_SUCCESS,
  MODIFY_CARD_FAILURE
} from '../actions/data.js';
import { createSelector } from 'reselect';

const INITIAL_STATE = {
  cards:{},
  sections: {},
  slugIndex: {},
  activeSectionId: "",
  activeCardId: "",
  activeCardIndex: -1,
  //The modification that is pending
  cardModificationPending: "",
  cardModificationError: null
}

const app = (state = INITIAL_STATE, action) => {
  let json, value;
  switch (action.type) {
    case UPDATE_CARDS:
      return ensureActiveCard({
        ...state,
        cards: {...state.cards, ...action.cards},
        slugIndex: {...state.slugIndex, ...extractSlugIndex(action.cards)},
      })
    case UPDATE_SECTIONS:
      return ensureActiveCard({
        ...state,
        sections: {...state.sections, ...action.sections}
      })
    case SHOW_CARD:
      return ensureActiveCard({
        ...state,
        activeCardId:idForActiveCard(state, action.card)
      })
    case SHOW_SECTION:
      //Skip if we're already there
      if (action.section == state.activeSectionId) return state;
      return ensureActiveCard({
        ...state,
        //Clear out the card, ensureActiveCard will select one for us.
        activeCardId: "",
        activeCardIndex: -1,
        activeSectionId: action.section
      })
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
    default:
      return state;
  }
}

//When the show_card is called, the underlying sections/cards data might not
//exist, so every time we update any three of those, we run it through this.
const ensureActiveCard = (dataState) => {

  let id = dataState.activeCardId;

  if (!id && dataState.activeSectionId) {
    //We might have just switched to a different section
    let collection = collectionForSectionDataState(dataState, dataState.activeSectionId);
    if (collection) {
      id = collection[0];
    }
  }

  id = idForActiveCard(dataState, id);
  let sectionId = sectionForActiveCard(dataState, id);
  let collection = collectionForSectionDataState(dataState, sectionId);
  return {
    ...dataState,
    activeCardId:id,
    activeSectionId: sectionId,
    activeCardIndex: indexForActiveCard(collection, id),
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

const idForActiveCard = (state, idOrSlug) => state.slugIndex[idOrSlug] || idOrSlug;

const sectionForActiveCard = (state, id) => {
  let card = state.cards[id];
  if (!card) return "";
  return card.section;
}

const indexForActiveCard = (collection, id) => {
  for (let i = 0; i < collection.length; i++) {
    if (collection[i] == id) return i;
  }
  return -1;
}

const cardsSelector =  state => state.data.cards;
const activeCardSelector =  state => state.data.activeCardId;

export const cardSelector = createSelector(
  cardsSelector,
  activeCardSelector,
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

const collectionForSection = (state, sectionId) => {
  return collectionForSectionDataState(state.data, sectionId);
}

export const collectionForActiveSectionSelector = state => {
  return collectionForSection(state, state.data.activeSectionId);
};

export const collectionSelector = createSelector(
  cardsSelector,
  collectionForActiveSectionSelector,
  (cards, collection) => collection.map(id => cards[id]),
)


export default app;
import { UPDATE_CARDS, UPDATE_SECTIONS, SHOW_CARD, SHOW_SECTION } from '../actions/data.js';
import { createSelector } from 'reselect';

const INITIAL_STATE = {
  cards:{},
  sections: {},
  slugIndex: {},
  activeSectionId: "",
  activeCardId: "",
  activeCardIndex: -1,
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
    default:
      return state;
  }
}

//When the show_card is called, the underlying sections/cards data might not
//exist, so every time we update any three of those, we run it through this.
const ensureActiveCard = (state) => {

  let id = state.activeCardId;

  if (!id && state.activeSectionId) {
    //We might have just switched to a different section
    let section = state.sections[state.activeSectionId];
    if (section && section.cards) {
      id = section.cards[0];
    }
  }

  id = idForActiveCard(state, state.activeCardId);
  let sectionId = sectionForActiveCard(state, id);
  let section = state.sections[sectionId]
  let collection = [];
  if (section) {
    collection = section.cards;
  }
  return {
    ...state,
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

const idCollectionSelector = state => {
  let section = state.data.sections[state.data.activeSectionId];
  if (!section) return [];
  return section.cards;
};

export const collectionSelector = createSelector(
  cardsSelector,
  idCollectionSelector,
  (cards, collection) => collection.map(id => cards[id]),
)


export default app;
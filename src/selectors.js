import { createSelector } from 'reselect';

/* 
 This is the collection of all getters and selectors for state. 

 Toberesilienttodatamodelstructurechanges,neveraccessstatedirectlyandinsteadus
 eoneofthese.

 functions that start with 'select' take a single argument, state, and are appropriate
 to use in compound selectors. Functions that start with 'get' take state and another argument.

*/

import {
	makeCombinedFilter
} from './util.js';

import {
	DEFAULT_SET_NAME,
	INVERSE_FILTER_NAMES
} from './reducers/collection.js';

export const selectPage = (state) => state.app.page;
export const selectPageExtra = (state) => state.app.pageExtra;
export const selectComposeOpen = (state) => state.prompt.composeOpen;
export const selectPromptContent = (state) => state.prompt.content;
export const selectPromptMessage = (state) => state.prompt.message;
export const selectPromptAction = (state) => state.prompt.action;
export const selectActiveSetName = (state) => state.collection.activeSetName;
export const selectRequestedCard = (state) => state.collection.requestedCard;
export const selectActiveCardId = (state) => state.collection.activeCardId;
export const selectActiveFilterNames = (state) => state.collection.activeFilterNames;
export const selectFilters = (state) => state.collection.filters;
export const selectSections = (state) => state.data ? state.data.sections : null;
export const selectCards = (state) => state.data ? state.data.cards : null;


export const selectUser = state => {
  if (!state.user) return null;
  if (!state.user.user) return null;
  return state.user.user;
}

export const userMayResolveThread = (user, thread) => {
  if (userIsAdmin(user)) return true;
  if (!userMayComment(user)) return false;
  if (!thread || typeof thread !== 'object') return false;
  if (!user) return false;
  return user.uid == thread.author.id;
}

const userIsAdmin = user => userMayEdit(user);

//For actions, like starring and marking read, that are OK to do when signed
//in anonymously.
const userObjectExists = user => user && user.uid != "";

const userSignedIn = user => userObjectExists(user) && !user.isAnonymous;

const userMayComment = user => userSignedIn(user);

export const userMayEditMessage = (user, message) => {
  if (userIsAdmin(user)) return true;
  if (!userSignedIn(user)) return false;
  if (!message || !message.author || !message.author.id) return false;
  return user.uid == message.author.id;
}

const userMayEdit = user => {
  //This list is also recreated in firestore.rules
  const allowedIDs = [
    'TPo5MOn6rNX9k8K1bbejuBNk4Dr2', //Production main account
    'KteKDU7UnHfkLcXAyZXbQ6kRAk13' //dev- main account
  ]

  if (!userSignedIn(user)) return false;

  for (let val of Object.values(allowedIDs)) {
    if (val == user.uid) return true;
  }

  return false;
}

export const selectUid = createSelector(
	selectUser,
	(user) => user ? user.uid : ""
)

export const selectUserIsAdmin = createSelector(
	selectUser,
	(user) => userMayEdit(user)
)

export const selectUserMayEdit = createSelector(
	selectUser,
	(user) => userMayEdit(user)
)

export const selectUserMayStar = createSelector(
	selectUser,
	(user) => userObjectExists(user)
)

export const selectUserMayComment = createSelector(
	selectUser,
	(user) => userMayComment(user)
)

export const selectUserMayMarkRead = createSelector(
	selectUser,
	(user) => userObjectExists(user)
)

export const selectUserIsAnonymous = createSelector(
	selectUser,
	(user) => userObjectExists(user) && user.isAnonymous
)

//UserSignedIn means that there is a user object, and that user is not
//anonymous. Note that selectors like selectUserMayMarkRead and
//selectUserMayComment may return true even when this returns false if the
//user is signed in anonymously.
export const selectUserSignedIn = createSelector(
	selectUser, 
	(user) => userSignedIn(user)
)

export const getCardHasStar = (state, cardId) => {
  return state.user.stars[cardId] || false;
}

export const getCardIsRead = (state, cardId) => {
  return state.user.reads[cardId] || false
}

export const getUserMayResolveThread = (state, thread) => userMayResolveThread(selectUser(state), thread);
export const getUserMayEditMessage = (state, message) => userMayEditMessage(selectUser(state), message);

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

export const getSection = (state, sectionId) => {
	if (!state.data) return null;
	return state.data.sections[sectionId] || null;
}

//DataIsFullyLoaded returns true if we've loaded all of the card/section
//information we're going to load.
export const selectDataIsFullyLoaded = createSelector(
	selectCards,
	selectSections,
	(cards, sections) => Object.keys(cards).length > 0 && Object.keys(sections).length > 0
)

export const selectActiveCard = createSelector(
  selectCards,
  selectActiveCardId,
  (cards, activeCard) => cards[activeCard] || null
);

export const selectActiveCardSectionId = createSelector(
	selectActiveCard,
	(card) => card ? card.section : ''
)

//This means htat the active section is the only one showing. See also
//selectActiveCardSelection, which just returns the section name of the
//current collection.
export const selectActiveSectionId = createSelector(
	selectActiveSetName,
	selectActiveFilterNames,
	selectSections,
	(setName, filterNames, sections) => {
		//The activeSectionId is only true if it's the default set and there
		//is precisely one filter who is also a set.
		if( setName != DEFAULT_SET_NAME) return "";
		if (filterNames.length != 1) return "";
		return sections[filterNames[0]] ? filterNames[0] : "";
	}
)

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

//Returns a list of icludeFilters and a list of excludeFilters.
export const selectActiveFilters = createSelector(
	selectActiveFilterNames,
	selectFilters,
	(activeFilterNames, filters) => {
		let includeFilters = [];
		let excludeFilters = [];
		for (let name of activeFilterNames) {
			if (filters[name]) {
				includeFilters.push(filters[name]);
				continue;
			}
			if (INVERSE_FILTER_NAMES[name]) {
				excludeFilters.push(filters[INVERSE_FILTER_NAMES[name]]);
				continue;
			}
		}
		return [includeFilters, excludeFilters];
	}
)

export const selectActiveFilter = createSelector(
	selectActiveFilters,
	(activeFilters) => makeCombinedFilter(...activeFilters)
);

//TODO: supprot other sets 
export const selectActiveSet = createSelector(
	selectActiveSetName,
	selectDefaultSet,
	(setName, defaultSet) => setName == DEFAULT_SET_NAME ? defaultSet : []
)

//BaseCollection means no start_cards
const selectActiveBaseCollection = createSelector(
	selectActiveSet,
	selectActiveFilter,
	(set, filter) => set.filter(item => filter(item))
)

//selectActiveCollection includes start_cards where applicable, but only the cardIds.
export const selectActiveCollection = createSelector(
	selectActiveSetName,
	selectActiveBaseCollection,
	selectCards,
	selectSections,
	(setName, baseCollection, cards, sections) => {
		//We only inject start_card when the set is default
		if (setName != DEFAULT_SET_NAME) return baseCollection;
		let result = [];
		let lastSection = "";
		for (let cardId of baseCollection) {
			let card = cards[cardId];
			if (card) {
				if (card.section != lastSection) {
					//Inject its start_cards 
					let section = sections[card.section];
					if (section) {
						result.push(...section.start_cards);
					}
				}
				lastSection = card.section;
			}
			result.push(cardId);
		}
		return result;
	}
)

//Expanded means it includes the full cards in place.
export const selectExpandedActiveCollection = createSelector(
	selectActiveCollection,
	selectCards,
	(collection, cards) => collection.map(id => cards[id] || null)
)

export const selectActiveCardIndex = createSelector(
	selectActiveCardId,
	selectActiveCollection,
	(cardId, collection) => collection.indexOf(cardId)
)

export const getCardIndexForActiveCollection = (state, cardId) => {
	let collection = selectActiveCollection(state);
	return collection.indexOf(cardId);
}

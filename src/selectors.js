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
export const selectPromptAssociatedId = (state) => state.prompt.associatedId;

export const selectActiveSetName = (state) => state.collection.activeSetName;
export const selectRequestedCard = (state) => state.collection.requestedCard;
export const selectActiveCardId = (state) => state.collection.activeCardId;
export const selectActiveFilterNames = (state) => state.collection.activeFilterNames;
export const selectFilters = (state) => state.collection.filters;
export const selectSections = (state) => state.data ? state.data.sections : null;
export const selectTags = (state) => state.data ? state.data.tags : null;
export const selectCards = (state) => state.data ? state.data.cards : null;
export const selectCardsLoaded = (state) => state.data.cardsLoaded;
export const selectSectionsLoaded = (state) => state.data.sectionsLoaded;
export const selectTagsLoaded = (state) => state.data.tagsLoaded;
export const selectMessages = (state) => state.comments ? state.comments.messages : null;
export const selectThreads = (state) => state.comments ? state.comments.threads : null;

export const selectAuthPending = (state) => state.user.pending;
//Note: this will return false unless stars have been loading, even if there is
//no user to load stars or reads for.
export const selectStarsLoaded = (state) => state.user.starsLoaded;
export const selectReadsLoaded = (state) => state.user.readsLoaded;

export const selectNotificationsEnabled = (state) => state.user.notificationsToken ? true : false;

export const selectUser = state => {
	if (!state.user) return null;
	if (!state.user.user) return null;
	return state.user.user;
};

export const userMayResolveThread = (user, thread) => {
	if (userIsAdmin(user)) return true;
	if (!userMayComment(user)) return false;
	if (!thread || typeof thread !== 'object') return false;
	if (!user) return false;
	return user.uid == thread.author.id;
};

const userIsAdmin = user => userMayEdit(user);

//For actions, like starring and marking read, that are OK to do when signed
//in anonymously.
const userObjectExists = user => user && user.uid != '';

const userSignedIn = user => userObjectExists(user) && !user.isAnonymous;

const userMayComment = user => userSignedIn(user);

export const userMayEditMessage = (user, message) => {
	if (userIsAdmin(user)) return true;
	if (!userSignedIn(user)) return false;
	if (!message || !message.author || !message.author.id) return false;
	return user.uid == message.author.id;
};

const userMayEdit = user => {
	//This list is also recreated in firestore.rules
	const allowedIDs = [
		'TPo5MOn6rNX9k8K1bbejuBNk4Dr2', //Production main account
		'KteKDU7UnHfkLcXAyZXbQ6kRAk13' //dev- main account
	];

	if (!userSignedIn(user)) return false;

	for (let val of Object.values(allowedIDs)) {
		if (val == user.uid) return true;
	}

	return false;
};

export const selectUid = createSelector(
	selectUser,
	(user) => user ? user.uid : ''
);

export const selectUserIsAdmin = createSelector(
	selectUser,
	(user) => userMayEdit(user)
);

export const selectUserMayEdit = createSelector(
	selectUser,
	(user) => userMayEdit(user)
);

export const selectUserMayComment = createSelector(
	selectUser,
	(user) => userMayComment(user)
);

export const selectUserObjectExists = createSelector(
	selectUser,
	(user) => userObjectExists(user)
);

export const selectUserMayStar = selectUserObjectExists;

export const selectUserMayMarkRead = selectUserObjectExists;

export const selectUserIsAnonymous = createSelector(
	selectUser,
	(user) => userObjectExists(user) && user.isAnonymous
);

//UserSignedIn means that there is a user object, and that user is not
//anonymous. Note that selectors like selectUserMayMarkRead and
//selectUserMayComment may return true even when this returns false if the
//user is signed in anonymously.
export const selectUserSignedIn = createSelector(
	selectUser, 
	(user) => userSignedIn(user)
);

export const getCardHasStar = (state, cardId) => {
	return state.user.stars[cardId] || false;
};

export const getCardIsRead = (state, cardId) => {
	return state.user.reads[cardId] || false;
};

export const getUserMayResolveThread = (state, thread) => userMayResolveThread(selectUser(state), thread);
export const getUserMayEditMessage = (state, message) => userMayEditMessage(selectUser(state), message);

export const getMessageById = (state, messageId) => {
	let messages = selectMessages(state);
	if (!messages) return null;
	return messages[messageId];
};

export const getThreadById = (state, threadId) => {
	let threads = selectThreads(state);
	if (!threads) return null;
	return threads[threadId];
};

export const getCardById = (state, cardId) => {
	let cards = selectCards(state);
	if (!cards) return null;
	return cards[cardId];
};

export const getIdForCard = (state, idOrSlug) => {
	if (!state.data) return idOrSlug;
	if (!state.data.slugIndex) return idOrSlug;
	return state.data.slugIndex[idOrSlug] || idOrSlug;
};

export const getCard = (state, cardIdOrSlug)  => getCardById(state, getIdForCard(state, cardIdOrSlug));

export const getSection = (state, sectionId) => {
	if (!state.data) return null;
	return state.data.sections[sectionId] || null;
};

export const selectUserDataIsFullyLoaded = createSelector(
	selectAuthPending,
	selectUserObjectExists,
	selectStarsLoaded,
	selectReadsLoaded,
	(pending, userExists, starsLoaded, readsLoaded) => {
		if (pending) return false;
		if (!userExists) return true;
		return starsLoaded && readsLoaded;
	}
);

//DataIsFullyLoaded returns true if we've loaded all of the card/section
//information we're going to load.
export const selectDataIsFullyLoaded = createSelector(
	selectCardsLoaded,
	selectSectionsLoaded,
	selectTagsLoaded,
	selectUserDataIsFullyLoaded,
	(cardsLoaded, sectionsLoaded, tagsLoaded, userDataLoaded) => cardsLoaded && sectionsLoaded && tagsLoaded && userDataLoaded
);

export const selectActiveCard = createSelector(
	selectCards,
	selectActiveCardId,
	(cards, activeCard) => cards[activeCard] || null
);

export const selectActiveCardSectionId = createSelector(
	selectActiveCard,
	(card) => card ? card.section : ''
);

//This means htat the active section is the only one showing. See also
//selectActiveCardSelection, which just returns the section name of the
//current collection. selectActiveTagId is the analogue for tags.
export const selectActiveSectionId = createSelector(
	selectActiveSetName,
	selectActiveFilterNames,
	selectSections,
	(setName, filterNames, sections) => {
		//The activeSectionId is only true if it's the default set and there
		//is precisely one filter who is also a set.
		if( setName != DEFAULT_SET_NAME) return '';
		if (filterNames.length != 1) return '';
		return sections[filterNames[0]] ? filterNames[0] : '';
	}
);

//selectActiveTagId returns a string IFF precisely one tag is being selected.
//Analogue of selectActiveSectionId.
export const selectActiveTagId = createSelector(
	selectActiveSetName,
	selectActiveFilterNames,
	selectTags,
	(setName, filterNames, tags) => {
		//The activeSectionId is only true if it's the default set and there
		//is precisely one filter who is also a set.
		if( setName != DEFAULT_SET_NAME) return '';
		if (filterNames.length != 1) return '';
		return tags[filterNames[0]] ? filterNames[0] : '';
	}
);

export const selectActiveStartCards = createSelector(
	selectActiveSectionId,
	selectSections,
	selectActiveTagId,
	selectTags,
	(sectionId, sections, tagId, tags) => {
		let obj = sections[sectionId] || tags[tagId];
		return obj && obj.start_cards ? [...obj.start_cards] : [];
	}
);

export const selectDefaultSet = createSelector(
	selectSections,
	(sections) => {
		let result = [];
		for (let section of Object.values(sections)) {
			result = result.concat(section.cards);
		}
		return result;
	}
);

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
);

export const selectActiveFilter = createSelector(
	selectActiveFilters,
	(activeFilters) => makeCombinedFilter(...activeFilters)
);

//TODO: supprot other sets 
export const selectActiveSet = createSelector(
	selectActiveSetName,
	selectDefaultSet,
	(setName, defaultSet) => setName == DEFAULT_SET_NAME ? defaultSet : []
);

//BaseCollection means no start_cards
const selectActiveBaseCollection = createSelector(
	selectActiveSet,
	selectActiveFilter,
	(set, filter) => set.filter(item => filter(item))
);

//selectActiveCollection includes start_cards if applicable, but only the cardIds.
export const selectActiveCollection = createSelector(
	selectActiveStartCards,
	selectActiveBaseCollection,
	(startCards, baseCollection) => [...startCards, ...baseCollection]
);

//Expanded means it includes the full cards in place.
export const selectExpandedActiveCollection = createSelector(
	selectActiveCollection,
	selectCards,
	(collection, cards) => collection.map(id => cards[id] || null)
);

//Removes labels that are the same as the one htat came before them.
const removeUnnecessaryLabels = (arr) => {
	let result = [];
	let lastLabel = '';
	for (let item of arr) {
		if (item == lastLabel) {
			result.push('');
			continue;
		}
		lastLabel = item;
		result.push(item);
	}
	return result;
};

const removeAllLabels = (arr) => arr.map(() => '');

export const selectActiveCollectionLabels = createSelector(
	selectActiveSectionId,
	selectExpandedActiveCollection,
	selectSections,
	(sectionId, expandedCollection, sections) => {
		//If there's a single section ID then there'd be a single label, which
		//is duplicative so just remove all labels.
		if (sectionId) return removeAllLabels(expandedCollection);
		let rawLabels = expandedCollection.map(card => sections[card.section] ? sections[card.section].title : '');
		return removeUnnecessaryLabels(rawLabels);
	}
);

export const selectActiveCardIndex = createSelector(
	selectActiveCardId,
	selectActiveCollection,
	(cardId, collection) => collection.indexOf(cardId)
);

export const getCardIndexForActiveCollection = (state, cardId) => {
	let collection = selectActiveCollection(state);
	return collection.indexOf(cardId);
};

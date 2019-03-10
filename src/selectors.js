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
	INVERSE_FILTER_NAMES,
	DEFAULT_SORT_NAME,
	RECENT_SORT_NAME,
	SORTS
} from './reducers/collection.js';

export const selectPage = (state) => state.app.page;
export const selectPageExtra = (state) => state.app.pageExtra;

export const selectComposeOpen = (state) => state.prompt.composeOpen;
export const selectPromptContent = (state) => state.prompt.content;
export const selectPromptMessage = (state) => state.prompt.message;
export const selectPromptAction = (state) => state.prompt.action;
export const selectPromptAssociatedId = (state) => state.prompt.associatedId;

export const selectActiveSetName = (state) => state.collection.activeSetName;
export const selectActiveSortName = (state) => state.collection.activeSortName;
export const selectActiveSortReversed = (state) => state.collection.activeSortReversed;
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
export const selectMessagesLoaded = (state) => state.comments ? state.comments.messagesLoaded : false;
export const selectThreadsLoaded = (state) => state.comments ? state.comments.threadsLoaded : false;
export const selectMessages = (state) => state.comments ? state.comments.messages : null;
export const selectThreads = (state) => state.comments ? state.comments.threads : null;
export const selectAuthors = (state) => state.data.authors ? state.data.authors : null;

export const selectQuery = (state) => state.find.query;

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

export const getAuthorForId = (state, authorId) => {
	let authors = selectAuthors(state);
	return authorOrDefault(authorId, authors);
};

const authorOrDefault = (authorId, authors) => {
	let author = authors[authorId];
	if (!author){
		return {displayName: 'Unknown user'};
	}
	return author;
};

export const getCard = (state, cardIdOrSlug)  => getCardById(state, getIdForCard(state, cardIdOrSlug));

export const getSection = (state, sectionId) => {
	if (!state.data) return null;
	return state.data.sections[sectionId] || null;
};

//TODO: once factoring the composed threads selctors into this file, refactor
//this to just select the composed threads.
export const selectActiveCardThreadIds = createSelector(
	selectActiveCardId,
	selectThreads,
	(cardId, threads) => Object.keys(threads).filter(threadId => threads[threadId].card == cardId)
);

export const selectActiveCardComposedThreads = createSelector(
	selectActiveCardThreadIds,
	selectThreads,
	selectMessages,
	selectAuthors,
	(threadIds, threads, messages, authors) => threadIds.map(id => composedThread(id, threads, messages, authors)).filter(thread => !!thread)
);

const composedThread = (threadId, threads, messages, authors) => {
	let originalThread = threads[threadId];
	if (!originalThread) return null;
	let thread = {...originalThread};
	let expandedMessages = [];
	for (let messageId of Object.values(thread.messages)) {
		let message = composedMessage(messageId, messages, authors);
		if (message) expandedMessages.push(message);
	}
	thread.messages = expandedMessages;
	thread.author = authorOrDefault(originalThread.author, authors);
	return thread;
};

const composedMessage = (messageId, messages, authors) => {
	//TODO: return composed children for threads if there are parents
	let originalMessage = messages[messageId];
	if (!originalMessage) return null;
	let message = {...originalMessage};
	message.author = authorOrDefault(originalMessage.author, authors);
	return message;
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

export const selectCommentsAreFullyLoaded = createSelector(
	selectThreadsLoaded,
	selectMessagesLoaded,
	(threadsLoaded, messagesLoaded) => threadsLoaded && messagesLoaded
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

//This is used to decide whether the recent tab should show as selected.
export const selectRecentTabSelected = createSelector(
	selectActiveSetName,
	selectActiveSortName,
	selectActiveFilterNames,
	(set, sort, filters) => set == DEFAULT_SET_NAME && sort == RECENT_SORT_NAME && (!filters || filters.length == 0)
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

const combinedFilterForNames = (names, filters) => {
	let includeFilters = [];
	let excludeFilters = [];
	for (let name of names) {
		if (filters[name]) {
			includeFilters.push(filters[name]);
			continue;
		}
		if (INVERSE_FILTER_NAMES[name]) {
			excludeFilters.push(filters[INVERSE_FILTER_NAMES[name]]);
			continue;
		}
	}
	return makeCombinedFilter(includeFilters, excludeFilters);
};

//Returns a list of icludeFilters and a list of excludeFilters.
const selectActiveCombinedFilter = createSelector(
	selectActiveFilterNames,
	selectFilters,
	(activeFilterNames, filters) => combinedFilterForNames(activeFilterNames, filters)
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
	selectActiveCombinedFilter,
	(set, filter) => set.filter(item => filter(item))
);

//Note, this is the sorting info (extractor, description, etc), but reversing is
//applied in selectSortedActiveCollection.
const selectActiveSort = createSelector(
	selectActiveSortName,
	//Technically, this isn't a pure function because it relies on SORTs. But
	//SORTS is a const and never has more items added after being initialized,
	//so it's OK.
	(sortName) =>  SORTS[sortName] || SORTS[DEFAULT_SORT_NAME]
);

export const selectActiveSortLabelName = createSelector(
	selectActiveSort,
	(sortInfo) => sortInfo.labelName || ''
);

const selectExpandedActiveStartCards = createSelector(
	selectActiveStartCards,
	selectCards,
	(startCards, cards) => startCards.map(id => cards[id] || null)
);

//Expanded means it includes the full cards in place, but NOT SORTED
const selectExpandedActiveCollection = createSelector(
	selectActiveBaseCollection,
	selectCards,
	(collection, cards) => collection.map(id => cards[id] || null)
);

//Builds an index of cardId => extracted info for the current filtered
//colletion.
const selectExtractedSortInfoForCollection = createSelector(
	selectExpandedActiveCollection,
	selectActiveSort,
	selectSections,
	(collection, sortInfo, sections) => {
		if (!sortInfo) return new Map();
		let entries = collection.map(card => [card.id, sortInfo.extractor(card, sections)]);
		return new Map(entries);
	}
);

//This is the sorted (but not yet reversed, if it will be), expanded collection,
//but without start cards
const selectPreliminarySortedActiveCollection = createSelector(
	selectExpandedActiveCollection,
	selectExtractedSortInfoForCollection,
	(collection, sortInfo) => {
		let sort = (left, right) => {
			if(!left || !right) return 0;
			//Info is the underlying sort value, then the label value.
			const leftInfo = sortInfo.get(left.id);
			const rightInfo = sortInfo.get(right.id);
			if (!leftInfo || !rightInfo) return 0;
			return rightInfo[0] - leftInfo[0];
		};
		return [...collection].sort(sort);
	}
);

const selectFinalSortedActiveCollection = createSelector(
	selectPreliminarySortedActiveCollection,
	selectActiveSortReversed,
	(sortedCollection, reversed) => reversed ? [...sortedCollection].reverse() : sortedCollection
);

//This is the final expanded, sorted collection, including start cards.
export const selectFinalCollection = createSelector(
	selectExpandedActiveStartCards,
	selectFinalSortedActiveCollection,
	(startCards, otherCards) => [...startCards, ...otherCards]
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
	selectFinalCollection,
	selectExtractedSortInfoForCollection,
	(sectionId, expandedCollection, sortInfo) => {
		//If there's a single section ID then there'd be a single label, which
		//is duplicative so just remove all labels.
		if (sectionId) return removeAllLabels(expandedCollection);
		let rawLabels = expandedCollection.map(card => sortInfo.get(card.id) ? sortInfo.get(card.id)[1] : '');
		return removeUnnecessaryLabels(rawLabels);
	}
);

export const selectActiveCardIndex = createSelector(
	selectActiveCardId,
	selectFinalCollection,
	(cardId, collection) => collection.map(card => card.id).indexOf(cardId)
);

export const getCardIndexForActiveCollection = (state, cardId) => {
	let collection = selectFinalCollection(state);
	return collection.map(card => card.id).indexOf(cardId);
};

const SIMPLE_FILTER_REWRITES = ['is:', 'section:', 'tag:'];
const HAS_FILTER_PREFIX = 'has:';

//rewriteQueryFilters rewrites things like 'has:comments` to `filter:has-comments`
const rewriteQueryFilters = (query) => {
	let result = [];
	for (let word of query.split(' ')) {
		for (let prefix of SIMPLE_FILTER_REWRITES) {
			if (word.toLowerCase().startsWith(prefix)) {
				word = FILTER_PREFIX + word.slice(prefix.length);
			}
		}
		//Replace 'has:'. Things like 'has:comments' expand to
		//'filter:has-comments', whereas things like 'has:no-comments' expand to
		//'filter:no-comments'.
		if (word.toLowerCase().startsWith(HAS_FILTER_PREFIX)) {
			let rest = word.slice(HAS_FILTER_PREFIX.length);
			if (!rest.toLowerCase().startsWith('no-')) {
				rest = 'has-' + rest;
			}
			word = FILTER_PREFIX + rest;
		}
		result.push(word);
	}
	return result.join(' ');
};

const selectPreparedQuery = createSelector(
	selectQuery,
	(query) => {
		if (!query) {
			return {
				text: {},
				filters: [],
			};
		}
		let [words, filters] = queryWordsAndFilters(rewriteQueryFilters(query));
		return {
			text: textSubQueryForWords(words),
			filters,
		};
	}
);

const textSubQueryForWords = (words) => {
	return {
		title: textPropertySubQueryForWords(words, 1.0),
		body: textPropertySubQueryForWords(words, 0.5),
		subtitle: textPropertySubQueryForWords(words, 0.75),
	};
};

const textPropertySubQueryForWords = (words, startValue) => {
	if (words.length == 1) return [[[words], startValue]];
	const joinedWords = words.join(' ');
	//The format of the return value is a list of items that could match. For
	//each item, the first item is an array of strings, all of which have to
	//independently match; if they do, the second item score is added to the
	//running score for the card.

	//Full exact matches are the best, but if you have all of the sub-words,
	//that's good too, just less good.
	return [[[joinedWords], startValue], [words, startValue / 2]];
};

const stringPropertyScoreForStringSubQuery = (propertyValue, preparedSubquery) => {
	const value = propertyValue.toLowerCase();
	let result = 0.0;
	for (let item of preparedSubquery) {
		//strings is a list of strings that all must match independently
		const strings = item[0];
		if (strings.every(str => value.indexOf(str) >= 0)) result += item[1];
	}
	return result;
};

const cardScoreForQuery = (card, preparedQuery) => {
	if (!card) return 0.0;
	let score = 0.0;

	for (let key of ['title', 'body', 'subtitle']) {
		const propertySubQuery = preparedQuery.text[key];
		if(!propertySubQuery || !card[key]) continue;
		score += stringPropertyScoreForStringSubQuery(card[key], propertySubQuery);
	}

	//Give a boost to cards that have more inbound cards, implying they're more
	//important cards.
	if (card.links_inbound && card.links_inbound.length > 0) {
		//Tweak the score, but only by a very tiny amount. Once the 'juice' is
		//not just the count of inbound-links, but the transitive count, then
		//this can be bigger.
		score *= 1.0 + (card.links_inbound.length * 0.02);
	}

	return score;
};

const FILTER_PREFIX = 'filter:';

const filterForWord = (word) => {
	if (word.indexOf(FILTER_PREFIX) < 0) return '';
	return word.split(FILTER_PREFIX).join('');
};

//extracts the raw, non filter words from a query, then also the filters.
const queryWordsAndFilters = (queryString) => {
	queryString = queryString.toLowerCase();
	let words = [];
	let filters = [];
	for (let word of queryString.split(' ')) {
		if (!word) continue;
		let filter = filterForWord(word);
		if (filter) {
			filters.push(filter);
		} else {
			words.push(word);
		}
	}
	return [words, filters];
};

const selectCollectionForQuery = createSelector(
	selectDefaultSet,
	selectPreparedQuery,
	selectFilters,
	(defaultSet, preparedQuery, filters) => {
		let filter = combinedFilterForNames(preparedQuery.filters, filters);
		return defaultSet.filter(id => filter(id));
	}
);

const selectExpandedCollectionForQuery = createSelector(
	selectCollectionForQuery,
	selectCards,
	(collection, cards) => collection.map(id => cards[id] || null)
);

const selectRankedItemsForQuery = createSelector(
	selectExpandedCollectionForQuery,
	selectPreparedQuery,
	(collection, preparedQuery) => collection.map(card => {
		return {
			card: card,
			score: cardScoreForQuery(card, preparedQuery)
		};
	})
);

export const selectExpandedRankedCollectionForQuery = createSelector(
	selectRankedItemsForQuery,
	(rankedItems) => {
		let filteredItems = rankedItems.filter(item => item.score > 0.0);
		filteredItems.sort((left, right) => right.score - left.score);
		return filteredItems.map(item => item.card);
	}
);

import {
	SHOW_CARD,
	UPDATE_COLLECTION
} from '../actions/collection.js';

import {
	UPDATE_SECTIONS,
	UPDATE_CARDS,
} from '../actions/data.js';

import {
	UPDATE_STARS,
	UPDATE_READS,
} from '../actions/user.js';

import {
	setUnion,
	setRemove,
} from '../util.js';

export const DEFAULT_SET_NAME = 'all';

export const SET_NAMES = [DEFAULT_SET_NAME];

//Theser are filters who are the inverse of another, smaller set. Instead of
//creating a whole set of "all cards minus those", we keep track of them as
//exclude sets.
export const INVERSE_FILTER_NAMES = {
	'unstarred': 'starred',
	'unread': 'read',
	'no-slug': 'has-slug',
	'no-comments': 'has-comments',
};

const INITIAL_STATE = {
	activeSetName: DEFAULT_SET_NAME,
	activeFilterNames: [],
	filters: {
		starred: {},
		read: {},
		'has-slug': {},
		'has-comments': {},
		//None will match nothing. We use it for orphans.
		none: {},
	},
	requestedCard: '',
	activeCardId: '',
};

const app = (state = INITIAL_STATE, action) => {
	switch (action.type) {
	case SHOW_CARD:
		return {
			...state,
			requestedCard: action.idOrSlug,
			activeCardId: action.card,
		};
	case UPDATE_COLLECTION:
		return {
			...state,
			activeSetName: action.setName,
			activeFilterNames: [...action.filters]
		};
	case UPDATE_SECTIONS:
		return {
			...state,
			filters: {...state.filters, ...makeFilterFromSection(action.sections)}
		};
	case UPDATE_CARDS:
		return {
			...state,
			filters: {...state.filters, ...makeFilterFromCards(action.cards, state.filters)}
		};
	case UPDATE_STARS:
		return {
			...state,
			filters: {...state.filters, starred: setUnion(setRemove(state.filters.starred, action.starsToRemove), action.starsToAdd)}
		};
	case UPDATE_READS:
		return {
			...state,
			filters: {...state.filters, read: setUnion(setRemove(state.filters.read, action.readsToRemove), action.readsToAdd)}
		};
	default:
		return state;
	}
};

const makeFilterFromSection = (sections) => {
	let result = {};
	for (let key of Object.keys(sections)) {
		let filter = {};
		let section = sections[key];
		section.cards.forEach(card => filter[card] = true);
		result[key] = filter;
	}
	return result;
};

const makeFilterFromCards = (cards, previousFilters) => {
  

	let newCardsWithSlug = [];
	let newCardsWithoutSlug = [];

	let newCardsWithComments = [];
	let newCardsWithoutComments = [];

	for (let card of Object.values(cards)) {
		if (card.slugs && card.slugs.length) {
			newCardsWithSlug.push(card.id);
		} else {
			newCardsWithoutSlug.push(card.id);
		}
		if (card.thread_count) {
			newCardsWithComments.push(card.id);
		} else {
			newCardsWithoutComments.push(card.id);
		}
	}

	return {
		'has-slug': setUnion(setRemove(previousFilters['has-slug'], newCardsWithoutSlug), newCardsWithSlug),
		'has-comments': setUnion(setRemove(previousFilters['has-comments'],  newCardsWithoutComments), newCardsWithComments),
	};


};

export default app;
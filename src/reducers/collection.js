import {
	SHOW_CARD,
	UPDATE_COLLECTION
} from '../actions/collection.js';

import {
	UPDATE_SECTIONS,
	UPDATE_CARDS,
	UPDATE_TAGS,
} from '../actions/data.js';

import {
	UPDATE_STARS,
	UPDATE_READS,
} from '../actions/user.js';

import {
	setUnion,
	setRemove,
	prettyTime,
} from '../util.js';

export const DEFAULT_SET_NAME = 'all';

export const SET_NAMES = [DEFAULT_SET_NAME];

//The word in the URL That means "the part after this is a sort".
export const SORT_URL_KEYWORD = 'sort';
export const SORT_REVERSED_URL_KEYWORD = 'reverse';

export const DEFAULT_SORT_NAME = 'default';
export const RECENT_SORT_NAME = 'recent';

const sectionNameForCard = (card, sections) => {
	let section = sections[card.section];
	return section ? section.title : '';
};

//EAch sort is an extractor, a description (currently just useful for
//documentation; not shown anywhere), and a labelName to show in the drawer next
//to the label that extractor returns. The extractor is given the card object
//and the sections info map, and returns an array, where the 0 index is the raw
//value to compare for sorting, and the 1th value is the label to display. All
//sorts are currently assumed to be DESCENDING; if there's a new one that isn't,
//then add a property to config called ascending and toggle that.
export const SORTS = {
	//Default sort is a no-op.
	[DEFAULT_SORT_NAME]: {
		extractor: (card, sections) => [0, sectionNameForCard(card, sections)],
		description: 'The default order of the cards within each section in order',
		labelName: 'Section',
	},
	'updated': {
		extractor: (card) => {
			const timestamp = card.updated_substantive;
			return [timestamp ? timestamp.seconds : 0, prettyTime(timestamp)];
		},
		description: 'In descending order by when each card was last substantively updated',
		labelName:'Updated',
	},
	'stars': {
		extractor: (card) => [card.star_count || 0, '' + card.star_count],
		description: 'In descending order by number of stars',
		labelName: 'Stars',
	},
	'commented': {
		extractor: (card) => {
			const timestamp = card.updated_message;
			return [timestamp ? timestamp.seconds : 0, prettyTime(timestamp)];
		},
		description: 'In descending order by when each card last had a new message',
		labelName: 'Commented',
	},
	[RECENT_SORT_NAME]: {
		extractor: (card) => {
			const messageValue = card.updated_message ? card.updated_message.seconds : 0;
			const updatedValue = card.updated_substantive ? card.updated_substantive.seconds : 0;
			const usingMessageValue = messageValue > updatedValue;
			const value = usingMessageValue ? messageValue : updatedValue;
			const timestamp = usingMessageValue ? card.updated_message : card.updated_substantive;
			return [value, prettyTime(timestamp)];
		},
		description: 'In descending order by when each card was last updated or had a new message',
		labelName: 'Last Activity',
	},
};

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
	activeSortName: DEFAULT_SORT_NAME,
	activeSortReversed: false,
	filters: {
		starred: {},
		read: {},
		'has-slug': {},
		'has-comments': {},
		//None will match nothing. We use it for orphans.
		none: {},
	},
	//requestCard is the identifier specifically requested in the URL. This
	//could be the card's ID, a slug for that card, or a special placeholder
	//like `_`. The fully resolved activeCard is stored in activeCardId.
	requestedCard: '',
	//the fully resolved literal ID of the active card (not slug, not special
	//placeholder).
	activeCardId: '',
};

const app = (state = INITIAL_STATE, action) => {
	switch (action.type) {
	case SHOW_CARD:
		return {
			...state,
			requestedCard: action.requestedCard,
			activeCardId: action.card,
		};
	case UPDATE_COLLECTION:
		return {
			...state,
			activeSetName: action.setName,
			activeFilterNames: [...action.filters],
			activeSortName: action.sortName,
			activeSortReversed: action.sortReversed,
		};
	case UPDATE_SECTIONS:
		return {
			...state,
			filters: {...state.filters, ...makeFilterFromSection(action.sections)}
		};
	case UPDATE_TAGS:
		return {
			...state,
			filters: {...state.filters, ...makeFilterFromSection(action.tags)}
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
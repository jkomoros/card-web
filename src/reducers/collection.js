import {
	SHOW_CARD,
	UPDATE_COLLECTION,
	COMMIT_PENDING_COLLECTION_MODIFICATIONS
} from '../actions/collection.js';

import {
	UPDATE_SECTIONS,
	UPDATE_CARDS,
	UPDATE_TAGS,
} from '../actions/data.js';

import {
	UPDATE_STARS,
	UPDATE_READS,
	UPDATE_READING_LIST,
} from '../actions/user.js';

import {
	setUnion,
	setRemove,
	prettyTime,
	cardHasContent,
	cardHasNotes,
	cardHasTodo
} from '../util.js';

export const DEFAULT_SET_NAME = 'all';
//reading-list is a set (as well as filters, e.g. `in-reading-list`) since the
//order matters and is customizable by the user. Every other collection starts
//from the `all` set and then filters and then maybe sorts, but reading-list
//lets a custom order.
export const READING_LIST_SET_NAME = 'reading-list';

export const SET_NAMES = [DEFAULT_SET_NAME, READING_LIST_SET_NAME];

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
	'link-count': {
		extractor: (card) => {
			const inbound_links = card.links_inbound || [];
			return [inbound_links.length, '' + inbound_links.length];
		},
		description: 'In descending order by number of inbound links',
		labelName: 'Link Count',
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
	'no-content': 'has-content',
	'no-notes' : 'has-notes',
	'no-todo' : 'has-todo',
	'no-links' : 'has-links',
	'no-inbound-links' : 'has-inbound-links',
	'no-tags' : 'has-tags',
	'published' : 'unpublished',
	'not-in-reading-list' : 'in-reading-list'
};

//We pull this out because it has to be the same in filters and pendingFilters
//and to avoid having to duplicate it.
const INITIAL_STATE_FILTERS = {
	starred: {},
	read: {},
	'has-slug': {},
	'has-comments': {},
	'has-content': {},
	'has-notes': {},
	'has-freeform-todo': {},
	'has-links': {},
	'has-inbound-links': {},
	'has-tags': {},
	'in-reading-list': {},
	unpublished: {},
	//None will match nothing. We use it for orphans.
	none: {},
};

const INITIAL_STATE = {
	activeSetName: DEFAULT_SET_NAME,
	activeFilterNames: [],
	activeSortName: DEFAULT_SORT_NAME,
	activeSortReversed: false,
	//These are the actual values of the filters in current use. We queue up
	//changes in pendingFilters and then synchronize this value to that value
	//when we know it's OK for the collection to change.
	filters: INITIAL_STATE_FILTERS,
	//The things that modify filters actuall modify pendingFilters. Only when we
	//receive a COMMIT_PENDING_COLLECTION_MODIFICATIONS do we copy over the modifications.
	pendingFilters: INITIAL_STATE_FILTERS,
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
	case COMMIT_PENDING_COLLECTION_MODIFICATIONS:
		//TODO: figure out how to fire this every time one of the other ones
		//that updates filters is fired if it's before data fully loaded.
		return {
			...state,
			filters: {...state.pendingFilters},
		};
	case UPDATE_SECTIONS:
		return {
			...state,
			pendingFilters: {...state.pendingFilters, ...makeFilterFromSection(action.sections)}
		};
	case UPDATE_TAGS:
		return {
			...state,
			pendingFilters: {...state.pendingFilters, ...makeFilterFromSection(action.tags)}
		};
	case UPDATE_CARDS:
		return {
			...state,
			pendingFilters: {...state.pendingFilters, ...makeFilterFromCards(action.cards, state.pendingFilters)}
		};
	case UPDATE_STARS:
		return {
			...state,
			pendingFilters: {...state.pendingFilters, starred: setUnion(setRemove(state.pendingFilters.starred, action.starsToRemove), action.starsToAdd)}
		};
	case UPDATE_READS:
		return {
			...state,
			pendingFilters: {...state.pendingFilters, read: setUnion(setRemove(state.pendingFilters.read, action.readsToRemove), action.readsToAdd)}
		};
	case UPDATE_READING_LIST:
		return {
			...state,
			pendingFilters: {...state.pendingFilters, ...makeFilterFromReadingList(action.list)}
		};
	default:
		return state;
	}
};

const makeFilterFromReadingList = (readingList) => {
	return {
		'in-reading-list': Object.fromEntries(readingList.map(id => [id, true]))
	};
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

	let newCardsWithContent = [];
	let newCardsWithoutContent = [];

	let newCardsWithNotes = [];
	let newCardsWithoutNotes = [];

	let newCardsWithTodo = [];
	let newCardsWithoutTodo = [];

	let newCardsWithUnpublished = [];
	let newCardsWithoutUnpublished = [];

	let newCardsWithLinks = [];
	let newCardsWithoutLinks = [];

	let newCardsWithInboundLinks = [];
	let newCardsWithoutInboundLinks = [];

	let newCardsWithTags = [];
	let newCardsWithoutTags = [];

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
		if (card.links.length) {
			newCardsWithLinks.push(card.id);
		} else {
			newCardsWithoutLinks.push(card.id);
		}

		if (card.links_inbound.length) {
			newCardsWithInboundLinks.push(card.id);
		} else {
			newCardsWithoutInboundLinks.push(card.id);
		}

		if (card.tags.length) {
			newCardsWithTags.push(card.id);
		} else {
			newCardsWithoutTags.push(card.id);
		}

		if (cardHasNotes(card)) {
			newCardsWithNotes.push(card.id);
		} else {
			newCardsWithoutNotes.push(card.id);
		}

		if (cardHasTodo(card)) {
			newCardsWithTodo.push(card.id);
		} else {
			newCardsWithoutTodo.push(card.id);
		}

		if (cardHasContent(card)) {
			newCardsWithContent.push(card.id);
		} else {
			newCardsWithoutContent.push(card.id);
		}

		if (!card.published) {
			newCardsWithUnpublished.push(card.id);
		} else {
			newCardsWithoutUnpublished.push(card.id);
		}
		
	}

	return {
		'has-slug': setUnion(setRemove(previousFilters['has-slug'], newCardsWithoutSlug), newCardsWithSlug),
		'has-comments': setUnion(setRemove(previousFilters['has-comments'],  newCardsWithoutComments), newCardsWithComments),
		'has-content': setUnion(setRemove(previousFilters['has-content'], newCardsWithoutContent), newCardsWithContent),
		'has-notes': setUnion(setRemove(previousFilters['has-notes'], newCardsWithoutNotes), newCardsWithNotes),
		'has-freeform-todo': setUnion(setRemove(previousFilters['has-freeform-todo'], newCardsWithoutTodo), newCardsWithTodo),
		'has-links': setUnion(setRemove(previousFilters['has-links'], newCardsWithoutLinks), newCardsWithLinks),
		'has-inbound-links': setUnion(setRemove(previousFilters['has-inbound-links'], newCardsWithoutInboundLinks), newCardsWithInboundLinks),
		'has-tags': setUnion(setRemove(previousFilters['has-tags'], newCardsWithoutTags), newCardsWithTags),
		'unpublished': setUnion(setRemove(previousFilters['unpublished'], newCardsWithoutUnpublished), newCardsWithUnpublished)
	};


};

export default app;
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
	cardHasTodo,
	toTitleCase
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

const defaultCardFilterName = (basename) => {
	return ['has-' + basename, 'no-' + basename];
};

//enum for different values in card_filter_configs
const TODO_NA = 'na';
//Normal todo: the "has" is considered "done", and "no" is considered todo
const TODO_NORMAL = 'normal';
//Flipped TODO: the "has" is considered "todo" and the "no" is considered done
const TODO_FLIPPED = 'flipped';

//Card filters are filters that can tell if a given card is in it given only the
//card object itself. They're so common that in order to reduce extra machinery
//they're factored into a single config here and all of the other machinery uses
//it (and extends with non-card-filter-types as appropriate). The keys of each
//config object are used as the keys in card.auto_todo_overrides map.
const CARD_FILTER_CONFIGS = {
	//tuple of has-/no- filtername (has- is primary), then the card->in-filter test, then TODO_ENUM
	'comments': [defaultCardFilterName('comments'), card => card.thread_count, TODO_NA],
	'notes': [defaultCardFilterName('notes'), card => cardHasNotes(card), TODO_NA],
	'slug': [defaultCardFilterName('slug'), card => card.slugs && card.slugs.length, TODO_NORMAL],
	'content': [defaultCardFilterName('content'), card => cardHasContent(card), TODO_NORMAL],
	'links': [defaultCardFilterName('links'), card => card.links && card.links.length, TODO_NORMAL],
	'inbound-links': [defaultCardFilterName('inbound-links'), card => card.links_inbound && card.links_inbound.length, TODO_NORMAL],
	'tags': [defaultCardFilterName('tags'), card => card.tags && card.tags.length, TODO_NORMAL],
	'freeform-todo': [defaultCardFilterName('freeform-todo'), card => cardHasTodo(card), TODO_FLIPPED],
	'published': [['published', 'unpublished'], card => card.published, TODO_NORMAL],
};

export const TODO_INFOS = Object.entries(CARD_FILTER_CONFIGS).filter(entry => entry[1][2] != TODO_NA).map(entry => entry[0]).map(key => ({id: key, title: toTitleCase(key.split('-').join(' '))}));

//Theser are filters who are the inverse of another, smaller set. Instead of
//creating a whole set of "all cards minus those", we keep track of them as
//exclude sets.
export const INVERSE_FILTER_NAMES = Object.assign(
	{
		'unstarred': 'starred',
		'unread': 'read',
		'not-in-reading-list' : 'in-reading-list',
	},
	//extend with ones for all of the card filters badsed on that config
	Object.fromEntries(Object.entries(CARD_FILTER_CONFIGS).map(entry => [entry[1][0][1], entry[1][0][0]]))
);

//We pull this out because it has to be the same in filters and pendingFilters
//and to avoid having to duplicate it.
const INITIAL_STATE_FILTERS = Object.assign(
	{
		//None will match nothing. We use it for orphans.
		none: {},
		starred: {},
		read: {},
		'in-reading-list': {},
	},
	//extend with ones for all of the card filters based on the config.
	Object.fromEntries(Object.entries(CARD_FILTER_CONFIGS).map(entry => [entry[1][0][0], {}]))
);

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
	let result = {};
	for(let config of Object.values(CARD_FILTER_CONFIGS)) {
		const filterName = config[0][0];
		const filterFunc = config[1];
		let newMatchingCards = [];
		let newNonMatchingCards = [];
		for (let card of Object.values(cards)) {
			if (filterFunc(card)) {
				newMatchingCards.push(card.id);
			} else {
				newNonMatchingCards.push(card.id);
			}
		}
		result[filterName] = setUnion(setRemove(previousFilters[filterName], newNonMatchingCards), newMatchingCards);
	}
	return result;
};

export default app;
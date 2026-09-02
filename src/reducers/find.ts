import {
	FIND_DIALOG_OPEN,
	FIND_DIALOG_CLOSE,
	FIND_UPDATE_QUERY,
	FIND_UPDATE_RENDER_OFFSET,
	FIND_CARD_TO_LINK,
	FIND_UPDATE_ACTIVE_QUERY,
	FIND_UPDATE_SEARCH_RECALL,
	FIND_CARD_TO_PERMISSION,
	FIND_CARD_TO_REFERENCE,
	FIND_CARD_TO_CONFIGURE,
	FIND_CARD_CONFIGURED,
	FIND_UPDATE_CARD_TYPE_FILTER,
	FIND_UPDATE_SORT_BY_RECENT,
	FIND_UPDATE_STICKY_FILTERS,
	SomeAction
} from '../actions.js';

import {
	readStickySearchEnabled,
	readStickySearchExpression
} from '../sticky-search-filters.js';

import {
	FindState
} from '../types.js';

const INITIAL_STATE : FindState = {
	open: false,
	searchRecall: null,
	query: '',
	activeQuery: '',
	queryIsLiteral: false,
	renderOffset: 0,
	linking: false,
	permissions: false,
	referencing: false,
	sortByRecent: false,
	cardTypeFilter: '',
	cardTypeFilterLocked: false,
	configuring: false,
	configureRequestID: '',
	configuredCardID: '',
	//Initialized from localStorage so the preference applies from the first
	//search of the session (#745). NOT reset by dialog open/close.
	stickyFiltersEnabled: readStickySearchEnabled(),
	stickyFiltersExpression: readStickySearchExpression(),
};

const app = (state : FindState = INITIAL_STATE, action : SomeAction) : FindState => {
	switch (action.type) {
	case FIND_UPDATE_STICKY_FILTERS:
		return {
			...state,
			stickyFiltersEnabled: action.enabled,
			stickyFiltersExpression: action.expression,
		};
	case FIND_UPDATE_SEARCH_RECALL:
		return {
			...state,
			searchRecall: {built: action.built, total: action.total, ready: action.ready},
		};
	case FIND_DIALOG_OPEN:
		return {
			...state,
			linking: false,
			permissions: false,
			referencing: false,
			configuring: false,
			query: action.query || '',
			activeQuery: action.query || '',
			//The generic Search dialog is never seeded from card text: its
			//starter query is the active collection's own query text, which is
			//a query and is read as one.
			queryIsLiteral: false,
			renderOffset: 0,
			sortByRecent: false,
			cardTypeFilter: '',
			cardTypeFilterLocked: false,
			open: true
		};
	case FIND_DIALOG_CLOSE:
		return {
			...state,
			open: false,
			query: '',
			activeQuery: '',
			queryIsLiteral: false,
			sortByRecent: false,
			cardTypeFilter: '',
			cardTypeFilterLocked: false,
		};
	case FIND_UPDATE_QUERY: 
		return {
			...state,
			query: action.query
		};
	case FIND_UPDATE_ACTIVE_QUERY:
		return {
			...state,
			activeQuery: state.query,
			//THE FLAG DESCRIBES activeQuery, so it is cleared HERE and not in
			//FIND_UPDATE_QUERY. The moment a user edits a seeded query they are
			//typing one, and typed operators come back — but activeQuery is
			//still the seeded text until this action promotes the edit, and
			//clearing the flag any earlier would spend a debounce interval
			//reading the seeded prose as grammar.
			queryIsLiteral: false,
			renderOffset: 0,
		};
	case FIND_CARD_TO_LINK:
		return {
			...state,
			open: true,
			linking: true,
			permissions: false,
			referencing: false,
			configuring: false,
			sortByRecent: false,
			cardTypeFilter: '',
			renderOffset: 0,
			cardTypeFilterLocked: false,
			query: action.query,
			activeQuery: action.query,
			//Set by launchFind when the caller supplied the text — today, the
			//editor's selection under Ctrl-L. A link search that fell back to
			//the active collection's query text is not seeded and reads
			//operators normally.
			queryIsLiteral: Boolean(action.literal),
		};
	case FIND_CARD_TO_PERMISSION:
		return {
			...state,
			open: true,
			linking: false,
			permissions: true,
			referencing: false,
			configuring: false,
			query: action.query || '',
			activeQuery: action.query || '',
			//Seeded from the active collection's query text, which is a query.
			queryIsLiteral: false,
			renderOffset: 0,
			sortByRecent: false,
			cardTypeFilter: '',
			cardTypeFilterLocked: false,
		};
	case FIND_CARD_TO_REFERENCE:
		return {
			...state,
			open: true,
			linking: false,
			permissions: false,
			referencing: true,
			configuring: false,
			query: action.query || '',
			activeQuery: action.query || '',
			//Seeded from the active collection's query text, which is a query.
			queryIsLiteral: false,
			renderOffset: 0,
			sortByRecent: true,
			cardTypeFilter: action.cardTypeFilter || '',
			cardTypeFilterLocked: !!action.cardTypeFilter,
		};
	case FIND_CARD_TO_CONFIGURE:
		return {
			...state,
			open: true,
			linking: false,
			permissions: false,
			referencing: false,
			configuring: true,
			//A fresh request ALWAYS clears the previous answer: without this a
			//control whose id happened to be reused would read a stale pick the
			//moment the picker opened, before the user chose anything.
			configureRequestID: action.requestID,
			configuredCardID: '',
			query: action.query || '',
			activeQuery: action.query || '',
			//Seeded from the active collection's query text, which is a query.
			queryIsLiteral: false,
			renderOffset: 0,
			sortByRecent: false,
			cardTypeFilter: '',
			cardTypeFilterLocked: false,
		};
	case FIND_CARD_CONFIGURED:
		return {
			...state,
			configuredCardID: action.cardID,
		};
	case FIND_UPDATE_RENDER_OFFSET:
		return {
			...state,
			renderOffset: action.renderOffset,
		};
	case FIND_UPDATE_CARD_TYPE_FILTER:
		return {
			...state,
			cardTypeFilter: action.filter,
		};
	case FIND_UPDATE_SORT_BY_RECENT:
		return {
			...state,
			sortByRecent: action.sortByRecent,
		};
	default:
		return state;
	}
};

export default app;
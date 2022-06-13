import {
	AnyAction
} from 'redux';

import {
	FIND_DIALOG_OPEN,
	FIND_DIALOG_CLOSE,
	FIND_UPDATE_QUERY,
	FIND_UPDATE_RENDER_OFFSET,
	FIND_CARD_TO_LINK,
	FIND_UPDATE_ACTIVE_QUERY,
	FIND_CARD_TO_PERMISSION,
	FIND_CARD_TO_REFERENCE,
	FIND_UPDATE_CARD_TYPE_FILTER,
	FIND_UPDATE_SORT_BY_RECENT
} from '../actions/find.js';

import {
	FindState
} from '../types.js';

const INITIAL_STATE : FindState = {
	open: false,
	query: '',
	activeQuery: '',
	renderOffset: 0,
	linking: false,
	permissions: false,
	referencing: false,
	sortByRecent: false,
	cardTypeFilter: '',
	cardTypeFilterLocked: false,
};

const app = (state : FindState = INITIAL_STATE, action : AnyAction) : FindState => {
	switch (action.type) {
	case FIND_DIALOG_OPEN:
		return {
			...state,
			linking: false,
			permissions: false,
			referencing: false,
			query: action.query || '',
			activeQuery: action.query || '',
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
			renderOffset: 0,
		};
	case FIND_CARD_TO_LINK:
		return {
			...state,
			open: true,
			linking: true,
			permissions: false,
			referencing: false,
			sortByRecent: false,
			cardTypeFilter: '',
			renderOffset: 0,
			cardTypeFilterLocked: false,
			query: action.query,
			activeQuery: action.query
		};
	case FIND_CARD_TO_PERMISSION:
		return {
			...state,
			open: true,
			linking: false,
			permissions: true,
			referencing: false,
			query: action.query || '',
			activeQuery: action.query || '',
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
			query: action.query || '',
			activeQuery: action.query || '',
			renderOffset: 0,
			sortByRecent: false,
			cardTypeFilter: action.cardTypeFilter || '',
			cardTypeFilterLocked: !!action.cardTypeFilter,
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
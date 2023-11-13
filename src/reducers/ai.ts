import {
	AI_REQUEST_STARTED,
	AI_RESULT,
	AI_DIALOG_CLOSE,
	AI_SET_ACTIVE_CARDS,
	AI_SHOW_ERROR,
	AI_SELECT_RESULT_INDEX,
	SomeAction
} from '../actions.js';

import {
	AIState
} from '../types.js';

import {
	DEFAULT_MODEL
} from '../actions/ai.js';

const INITIAL_STATE : AIState = {
	open: false,
	active: false,
	kind: 'summary',
	selectedIndex: -1,
	model: DEFAULT_MODEL,
	result: [],
	error: '',
	allCards: [],
	filteredCards: []
};

const app = (state : AIState = INITIAL_STATE, action : SomeAction) : AIState => {
	switch (action.type) {
	case AI_REQUEST_STARTED:
		return {
			...state,
			active: true,
			open: true,
			kind: action.kind,
			model: action.model,
			selectedIndex: -1,
			allCards: [],
			filteredCards: []
		};
	case AI_RESULT:
		return {
			...state,
			active: false,
			result: [...action.result]
		};
	case AI_SELECT_RESULT_INDEX:
		return {
			...state,
			selectedIndex: action.index
		};
	case AI_SHOW_ERROR:
		return {
			...state,
			active: false,
			error: action.error
		};
	case AI_DIALOG_CLOSE:
		return {
			...state,
			open: false
		};
	case AI_SET_ACTIVE_CARDS:
		return {
			...state,
			allCards: action.allCards,
			filteredCards: action.filteredCards
		};
	default:
		return state;
	}
};

export default app;
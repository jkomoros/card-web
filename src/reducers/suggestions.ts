import {
	SUGGESTIONS_SHOW_PANEL,
	SUGGESTIONS_HIDE_PANEL,
	SomeAction
} from '../actions.js';

import {
	SuggestionsState
} from '../types.js';

const INITIAL_STATE : SuggestionsState = {
	open: false
};

const app = (state : SuggestionsState = INITIAL_STATE, action : SomeAction) : SuggestionsState => {
	switch (action.type) {
	case SUGGESTIONS_SHOW_PANEL: 
		return {
			...state,
			open: true
		};
	case SUGGESTIONS_HIDE_PANEL: 
		return {
			...state,
			open: false
		};
	default:
		return state;
	}
};


export default app;
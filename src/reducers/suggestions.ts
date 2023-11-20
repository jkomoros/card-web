import {
	SUGGESTIONS_SHOW_PANEL,
	SUGGESTIONS_HIDE_PANEL,
	SomeAction,
	SUGGESTIONS_ADD_SUGGESTIONS_FOR_CARD,
	SUGGESTIONS_CHANGE_SELECTED
} from '../actions.js';

import {
	SuggestionsState
} from '../types.js';

const INITIAL_STATE : SuggestionsState = {
	open: false,
	selectedIndex: 0,
	suggestionsForCard: {}
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
	case SUGGESTIONS_ADD_SUGGESTIONS_FOR_CARD:
		const previousSuggestions = state.suggestionsForCard[action.card] || [];
		const suggestions = [...previousSuggestions, ...action.suggestions];
		return {
			...state,
			suggestionsForCard: {
				...state.suggestionsForCard,
				[action.card]: suggestions
			}
		};
	case SUGGESTIONS_CHANGE_SELECTED:
		return {
			...state,
			selectedIndex: action.index
		};
	default:
		return state;
	}
};


export default app;
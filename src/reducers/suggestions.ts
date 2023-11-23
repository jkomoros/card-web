import {
	SUGGESTIONS_SHOW_PANEL,
	SUGGESTIONS_HIDE_PANEL,
	SomeAction,
	SUGGESTIONS_REPLACE_SUGGESTIONS_FOR_CARD,
	SUGGESTIONS_CHANGE_SELECTED,
	SUGGESTIONS_REMOVE_SUGGESTION_FOR_CARD,
	SUGGESTIONS_SET_USE_LLMS,
	SUGGESTIONS_LOADING_FOR_CARD
} from '../actions.js';

import {
	SuggestionsState
} from '../types.js';

const INITIAL_STATE : SuggestionsState = {
	open: false,
	useLLMs: true,
	selectedIndex: 0,
	loadingForCard: {},
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
	case SUGGESTIONS_LOADING_FOR_CARD:
		return {
			...state,
			loadingForCard: {
				...state.loadingForCard,
				[action.card]: true
			}
		};
	case SUGGESTIONS_REPLACE_SUGGESTIONS_FOR_CARD:
		const loadingForCard = {...state.loadingForCard};
		delete loadingForCard[action.card];
		return {
			...state,
			suggestionsForCard: {
				...state.suggestionsForCard,
				[action.card]: [...action.suggestions]
			},
			loadingForCard
		};
	case SUGGESTIONS_REMOVE_SUGGESTION_FOR_CARD:
		const updatedSuggestions = [...(state.suggestionsForCard[action.card] || [])];
		updatedSuggestions.splice(action.index);
		//If that was the last suggestion, and we were open, close. Note: this
		//assumes that we are currently viewing the card that just had its
		//suggestion removed, which is currently true but might not be true in
		//the future.
		const remainOpen = state.open && updatedSuggestions.length > 0;
		return {
			...state,
			open: remainOpen,
			suggestionsForCard: {
				...state.suggestionsForCard,
				[action.card]: updatedSuggestions
			}
		};
	case SUGGESTIONS_CHANGE_SELECTED:
		return {
			...state,
			selectedIndex: action.index
		};
	case SUGGESTIONS_SET_USE_LLMS:
		return {
			...state,
			useLLMs: action.useLLMs
		};
	default:
		return state;
	}
};


export default app;
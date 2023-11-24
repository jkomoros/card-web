import {
	SUGGESTIONS_SHOW_PANEL,
	SUGGESTIONS_HIDE_PANEL,
	SomeAction,
	SUGGESTIONS_REPLACE_SUGGESTIONS_FOR_CARD,
	SUGGESTIONS_CHANGE_SELECTED,
	SUGGESTIONS_REMOVE_SUGGESTION_FOR_CARD,
	SUGGESTIONS_SET_USE_LLMS,
	SUGGESTIONS_LOADING_FOR_CARD,
	SUGGESTIONS_SET_PENDING,
	SHOW_CARD
} from '../actions.js';

import {
	SuggestionsState
} from '../types.js';

const INITIAL_STATE : SuggestionsState = {
	open: false,
	useLLMs: true,
	pending: false,
	selectedIndex: 0,
	loadingForCard: {},
	suggestionsForCard: {}
};

const app = (state : SuggestionsState = INITIAL_STATE, action : SomeAction) : SuggestionsState => {
	switch (action.type) {
	case SHOW_CARD:
		return {
			...state,
			selectedIndex: 0
		};
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
	case SUGGESTIONS_SET_PENDING:
		return {
			...state,
			pending: action.pending
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
		let loadingForCard = state.loadingForCard;
		if (action.final) {
			//Only change the object if we'll be changing part o fit.
			loadingForCard = {...state.loadingForCard};
			delete loadingForCard[action.card];
		}
		const existing = action.extend ? state.suggestionsForCard[action.card] || [] : [];
		return {
			...state,
			suggestionsForCard: {
				...state.suggestionsForCard,
				[action.card]: [...existing, ...action.suggestions]
			},
			loadingForCard
		};
	case SUGGESTIONS_REMOVE_SUGGESTION_FOR_CARD:
		const updatedSuggestions = [...(state.suggestionsForCard[action.card] || [])];
		updatedSuggestions.splice(action.index, 1);
		return {
			...state,
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
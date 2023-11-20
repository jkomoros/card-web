import {
	SUGGESTIONS_HIDE_PANEL,
	SUGGESTIONS_SHOW_PANEL,
	SUGGESTIONS_ADD_SUGGESTIONS_FOR_CARD,
	SomeAction,
	SUGGESTIONS_CHANGE_SELECTED
} from '../actions.js';

import {
	selectSuggestionsForCards
} from '../selectors.js';

import {
	ThunkSomeAction
} from '../store.js';

import {
	suggestionsForCard
} from '../suggestions.js';

import {
	ProcessedCard,
	Suggestion
} from '../types.js';

import {
	CardID
} from '../types_simple.js';

export const suggestionsShowPanel = () : SomeAction => {
	return {
		type: SUGGESTIONS_SHOW_PANEL,
	};
};

export const suggestionsHidePanel = () : SomeAction => {
	return {
		type: SUGGESTIONS_HIDE_PANEL,
	};
};

export const suggestionsChangeSelected = (index : number) : SomeAction => {
	if (index < 0) throw new Error('Index must be at least 0');
	return {
		type: SUGGESTIONS_CHANGE_SELECTED,
		index
	};
};

const suggestionsAddSuggestionsForCard = (card : CardID, suggestions: Suggestion[]) : SomeAction => {
	return {
		type: SUGGESTIONS_ADD_SUGGESTIONS_FOR_CARD,
		card,
		suggestions
	};
};

//This is called when card-view has noticed the active card has changed, and is time to add suggestions.
export const suggestionsActiveCardChanged = (card : ProcessedCard) : ThunkSomeAction => async (dispatch, getState) => {
	const state = getState();
	const suggestionsForCards = selectSuggestionsForCards(state);
	const suggestions = suggestionsForCards[card.id];
	if (suggestions) {
		//TODO: clean out any old suggestions
		return;
	}
	suggestionsForCard(card, state).then((newSuggestions) => dispatch(suggestionsAddSuggestionsForCard(card.id,newSuggestions)));
};

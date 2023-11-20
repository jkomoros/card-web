import {
	SUGGESTIONS_HIDE_PANEL,
	SUGGESTIONS_SHOW_PANEL,
	SUGGESTIONS_ADD_SUGGESTIONS_FOR_CARD,
	SomeAction
} from '../actions.js';

import {
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

export const suggestionsAddSuggestionsForCard = (card : CardID, suggestions: Suggestion[]) : SomeAction => {
	return {
		type: SUGGESTIONS_ADD_SUGGESTIONS_FOR_CARD,
		card,
		suggestions
	};
};

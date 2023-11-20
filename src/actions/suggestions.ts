import {
	SUGGESTIONS_HIDE_PANEL,
	SUGGESTIONS_SHOW_PANEL,
	SomeAction
} from '../actions.js';

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

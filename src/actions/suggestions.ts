import {
	SUGGESTIONS_HIDE_PANEL,
	SUGGESTIONS_SHOW_PANEL,
	SUGGESTIONS_ADD_SUGGESTIONS_FOR_CARD,
	SomeAction,
	SUGGESTIONS_CHANGE_SELECTED
} from '../actions.js';

import {
	selectCards,
	selectSuggestionsForCards
} from '../selectors.js';

import {
	ThunkSomeAction
} from '../store.js';

import {
	suggestionsForCard
} from '../suggestions.js';

import {
	CardDiff,
	ProcessedCard,
	Suggestion,
	SuggestionDiff
} from '../types.js';

import {
	CardID
} from '../types_simple.js';
import { assertUnreachable } from '../util.js';
import { modifyCardsIndividually } from './data.js';

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

export const suggestionsChangeSelected = (index : number | string) : SomeAction => {
	if (typeof index == 'string') index = parseInt(index);
	if (isNaN(index)) throw new Error('Index not a number');
	if (index < 0) throw new Error('Index must be at least 0');
	return {
		type: SUGGESTIONS_CHANGE_SELECTED,
		index
	};
};

type SuggestionItem = 'primary' | 'alternate' | 'rejection';

export const applySuggestion = (suggestion : Suggestion, which : SuggestionItem = 'primary') : ThunkSomeAction => (dispatch, getState) => {
	let item : SuggestionDiff = suggestion.action;
	switch (which) {
	case 'primary':
		item = suggestion.action;
		break;
	case 'alternate':
		if (!suggestion.alternateAction) throw new Error('No alternate');
		item = suggestion.alternateAction;
		break;
	case 'rejection':
		if (!suggestion.rejection) throw new Error('No rejection');
		item = suggestion.rejection;
		break;
	default:
		assertUnreachable(which);
	}

	const state = getState();
	const allCards = selectCards(state);
	
	const cardIDs = [
		...(item.keyCard ? suggestion.keyCards : []), 
		...(item.supportingCards ? suggestion.supportingCards : [])
	];
	const cards = cardIDs.map(id => allCards[id]);

	if (cards.some(card => card === undefined)) throw new Error('Some cards were undefined');

	const modificationsKeyCard = item.keyCard ? suggestion.keyCards.map((id : CardID) : [CardID, CardDiff] => [id, item.keyCard as CardDiff]) : [];
	const modificationsSupportingCard = item.supportingCards ? suggestion.supportingCards.map((id : CardID) : [CardID, CardDiff] => [id, item.supportingCards as CardDiff]) : [];

	const modifications = Object.fromEntries([...modificationsKeyCard, ...modificationsSupportingCard]);

	dispatch(modifyCardsIndividually(cards, modifications));
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

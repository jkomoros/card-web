import {
	SUGGESTIONS_HIDE_PANEL,
	SUGGESTIONS_SHOW_PANEL,
	SUGGESTIONS_REPLACE_SUGGESTIONS_FOR_CARD,
	SomeAction,
	SUGGESTIONS_CHANGE_SELECTED,
	SUGGESTIONS_REMOVE_SUGGESTION_FOR_CARD,
	SUGGESTIONS_SET_USE_LLMS,
	SUGGESTIONS_LOADING_FOR_CARD,
	SUGGESTIONS_SET_PENDING
} from '../actions.js';

import {
	NEW_CARD_ID_PLACEHOLDER
} from '../card_fields.js';

import {
	selectActiveCard,
	selectCardModificationError,
	selectCards,
	selectSuggestionsForCards,
	selectSuggestionsOpen,
	selectSuggestionsPending,
	selectSuggestionsUseLLMs,
	selectUserMayEditActiveCard
} from '../selectors.js';

import {
	ThunkSomeAction
} from '../store.js';

import {
	suggestionsForCard
} from '../suggestions.js';

import {
	CardDiff,
	CreateCardOpts,
	ReferencesEntriesDiffItem,
	Suggestion,
	SuggestionDiff
} from '../types.js';

import {
	CardID
} from '../types_simple.js';

import {
	assertUnreachable, newID
} from '../util.js';

import {
	createCard,
	modifyCardsIndividually,
	waitForCardToExist
} from './data.js';

export const suggestionsShowPanel = () : ThunkSomeAction => (dispatch) => {
	dispatch({
		type: SUGGESTIONS_SHOW_PANEL,
	});
	dispatch(calculateSuggestionsForActiveCard());
};

export const suggestionsHidePanel = () : ThunkSomeAction => (dispatch) => {
	dispatch({
		type: SUGGESTIONS_HIDE_PANEL,
	});
	//No need to calculate suggestions if the panel is now hidden.
};

export const suggestionsTogglePanel = () : ThunkSomeAction => (dispatch, getState) => {
	const open = selectSuggestionsOpen(getState());
	dispatch(open ? suggestionsHidePanel() : suggestionsShowPanel());
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

export const applySuggestion = (cardID : CardID, suggestionIndex : number, which : SuggestionItem = 'primary') : ThunkSomeAction => async (dispatch, getState) => {

	//Bail early if the rest will fail.
	if (!selectUserMayEditActiveCard(getState())) throw new Error('User does not have permission to edit card');

	if (selectSuggestionsPending(getState())) throw new Error('Another suggestion is pending');

	//We're going to change state a few times within this, so don't cache it,
	//just always fetch the newest state throughout the logic.
	const suggestionsByCard = selectSuggestionsForCards(getState());
	const suggestions = suggestionsByCard[cardID];
	if (!suggestions) throw new Error(`No suggestions for card ${cardID}`);
	const suggestion = suggestions[suggestionIndex];
	if (!suggestion) throw new Error(`No suggestion at index ${suggestionIndex} for card ${cardID}`);

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

	let keyCards = suggestion.keyCards;
	let keyCardsDiff = item.keyCards;
	let supportingCards = suggestion.supportingCards;
	let supportingCardsDiff = item.supportingCards;

	dispatch({
		type: SUGGESTIONS_SET_PENDING,
		pending: true
	});

	if (item.createCard) {
		//createCard will not check the validity of this id since it was
		//recently vended from newID().
		const newCardID = newID();
		const opts : CreateCardOpts = {
			id: newCardID,
			noNavigate: true
		};
		if (item.createCard.card_type) opts.cardType = item.createCard.card_type;
		if (item.createCard.title !== undefined) opts.title = item.createCard.title;
		if (item.createCard.body !== undefined) opts.body = item.createCard.body;
		dispatch(createCard(opts));
		await waitForCardToExist(newCardID);

		//Replace any NEW_CARD_ID_PLACEHOLDER with the new card ID.
		if (keyCardsDiff && keyCardsDiff.references_diff) {
			keyCardsDiff = {
				...keyCardsDiff,
				references_diff: keyCardsDiff.references_diff.map((d : ReferencesEntriesDiffItem) : ReferencesEntriesDiffItem => ({...d, cardID: d.cardID == NEW_CARD_ID_PLACEHOLDER ? newCardID : d.cardID}))
			};
		}
		if (supportingCardsDiff && supportingCardsDiff.references_diff) {
			supportingCardsDiff = {
				...supportingCardsDiff,
				references_diff: supportingCardsDiff.references_diff.map((d : ReferencesEntriesDiffItem) : ReferencesEntriesDiffItem => ({...d, cardID: d.cardID == NEW_CARD_ID_PLACEHOLDER ? newCardID : d.cardID}))
			};
		}
		keyCards = keyCards.map(id => id == NEW_CARD_ID_PLACEHOLDER ? newCardID : id);
		supportingCards = keyCards.map(id => id == NEW_CARD_ID_PLACEHOLDER ? newCardID : id);
	}
	
	const allCards = selectCards(getState());
	
	const cardIDs = [
		...(item.keyCards ? keyCards : []), 
		...(item.supportingCards ? supportingCards : [])
	];
	const cards = cardIDs.map(id => allCards[id]);

	if (cards.some(card => card === undefined)) throw new Error('Some cards were undefined');

	const modificationsKeyCard = keyCardsDiff ? keyCards.map((id : CardID) : [CardID, CardDiff] => [id, keyCardsDiff as CardDiff]) : [];
	const modificationsSupportingCard = supportingCardsDiff ? supportingCards.map((id : CardID) : [CardID, CardDiff] => [id, supportingCardsDiff as CardDiff]) : [];

	const modifications = Object.fromEntries([...modificationsKeyCard, ...modificationsSupportingCard]);

	//Sanity check
	if (modifications[NEW_CARD_ID_PLACEHOLDER]) throw new Error('NEW_CARD_ID_PLACEHOLDER remained');

	dispatch(modifyCardsIndividually(cards, modifications));

	//TODO: wait for edit to complete?

	//Mark that suggestion as no longer valid.

	//Fetch a fresh state
	const err = selectCardModificationError(getState());
	if (err) return;

	dispatch({
		type: SUGGESTIONS_REMOVE_SUGGESTION_FOR_CARD,
		card: cardID,
		index: suggestionIndex
	});
	dispatch({
		type: SUGGESTIONS_SET_PENDING,
		pending: false
	});
};
	

const suggestionsReplaceSuggestionsForCard = (card : CardID, suggestions: Suggestion[], extend = false) : SomeAction => {
	return {
		type: SUGGESTIONS_REPLACE_SUGGESTIONS_FOR_CARD,
		card,
		suggestions,
		extend
	};
};

//This is called when card-view has noticed the active card has changed, and is time to add suggestions.
export const calculateSuggestionsForActiveCard = () : ThunkSomeAction => async (dispatch, getState) => {
	const card = selectActiveCard(getState());
	if (!card) return;
	//Only calculate new suggestions if panel is open.
	//This makes it so the feature has low cost if the panel is not open.
	if (!selectSuggestionsOpen(getState())) return;
	dispatch({
		type: SUGGESTIONS_LOADING_FOR_CARD,
		card: card.id
	});
	//Every time a card is activated, kick off new suggestions. This is
	//expensive but helps avoid the stale-suggestion case, but also more
	//importantly the stale-no-suggestion case (where it concluded prviously
	//that no suggestion was warranted but the conditions were changed and now
	//they are warranted). It seems like something smarter like only removing
	//suggestions that were based on cards that have since changed are
	//invalidated (but again, in that case you have the problem of
	//not-suggestions that now would be suggestions))
	//Note that suggestionsReplaceSuggestionsForCard will set the loading to false.
	suggestionsForCard(card, getState()).then((newSuggestions) => dispatch(suggestionsReplaceSuggestionsForCard(card.id,newSuggestions)));
};

export const suggestionsSetUseLLMs = (useLLMs : boolean) : ThunkSomeAction => (dispatch, getState) => {
	const current = selectSuggestionsUseLLMs(getState());
	if (current == useLLMs) return;
	dispatch({
		type: SUGGESTIONS_SET_USE_LLMS,
		useLLMs
	});
	//Refetch suggestions now that LLM value has changed.
	dispatch(calculateSuggestionsForActiveCard());
};

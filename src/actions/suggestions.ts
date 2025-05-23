import {
	SUGGESTIONS_HIDE_PANEL,
	SUGGESTIONS_SHOW_PANEL,
	SUGGESTIONS_REPLACE_SUGGESTIONS_FOR_CARD,
	SomeAction,
	SUGGESTIONS_CHANGE_SELECTED,
	SUGGESTIONS_REMOVE_SUGGESTION_FOR_CARD,
	SUGGESTIONS_SET_USE_LLMS,
	SUGGESTIONS_LOADING_FOR_CARD,
	SUGGESTIONS_SET_PENDING,
	SUGGESTIONS_SET_AGGRESSIVE
} from '../actions.js';

import {
	isNewCardIDPlaceholder,
	replaceNewCardIDPlaceholder
} from '../../shared/card_fields.js';

import {
	selectActiveCard,
	selectCardModificationError,
	selectCards,
	selectSuggestionsAggressive,
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
	streamSuggestionsForCard
} from '../suggestions.js';

import {
	CardDiff,
	CreateCardOpts,
	ReferencesEntriesDiffItem,
	Suggestion,
	SuggestionDiff,
	CardID
} from '../types.js';

import {
	newID
} from '../util.js';

import {
	assertUnreachable
} from '../../shared/util.js';

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
		const createCardsDiff = Array.isArray(item.createCard) ? item.createCard : [item.createCard];
		const newCardIDs : CardID[] = [];
		for (const creatCardDiff of createCardsDiff) {
			//createCard will not check the validity of this id since it was
			//recently vended from newID().
			const newCardID = newID();
			const opts : CreateCardOpts = {
				id: newCardID,
				noNavigate: true
			};
			if (creatCardDiff.card_type) opts.cardType = creatCardDiff.card_type;
			if (creatCardDiff.title !== undefined) opts.title = creatCardDiff.title;
			if (creatCardDiff.body !== undefined) opts.body = creatCardDiff.body;
			if (creatCardDiff.autoSlug !== undefined) opts.autoSlug = creatCardDiff.autoSlug;
			dispatch(createCard(opts));
			await waitForCardToExist(newCardID);
			newCardIDs.push(newCardID);
		}

		//Replace any NEW_CARD_ID_PLACEHOLDER with the new card ID.
		if (keyCardsDiff && keyCardsDiff.references_diff) {
			keyCardsDiff = {
				...keyCardsDiff,
				references_diff: keyCardsDiff.references_diff.map((d : ReferencesEntriesDiffItem) : ReferencesEntriesDiffItem => ({...d, cardID: replaceNewCardIDPlaceholder(d.cardID, newCardIDs)}))
			};
		}
		if (supportingCardsDiff && supportingCardsDiff.references_diff) {
			supportingCardsDiff = {
				...supportingCardsDiff,
				references_diff: supportingCardsDiff.references_diff.map((d : ReferencesEntriesDiffItem) : ReferencesEntriesDiffItem => ({...d, cardID: replaceNewCardIDPlaceholder(d.cardID, newCardIDs)}))
			};
		}
		keyCards = keyCards.map(id => replaceNewCardIDPlaceholder(id, newCardIDs));
		supportingCards = keyCards.map(id => replaceNewCardIDPlaceholder(id, newCardIDs));
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
	if (Object.keys(modifications).filter(key => isNewCardIDPlaceholder(key)).length) throw new Error('NEW_CARD_ID_PLACEHOLDER remained');

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
	

const suggestionsReplaceSuggestionsForCard = (card : CardID, suggestions: Suggestion[], final : boolean, extend = false) : SomeAction => {
	return {
		type: SUGGESTIONS_REPLACE_SUGGESTIONS_FOR_CARD,
		card,
		suggestions,
		extend,
		final
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

	//We're going to stream suggestions. That means we're responsible for
	//setting the loading to false by calling final.
	let firstSuggestionsReceived = false;
	const provider = (partialSuggestions : Suggestion[]) => {
		//the first time we get partialSuggestions, replace what was there.
		dispatch(suggestionsReplaceSuggestionsForCard(card.id, partialSuggestions, false, firstSuggestionsReceived));
		//All future times, extend.
		firstSuggestionsReceived = true;
	};
	//Kick off the suggestions and also the finalizer
	streamSuggestionsForCard(card, getState(), provider).then(() => dispatch(suggestionsReplaceSuggestionsForCard(card.id, [], true, true)));
};

export const suggestionsToggleAggressive = () : ThunkSomeAction => (dispatch, getState) => {
	const current = selectSuggestionsAggressive(getState());
	dispatch(suggestionsSetAggressive(!current));
};

const suggestionsSetAggressive = (aggressive : boolean) : ThunkSomeAction => (dispatch, getState) => {
	const current = selectSuggestionsAggressive(getState());
	if (current == aggressive) return;
	dispatch({
		type: SUGGESTIONS_SET_AGGRESSIVE,
		aggressive
	});
	//Refetch suggestions now that aggressive value has changed;
	dispatch(calculateSuggestionsForActiveCard());
};

export const suggestionsToggleUseLLMs = () : ThunkSomeAction => (dispatch, getState) => {
	const current = selectSuggestionsUseLLMs(getState());
	dispatch(suggestionsSetUseLLMs(!current));
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

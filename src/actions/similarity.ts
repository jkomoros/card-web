
//Popped into a separate file so filter.ts can call it without a use-before-definition

import {
	httpsCallable
} from 'firebase/functions';

import {
	UPDATE_CARD_SIMILARITY
} from '../actions.js';

import {
	QDRANT_ENABLED
} from '../config.GENERATED.SECRET.js';

import {
	selectCardSimilarity
} from '../selectors.js';

import {
	ThunkSomeAction
} from '../store.js';

import {
	CardID
} from '../types_simple.js';

import {
	functions
} from '../firebase.js';

//Replicated in `functions/src/types.ts`
type SimilarCardsRequestData = {
	card_id: CardID
};

//Replicated in `functions/src/types.ts`
type CardSimilarityItem = [CardID, number];

//Replicated in `functions/src/types.ts`
type SimilarCardsResponseData = {
	success: boolean,
	//Will be set if success = false
	error? : string
	cards: CardSimilarityItem[]
};

const similarCardsCallable = httpsCallable<SimilarCardsRequestData, SimilarCardsResponseData>(functions, 'similarCards');

const similarCards = async (cardID : CardID) : Promise<SimilarCardsResponseData> => {
	if (!QDRANT_ENABLED) {
		return {
			success: false,
			error: 'Qdrant isn\'t enabled',
			cards: []
		};
	}
	const request = {
		card_id: cardID
	};
	const result = await similarCardsCallable(request);
	return result.data;
};

export const fetchSimilarCards = (cardID : CardID) : ThunkSomeAction => async (dispatch, getState) => {
	if (!cardID) return;

	const state = getState();

	const similarity = selectCardSimilarity(state);

	if (similarity[cardID]) {
		console.log(`${cardID} already had similarity fetched`);
		return;
	}

	const result = await similarCards(cardID);

	if (!result.success) {
		console.warn(`similarCards failed: ${result.error}`);
		return;
	}

	dispatch({
		type: UPDATE_CARD_SIMILARITY,
		card_id: cardID,
		similarity: Object.fromEntries(result.cards)
	});
	
};
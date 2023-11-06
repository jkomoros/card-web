
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
	Card
} from '../types.js';

import {
	functions
} from '../firebase.js';

//Replicated in src/actions/similarity.ts
type EmbeddableCard = Pick<Card, 'body' | 'title' | 'subtitle' | 'card_type' | 'created' | 'id'>;

//Replicated in `src/actions/similarity.ts`
type SimilarCardsRequestData = {
	card_id: CardID

	//TODO: include a limit

	//If card is provided, it will be used to get the content to embed, live.
	//The user must have AI permission or it will fail.
	//The card provided should match the card_id
	card?: EmbeddableCard
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
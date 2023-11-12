
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
	ThunkSomeAction,
	store
} from '../store.js';

import {
	CardID
} from '../types_simple.js';

import {
	Card,
	State
} from '../types.js';

import {
	functions
} from '../firebase.js';

//Replicated in src/actions/similarity.ts
type EmbeddableCard = Pick<Card, 'body' | 'title' | 'subtitle' | 'card_type' | 'created' | 'id'>;

//Replicated in `src/actions/similarity.ts`
type SimilarCardsRequestData = {
	card_id: CardID

	//timestamp in milliseconds since epoch. If provided, results will only be
	//provided if the Vector point has a last-updated since then, otherwise
	//error of `stale`.
	last_updated? : number

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
	success: false,
	code: 'qdrant-disabled' | 'no-embedding' | 'stale-embedding' | 'unknown'
	error: string
} | {
	success: true
	cards: CardSimilarityItem[]
};

const similarCardsCallable = httpsCallable<SimilarCardsRequestData, SimilarCardsResponseData>(functions, 'similarCards');

const similarCards = async (cardID : CardID) : Promise<SimilarCardsResponseData> => {
	if (!QDRANT_ENABLED) {
		return {
			success: false,
			code: 'qdrant-disabled',
			error: 'Qdrant isn\'t enabled'
		};
	}
	const request = {
		card_id: cardID
	};
	const result = await similarCardsCallable(request);
	return result.data;
};

const fetchSimilarCards = (cardID : CardID) : ThunkSomeAction => async (dispatch) => {
	if (!cardID) return;

	const result = await similarCards(cardID);

	if (result.success == false) {

		//TODO: if it failed because of `stale-embedding`, then try again... as
		//long as it's been under 10 minutes since the card was updated, at
		//which point we just give up.

		console.warn(`similarCards failed: ${result.error}`);
		dispatch({
			type: UPDATE_CARD_SIMILARITY,
			card_id: cardID,
			//Signal that it failed but still did get a response, so the results are now final.
			similarity: {}
		});
		return;
	}

	dispatch({
		type: UPDATE_CARD_SIMILARITY,
		card_id: cardID,
		similarity: Object.fromEntries(result.cards)
	});
	
};

//Returns true if you should expect an UPDATE_CARD_SIMLIARITY for that cardID in the future, and false if not.
export const fetchSimilarCardsIfEnabled = (cardID : CardID) : boolean => {
	if (!QDRANT_ENABLED) return false;
	const state = store.getState() as State;

	const similarity = selectCardSimilarity(state);

	if (similarity[cardID]) {
		return false;
	}
	//This will return immediately.
	store.dispatch(fetchSimilarCards(cardID));
	return true;
};
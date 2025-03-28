
//Popped into a separate file so filter.ts can call it without a use-before-definition

import {
	httpsCallable
} from 'firebase/functions';

import {
	EDITING_UPDATE_SIMILAR_CARDS,
	UPDATE_CARD_SIMILARITY
} from '../actions.js';

import {
	QDRANT_ENABLED
} from '../config.GENERATED.SECRET.js';

import {
	selectCardSimilarity, selectRawCards
} from '../selectors.js';

import {
	ThunkSomeAction,
	store
} from '../store.js';

import {
	CardID,
	Card,
	State
} from '../types.js';

import {
	MillisecondsSinceEpoch,
	EmbeddableCard,
	SimilarCardsRequestData,
	SimilarCardsResponseData
} from '../../shared/types.js';

import {
	functions
} from '../firebase.js';

//Extracts only the properties necessary for EmbeddableCard, which for example
//is useful when transmitting to similarCards endpoint.
const pickEmbeddableCard = (card : Card) : EmbeddableCard => {
	const result : EmbeddableCard = {
		id: card.id,
		body: card.body,
		title: card.title,
		card_type: card.card_type,
		created: card.created
	};
	if (card.commentary) result.commentary = card.commentary;
	return result;
};

const similarCardsCallable = httpsCallable<SimilarCardsRequestData, SimilarCardsResponseData>(functions, 'similarCards');

const similarCards = async (cardID : CardID, lastUpdated? : MillisecondsSinceEpoch) : Promise<SimilarCardsResponseData> => {
	if (!QDRANT_ENABLED) {
		return {
			success: false,
			code: 'qdrant-disabled',
			error: 'Qdrant isn\'t enabled'
		};
	}

	const request : SimilarCardsRequestData = {
		card_id: cardID
	};
	if (lastUpdated) request.last_updated = lastUpdated;
	const result = await similarCardsCallable(request);
	return result.data;
};

const similarCardsForRawCard = async (card : EmbeddableCard) : Promise<SimilarCardsResponseData> => {
	if (!QDRANT_ENABLED) {
		return {
			success: false,
			code: 'qdrant-disabled',
			error: 'Qdrant isn\'t enabled'
		};
	}

	const request : SimilarCardsRequestData = {
		card_id: card.id,
		card: card
	};
	const result = await similarCardsCallable(request);
	return result.data;
};

const TIME_TO_WAIT_FOR_STALE : MillisecondsSinceEpoch = 10 * 60 * 1000;
const DELAY_FOR_STALE : MillisecondsSinceEpoch = 2.5 * 1000;

const fetchSimilarCards = (cardID : CardID, lastUpdated?: MillisecondsSinceEpoch) : ThunkSomeAction => async (dispatch) => {
	if (!cardID) return;

	const result = await similarCards(cardID, lastUpdated);

	if (result.success == false) {

		if (result.code == 'stale-embedding') {
			//This error happens when there might be a new one coming
			//lastUpdated if not provided is safe to pretend it was in like 1970.
			const timeSinceUpdated = Date.now() - (lastUpdated || 0);
			if (timeSinceUpdated < TIME_TO_WAIT_FOR_STALE) {
				//Wait a bit and try again
				console.log(`The card was stale, but it was last updated recently enough that we'll wait ${DELAY_FOR_STALE} ms and try again`);
				setTimeout(() => dispatch(fetchSimilarCards(cardID, lastUpdated)), DELAY_FOR_STALE);
				return;
			}
		}

		console.warn(`similarCards failed: ${result.code}: ${result.error}`);
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

	const cards = selectRawCards(state);
	const card = cards[cardID];
	if (!card) throw new Error(`Couldn't find card ${cardID}`);
	//This will return immediately.
	store.dispatch(fetchSimilarCards(cardID, card?.updated?.toMillis()));
	return true;
};

const fetchSimilarCardsToCardContent = (card : Card) : ThunkSomeAction => async (dispatch) => {
	const embeddableCard = pickEmbeddableCard(card);

	const result = await similarCardsForRawCard(embeddableCard);

	if (result.success == false) {
		console.warn(`similarCards failed: ${result.code}: ${result.error}`);
		dispatch({
			type: EDITING_UPDATE_SIMILAR_CARDS,
			//Signal that it failed but still did get a response, so the results are now final.
			similarity: {}
		});
		return;
	}

	dispatch({
		type: EDITING_UPDATE_SIMILAR_CARDS,
		similarity: Object.fromEntries(result.cards)
	});

};

//Returns true if you should expect an UPDATE_CARD_SIMLIARITY for that cardID in the future, and false if not.
export const fetchSimilarCardsForCardIfEnabled = (card : Card) : boolean => {
	if (!QDRANT_ENABLED) return false;

	//This will return immediately.
	store.dispatch(fetchSimilarCardsToCardContent(card));
	return true;
};

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

import {
	SimilarityRetryCoordinator,
	SimilarityRetryOutcome
} from '../similarity-retry.js';

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
const MAX_CONSECUTIVE_TRANSPORT_ERRORS = 3;

const retryCoordinator = new SimilarityRetryCoordinator({
	onRetry: (cardID, attempt, delayMs) => {
		console.log(`[similarity] ${cardID} is not ready; retry ${attempt} in ${delayMs} ms`);
	}
});

//Editing similarity is keyed by normalized-card object identity: the main
//thread and corpus-worker forwarding paths share that canonical object for a
//given content version, while each edit produces a new one. Keeping this
//coordinator separate avoids an unsaved edit cancelling a committed-card
//request for the same card ID.
const editingRetryCoordinator = new SimilarityRetryCoordinator({
	maxPending: 1,
	maxConcurrent: 1,
	onRetry: (cardID, attempt, delayMs) => {
		console.log(`[similarity] editing card ${cardID} retry ${attempt} in ${delayMs} ms`);
	}
});
const editingCardVersions = new WeakMap<Card, number>();
let nextEditingCardVersion = 1;

const editingCardVersion = (card : Card) : number => {
	const existing = editingCardVersions.get(card);
	if (existing !== undefined) return existing;
	const result = nextEditingCardVersion++;
	editingCardVersions.set(card, result);
	return result;
};

const fetchSimilarCards = (cardID : CardID, lastUpdated : MillisecondsSinceEpoch, dispatch : (action : unknown) => unknown) => {
	let consecutiveTransportErrors = 0;
	retryCoordinator.request(cardID, lastUpdated, async (_, isCurrent) : Promise<SimilarityRetryOutcome> => {
		let result : SimilarCardsResponseData;
		try {
			result = await similarCards(cardID, lastUpdated);
			consecutiveTransportErrors = 0;
		} catch (error) {
			consecutiveTransportErrors++;
			if (consecutiveTransportErrors < MAX_CONSECUTIVE_TRANSPORT_ERRORS) {
				console.warn(`[similarity] transport failure for ${cardID}; retrying (${consecutiveTransportErrors}/${MAX_CONSECUTIVE_TRANSPORT_ERRORS}):`, error);
				return 'retry';
			}
			console.warn(`[similarity] transport failure for ${cardID}; giving up after ${consecutiveTransportErrors} attempts:`, error);
			//Do not install the permanent empty-result sentinel for a transport
			//failure. A later filter run may demand it again after connectivity
			//recovers; the worker TTL permits that retry but does not schedule one.
			return 'done';
		}
		if (!isCurrent()) return 'done';

		if (result.success == false) {
			if (result.code == 'stale-embedding' && Date.now() - lastUpdated < TIME_TO_WAIT_FOR_STALE) {
				return 'retry';
			}
			console.warn(`similarCards failed: ${result.code}: ${result.error}`);
			dispatch({
				type: UPDATE_CARD_SIMILARITY,
				card_id: cardID,
				//Signal that it failed but still did get a response, so the results are now final.
				similarity: {}
			});
			return 'done';
		}

		dispatch({
			type: UPDATE_CARD_SIMILARITY,
			card_id: cardID,
			similarity: Object.fromEntries(result.cards)
		});
		return 'done';
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
	//This will return immediately. The coordinator coalesces the main-thread
	//and corpus-worker triggers for this exact card version.
	fetchSimilarCards(cardID, card?.updated?.toMillis() || 0, store.dispatch);
	return true;
};

const fetchSimilarCardsToCardContent = (card : Card, dispatch : (action : unknown) => unknown) => {
	const embeddableCard = pickEmbeddableCard(card);
	let consecutiveTransportErrors = 0;
	editingRetryCoordinator.request(card.id, editingCardVersion(card), async (_, isCurrent) : Promise<SimilarityRetryOutcome> => {
		let result : SimilarCardsResponseData;
		try {
			result = await similarCardsForRawCard(embeddableCard);
			consecutiveTransportErrors = 0;
		} catch (error) {
			consecutiveTransportErrors++;
			if (consecutiveTransportErrors < MAX_CONSECUTIVE_TRANSPORT_ERRORS) {
				console.warn(`[similarity] transport failure for editing card ${card.id}; retrying (${consecutiveTransportErrors}/${MAX_CONSECUTIVE_TRANSPORT_ERRORS}):`, error);
				return 'retry';
			}
			console.warn(`[similarity] transport failure for editing card ${card.id}; giving up after ${consecutiveTransportErrors} attempts:`, error);
			//The coordinator removes this request on `done`, so a later demand
			//for this same content version can start a fresh bounded chain.
			return 'done';
		}
		if (!isCurrent()) return 'done';

		if (result.success == false) {
			console.warn(`similarCards failed: ${result.code}: ${result.error}`);
			dispatch({
				type: EDITING_UPDATE_SIMILAR_CARDS,
				//Signal that it failed but still did get a response, so the results are now final.
				similarity: {}
			});
			return 'done';
		}

		dispatch({
			type: EDITING_UPDATE_SIMILAR_CARDS,
			similarity: Object.fromEntries(result.cards)
		});
		return 'done';
	});
};

//Returns true if you should expect an UPDATE_CARD_SIMLIARITY for that cardID in the future, and false if not.
export const fetchSimilarCardsForCardIfEnabled = (card : Card) : boolean => {
	if (!QDRANT_ENABLED) return false;
	//This returns immediately. Duplicate main-thread/worker demand for the
	//same canonical editing-card object is coalesced while pending; a later
	//content version cancels the old chain and suppresses its late result.
	fetchSimilarCardsToCardContent(card, store.dispatch);
	return true;
};

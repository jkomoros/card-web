
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
	functions,
	EMULATOR_TARGET
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
const transportFailedVersions = new Map<CardID, MillisecondsSinceEpoch>();
let transportFailedEditingCard : Card | null = null;

const retryCoordinator = new SimilarityRetryCoordinator({
	onRetry: (cardID, attempt, delayMs) => {
		console.log(`[similarity] ${cardID} is not ready; retry ${attempt} in ${delayMs} ms`);
	},
	//Dropped to stay under the LRU bound. fetchSimilarCardsForCard already told
	//its caller to expect a value, so without a terminal state here the card
	//sits loading forever. Settle it with the same empty sentinel the give-up
	//path uses. Deliberately NOT recorded in transportFailedVersions: that map
	//drives the 'online' re-demand loop, and re-demanding every dropped key at
	//once is the storm this bound exists to prevent.
	onDrop: (cardID) => {
		console.warn(`[similarity] ${cardID} dropped to stay under the pending bound; settling it as empty`);
		store.dispatch({type: UPDATE_CARD_SIMILARITY, card_id: cardID, similarity: {}});
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
	},
	onDrop: (cardID) => {
		console.warn(`[similarity] editing card ${cardID} dropped to stay under the pending bound; settling it as unfetched`);
		store.dispatch({type: EDITING_UPDATE_SIMILAR_CARDS, similarity: {}});
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

//PERF HARNESS ONLY: the Firestore emulator has no deployed cloud functions,
//so every similarCards call fails CORS. Left alone, each demand burns
//MAX_CONSECUTIVE_TRANSPORT_ERRORS network attempts with exponential backoff
//while the similar-cards reference block sits in preview — tens of seconds
//of worker contention that made the harness's post-commit measurements
//nondeterministic. Settle immediately with the same terminal empty-result
//sentinel the give-up path produces, so the fingerprint fallback renders at
//once. Never true in dev/prod: EMULATOR_TARGET comes from the
//`firebase-emulator` localStorage flag the harness sets.
const similarityUnavailable = Boolean(EMULATOR_TARGET);

const fetchSimilarCards = (cardID : CardID, lastUpdated : MillisecondsSinceEpoch, dispatch : (action : unknown) => unknown) => {
	let consecutiveTransportErrors = 0;
	if (similarityUnavailable) {
		dispatch({type: UPDATE_CARD_SIMILARITY, card_id: cardID, similarity: {}});
		return;
	}
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
			if (!isCurrent()) return 'done';
			//Settle preview consumers now, but remember this was transport—not a
			//semantic empty result—so online recovery can demand it again.
			transportFailedVersions.set(cardID, lastUpdated);
			dispatch({type: UPDATE_CARD_SIMILARITY, card_id: cardID, similarity: {}});
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
		transportFailedVersions.delete(cardID);
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
	if (!card) {
		console.warn(`Couldn't fetch similarity for missing card ${cardID}`);
		return false;
	}
	//This will return immediately. The coordinator coalesces the main-thread
	//and corpus-worker triggers for this exact card version.
	fetchSimilarCards(cardID, card?.updated?.toMillis() || 0, store.dispatch);
	return true;
};

if (typeof window !== 'undefined') {
	window.addEventListener('online', () => {
		//The coordinator removes completed entries immediately after their run
		//settles; defer one task so an online event racing the final failure can
		//start a fresh request instead of coalescing into that completed run.
		setTimeout(() => {
			for (const [cardID, version] of transportFailedVersions) {
				const card = selectRawCards(store.getState() as State)[cardID];
				if (!card || (card.updated?.toMillis() || 0) !== version) {
					transportFailedVersions.delete(cardID);
					continue;
				}
				transportFailedVersions.delete(cardID);
				fetchSimilarCards(cardID, version, store.dispatch);
			}
			const editingCard = transportFailedEditingCard;
			if (editingCard) {
				transportFailedEditingCard = null;
				const current = (store.getState() as State).editor?.card;
				if (current?.id === editingCard.id) fetchSimilarCardsToCardContent(editingCard, store.dispatch);
			}
		}, 0);
	});
}

const fetchSimilarCardsToCardContent = (card : Card, dispatch : (action : unknown) => unknown) => {
	//PERF HARNESS ONLY: see similarityUnavailable above — the editing-card
	//variant storms the same unreachable endpoint while the user types.
	if (similarityUnavailable) {
		dispatch({type: EDITING_UPDATE_SIMILAR_CARDS, similarity: {}});
		return;
	}
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
			if (!isCurrent()) return 'done';
			transportFailedEditingCard = card;
			dispatch({type: EDITING_UPDATE_SIMILAR_CARDS, similarity: {}});
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
		transportFailedEditingCard = null;
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

import {
	collectionDescription
} from '../filters.js';

import {
	waitForFinalCollection
} from '../actions/collection.js';

import {
	references
} from '../references.js';

import {
	SuggestorArgs,
	makeReferenceSuggestion
} from '../suggestions.js';

import {
	SIMILAR_SAME_TYPE
} from '../reference_blocks.js';

import {
	assertUnreachable,
	cardIsPrioritized
} from '../util.js';

import {
	Suggestion
} from '../types.js';

import {
	chooseBetterCardWithAI,
	pickBetterCard
} from './remove-priority.js';

//Set by looking at a few examples
const DUPLICATE_CUT_OFF = 0.95;

//TODO: this is largely recreated in missing-see-also
export const suggestDupeOf = async (args: SuggestorArgs) : Promise<Suggestion[]> => {
	const {type, card, collectionArguments, logger, useLLMs, uid} = args;
	const description = collectionDescription(...SIMILAR_SAME_TYPE);
	const collection = await waitForFinalCollection(description, {keyCardID: collectionArguments.keyCardID});
	const topCards = collection.finalSortedCards;
	const result : Suggestion[] = [];
	for (const topCard of topCards) {
		logger.info(`topCard: ${topCard.id}`);
		//TODO: this currently assumes that we'll get back an embedding-based
		//similarity, which is true only if qdrant is enabled and there aren't
		//errors in this card. We need another signal that's not preview (which
		//means, try again), but this is low-fidelity. Maybe just have a
		//`meaning` filter which simply doesn't return any results if it's not embedding filter.
		const similarity = collection.sortValueForCard(topCard.id);
		logger.info(`similarity: ${similarity}`);
		if (similarity < DUPLICATE_CUT_OFF) {
			logger.info('Similarity too low.');
			break;
		}
		const refs = references(topCard);
		//We look at array, not substantiveArray, because if there's already an ACK then we want to skip it.
		if (refs.array().includes(card.id)) {
			logger.info('Other has this card referenced already');
			break;
		}
		if (refs.inboundArray().includes(card.id)) {
			logger.info('This card has other referenced already');
			break;
		}

		let reverse = false;

		if (!cardIsPrioritized(card) && cardIsPrioritized(topCard)) {
			logger.info('Flipping which card is priority because the other card is prioritized and this one isn\'t');
			//If the other card is prioritized and this one isn't, then reverse suggestions.
			reverse = true;
		}

		if (useLLMs) {
			logger.info('Asking AI for its opinion on which card is better');
			const result = pickBetterCard(await chooseBetterCardWithAI(card, topCard, uid, logger));
			switch (result) {
			case 'a':
				logger.info('Picking key card because of AI\'s decision on which is better');
				reverse = false;
				break;
			case 'b':
				logger.info('Picking other card because of AI\'s decision on which is better');
				reverse = true;
				break;
			case 'unknown':
				logger.info('It was a draw which one was better.');
				//Whatever it was is fine.
				break;
			default:
				assertUnreachable(result);
			}
		}

		logger.info('Suggesting this as a card');
		//We want the weaker card to point to the stronger card with dupe-of.
		const suggestion = makeReferenceSuggestion(type, topCard.id, card.id, 'dupe-of', reverse);
		//TODO: remove prioirty from whichever card is the other.
		result.push(suggestion);
	}
	return result;
};

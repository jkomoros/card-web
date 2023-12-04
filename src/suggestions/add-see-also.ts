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
	cardIsPrioritized
} from '../util.js';

import {
	Suggestion
} from '../types.js';

//Set by looking at a few examples
const SIMILARITY_CUT_OFF = 0.88;
const AGGRESSIVE_SIMILARITY_CUT_OFF = 0.84;

//TODO: this is largely recreated in dupe-of.ts
export const suggestMissingSeeAlso = async (args: SuggestorArgs) : Promise<Suggestion[]> => {
	const {type, card, collectionArguments, logger} = args;

	if (card.card_type != 'content' && card.card_type != 'working-notes') {
		logger.info(`Skipping because card_type is ${card.card_type}`);
		return [];
	}

	const description = collectionDescription(...SIMILAR_SAME_TYPE);
	const collection = await waitForFinalCollection(description, {keyCardID: collectionArguments.keyCardID});
	const topCards = collection.finalSortedCards;
	if (args.aggressive) logger.info('Using aggressive thresholds');
	const CUT_OFF = args.aggressive ? AGGRESSIVE_SIMILARITY_CUT_OFF : SIMILARITY_CUT_OFF;
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
		if (similarity < CUT_OFF) {
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

		logger.info('Suggesting this as a card');
		const suggestion = makeReferenceSuggestion(type, card.id, topCard.id, 'see-also', reverse);
		result.push(suggestion);
	}
	return result;
};

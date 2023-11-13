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
	Suggestion,
	makeReferenceSuggestion
} from '../suggestions.js';

import {
	SIMILAR_SAME_TYPE
} from '../reference_blocks.js';

//Set by looking at a few examples
const SIMILARITY_CUT_OFF = 0.89;

export const suggestMissingSeeAlso = async (args: SuggestorArgs) : Promise<Suggestion[]> => {
	const {type, card, collectionArguments, logger} = args;
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
		if (similarity < SIMILARITY_CUT_OFF) {
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

		//TODO: if one card is priority and the other is not, then the other card should be the key card.
		logger.info('Suggesting this as a card');
		const suggestion = makeReferenceSuggestion(type, card.id, topCard.id, 'see-also');
		result.push(suggestion);
	}
	return result;
};

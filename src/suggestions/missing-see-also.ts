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

const DUPE_SIMILARITY_CUT_OFF = 0.95;

export const suggestMissingSeeAlso = async (args: SuggestorArgs) : Promise<Suggestion[]> => {
	const {card, collectionArguments, logger} = args;
	const description = collectionDescription(...SIMILAR_SAME_TYPE);
	const collection = await waitForFinalCollection(description, {keyCardID: collectionArguments.keyCardID});
	const topCards = collection.finalSortedCards;
	const result : Suggestion[] = [];
	for (const topCard of topCards) {
		logger.info(`topCard: ${topCard.id}`);
		const similarity = collection.sortValueForCard(topCard.id);
		logger.info(`similarity: ${similarity}`);
		if (similarity < DUPE_SIMILARITY_CUT_OFF) {
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
		logger.info('Suggesting this as a card');
		const suggestion = makeReferenceSuggestion('missing-see-also', card.id, topCard.id, 'see-also');
		result.push(suggestion);
	}
	return result;
};

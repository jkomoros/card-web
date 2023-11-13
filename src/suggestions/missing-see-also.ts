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
	Suggestion
} from '../suggestions.js';

import {
	SIMILAR_SAME_TYPE
} from '../reference_blocks.js';

const DUPE_SIMILARITY_CUT_OFF = 0.95;

export const suggestMissingSeeAlso = async (args: SuggestorArgs) : Promise<Suggestion[] | null> => {
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
		const refsOutbound = refs.byType['see-also'];
		if (refsOutbound && refsOutbound[card.id] !== undefined) {
			logger.info('Other has this card as see-also already');
			break;
		}
		const refsInbound = refs.byTypeInbound['see-also'];
		if (refsInbound && refsInbound[card.id] !== undefined) {
			logger.info('This card has other as see-also already');
			break;
		}
		//TODO: actually suggest an item
		logger.info('Would have suggested see-also');
	}
	return result;
};

import {
	suggestedConceptReferencesForCard
} from '../nlp.js';

import {
	SuggestorArgs
} from '../suggestions.js';

import {
	Suggestion
} from '../types.js';

//There can be missing concept links when concepts were added after a card was added.
export const missingConceptLinks = async (args: SuggestorArgs) : Promise<Suggestion[]> => {
	//TODO: isn't there a filter that does this?

	const {type, card, logger, concepts} = args;

	const suggestedConcepts = suggestedConceptReferencesForCard(card, concepts);

	logger.info(`Suggested concepts: ${suggestedConcepts.join(', ')}`);

	if (suggestedConcepts.length == 0) {
		logger.info('No suggested concepts');
		return [];
	}

	return [{
		type,
		keyCards: [card.id],
		supportingCards: suggestedConcepts,
		action: {
			keyCards: {
				references_diff: suggestedConcepts.map(concept => ({
					cardID: concept,
					referenceType: 'concept',
					value: ''
				}))
			}
		}
	}];

};

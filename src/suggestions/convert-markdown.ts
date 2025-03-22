import snarkdown from 'snarkdown';

import {
	SuggestorArgs
} from '../suggestions.js';

import {
	CardDiff,
	Suggestion
} from '../types.js';

import {
	TEXT_FIELD_CONFIGURATION,
	editableFieldsForCardType
} from '../card_fields.js';

import {
	cardDiffHasChanges
} from '../card_diff.js';

import {
	TypedObject
} from '../../shared/typed_object.js';

import {
	htmlIsEquivalent
} from '../util.js';

//There can be missing concept links when concepts were added after a card was added.
export const convertMarkdown = async (args: SuggestorArgs) : Promise<Suggestion[]> => {
	//TODO: isn't there a filter that does this?

	const {type, card, logger} = args;

	const diff : CardDiff = {};

	for (const cardField of TypedObject.keys(editableFieldsForCardType(card.card_type))) {
		const config = TEXT_FIELD_CONFIGURATION[cardField];
		if (!config.html) continue;
		const value = card[cardField] as string;
		const convertedValue = snarkdown(value);
		//The HTML might differ in whitespace.
		if (!htmlIsEquivalent(value, convertedValue)) {
			logger.info(`Suggesting converting for field ${cardField} ${value} to ${convertedValue}`);
			diff[cardField] = convertedValue;
		}
		
	}

	if (!cardDiffHasChanges(diff)) {
		logger.info('No changes proposed by markdown');
		return [];
	}

	return [{
		type,
		keyCards: [card.id],
		supportingCards: [],
		action: {
			keyCards: diff
		}
	}];

};

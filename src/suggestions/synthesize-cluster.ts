import {
	DEFAULT_LONG_MODEL,
	cachedCompletion, fitPrompt
} from '../actions/ai.js';

import {
	NEW_CARD_ID_PLACEHOLDER
} from '../card_fields.js';

import {
	collectionDescription,
	referencesFilter
} from '../filters.js';

import {
	SuggestorArgs
} from '../suggestions.js';

import {
	Suggestion
} from '../types.js';

import {
	cardPlainContent, 
	wrapPlainContent
} from '../util.js';

//Increment this when substantively changing the implementation/quality of this prompt.
const CURRENT_VERSION = 0;

export const synthesizeCluster = async (args: SuggestorArgs) : Promise<Suggestion[]> => {
	const {type, collectionArguments, logger, uid, useLLMs} = args;
	if (!useLLMs) {
		logger.info('LLMs are not enabled, skipping');
		return [];
	}
	//TODO: a stable sort (by card_id?) so the caching of prompts works.
	const description = collectionDescription(referencesFilter('both', 'see-also', {ply: 5, includeKeyCard: true}));
	const collection = description.collection(collectionArguments);
	//TODO: figure out a way so that we don't duplicate basically the exact same
	//suggestion each time anyone visits any of the clique cards. Perhaps sort
	//by card_id, so the same clique always gets the same text/
	const cliqueCards = collection.finalSortedCards;
	logger.info(`Clique cards: ${cliqueCards.map(card => card.id).join(', ')}`);
	if (cliqueCards.length < 2) {
		logger.info(`Not enough clique cards: ${cliqueCards.length}`);
		return [];
	}
	try {
		const model = DEFAULT_LONG_MODEL;
		const [prompt] = await fitPrompt({
			prefix: 'Here is an essay with some duplication:\n----',
			items: cliqueCards.map(card => cardPlainContent(card)),
			delimiter: '\n\n',
			//TODO: this prompt still gets a lot of unncessary editing of words.
			suffix: '----\nPlay back the essay word for word, omitting any direct duplication, keeping as much of the original\'s precise wording and content as possible.',
			modelName: model
		});
		logger.info(`Prompt: ${prompt}`);
		//cachedCompletion will return the result without hitting the backend if
		//we already have asked for it. This makes repeats, as long as sort is
		//stable, fast.
		const suggestedBody = await cachedCompletion(prompt, uid, model);
		logger.info(`Suggested body: ${suggestedBody}`);
		const cliqueIDs = cliqueCards.map(card => card.id);
		const suggestedRichBody = wrapPlainContent(suggestedBody);
		return [{
			type,
			keyCards: [NEW_CARD_ID_PLACEHOLDER],
			supportingCards: cliqueIDs,
			action: {
				createCard: {
					//TODO: a different type, perhaps set by the type of the clique cards?
					card_type: 'working-notes',
					body: suggestedRichBody
				},
				keyCards: {
					references_diff: cliqueIDs.map(id => ({
						cardID: id,
						referenceType: 'mined-from',
						value: ''
					})),
					set_flags: {
						created_by_suggestor: type,
						created_by_suggestor_version: CURRENT_VERSION
					}
				}
			}
			//TODO: figure out a way to signal a reject action. Perhaps set a
			//new kind of TODO on the clique card?
		}];
	} catch(err) {
		logger.info(`Completion failed: ${err}`);
		return [];
	}
};

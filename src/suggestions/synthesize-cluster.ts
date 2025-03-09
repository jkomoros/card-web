import {
	DEFAULT_MODEL,
	cachedCompletion, fitPrompt
} from '../actions/ai.js';

import {
	newCardIDPlaceholder
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

	//TODO: check to see if there's a mined-from card that covers all of these
	//see-also things already and has the created_by_suggestor flag (which is
	//basicaly that it was done already by this) and if so, bail.

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
		const model = DEFAULT_MODEL;
		const [prompt] = await fitPrompt({
			prefix: 'Here is an essay with some duplication:\n----',
			items: cliqueCards.map(card => cardPlainContent(card)),
			delimiter: '\n\n',
			//TODO: this prompt still gets a lot of unncessary editing of words.
			suffix: '----\nPlay back each sentence word for word, using precisely the same language with no changes. The only exception is you may omit sentences that are almost completely the same as a sentence you\'ve already played back.',
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
			keyCards: [newCardIDPlaceholder()],
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

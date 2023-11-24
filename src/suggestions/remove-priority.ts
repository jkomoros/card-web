import {
	DEFAULT_LONG_MODEL,
	cachedCompletion
} from '../actions/ai.js';

import {
	collectionDescription,
	referencesFilter
} from '../filters.js';
import { references } from '../references.js';

import {
	SuggestorArgs
} from '../suggestions.js';

import {
	Suggestion
} from '../types.js';

import {
	cardIsPrioritized,
	cardPlainContent
} from '../util.js';

import {
	z
} from 'zod';

const comparisonResultSchema = z.object({
	more_substantive: z.enum(['a', 'b']),
	better_written: z.enum(['a', 'b'])
});

export const removePriority = async (args: SuggestorArgs) : Promise<Suggestion[]> => {
	const {type, card, collectionArguments, logger, uid, useLLMs} = args;
	if (!useLLMs) {
		logger.info('LLMs are not enabled, skipping');
		return [];
	}
	//This suggstor is about removing priority for cards that are associted with
	//better cards that are already prioritized.
	if (!cardIsPrioritized(card)) {
		logger.info('Card was not prioritized');
		return [];
	}

	//dupe-of SHOULD be rare, because the dupe-of suggestor should remove priortiy already.
	const refs = references(card);
	if (refs.byType['dupe-of']) {
		const otherCards = refs.byTypeArray()['dupe-of'];
		if (!otherCards) throw new Error('Unexpectedly no dupe-of cards');
		logger.info(`Card is dupe-of ${otherCards.join(', ')}`);
		//It doesn't matter if the other cards are priortized; dupe-of should
		//never be prioritized.
		return [{
			type,
			keyCards: [card.id],
			supportingCards: otherCards,
			action: {
				keyCards: {
					auto_todo_overrides_removals: ['prioritized']
				}
			}
		}];
	}
	//TODO: we likely don't need the whole collectionDescription here and can just use references.

	//TODO: a stable sort (by card_id?) so the caching of prompts works.
	const description = collectionDescription(referencesFilter('both', 'see-also'));
	const collection = description.collection(collectionArguments);
	//TODO: figure out a way so that we don't duplicate basically the exact same
	//suggestion each time anyone visits any of the clique cards. Perhaps sort
	//by card_id, so the same clique always gets the same text/
	const seeAlsoCards = collection.finalSortedCards;
	logger.info(`See Also cards: ${seeAlsoCards.map(card => card.id).join(', ')}`);
	const selfPlainContent = cardPlainContent(card);
	try {
		const model = DEFAULT_LONG_MODEL;
		for (const other of seeAlsoCards) {
			logger.info(`Considering ${other.id}`);
			if (!cardIsPrioritized(other)) {
				logger.info('Other is not prioritized');
				continue;
			}
			const otherPlainContent = cardPlainContent(other);
			//TODO: use function calling?
			const prompt = `The following are two essays:
			Essay A:
			${selfPlainContent}
			-----
			Essay B:
			${otherPlainContent}
			-----
			Compare which essay is better by being more substantive, and also better written (flows the best, stands on its own, not just a rough thought).
			Return ONLY JSON (no other text!) matching the following TypeScript schema:
			type Result = {
				more_substantive: 'a' | 'b';
				better_written: 'a' | 'b';
			}
			`;
			logger.info(`Prompt: ${prompt}`);
			//cachedCompletion will return the result without hitting the backend if
			//we already have asked for it. This makes repeats, as long as sort is
			//stable, fast.
			const rawComparisonResult = await cachedCompletion(prompt, uid, model);
			logger.info(`Comparison result: ${rawComparisonResult}`);
			const comparisonJSON = JSON.parse(rawComparisonResult);
			//This will throw if it gives a bad result and that's fine.
			const comparisonResult = comparisonResultSchema.parse(comparisonJSON);
			if (comparisonResult.better_written == 'a') {
				logger.info('The key card was better written');
				continue;
			}
			if (comparisonResult.more_substantive == 'a') {
				logger.info('The key card was more substantive');
				continue;
			}
			return [{
				type,
				keyCards: [card.id],
				supportingCards: [other.id],
				action: {
					keyCards: {
						auto_todo_overrides_removals: ['prioritized']
					}
				}
			}];
		}
	} catch(err) {
		logger.info(`Completion failed: ${err}`);
		return [];
	}
	return [];
};

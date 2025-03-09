import {
	DEFAULT_MODEL,
	cachedCompletion
} from '../actions/ai.js';

import {
	collectionDescription,
	referencesFilter
} from '../filters.js';

import {
	references
} from '../references.js';

import {
	SuggestorArgs
} from '../suggestions.js';

import {
	TypedObject
} from '../typed_object.js';

import {
	Card,
	Logger,
	Suggestion
} from '../types.js';

import {
	assertUnreachable,
	cardIsPrioritized,
	cardPlainContent
} from '../util.js';

import {
	z
} from 'zod';

const comparsionItem = z.enum(['a', 'b']);
const triStateComparisonItem = z.enum(['a', 'b', 'unknown']);

type TriStateComparisonItem = z.infer<typeof triStateComparisonItem>;

const aiComparisonResultSchema = z.object({
	more_substantive: comparsionItem,
	better_written: comparsionItem,
});

const comparisonResultSchema = aiComparisonResultSchema.partial().extend({
	more_recent: z.optional(comparsionItem),
	prioritized: z.optional(triStateComparisonItem)
});

type AIComparisonResult = z.infer<typeof aiComparisonResultSchema>;

type ComparisonResult = z.infer<typeof comparisonResultSchema>;

const COMPARISON_RESULT_SCORES : Record<keyof ComparisonResult, number> = {
	more_recent: 0.3,
	more_substantive: 0.2,
	better_written: 0.2,
	prioritized: 0.1
};

const UNKNOWN_TRESHOLD = 0.2;

export const pickBetterCard = (result : ComparisonResult, logger? : Logger) : TriStateComparisonItem => {
	//positive is better for a. negative is better for b.
	let runningCount = 0;
	for (const [key, multiplier] of TypedObject.entries(COMPARISON_RESULT_SCORES)) {
		const value = result[key];
		if (value === undefined) continue;
		switch (value) {
		case 'a':
			runningCount += 1.0 * multiplier;
			break;
		case 'b':
			runningCount += -1.0 * multiplier;
			break;
		case 'unknown':
			//pass
			break;
		default:
			assertUnreachable(value);
		}
	}
	if (logger) logger.info(`Grade is ${runningCount}`);
	if (Math.abs(runningCount) < UNKNOWN_TRESHOLD) return 'unknown';
	return runningCount > 0 ? 'a' : 'b';
};

export const gradeCards = async (a : Card, b : Card, useLLMs = false, uid : string, logger : Logger) : Promise<ComparisonResult> => {
	let prioritized : TriStateComparisonItem = 'unknown';
	if (cardIsPrioritized(a) && !cardIsPrioritized(b)) prioritized = 'a';
	if (!cardIsPrioritized(a) && cardIsPrioritized(b)) prioritized = 'b';
	const more_recent = a.created.seconds > b.created.seconds ? 'a' : 'b';
	let result : ComparisonResult = {
		prioritized,
		more_recent
	};
	if (useLLMs) {
		try {
			//Sometimes the AI gives an erroneous result that doesn't schema
			//check, like giving 'B' instead of 'b', which it's been doing in
			//production for c-949-cbb418.
			const aiResult = await chooseBetterCardWithAI(a, b, uid, logger);
			result = {
				...result,
				...aiResult
			};
		} catch(err) {
			logger.error(`LLM had an error: ${err}`);
		}
	}
	return result;
};

//If a or b is a Card, then it will extract the content. If it's a string, it
//assumes it's already the cardPlainContent.
const chooseBetterCardWithAI = async (a : Card, b : Card, uid : string, logger : Logger) : Promise<AIComparisonResult> => {
	const model = DEFAULT_MODEL;
	//TODO: use function calling?
	const prompt = `The following are two essays:
	Essay A:
	${cardPlainContent(a)}
	-----
	Essay B:
	${cardPlainContent(b)}
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
	return aiComparisonResultSchema.parse(comparisonJSON);
};

export const removePriority = async (args: SuggestorArgs) : Promise<Suggestion[]> => {
	const {type, card, collectionArguments, logger, uid, useLLMs} = args;
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

	if (!useLLMs) {
		logger.info('LLMs are not enabled, skipping the rest');
		return [];
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
	try {
		for (const other of seeAlsoCards) {
			logger.info(`Considering ${other.id}`);
			if (!cardIsPrioritized(other)) {
				logger.info('Other is not prioritized');
				continue;
			}
			const comparisonResult = await chooseBetterCardWithAI(card, other, uid, logger);
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

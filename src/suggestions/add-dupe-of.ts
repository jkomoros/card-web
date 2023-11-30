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
	assertUnreachable,
	cardIsPrioritized
} from '../util.js';

import {
	Suggestion
} from '../types.js';

import {
	gradeCards,
	pickBetterCard
} from './remove-priority.js';

//Number of seconds difference a card-created can be to be considered recent.
const RECENT_THRESHOLD = 2 * 7 * 24 * 60 * 60; // 2 weeks

//Set by looking at a few examples
const DUPLICATE_CUT_OFF = 0.95;
const AGGRESSIVE_DUPLICATE_CUT_OFF = 0.92;
//For cards that are within a few weeks of each other, the cutoff is lower.
const RECENT_SIMILARITY_CUT_OFF = 0.92;
const AGGRESSIVE_RECENT_SIMLIARITY_CUT_OFF = 0.87;

//TODO: this is largely recreated in missing-see-also
export const suggestDupeOf = async (args: SuggestorArgs) : Promise<Suggestion[]> => {
	const {type, card, collectionArguments, logger, useLLMs, uid} = args;
	const description = collectionDescription(...SIMILAR_SAME_TYPE);
	const collection = await waitForFinalCollection(description, {keyCardID: collectionArguments.keyCardID});
	const topCards = collection.finalSortedCards;
	const result : Suggestion[] = [];

	if (args.aggressive) logger.info('Setting aggressive cutoff thresholds');

	const CUT_OFF = args.aggressive ? AGGRESSIVE_DUPLICATE_CUT_OFF : DUPLICATE_CUT_OFF;
	const RECENT_CUT_OFF = args.aggressive ? AGGRESSIVE_RECENT_SIMLIARITY_CUT_OFF : RECENT_SIMILARITY_CUT_OFF;

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
			const timeDiff = Math.abs(card.created.seconds - topCard.created.seconds);
			if (timeDiff < RECENT_THRESHOLD && similarity > RECENT_CUT_OFF) {
				logger.info(`The card's were not similar enough on their own, but because they were ${timeDiff / (60 * 60 * 24)} days different, they cleared the modified threshold.`);
			} else {
				logger.info('Similarity too low.');
				break;
			}
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

		let weakCardIsTopCard = true;


		logger.info('Asking grader for its opinion on which card is better');
		const grade = await gradeCards(card, topCard, useLLMs, uid, logger);
		logger.info(`Grade: ${JSON.stringify(grade, null, '\t')}`);
		const finalGrade = pickBetterCard(grade, logger);
		switch (finalGrade) {
		case 'a':
			logger.info('Picking key card because of AI\'s decision on which is better');
			weakCardIsTopCard = true;
			break;
		case 'b':
			logger.info('Picking other card because of AI\'s decision on which is better');
			weakCardIsTopCard = false;
			break;
		case 'unknown':
			logger.info('It was a draw which one was better.');
			//Whatever it was is fine.
			break;
		default:
			assertUnreachable(finalGrade);
		}

		logger.info('Suggesting this as a card');
		//We want the weaker card to point to the stronger card with dupe-of, which is backwards from normal reverse.
		const suggestion = makeReferenceSuggestion(type, card.id, topCard.id, 'dupe-of', weakCardIsTopCard);
		//Remove priorized from any prioritized cards, whenever it shows up, because only the weaker card will be mentioned.
		if (cardIsPrioritized(card)) {
			if (suggestion.action.keyCards) suggestion.action.keyCards.auto_todo_overrides_removals = ['prioritized'];
			if (suggestion.alternateAction?.keyCards) suggestion.alternateAction.keyCards.auto_todo_overrides_removals = ['prioritized'];
		}
		if (cardIsPrioritized(topCard)) {
			if (suggestion.action.supportingCards) suggestion.action.supportingCards.auto_todo_overrides_removals = ['prioritized'];
			if (suggestion.alternateAction?.supportingCards) suggestion.alternateAction.supportingCards.auto_todo_overrides_removals = ['prioritized'];
		}
		result.push(suggestion);
	}
	return result;
};

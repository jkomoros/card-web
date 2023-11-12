import {
	selectCards, selectCollectionConstructorArguments, userMayEditCard
} from './selectors.js';

import {
	CardDiff,
	CollectionConstructorArguments,
	ProcessedCard,
	ProcessedCards,
	State
} from './types.js';

import {
	SIMILAR_SAME_TYPE
} from './reference_blocks.js';

import {
	CardID
} from './types_simple.js';

import {
	collectionDescription
} from './filters.js';

import {
	waitForFinalCollection
} from './actions/collection.js';

type SuggestionDiff = {
	keyCard: CardDiff,
	//The diff to apply to each supportingCard.
	supportingCards?: CardDiff
};

type SuggestionType = 'missing-see-also';

export type Suggestion = {
	type: SuggestionType,
	keyCard: CardID,
	supportingCards: CardID[],
	//TODO: add contextCards

	//The diff to apply if the action is accepted
	action: SuggestionDiff,
	//An alternate action. Often the mirror of the primary.
	alternateAction?: SuggestionDiff
	//The diff to apply if the action is rejected. Typically an `ack` reference.
	rejection?: SuggestionDiff
};

type Logger = {
	info(...msg: unknown[]): void;
	error(...msg: unknown[]): void;
	log(...msg: unknown[]): void;
	warn(...msg: unknown[]): void;
}

type SuggestorArgs = {
	logger : Logger,
	card: ProcessedCard,
	cards: ProcessedCards,
	collectionArguments: CollectionConstructorArguments
};

type Suggestor = {
	generator: (args: SuggestorArgs) => Promise<Suggestion[] | null>
}

const DUPE_SIMILARITY_CUT_OFF = 0.95;

const suggestMissingSeeAlso = async (args: SuggestorArgs) : Promise<Suggestion[] | null> => {
	const {collectionArguments, logger} = args;
	const description = collectionDescription(...SIMILAR_SAME_TYPE);
	const collection = await waitForFinalCollection(description, {keyCardID: collectionArguments.keyCardID});
	const topCard = collection.finalSortedCards[0];
	logger.info(`topCard: ${topCard ? topCard.id : 'NULL'}`);
	if (!topCard) return null;
	const similarity = collection.sortValueForCard(topCard.id);
	logger.info(`similarity: ${similarity}`);
	if (similarity < DUPE_SIMILARITY_CUT_OFF) {
		logger.info('Similarity too low.');
		return null;
	}
	//TODO: actually suggestion an item
	return null;
};

const SUGGESTORS : {[suggestor in SuggestionType]: Suggestor} = {
	'missing-see-also': {
		generator: suggestMissingSeeAlso
	}
};

const VERBOSE = false;

const devNull : Logger = {
	//eslint-disable-next-line @typescript-eslint/no-empty-function
	log: () => {},
	//eslint-disable-next-line @typescript-eslint/no-empty-function
	warn: () => {},
	//eslint-disable-next-line @typescript-eslint/no-empty-function
	error: () => {},
	//eslint-disable-next-line @typescript-eslint/no-empty-function
	info: () => {}
};

export const suggestionsForCard = async (card : ProcessedCard, state : State) : Promise<Suggestion[]> => {

	const result : Suggestion[] = [];

	const logger = VERBOSE ? console : devNull;

	logger.info(`Starting suggestions for ${card.id}`);

	//Only suggest things for cards the user may actually edit.
	if (!userMayEditCard(state, card.id)) {
		logger.info('User may not edit card');
		return [];
	}

	const args : SuggestorArgs = {
		card,
		cards: selectCards(state),
		collectionArguments: {
			...selectCollectionConstructorArguments(state),
			keyCardID: card.id
		},
		logger
	};

	for (const [name, suggestor] of Object.entries(SUGGESTORS)) {
		logger.info(`Starting suggestor ${name}`);
		const innerResult = await suggestor.generator(args);
		logger.info(`Suggestor ${name} returned ${JSON.stringify(innerResult, null, '\t')}`);
		if (!innerResult) continue;
		result.push(...innerResult);
	}

	return result;
};
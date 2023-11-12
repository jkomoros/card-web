import {
	selectCards, selectCollectionConstructorArguments
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

type SuggestorArgs = {
	card: ProcessedCard,
	cards: ProcessedCards
	collectionArguments: CollectionConstructorArguments
};

type Suggestor = {
	generator: (args: SuggestorArgs) => Promise<Suggestion[] | null>
}

const DUPE_SIMILARITY_CUT_OFF = 0.95;

const suggestMissingSeeAlso = async (args: SuggestorArgs) : Promise<Suggestion[] | null> => {
	const {collectionArguments} = args;
	const description = collectionDescription(...SIMILAR_SAME_TYPE);
	const collection = await waitForFinalCollection(description, {keyCardID: collectionArguments.keyCardID});
	const topCard = collection.finalSortedCards[0];
	if (!topCard) return null;
	const similarity = collection.sortValueForCard(topCard.id);
	if (similarity < DUPE_SIMILARITY_CUT_OFF) return null;
	//TODO: actually provide a suggestion
	console.log('Similarity', similarity);
	return null;
};

const SUGGESTORS : {[suggestor in SuggestionType]: Suggestor} = {
	'missing-see-also': {
		generator: suggestMissingSeeAlso
	}
};

export const suggestionsForCard = async (card : ProcessedCard, state : State) : Promise<Suggestion[]> => {

	const result : Suggestion[] = [];

	const args : SuggestorArgs = {
		card,
		cards: selectCards(state),
		collectionArguments: {
			...selectCollectionConstructorArguments(state),
			keyCardID: card.id
		}	
	};

	for (const suggestor of Object.values(SUGGESTORS)) {
		const innerResult = await suggestor.generator(args);
		if (!innerResult) continue;
		result.push(...innerResult);
	}

	return result;
};
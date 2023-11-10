import {
	selectCards
} from './selectors.js';

import {
	CardDiff,
	ProcessedCard,
	ProcessedCards,
	State
} from './types.js';

import {
	CardID
} from './types_simple.js';

type SuggestionDiff = {
	keyCard: CardDiff,
	//The diff to apply to each supportingCard.
	supportingCards?: CardDiff
};

type SuggestionType = 'noop';

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
};

type Suggestor = {
	generator: (args: SuggestorArgs) => Promise<Suggestion[] | null>
}

const SUGGESTORS : {[suggestor in SuggestionType]: Suggestor} = {
	'noop': {
		generator: async(_args: SuggestorArgs) : Promise<Suggestion[] | null> => {
			return null;
		}
	}
};

export const suggestionsForCard = async (card : ProcessedCard, state : State) : Promise<Suggestion[]> => {

	const result : Suggestion[] = [];

	const cards = selectCards(state);

	const args : SuggestorArgs = {
		card,
		cards
	};

	for (const suggestor of Object.values(SUGGESTORS)) {
		const innerResult = await suggestor.generator(args);
		if (!innerResult) continue;
		result.push(...innerResult);
	}

	return result;
};
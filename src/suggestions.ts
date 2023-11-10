import {
	CardDiff,
	ProcessedCard,
	ProcessedCards
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

type Suggestor = {
	generator: (card : ProcessedCard, cards: ProcessedCards) => Promise<Suggestion[] | null>
}

export const SUGGESTORS : {[suggestor in SuggestionType]: Suggestor} = {
	'noop': {
		generator: async(_card : ProcessedCard, _cards: ProcessedCards) : Promise<Suggestion[] | null> => {
			return null;
		}
	}
};
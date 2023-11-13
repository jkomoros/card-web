import {
	selectCards, selectCollectionConstructorArguments, userMayEditCard
} from './selectors.js';

import {
	CardDiff,
	CollectionConstructorArguments,
	ProcessedCard,
	ProcessedCards,
	ReferenceType,
	ReferencesEntriesDiffItem,
	State
} from './types.js';

import {
	CardID
} from './types_simple.js';

import {
	suggestMissingSeeAlso
} from './suggestions/missing-see-also.js';
import { TypedObject } from './typed_object.js';

type SuggestionDiff = {
	keyCard: CardDiff,
	//The diff to apply to each supportingCard.
	supportingCards?: CardDiff
} | {
	keyCard? : CardDiff,
	supportingCards: CardDiff
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

export const makeReferenceSuggestion = (type : SuggestionType, keyCard: CardID, otherCards: CardID | CardID[], referenceType : ReferenceType) : Suggestion => {
	//TODO: it's kind of finicky to have to keep track of which ID is which... shouldn't the actions have a sentinel for each that is overriden before being executed?

	if (typeof otherCards == 'string') otherCards = [otherCards];

	return {
		type,
		keyCard,
		supportingCards: otherCards,

		action: {
			keyCard: {
				references_diff: otherCards.map((otherCard : CardID) : ReferencesEntriesDiffItem => ({
					cardID: otherCard,
					referenceType,
					value: ''
				}))
			}
		},
		alternateAction: {
			supportingCards: {
				references_diff: [
					{
						cardID: keyCard,
						referenceType,
						value: ''
					}
				]
			}
		}
	};
};

type Logger = {
	info(...msg: unknown[]): void;
	error(...msg: unknown[]): void;
	log(...msg: unknown[]): void;
	warn(...msg: unknown[]): void;
}

export type SuggestorArgs = {
	//The type of hte suggestor being called. This is convenient so they don't
	//have to remember what literal they are.
	type: SuggestionType,
	logger : Logger,
	card: ProcessedCard,
	cards: ProcessedCards,
	collectionArguments: CollectionConstructorArguments
};

type Suggestor = {
	generator: (args: SuggestorArgs) => Promise<Suggestion[]>
}

const SUGGESTORS : {[suggestor in SuggestionType]: Suggestor} = {
	//TODO: a dupe one
	//TODO: one to remove priority for near dupes
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

	const args : Omit<SuggestorArgs, 'type'> = {
		card,
		cards: selectCards(state),
		collectionArguments: {
			...selectCollectionConstructorArguments(state),
			keyCardID: card.id
		},
		logger
	};

	for (const [name, suggestor] of TypedObject.entries(SUGGESTORS)) {
		logger.info(`Starting suggestor ${name}`);
		const innerResult = await suggestor.generator({
			...args,
			type: name
		});
		logger.info(`Suggestor ${name} returned ${JSON.stringify(innerResult, null, '\t')}`);
		if (!innerResult) continue;
		result.push(...innerResult);
	}

	return result;
};
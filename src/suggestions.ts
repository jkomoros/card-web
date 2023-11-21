import {
	selectCards,
	selectCollectionConstructorArguments,
	selectDataIsFullyLoaded,
	userMayEditCard
} from './selectors.js';

import {
	CollectionConstructorArguments,
	ProcessedCard,
	ProcessedCards,
	ReferenceType,
	ReferencesEntriesDiffItem,
	State,
	Suggestion,
	SuggestionType,
	TagInfos
} from './types.js';

import {
	CardID
} from './types_simple.js';

import {
	suggestMissingSeeAlso
} from './suggestions/missing-see-also.js';

import {
	TypedObject
} from './typed_object.js';
import { memoize } from './memoize.js';

export const makeReferenceSuggestion = (type : SuggestionType, keyCard: CardID | CardID[], otherCards: CardID | CardID[], referenceType : ReferenceType) : Suggestion => {
	//TODO: it's kind of finicky to have to keep track of which ID is which... shouldn't the actions have a sentinel for each that is overriden before being executed?

	if (typeof otherCards == 'string') otherCards = [otherCards];
	if (typeof keyCard == 'string') keyCard = [keyCard];

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
				references_diff: keyCard.map((card : CardID) : ReferencesEntriesDiffItem => ({
					cardID: card,
					referenceType,
					value: ''
				}))
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
	generator: (args: SuggestorArgs) => Promise<Suggestion[]>,
	title: string
}

export const SUGGESTORS : {[suggestor in SuggestionType]: Suggestor} = {
	//TODO: a dupe one
	//TODO: one to remove priority for near dupes
	'missing-see-also': {
		generator: suggestMissingSeeAlso,
		title: 'Missing See Also'
	}
};

const VERBOSE = false;

//This makes it so no suggestions are ever returned, effectively hiding the
//feature. This allows development behind a guard.
const DISABLE_SUGGESTIONS = true;

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

	if (DISABLE_SUGGESTIONS) {
		logger.info('Suggestions disabled');
		return [];
	}

	logger.info(`Starting suggestions for ${card.id}`);

	//Only suggest things for cards the user may actually edit.
	if (!userMayEditCard(state, card.id)) {
		logger.info('User may not edit card');
		return [];
	}

	if (!selectDataIsFullyLoaded(state)) {
		//A lot of suggestions rely on having all cards.
		logger.info('Data isn\'t fully loaded');
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

export const tagInfosForSuggestions = memoize((suggestions : Suggestion[]) : TagInfos => {
	return Object.fromEntries(suggestions.map((suggestion, index) => {
		const suggestorInfo = SUGGESTORS[suggestion.type];
		const id = String(index);
		return [id, {
			id,
			title: suggestorInfo.title
		}];
	}));
});
import {
	selectCards,
	selectCollectionConstructorArguments,
	selectConcepts,
	selectDataIsFullyLoaded,
	selectSuggestionsUseLLMs,
	selectUid,
	selectUserMayUseAI,
	userMayEditCard
} from './selectors.js';

import {
	CSSColorString,
	CollectionConstructorArguments,
	Logger,
	ProcessedCard,
	ProcessedCards,
	ReferenceType,
	ReferencesEntriesDiffItem,
	State,
	StringCardMap,
	Suggestion,
	SuggestionType,
	TagInfo,
	TagInfos,
	Uid
} from './types.js';

import {
	CardID
} from './types_simple.js';

import {
	TypedObject
} from './typed_object.js';

import {
	memoize
} from './memoize.js';

import {
	COLORS
} from './type_constants.js';

import {
	suggestMissingSeeAlso
} from './suggestions/missing-see-also.js';

import {
	suggestDupeOf
} from './suggestions/dupe-of.js';

import {
	synthesizeCluster
} from './suggestions/synthesize-cluster.js';

import {
	removePriority
} from './suggestions/remove-priority.js';

import {
	missingConceptLinks
} from './suggestions/missing-concept-links.js';

export const makeReferenceSuggestion = (type : SuggestionType, keyCards: CardID | CardID[], otherCards: CardID | CardID[], referenceType : ReferenceType, reverse = false) : Suggestion => {
	//TODO: it's kind of finicky to have to keep track of which ID is which... shouldn't the actions have a sentinel for each that is overriden before being executed?

	if (typeof otherCards == 'string') otherCards = [otherCards];
	if (typeof keyCards == 'string') keyCards = [keyCards];

	if (reverse) {
		return {
			type,
			keyCards,
			supportingCards: otherCards,
			action: {
				supportingCards: {
					references_diff: keyCards.map((card : CardID) : ReferencesEntriesDiffItem => ({
						cardID: card,
						referenceType,
						value: ''
					}))
				}
			},
			alternateAction: {
				keyCards: {
					references_diff: otherCards.map((card : CardID) : ReferencesEntriesDiffItem => ({
						cardID: card,
						referenceType,
						value: ''
					}))
				}
			},
			rejection: {
				supportingCards: {
					references_diff: keyCards.map((card : CardID) : ReferencesEntriesDiffItem => ({
						cardID: card,
						referenceType: 'ack',
						value: ''
					}))
				}
			}
		};
	}

	return {
		type,
		keyCards,
		supportingCards: otherCards,
		action: {
			keyCards: {
				references_diff: otherCards.map((card : CardID) : ReferencesEntriesDiffItem => ({
					cardID: card,
					referenceType,
					value: ''
				}))
			}
		},
		alternateAction: {
			supportingCards: {
				references_diff: keyCards.map((card : CardID) : ReferencesEntriesDiffItem => ({
					cardID: card,
					referenceType,
					value: ''
				}))
			}
		},
		rejection: {
			keyCards: {
				references_diff: otherCards.map((card : CardID) : ReferencesEntriesDiffItem => ({
					cardID: card,
					referenceType: 'ack',
					value: ''
				}))
			}
		}
	};
};

export type SuggestorArgs = {
	//The type of hte suggestor being called. This is convenient so they don't
	//have to remember what literal they are.
	type: SuggestionType,
	logger : Logger,
	card: ProcessedCard,
	cards: ProcessedCards,
	collectionArguments: CollectionConstructorArguments,
	uid: Uid,
	concepts: StringCardMap,
	//Whether it's OK to use LLMs for suggestions. It will be true IFF LLMs are
	//configured in this instance and it's OK to use them.
	useLLMs: boolean
};

type Suggestor = {
	generator: (args: SuggestorArgs) => Promise<Suggestion[]>,
	title: string,
	color: CSSColorString
}

export const SUGGESTORS : {[suggestor in SuggestionType]: Suggestor} = {
	'dupe-of': {
		generator: suggestDupeOf,
		title: 'Duplicate Of',
		color: COLORS.DARK_CYAN
	},
	'missing-see-also': {
		generator: suggestMissingSeeAlso,
		title: 'Missing See Also',
		color: COLORS.DARK_GREEN
	},
	'synthesize-cluster': {
		generator: synthesizeCluster,
		title: 'Synthesize Cluster',
		color: COLORS.FIRE_BRICK
	},
	'remove-priority': {
		generator: removePriority,
		title: 'Remove Prioritized',
		color: COLORS.DARK_MAGENTA
	},
	'missing-concept-links': {
		generator: missingConceptLinks,
		title: 'Missing Concepts',
		color: COLORS.DARK_KHAKI
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
		logger,
		concepts: selectConcepts(state),
		uid: selectUid(state),
		useLLMs: selectUserMayUseAI(state) && selectSuggestionsUseLLMs(state)
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
	return Object.fromEntries(suggestions.map((suggestion : Suggestion, index : number) : [string, TagInfo] => {
		const suggestorInfo = SUGGESTORS[suggestion.type];
		const id = String(index);
		return [id, {
			id,
			title: suggestorInfo.title,
			color: suggestorInfo.color
		}];
	}));
});
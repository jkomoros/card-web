import {
	selectCards,
	selectCollectionConstructorArguments,
	selectConcepts,
	selectDataIsFullyLoaded,
	selectSuggestionsAggressive,
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
	Uid,
	CardID
} from './types.js';

import {
	TypedObject
} from '../shared/typed_object.js';

import {
	memoize
} from './memoize.js';

import {
	COLORS
} from '../shared/card-fields.js';

import {
	suggestMissingSeeAlso
} from './suggestions/add-see-also.js';

import {
	suggestDupeOf
} from './suggestions/add-dupe-of.js';

import {
	synthesizeCluster
} from './suggestions/synthesize-cluster.js';

import {
	removePriority
} from './suggestions/remove-priority.js';

import {
	missingConceptLinks
} from './suggestions/add-concept.js';

import {
	convertToQuote
} from './suggestions/convert-to-quote.js';
import { convertMarkdown } from './suggestions/convert-markdown.js';

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
	useLLMs: boolean,
	//How aggressive to be. If aggressive, it's appropraite to use lower
	//triggering thresholds, to suggest more items.
	aggressive: boolean
};

type Suggestor = {
	generator: (args: SuggestorArgs) => Promise<Suggestion[]>,
	title: string,
	color: CSSColorString
}

export const SUGGESTORS : {[suggestor in SuggestionType]: Suggestor} = {
	'add-dupe-of': {
		generator: suggestDupeOf,
		title: 'Add Dupe Of',
		color: COLORS.DARK_CYAN
	},
	'add-see-also': {
		generator: suggestMissingSeeAlso,
		title: 'Add See Also',
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
	'add-concept': {
		generator: missingConceptLinks,
		title: 'Add Concept',
		color: COLORS.DARK_KHAKI
	},
	'convert-to-quote': {
		generator: convertToQuote,
		title: 'Convert to Quote',
		color: COLORS.NAVY
	},
	'convert-markdown': {
		generator: convertMarkdown,
		title: 'Convert Markdown',
		color: COLORS.ROYAL_BLUE
	}
};

const VERBOSE = false;

//This will stream results by passing an array of results, or null to signal no more will come.
type StreamingSuggestionProvider = (partialResult : Suggestion[]) => void;

class PrefixedLogger {

	_inner : Logger;
	_prefix : string;

	constructor(logger : Logger, prefix : string) {
		this._inner = logger;
		this._prefix = prefix;
	}

	info(...msg: unknown[]): void {
		this._inner.info(this._prefix, ...msg);
	}

	error(...msg: unknown[]): void {
		this._inner.error(this._prefix, ...msg);
	}

	log(...msg: unknown[]): void {
		this._inner.log(this._prefix, ...msg);
	}

	warn(...msg: unknown[]): void {
		this._inner.warn(this._prefix, ...msg);
	}
}

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

	const provider = (partialSuggestions : Suggestion[]) => {
		result.push(...partialSuggestions);
	};

	await streamSuggestionsForCard(card, state, provider);

	return result;
};

//The returned promise will be resolved when provider() has been called for all of the items it will be.
export const streamSuggestionsForCard = async (card : ProcessedCard, state : State, provider : StreamingSuggestionProvider) : Promise<void> => {

	const logger = VERBOSE ? console : devNull;

	logger.info(`Starting suggestions for ${card.id}`);

	//Only suggest things for cards the user may actually edit.
	if (!userMayEditCard(state, card.id)) {
		logger.info('User may not edit card');
		return;
	}

	if (!selectDataIsFullyLoaded(state)) {
		//A lot of suggestions rely on having all cards.
		logger.info('Data isn\'t fully loaded');
		return;
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
		useLLMs: selectUserMayUseAI(state) && selectSuggestionsUseLLMs(state),
		aggressive: selectSuggestionsAggressive(state)
	};

	const promises : Promise<void>[] = [];

	for (const [name, suggestor] of TypedObject.entries(SUGGESTORS)) {
		//We'll run all of these in parallel. This is way better/faster than
		//doing it in serial, but there are two problems: 1) the better
		//techniques (which tend to take longer) show up at the end of the list,
		//and 2) the log messages might get interleaved in a confusing way if
		//VERBOSE is true.

		const promise = (async () => {
			//Since the log messages might be interleaved, add a prefix for each one.
			const innerLogger = new PrefixedLogger(logger, name);
			innerLogger.info(`Starting suggestor ${name}`);
			const innerResult = await suggestor.generator({
				...args,
				type: name,
				logger: innerLogger
			});
			innerLogger.info(`Suggestor ${name} returned ${JSON.stringify(innerResult, null, '\t')}`);
			if (!innerResult) return;
			//Don't reset results until we have one to show.
			if (innerResult.length == 0) return;
			provider(innerResult);
		})();
		promises.push(promise);
	}

	await Promise.all(promises);

	return;
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
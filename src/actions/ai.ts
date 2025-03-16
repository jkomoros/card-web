import {
	ThunkSomeAction
} from '../store.js';

import {
	FunctionsError,
	httpsCallable
} from 'firebase/functions';

import {
	functions
} from '../firebase.js';

import {
	ChatCompletionCreateParams,
	ChatCompletion
} from 'openai/resources/chat/completions';

import {
	selectAIDialogKind,
	selectAIResult,
	selectAIResultIndex,
	selectActiveCollectionCards,
	selectCollectionConstructorArguments,
	selectConcepts,
	selectEditingCard,
	selectIsEditing,
	selectUid,
	selectUserMayUseAI
} from '../selectors.js';

import {
	assertUnreachable,
	cardPlainContent,
	innerTextForHTML,
	stringHash
} from '../util.js';

import {
	Card,
	CardID,
	Uid,
	AIDialogType,
	State,
	AIModelName,
	StringCardMap,
	CardType,
	OpenAIModelName,
	AnthropicModelName
} from '../types.js';

import {
	textFieldUpdated
} from './editor.js';

import {
	CollectionDescription
} from '../collection_description.js';

import {
	limitFilter
} from '../filters.js';

import {
	AI_DIALOG_CLOSE,
	AI_REQUEST_STARTED,
	AI_RESULT,
	AI_SELECT_RESULT_INDEX,
	AI_SET_ACTIVE_CARDS,
	AI_SHOW_ERROR,
	SomeAction
} from '../actions.js';

import {
	OPENAI_ENABLED,
	ANTHROPIC_ENABLED
} from '../config.GENERATED.SECRET.js';

import {
	MODEL_INFO,
	DEFAULT_OPENAI_MODEL,
	DEFAULT_ANTHROPIC_MODEL
} from '../../shared/ai.js';

export type AIDialogTypeConfiguration = {
	title: string;
	resultType: 'text-block' | 'multi-line' | 'tag-list';
	commitAction? : () => ThunkSomeAction;
	//For prompts that give different results, a rerun action.
	rerunAction? : () => ThunkSomeAction;
};

const commitTitleSuggestion  = () : ThunkSomeAction => (dispatch, getState) => {
	const state = getState();
	const index = selectAIResultIndex(state);
	const result = selectAIResult(state);
	if (index < 0 || index >= result.length) throw new Error('Invalid index');
	const item = result[index];
	dispatch(textFieldUpdated('title', item));
};

const openaiCallable = httpsCallable(functions, 'openai');
const anthropicCallable = httpsCallable(functions, 'anthropic');

type OpenAIRemoteCallCreateChatCompletion = {
	endpoint: 'chat.completions.create',
	payload: ChatCompletionCreateParams
};

type OpenAIRemoteCall = OpenAIRemoteCallCreateChatCompletion;

type OpenAIRemoteResult = ChatCompletion;

// Import types from Anthropic SDK
import {
	Messages
} from '@anthropic-ai/sdk/resources/messages/messages';

type AnthropicRemoteCallCreateMessage = {
	endpoint: 'messages.create',
	payload: Messages.MessageCreateParams 
};

type AnthropicRemoteCall = AnthropicRemoteCallCreateMessage;

type AnthropicRemoteResult = Messages.Message;

class OpenAIProxy {

	//TODO: this should be chat.completions.create to mtach the new style
	createChatCompletion(request: ChatCompletionCreateParams): Promise<ChatCompletion> {
		return this._bridge({
			endpoint: 'chat.completions.create',
			payload: request
		});
	}

	async _bridge(data: OpenAIRemoteCall): Promise<OpenAIRemoteResult> {
		const result = await openaiCallable(data);
		//TODO: what if it's an error?
		return result.data as OpenAIRemoteResult;
	}
}

class AnthropicProxy {
	createMessage(request: Messages.MessageCreateParams): Promise<Messages.Message> {
		return this._bridge({
			endpoint: 'messages.create',
			payload: request
		});
	}

	async _bridge(data: AnthropicRemoteCall): Promise<AnthropicRemoteResult> {
		const result = await anthropicCallable(data);
		return result.data as AnthropicRemoteResult;
	}
}

const openai = new OpenAIProxy();
const anthropic = new AnthropicProxy();

const CARD_SEPARATOR = '\n-----\n';

export const DEFAULT_MODEL : AIModelName = DEFAULT_ANTHROPIC_MODEL;

const COMPLETION_CACHE : {[hash : string] : string} = {};

export const cachedCompletion = async (prompt : string, uid: Uid, model : AIModelName = DEFAULT_MODEL) : Promise<string> => {
	const key = stringHash(model + prompt);
	if (COMPLETION_CACHE[key]) return COMPLETION_CACHE[key];
	const result = await completion(prompt, uid, model);
	COMPLETION_CACHE[key] = result;
	return result;
};

const openAICompletion = async (prompt: string, uid: Uid, model: OpenAIModelName = DEFAULT_OPENAI_MODEL) : Promise<string> => {
	if (!OPENAI_ENABLED) throw new Error('OpenAI not enabled');
	
	const result = await openai.createChatCompletion({
		model,
		messages: [
			{
				role: 'user',
				content: prompt
			}
		],
		//maxTokens defaults to inf
		user: uid
	});
	if (!result) throw new Error('no result');
	if (!result.choices) throw new Error('no result choices');
	if (!result.choices[0]) throw new Error('no result choice');
	if (!result.choices[0].message) throw new Error('No choices message');
	return result.choices[0].message.content || '';
};

const anthropicCompletion = async (prompt: string, uid: Uid, model: AnthropicModelName = DEFAULT_ANTHROPIC_MODEL) : Promise<string> => {
	if (!ANTHROPIC_ENABLED) throw new Error('Anthropic not enabled');
	
	const result = await anthropic.createMessage({
		model,
		messages: [
			{
				role: 'user',
				content: prompt
			},
		],
		max_tokens: 16000,
		metadata: {
			user_id: uid
		}
	});
	
	if (!result) throw new Error('no result');
	if (!result.content) throw new Error('no content in result');
	if (result.content.length === 0) throw new Error('empty content array');
	
	// Extract text from content blocks
	const textContent = result.content
		.filter(block => block.type === 'text')
		.map(block => (block as {type: 'text', text: string}).text)
		.join('');
		
	return textContent;
};

const completion = async (prompt: string, uid: Uid, model: AIModelName = DEFAULT_MODEL) : Promise<string> => {
	const modelInfo = MODEL_INFO[model];
	if (!modelInfo) throw new Error('Unknown model: ' + model);
	switch(modelInfo.provider) {
	case 'openai':
		return openAICompletion(prompt, uid, model as OpenAIModelName);
	case 'anthropic':
		return anthropicCompletion(prompt, uid, model as AnthropicModelName);
	default:
		return assertUnreachable(modelInfo.provider);
	}
};

type FitPromptArguments = {
	prefix?: string,
	delimiter?: string,
	items?: string[],
	suffix?: string,
	//if this is not defined but modelName is, will use the type for modelName.
	maxTokenLength?: number,
	modelName? : AIModelName
};

const DEFAULT_FIT_PROMPT : Required<Omit<FitPromptArguments, 'maxTokenLength'>> = {
	prefix: '',
	delimiter: CARD_SEPARATOR,
	items: [],
	suffix: '',
	modelName: DEFAULT_MODEL,
};

const computeTokenCount = async (text : string | string[], model : AIModelName) : Promise<number> => {
	const modelInfo = MODEL_INFO[model];
	if (!modelInfo) throw new Error('Unknown model: ' + model);
	switch(modelInfo.provider) {
	case 'openai':
		return openAIComputeTokenCount(text);
	case 'anthropic':
		return anthropicComputeTokenCount(text);
	default:
		return assertUnreachable(modelInfo.provider);
	}
};

const anthropicComputeTokenCount = async (text : string | string[]) : Promise<number> => {
	// A more accurate conservative client-side estimate for Anthropic token count
	// Claude's tokenizer (based on BPE) is similar to OpenAI's but with some differences
	// This method uses the following heuristics for a conservative estimate:
	// - Whitespace and punctuation are usually 1 token each
	// - Common English words are often 1 token
	// - Longer words are typically broken into multiple tokens
	// - Non-ASCII characters often consume more tokens
	// - The ratio is typically 0.4 tokens per character for English text (higher than OpenAI's 0.25-0.3)
	// - We'll use 0.5 tokens per character as a conservative estimate
	
	if (typeof text === 'string') text = [text];
	
	let totalTokens = 0;
	
	for (const str of text) {
		// Count characters
		const charCount = str.length;

		// Count whitespace (spaces, tabs, newlines)
		const whitespaceCount = (str.match(/\s/g) || []).length;

		// Count punctuation
		const punctuationCount = (str.match(/[.,!?;:'"()[\]{}]/g) || []).length;

		// Count non-ASCII characters (which typically use more tokens)
		// eslint-disable-next-line no-control-regex
		const nonAsciiCount = (str.match(/[^\x00-\x7F]/g) || []).length;
		
		// Base token estimate: characters * 0.5 (conservative ratio for English text)
		let tokenEstimate = charCount * 0.5;
		
		// Add extra for non-ASCII characters (they often use more tokens)
		tokenEstimate += nonAsciiCount * 0.5;
		
		// Ensure we count at least one token per whitespace/punctuation
		// (this helps account for token boundaries at these points)
		tokenEstimate = Math.max(tokenEstimate, whitespaceCount + punctuationCount);
		
		totalTokens += Math.ceil(tokenEstimate);
	}
	
	// Add a 10% safety margin for any edge cases
	return Math.ceil(totalTokens * 1.1);
};

//NOTE: this downloads the tokenizer file if not already loaded, which is multiple MB.
const openAIComputeTokenCount = async (text : string | string[]) : Promise<number> => {
	//Note: the types are declared in src/gpt-tok.d.ts, which is set to not be visible in VSCode.
	const {default: module } = await import('gpt-tok');
	if (typeof text == 'string') text = [text];
	const counts = text.map(str => module.encode(str).length);
	return counts.reduce((a, b) => a + b, 0);
};

export const fitPrompt = async (args: FitPromptArguments) : Promise<[prompt: string, maxItemIndex : number]> => {
	const options = {
		...DEFAULT_FIT_PROMPT,
		...args
	};
	if (options.maxTokenLength === undefined) {
		options.maxTokenLength = options.modelName ? MODEL_INFO[options.modelName].maxTokens : 4000;
	}
	const modelName = options.modelName || DEFAULT_MODEL;
	const nonItemsTokenCount = await computeTokenCount([options.prefix, options.suffix, options.delimiter], modelName);
	let itemsTokenCount = 0;
	let result = options.prefix + options.delimiter;
	let i = 0;
	while ((itemsTokenCount + nonItemsTokenCount) < options.maxTokenLength) {
		if (options.items.length <= i) break;
		const item = options.items[i];
		itemsTokenCount += await computeTokenCount([item, options.delimiter], modelName);
		if ((itemsTokenCount + nonItemsTokenCount) >= options.maxTokenLength) break;
		result += item + options.delimiter;
		i++;
	}
	result += options.suffix;
	return [result, i];
};

const cardsAISummaryPrompt = async (cards : Card[], model : AIModelName) : Promise<[prompt : string, ids : CardID[]]> => {
	const cardContent = Object.fromEntries(cards.map(card => [card.id, cardPlainContent(card)]));
	const filteredCards = cards.filter(card => cardContent[card.id]);
	const items = filteredCards.map(card => cardContent[card.id]);

	const [prompt, maxItemIndex] = await fitPrompt({
		prefix: 'Below is a collection of cards. Create a succinct but comprehensive summary of all cards that is no longer than 8 sentences. The summary should combine similar insights but keep distinctive insights where possible.\n\nCards:',
		suffix: 'Summary:\n',
		items,
		maxTokenLength: MODEL_INFO[model].maxTokens
	});

	const ids = filteredCards.slice(0,maxItemIndex).map(card => card.id);

	console.log('Asking AI assistant. Depending on how recently you ran it this might take some time to warmup.');

	console.log('Prompt\n',prompt);

	return [prompt, ids];
};

const cardsAIConceptsPrompt = async (concepts: string[], cards : Card[], model : AIModelName) : Promise<[prompt : string, ids : CardID[]]> => {
	const cardContent = Object.fromEntries(cards.map(card => [card.id, cardPlainContent(card)]));
	const filteredCards = cards.filter(card => cardContent[card.id]);
	const items = filteredCards.map(card => cardContent[card.id]);

	const [prompt, maxItemIndex] = await fitPrompt({
		prefix: `Here is a collection of all concepts:\n\n${concepts.join(', ')}\n\nBelow is a collection of cards. Please suggest concepts that appear to be missing, prioritizing concepts that occur across multiple cards. Concepts should be text that comes directly from the card. Each concept should be just the concept itself, with no explanation. Return a JSON array.\n\nCards:`,
		suffix: 'Missing concepts:\n',
		items,
		maxTokenLength: MODEL_INFO[model].maxTokens
	});

	const ids = filteredCards.slice(0,maxItemIndex).map(card => card.id);

	console.log('Asking AI assistant. Depending on how recently you ran it this might take some time to warmup.');

	console.log('Prompt\n',prompt);

	return [prompt, ids];
};

type aiErrorDetails = {
	status: number;
	statusText: string;
}

const extractAIError = (err : FunctionsError) : string => {
	let message = String(err);
	if (err.name == 'FirebaseError') {
		if (err.details) {
			const details = err.details as aiErrorDetails;
			message = 'AI Endpoint Error: ' + details.status + ': ' + details.statusText;
		} else {
			message = err.message;
		}
	}
	return message;
};

const showAIError = (err : FunctionsError) : ThunkSomeAction => async (dispatch) => {
	dispatch({
		type: AI_SHOW_ERROR,
		error: extractAIError(err)
	});

};

const FALLBACK_TITLES = [
	'Make space for long-term thinking',
	'Good leaders have 1:1s that decrease stress',
	'Beware illustory consensus due to ill-defined terms',
	'Start by assuming there\'s no villain ',
	'Systems Theory is a powerful lens in complex spaces',
	'The power of asking “Why?”',
	'Focus on direction, not solution, in complex problem spaces',
	'In complex spaces, avoid collapsing the wave function early',
	'Prefer simpler models in uncertainty',
	'McNamara fallacy: What can\'t be measured doesn\'t matter'
];

//returns good examples of titles to emulate, assuming that highly-starred cards
//in this collection are the best ones.
const selectGoodTitles = (state : State, count = 20) : string[] => {
	//TODO: memoize
	const contentFilter : CardType = 'content';
	const description = new CollectionDescription('everything', [contentFilter, limitFilter(count)], 'stars');
	const collection = description.collection(selectCollectionConstructorArguments(state));
	const titles = collection.sortedCards.map(card => card.title);
	return [...titles, ...FALLBACK_TITLES].slice(0,count);
};

export const titleForEditingCardWithAI = (count = 5) : ThunkSomeAction => async (dispatch, getState) => {
	const state = getState();
	const mayUseAI = selectUserMayUseAI(state);
	if (!mayUseAI) {
		throw new Error('User does not have permission to use AI');
	}
	if (!selectIsEditing(state)) {
		throw new Error('Not editing a card');
	}

	const uid = selectUid(state);

	const editingCard = selectEditingCard(state);
	if (!editingCard) throw new Error('Editing but no card');
	const body = innerTextForHTML(editingCard.body);

	if (!body) throw new Error('No body provided');

	const model = DEFAULT_MODEL;

	dispatch(aiRequestStarted('title', model));

	let prompt = 'The following is a short essay: ' + CARD_SEPARATOR + body + CARD_SEPARATOR;
	prompt += 'Here are examples of good titles of other essays:' + CARD_SEPARATOR + selectGoodTitles(state).join('\n') + CARD_SEPARATOR;
	prompt += `Append ${count} suggested titles for this essay. Each should be a pithy, clever summary that includes a verb in 35 characters or less. Put one title on each line.`;

	try {
		const result = await completion(prompt, uid, model);
		//The prompt keeps on returning numbered results no matter how I tweak it, so just remove that.
		const lines = result.split('\n').map(str => str.replace(/^\d+\.\s*/, '').trim());
		dispatch(aiResult(lines));
	} catch(err) {
		dispatch(showAIError(err));
	}
};

export const summarizeCardsWithAI = () : ThunkSomeAction => async (dispatch, getState) => {
	const state = getState();
	const mayUseAI = selectUserMayUseAI(state);
	if (!mayUseAI) {
		throw new Error('User does not have permission to use AI');
	}
	const uid = selectUid(state);
	const cards = selectActiveCollectionCards(state);
	const model = DEFAULT_MODEL;
	dispatch(aiRequestStarted('summary', model));

	const [prompt, ids] = await cardsAISummaryPrompt(cards, model);
	dispatch({
		type: AI_SET_ACTIVE_CARDS,
		allCards: cards.map(card => card.id),
		filteredCards: ids
	});
	let result = '';
	try {
		result = await completion(prompt, uid, model);
		dispatch(aiResult(result));
	} catch(err) {
		dispatch(showAIError(err));
	}

};

//Takes the concept map and returns things like 'Coordination Headwind (AKA Herding Cats)'
const distilledConceptStrings = (reversedConcepts : StringCardMap) : string[] => {
	const concepts : {[concept : string] : string[]} = {};
	for (const [str, concept] of Object.entries(reversedConcepts)) {
		if (!concepts[concept]) concepts[concept] = [];
		concepts[concept].push(str);
	}
	const conceptStrings = Object.values(concepts).map(strs => {
		if (strs.length == 1) return strs[0];
		return strs[0] + ' (AKA ' + strs.slice(1).join(', ') + ')';
	});
	return conceptStrings;
};

export const missingConceptsWithAI = () : ThunkSomeAction => async (dispatch, getState) => {
	const state = getState();
	const mayUseAI = selectUserMayUseAI(state);
	if (!mayUseAI) {
		throw new Error('User does not have permission to use AI');
	}
	const uid = selectUid(state);
	const cards = selectActiveCollectionCards(state);
	const model = DEFAULT_MODEL;
	dispatch(aiRequestStarted('concepts', model));

	const reversedConcepts = selectConcepts(state);
	const conceptStrings = distilledConceptStrings(reversedConcepts);
	const [prompt, ids] = await cardsAIConceptsPrompt(conceptStrings, cards, model);
	dispatch({
		type: AI_SET_ACTIVE_CARDS,
		allCards: cards.map(card => card.id),
		filteredCards: ids
	});
	let result = '';
	try {
		result = await completion(prompt, uid, model);
		const lines = JSON.parse(result);
		if (!Array.isArray(lines)) throw new Error('Not lines as expected');
		dispatch(aiResult(lines));
	} catch(err) {
		dispatch(showAIError(err));
	}

};

export const AI_DIALOG_TYPE_CONFIGURATION : {[key in AIDialogType] : AIDialogTypeConfiguration} = {
	'summary': {
		title: 'Summarize Cards',
		resultType: 'text-block',
	},
	'title': {
		title: 'Suggest Title',
		resultType: 'multi-line',
		commitAction: commitTitleSuggestion,
		rerunAction: titleForEditingCardWithAI
	},
	'concepts': {
		title: 'Missing Concepts',
		resultType: 'tag-list'
	}
};

const aiRequestStarted = (kind : AIDialogType, model: AIModelName) : SomeAction => {
	return {
		type: AI_REQUEST_STARTED,
		kind,
		model
	};
};

const aiResult = (result : string | string[]) : SomeAction => {
	if (typeof result == 'string') result = [result];
	return {
		type: AI_RESULT,
		result
	};
};

export const aiSelectResultIndex = (index : number) : ThunkSomeAction => (dispatch, getState) => {
	const result = selectAIResult(getState());
	if (index < 0) {
		index = -1;
	} else {
		if (index >= result.length) throw new Error('Invalid index');
	}
	dispatch({
		type: AI_SELECT_RESULT_INDEX,
		index
	});
};

export const closeAIDialog = (commit : boolean) : ThunkSomeAction => (dispatch, getState) => {
	dispatch({
		type: AI_DIALOG_CLOSE
	});

	if (commit) {
		const state = getState();
		const kind = selectAIDialogKind(state);
		const config = AI_DIALOG_TYPE_CONFIGURATION[kind];
		if (config.commitAction) dispatch(config.commitAction());
	}
};
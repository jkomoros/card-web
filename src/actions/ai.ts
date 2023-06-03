import {
	AppActionCreator
} from '../store.js';

import {
	FunctionsError,
	httpsCallable
} from 'firebase/functions';

import {
	functions
} from '../firebase.js';

import {
	CreateChatCompletionRequest,
	CreateChatCompletionResponse,
	CreateCompletionRequest,
	CreateCompletionResponse
} from 'openai';

import {
	selectAIDialogKind,
	selectAIResult,
	selectAIResultIndex,
	selectActiveCollectionCards,
	selectCollectionConstructorArguments,
	selectEditingCard,
	selectIsEditing,
	selectUid,
	selectUserMayUseAI
} from '../selectors.js';

import {
	cardPlainContent,
	innerTextForHTML
} from '../util.js';

import {
	Card,
	CardID,
	Uid,
	AIDialogType,
	State
} from '../types.js';

import {
	AnyAction
} from 'redux';

import {
	AI_DIALOG_TYPE_CARD_SUMMARY,
	AI_DIALOG_TYPE_SUGGEST_TITLE,
	CARD_TYPE_CONTENT,
	EVERYTHING_SET_NAME,
	SORT_NAME_STARS,
	TEXT_FIELD_TITLE
} from '../type_constants.js';

import {
	textFieldUpdated
} from './editor.js';
import { CollectionDescription } from '../collection_description.js';
import { limitConfigurableFilterText } from '../filters.js';

export const AI_REQUEST_STARTED = 'AI_REQUEST_STARTED';
export const AI_RESULT = 'AI_RESULT';
export const AI_SELECT_RESULT_INDEX = 'AI_SELECT_RESULT_INDEX';
export const AI_DIALOG_CLOSE = 'AI_DIALOG_CLOSE';
export const AI_SET_ACTIVE_CARDS = 'AI_SET_ACTIVE_CARDS';
export const AI_SHOW_ERROR = 'AI_SHOW_ERROR';

export type AIDialogTypeConfiguration = {
	title: string;
	multiResult: boolean;
	commitAction? : AppActionCreator;
	//For prompts that give different results, a rerun action.
	rerunAction? : AppActionCreator;
};

const commitTitleSuggestion : AppActionCreator  = () => (dispatch, getState) => {
	const state = getState();
	const index = selectAIResultIndex(state);
	const result = selectAIResult(state);
	if (index < 0 || index >= result.length) throw new Error('Invalid index');
	const item = result[index];
	dispatch(textFieldUpdated(TEXT_FIELD_TITLE, item));
};

const openaiCallable = httpsCallable(functions, 'openai');

type OpenAIRemoteCallCreateCompletion = {
	endpoint: 'createCompletion',
	payload: CreateCompletionRequest
};

type OpenAIRemoteCallCreateChatCompletion = {
	endpoint: 'createChatCompletion',
	payload: CreateChatCompletionRequest
};

type OpenAIRemoteCall = OpenAIRemoteCallCreateCompletion | OpenAIRemoteCallCreateChatCompletion;

type OpenAIRemoteResult = CreateCompletionResponse | CreateChatCompletionResponse;

class OpenAIProxy {
	createCompletion(request : CreateCompletionRequest) : Promise<CreateCompletionResponse> {
		return this._bridge({
			endpoint: 'createCompletion',
			payload: request
		});
	}

	createChatCompletion(request: CreateChatCompletionRequest): Promise<CreateChatCompletionResponse> {
		return this._bridge({
			endpoint: 'createChatCompletion',
			payload: request
		});
	}

	async _bridge(data: OpenAIRemoteCall): Promise<OpenAIRemoteResult> {
		const result = await openaiCallable(data);
		//TODO: what if it's an error?
		return result.data as OpenAIRemoteResult;
	}
}

const openai = new OpenAIProxy();

const CARD_SEPARATOR = '\n-----\n';

const completion = async (prompt: string, uid: Uid, useChat = false) : Promise<string> => {
	if (useChat) {
		const result = await openai.createChatCompletion({
			model: 'gpt-3.5-turbo',
			messages: [
				{
					role: 'user',
					content: prompt
				}
			],
			//maxTokens defaults to inf
			user: uid
		});
		return result.choices[0].message.content;
	}
	//Use normal completion API
	const result = await openai.createCompletion({
		model: 'text-davinci-003',
		prompt: prompt,
		max_tokens: 4096,
		user: uid
	});
	return result.choices[0].text;
};

const USE_CHAT = true;

type FitPromptArguments = {
	prefix?: string,
	delimiter?: string,
	items?: string[],
	suffix?: string,
	maxTokenLength?: number
};

const DEFAULT_FIT_PROMPT : Required<FitPromptArguments> = {
	prefix: '',
	delimiter: CARD_SEPARATOR,
	items: [],
	suffix: '',
	maxTokenLength: 4000,
};

const estimateTokenCount = (input : string | string[]) : number => {
	if (Array.isArray(input)) {
		return input.map(item => estimateTokenCount(item)).reduce((a, b) => a + b);
	}
	//TODO: figure out how to get a better token estimate
	return input.length / 4;
};

const fitPrompt = (args: FitPromptArguments) : [prompt: string, maxItemIndex : number] => {
	const options = {
		...DEFAULT_FIT_PROMPT,
		...args
	};
	const nonItemsTokenCount = estimateTokenCount([options.prefix, options.suffix, options.delimiter]);
	let itemsTokenCount = 0;
	let result = options.prefix + options.delimiter;
	let i = 0;
	while ((itemsTokenCount + nonItemsTokenCount) < options.maxTokenLength) {
		if (options.items.length <= i) break;
		const item = options.items[i];
		itemsTokenCount += estimateTokenCount([item, options.delimiter]);
		if ((itemsTokenCount + nonItemsTokenCount) >= options.maxTokenLength) break;
		result += item + options.delimiter;
		i++;
	}
	result += options.suffix;
	return [result, i];
};

const cardsAISummaryPrompt = (cards : Card[]) : [prompt : string, ids : CardID[]] => {
	const cardContent = Object.fromEntries(cards.map(card => [card.id, cardPlainContent(card)]));
	const filteredCards = cards.filter(card => cardContent[card.id]);
	const items = filteredCards.map(card => cardContent[card.id]);

	const [prompt, maxItemIndex] = fitPrompt({
		prefix: 'Below is a collection of cards. Create a succinct but comprehensive summary of all cards that is no longer than 8 sentences. The summary should combine similar insights but keep distinctive insights where possible.\n\nCards:',
		suffix: 'Summary:\n',
		items
	});

	const ids = filteredCards.slice(0,maxItemIndex).map(card => card.id);

	console.log('Asking AI assistant. Depending on how recently you ran it this might take some time to warmup.');

	console.log('Prompt (' + (USE_CHAT ? 'Completion' : 'Chat') + ')\n',prompt);

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

const showAIError : AppActionCreator = (err : FunctionsError) => async (dispatch) => {
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
	const description = new CollectionDescription(EVERYTHING_SET_NAME, [CARD_TYPE_CONTENT, limitConfigurableFilterText(count)], SORT_NAME_STARS);
	const collection = description.collection(selectCollectionConstructorArguments(state));
	const titles = collection.sortedCards.map(card => card.title);
	return [...titles, ...FALLBACK_TITLES].slice(0,count);
};

export const titleForEditingCardWithAI : AppActionCreator = () => async (dispatch, getState) => {
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
	const body = innerTextForHTML(editingCard.body);

	if (!body) throw new Error('No body provided');

	dispatch(aiRequestStarted(AI_DIALOG_TYPE_SUGGEST_TITLE));

	let prompt = 'The following is a short essay: ' + CARD_SEPARATOR + body + CARD_SEPARATOR;
	prompt += 'Here are examples of good titles of other essays:' + CARD_SEPARATOR + selectGoodTitles(state).join('\n') + CARD_SEPARATOR;
	prompt += 'Append 5 suggested titles for this essay. Each should be a pithy, clever summary that includes a verb in 35 characters or less. Put one title on each line.';

	try {
		const result = await completion(prompt, uid, USE_CHAT);
		dispatch(aiResult(result.split('\n')));
	} catch(err) {
		dispatch(showAIError(err));
	}
};

export const summarizeCardsWithAI : AppActionCreator = () => async (dispatch, getState) => {
	const state = getState();
	const mayUseAI = selectUserMayUseAI(state);
	if (!mayUseAI) {
		throw new Error('User does not have permission to use AI');
	}
	const uid = selectUid(state);
	const cards = selectActiveCollectionCards(state);
	dispatch(aiRequestStarted(AI_DIALOG_TYPE_CARD_SUMMARY));
	const [prompt, ids] = cardsAISummaryPrompt(cards);
	dispatch({
		type: AI_SET_ACTIVE_CARDS,
		allCards: cards.map(card => card.id),
		filteredCards: ids
	});
	let result = '';
	try {
		result = await completion(prompt, uid, USE_CHAT);
		dispatch(aiResult(result));
	} catch(err) {
		dispatch(showAIError(err));
	}

};

export const AI_DIALOG_TYPE_CONFIGURATION : {[key in AIDialogType] : AIDialogTypeConfiguration} = {
	[AI_DIALOG_TYPE_CARD_SUMMARY]: {
		title: 'Summarize Cards',
		multiResult: false,
	},
	[AI_DIALOG_TYPE_SUGGEST_TITLE]: {
		title: 'Suggest Title',
		multiResult: true,
		commitAction: commitTitleSuggestion,
		rerunAction: titleForEditingCardWithAI
	}
};

const aiRequestStarted = (kind : AIDialogType) : AnyAction => {
	return {
		type: AI_REQUEST_STARTED,
		kind
	};
};

const aiResult = (result : string | string[]) : AnyAction => {
	if (typeof result == 'string') result = [result];
	return {
		type: AI_RESULT,
		result
	};
};

export const aiSelectResultIndex : AppActionCreator = (index : number) => (dispatch, getState) => {
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

export const closeAIDialog : AppActionCreator = (commit : boolean) => (dispatch, getState) => {
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
import {
	AppActionCreator
} from '../store.js';

import {
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
	selectActiveCollectionCards,
	selectUid
} from '../selectors.js';

import {
	cardPlainContent
} from '../util.js';

import {
	Card,
	Uid
} from '../types.js';

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

const fitPrompt = (args: FitPromptArguments) : string => {
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
	return result;
};

const cardsAISummary = async (cards : Card[], uid : Uid) : Promise<string> => {
	const items = cards.map(card => cardPlainContent(card)).filter(content => content);

	const prompt = fitPrompt({
		prefix: 'Below is a collection of cards. Create a succinct but comprehensive summary of all cards that is no longer than 8 sentences. The summary should combine similar insights but keep distinctive insights where possible.\n\nCards:',
		suffix: 'Summary:\n',
		items
	});

	console.log('Asking AI assistant. Depending on how recently you ran it this might take some time to warmup.');

	console.log('Prompt (' + (USE_CHAT ? 'Completion' : 'Chat') + ')\n',prompt);

	return await completion(prompt, uid, USE_CHAT);
};

export const startAIAssistant : AppActionCreator = () => async (_, getState) => {
	const state = getState();
	const uid = selectUid(state);
	const cards = selectActiveCollectionCards(state);
	console.log(await cardsAISummary(cards, uid));
};
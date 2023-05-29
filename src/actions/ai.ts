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
	Card
} from '../types.js';

const openaiCallable = httpsCallable(functions, 'openai');

type OpenAIRemoteCallCreateCompletion = {
	endpoint: 'createCompletion',
	payload: CreateCompletionRequest
};

type OpenAIRemoteCall = OpenAIRemoteCallCreateCompletion;

type OpenAIRemoteResult = CreateCompletionResponse;


class OpenAIProxy {
	createCompletion(request : CreateCompletionRequest) : Promise<CreateCompletionResponse> {
		return this._bridge({
			endpoint: 'createCompletion',
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

const cardsAISummary = async (cards : Card[]) : Promise<string> => {
	const content = cards.map(card => cardPlainContent(card)).filter(content => content).join(CARD_SEPARATOR);
	//TODO: actually do something
	console.log(content);
	return content;
};

export const startAIAssistant : AppActionCreator = () => async (_, getState) => {
	const state = getState();
	const uid = selectUid(state);
	const cards = selectActiveCollectionCards(state);
	//TODO: use the result;
	await cardsAISummary(cards);
	console.log('Starting AI Assistant. If this is the first time it can take awhile...');
	let result = null;
	try {
		result = await openai.createCompletion({
			model: 'text-davinci-003',
			prompt: 'Generate a clever but also strategic limerick about doorbells in the jungle',
			max_tokens: 2048,
			user: uid
		});
	} catch(err) {
		console.warn('Error:', err);
		return;
	}
	console.log(result);
};
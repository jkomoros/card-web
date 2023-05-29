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

export const startAIAssistant : AppActionCreator = () => async () => {
	console.log('Starting AI Assistant. If this is the first time it can take awhile...');
	let result = null;
	try {
		//TODO: fix the error from hitting the endpoint (500)
		result = await openai.createCompletion({
			model: 'text-davinci-003',
			prompt: 'Generate a clever but also strategic limerick about doorbells in the jungle'
		});
	} catch(err) {
		console.warn('Error:', err);
		return;
	}
	alert(result);
};
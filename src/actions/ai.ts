import {
	AppActionCreator
} from '../store.js';

import {
	HttpsCallableResult,
	httpsCallable
} from 'firebase/functions';

import {
	functions
} from '../firebase.js';

import {
	CreateCompletionRequest
} from 'openai';

const openaiCallable = httpsCallable(functions, 'openai');

type OpenAIRemoteCallCreateCompletion = {
	endpoint: 'createCompletion',
	payload: CreateCompletionRequest
};

type OpenAIRemoteCall = OpenAIRemoteCallCreateCompletion;


class OpenAIProxy {
	createCompletion(request : CreateCompletionRequest) {
		return this._bridge({
			endpoint: 'createCompletion',
			payload: request
		});
	}

	_bridge(data: OpenAIRemoteCall): Promise<HttpsCallableResult<unknown>> {
		//TODO: unwrap the HTTPSCallableResult before returning
		return openaiCallable(data);
	}
}

const openai = new OpenAIProxy();

export const startAIAssistant : AppActionCreator = () => async () => {
	console.log('Starting AI Assistant. If this is the first time it can take awhile...');
	let result = null;
	try {
		//TODO: fix the error from hitting the endpoint (500)
		result = await openai.createCompletion({
			model: 'text-davinci-003'
		});
	} catch(err) {
		console.warn('Error:', err);
		return;
	}
	alert(result);
};
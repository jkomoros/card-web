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
	CreateCompletionRequest
} from 'openai';

const openaiCallable = httpsCallable(functions, 'openai');

type OpenAIRemoteCallCreateCompletion = {
	endpoint: 'createCompletion',
	payload: CreateCompletionRequest
};

type OpenAIRemoteCall = OpenAIRemoteCallCreateCompletion;

const openaiRemoteBridge = async (data : OpenAIRemoteCall) : Promise<null> => {
	await openaiCallable(data);
	return null;
};

export const startAIAssistant : AppActionCreator = () => async () => {
	console.log('Starting AI Assistant. If this is the first time it can take awhile...');
	let result = null;
	try {
		result = await openaiRemoteBridge({
			endpoint: 'createCompletion',
			payload: {
				model: 'text-davinci-003'
			}
		});
	} catch(err) {
		console.warn('Error:', err);
		return;
	}
	alert(result);
};
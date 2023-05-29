import {
	AppActionCreator
} from '../store.js';

import {
	httpsCallable
} from 'firebase/functions';

import {
	functions
} from '../firebase.js';

const openaiCallable = httpsCallable(functions, 'openai');

const openaiRemote = async () : Promise<null> => {
	//TODO: allow passing an endpoint and payload type of the right shape (a keyed union)
	await openaiCallable({
		endpoint: 'createCompletion',
		payload: {}
	});
	return null;
};

export const startAIAssistant : AppActionCreator = () => async () => {
	console.log('Starting AI Assistant. If this is the first time it can take awhile...');
	let result = null;
	try {
		result = await openaiRemote();
	} catch(err) {
		console.warn('Error:', err);
		return;
	}
	alert(result);
};
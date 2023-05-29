import {
	AppActionCreator
} from '../store';

import {
	openaiRemote
} from './database';

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
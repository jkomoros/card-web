import {
	CallableRequest
} from 'firebase-functions/v2/https';

import {
	CreateChatRequestData,
	CreateChatResponseData
} from '../../shared/types.js';

import {
	throwIfUserMayNotUseAI
} from './common.js';

export const createChat = async (request : CallableRequest<CreateChatRequestData>) : Promise<CreateChatResponseData> => {
	const { auth } = request;

	if (!auth || !auth.uid) {
		throw new Error('Unauthorized request');
	}

	try {
		await throwIfUserMayNotUseAI(request);
	} catch(err) {
		return {
			success: false,
			error: String(err)
		};
	}

	//TODO: confirm the model is valid.

	//TOOD: actually create the thread.

	return { 
		success: false,
		error: 'Not yet implemented'
	};
};
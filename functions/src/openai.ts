import OpenAI from 'openai';

import {
	OPENAI_API_KEY,
	userPermissions
} from './common.js';

import {
	UserPermissions
} from './types.js';

import {
	CallableRequest,
	HttpsError
} from 'firebase-functions/v2/https';

export const openai_endpoint = OPENAI_API_KEY ? new OpenAI({
	apiKey: OPENAI_API_KEY,
}) : null;

//The server-side analogue of selectUserMayUseAI
const mayUseAI = (permissions : UserPermissions | null) => {
	if (!permissions) return false;
	if (permissions.admin) return true;
	if (permissions.remoteAI) return true;
	//TODO: also allow it if the ai permission is true.
	return false;
};

type OpenAIData = {
	endpoint: 'chat.completions.create',
	payload: OpenAI.Chat.ChatCompletionCreateParams
};

export const throwIfUserMayNotUseAI = async (request : CallableRequest<unknown>) : Promise<void> => {
	if (!request.auth) {
		throw new HttpsError('unauthenticated', 'A valid user authentication must be passed');
	}

	const permissions = await userPermissions(request.auth.uid);

	if (!mayUseAI(permissions)) {
		throw new HttpsError('permission-denied', 'The user does not have adequate permissions to perrform this action');
	}
};

//data should have endpoint and payload
export const handler = async (request : CallableRequest<OpenAIData>) => {

	const data = request.data;

	if (!openai_endpoint) {
		throw new HttpsError('failed-precondition', 'OPENAI_API_KEY not set');
	}

	await throwIfUserMayNotUseAI(request);

	if (!data || typeof data !== 'object') {
		throw new HttpsError('invalid-argument', 'data must be an object');
	}

	if (!data.endpoint) {
		throw new HttpsError('invalid-argument', 'endpoint must be provided');
	}

	if (!data.payload) {
		throw new HttpsError('invalid-argument', 'payload must be provided');
	}

	if (data.endpoint != 'chat.completions.create') {
		throw new HttpsError('invalid-argument', 'endpoint must be set to an allowed endpoint type');
	}

	try {
		const result = await openai_endpoint.chat.completions.create(data.payload);
		return result;
	} catch(err) {
		if (!err || typeof err != 'object') throw new HttpsError('unknown', String(err));
		//err is either an err.response.statusText/status or err.message
		if ('response' in err) {
			const response = err.response as {statusText: string, status: number};
			throw new HttpsError('unknown', response.statusText, {
				status: response.status,
				statusText: response.statusText
			});
		}
		const errAsError = err as Error;
		throw new HttpsError('unknown', errAsError.message);
	}
};
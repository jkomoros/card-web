import * as functions from 'firebase-functions';

import {
	Configuration,
	OpenAIApi
} from 'openai';

import {
	OPENAI_API_KEY,
	userPermissions
} from './common.js';

import {
	UserPermissions
} from './types.js';

import {
	CallableRequest
} from 'firebase-functions/v2/https';

export const openai_endpoint = OPENAI_API_KEY ? new OpenAIApi(new Configuration({
	apiKey: OPENAI_API_KEY,
})) : null;

//The server-side analogue of selectUserMayUseAI
const mayUseAI = (permissions : UserPermissions | null) => {
	if (!permissions) return false;
	if (permissions.admin) return true;
	if (permissions.remoteAI) return true;
	//TODO: also allow it if the ai permission is true.
	return false;
};

const ALLOWED_ENDPOINTS = {
	'createCompletion': true,
	'createChatCompletion': true
};

type OpenAIData = {
	endpoint: keyof (typeof ALLOWED_ENDPOINTS)
	payload: unknown
};

//data should have endpoint and payload
export const handler = async (request : CallableRequest<OpenAIData>) => {

	const data = request.data;

	if (!openai_endpoint) {
		throw new functions.https.HttpsError('failed-precondition', 'OPENAI_API_KEY not set');
	}

	if (!request.auth) {
		throw new functions.https.HttpsError('unauthenticated', 'A valid user authentication must be passed');
	}

	const permissions = await userPermissions(request.auth.uid);

	if (!mayUseAI(permissions)) {
		throw new functions.https.HttpsError('permission-denied', 'The user does not have adequate permissions to perrform this action');
	}

	if (!data || typeof data !== 'object') {
		throw new functions.https.HttpsError('invalid-argument', 'data must be an object');
	}

	if (!data.endpoint) {
		throw new functions.https.HttpsError('invalid-argument', 'endpoint must be provided');
	}

	if (!data.payload) {
		throw new functions.https.HttpsError('invalid-argument', 'payload must be provided');
	}

	if (!ALLOWED_ENDPOINTS[data.endpoint]) {
		throw new functions.https.HttpsError('invalid-argument', 'endpoint must be set to an allowed endpoint type');
	}

	try {
		//eslint-disable-next-line @typescript-eslint/no-explicit-any
		const result = await openai_endpoint[data.endpoint](data.payload as any);
		return result.data;
	} catch(err) {
		if (!err || typeof err != 'object') throw new functions.https.HttpsError('unknown', String(err));
		//err is either an err.response.statusText/status or err.message
		if ('response' in err) {
			const response = err.response as {statusText: string, status: number};
			throw new functions.https.HttpsError('unknown', response.statusText, {
				status: response.status,
				statusText: response.statusText
			});
		}
		const errAsError = err as Error;
		throw new functions.https.HttpsError('unknown', errAsError.message);
	}
};
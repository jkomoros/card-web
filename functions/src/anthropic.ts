import Anthropic from '@anthropic-ai/sdk';

import {
	ANTHROPIC_API_KEY,
	throwIfUserMayNotUseAI
} from './common.js';

import {
	CallableRequest,
	HttpsError
} from 'firebase-functions/v2/https';

import {
	AnthropicModelName
} from './types.js';

import {
	AssistantThread
} from '../../shared/types.js';

export const anthropic_endpoint = ANTHROPIC_API_KEY ? new Anthropic({
	apiKey: ANTHROPIC_API_KEY,
}) : null;

type AnthropicData = {
	endpoint: 'messages.create',
	payload: Anthropic.Messages.MessageCreateParams
};

//data should have endpoint and payload
export const handler = async (request : CallableRequest<AnthropicData>) => {

	const data = request.data;

	if (!anthropic_endpoint) {
		throw new HttpsError('failed-precondition', 'ANTHROPIC_API_KEY not set');
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

	if (data.endpoint != 'messages.create') {
		throw new HttpsError('invalid-argument', 'endpoint must be set to an allowed endpoint type');
	}

	try {
		const result = await anthropic_endpoint.messages.create(data.payload);
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

export const assistantMessageForThreadAnthropic = async (_model : AnthropicModelName, _thread : AssistantThread) : Promise<string> => {
	throw new Error('assistantMessageForThreadAnthropic is not implemented yet');
};
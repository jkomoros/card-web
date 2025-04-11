import OpenAI from 'openai';

import {
	OPENAI_API_KEY,
	throwIfUserMayNotUseAI
} from './common.js';

import {
	CallableRequest,
	HttpsError
} from 'firebase-functions/v2/https';

import {
	OpenAIModelName
} from './types.js';

import {
	AssistantThread
} from '../../shared/types.js';

export const openai_endpoint = OPENAI_API_KEY ? new OpenAI({
	apiKey: OPENAI_API_KEY,
}) : null;

type OpenAIData = {
	endpoint: 'chat.completions.create',
	payload: OpenAI.Chat.ChatCompletionCreateParams
};

//data should have endpoint and payload
export const handler = async (request : CallableRequest<OpenAIData>) => {

	const data = request.data;

	if (!openai_endpoint) {
		throw new HttpsError('failed-precondition', 'OPENAI_API_KEY not set');
	}

	await throwIfUserMayNotUseAI(request.auth?.uid);

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

export const assistantMessageForThreadOpenAI = async (model : OpenAIModelName, thread : AssistantThread) : Promise<string> => {
	if (!openai_endpoint) {
		throw new HttpsError('failed-precondition', 'OPENAI_API_KEY not set');
	}
	const result = await openai_endpoint.chat.completions.create({
		model,
		messages: thread.system ? [{role: 'system', content: thread.system}, ...thread.messages] : thread.messages
	});

	if (!result.choices || !result.choices.length) {
		throw new HttpsError('unknown', 'No choices returned from OpenAI');
	}
	return result.choices[0].message.content || '';
};

export async function* assistantMessageForThreadOpenAIStreaming(model: OpenAIModelName, thread: AssistantThread): AsyncGenerator<string> {
	if (!openai_endpoint) {
		throw new HttpsError('failed-precondition', 'OPENAI_API_KEY not set');
	}

	const stream = await openai_endpoint.chat.completions.create({
		model,
		messages: thread.system ? [{role: 'system', content: thread.system}, ...thread.messages] : thread.messages,
		stream: true
	});

	for await (const chunk of stream) {
		const content = chunk.choices[0]?.delta?.content || '';
		if (content) {
			yield content;
		}
	}
}
import Anthropic from '@anthropic-ai/sdk';

import {
	ANTHROPIC_API_KEY,
	ENABLE_STREAMING,
	throwIfUserMayNotUseAI
} from './common.js';

import {
	CallableRequest,
	HttpsError
} from 'firebase-functions/v2/https';

import {
	AnthropicModelName,
	MessageStreamer
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

export const assistantMessageForThreadAnthropic = async (model : AnthropicModelName, thread : AssistantThread, streamer? : MessageStreamer) : Promise<string> => {
	if (!anthropic_endpoint) {
		throw new HttpsError('failed-precondition', 'ANTHROPIC_API_KEY not set');
	}

	if (streamer && ENABLE_STREAMING) {

		const stream = await anthropic_endpoint.messages.stream({
			model,
			system: thread.system ? thread.system : undefined,
			messages: thread.messages,
			max_tokens: 8192
		});

		let message = '';

		for await (const chunk of stream) {
			if (chunk.type === 'content_block_delta') {
				if (chunk.delta.type === 'text_delta') {
					const text = chunk.delta.text;
					message += text;
					await streamer.receiveChunk(text);
				}
			}
		}

		await streamer.finished();

		return message;
	}

	const result = await anthropic_endpoint.messages.create({
		model,
		system: thread.system ? thread.system : undefined,
		messages: thread.messages,
		max_tokens: 8192
	});

	if (!result || !result.content) {
		throw new HttpsError('unknown', 'No content returned from Anthropic');
	}
	
	if (result.content.length === 0) {
		throw new HttpsError('unknown', 'Empty content array returned from Anthropic');
	}

	// Extract text from content blocks
	const textContent = result.content
		.filter(block => block.type === 'text')
		.map(block => (block as {type: 'text', text: string}).text)
		.join('');
	
	//This can be removed once ENABLE_STREAMING is removed because it's always on.
	if (streamer) {
		await streamer.receiveChunk(textContent);
		await streamer.finished();
	}
	return textContent;
};
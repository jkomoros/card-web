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
	CreateCompletionRequest,
	CreateCompletionResponse
} from 'openai';

import {
	selectActiveCollectionCards,
	selectUid
} from '../selectors.js';

import {
	cardPlainContent
} from '../util.js';

import {
	Card,
	Uid
} from '../types.js';

const openaiCallable = httpsCallable(functions, 'openai');

type OpenAIRemoteCallCreateCompletion = {
	endpoint: 'createCompletion',
	payload: CreateCompletionRequest
};

type OpenAIRemoteCall = OpenAIRemoteCallCreateCompletion;

type OpenAIRemoteResult = CreateCompletionResponse;


class OpenAIProxy {
	createCompletion(request : CreateCompletionRequest) : Promise<CreateCompletionResponse> {
		return this._bridge({
			endpoint: 'createCompletion',
			payload: request
		});
	}

	async _bridge(data: OpenAIRemoteCall): Promise<OpenAIRemoteResult> {
		const result = await openaiCallable(data);
		//TODO: what if it's an error?
		return result.data as OpenAIRemoteResult;
	}
}

const openai = new OpenAIProxy();

const CARD_SEPARATOR = '\n-----\n';

const cardsAISummary = async (cards : Card[], uid : Uid) : Promise<string> => {
	const content = cards.map(card => cardPlainContent(card)).filter(content => content).join(CARD_SEPARATOR);
	const promptPreamble = 'Here is a collection of cards, separated by ' + CARD_SEPARATOR + '. Create a succinct but comprehensive summary of all cards that is no longer than 8 sentences. The summary should combine similar insights but keep distinctive insights where possible.\n\nCards:\n';

	//TODO: smarter clipping and clip at card boundaries.
	const clippedContent = content.slice(0, 2000);

	const prompt = promptPreamble + clippedContent + CARD_SEPARATOR + 'Summary:\n';

	console.log('Asking AI assistant. Depending on how recently you ran it this might take some time to warmup.');

	console.log('Prompt\n',prompt);

	const result = await openai.createCompletion({
		model: 'text-davinci-003',
		prompt: prompt + clippedContent,
		max_tokens: 2048,
		user: uid
	});

	return result.choices[0].text;
};

export const startAIAssistant : AppActionCreator = () => async (_, getState) => {
	const state = getState();
	const uid = selectUid(state);
	const cards = selectActiveCollectionCards(state);
	console.log(await cardsAISummary(cards, uid));
};
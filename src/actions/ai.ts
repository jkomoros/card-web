import {
	ThunkSomeAction
} from '../store.js';

import {
	FunctionsError,
	httpsCallable
} from 'firebase/functions';

import {
	functions
} from '../firebase.js';

import {
	CreateChatCompletionRequest,
	CreateChatCompletionResponse
} from 'openai';

import {
	selectAIDialogKind,
	selectAIResult,
	selectAIResultIndex,
	selectActiveCollectionCards,
	selectCollectionConstructorArguments,
	selectConcepts,
	selectEditingCard,
	selectIsEditing,
	selectUid,
	selectUserMayUseAI
} from '../selectors.js';

import {
	cardPlainContent,
	innerTextForHTML
} from '../util.js';

import {
	Card,
	CardID,
	Uid,
	AIDialogType,
	State,
	AIModelName,
	StringCardMap
} from '../types.js';

import {
	AI_DIALOG_TYPE_CARD_SUMMARY,
	AI_DIALOG_TYPE_MISSING_CONCEPTS,
	AI_DIALOG_TYPE_SUGGEST_TITLE,
	CARD_TYPE_CONTENT,
	EVERYTHING_SET_NAME,
	SORT_NAME_STARS,
	TEXT_FIELD_TITLE
} from '../type_constants.js';

import {
	textFieldUpdated
} from './editor.js';

import {
	CollectionDescription
} from '../collection_description.js';

import {
	limitConfigurableFilterText
} from '../filters.js';

import {
	AI_DIALOG_CLOSE,
	AI_REQUEST_STARTED,
	AI_RESULT,
	AI_SELECT_RESULT_INDEX,
	AI_SET_ACTIVE_CARDS,
	AI_SHOW_ERROR,
	SomeAction
} from '../actions.js';

export type AIDialogTypeConfiguration = {
	title: string;
	resultType: 'text-block' | 'multi-line' | 'tag-list';
	commitAction? : () => ThunkSomeAction;
	//For prompts that give different results, a rerun action.
	rerunAction? : () => ThunkSomeAction;
};

const commitTitleSuggestion  = () : ThunkSomeAction => (dispatch, getState) => {
	const state = getState();
	const index = selectAIResultIndex(state);
	const result = selectAIResult(state);
	if (index < 0 || index >= result.length) throw new Error('Invalid index');
	const item = result[index];
	dispatch(textFieldUpdated(TEXT_FIELD_TITLE, item));
};

const openaiCallable = httpsCallable(functions, 'openai');

type OpenAIRemoteCallCreateChatCompletion = {
	endpoint: 'createChatCompletion',
	payload: CreateChatCompletionRequest
};

type OpenAIRemoteCall = OpenAIRemoteCallCreateChatCompletion;

type OpenAIRemoteResult = CreateChatCompletionResponse;

class OpenAIProxy {

	createChatCompletion(request: CreateChatCompletionRequest): Promise<CreateChatCompletionResponse> {
		return this._bridge({
			endpoint: 'createChatCompletion',
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

type modelInfo = {
	maxTokens: number
};

const MODEL_INFO : {[name in AIModelName]: modelInfo} = {
	'gpt-3.5-turbo': {
		maxTokens: 4096
	},
	'gpt-3.5-turbo-16k': {
		//According to https://platform.openai.com/docs/models/gpt-3-5
		maxTokens: 16384
	},
	'gpt-4': {
		maxTokens: 8192
	},
	'gpt-4-32k': {
		maxTokens: 32768
	}
};

const USE_HIGH_FIDELITY_MODEL = false;

const DEFAULT_HIGH_FIDELITY_MODEL = 'gpt-4';

export const DEFAULT_MODEL : AIModelName = USE_HIGH_FIDELITY_MODEL ? DEFAULT_HIGH_FIDELITY_MODEL : 'gpt-3.5-turbo';

//gpt-4-32k is limited access
const DEFAULT_LONG_MODEL : AIModelName = USE_HIGH_FIDELITY_MODEL ? DEFAULT_HIGH_FIDELITY_MODEL : 'gpt-3.5-turbo-16k';

const completion = async (prompt: string, uid: Uid, model: AIModelName = DEFAULT_MODEL) : Promise<string> => {
	const result = await openai.createChatCompletion({
		model,
		messages: [
			{
				role: 'user',
				content: prompt
			}
		],
		//maxTokens defaults to inf
		user: uid
	});
	return result.choices[0].message.content;
};

type FitPromptArguments = {
	prefix?: string,
	delimiter?: string,
	items?: string[],
	suffix?: string,
	maxTokenLength?: number
};

const DEFAULT_FIT_PROMPT : Required<FitPromptArguments> = {
	prefix: '',
	delimiter: CARD_SEPARATOR,
	items: [],
	suffix: '',
	maxTokenLength: 4000,
};

//NOTE: this downloads the tokenizer file if not already loaded, which is multiple MB.
const computeTokenCount = async (text : string | string[]) : Promise<number> => {
	//Note: the types are declared in src/gpt-tok.d.ts, which is set to not be visible in VSCode.
	const {default: module } = await import('gpt-tok');
	if (typeof text == 'string') text = [text];
	const counts = text.map(str => module.encode(str).length);
	return counts.reduce((a, b) => a + b, 0);
};

const fitPrompt = async (args: FitPromptArguments) : Promise<[prompt: string, maxItemIndex : number]> => {
	const options = {
		...DEFAULT_FIT_PROMPT,
		...args
	};
	const nonItemsTokenCount = await computeTokenCount([options.prefix, options.suffix, options.delimiter]);
	let itemsTokenCount = 0;
	let result = options.prefix + options.delimiter;
	let i = 0;
	while ((itemsTokenCount + nonItemsTokenCount) < options.maxTokenLength) {
		if (options.items.length <= i) break;
		const item = options.items[i];
		itemsTokenCount += await computeTokenCount([item, options.delimiter]);
		if ((itemsTokenCount + nonItemsTokenCount) >= options.maxTokenLength) break;
		result += item + options.delimiter;
		i++;
	}
	result += options.suffix;
	return [result, i];
};

const cardsAISummaryPrompt = async (cards : Card[], model : AIModelName) : Promise<[prompt : string, ids : CardID[]]> => {
	const cardContent = Object.fromEntries(cards.map(card => [card.id, cardPlainContent(card)]));
	const filteredCards = cards.filter(card => cardContent[card.id]);
	const items = filteredCards.map(card => cardContent[card.id]);

	const [prompt, maxItemIndex] = await fitPrompt({
		prefix: 'Below is a collection of cards. Create a succinct but comprehensive summary of all cards that is no longer than 8 sentences. The summary should combine similar insights but keep distinctive insights where possible.\n\nCards:',
		suffix: 'Summary:\n',
		items,
		maxTokenLength: MODEL_INFO[model].maxTokens
	});

	const ids = filteredCards.slice(0,maxItemIndex).map(card => card.id);

	console.log('Asking AI assistant. Depending on how recently you ran it this might take some time to warmup.');

	console.log('Prompt\n',prompt);

	return [prompt, ids];
};

const cardsAIConceptsPrompt = async (concepts: string[], cards : Card[], model : AIModelName) : Promise<[prompt : string, ids : CardID[]]> => {
	const cardContent = Object.fromEntries(cards.map(card => [card.id, cardPlainContent(card)]));
	const filteredCards = cards.filter(card => cardContent[card.id]);
	const items = filteredCards.map(card => cardContent[card.id]);

	const [prompt, maxItemIndex] = await fitPrompt({
		prefix: `Here is a collection of all concepts:\n\n${concepts.join(', ')}\n\nBelow is a collection of cards. Please suggest concepts that appear to be missing, prioritizing concepts that occur across multiple cards. Concepts should be text that comes directly from the card. Each concept should be just the concept itself, with no explanation. Return a JSON array.\n\nCards:`,
		suffix: 'Missing concepts:\n',
		items,
		maxTokenLength: MODEL_INFO[model].maxTokens
	});

	const ids = filteredCards.slice(0,maxItemIndex).map(card => card.id);

	console.log('Asking AI assistant. Depending on how recently you ran it this might take some time to warmup.');

	console.log('Prompt\n',prompt);

	return [prompt, ids];
};

type aiErrorDetails = {
	status: number;
	statusText: string;
}

const extractAIError = (err : FunctionsError) : string => {
	let message = String(err);
	if (err.name == 'FirebaseError') {
		if (err.details) {
			const details = err.details as aiErrorDetails;
			message = 'AI Endpoint Error: ' + details.status + ': ' + details.statusText;
		} else {
			message = err.message;
		}
	}
	return message;
};

const showAIError = (err : FunctionsError) : ThunkSomeAction => async (dispatch) => {
	dispatch({
		type: AI_SHOW_ERROR,
		error: extractAIError(err)
	});

};

const FALLBACK_TITLES = [
	'Make space for long-term thinking',
	'Good leaders have 1:1s that decrease stress',
	'Beware illustory consensus due to ill-defined terms',
	'Start by assuming there\'s no villain ',
	'Systems Theory is a powerful lens in complex spaces',
	'The power of asking “Why?”',
	'Focus on direction, not solution, in complex problem spaces',
	'In complex spaces, avoid collapsing the wave function early',
	'Prefer simpler models in uncertainty',
	'McNamara fallacy: What can\'t be measured doesn\'t matter'
];

//returns good examples of titles to emulate, assuming that highly-starred cards
//in this collection are the best ones.
const selectGoodTitles = (state : State, count = 20) : string[] => {
	//TODO: memoize
	const description = new CollectionDescription(EVERYTHING_SET_NAME, [CARD_TYPE_CONTENT, limitConfigurableFilterText(count)], SORT_NAME_STARS);
	const collection = description.collection(selectCollectionConstructorArguments(state));
	const titles = collection.sortedCards.map(card => card.title);
	return [...titles, ...FALLBACK_TITLES].slice(0,count);
};

export const titleForEditingCardWithAI = (count = 5) : ThunkSomeAction => async (dispatch, getState) => {
	const state = getState();
	const mayUseAI = selectUserMayUseAI(state);
	if (!mayUseAI) {
		throw new Error('User does not have permission to use AI');
	}
	if (!selectIsEditing(state)) {
		throw new Error('Not editing a card');
	}

	const uid = selectUid(state);

	const editingCard = selectEditingCard(state);
	const body = innerTextForHTML(editingCard.body);

	if (!body) throw new Error('No body provided');

	const model = DEFAULT_MODEL;

	dispatch(aiRequestStarted(AI_DIALOG_TYPE_SUGGEST_TITLE, model));

	let prompt = 'The following is a short essay: ' + CARD_SEPARATOR + body + CARD_SEPARATOR;
	prompt += 'Here are examples of good titles of other essays:' + CARD_SEPARATOR + selectGoodTitles(state).join('\n') + CARD_SEPARATOR;
	prompt += `Append ${count} suggested titles for this essay. Each should be a pithy, clever summary that includes a verb in 35 characters or less. Put one title on each line.`;

	try {
		const result = await completion(prompt, uid, model);
		//The prompt keeps on returning numbered results no matter how I tweak it, so just remove that.
		const lines = result.split('\n').map(str => str.replace(/^\d+\.\s*/, '').trim());
		dispatch(aiResult(lines));
	} catch(err) {
		dispatch(showAIError(err));
	}
};

export const summarizeCardsWithAI = () : ThunkSomeAction => async (dispatch, getState) => {
	const state = getState();
	const mayUseAI = selectUserMayUseAI(state);
	if (!mayUseAI) {
		throw new Error('User does not have permission to use AI');
	}
	const uid = selectUid(state);
	const cards = selectActiveCollectionCards(state);
	const model = DEFAULT_LONG_MODEL;
	dispatch(aiRequestStarted(AI_DIALOG_TYPE_CARD_SUMMARY, model));

	const [prompt, ids] = await cardsAISummaryPrompt(cards, model);
	dispatch({
		type: AI_SET_ACTIVE_CARDS,
		allCards: cards.map(card => card.id),
		filteredCards: ids
	});
	let result = '';
	try {
		result = await completion(prompt, uid, model);
		dispatch(aiResult(result));
	} catch(err) {
		dispatch(showAIError(err));
	}

};

//Takes the concept map and returns things like 'Coordination Headwind (AKA Herding Cats)'
const distilledConceptStrings = (reversedConcepts : StringCardMap) : string[] => {
	const concepts : {[concept : string] : string[]} = {};
	for (const [str, concept] of Object.entries(reversedConcepts)) {
		if (!concepts[concept]) concepts[concept] = [];
		concepts[concept].push(str);
	}
	const conceptStrings = Object.values(concepts).map(strs => {
		if (strs.length == 1) return strs[0];
		return strs[0] + ' (AKA ' + strs.slice(1).join(', ') + ')';
	});
	return conceptStrings;
};

export const missingConceptsWithAI = () : ThunkSomeAction => async (dispatch, getState) => {
	const state = getState();
	const mayUseAI = selectUserMayUseAI(state);
	if (!mayUseAI) {
		throw new Error('User does not have permission to use AI');
	}
	const uid = selectUid(state);
	const cards = selectActiveCollectionCards(state);
	const model = DEFAULT_HIGH_FIDELITY_MODEL;
	dispatch(aiRequestStarted(AI_DIALOG_TYPE_MISSING_CONCEPTS, model));

	const reversedConcepts = selectConcepts(state);
	const conceptStrings = distilledConceptStrings(reversedConcepts);
	const [prompt, ids] = await cardsAIConceptsPrompt(conceptStrings, cards, model);
	dispatch({
		type: AI_SET_ACTIVE_CARDS,
		allCards: cards.map(card => card.id),
		filteredCards: ids
	});
	let result = '';
	try {
		result = await completion(prompt, uid, model);
		const lines = JSON.parse(result);
		if (!Array.isArray(lines)) throw new Error('Not lines as expected');
		dispatch(aiResult(lines));
	} catch(err) {
		dispatch(showAIError(err));
	}

};

export const AI_DIALOG_TYPE_CONFIGURATION : {[key in AIDialogType] : AIDialogTypeConfiguration} = {
	[AI_DIALOG_TYPE_CARD_SUMMARY]: {
		title: 'Summarize Cards',
		resultType: 'text-block',
	},
	[AI_DIALOG_TYPE_SUGGEST_TITLE]: {
		title: 'Suggest Title',
		resultType: 'multi-line',
		commitAction: commitTitleSuggestion,
		rerunAction: titleForEditingCardWithAI
	},
	[AI_DIALOG_TYPE_MISSING_CONCEPTS]: {
		title: 'Missing Concepts',
		resultType: 'tag-list'
	}
};

const aiRequestStarted = (kind : AIDialogType, model: AIModelName) : SomeAction => {
	return {
		type: AI_REQUEST_STARTED,
		kind,
		model
	};
};

const aiResult = (result : string | string[]) : SomeAction => {
	if (typeof result == 'string') result = [result];
	return {
		type: AI_RESULT,
		result
	};
};

export const aiSelectResultIndex = (index : number) : ThunkSomeAction => (dispatch, getState) => {
	const result = selectAIResult(getState());
	if (index < 0) {
		index = -1;
	} else {
		if (index >= result.length) throw new Error('Invalid index');
	}
	dispatch({
		type: AI_SELECT_RESULT_INDEX,
		index
	});
};

export const closeAIDialog = (commit : boolean) : ThunkSomeAction => (dispatch, getState) => {
	dispatch({
		type: AI_DIALOG_CLOSE
	});

	if (commit) {
		const state = getState();
		const kind = selectAIDialogKind(state);
		const config = AI_DIALOG_TYPE_CONFIGURATION[kind];
		if (config.commitAction) dispatch(config.commitAction());
	}
};
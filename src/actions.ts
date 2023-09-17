import {
	AIDialogType,
	CardID
} from './types';

export const AI_REQUEST_STARTED = 'AI_REQUEST_STARTED';
export const AI_RESULT = 'AI_RESULT';
export const AI_SELECT_RESULT_INDEX = 'AI_SELECT_RESULT_INDEX';
export const AI_DIALOG_CLOSE = 'AI_DIALOG_CLOSE';
export const AI_SET_ACTIVE_CARDS = 'AI_SET_ACTIVE_CARDS';
export const AI_SHOW_ERROR = 'AI_SHOW_ERROR';

type ActionAIRequestStarted = {
	type: typeof AI_REQUEST_STARTED,
	kind: AIDialogType
};

type ActionAIResult = {
	type: typeof AI_RESULT,
	result: string | string[]
};

type ActionAISelectResultIndex = {
	type: typeof AI_SELECT_RESULT_INDEX,
	index: number
};

type ActionAIDialogClose = {
	type: typeof AI_DIALOG_CLOSE
};

type ActionAISetActiveCards = {
	type: typeof AI_SET_ACTIVE_CARDS,
	allCards: CardID[],
	filtererCards: CardID[]
};

type ActionAIShowError = {
	type: typeof AI_SHOW_ERROR,
	error: string
};

export type SomeAction = ActionAIRequestStarted
	| ActionAIResult
	| ActionAISelectResultIndex
	| ActionAIDialogClose
	| ActionAISetActiveCards
	| ActionAIShowError;
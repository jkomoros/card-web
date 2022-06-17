import {
	AnyAction
} from 'redux';

import {
	PROMPT_COMPOSE_SHOW,
	PROMPT_COMPOSE_CANCEL,
	PROMPT_COMPOSE_COMMIT,
	PROMPT_COMPOSE_UPDATE_CONTENT,
	PROMPT_CONFIGURE_ACTION,
} from '../actions/prompt.js';

import {
	PromptState
} from '../types.js';

import {
	COMMIT_ACTION_CONSOLE_LOG
} from '../type_constants.js';

const INITIAL_STATE : PromptState = {
	composeOpen: false,
	content: '',
	message: '',
	action: COMMIT_ACTION_CONSOLE_LOG,
	associatedId: '',
};

const app = (state : PromptState = INITIAL_STATE, action : AnyAction) : PromptState => {
	switch (action.type) {
	case PROMPT_COMPOSE_SHOW:
		return {
			...state,
			composeOpen: true,
			message: action.message,
			content: action.content,
		};
	case PROMPT_CONFIGURE_ACTION:
		return {
			...state,
			action: action.action,
			associatedId: action.associatedId,
		};
	case PROMPT_COMPOSE_CANCEL:
		return {
			...state,
			composeOpen: false
		};
	case PROMPT_COMPOSE_COMMIT: 
		return {
			...state,
			composeOpen: false
		};
	case PROMPT_COMPOSE_UPDATE_CONTENT: 
		return {
			...state,
			content: action.content
		};
	default:
		return state;
	}
};


export default app;
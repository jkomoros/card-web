import {
	AnyAction
} from 'redux';

import {
	AI_REQUEST_STARTED,
	AI_RESULT,
	AI_DIALOG_CLOSE,
} from '../actions/ai.js';

import {
	AIState
} from '../types.js';

const INITIAL_STATE : AIState = {
	open: false,
	active: false,
	result: ''
};

const app = (state : AIState = INITIAL_STATE, action : AnyAction) : AIState => {
	switch (action.type) {
	case AI_REQUEST_STARTED:
		return {
			...state,
			active: true,
			open: true
		};
	case AI_RESULT:
		return {
			...state,
			active: false,
			result: action.result
		};
	case AI_DIALOG_CLOSE:
		return {
			...state,
			open: false
		};
	default:
		return state;
	}
};

export default app;
import {
	AnyAction
} from 'redux';

import {
	AI_REQUEST_STARTED,
	AI_RESULT
} from '../actions/ai.js';

import {
	AIState
} from '../types.js';

const INITIAL_STATE : AIState = {
	active: false,
	result: ''
};

const app = (state : AIState = INITIAL_STATE, action : AnyAction) : AIState => {
	switch (action.type) {
	case AI_REQUEST_STARTED:
		return {
			...state,
			active: true
		};
	case AI_RESULT:
		return {
			...state,
			active: false,
			result: action.result
		};
	default:
		return state;
	}
};

export default app;
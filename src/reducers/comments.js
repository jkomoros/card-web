import { 
	COMMENTS_UPDATE_THREADS,
	COMMENTS_UPDATE_MESSAGES
} from '../actions/comments.js';

const INITIAL_STATE = {
	messages: {},
	threads: {},
};

const app = (state = INITIAL_STATE, action) => {
	switch (action.type) {
	case COMMENTS_UPDATE_MESSAGES: 
		return {
			...state,
			messages: {...state.messages, ...action.messages}
		};
	case COMMENTS_UPDATE_THREADS: 
		return {
			...state,
			threads: {...state.threads, ...action.threads}
		};
	default:
		return state;
	}
};

export default app;
import { 
	COMMENTS_UPDATE_THREADS,
	COMMENTS_UPDATE_MESSAGES
} from '../actions/comments.js';

import {
	CommentsState,
} from '../types.js';

const INITIAL_STATE : CommentsState = {
	messages: {},
	threads: {},
	messagesLoaded: false,
	threadsLoaded: false,
};

const app = (state : CommentsState = INITIAL_STATE, action) : CommentsState => {
	switch (action.type) {
	case COMMENTS_UPDATE_MESSAGES: 
		return {
			...state,
			messages: {...state.messages, ...action.messages},
			messagesLoaded: true,
		};
	case COMMENTS_UPDATE_THREADS: 
		return {
			...state,
			threads: {...state.threads, ...action.threads},
			threadsLoaded: true,
		};
	default:
		return state;
	}
};

export default app;
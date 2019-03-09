import { 
	COMMENTS_UPDATE_THREADS,
	COMMENTS_UPDATE_MESSAGES,
	COMMENTS_UPDATE_CARD_THREADS
} from '../actions/comments.js';

import {
	arrayUnion,
	arrayRemove
} from '../util.js';

const INITIAL_STATE = {
	messages: {},
	threads: {},
	card_threads: []
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
	case COMMENTS_UPDATE_CARD_THREADS:
		let newThreads = [];
		if (action.firstUpdate) {
			newThreads = [...action.threadsToAdd];
		} else {
			newThreads = arrayUnion(state.card_threads, action.threadsToAdd);
			newThreads = arrayRemove(newThreads, action.threadsToRemove);
		}
		return {
			...state,
			card_threads: newThreads
		};
	default:
		return state;
	}
};

export default app;
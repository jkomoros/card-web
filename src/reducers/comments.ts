import { 
	COMMENTS_UPDATE_THREADS,
	COMMENTS_UPDATE_MESSAGES
} from '../actions/comments.js';

import {
	CommentMessage,
	CommentMessageID,
	CommentThread,
	CommentThreadID
} from '../types.js';

type CommentsState = {
	messages: {[id : CommentMessageID]: CommentMessage},
	threads: {[id : CommentThreadID]: CommentThread},
	messagesLoaded: boolean,
	threadsLoaded: boolean,
}

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
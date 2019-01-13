import { 
	COMMENTS_UPDATE_THREADS,
	COMMENTS_UPDATE_MESSAGES,
	COMMENTS_UPDATE_CARD_THREADS
} from '../actions/comments.js';

import {
	arrayUnion,
	arrayRemove
} from '../util.js';

import {
	authorForId
} from './data.js';

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

export const composedThreadsSelector = state => {
	let result = [];
	for (let threadId of Object.values(state.comments.card_threads)) {
		let thread = composedThread(threadId, state); 
		//It's possible that the thread has been deleted
		if (thread) result.push(thread);
	}
	return result;

};

const composedThread = (threadId, state) => {
	let originalThread = state.comments.threads[threadId];
	if (!originalThread) return null;
	let thread = {...originalThread};
	let expandedMessages = [];
	for (let messageId of Object.values(thread.messages)) {
		let message = composedMessage(messageId, state);
		if (message) expandedMessages.push(message);
	}
	thread.messages = expandedMessages;
	thread.author = authorForId(state, originalThread.author);
	return thread;
};

const composedMessage = (messageId, state) => {
	//TODO: return composed children for threads if there are parents
	let originalMessage =  state.comments.messages[messageId];
	if (!originalMessage) return {};
	let message = {...originalMessage};
	message.author = authorForId(state, originalMessage.author);
	return message;
};

export default app;
import {
	selectPromptAction,
	selectPromptContent,
	selectPromptAssociatedId,
	getMessageById,
	getThreadById,
} from '../selectors.js';

import {
	editMessage,
	addMessage,
	createThread,
} from './comments.js';

import {
	CommentMessageID,
	CommentThreadID,
	CommitActionType,
	State
} from '../types.js';

import {
	AppThunkDispatch,
	ThunkSomeAction
} from '../store.js';

import {
	PROMPT_COMPOSE_CANCEL,
	PROMPT_COMPOSE_COMMIT,
	PROMPT_COMPOSE_SHOW,
	PROMPT_COMPOSE_UPDATE_CONTENT,
	PROMPT_CONFIGURE_ACTION,
	SomeAction
} from '../actions.js';

import {
	assertUnreachable
} from '../util.js';

export const configureCommitAction = (commitAction : CommitActionType, associatedId? : CommentMessageID | CommentThreadID) : SomeAction => {
	if (!associatedId) associatedId = '';
	return {
		type: PROMPT_CONFIGURE_ACTION,
		action: commitAction,
		associatedId,
	};
};

export const composeShow = (message : string, starterContent : string) : SomeAction => {
	if (!starterContent) starterContent = '';
	return {
		type: PROMPT_COMPOSE_SHOW,
		message: message,
		content: starterContent,
	};
};

export const composeCancel = () : SomeAction => {
	return {
		type: PROMPT_COMPOSE_CANCEL
	};
};

export const composeCommit = () : ThunkSomeAction => (dispatch, getState) => {

	const state = getState();

	dispatch({
		type: PROMPT_COMPOSE_COMMIT
	});

	doAction(dispatch, state, selectPromptAction(state), selectPromptContent(state), selectPromptAssociatedId(state));

};

export const composeUpdateContent = (content : string) : SomeAction => {
	return {
		type: PROMPT_COMPOSE_UPDATE_CONTENT,
		content
	};
};


//TODO: use functionOverloading on expected types
const doAction = (dispatch : AppThunkDispatch, state : State, action : CommitActionType, content? : string, associatedId? : CommentMessageID | CommentThreadID) => {
	if (!action) return;
	switch (action) {
	case 'CONSOLE_LOG':
		console.log(content, associatedId);
		return;
	case 'EDIT_MESSAGE':
		const message = getMessageById(state, associatedId);
		dispatch(editMessage(message, content));
		return;
	case 'ADD_MESSAGE':
		const thread = getThreadById(state, associatedId);
		dispatch(addMessage(thread, content));
		return;
	case 'CREATE_THREAD':
		dispatch(createThread(content));
		return;
	default:
		assertUnreachable(action);
	}
	console.warn('Unknown action: ' + action);
};
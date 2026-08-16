import {
	selectPromptAction,
	selectPromptContent,
	selectPromptMessage,
	selectPromptAssociatedId,
	getMessageById,
	getThreadById,
	selectAIModel,
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
} from '../../shared/util.js';

import {
	createChatWithCurentCollection
} from './chat.js';

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

export const composeCommit = () : ThunkSomeAction => async (dispatch, getState) => {

	const state = getState();

	//Capture BEFORE the commit action clears it. Posting, editing and deleting
	//a comment all go through the durable aux-write queue now, so a write that
	//cannot reach the server is retained and replayed rather than lost — but
	//the queue can still DISCARD one permanently (a conflicting edit, a message
	//that no longer exists), and those reject. This restore is what hands the
	//user their words back in that case. Clearing the box first and firing the
	//write afterwards meant the text vanished with the UI having accepted it.
	const message = selectPromptMessage(state);
	const content = selectPromptContent(state);
	const action = selectPromptAction(state);
	const associatedId = selectPromptAssociatedId(state);

	dispatch({
		type: PROMPT_COMPOSE_COMMIT
	});

	try {
		await doAction(dispatch, state, action, content, associatedId);
	} catch (err) {
		//Give the text back rather than dropping it. The user can retry or copy
		//it out; either beats silent loss.
		dispatch(composeShow(message, content));
		alert(`That couldn't be saved, so your text has been restored: ${err instanceof Error ? err.message : String(err)}`);
	}

};

export const composeUpdateContent = (content : string) : SomeAction => {
	return {
		type: PROMPT_COMPOSE_UPDATE_CONTENT,
		content
	};
};


//TODO: use functionOverloading on expected types
const doAction = async (dispatch : AppThunkDispatch, state : State, action : CommitActionType, content = '', associatedId? : CommentMessageID | CommentThreadID) : Promise<void> => {
	if (!action) return;
	switch (action) {
	case 'CONSOLE_LOG':
		console.log(content, associatedId);
		return;
	case 'EDIT_MESSAGE':
		if (!associatedId) throw new Error('No associated ID');
		const message = getMessageById(state, associatedId);
		if (!message) throw new Error('No message');
		await dispatch(editMessage(message, content));
		return;
	case 'ADD_MESSAGE':
		if (!associatedId) throw new Error('No associated ID');
		const thread = getThreadById(state, associatedId);
		if (!thread) throw new Error('No thread');
		await dispatch(addMessage(thread, content));
		return;
	case 'CREATE_THREAD':
		await dispatch(createThread(content));
		return;
	case 'CREATE_CHAT':
		dispatch(createChatWithCurentCollection(content, selectAIModel(state)));
		return;
	default:
		assertUnreachable(action);
	}
	console.warn('Unknown action: ' + action);
};
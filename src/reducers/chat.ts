import { 
	CHAT_UPDATE_CHATS,
	CHAT_UPDATE_MESSAGES,
	SomeAction
} from '../actions.js';

import {
	ChatState,
} from '../types.js';

const INITIAL_STATE : ChatState = {
	chats: {},
	messages: {},
};

const app = (state : ChatState = INITIAL_STATE, action : SomeAction) : ChatState => {
	switch (action.type) {
	case CHAT_UPDATE_MESSAGES: 
		return {
			...state,
			messages: {...state.messages, ...action.messages},
		};
	case CHAT_UPDATE_CHATS: 
		return {
			...state,
			chats: {...state.chats, ...action.chats},
		};
	default:
		return state;
	}
};

export default app;
import { 
	CHAT_SEND_MESSAGE,
	CHAT_SEND_MESSAGE_SUCCESS,
	CHAT_UPDATE_CHATS,
	CHAT_UPDATE_COMPOSING_MESSAGE,
	CHAT_UPDATE_CURRENT_CHAT,
	CHAT_UPDATE_MESSAGES,
	SomeAction
} from '../actions.js';

import {
	ChatState,
} from '../types.js';

const INITIAL_STATE : ChatState = {
	currentChat: '',
	chats: {},
	messages: {},
	composingMessage: '',
	sending: false,
	sendFailure: null
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
	case CHAT_UPDATE_CURRENT_CHAT:
		return {
			...state,
			currentChat: action.currentChat,
		};
	case CHAT_SEND_MESSAGE:
		return {
			...state,
			sending: true,
		};
	case CHAT_SEND_MESSAGE_SUCCESS:
		return {
			...state,
			sending: false,
			sendFailure: null,
			composingMessage: ''
		};
	case CHAT_UPDATE_COMPOSING_MESSAGE:
		return {
			...state,
			composingMessage: action.composingMessage
		};
	default:
		return state;
	}
};

export default app;
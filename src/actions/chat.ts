import {
	httpsCallable
} from 'firebase/functions';

import {
	selectActiveCollection,
	selectActiveCollectionCards,
	selectChats,
	selectCurrentChatID,
	selectCurrentComposedChat,
	selectUid,
	selectUserMayChatInCurrentChat,
	selectUserMayUseAI,
	selectUserMayViewApp
} from '../selectors';

import {
	store,
	ThunkSomeAction
} from '../store';

import {
	ChatMessages,
	Chats,
	State
} from '../types';

import {
	db,
	functions
} from '../firebase.js';

import {
	AIModelName,
	CardID,
	Chat,
	ChatID,
	ChatMessage,
	CreateChatRequestData,
	CreateChatResponseData,
	PostMessageInChaResponseData,
	PostMessageInChatRequestData,
} from '../../shared/types.js';

import {
	navigatePathTo,
	PAGE_CHAT
} from './app.js';

import {
	CHAT_EXPECT_CHAT_MESSAGES,
	CHAT_EXPECT_CHATS,
	CHAT_SEND_MESSAGE,
	CHAT_SEND_MESSAGE_FAILURE,
	CHAT_SEND_MESSAGE_SUCCESS,
	CHAT_UPDATE_CHATS,
	CHAT_UPDATE_COMPOSING_MESSAGE,
	CHAT_UPDATE_CURRENT_CHAT,
	CHAT_UPDATE_MESSAGES,
	SomeAction
} from '../actions';

import {
	CHAT_MESSAGES_COLLECTION,
	CHATS_COLLECTION
} from '../../shared/collection-constants';

import {
	collection,
	doc,
	DocumentData,
	onSnapshot,
	query,
	QuerySnapshot,
	Unsubscribe,
	updateDoc,
	where
} from 'firebase/firestore';

import {
	composeShow,
	configureCommitAction
} from './prompt.js';

// Default model to use for chats
const DEFAULT_MODEL: AIModelName = 'claude-3-7-sonnet-latest';

// Default background length
const DEFAULT_BACKGROUND_PERCENTAGE = 0.8;

const createChatCallable = httpsCallable<CreateChatRequestData, CreateChatResponseData>(functions, 'createChat');
const postMessageInChatCallable = httpsCallable<PostMessageInChatRequestData, PostMessageInChaResponseData>(functions, 'postMessageInChat');

export const showCreateChatPrompt = () : ThunkSomeAction => (dispatch) => {
	dispatch(configureCommitAction('CREATE_CHAT'));
	dispatch(composeShow('What would you like to ask about these cards?', ''));
};

export const createChatWithCurentCollection = (initialMessage : string): ThunkSomeAction => async (dispatch, getState) => {
	const state = getState() as State;
	
	if (!initialMessage) {
		console.warn('No initial message provided');
		return;
	}

	const mayUseAI = selectUserMayUseAI(state);
	if (!mayUseAI) {
		console.warn('User does not have permission to use AI');
		return;
	}
	
	const uid = selectUid(state);
	if (!uid) {
		console.warn('User is not logged in');
		return;
	}
	
	const collection = selectActiveCollection(state);

	if (!collection) {
		console.warn('No active collection found');
		return;
	}

	const cards = selectActiveCollectionCards(state);
	const cardIDs: CardID[] = cards.map(card => card.id);
	
	const model = DEFAULT_MODEL;

	try {
		const result = await createChatCallable({
			owner: uid,
			cards: cardIDs,
			initialMessage,
			backgroundPercentage: DEFAULT_BACKGROUND_PERCENTAGE,
			model,
			collection: {
				description: collection.description.serialize(),
				configuration: collection.description.configuration
			}
		});
		
		const data = result.data;
		if (data.success) {
			// Navigate to the new chat
			dispatch(navigatePathTo(`/${PAGE_CHAT}/${data.chat}`));
		} else {
			console.error('Failed to create chat:', data.error);
		}
	} catch (err) {
		console.error('Error creating chat:', err);
	}
};

export const postMessageInCurrentChat = (message : string) : ThunkSomeAction => async (dispatch, getState) => {
	const state = getState() as State;
	
	const mayChat = selectUserMayChatInCurrentChat(state);

	if (!mayChat) {
		console.warn('User does not have permission to chat in this chat');
		return;
	}
	if (!message) {
		console.warn('No message provided');
		return;
	}

	const chatID = selectCurrentChatID(state);

	dispatch({
		type: CHAT_SEND_MESSAGE
	});

	try {
		const result = await postMessageInChatCallable({
			chat: chatID,
			message
		});
		
		const data = result.data;
		if (!data.success) {
			console.error('Failed to post message:', data.error);
			dispatch({
				type: CHAT_SEND_MESSAGE_FAILURE,
				error: new Error(data.error)
			});
			return;
		}
		dispatch({
			type: CHAT_SEND_MESSAGE_SUCCESS
		});
	} catch (err) {
		console.error('Error posting message:', err);
		dispatch({
			type: CHAT_SEND_MESSAGE_FAILURE,
			error: err
		});
	}

};

const receiveChats = (snapshot: QuerySnapshot<DocumentData, DocumentData>) => {

	const chats : Chats = {};

	snapshot.docChanges().forEach(change => {
		if (change.type === 'removed') return;
		const doc = change.doc;
		const id = doc.id;
		const chat = {...doc.data(), id} as Chat;
		chats[id] = chat;
	});

	store.dispatch(updateChats(chats));

};

export const connectLiveOwnedChats = () => {
	const state = store.getState() as State;
	if (!selectUserMayViewApp(state)) {
		console.log('User does not have permission to view app');
		return;
	}
	const uid = selectUid(state);
	if (!uid) {
		console.warn('User is not logged in');
		return;
	}
	onSnapshot(query(collection(db, CHATS_COLLECTION), where('owner', '==', uid)), receiveChats);
};

const chatMessageUnsubscribes = new Map<ChatID, Unsubscribe>();

export const connectLiveChat = (id : ChatID) => {
	const state = store.getState() as State;
	if (!selectUserMayViewApp(state)) return;
	const uid = selectUid(state);
	if (!uid) return;

	const existingChats = selectChats(state);

	if (!existingChats[id]) { 
		//TODO: should this be a ThunkActionCreator since we're using store?
		store.dispatch({type: CHAT_EXPECT_CHATS});
		//We don't yet have the primary chat, so download it.
		//If it were a chat we owned, we would have already downloaded it.
		//So that must mean it's a published chat that we don't own.
		//We explictly check that we don't own it to make sure it passes firestore security rules.
		onSnapshot(query(collection(db, CHATS_COLLECTION), where('id', '==', id), where('published', '==', true), where('owner','!=', uid)), receiveChats);
	}

	//Install a listener for the chat messages if we don't already have one.
	//We could already have it if we have already visited this chat before in this session.
	if (!chatMessageUnsubscribes.has(id)) {
		store.dispatch({type: CHAT_EXPECT_CHAT_MESSAGES});
		const unsubscribe = onSnapshot(query(collection(db, CHAT_MESSAGES_COLLECTION), where('chat', '==', id), where('role', '!=', 'system')), snapshot => {
			const messages : ChatMessages = {};

			snapshot.docChanges().forEach(change => {
				if (change.type === 'removed') return;
				const doc = change.doc;
				const id = doc.id;
				const message = {...doc.data(), id} as ChatMessage;
				messages[id] = message;
			});

			store.dispatch(updateChatMessages(messages));

		});

		chatMessageUnsubscribes.set(id, unsubscribe);
	}
};

export const updateChats = (chats : Chats) : ThunkSomeAction => (dispatch) => {
	dispatch({
		type: CHAT_UPDATE_CHATS,
		chats
	});
};

export const updateChatMessages = (messages : ChatMessages) : ThunkSomeAction => (dispatch) => {
	dispatch({
		type: CHAT_UPDATE_MESSAGES,
		messages
	});
};

export const updateCurrentChat = (id: ChatID) : SomeAction => ({
	type: CHAT_UPDATE_CURRENT_CHAT,
	currentChat: id
});

export const updateComposingMessage = (message: string) : SomeAction => ({
	type: CHAT_UPDATE_COMPOSING_MESSAGE,
	composingMessage: message
});

export const togglePublishedForCurrentChat = () : ThunkSomeAction => async (_, getState) => {
	const state = getState() as State;
	const currentchat = selectCurrentComposedChat(state);
	if (!currentchat) return;

	const chatRef = doc(db, CHATS_COLLECTION, currentchat.id);

	const uid = selectUid(state);

	if (!uid || currentchat.owner !== uid) {
		console.warn('User does not have permission to update this chat');
		return;
	}

	await updateDoc(chatRef, {
		published: !currentchat.published
	});

	//The live update should take care of updating the state.
	return;

};
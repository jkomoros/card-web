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
	authenticatedFetch,
	db,
	functions,
	getIDToken
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
	StreamingMessageData,
	StreamMessageRequestData,
} from '../../shared/types.js';

import {
	FIREBASE_REGION
} from '../config.GENERATED.SECRET.js';

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

// Using direct URL for the HTTP endpoints instead of callable
const projectId = functions.app.options.projectId;
const chatURL = `https://${FIREBASE_REGION}-${projectId}.cloudfunctions.net/chat`;
//TODO: these should be shared constants between client and server
const postMessageInChatURL = chatURL + '/postMessage';
const createChatURL = chatURL + '/create';
const streamMessageURL = chatURL + '/streamMessage';

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
		// Use authenticated fetch instead of callable
		const data = await authenticatedFetch<CreateChatRequestData, CreateChatResponseData>(
			createChatURL,
			{
				owner: uid,
				cards: cardIDs,
				initialMessage,
				backgroundPercentage: DEFAULT_BACKGROUND_PERCENTAGE,
				model,
				collection: {
					description: collection.description.serialize(),
					configuration: collection.description.configuration
				}
			}
		);
		
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
		// Use the authenticatedFetch helper with the appropriate type parameters
		const data = await authenticatedFetch<PostMessageInChatRequestData, PostMessageInChaResponseData>(
			postMessageInChatURL, 
			{
				chat: chatID,
				message
			}
		);
		
		// Check success flag in the response
		if (!data.success) {
			console.error('Failed to post message:', data.error || 'Unknown error');
			dispatch({
				type: CHAT_SEND_MESSAGE_FAILURE,
				error: new Error(data.error || 'Request failed')
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

/**
 * Generic helper to handle streaming SSE responses
 * @param url The URL to send the request to
 * @param requestData The request data to send
 * @returns AsyncGenerator that yields each chunk of text as it arrives
 */
async function* streamResponse<T>(url: string, requestData: T): AsyncGenerator<string> {
	// Get the authentication token from the shared function
	const token = await getIDToken();

	// Create the request with authentication
	const response = await fetch(url, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'Authorization': `Bearer ${token}`
		},
		body: JSON.stringify(requestData)
	});

	if (!response.ok) {
		throw new Error(`Stream response not OK: ${response.status} ${response.statusText}`);
	}

	// Create a reader for the response body stream
	const reader = response.body?.getReader();
	if (!reader) {
		throw new Error('Failed to get stream reader');
	}

	// Process the stream
	const decoder = new TextDecoder();
	let buffer = '';
	let streamActive = true;

	while (streamActive) {
		const { done, value } = await reader.read();
		if (done) {
			streamActive = false;
			break;
		}

		// Decode the chunk and add it to our buffer
		buffer += decoder.decode(value, { stream: true });

		// Process complete events from the buffer
		const lines = buffer.split('\n\n');
		buffer = lines.pop() || ''; // Keep the last incomplete chunk in the buffer

		for (const line of lines) {
			if (line.startsWith('data: ')) {
				try {
					const data = JSON.parse(line.substring(6)) as StreamingMessageData;
					
					// Check if it's a StreamingMessageErrorChunk
					if ('error' in data) {
						throw new Error(`Stream error: ${data.error}`);
					}

					// Check if it's a StreamingMessageDataChunk
					if ('chunk' in data) {
						yield data.chunk;
					}

					// Check if it's a StreamingMessageDataDone
					if ('done' in data) {
						return;
					}
				} catch (error) {
					throw new Error(`Error parsing SSE data: ${error}`);
				}
			}
		}
	}
}

const streamMessage = async (chatID : ChatID) : Promise<void> => {
	try {
		// Use the generic streamResponse helper
		for await (const chunk of streamResponse(
			streamMessageURL,
			{ chat: chatID } as StreamMessageRequestData
		)) {
			// Log each chunk as it arrives
			console.log('Received chunk:', chunk);
		}
		console.log('Stream completed');
	} catch (error) {
		console.error('Error in streaming:', error);
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

	//Every time we notice a message that's ready to start streaming, stream it.
	for (const rawMessage of Object.values(messages)) {
		const message = rawMessage as ChatMessage;
		if (message.status == 'ready') {
			streamMessage(message.chat);
		}
	}

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
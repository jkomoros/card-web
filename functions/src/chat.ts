import {
	CallableRequest
} from 'firebase-functions/v2/https';

import {
	AIModelName,
	AnthropicModelName,
	AssistantThread,
	AssistantThreadMessage,
	Chat,
	ChatMessage,
	CreateChatRequestData,
	CreateChatResponseData,
	OpenAIModelName,
	PostMessageInChaResponseData,
	PostMessageInChatRequestData
} from '../../shared/types.js';

import {
	fitPrompt,
	MODEL_INFO
} from '../../shared/ai.js';

import {
	db,
	getCards,
	throwIfUserMayNotUseAI,
	userMayViewCard,
	userPermissions
} from './common.js';

import {
	assertUnreachable,
	cardPlainContent,
	randomString
} from '../../shared/util.js';

import {
	Timestamp as FirestoreTimestamp
} from 'firebase-admin/firestore';

import {
	CHATS_COLLECTION,
	CHAT_MESSAGES_COLLECTION
} from '../../shared/collection-constants.js';

import type {
	Timestamp
} from '../../shared/timestamp.js';

import {
	assistantMessageForThreadOpenAI
} from './openai.js';

import {
	assistantMessageForThreadAnthropic
} from './anthropic.js';

import {
	EMBEDDING_STORE,
	embeddingForContent
} from './embeddings.js';

// Helper function to adapt Firebase Admin Timestamp to the shared Timestamp interface
const timestamp = (): Timestamp => {
	// The Firebase Admin Timestamp already conforms to the shared Timestamp interface
	// This is just to satisfy TypeScript
	return FirestoreTimestamp.now() as unknown as Timestamp;
};

//Every time you change this prompt, you should increment the version number too.
const SYSTEM_PROMPT = 'You should answer the user\'s question, primarily based on the information included within this background:';
const SYSTEM_PROMPT_VERSION = 0;

export const createChat = async (request : CallableRequest<CreateChatRequestData>) : Promise<CreateChatResponseData> => {
	const { data, auth } = request;

	if (!auth || !auth.uid) {
		throw new Error('Unauthorized request');
	}

	try {
		await throwIfUserMayNotUseAI(request);
	} catch(err) {
		return {
			success: false,
			error: String(err)
		};
	}

	if (!data) {
		return {
			success: false,
			error: 'No data provided'
		};
	}

	const modelInfo = MODEL_INFO[data.model];
	if (!modelInfo) {
		return {
			success: false,
			error: 'Invalid model provided'
		};
	}

	const permissions = await userPermissions(auth.uid);

	const id = randomString(16);

	const backgroundPercentage = data.backgroundPercentage;

	if (backgroundPercentage < 0 || backgroundPercentage > 1.0) {
		return {
			success: false,
			error: 'Background percentage must be between 0 and 1'
		};
	}

	const targetBackgroundLength = backgroundPercentage * modelInfo.maxTokens;

	let cardIDs = data.cards;
	
	//Sort by cards that are most related to the initial message.
	if (EMBEDDING_STORE) {
		console.log('Using embedding store to sort cards by similarity to initial message');

		//We do NOT use the normal card embedding text content, because in
		//practice it attends too strongly to dates and working-notes.
		const content = data.initialMessage;

		console.log('Computing embedding for initial message:', content);

		const embedding = await embeddingForContent(content);
		const vector = embedding.vector;

		const points = await EMBEDDING_STORE.similarPoints('', vector, 10000);

		console.log('Found similar points:', points.slice(0, 10), points.length);

		console.log('Previous cardIDs: ', cardIDs.slice(0, 50),cardIDs.length);

		const cardsToIncludeMap = Object.fromEntries(cardIDs.map(id => [id, true]));

		cardIDs = [];

		for (const point of points) {
			const cardID = point[0];
			if (cardID && cardsToIncludeMap[cardID]) {
				cardIDs.push(cardID);
			}
		}

		console.log('New cardIDs after sorting by similarity:', cardIDs.slice(0, 50));
	} else {
		console.log('No embedding store available, using provided cardIDs in original order');
	}

	const cards = await getCards(cardIDs);
	if (!cards || cards.length === 0) {
		return {
			success: false,
			error: 'No valid cards found for the provided IDs'
		};
	}

	//Keep only cards the user is allowed to view.
	const viewableCards = cards.filter(card => userMayViewCard(permissions, card, auth.uid));

	const cardsContent = viewableCards.map(card => cardPlainContent(card));
	
	const [systemMessageContent, maxCardIndex] = await fitPrompt({
		modelName: data.model,
		prefix: SYSTEM_PROMPT,
		items: cardsContent,
		maxTokenLength: targetBackgroundLength,
	});

	const chat : Chat = {
		id,
		owner: auth.uid,
		model: data.model,
		collection: data.collection,
		requested_cards: data.cards,
		prompt_version: SYSTEM_PROMPT_VERSION,
		//TODO: is this off by one?
		cards: viewableCards.map(card => card.id).slice(0, maxCardIndex + 1),
		background_percentage: backgroundPercentage,
		//TODO: set a title based on an LLM summary of the chat.
		title: data.initialMessage.substring(0, 64) || 'Chat',
		created: timestamp(),
		updated: timestamp(),
	};

	const systemMessage : ChatMessage = {
		id: randomString(16),
		chat: id,
		message_index: 0,
		role: 'system',
		content: systemMessageContent,
		timestamp: timestamp(),
		streaming: false
	};

	const initialMessage : ChatMessage = {
		id: randomString(16),
		chat: id,
		message_index: 1,
		role: 'user',
		content: data.initialMessage,
		timestamp: timestamp(),
		streaming: false
	};

	// Write Chat and ChatMessages to Firestore using a batch
	try {
		const batch = db.batch();

		// Create chat document
		const chatRef = db.collection(CHATS_COLLECTION).doc(id);
		batch.set(chatRef, chat);

		// Create system message document
		const systemMessageRef = db.collection(CHAT_MESSAGES_COLLECTION).doc(systemMessage.id);
		batch.set(systemMessageRef, systemMessage);

		// Create initial user message document
		const initialMessageRef = db.collection(CHAT_MESSAGES_COLLECTION).doc(initialMessage.id);
		batch.set(initialMessageRef, initialMessage);

		// Commit the batch
		await batch.commit();

		//Start the assistant message, but DON'T await it; will complete in the
		//background and write to the database when done.
		fetchAssistantMessage(id);

		return { 
			success: true,
			chat: id
		};
	} catch (error) {
		console.error('Error creating chat:', error);
		return {
			success: false,
			error: 'Failed to create chat: ' + String(error)
		};
	}
};

//Will fetch the next assistant message for the given chatID, and write it into the database.
//Typically you don't actually await this, and instead just get the result on the client when it's done.
const fetchAssistantMessage = async (chatID : string) : Promise<ChatMessage | null> => {

	//TODO: do streaming and write streaming tokens to the database as they come in.

	//TODO: if there's an error, automatically retry at some point (perhaps if the user views the chat again).

	const chatRef = db.collection(CHATS_COLLECTION).doc(chatID);

	const chatSnapshot = await chatRef.get();
	if (!chatSnapshot.exists) {
		throw new Error('Chat not found for ID: ' + chatID);
	}
	const chat = chatSnapshot.data() as Chat;

	const model = chat.model;

	//Fetch all messages with chat = chatID sorted by message_index
	const messagesSnapshot = await db.collection(CHAT_MESSAGES_COLLECTION)
		.where('chat', '==', chatID)
		.orderBy('message_index')
		.get();

	if (messagesSnapshot.empty) {
		throw new Error('No messages found for chat ID: ' + chatID);
	}

	const messages : ChatMessage[] = messagesSnapshot.docs.map(doc => ({
		id: doc.id,
		...doc.data()
	} as ChatMessage));

	const messageIndex = messages.length; // Next message index to use for the assistant message
	const assistantMessageData : ChatMessage = {
		id: randomString(16),
		chat: chatID,
		message_index: messageIndex,
		role: 'assistant',
		content: '',
		timestamp: timestamp(),
		streaming: true
	};

	//Write a stub message so the client can render loadding UI.
	const assistantMessageRef = db.collection(CHAT_MESSAGES_COLLECTION).doc(assistantMessageData.id);
	await assistantMessageRef.set(assistantMessageData);

	const assistantMessage = await assistantMessageForThread(model, messages);

	//Write the final assistant message to the database.
	await assistantMessageRef.update({
		content: assistantMessage,
		streaming: false
	});
	await chatRef.update({
		updated: timestamp()
	});
	return assistantMessageData;
};

const makeAssistantThread = (thread : ChatMessage[]) : AssistantThread => {
	if (!thread || thread.length === 0) {
		throw new Error('Thread is empty or undefined');
	}
	//Remove extraneous fields and convert it to a form that has a system message.
	const system : string[] = [];
	const messages : AssistantThreadMessage[] = [];
	for (const message of thread) {
		if (message.role === 'system') {
			system.push(message.content);
		} else {
			messages.push({
				role: message.role,
				content: message.content,
			});
		}
	}
	return {
		system: system.join('\n\n'),
		messages: messages
	};
};

const assistantMessageForThread = async (model : AIModelName, thread : ChatMessage[]) : Promise<string> => {
	const lastMessage = thread[thread.length - 1];
	if (lastMessage.role !== 'user') {
		throw new Error('Last message is not a user message, cannot fetch assistant message');
	}

	//TODO: wire through uid to the completion endpoint for abuse tracking.

	//Note: we assume that we've alraedy checked if the user is allowed to use AI and that they are.

	const modelInfo = MODEL_INFO[model];

	if (!modelInfo) {
		throw new Error('Invalid model provided: ' + model);
	}

	const assistantThread = makeAssistantThread(thread);

	switch(modelInfo.provider) {
	case 'openai':
		return await assistantMessageForThreadOpenAI(model as OpenAIModelName, assistantThread);
	case 'anthropic':
		return await assistantMessageForThreadAnthropic(model as AnthropicModelName, assistantThread);
	default:
		return assertUnreachable(modelInfo.provider);
	}
};

export const postMessageInChat = async (request : CallableRequest<PostMessageInChatRequestData>) : Promise<PostMessageInChaResponseData> => {
	const { data, auth } = request;

	if (!auth || !auth.uid) {
		throw new Error('Unauthorized request');
	}

	try {
		await throwIfUserMayNotUseAI(request);
	} catch(err) {
		return {
			success: false,
			error: String(err)
		};
	}

	if (!data || !data.chat || !data.message) {
		return {
			success: false,
			error: 'No data provided'
		};
	}

	const chatRef = db.collection(CHATS_COLLECTION).doc(data.chat);

	const chat = await chatRef.get();

	if (!chat.exists) {
		return {
			success: false,
			error: 'Chat not found for ID: ' + data.chat
		};
	}

	const chatData = chat.data() as Chat;

	if (chatData.owner !== auth.uid) {
		return {
			success: false,
			error: 'User is not the owner of this chat'
		};
	}
	
	//TODO: figure out how to not fetch the messages twice
	//(fetchAssistantMessage also does it. Maybe fetchAssistantMessage should
	//also take the most recent userMessage to write?)

	const existingMessagesSnapshot = await db.collection(CHAT_MESSAGES_COLLECTION)
		.where('chat', '==', data.chat)
		.orderBy('message_index', 'asc')
		.get();

	if (existingMessagesSnapshot.empty) {
		return {
			success: false,
			error: 'No messages found for chat ID: ' + data.chat
		};
	}

	const existingMessages : ChatMessage[] = existingMessagesSnapshot.docs.map(doc => ({
		id: doc.id,
		...doc.data()
	} as ChatMessage));

	const messageIndex = existingMessages.length; // Next message index to use for the new message

	const newMessage : ChatMessage = {
		id: randomString(16),
		chat: data.chat,
		message_index: messageIndex,
		role: 'user',
		content: data.message,
		timestamp: timestamp(),
		streaming: false
	};
	// Write the new user message to Firestore
	const newMessageRef = db.collection(CHAT_MESSAGES_COLLECTION).doc(newMessage.id);
	await newMessageRef.set(newMessage);
	await chatRef.update({
		updated: timestamp()
	});

	//Fetch the assistant message for this chat. Do NOT await, since it will write to the database when done.
	fetchAssistantMessage(data.chat);
	return {
		success: true,
	};

};
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
	OpenAIModelName
} from '../../shared/types.js';

import {
	CARD_SEPARATOR,
	MODEL_INFO
} from '../../shared/ai.js';

import {
	db,
	getCards,
	throwIfUserMayNotUseAI
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

// Helper function to adapt Firebase Admin Timestamp to the shared Timestamp interface
const timestamp = (): Timestamp => {
	// The Firebase Admin Timestamp already conforms to the shared Timestamp interface
	// This is just to satisfy TypeScript
	return FirestoreTimestamp.now() as unknown as Timestamp;
};

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

	const id = randomString(16);

	//Take the first 100 cards.
	//TODO: select the cards based on how many will actually fit in the model's context window and token size.
	//TODO: select the cards that are most relevant to the initial message, if possible.
	const cardsToInclude = data.cards.slice(0, 100);

	const cards = await getCards(cardsToInclude);
	if (!cards || cards.length === 0) {
		return {
			success: false,
			error: 'No valid cards found for the provided IDs'
		};
	}

	const systemMessageContent = cards.map(card => cardPlainContent(card)).join(CARD_SEPARATOR);

	const chat : Chat = {
		id,
		owner: auth.uid,
		model: data.model,
		collection: data.collection,
		requested_cards: data.cards,
		cards: cardsToInclude,
		background_length: data.backgroundLength,
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

	const chatSnapshot = await db.collection(CHATS_COLLECTION).doc(chatID).get();
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

	const assistantMessage = await assistantMessageForThread(model, messages);

	const messageIndex = messages.length; // Next message index to use for the assistant message
	const assistantMessageData : ChatMessage = {
		id: randomString(16),
		chat: chatID,
		message_index: messageIndex,
		role: 'assistant',
		content: assistantMessage,
		timestamp: timestamp(),
		streaming: false
	};

	// Write the assistant message to Firestore
	const assistantMessageRef = db.collection(CHAT_MESSAGES_COLLECTION).doc(assistantMessageData.id);
	await assistantMessageRef.set(assistantMessageData);
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
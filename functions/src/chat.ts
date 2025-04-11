import {
	Request,
	Response
} from 'express';

import {
	AIModelName,
	AnthropicModelName,
	AssistantThread,
	AssistantThreadMessage,
	Chat,
	ChatMessage,
	ChatMessageID,
	CreateChatRequestData,
	CreateChatResponseData,
	OpenAIModelName,
	PostMessageInChaResponseData,
	PostMessageInChatRequestData,
	StreamingMessageDataChunk,
	StreamingMessageDataDone,
	StreamingMessageErrorChunk,
	StreamMessageRequestData
} from '../../shared/types.js';

import {
	DEFAULT_MODEL,
	fitPrompt,
	MODEL_INFO
} from '../../shared/ai.js';

import {
	authFromRequest,
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
	assistantMessageForThreadOpenAI,
	assistantMessageForThreadOpenAIStreaming
} from './openai.js';

import {
	assistantMessageForThreadAnthropic,
	assistantMessageForThreadAnthropicStreaming
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

// Express onRequest handler for createChat
export const createChatHandler = async (req: Request, res: Response) : Promise<void> => {
	// Get auth data from request
	const authData = await authFromRequest(req);

	if (!authData || !authData.uid) {
		res.status(401).json({
			success: false,
			error: 'Unauthorized request'
		} as CreateChatResponseData);
		return;
	}

	try {
		await throwIfUserMayNotUseAI(authData.uid);
	} catch(err) {
		res.status(403).json({
			success: false,
			error: String(err)
		} as CreateChatResponseData);
		return;
	}

	// Get request body data
	const data = req.body as CreateChatRequestData;

	if (!data) {
		res.status(400).json({
			success: false,
			error: 'No data provided'
		} as CreateChatResponseData);
		return;
	}

	const modelInfo = MODEL_INFO[data.model];
	if (!modelInfo) {
		res.status(400).json({
			success: false,
			error: 'Invalid model provided'
		} as CreateChatResponseData);
		return;
	}

	const permissions = await userPermissions(authData.uid);

	const id = randomString(16);

	const backgroundPercentage = data.backgroundPercentage;

	if (backgroundPercentage < 0 || backgroundPercentage > 1.0) {
		res.status(400).json({
			success: false,
			error: 'Background percentage must be between 0 and 1'
		} as CreateChatResponseData);
		return;
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
		res.status(400).json({
			success: false,
			error: 'No valid cards found for the provided IDs'
		} as CreateChatResponseData);
		return;
	}

	//Keep only cards the user is allowed to view.
	const viewableCards = cards.filter(card => userMayViewCard(permissions, card, authData.uid));

	const cardsContent = viewableCards.map(card => cardPlainContent(card));
	
	const [systemMessageContent, maxCardIndex] = await fitPrompt({
		modelName: data.model,
		prefix: SYSTEM_PROMPT,
		items: cardsContent,
		maxTokenLength: targetBackgroundLength,
	});

	const chat : Chat = {
		id,
		owner: authData.uid,
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
		published: false
	};

	const systemMessage : ChatMessage = {
		id: randomString(16),
		chat: id,
		message_index: 0,
		role: 'system',
		content: systemMessageContent,
		timestamp: timestamp(),
		status: 'complete'
	};

	const initialMessage : ChatMessage = {
		id: randomString(16),
		chat: id,
		message_index: 1,
		role: 'user',
		content: data.initialMessage,
		timestamp: timestamp(),
		status: 'complete'
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

		await createStubAssistantMessage(id, 2);

		setChatTitle(id, data.initialMessage);

		res.status(200).json({ 
			success: true,
			chat: id
		} as CreateChatResponseData);

	} catch (error) {
		console.error('Error creating chat:', error);
		res.status(500).json({
			success: false,
			error: 'Failed to create chat: ' + String(error)
		} as CreateChatResponseData);
		return;
	}
};

const setChatTitle = async (chatID : string, initalMesasge : string) : Promise<void> => {

	const suggestedTitle = await assistantMessage(`Help name a chat thread that starts with the following message:\n\n${initalMesasge}\n\nRespond with a title of no more than 7 words. Respond with only the title, nothing else. The title should be something the user might have chosen themselves to title the question they asked.`);

	if (!suggestedTitle || suggestedTitle.trim() === '') {
		throw new Error('Failed to generate a title for the chat');
	}

	const chatRef = db.collection(CHATS_COLLECTION).doc(chatID);

	await chatRef.update({
		title: suggestedTitle.trim()
	});

};

//Will fetch the next assistant message for the given chatID, and write it into the database.
//Typically you don't actually await this, and instead just get the result on the client when it's done.
const createStubAssistantMessage = async (chatID : string, nextMessageIndex : number) : Promise<ChatMessageID | null> => {

	//TODO: if there's an error, automatically retry at some point (perhaps if the user views the chat again).

	const assistantMessageData : ChatMessage = {
		id: randomString(16),
		chat: chatID,
		message_index: nextMessageIndex,
		role: 'assistant',
		content: '',
		timestamp: timestamp(),
		status: 'ready'
	};

	//Write a stub message so the client can render loadding UI.
	const assistantMessageRef = db.collection(CHAT_MESSAGES_COLLECTION).doc(assistantMessageData.id);
	await assistantMessageRef.set(assistantMessageData);

	return assistantMessageData.id;

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

const assistantMessage = async (message : string, model : AIModelName = DEFAULT_MODEL) : Promise<string> => {
	const thread : ChatMessage[] = [{
		id: randomString(16),
		chat: randomString(16), // Dummy chat ID, not used in this context
		message_index: 0, // Dummy message index, not used in this context
		role: 'user',
		content: message,
		status: 'streaming',
		timestamp: timestamp()
	}];
	return await assistantMessageForThread(model, thread);
};

async function* assistantMessageForThreadStreaming(model: AIModelName, thread: ChatMessage[]): AsyncGenerator<string> {
	const lastMessage = thread[thread.length - 1];
	if (lastMessage.role !== 'user') {
		throw new Error('Last message is not a user message, cannot fetch assistant message');
	}

	//Note: we assume that we've already checked if the user is allowed to use AI and that they are.

	const modelInfo = MODEL_INFO[model];

	if (!modelInfo) {
		throw new Error('Invalid model provided: ' + model);
	}

	const assistantThread = makeAssistantThread(thread);

	switch(modelInfo.provider) {
	case 'openai':
		yield* assistantMessageForThreadOpenAIStreaming(model as OpenAIModelName, assistantThread);
		break;
	case 'anthropic':
		yield* assistantMessageForThreadAnthropicStreaming(model as AnthropicModelName, assistantThread);
		break;
	default:
		return assertUnreachable(modelInfo.provider);
	}
}

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

export const streamMessageHandler = async (req: Request, res: Response) : Promise<void> => {

	const authData = await authFromRequest(req);

	try {
		await throwIfUserMayNotUseAI(authData?.uid);
	} catch(err) {
		res.status(403).json({
			success: false,
			error: String(err)
		} as PostMessageInChaResponseData);
		return;
	}

	const data = req.body as StreamMessageRequestData;

	if (!data|| !data.chat) {
		res.status(400).json({
			success: false,
			error: 'No data provided'
		} as PostMessageInChaResponseData);
		return;
	}

	const chatID = data.chat;

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

	const assistantMessageData = messages[messages.length - 1];

	if (assistantMessageData.role !== 'assistant') {
		res.status(500).json({
			success: false,
			error: 'Last message is not an assistant message'
		} as PostMessageInChaResponseData);
		return;
	}

	if (assistantMessageData.status !== 'ready') {
		res.status(500).json({
			success: false,
			error: 'Assistant message is not ready to stream'
		} as PostMessageInChaResponseData);
		return;
	}

	// Set up SSE headers
	res.setHeader('Content-Type', 'text/event-stream');
	res.setHeader('Cache-Control', 'no-cache');
	res.setHeader('Connection', 'keep-alive');
	res.flushHeaders();

	//Immediately claim streaming for this.
	const assistantMessageRef = db.collection(CHAT_MESSAGES_COLLECTION).doc(assistantMessageData.id);
	const assistantMessageUpdate : Partial<ChatMessage> = {
		status: 'streaming'
	};
	await assistantMessageRef.update(assistantMessageUpdate);

	//We have to pass the messages without the last assistant message, because
	//this is the precise thread that will be sent to the assistant, and it
	//should respond with an assistant message, and the current one is empty.
	const messagesWithoutLastAsssistantMessage = messages.slice(0, messages.length - 1);

	let fullContent = '';

	try {
		for await (const chunk of assistantMessageForThreadStreaming(model, messagesWithoutLastAsssistantMessage)) {
			// Send chunk to client
			res.write(`data: ${JSON.stringify({ chunk } as StreamingMessageDataChunk)}\n\n`);
			fullContent += chunk;
		}
		
		// Send completion event
		res.write(`data: ${JSON.stringify({ done: true } as StreamingMessageDataDone)}\n\n`);
		
		// Write the final assistant message to the database
		const messageUpdate : Partial<ChatMessage> = {
			content: fullContent,
			status: 'complete'
		};
		await assistantMessageRef.update(messageUpdate);

		const chatUpdate : Partial<Chat> = {
			updated: timestamp()
		};
		await chatRef.update(chatUpdate);
		
		res.end();
	} catch(err) {
		console.error('Error streaming assistant message:', err);
		//If there's an error, write the error to the database
		const update : Partial<ChatMessage> = {
			status: 'failed',
			error: String(err)
		};
		await assistantMessageRef.update(update);
		
		// Send error event
		res.write(`data: ${JSON.stringify({ error: String(err) } as StreamingMessageErrorChunk)}\n\n`);
		res.end();
	}
};

// Express onRequest handler for postMessageInChat
export const postMessageInChatHandler = async (req: Request, res: Response) : Promise<void> => {
	// Get auth data from request
	const authData = await authFromRequest(req);

	try {
		await throwIfUserMayNotUseAI(authData?.uid);
	} catch(err) {
		res.status(403).json({
			success: false,
			error: String(err)
		} as PostMessageInChaResponseData);
		return;
	}

	// Get request body data
	const data = req.body as PostMessageInChatRequestData;

	if (!data || !data.chat || !data.message) {
		res.status(400).json({
			success: false,
			error: 'No data provided'
		} as PostMessageInChaResponseData);
		return;
	}

	const chatRef = db.collection(CHATS_COLLECTION).doc(data.chat);
	const chat = await chatRef.get();

	if (!chat.exists) {
		res.status(404).json({
			success: false,
			error: 'Chat not found for ID: ' + data.chat
		} as PostMessageInChaResponseData);
		return;
	}

	const chatData = chat.data() as Chat;

	if (chatData.owner !== authData.uid) {
		res.status(403).json({
			success: false,
			error: 'User is not the owner of this chat'
		} as PostMessageInChaResponseData);
		return;
	}
	
	const existingMessagesSnapshot = await db.collection(CHAT_MESSAGES_COLLECTION)
		.where('chat', '==', data.chat)
		.orderBy('message_index', 'asc')
		.get();

	if (existingMessagesSnapshot.empty) {
		res.status(404).json({
			success: false,
			error: 'No messages found for chat ID: ' + data.chat
		} as PostMessageInChaResponseData);
		return;
	}

	const existingMessages : ChatMessage[] = existingMessagesSnapshot.docs.map(doc => ({
		id: doc.id,
		...doc.data()
	} as ChatMessage));

	if (existingMessages.length === 0) {
		res.status(404).json({
			success: false,
			error: 'No messages found for chat ID: ' + data.chat
		} as PostMessageInChaResponseData);
		return;
	}

	const lastMessage = existingMessages[existingMessages.length - 1];
	if (lastMessage.role !== 'assistant') {
		res.status(403).json({
			success: false,
			error: 'Last message in chat is not an assistant message'
		} as PostMessageInChaResponseData);
		return;
	}

	if (lastMessage.status !== 'complete') {
		res.status(403).json({
			success: false,
			error: 'Last message in chat is not complete'
		} as PostMessageInChaResponseData);
		return;
	}

	const messageIndex = existingMessages.length; // Next message index to use for the new message

	const newMessage : ChatMessage = {
		id: randomString(16),
		chat: data.chat,
		message_index: messageIndex,
		role: 'user',
		content: data.message,
		timestamp: timestamp(),
		status: 'complete'
	};

	// Write the new user message to Firestore
	const newMessageRef = db.collection(CHAT_MESSAGES_COLLECTION).doc(newMessage.id);
	await newMessageRef.set(newMessage);

	const chatUpdate : Partial<Chat> = {
		updated: timestamp()
	};
	await chatRef.update(chatUpdate);

	await createStubAssistantMessage(data.chat, messageIndex + 1);
	
	res.status(200).json({
		success: true,
	} as PostMessageInChaResponseData);
};
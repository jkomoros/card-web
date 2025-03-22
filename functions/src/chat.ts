import {
	CallableRequest
} from 'firebase-functions/v2/https';

import {
	Chat,
	ChatMessage,
	CreateChatRequestData,
	CreateChatResponseData
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

		//TODO: actually kick off the LLM completion for the next chat message, without awaiting.

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
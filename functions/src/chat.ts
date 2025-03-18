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
	MODEL_INFO
} from '../../shared/ai.js';

import {
	db,
	throwIfUserMayNotUseAI
} from './common.js';

import {
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

	const chat : Chat = {
		id,
		owner: auth.uid,
		model: data.model,
		collection: data.collection,
		cards: data.cards,
		background_length: data.backgroundLength,
		title: data.initialMessage.substring(0, 64) || 'Chat',
		created: timestamp(),
		updated: timestamp(),
	};

	//TODO: actually calculate the system message content based on how many cards in the set will fit.
	const systemMessageContent = '';

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
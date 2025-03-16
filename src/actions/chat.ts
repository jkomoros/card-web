import {
	httpsCallable
} from 'firebase/functions';

import {
	selectActiveCollection,
	selectActiveCollectionCards,
	selectUid,
	selectUserMayUseAI
} from '../selectors';

import {
	ThunkSomeAction
} from '../store';

import {
	State
} from '../types';

import {
	functions
} from '../firebase.js';

import {
	AIModelName,
	CardID,
	CreateChatRequestData,
	CreateChatResponseData,
} from '../../shared/types.js';

import {
	navigatePathTo
} from './app.js';

// Default model to use for chats
const DEFAULT_MODEL: AIModelName = 'claude-3-7-sonnet-latest';

// Default background length
const DEFAULT_BACKGROUND_LENGTH = 5000;

const createChatCallable = httpsCallable<CreateChatRequestData, CreateChatResponseData>(functions, 'createChat');

export const createChatWithCurentCollection = (initialMessage : string): ThunkSomeAction => async (dispatch, getState) => {
	const state = getState() as State;
	
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
	
	try {
		const result = await createChatCallable({
			owner: uid,
			cards: cardIDs,
			initialMessage,
			backgroundLength: DEFAULT_BACKGROUND_LENGTH,
			model: DEFAULT_MODEL,
			collection: {
				description: collection.description.serialize(),
				configuration: collection.description.configuration
			}
		});
		
		const data = result.data;
		if (data.success) {
			// Navigate to the new chat
			dispatch(navigatePathTo(`/chat/${data.chat}`));
		} else {
			console.error('Failed to create chat:', data.error);
		}
	} catch (err) {
		console.error('Error creating chat:', err);
	}
};
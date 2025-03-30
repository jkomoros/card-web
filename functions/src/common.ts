import {
	initializeApp
} from 'firebase-admin/app';

import {
	getFirestore
} from 'firebase-admin/firestore';

import {
	getAuth
} from 'firebase-admin/auth';

import {
	getStorage
} from 'firebase-admin/storage';

import {
	Card,
	CardID,
	CardIdentifier,
	Uid,
	UserPermissions
} from './types.js';

import {
	HttpsError
} from 'firebase-functions/v2/https';

// Import shared constants instead of duplicating them
import {
	OPENAI_API_KEY_VAR,
	ANTHROPIC_API_KEY_VAR,
	SITE_DOMAIN_VAR,
	LAST_DEPLOY_AFFECTING_RENDERING_VAR,
	TWITTER_ACCESS_TOKEN_SECRET_VAR,
	TWITTER_CONSUMER_SECRET_VAR,
	TWITTER_ACCESS_TOKEN_KEY_VAR,
	TWITTER_CONSUMER_KEY_VAR,
	EMAIL_POSTMARK_KEY_VAR,
	EMAIL_TO_ADDRESS_VAR,
	EMAIL_FROM_ADDRESS_VAR,
	QDRANT_CLUSTER_URL_VAR,
	QDRANT_API_KEY_VAR
} from '../../shared/env-constants.js';

// Import shared collection constants
import {
	CARDS_COLLECTION,
	PERMISSIONS_COLLECTION
} from '../../shared/collection-constants.js';

// Import shared card field constants
import {
	REFERENCES_INFO_CARD_PROPERTY,
	REFERENCES_INFO_INBOUND_CARD_PROPERTY,
	REFERENCES_CARD_PROPERTY,
	REFERENCES_INBOUND_CARD_PROPERTY
} from '../../shared/card_fields.js';

initializeApp();

//We use this so often we might as well make it more common
export const db = getFirestore();
export const auth = getAuth();
export const storage = getStorage();

const PROJECT_NAME = (process.env.GCLOUD_PROJECT || '').toLowerCase();

//DEV_MODE is true if the project name contains 'dev-' or '-dev'
export const DEV_MODE = PROJECT_NAME.includes('dev-') || PROJECT_NAME.includes('-dev');

//These are the same names as tools/env.ts
export const EMAIL_POSTMARK_KEY = process.env[EMAIL_POSTMARK_KEY_VAR];
export const EMAIL_FROM_ADDRESS = process.env[EMAIL_FROM_ADDRESS_VAR];
export const EMAIL_TO_ADDRESS = process.env[EMAIL_TO_ADDRESS_VAR];
export const OPENAI_API_KEY = process.env[OPENAI_API_KEY_VAR];
export const ANTHROPIC_API_KEY = process.env[ANTHROPIC_API_KEY_VAR];
export const OPENAI_ENABLED = !!OPENAI_API_KEY;
export const ANTHROPIC_ENABLED = !!ANTHROPIC_API_KEY;
export const TWITTER_ACCESS_TOKEN_SECRET = process.env[TWITTER_ACCESS_TOKEN_SECRET_VAR];
export const TWITTER_CONSUMER_SECRET = process.env[TWITTER_CONSUMER_SECRET_VAR];
export const TWITTER_ACCESS_TOKEN_KEY = process.env[TWITTER_ACCESS_TOKEN_KEY_VAR];
export const TWITTER_CONSUMER_KEY = process.env[TWITTER_CONSUMER_KEY_VAR];
export const QDRANT_API_KEY = process.env[QDRANT_API_KEY_VAR];
export const QDRANT_CLUSTER_URL = process.env[QDRANT_CLUSTER_URL_VAR];
export const LAST_DEPLOY_AFFECTING_RENDERING = process.env[LAST_DEPLOY_AFFECTING_RENDERING_VAR] || 'deploy-not-set';
const SITE_DOMAIN = process.env[SITE_DOMAIN_VAR];

//firebaseapp.com is whitelisted automatically in auth, but '*.web.app' isn't
export const HOSTING_DOMAIN =  PROJECT_NAME + '.firebaseapp.com';
export const DOMAIN =  SITE_DOMAIN || HOSTING_DOMAIN;

//Copied from src/actions/app.js
export const PAGE_DEFAULT = 'c';
export const PAGE_COMMENT = 'comment';
const PAGE_BASIC_CARD = 'basic-card';
//copied from src/components/basic_card_view.js
export const WINDOW_CARD_RENDERED_VARIABLE = 'BASIC_CARD_RENDERED';
//Note: screenshot.js also uses the literal value of WINDOW_INJECT_FETCHED_CARD_NAME in the code;
export const WINDOW_INJECT_FETCHED_CARD_NAME = 'injectFetchedCard';

// Re-export for usage in this module
export {
	REFERENCES_INFO_CARD_PROPERTY,
	REFERENCES_INFO_INBOUND_CARD_PROPERTY,
	REFERENCES_CARD_PROPERTY,
	REFERENCES_INBOUND_CARD_PROPERTY
};

export const userPermissions = async (uid : Uid) : Promise<UserPermissions | null> => {
	const user = await db.collection(PERMISSIONS_COLLECTION).doc(uid).get();
	if (!user) return null;
	if (!user.exists) return null;
	return user.data() || null;
};

export const urlForBasicCard = (idOrSlug : CardIdentifier) => {
	//we use HOSTING_DOMAIN so that we use the prod or dev card renderer
	//depending on our mode.
	return 'https://' + HOSTING_DOMAIN + '/' + PAGE_BASIC_CARD + '/' + idOrSlug;
};

export const getCardByIDOrSlug = async (idOrSlug : CardIdentifier) : Promise<Card | null> => {
	let card = await db.collection(CARDS_COLLECTION).doc(idOrSlug).get();
	if (card && card.exists) {
		return Object.assign({id: card.id}, card.data()) as Card;
	}
	//Try fetching by slug
	const cards = await db.collection(CARDS_COLLECTION).where('slugs', 'array-contains', idOrSlug).limit(1).get();
	if (cards && !cards.empty) {
		card = cards.docs[0];
		return Object.assign({id: card.id}, card.data()) as Card;
	}
	return null;
};

export const getCardLinkCardsForCard = async (card : Card) : Promise<Record<CardID, Card>> => {
	//orderBy is effectively a filter down to only cards that have 'references.CARD_ID' set.
	const rawQuery =  await db.collection(CARDS_COLLECTION).where('published', '==', true).where(REFERENCES_INBOUND_CARD_PROPERTY + '.' + card.id, '==', true).get();
	if (rawQuery.empty) return {};
	return Object.fromEntries(rawQuery.docs.map(doc => [doc.id, Object.assign({id: doc.id}, doc.data())])) as Record<CardID, Card>;
};

export const getUserDisplayName = async (uid : Uid) => {
	const user = await auth.getUser(uid);
	return user.displayName;
};

export const getCardName = async (cardId : CardID) => {
	const card = await db.collection(CARDS_COLLECTION).doc(cardId).get();
	return card.data()?.name || cardId;
};

export const prettyCardURL = (card : Card) => {
	return 'https://' + DOMAIN + '/' +  PAGE_DEFAULT + '/' + card.name;
};

//The server-side analogue of selectUserMayUseAI
export const mayUseAI = (permissions : UserPermissions | null) => {
	if (!permissions) return false;
	if (permissions.admin) return true;
	if (permissions.remoteAI) return true;
	//TODO: also allow it if the ai permission is true.
	return false;
};

export const throwIfUserMayNotUseAI = async (uid? : Uid) : Promise<void> => {
	if (!uid) {
		throw new HttpsError('unauthenticated', 'A valid user authentication must be passed');
	}

	const permissions = await userPermissions(uid);

	if (!mayUseAI(permissions)) {
		throw new HttpsError('permission-denied', 'The user does not have adequate permissions to perform this action');
	}
};

export const userMayViewCard = (permissions : UserPermissions | null, card : Card, uid : Uid) : boolean => {
	//The rough equivalent of userMayViewUnpublished from the security rules
	if (!card) return true;
	if (card.published) return true;
	if (!permissions) return false;
	if (permissions.admin) return true;
	if (permissions.edit) return true;
	if (permissions.editCard) return true;
	if (permissions.viewUnpublished) return true;
	if (card.author == uid) return true;
	if (card.permissions.editCard && card.permissions.editCard.includes(uid)) return true;
	return false;
};

//Returns the cards with the given IDs. If not provided, returns all cards.
export const getCards = async (cardIDs? : CardID[]) : Promise<Card[]> => {
	if (!cardIDs) {
		const rawCards = await db.collection(CARDS_COLLECTION).get();
		return rawCards.docs.map(snapshot => {
			return {
				...snapshot.data(),
				id: snapshot.id
			} as Card;
		});
	}
	
	// Fetch cards in batches of 10 to avoid hitting Firestore limits
	const batchSize = 10;
	const batches = [];
	
	for (let i = 0; i < cardIDs.length; i += batchSize) {
		const batch = cardIDs.slice(i, i + batchSize);
		batches.push(batch);
	}
	
	const results = await Promise.all(batches.map(async batch => {
		const batchResults = await Promise.all(batch.map(id => 
			db.collection(CARDS_COLLECTION).doc(id).get()
		));
		
		return batchResults.map(snapshot => {
			if (!snapshot.exists) return null;
			return {
				...snapshot.data(),
				id: snapshot.id
			} as Card;
		});
	}));
	
	return results.flat().filter(card => !!card) as Card[];
};
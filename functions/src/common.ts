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
} from './types';

initializeApp();

import * as functions from 'firebase-functions';


//We use this so often we might as well make it more common
export const db = getFirestore();
export const auth = getAuth();
export const config = functions.config();
export const storage = getStorage();

const PROJECT_NAME = (process.env.GCLOUD_PROJECT || '').toLowerCase();

//Also in gulpfile.js
//Also in tools/util.ts
export const CHANGE_ME_SENTINEL = 'CHANGE-ME';

//DEV_MODE is true if the project name contains 'dev-' or '-dev'
export const DEV_MODE = PROJECT_NAME.includes('dev-') || PROJECT_NAME.includes('-dev');
//firebaseapp.com is whitelisted automatically in auth, but '*.web.app' isn't
export const HOSTING_DOMAIN =  PROJECT_NAME + '.firebaseapp.com';
export const DOMAIN = (config.site || {})  .domain || HOSTING_DOMAIN;
export const LAST_DEPLOY_AFFECTING_RENDERING = (config.site || {}).last_deploy_affecting_rendering || 'deploy-not-set';
//Copied from src/actions/app.js
export const PAGE_DEFAULT = 'c';
export const PAGE_COMMENT = 'comment';
const PAGE_BASIC_CARD = 'basic-card';
//copied from src/components/basic_card_view.js
export const WINDOW_CARD_RENDERED_VARIABLE = 'BASIC_CARD_RENDERED';
//Note: screenshot.js also uses the literal value of WINDOW_INJECT_FETCHED_CARD_NAME in the code;
export const WINDOW_INJECT_FETCHED_CARD_NAME = 'injectFetchedCard';

//duplicated from src/card_fields.js;
export const REFERENCES_INFO_CARD_PROPERTY = 'references_info';
export const REFERENCES_INFO_INBOUND_CARD_PROPERTY = 'references_info_inbound';
export const REFERENCES_CARD_PROPERTY = 'references';
export const REFERENCES_INBOUND_CARD_PROPERTY = 'references_inbound';

export const userPermissions = async (uid : Uid) : Promise<UserPermissions | null> => {
	const user = await db.collection('permissions').doc(uid).get();
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
	let card = await db.collection('cards').doc(idOrSlug).get();
	if (card && card.exists) {
		return Object.assign({id: card.id}, card.data()) as Card;
	}
	//Try fetching by slug
	const cards = await db.collection('cards').where('slugs', 'array-contains', idOrSlug).limit(1).get();
	if (cards && !cards.empty) {
		card = cards.docs[0];
		return Object.assign({id: card.id}, card.data()) as Card;
	}
	return null;
};

export const getCardLinkCardsForCard = async (card : Card) : Promise<Record<CardID, Card>> => {
	//orderBy is effectively a filter down to only cards that have 'references.CARD_ID' set.
	const rawQuery =  await db.collection('cards').where('published', '==', true).where(REFERENCES_INBOUND_CARD_PROPERTY + '.' + card.id, '==', true).get();
	if (rawQuery.empty) return {};
	return Object.fromEntries(rawQuery.docs.map(doc => [doc.id, Object.assign({id: doc.id}, doc.data())])) as Record<CardID, Card>;
};

export const getUserDisplayName = async (uid : Uid) => {
	const user = await auth.getUser(uid);
	return user.displayName;
};

export const getCardName = async (cardId : CardID) => {
	//TODO: use the actual constants for cards collection (see #134)
	const card = await db.collection('cards').doc(cardId).get();
	return card.data()?.name || cardId;
};

export const prettyCardURL = (card : Card) => {
	return 'https://' + DOMAIN + '/' +  PAGE_DEFAULT + '/' + card.name;
};

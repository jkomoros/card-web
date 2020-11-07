const admin = require('firebase-admin');
admin.initializeApp();

const functions = require('firebase-functions');
const fromEntries = require('fromentries');

//We use this so often we might as well make it more common
const FieldValue = admin.firestore.FieldValue;
const db = admin.firestore();
const auth = admin.auth();
const config = functions.config();
const storage = admin.storage();

const PROJECT_NAME = process.env.GCLOUD_PROJECT.toLowerCase();

//DEV_MODE is true if the project name contains 'dev-' or '-dev'
const DEV_MODE = PROJECT_NAME.includes('dev-') || PROJECT_NAME.includes('-dev');
//firebaseapp.com is whitelisted automatically in auth, but '*.web.app' isn't
const HOSTING_DOMAIN =  PROJECT_NAME + '.firebaseapp.com';
const DOMAIN = (config.site || {})  .domain || HOSTING_DOMAIN;
const LAST_DEPLOY_AFFECTING_RENDERING = (config.site || {}).last_deploy_affecting_rendering || "deploy-not-set";
//Copied from src/actions/app.js
const PAGE_DEFAULT = 'c';
const PAGE_COMMENT = 'comment';
const PAGE_BASIC_CARD = 'basic-card';
//copied from src/components/basic_card_view.js
const WINDOW_CARD_RENDERED_VARIABLE = 'BASIC_CARD_RENDERED';
//Note: screenshot.js also uses the literal value of WINDOW_INJECT_FETCHED_CARD_NAME in the code;
const WINDOW_INJECT_FETCHED_CARD_NAME = 'injectFetchedCard';

//Any value in this variable counts as being set to true.
const DISABLE_CARD_UPDATE_FUNCTIONS = (config.updates || {}).disable_card_functions ? true : false;

//duplicated from src/card_fields.js;
const REFERENCES_INFO_CARD_PROPERTY = 'references_info';
const REFERENCES_INFO_INBOUND_CARD_PROPERTY = 'references_info_inbound';
const REFERENCES_CARD_PROPERTY = 'references';
const REFERENCES_INBOUND_CARD_PROPERTY = 'references_inbound';

const urlForBasicCard = (idOrSlug) => {
    //we use HOSTING_DOMAIN so that we use the prod or dev card renderer
    //depending on our mode.
    return 'https://' + HOSTING_DOMAIN + '/' + PAGE_BASIC_CARD + '/' + idOrSlug;
}

const getCardByIDOrSlug = async (idOrSlug) => {
    let card = await db.collection('cards').doc(idOrSlug).get();
    if (card && card.exists) {
        return Object.assign({id: card.id}, card.data());
    }
    //Try fetching by slug
    let cards = await db.collection('cards').where('slugs', 'array-contains', idOrSlug).limit(1).get();
    if (cards && !cards.empty) {
        card = cards.docs[0];
        return Object.assign({id: card.id}, card.data());
    }
    return null;
}

const getCardLinkCardsForCard = async (card) => {
    //orderBy is effectively a filter down to only cards that have 'references.CARD_ID' set.
    const rawQuery =  await db.collection('cards').where('published', '==', true).where(REFERENCES_INBOUND_CARD_PROPERTY + '.' + card.id, '==', true).get();
	if (rawQuery.empty) return {};
	return fromEntries(rawQuery.docs.map(doc => [doc.id, Object.assign({id: doc.id}, doc.data())]));
}

const getUserDisplayName = async (uid) => {
    let user = await auth.getUser(uid);
    return user.displayName
}

const getCardName = async (cardId) => {
    //TODO: use the actual constants for cards collection (see #134)
    let card = await db.collection('cards').doc(cardId).get();
    return card.data().name || cardId;
}

const prettyCardURL = (card) => {
    return 'https://' + DOMAIN + '/' +  PAGE_DEFAULT + '/' + card.name;
}

exports.admin = admin;
exports.FieldValue = FieldValue;
exports.db = db;
exports.auth = auth;
exports.config = config;
exports.storage = storage;
exports.getUserDisplayName = getUserDisplayName;
exports.getCardByIDOrSlug = getCardByIDOrSlug;
exports.getCardLinkCardsForCard = getCardLinkCardsForCard;
exports.urlForBasicCard = urlForBasicCard;
exports.getCardName = getCardName;
exports.prettyCardURL = prettyCardURL;
exports.DEV_MODE = DEV_MODE;
exports.HOSTING_DOMAIN = HOSTING_DOMAIN;
exports.DOMAIN = DOMAIN;
exports.LAST_DEPLOY_AFFECTING_RENDERING = LAST_DEPLOY_AFFECTING_RENDERING;
exports.PAGE_DEFAULT = PAGE_DEFAULT;
exports.PAGE_COMMENT = PAGE_COMMENT;
exports.WINDOW_CARD_RENDERED_VARIABLE = WINDOW_CARD_RENDERED_VARIABLE;
exports.WINDOW_INJECT_FETCHED_CARD_NAME = WINDOW_INJECT_FETCHED_CARD_NAME;
exports.DISABLE_CARD_UPDATE_FUNCTIONS = DISABLE_CARD_UPDATE_FUNCTIONS;
exports.REFERENCES_INFO_CARD_PROPERTY = REFERENCES_INFO_CARD_PROPERTY;
exports.REFERENCES_INFO_INBOUND_CARD_PROPERTY = REFERENCES_INFO_INBOUND_CARD_PROPERTY;
exports.REFERENCES_CARD_PROPERTY = REFERENCES_CARD_PROPERTY;
exports.REFERENCES_INBOUND_CARD_PROPERTY = REFERENCES_INBOUND_CARD_PROPERTY;

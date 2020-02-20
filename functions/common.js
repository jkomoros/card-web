const admin = require('firebase-admin');
admin.initializeApp();

const functions = require('firebase-functions');

//We use this so often we might as well make it more common
const FieldValue = admin.firestore.FieldValue;
const db = admin.firestore();
const auth = admin.auth();
const config = functions.config();
const storage = admin.storage();

//DEV_MODE is true if the project name contains 'dev-' or '-dev'
const DEV_MODE = process.env.GCLOUD_PROJECT.toLowerCase().includes('dev-') || process.env.GCLOUD_PROJECT.toLowerCase().includes('-dev');
const DOMAIN = (config.site || {})  .domain || "thecompendium.cards";
const LAST_PROD_DEPLOY_AFFECTING_RENDERING = (config.site || {}).last_prod_deploy_affecting_rendering || "deploy-not-set";
//Copied from src/actions/app.js
const PAGE_DEFAULT = 'c';
const PAGE_COMMENT = 'comment';
const PAGE_BASIC_CARD = 'basic-card';
//copied from src/components/basic_card_view.js
const WINDOW_CARD_RENDERED_VARIABLE = 'BASIC_CARD_RENDERED';
//Note: screenshot.js uses the literal value of WINDOW_INJECT_FETCHED_CARD_NAME in the code;

const urlForBasicCard = (idOrSlug) => {
    return 'https://' + DOMAIN + '/' + PAGE_BASIC_CARD + '/' + idOrSlug;
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
exports.urlForBasicCard = urlForBasicCard;
exports.getCardName = getCardName;
exports.prettyCardURL = prettyCardURL;
exports.DEV_MODE = DEV_MODE;
exports.DOMAIN = DOMAIN;
exports.LAST_PROD_DEPLOY_AFFECTING_RENDERING = LAST_PROD_DEPLOY_AFFECTING_RENDERING;
exports.PAGE_DEFAULT = PAGE_DEFAULT;
exports.PAGE_COMMENT = PAGE_COMMENT;
exports.WINDOW_CARD_RENDERED_VARIABLE = WINDOW_CARD_RENDERED_VARIABLE;
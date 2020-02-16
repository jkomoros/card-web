const admin = require('firebase-admin');
admin.initializeApp();

const functions = require('firebase-functions');

//We use this so often we might as well make it more common
const FieldValue = admin.firestore.FieldValue;
const db = admin.firestore();
const auth = admin.auth();
const config = functions.config();

//DEV_MODE is true if the project name contains 'dev-' or '-dev'
const DEV_MODE = process.env.GCLOUD_PROJECT.toLowerCase().includes('dev-') || process.env.GCLOUD_PROJECT.toLowerCase().includes('-dev');
const DOMAIN = (config.site || {})  .domain || "thecompendium.cards";
//Copied from src/actions/app.js
const PAGE_DEFAULT = 'c';
const PAGE_COMMENT = 'comment';

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
exports.getUserDisplayName = getUserDisplayName;
exports.getCardName = getCardName;
exports.prettyCardURL = prettyCardURL;
exports.DEV_MODE = DEV_MODE;
exports.DOMAIN = DOMAIN;
exports.PAGE_DEFAULT = PAGE_DEFAULT;
exports.PAGE_COMMENT = PAGE_COMMENT;
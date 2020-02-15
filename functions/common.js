const admin = require('firebase-admin');
admin.initializeApp();

const functions = require('firebase-functions');

//We use this so often we might as well make it more common
const FieldValue = admin.firestore.FieldValue;
const db = admin.firestore();
const auth = admin.auth();
const config = functions.config();

const getUserDisplayName = async (uid) => {
    let user = await auth.getUser(uid);
    return user.displayName
}

const getCardName = async (cardId) => {
    //TODO: use the actual constants for cards collection (see #134)
    let card = await db.collection('cards').doc(cardId).get();
    return card.data().name || cardId;
}

exports.admin = admin;
exports.FieldValue = FieldValue;
exports.db = db;
exports.auth = auth;
exports.config = config;
exports.getUserDisplayName = getUserDisplayName;
exports.getCardName = getCardName;
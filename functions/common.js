const admin = require('firebase-admin');
admin.initializeApp();

//We use this so often we might as well make it more common
const FieldValue = admin.firestore.FieldValue;
const db = admin.firestore();
const auth = admin.auth();

exports.admin = admin;
exports.FieldValue = FieldValue;
exports.db = db;
exports.auth = auth;
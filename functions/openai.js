const functions = require('firebase-functions');

const handler = async () => {
    functions.https.HttpsError('not-implemented', 'Not yet implemented');
};

exports.handler = handler;
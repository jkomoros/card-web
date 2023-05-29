const functions = require('firebase-functions');

const handler = async () => {
    //TODO: check that request.uid.permissions is admin or api-callable and error if not
    //TODO: error if no openai key is set
    //TODO: Take the provided openai API request, inject the secret key, and proxy results.
    throw new functions.https.HttpsError('not-implemented', 'Not yet implemented');
};

exports.handler = handler;
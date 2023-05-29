const functions = require('firebase-functions');
const common = require('./common.js');

const openaiConfig = common.config.openai || null;
const openai_api_key = openaiConfig ? (openaiConfig.api_key || '') : '';

const handler = async () => {
    //TODO: check that request.uid.permissions is admin or api-callable and error if not

    if (!openai_api_key) {
        throw new functions.https.HttpsError('failed-precondition', 'OPENAI_API_KEY not set');
    }

    //TODO: Take the provided openai API request, inject the secret key, and proxy results.
    
    //Must be one of the error codes here: https://firebase.google.com/docs/reference/functions/firebase-functions.https.md#httpsfunctionserrorcode
    throw new functions.https.HttpsError('unimplemented', 'Not yet implemented');
};

exports.handler = handler;
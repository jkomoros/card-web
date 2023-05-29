const functions = require('firebase-functions');

const handler = async () => {
    //TODO: check that request.uid.permissions is admin or api-callable and error if not
    //TODO: error if no openai key is set
    //TODO: Take the provided openai API request, inject the secret key, and proxy results.

    //TODO: this doesn't actually get through to the client yet.
    
    //Must be one of the error codes here: https://firebase.google.com/docs/reference/functions/firebase-functions.https.md#httpsfunctionserrorcode
    throw new functions.https.HttpsError('unimplemented', 'Not yet implemented');
};

exports.handler = handler;
const functions = require('firebase-functions');
const common = require('./common.js');

const openaiConfig = common.config.openai || null;
const openai_api_key = openaiConfig ? (openaiConfig.api_key || '') : '';

const mayUseAI = (permissions) => {
    if (!permissions) return false;
    if (permissions.admin) return true;
    //TODO: also allow it if the ai permission is true.
    return false;
}

const handler = async (_, context) => {

    if (!openai_api_key) {
        throw new functions.https.HttpsError('failed-precondition', 'OPENAI_API_KEY not set');
    }

    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'A valid user authentication must be passed');
    }

    const permissions = await common.userPermissions(context.auth.uid);

    if (!mayUseAI(permissions)) {
        throw new functions.https.HttpsError('permission-denied', 'The user does not have adequate permissions to perrform this action');
    }

    //TODO: Take the provided openai API request, inject the secret key, and proxy results.
    
    throw new functions.https.HttpsError('unimplemented', 'Not yet implemented');
};

exports.handler = handler;
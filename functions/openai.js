const functions = require('firebase-functions');
const common = require('./common.js');
const { Configuration, OpenAIApi } = require("openai");

const openaiConfig = common.config.openai || null;
const openai_api_key = openaiConfig ? (openaiConfig.api_key || '') : '';

const configuration = new Configuration({
  apiKey: openai_api_key,
});
const openai = new OpenAIApi(configuration);

//The server-side analogue of selectUserMayUseAI
const mayUseAI = (permissions) => {
    if (!permissions) return false;
    if (permissions.admin) return true;
    if (permissions.remoteAI) return true;
    //TODO: also allow it if the ai permission is true.
    return false;
}

const ALLOWED_ENDPOINTS = {
    'createCompletion': true,
    'createChatCompletion': true
};

//data should have endpoint and payload
const handler = async (data, context) => {

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

    if (!data || typeof data !== "object") {
        throw new functions.https.HttpsError('invalid-argument', 'data must be an object');
    }

    if (!data.endpoint) {
        throw new functions.https.HttpsError('invalid-argument', 'endpoint must be provided');
    }

    if (!data.payload) {
        throw new functions.https.HttpsError('invalid-argument', 'payload must be provided');
    }

    if (!ALLOWED_ENDPOINTS[data.endpoint]) {
        throw new functions.https.HttpsError('invalid-argument', 'endpoint must be set to an allowed endpoint type');
    }

    //TODO: if it throws an error with a code, is it possible to pass that along directly?
    const result = await openai[data.endpoint](data.payload);

    //TODO: pass more JSON-able properties back
    return result.data;
};

exports.handler = handler;
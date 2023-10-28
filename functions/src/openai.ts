import * as functions from 'firebase-functions';

import {
    Configuration,
    OpenAIApi
} from 'openai';

import {
    config,
    userPermissions
} from './common.js';

import {
    UserPermissions
} from './types.js';

const openaiConfig = config.openai || null;
const openai_api_key = openaiConfig ? (openaiConfig.api_key || '') : '';

const configuration = new Configuration({
  apiKey: openai_api_key,
});
export const openai_endpoint = new OpenAIApi(configuration);

//The server-side analogue of selectUserMayUseAI
const mayUseAI = (permissions : UserPermissions | null) => {
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

type OpenAIData = {
    endpoint: keyof (typeof ALLOWED_ENDPOINTS)
    payload: unknown
};

//data should have endpoint and payload
export const handler = async (data : OpenAIData, context : functions.https.CallableContext) => {

    if (!openai_api_key) {
        throw new functions.https.HttpsError('failed-precondition', 'OPENAI_API_KEY not set');
    }

    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'A valid user authentication must be passed');
    }

    const permissions = await userPermissions(context.auth.uid);

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

    try {
        const result = await openai_endpoint[data.endpoint](data.payload as any);
        return result.data;
    } catch(err) {
        if (!err || typeof err != 'object') throw new functions.https.HttpsError('unknown', String(err));
        //err is either an err.response.statusText/status or err.message
        if ('response' in err) {
            const response = err.response as {statusText: string, status: number};
            throw new functions.https.HttpsError('unknown', response.statusText, {
                status: response.status,
                statusText: response.statusText
            });
        }
        const errAsError = err as Error;
        throw new functions.https.HttpsError('unknown', errAsError.message);
    }
};

import {
	onRequest,
	onCall,
	HttpsError,
	CallableRequest
} from 'firebase-functions/v2/https';

import {
	onSchedule
} from 'firebase-functions/v2/scheduler';

import {
	onDocumentCreated,
	onDocumentWritten
} from 'firebase-functions/v2/firestore';

//Necessary to make console.log work in v2 functions:
//https://firebase.google.com/docs/functions/writing-and-viewing-logs?gen=2nd#console-log
import 'firebase-functions/logger/compat';

//TODO: include the same file as we do for the client for the canonical names of
//collections.

import express from 'express';
import cors from 'cors';

import * as email from './email.js';
import * as twitter from './twitter.js';

import {
	fetchScreenshotByIDOrSlug
} from './screenshot.js';

import {
	slug
} from './legal.js';

import {
	processCardEmbedding,
	reindexCardEmbeddings as reindexCardEmbeddingsImpl,
	cleanupOldEmbeddings as cleanupOldEmbeddingsImpl,
	similarCards as similarCardsImpl,
	semanticSort as semanticSortImpl
} from './embeddings.js';

import * as openaiimpl from './openai.js';
import * as anthropicimpl from './anthropic.js';
import * as chatImpl from './chat.js';
import { LegalRequestData, LegalResponseData } from '../../shared/types.js';

import {
	CHAT_CREATE_MESSAGE_ROUTE,
	CHAT_POST_MESSAGE_ROUTE,
	CHAT_RETRY_MESSAGE_ROUTE,
	CHAT_STREAM_MESSAGE_ROUTE
} from '../../shared/env-constants.js';

//Runs every three hours
export const fetchTweetEngagement = onSchedule({
	schedule: '0 */3 * * *',
	timeZone: 'America/Los_Angeles'
}, twitter.fetchTweetEngagement);

//Run four times a day, at 8:07, 12:07, 17:07, and 20:07.
//NOTE: if you update this schedule in code,it
//likely won't update the cloud scheduler, you'll have to delete the cloud
//function and redeploy, or manually change hte cloud schedule.
export const autoTweet = onSchedule({
	schedule: '7 8,12,17,20 * * *',
	timeZone: 'America/Los_Angeles',
	//Set to a larger amount of memory and longer timeout since sometimes the
	//tweet will need to generate a screenshot which might take up to a minute
	memory: '1GiB',
	timeoutSeconds: 300
}, twitter.tweetCard);

export const emailAdminOnStar = onDocumentCreated('stars/{starId}', email.onStar);

export const emailAdminOnMessage = onDocumentCreated('messages/{messageId}', email.onMessage);

export const updateCardEmbedding = onDocumentWritten('cards/{cardID}', processCardEmbedding);

const reindexCardEmbeddingsApp = express();
reindexCardEmbeddingsApp.post('/', async(req, res) => {
	try{
		await reindexCardEmbeddingsImpl();
	} catch(err) {
		res.status(500).send(String(err));
	}
	res.status(200).send('Success');
});

export const reindexCardEmbeddings = onRequest({
	memory: '1GiB',
	timeoutSeconds: 3600
}, reindexCardEmbeddingsApp);

const cleanupOldEmbeddingsApp = express();
cleanupOldEmbeddingsApp.post('/', async(req, res) => {
	try{
		const versions = req.body?.versions || [0]; // versions to delete
		if (!Array.isArray(versions) || versions.length === 0) {
			res.status(400).send('Invalid versions array provided');
			return;
		}
		await cleanupOldEmbeddingsImpl(versions);
		res.status(200).send(`Successfully cleaned up versions: ${versions.join(', ')}`);
	} catch(err) {
		res.status(500).send(String(err));
	}
});

export const cleanupOldEmbeddings = onRequest({
	memory: '1GiB',
	timeoutSeconds: 3600
}, cleanupOldEmbeddingsApp);

const screenshotApp = express();
screenshotApp.get('/:id', async (req, res) => {
	const png = await fetchScreenshotByIDOrSlug(req.params.id);
	if (png) {
		res.status(200).type('png').send(png);
	}
	res.status(404).end();
});

export const semanticSort = onCall({}, semanticSortImpl);

export const similarCards = onCall({}, similarCardsImpl);

export const screenshot = onRequest({
	memory: '1GiB'
}, screenshotApp);

//expects data to have type:{slug},  and value be the string to check
export const legal = onCall({}, async (request : CallableRequest<LegalRequestData>) : Promise<LegalResponseData> => {
	const data = request.data;
	if (data.type === 'warmup') {
		return {
			legal: true,
			reason: '',
		};
	}
	if (data.type !== 'slug') {
		//Typescript says "don't worry, it's not possible to get a different type", but we want to be sure.
		//eslint-disable-next-line @typescript-eslint/no-explicit-any
		throw new HttpsError('invalid-argument', 'Invalid type: ' + (data as any).type);
	}
	const result = await slug(data.value);
	return {
		legal: result ? false : true,
		reason: result
	};
});

export const openai = onCall({}, openaiimpl.handler);
export const anthropic = onCall({}, anthropicimpl.handler);

// Create Express app for chat endpoints
const chatApp = express();
// Configure CORS middleware
chatApp.use(cors({ origin: true }));
// Configure middleware to parse JSON
chatApp.use(express.json());
chatApp.post(CHAT_POST_MESSAGE_ROUTE, chatImpl.postMessageInChatHandler);
chatApp.post(CHAT_CREATE_MESSAGE_ROUTE, chatImpl.createChatHandler);
chatApp.post(CHAT_STREAM_MESSAGE_ROUTE, chatImpl.streamMessageHandler);
chatApp.post(CHAT_RETRY_MESSAGE_ROUTE, chatImpl.retryMessageHandler);

export const chat = onRequest({
	memory: '1GiB',
	timeoutSeconds: 300
}, chatApp);
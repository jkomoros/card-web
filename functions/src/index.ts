
import * as functions from 'firebase-functions';

import {
	onRequest,
	onCall
} from 'firebase-functions/v2/https';

import {
	onSchedule
} from 'firebase-functions/v2/scheduler';

import {
	onDocumentCreated
} from 'firebase-functions/v2/firestore';

//TODO: include the same file as we do for the client for the canonical names of
//collections.

import express from 'express';

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
	reindexCardEmbeddings as reindexCardEmbeddingsImpl
} from './embeddings.js';

import * as openaiimpl from './openai.js';

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

export const updateCardEmbedding = functions.runWith({
	//Since we'll hit the hnsw saving/restoring, and we should only have a
	//very small number of concurrent editors, set to a max instance of one
	//to make it less likely we have collisions.
	maxInstances: 1
}).firestore.
	document('cards/{cardID}').
	onWrite(processCardEmbedding);

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
	memory: '512MiB',
	timeoutSeconds: 540
}, reindexCardEmbeddingsApp);

const screenshotApp = express();
screenshotApp.get('/:id', async (req, res) => {
	const png = await fetchScreenshotByIDOrSlug(req.params.id);
	if (png) {
		res.status(200).type('png').send(png);
	}
	res.status(404).end();
});

export const screenshot = onRequest({
	memory: '1GiB'
}, screenshotApp);

//expects data to have type:{slug},  and value be the string to check
export const legal = onCall({}, async (request) => {
	const data = request.data;
	if (data.type === 'warmup') {
		return {
			legal: true,
			reason: '',
		};
	}
	if (data.type !== 'slug') {
		throw new functions.https.HttpsError('invalid-argument', 'Invalid type: ' + data.type);
	}
	const result = await slug(data.value);
	return {
		legal: result ? false : true,
		reason: result
	};
});

export const openai = onCall({}, openaiimpl.handler);
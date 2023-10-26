
import * as functions from "firebase-functions";

//TODO: include the same file as we do for the client for the canonical names of
//collections.

import express from "express";

import * as email from "./email.js";
import * as twitter from "./twitter.js";

import {
	fetchScreenshotByIDOrSlug
} from "./screenshot.js";

import {
	slug
} from "./legal.js";

import * as openaiimpl from "./openai.js";

//Runs every three hours
export const fetchTweetEngagement = functions.pubsub.schedule('0 */3 * * *').timeZone('America/Los_Angeles').onRun(twitter.fetchTweetEngagement);

//Run four times a day, at 8:07, 12:07, 17:07, and 20:07.
//NOTE: if you update this schedule in code,it
//likely won't update the cloud scheduler, you'll have to delete the cloud
//function and redeploy, or manually change hte cloud schedule.
export const autoTweet = functions.runWith({
	//Set to a larger amount of memory and longer timeout since sometimes the
	//tweet will need to generate a screenshot which might take up to a minute
	memory: '1GB',
	timeoutSeconds: 300,
}).pubsub.schedule('7 8,12,17,20 * * *').timeZone('America/Los_Angeles').onRun(twitter.tweetCard);

export const emailAdminOnStar = functions.firestore.
	document('stars/{starId}').
	onCreate(email.onStar);

export const emailAdminOnMessage = functions.firestore.
	document('messages/{messageId}').
	onCreate(email.onMessage);

const screenshotApp = express();
screenshotApp.get('/:id', async (req, res) => {
	const png = await fetchScreenshotByIDOrSlug(req.params.id);
	if (png) {
		res.status(200).type('png').send(png);
	}
	res.status(404).end();
});

export const screenshot = functions.runWith({
	memory: '1GB'
}).https.onRequest(screenshotApp);

//expects data to have type:{slug},  and value be the string to check
export const legal = functions.https.onCall(async (data) => {
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

export const openai = functions.https.onCall(openaiimpl.handler);
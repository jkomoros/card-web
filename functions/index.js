const functions = require('firebase-functions');

//TODO: include the same file as we do for the client for the canonical names of
//collections.

const express = require('express');

const email = require('./email.js');
const twitter = require('./twitter.js');
const update = require('./update.js');
const screenshot = require('./screenshot.js');
const legal = require('./legal.js');

//Runs every three hours
exports.fetchTweetEngagement = functions.pubsub.schedule('0 */3 * * *').timeZone('America/Los_Angeles').onRun(twitter.fetchTweetEngagement);

//Run four times a day, at 8:07, 12:07, 17:07, and 20:07.
//NOTE: if you update this schedule in code,it
//likely won't update the cloud scheduler, you'll have to delete the cloud
//function and redeploy, or manually change hte cloud schedule.
exports.autoTweet = functions.runWith({
    //Set to a larger amount of memory and longer timeout since sometimes the
    //tweet will need to generate a screenshot which might take up to a minute
    memory: '1GB',
    timeoutSeconds: 300,
}).pubsub.schedule('7 8,12,17,20 * * *').timeZone('America/Los_Angeles').onRun(twitter.tweetCard);

exports.emailAdminOnStar = functions.firestore.
    document('stars/{starId}').
    onCreate(email.onStar);

exports.emailAdminOnMessage = functions.firestore.
    document('messages/{messageId}').
    onCreate(email.onMessage);


exports.updateInboundLinks = functions.firestore.
    document('cards/{cardId}').
    onUpdate(update.inboundLinks);

const screenshotApp = express();
screenshotApp.get('/:id', async (req, res) => {
    const png = await screenshot.fetchScreenshotByIDOrSlug(req.params.id);
    if (png) {
        res.status(200).type('png').send(png);
    }
    res.status(404).end();
});

exports.screenshot = functions.runWith({
    memory: '1GB'
}).https.onRequest(screenshotApp);

const legalApp = express();
legalApp.get('/slug/:val', async (req, res) => {
    //result will be a zero length string if OK
    const result = await legal.slug(req.params.val);
    res.status(200).type('json').send({
        status: 'ok',
        legal: result ? false : true,
        reason: result
    });
})

exports.legal = functions.https.onRequest(legalApp);
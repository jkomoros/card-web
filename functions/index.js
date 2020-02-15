const functions = require('firebase-functions');

//TODO: include the same file as we do for the client for the canonical names of
//collections.

const email = require('./email.js');
const twitter = require('./twitter.js');

const common = require('./common.js');
const db = common.db;
const FieldValue = common.FieldValue;

//Runs every three hours
exports.fetchTweetEngagement = functions.pubsub.schedule('0 */3 * * *').timeZone('America/Los_Angeles').onRun(twitter.fetchTweetEngagement);

//Run four times a day, at 8:07, 12:07, 17:07, and 20:07.
//NOTE: if you update this schedule in code,it
//likely won't update the cloud scheduler, you'll have to delete the cloud
//function and redeploy, or manually change hte cloud schedule.
exports.autoTweet = functions.pubsub.schedule('7 8,12,17,20 * * *').timeZone('America/Los_Angeles').onRun(twitter.tweetCard);

exports.emailAdminOnStar = functions.firestore.
    document('stars/{starId}').
    onCreate(email.onStar);

exports.emailAdminOnMessage = functions.firestore.
    document('messages/{messageId}').
    onCreate(email.onMessage);


const arrayDiff = (before, after) => {
    let afterMap = new Map();
    for (let item of after) {
        afterMap.set(item, true);
    }
    let deletions = [];
    for (let item of before) {
        if (afterMap.has(item)) {
            //Keep track of that we've seen this one
            afterMap.delete(item);
        } else {
            deletions.push(item);
        }
    }
    //Additions is the keys not remved in afterMap
    let additions = [...afterMap.keys()];
    return [additions, deletions];
};

exports.updateInboundLinks = functions.firestore.
    document('cards/{cardId}').
    onUpdate((change, context) => {

        let [additions, deletions] = arrayDiff(change.before.data().links, change.after.data().links);

        if (additions.length === 0 && deletions.length === 0) return Promise.resolve();

        let cardId = context.params.cardId;

        let batch = db.batch();

        for (let card of additions) {
            let ref = db.collection('cards').doc(card);
            batch.update(ref, {
                links_inbound: FieldValue.arrayUnion(cardId)
            });
        }

        for (let card of deletions) {
            let ref = db.collection('cards').doc(card);
            batch.update(ref, {
                links_inbound: FieldValue.arrayRemove(cardId)
            });
        }

        return batch.commit();


    });
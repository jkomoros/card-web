const functions = require('firebase-functions');

const nodemailer = require('nodemailer');
const postmarkTransport = require('nodemailer-postmark-transport');

const Twitter = require('twitter');
const stable = require('stable');

const fromEntries = require('fromentries');

//In DEV_MODE generally we don't actually send a tweet. but sometimes you need
//to test the actual tweet sending works, and in those cases you can flip this
//on temporarily, but don't commit!
const OVERRIDE_TWEET_IN_DEV_MODE = false;

//TODO: include the same file as we do for the client for the canonical names of
//collections.

//This number will be stored in tweetInfos, allowing us in the future to easily
//check the history of tweets for example if we change the message style we
//post.
const AUTO_TWEET_VERSION = 1.0;

//This is the max number of tweets to fetch engagement for, and should be set to
//at or below the limit in the twitter API.
const MAX_TWEETS_TO_FETCH = 100;

let twitterClient = null;

const tweetSorter = require('./tweet-helpers.js');

const common = require('./common.js');
const db = common.db;
const FieldValue = common.FieldValue;

//Fetch once to save typing but also to guard against the case where no twitter
//configs are set, so this whole object will be undefined.
const twitterConfig = common.config.twitter;

if (!twitterConfig || !twitterConfig.consumer_key || !twitterConfig.consumer_secret || !twitterConfig.access_token_key || !twitterConfig.access_token_secret) {
    console.warn('The twitter keys are not configured, so tweets will not actually be sent. See README.md for how to set them up.')
} else {
    twitterClient = new Twitter({
        consumer_key: twitterConfig.consumer_key,
        consumer_secret: twitterConfig.consumer_secret,
        access_token_key: twitterConfig.access_token_key,
        access_token_secret: twitterConfig.access_token_secret
    });
}

let mailTransport = null;

const postmarkKey = (common.config.postmark || {}).key;
if (postmarkKey) {
    mailTransport = nodemailer.createTransport(postmarkTransport({
        auth: {
            apiKey: postmarkKey
        }
    }));
} else {
    console.warn("No postmark key provided. See README.md on how to set it up.")
}

const adminEmail = (common.config.email || {}).to;
if (!adminEmail) console.warn("No admin email provided. See README.md on how to set it up.");

const fromEmail = (common.config.email || {}).from;
if (!fromEmail) console.warn("No from email provided. See README.md on how to set it up.");

const domain = (common.config.site || {})  .domain || "thecompendium.cards";

//sendTweet sends the tweet and returns a tweet ID if the database shoould be
//marked that a tweet was sent.
const sendTweet = async (message) => {
    if (common.DEV_MODE && !OVERRIDE_TWEET_IN_DEV_MODE) {
        console.log("Tweet that would have been sent if this weren't a dev project: " + message);
        return {
           'id': "FAKE_TWEET_ID_" + Math.floor(Math.random() * 10000000),
           'user_screen_name': 'FAUXTWEETUSER',
           'user_id': 'FAUXTWEETUSERID',
           'truncated': false,
           'supplied_text': message,
           'posted_text': message,
           'auto_tweet_version': AUTO_TWEET_VERSION,
           'fake': true,
        };
    }
    if (!twitterClient) {
        console.log("Twitter client not set up. Tweet that would have been sent: " + message);
        return null;
    }
    let tweet = await twitterClient.post('statuses/update', {status: message});
    return {
        'id': tweet.id_str,
        'user_screen_name': tweet.user ? tweet.user.screen_name : '',
        'user_id': tweet.user ? tweet.user.id_str : '',
        'posted_text': tweet.text,
        'supplied_text': message,
        'truncated': tweet.truncated,
        'auto_tweet_version': AUTO_TWEET_VERSION,
        'fake': false,
    };
}

const sendEmail = (subject, message) => {
    const mailOptions = {
        from: fromEmail,
        to: adminEmail,
        subject: subject,
        html: message
    };

    if (!mailTransport) {
        console.warn("Mail transport not set up due to missing config. Would have sent: ", mailOptions);
        return new Promise().resolve();
    }

    return mailTransport.sendMail(mailOptions)
        .then(() => console.log('Sent email with message ' + subject))
        .catch((error) => console.error("Couldn't send email with message " + subject + ": " + error))
};

const selectCardToTweet = async () => {
    //Tweet card selects a tweet to send and sends it.
    let rawCards = await db.collection('cards').where('published', '==', true).where('card_type', '==', 'content').get();
    let rawSections = await db.collection('sections').orderBy('order').get();

    let sectionsMap = fromEntries(rawSections.docs.map(snapshot => [snapshot.id, snapshot.data()]));
    let cardsMap = fromEntries(rawCards.docs.map(snapshot => [snapshot.id, Object.assign({id: snapshot.id}, snapshot.data())]));

    //We want the order of cards to be the same as the default order in the
    //client so we see the same thing there. The last reduce step is equivalent
    //to flat(), but flat doesn't exist in node 8.
    let cardIDsInOrder = Object.entries(sectionsMap).map(entry => entry[1].cards).reduce((accum, val) => accum.concat(val), []);

    //Note: at this point cardIDsinOrder contains IDs for cards that aren't in
    //cardsMap because they aren't published or aren't of type content, so
    //werent' fetched.

    //Extract the full data for each card, stuff in the ID, and then remove
    //cards who do not have a valid slug set (and skip ones that were in the id
    //list but weren't fetched)
    let cards = cardIDsInOrder.map(id => cardsMap[id]).filter(card => card && card.name !== card.id);
    
    let sortInfos = new Map(cards.map(card => [card.id, tweetSorter.tweetOrderExtractor(card, sectionsMap, cardsMap)]));
    
    let sorter = (left, right) => {
        if(!left || !right) return 0;
        //Info is the underlying sort value, then the label value.
        const leftInfo = sortInfos.get(left.id);
        const rightInfo = sortInfos.get(right.id);
        if (!leftInfo || !rightInfo) return 0;
        return rightInfo[0] - leftInfo[0];
    };
    //array.sort is not stable in Node 8. All browsers in 2019 now have a stable
    //sort (https://v8.dev/features/stable-sort), but Node doesn't until version
    //11 (https://github.com/nodejs/node/pull/22754#issuecomment-419551068 ).
    const sortedCards = stable(cards, sorter);

    return selectCardToTweetFromSortedList(sortedCards, sortInfos);
}

//cards is a sorted list of expanded cards. sortInfos is a Map of card.id =>
//[sort-value, sort-value]
const selectCardToTweetFromSortedList = (cards, sortInfos) => {
    if (!cards || cards.length === 0) return null;

    //Collect all of the cards at the front that are the same sort value, so
    //equivalent.
    let firstEquivalenceClass = [];
    let equivalentClassSortValue = sortInfos.get(cards[0].id)[0];
    for (let i = 0; i < cards.length; i++) {
        const card = cards[i];
        if (sortInfos.get(card.id)[0] !== equivalentClassSortValue) {
            break;
        }
        firstEquivalenceClass.push(card);
    }

    //Pick a random card from the equivalence list, so the tweet order has a bit
    //of spice and isn't just "tweet things in order".
    return firstEquivalenceClass[Math.floor(Math.random()*firstEquivalenceClass.length)];
}

const prettyCardURL = (card) => {
    return 'https://' + domain + '/c/' + card.name;
}

const markCardTweeted = async (card, tweetInfo) => {

    //If the tweetInfo doesn't exist then a tweet didn't go out (or we shouldn't
    //even bother pretending one did).
    if (!tweetInfo) return;

    const cardRef = db.collection('cards').doc(card.id);
    const tweetRef = db.collection('tweets').doc(tweetInfo.id);

    let batch = db.batch();

    batch.update(cardRef, {
        tweet_count: FieldValue.increment(1),
        last_tweeted: FieldValue.serverTimestamp(),
    })

    let extendedTweetInfo = Object.assign({}, tweetInfo);
    extendedTweetInfo.created = FieldValue.serverTimestamp();
    extendedTweetInfo.card = card.id;
    extendedTweetInfo.archived = false;
    extendedTweetInfo.archive_date = new Date(0);
    extendedTweetInfo.retweet_count = 0;
    extendedTweetInfo.favorite_count = 0;
    //Last time we fetched and updated the retweet and favorite counts
    extendedTweetInfo.engagement_last_fetched = new Date(0);
    //Last time the retweet or favorite counts CHANGED from what we already had
    //stored.
    extendedTweetInfo.engagement_last_changed = new Date(0);

    batch.create(tweetRef, extendedTweetInfo);

    console.log("Card tweeted " + card.id + ' ' + tweetInfo.id);

    await batch.commit();
}

const fetchTweetEngagement = async() => {

    if (!twitterClient) {
        console.warn("Twitter client not configured, so cant' fetch tweets");
        return;
    }

    const tweets = await db.collection('tweets').where('fake', '==', false).where('archived', '==', false).orderBy('engagement_last_fetched', 'asc').limit(MAX_TWEETS_TO_FETCH).get();
    const tweetIDs = tweets.docs.map(doc => doc.id);
    if (tweetIDs.length === 0) {
        console.log("No tweets to fetch");
        return;
    }

    //map means "for tweets that are deleted or invisible, return null in that spot instead of skipping"
    let tweetInfos = await twitterClient.get('statuses/lookup', {map: true, id: tweetIDs.join(',')});

    //Because map = true, the shape of tweetInfos, instead of being an array of
    //infos, is a map with a single key of 'id', which itself a map of id_str to
    //tweetInfoOrNull.
    if (!tweetInfos.id) {
        console.warn('We expected the tweetInfos API result to be a map with a key of "id" but it wasn\'t');
        return;
    }

    tweetInfos = tweetInfos.id;
    //tweetInfos is now a map of id_str to tweetInfoOrNull

    let transactionPromises = [];

    for (let entry of Object.entries(tweetInfos)) {
        const tweetInfo = entry[1];
        const tweetID = entry[0];
        const tweetRef = db.collection('tweets').doc(tweetID);

        //Note: because we sent map:true to the twitter API, tweets that no
        //longer exist will be null tweetInfo. If that happens, archive them so
        //we don't continue trying to fetch them in the future.
        if (!tweetInfo) {
            console.log('Tweet ' + tweetID + ' appeared to have been deleted, marking as archived');
            transactionPromises.push(tweetRef.update({
                archived: true,
                archive_date: FieldValue.serverTimestamp(),
                engagement_last_fetched: FieldValue.serverTimestamp(),
            }));
            continue;
        }

        const retweet_count = tweetInfo.retweet_count;
        const favorite_count = tweetInfo.favorite_count;

        let transactionPromise = db.runTransaction(async transaction => {
            let tweetDoc = await transaction.get(tweetRef);
            if (!tweetDoc.exists) {
                throw new Error('Tweet with id ' + tweetID + ' not found in tweets collection');
            }

            let tweetDocUpdate = {'engagement_last_fetched': FieldValue.serverTimestamp()}

            if (retweet_count !== tweetDoc.data().retweet_count || favorite_count !== tweetDoc.data().favorite_count) {

                //Something has changed since we last fetched.
                tweetDocUpdate.engagement_last_changed = FieldValue.serverTimestamp();
                tweetDocUpdate.retweet_count = retweet_count;
                tweetDocUpdate.favorite_count = favorite_count;

                const cardID = tweetDoc.data().card;
                const cardRef = db.collection('cards').doc(cardID);
                let cardDoc = await transaction.get(cardRef);
                if (!cardDoc.exists) {
                    throw new Error('Card with ID ' + cardID + ' doesn\'t exist!');
                }

                let cardUpdateDoc = {};
                let starCountDiff = 0;

                if (retweet_count !== tweetDoc.data().retweet_count) {
                    let retweetDiff = retweet_count - tweetDoc.data().retweet_count;
                    starCountDiff += retweetDiff;
                    cardUpdateDoc.tweet_retweet_count = FieldValue.increment(retweetDiff);
                }

                if (favorite_count !== tweetDoc.data().favorite_count) {
                    let favoriteDiff = favorite_count - tweetDoc.data().favorite_count;
                    starCountDiff += favoriteDiff;
                    cardUpdateDoc.tweet_favorite_count = FieldValue.increment(favoriteDiff);
                }

                cardUpdateDoc.star_count = FieldValue.increment(starCountDiff);

                transaction.update(cardRef, cardUpdateDoc);
            }

            transaction.update(tweetRef, tweetDocUpdate);

        });
        transactionPromises.push(transactionPromise);
    }

    await Promise.all(transactionPromises);

}

//Runs every three hours
exports.fetchTweetEngagement = functions.pubsub.schedule('0 */3 * * *').timeZone('America/Los_Angeles').onRun(context => {
    return fetchTweetEngagement();
});

const tweetCard = async () => {
    const card = await selectCardToTweet();
    const url = prettyCardURL(card);
    const message = card.title + ' ' + url;
    const tweetInfo = await sendTweet(message);
    await markCardTweeted(card, tweetInfo);
}

//Run four times a day, at 8:07, 12:07, 17:07, and 20:07.
//NOTE: if you update this schedule in code,it
//likely won't update the cloud scheduler, you'll have to delete the cloud
//function and redeploy, or manually change hte cloud schedule.
exports.autoTweet = functions.pubsub.schedule('7 8,12,17,20 * * *').timeZone('America/Los_Angeles').onRun(context => {
    return tweetCard();
});

const emailAdminOnStar = async (snapshot, context) => {
    const cardId = snapshot.data().card;
    const authorId = snapshot.data().owner;

    const authorString = await common.getUserDisplayName(authorId);
    const cardTitle = await common.getCardName(cardId);

    const subject = 'User ' + authorString + ' starred card ' + cardTitle;
    const message = 'User ' + authorString + ' (' + authorId +  ') starred card <a href="https://' + domain + '/c/' + cardId +'">' + cardTitle + ' (' + cardId + ')</a>.';

    sendEmail(subject, message);

};

const emailAdminOnMessage = async (snapshot, context) => {
    const cardId = snapshot.data().card;
    const authorId = snapshot.data().author;
    const messageText = snapshot.data().message;
    const messageId = context.params.messageId;

    const authorString = await common.getUserDisplayName(authorId);
    const cardTitle = await common.getCardName(cardId);

    const subject = 'User ' + authorString + ' left message on card ' + cardTitle;
    const message = 'User ' + authorString + ' (' + authorId + ') left message on card <a href="https://' + domain + '/comment/' + messageId +'">' + cardTitle + ' (' + cardId + ')</a>: <p>' + messageText + '</p>';

    sendEmail(subject, message);

};

exports.emailAdminOnStar = functions.firestore.
    document('stars/{starId}').
    onCreate(emailAdminOnStar);

exports.emailAdminOnMessage = functions.firestore.
    document('messages/{messageId}').
    onCreate(emailAdminOnMessage);


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
const functions = require('firebase-functions');

const nodemailer = require('nodemailer');
const postmarkTransport = require('nodemailer-postmark-transport');

const Twitter = require('twitter');

const fromEntries = require('fromentries');

const admin = require('firebase-admin');
admin.initializeApp();

const db = admin.firestore();

//DEV_MODE is true if the project name contains 'dev-' or '-dev'
const DEV_MODE = process.env.GCLOUD_PROJECT.toLowerCase().includes('dev-') || process.env.GCLOUD_PROJECT.toLowerCase().includes('-dev');

//TODO: include the same file as we do for the client for the canonical names of
//collections.

let twitterClient = null;

const tweetSorter = require('./tweet-helpers.js');

//Fetch once to save typing but also to guard against the case where no twitter
//configs are set, so this whole object will be undefined.
const twitterConfig = functions.config().twitter;

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

const postmarkKey = (functions.config().postmark || {}).key;
if (postmarkKey) {
    mailTransport = nodemailer.createTransport(postmarkTransport({
        auth: {
            apiKey: postmarkKey
        }
    }));
} else {
    console.warn("No postmark key provided. See README.md on how to set it up.")
}

const adminEmail = (functions.config().email || {}).to;
if (!adminEmail) console.warn("No admin email provided. See README.md on how to set it up.");

const fromEmail = (functions.config().email || {}).from;
if (!fromEmail) console.warn("No from email provided. See README.md on how to set it up.");

const domain = (functions.config().site || {})  .domain || "thecompendium.cards";

//sendTweet sends the tweet and returns a tweet ID if the database shoould be
//marked that a tweet was sent.
const sendTweet = async (message) => {
    if (DEV_MODE) {
        console.log("Tweet that would have been sent if this weren't a dev project: " + message);
        return "FAKE_TWEET_ID_" + Math.floor(Math.random() * 10000000);
    }
    if (!twitterClient) {
        console.log("Twitter client not set up. Tweet that would have been sent: " + message);
        return "";
    }
    let tweet = await twitterClient.post('statuses/update', {status: message});
    return tweet.id_str;
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

const getUserDisplayName = async (uid) => {
    let user = await admin.auth().getUser(uid);
    return user.displayName
}

const getCardName = async (cardId) => {
    //TODO: use the actual constants for cards collection (see #134)
    let card = await admin.firestore().collection('cards').doc(cardId).get();
    return card.data().name || cardId;
}

const selectCardToTweet = async () => {
    //Tweet card selects a tweet to send and sends it.
    let rawCards = await admin.firestore().collection('cards').where('published', '==', true).where('card_type', '==', 'content').get();
    let rawSections = await admin.firestore().collection('sections').orderBy('order').get();

    //Extract the full data for each card, stuff in the ID, and then remove
    //cards who do not have a valid slug set.
    let cards = rawCards.docs.map(snapshot => {
        let result = snapshot.data();
        result.id = snapshot.id;
        return result
    }).filter( card => card.name !== card.id);

    let sectionsMap = fromEntries(rawSections.docs.map(snapshot => [snapshot.id, snapshot.data()]));
    
    let sortInfos = new Map(cards.map(card => [card.id, tweetSorter.tweetOrderExtractor(card, sectionsMap)]));
    
    let sorter = (left, right) => {
        if(!left || !right) return 0;
        //Info is the underlying sort value, then the label value.
        const leftInfo = sortInfos.get(left.id);
        const rightInfo = sortInfos.get(right.id);
        if (!leftInfo || !rightInfo) return 0;
        return rightInfo[0] - leftInfo[0];
    };
    cards.sort(sorter);

    return cards[0];
}

const prettyCardURL = (card) => {
    return 'https://' + domain + '/c/' + card.name;
}

const markCardTweeted = async (card, tweetID) => {

    //If the tweetID doesn't exist then a tweet didn't go out (or we shouldn't
    //even bother pretending one did).
    if (!tweetID) return;

    const cardRef = admin.firestore().collection('cards').doc(card.id);
    const cardTweetRef = cardRef.collection('tweets').doc(String(Date.now()));

    let batch = admin.firestore().batch();

    batch.update(cardRef, {
        tweet_count: admin.firestore.FieldValue.increment(1),
        last_tweeted: admin.firestore.FieldValue.serverTimestamp(),
    })

    batch.create(cardTweetRef, {
        id: tweetID,
        created: admin.firestore.FieldValue.serverTimestamp(),
    })

    console.log("Card tweeted " + card.id + ' ' + tweetID);

    await batch.commit();
}

const tweetCard = async () => {
    const card = await selectCardToTweet();
    const url = prettyCardURL(card);
    const message = card.title + ' ' + url;
    const tweetID = await sendTweet(message);
    await markCardTweeted(card, tweetID);
}

//Run every day at 8:07AM PST
exports.autoTweetDaily = functions.pubsub.schedule('7 8 * * *').timeZone('America/Los_Angeles').onRun(context => {
    return tweetCard();
});

exports.emailAdminOnStar = functions.firestore.
    document('stars/{starId}').
    onCreate(async (snapshot, context) => {
        const cardId = snapshot.data().card;
        const authorId = snapshot.data().owner;

        const authorString = await getUserDisplayName(authorId);
        const cardTitle = await getCardName(cardId);

        const subject = 'User ' + authorString + ' starred card ' + cardTitle;
        const message = 'User ' + authorString + ' (' + authorId +  ') starred card <a href="https://' + domain + '/c/' + cardId +'">' + cardTitle + ' (' + cardId + ')</a>.';

        sendEmail(subject, message);

    })

exports.emailAdminOnMessage = functions.firestore.
    document('messages/{messageId}').
    onCreate(async (snapshot, context) => {
        const cardId = snapshot.data().card;
        const authorId = snapshot.data().author;
        const messageText = snapshot.data().message;
        const messageId = context.params.messageId;

        const authorString = await getUserDisplayName(authorId);
        const cardTitle = await getCardName(cardId);

        const subject = 'User ' + authorString + ' left message on card ' + cardTitle;
        const message = 'User ' + authorString + ' (' + authorId + ') left message on card <a href="https://' + domain + '/comment/' + messageId +'">' + cardTitle + ' (' + cardId + ')</a>: <p>' + messageText + '</p>';

        sendEmail(subject, message);

    })


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
                links_inbound: admin.firestore.FieldValue.arrayUnion(cardId)
            });
        }

        for (let card of deletions) {
            let ref = db.collection('cards').doc(card);
            batch.update(ref, {
                links_inbound: admin.firestore.FieldValue.arrayRemove(cardId)
            });
        }

        return batch.commit();


    });
const functions = require('firebase-functions');

const nodemailer = require('nodemailer');
const postmarkTransport = require('nodemailer-postmark-transport');

const Twitter = require('twitter');

const admin = require('firebase-admin');
admin.initializeApp();

const db = admin.firestore();

//TODO: include the same file as we do for the client for the canonical names of
//collections.

const twitterConsumerKey = functions.config().twitter.consumer_key;
const twitterConsumerSecret = functions.config().twitter.consumer_secret;
const twitterAccessTokenKey = functions.config().twitter.access_token_key;
const twitterAccessTokenSecret = functions.config().twitter.access_token_secret;

let twitterClient = null;

if (!twitterConsumerKey || !twitterConsumerSecret || !twitterAccessTokenKey || !twitterAccessTokenSecret) {
    console.warn('The twitter keys are not configured, so tweets will not actually be sent. See README.md for how to set them up.')
} else {
    twitterClient = new Twitter({
        consumer_key: twitterConsumerKey,
        consumer_secret: twitterConsumerSecret,
        access_token_key: twitterAccessTokenKey,
        access_token_secret: twitterAccessTokenSecret
    });
}

const postmarkKey = functions.config().postmark.key;
if (!postmarkKey) console.warn("No postmark key provided. See README.md on how to set it up.")

const mailTransport = nodemailer.createTransport(postmarkTransport({
    auth: {
        apiKey: postmarkKey
    }
}));

const adminEmail = functions.config().email.to;
if (!adminEmail) console.warn("No admin email provided. See README.md on how to set it up.");

const fromEmail = functions.config().email.from;
if (!fromEmail) console.warn("No from email provided. See README.md on how to set it up.");

const domain = functions.config().site.domain || "thecompendium.cards";

const sendTweet = async (message) => {
    if (!twitterClient) {
        console.log("Twitter client not set up. Tweet that would have been sent: " + message);
        return "FAKE_TWEET_ID";
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
    let cards = await admin.firestore().collection('cards').where('published', '==', true).where('card_type', '==', 'content').get();
    let sections = await admin.firestore().collection('sections').orderBy('order').get();

    //TODO: filter out ones where the name is the id
    //TODO: sort and pick the first one

    let card = cards.docs[0];
    let result = card.data();
    result.id = card.id;
    return result;
}

const prettyCardURL = (card) => {
    return 'https://' + domain + '/c/' + card.name;
}

const markCardTweeted = async (card, tweetID) => {

    const cardRef = admin.firestore().collection('cards').doc(card.id);
    const cardTweetRef = cardRef.collection('tweets').doc(String(Date.now()));

    let batch = admin.firestore().batch();

    batch.update(cardRef, {
        tweet_count: admin.firestore.FieldValue.increment(1),
        last_tweeted: admin.firestore.FieldValue.serverTimestamp(),
    })

    batch.create(cardTweetRef, {
        id: tweetID,
        created: admin.firestore.FieldValue.serverTimestamp,
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
const functions = require('firebase-functions');

const nodemailer = require('nodemailer');
const postmarkTransport = require('nodemailer-postmark-transport');

const admin = require('firebase-admin');
admin.initializeApp();
admin.firestore().settings({timestampsInSnapshots:true});

const db = admin.firestore();

//TODO: include the same file as we do for the client for the canonical names of
//collections.

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

exports.emailAdminOnStar = functions.firestore.
    document('stars/{starId}').
    onCreate((snapshot, context) => {
        const cardId = snapshot.data().card;
        const authorId = snapshot.data().owner;

        const subject = 'User ' + authorId + ' starred card ' + cardId;
        const message = 'User ' + authorId + ' starred card <a href="https://' + domain + '/c/' + cardId +'">' + cardId + '</a>.';

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
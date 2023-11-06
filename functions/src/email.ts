
import {
	QueryDocumentSnapshot
} from 'firebase-admin/firestore';

import {
	getUserDisplayName,
	EMAIL_POSTMARK_KEY,
	EMAIL_FROM_ADDRESS,
	EMAIL_TO_ADDRESS,
	getCardName,
	DOMAIN,
	PAGE_DEFAULT,
	PAGE_COMMENT
} from './common.js';

import {
	FirestoreEvent
} from 'firebase-functions/v2/firestore';

import * as nodemailer from 'nodemailer';

import postmarkTransport from 'nodemailer-postmark-transport';

let mailTransport : nodemailer.Transporter | null = null;

if (EMAIL_POSTMARK_KEY) {
	mailTransport = nodemailer.createTransport(postmarkTransport({
		auth: {
			apiKey: EMAIL_POSTMARK_KEY
		}
	}));
} else {
	console.warn('No postmark key provided. See README.md on how to set it up.');
}

const adminEmail = EMAIL_TO_ADDRESS;
if (!adminEmail) console.warn('No admin email provided. See README.md on how to set it up.');

const fromEmail = EMAIL_FROM_ADDRESS;
if (!fromEmail) console.warn('No from email provided. See README.md on how to set it up.');

const sendEmail = async (subject : string, message : string) => {
	const mailOptions = {
		from: fromEmail,
		to: adminEmail,
		subject: subject,
		html: message
	};

	if (!mailTransport) {
		console.warn('Mail transport not set up due to missing config. Would have sent: ', mailOptions);
		return;
	}
	try {
		await mailTransport.sendMail(mailOptions);
	} catch(err) {
		console.error('Couldn\'t send email with message ' + subject + ': ' + err);
		return;
	}
	console.log('Sent email with message ' + subject);
};

export const onStar = async (event : FirestoreEvent<QueryDocumentSnapshot | undefined, Record<string, unknown>>) => {

	const snapshot = event.data;

	if (!snapshot) throw new Error('No document');

	const cardId = snapshot.data().card;
	const authorId = snapshot.data().owner;

	const authorString = await getUserDisplayName(authorId);
	const cardTitle = await getCardName(cardId);

	const subject = 'User ' + authorString + ' starred card ' + cardTitle;
	const message = 'User ' + authorString + ' (' + authorId +  ') starred card <a href="https://' + DOMAIN + '/' + PAGE_DEFAULT + '/' + cardId +'">' + cardTitle + ' (' + cardId + ')</a>.';

	sendEmail(subject, message);

};

export const onMessage = async (event : FirestoreEvent<QueryDocumentSnapshot | undefined, {messageId: string}>) => {

	const snapshot = event.data;

	if (!snapshot) throw new Error('No document');

	const cardId = snapshot.data().card;
	const authorId = snapshot.data().author;
	const messageText = snapshot.data().message;
	const messageId = event.params.messageId;

	const authorString = await getUserDisplayName(authorId);
	const cardTitle = await getCardName(cardId);

	const subject = 'User ' + authorString + ' left message on card ' + cardTitle;
	const message = 'User ' + authorString + ' (' + authorId + ') left message on card <a href="https://' + DOMAIN + '/' + PAGE_COMMENT + '/' + messageId +'">' + cardTitle + ' (' + cardId + ')</a>: <p>' + messageText + '</p>';

	sendEmail(subject, message);

};
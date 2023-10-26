
import {
	QueryDocumentSnapshot
} from 'firebase-admin/firestore';

import {
	config,
	getUserDisplayName,
	getCardName,
	DOMAIN,
	PAGE_DEFAULT,
	PAGE_COMMENT
} from './common.js';

import {
	EventContext
} from 'firebase-functions';

import * as nodemailer from 'nodemailer';

import postmarkTransport from 'nodemailer-postmark-transport';

let mailTransport : nodemailer.Transporter | null = null;

const postmarkKey = (config.postmark || {}).key;
if (postmarkKey) {
	mailTransport = nodemailer.createTransport(postmarkTransport({
		auth: {
			apiKey: postmarkKey
		}
	}));
} else {
	console.warn('No postmark key provided. See README.md on how to set it up.');
}

const adminEmail = (config.email || {}).to;
if (!adminEmail) console.warn('No admin email provided. See README.md on how to set it up.');

const fromEmail = (config.email || {}).from;
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

export const onStar = async (snapshot : QueryDocumentSnapshot) => {
	const cardId = snapshot.data().card;
	const authorId = snapshot.data().owner;

	const authorString = await getUserDisplayName(authorId);
	const cardTitle = await getCardName(cardId);

	const subject = 'User ' + authorString + ' starred card ' + cardTitle;
	const message = 'User ' + authorString + ' (' + authorId +  ') starred card <a href="https://' + DOMAIN + '/' + PAGE_DEFAULT + '/' + cardId +'">' + cardTitle + ' (' + cardId + ')</a>.';

	sendEmail(subject, message);

};

export const onMessage = async (snapshot : QueryDocumentSnapshot, context : EventContext<{messageId: string}>) => {
	const cardId = snapshot.data().card;
	const authorId = snapshot.data().author;
	const messageText = snapshot.data().message;
	const messageId = context.params.messageId;

	const authorString = await getUserDisplayName(authorId);
	const cardTitle = await getCardName(cardId);

	const subject = 'User ' + authorString + ' left message on card ' + cardTitle;
	const message = 'User ' + authorString + ' (' + authorId + ') left message on card <a href="https://' + DOMAIN + '/' + PAGE_COMMENT + '/' + messageId +'">' + cardTitle + ' (' + cardId + ')</a>: <p>' + messageText + '</p>';

	sendEmail(subject, message);

};
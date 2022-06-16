
const common = require('./common.js');

const nodemailer = require('nodemailer');
const postmarkTransport = require('nodemailer-postmark-transport');

let mailTransport = null;

const postmarkKey = (common.config.postmark || {}).key;
if (postmarkKey) {
	mailTransport = nodemailer.createTransport(postmarkTransport({
		auth: {
			apiKey: postmarkKey
		}
	}));
} else {
	console.warn('No postmark key provided. See README.md on how to set it up.');
}

const adminEmail = (common.config.email || {}).to;
if (!adminEmail) console.warn('No admin email provided. See README.md on how to set it up.');

const fromEmail = (common.config.email || {}).from;
if (!fromEmail) console.warn('No from email provided. See README.md on how to set it up.');

const sendEmail = (subject, message) => {
	const mailOptions = {
		from: fromEmail,
		to: adminEmail,
		subject: subject,
		html: message
	};

	if (!mailTransport) {
		console.warn('Mail transport not set up due to missing config. Would have sent: ', mailOptions);
		return new Promise().resolve();
	}

	return mailTransport.sendMail(mailOptions)
		.then(() => console.log('Sent email with message ' + subject))
		.catch((error) => console.error('Couldn\'t send email with message ' + subject + ': ' + error));
};

const onStar = async (snapshot) => {
	const cardId = snapshot.data().card;
	const authorId = snapshot.data().owner;

	const authorString = await common.getUserDisplayName(authorId);
	const cardTitle = await common.getCardName(cardId);

	const subject = 'User ' + authorString + ' starred card ' + cardTitle;
	const message = 'User ' + authorString + ' (' + authorId +  ') starred card <a href="https://' + common.DOMAIN + '/' + common.PAGE_DEFAULT + '/' + cardId +'">' + cardTitle + ' (' + cardId + ')</a>.';

	sendEmail(subject, message);

};

const onMessage = async (snapshot, context) => {
	const cardId = snapshot.data().card;
	const authorId = snapshot.data().author;
	const messageText = snapshot.data().message;
	const messageId = context.params.messageId;

	const authorString = await common.getUserDisplayName(authorId);
	const cardTitle = await common.getCardName(cardId);

	const subject = 'User ' + authorString + ' left message on card ' + cardTitle;
	const message = 'User ' + authorString + ' (' + authorId + ') left message on card <a href="https://' + common.DOMAIN + '/' + common.PAGE_COMMENT + '/' + messageId +'">' + cardTitle + ' (' + cardId + ')</a>: <p>' + messageText + '</p>';

	sendEmail(subject, message);

};

exports.onStar = onStar;
exports.onMessage = onMessage;
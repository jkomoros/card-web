
import {
	CARDS_COLLECTION,
	SECTIONS_COLLECTION,
	MAINTENANCE_COLLECTION,
	TWEETS_COLLECTION,
} from './database.js';

import {
	db,
	serverTimestampSentinel
} from '../firebase.js';

import {
	normalizeBodyHTML
} from '../contenteditable.js';

import { 
	newID,
} from '../util.js';

import {
	MultiBatch,
} from '../multi_batch.js';

import {
	selectUser
} from '../selectors.js';

import {
	defaultCardObject
} from './data.js';

import {
	ensureAuthor,
} from './comments.js';

import {
	READING_LIST_FALLBACK_CARD,
	STARS_FALLBACK_CARD,
} from '../tabs.js';

import {
	CARD_TYPE_CONTENT,
	CARD_TYPE_SECTION_HEAD
} from '../card_fields.js';

const checkMaintenanceTaskHasBeenRun = async (taskName) => {
	let ref = db.collection(MAINTENANCE_COLLECTION).doc(taskName);

	let doc = await ref.get();

	if (doc.exists) {
		if (!window.confirm('This task has been run before on this database. Do you want to run it again?')) {
			throw taskName + ' has been run before and the user didn\'t want to run again';
		}
	}

	return;
};

const maintenanceTaskRun = async (taskName) => {
	db.collection(MAINTENANCE_COLLECTION).doc(taskName).set({timestamp: serverTimestampSentinel()});
};

const NORMALIZE_CONTENT_BODY = 'normalize-content-body-again';

export const normalizeContentBody = async() => {
	await checkMaintenanceTaskHasBeenRun(NORMALIZE_CONTENT_BODY);

	let snapshot = await db.collection(CARDS_COLLECTION).get();

	let counter = 0;
	let size = snapshot.size;

	for (let doc of snapshot.docs) {
		counter++;
		let body = doc.data().body;
		if (body) {
			await doc.ref.update({
				body: normalizeBodyHTML(body),
				updated_normalize_body: serverTimestampSentinel(),
			});
		}
		console.log('Processed ' + doc.id + ' (' + counter + '/' + size + ')' );
	}

	await maintenanceTaskRun(NORMALIZE_CONTENT_BODY);
	console.log('Done!');
};

const UPDATE_INBOUND_LINKS = 'update-inbound-links';

export const updateInboundLinks = async() => {

	//This task is designed to run as often as you want, so we don't check if we've run it and mark as run.

	//This isn't dont in a transaction, which is OK because it's just a
	//convenience cache.

	let snapshot = await db.collection(CARDS_COLLECTION).get();

	let counter = 0;
	let size = snapshot.size;

	for (let doc of snapshot.docs) {
		counter++;
		let linkingCardsSnapshot = await db.collection(CARDS_COLLECTION).where('links', 'array-contains', doc.id).get();
		let linkingCardsIds = [];
		let linkingCardsText = {};
		linkingCardsSnapshot.forEach(linkingCard => {
			linkingCardsIds.push(linkingCard.id);
			const linksText = linkingCard.data().links_text || {};
			linkingCardsText[linkingCard.id] = linksText[doc.id] || '';
		});
		await doc.ref.update({
			updated_links_inbound: serverTimestampSentinel(),
			links_inbound: linkingCardsIds,
			links_inbound_text: linkingCardsText,
		});
		console.log('Processed ' + doc.id + ' (' + counter + '/' + size + ')' );
	}

	console.log('Done!');

};

const RESET_TWEETS = 'reset-tweets';

export const resetTweets = async() => {
	//Mark all tweets as having not been run
	if (!confirm('Are you SURE you want to reset all tweets?')) return;
	let batch = db.batch();
	let snapshot = await db.collection(CARDS_COLLECTION).get();
	snapshot.forEach(doc => {
		batch.update(doc.ref, {'tweet_count': 0, 'last_tweeted': new Date(0)});
	});
	let tweetSnapshot = await db.collection(TWEETS_COLLECTION).get();
	tweetSnapshot.forEach(doc => {
		batch.update(doc.ref, {'archived': true, 'archive_date': serverTimestampSentinel()});
	});
	await batch.commit();
	console.log('done!');
};

const INITIAL_SET_UP = 'INITIAL_SET_UP';

export const doInitialSetUp = () => async (_, getState) => {

	const user = selectUser(getState());

	await checkMaintenanceTaskHasBeenRun(INITIAL_SET_UP);

	const starterSections = {
		main: {
			title: 'Main',
			subtitle: 'The main collection of cards',
		},
	};

	let batch = new MultiBatch(db);

	const sectionsCollection = db.collection(SECTIONS_COLLECTION);
	const cardsCollection = db.collection(CARDS_COLLECTION);

	let count = 0;
	for (let [key, val] of Object.entries(starterSections)) {
		const update = {...val};
		const startCardId = 'section-' + key;
		const contentCardId = newID();
		update.updated = serverTimestampSentinel();
		update.cards = [contentCardId];
		update.order = count;
		update.start_cards = [startCardId];
		batch.set(sectionsCollection.doc(key), update);

		let sectionHeadCard = defaultCardObject(startCardId,user,key,CARD_TYPE_SECTION_HEAD);
		sectionHeadCard.title = update.title;
		sectionHeadCard.subtitle = update.subtitle;
		batch.set(cardsCollection.doc(startCardId), sectionHeadCard);

		const contentCard = defaultCardObject(contentCardId, user, key, CARD_TYPE_CONTENT);
		batch.set(cardsCollection.doc(contentCardId), contentCard);

		count++;
	}

	const readingListFallbackCard = defaultCardObject(READING_LIST_FALLBACK_CARD, user, '', CARD_TYPE_CONTENT);
	readingListFallbackCard.title = 'About Reading Lists';
	readingListFallbackCard.body = '<p>There are a lot of cards to read in the collection, and it can be hard to keep track.</p><p>You can use a feature called <strong>reading list</strong>&nbsp;to keep track of cards you want to read next. Just hit the reading-list button below any card (it\'s the button that looks like an icon to add to a playlist) and they\'ll show up in the Reading List tab. Once you\'re done reading that card, you can simply tap the button again to remove it from your reading list.</p><p>When you see a link on any card, you can also Ctrl/Cmd-Click it to automatically add it to your reading-list even without opening it. Links to cards that are already on your reading-list will show a double-underline.</p>' ;
	const starsFallbackCard = defaultCardObject(STARS_FALLBACK_CARD, user, '', CARD_TYPE_CONTENT);
	starsFallbackCard.title = 'About Stars';
	starsFallbackCard.body = '<p>You can star cards, and when you do they\'ll show up in the Starred list at the top nav.</p>';

	batch.set(cardsCollection.doc(READING_LIST_FALLBACK_CARD), readingListFallbackCard);
	batch.set(cardsCollection.doc(STARS_FALLBACK_CARD), starsFallbackCard);

	ensureAuthor(batch, user);

	await batch.commit();

	await maintenanceTaskRun(INITIAL_SET_UP);
	alert('Set up done!');
};

//tasks that don't require maintenance mode to be enabled are registered here
export const tasks = {
	[NORMALIZE_CONTENT_BODY]: normalizeContentBody,
	[RESET_TWEETS]: resetTweets,
};

//Tasks that do require maintenance mode are registered here. These are
//typically things that touch fields that updateInboundLinks or any other
//functions that run when a card is changed.
export const maintenceModeRequiredTasks = {
	[UPDATE_INBOUND_LINKS]: updateInboundLinks,
};
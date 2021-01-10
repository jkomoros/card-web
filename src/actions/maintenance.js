
import {
	CARDS_COLLECTION,
	SECTIONS_COLLECTION,
	MAINTENANCE_COLLECTION,
	TWEETS_COLLECTION,
} from './database.js';

import {
	db,
	deleteSentinel,
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
	CARD_TYPE_SECTION_HEAD,
	REFERENCES_INFO_CARD_PROPERTY,
	REFERENCES_CARD_PROPERTY,
	REFERENCES_INFO_INBOUND_CARD_PROPERTY,
	REFERENCES_INBOUND_CARD_PROPERTY,
	REFERENCE_TYPE_LINK,
	REFERENCE_TYPE_ACK,
	fontSizeBoosts
} from '../card_fields.js';

import {
	applyReferencesDiff,
	references,
} from '../references.js';

const NORMALIZE_CONTENT_BODY = 'normalize-content-body-again';

const normalizeContentBody = async() => {
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
};

const UPDATE_INBOUND_LINKS = 'update-inbound-links';

const updateInboundLinks = async() => {

	//This task is designed to run as often as you want, so we don't check if we've run it and mark as run.

	let snapshot = await db.collection(CARDS_COLLECTION).get();

	let counter = 0;
	let size = snapshot.size;

	let batch = new MultiBatch(db);

	for (let doc of snapshot.docs) {
		counter++;
		let linkingCardsSnapshot = await db.collection(CARDS_COLLECTION).where(REFERENCES_CARD_PROPERTY + '.' + doc.id, '==', true).get();
		if(!linkingCardsSnapshot.empty) {
			let referencesInbound = {};
			let referencesInboundSentinel = {};
			linkingCardsSnapshot.forEach(linkingCard => {
				referencesInbound[linkingCard.id] = linkingCard.data()[REFERENCES_INFO_CARD_PROPERTY][doc.id];
				referencesInboundSentinel[linkingCard.id] = linkingCard.data()[REFERENCES_CARD_PROPERTY][doc.id];
			});
			batch.update(doc.ref, {
				updated_references_inbound: serverTimestampSentinel(),
				[REFERENCES_INFO_INBOUND_CARD_PROPERTY]: referencesInbound,
				[REFERENCES_INBOUND_CARD_PROPERTY]: referencesInboundSentinel,
			});
		}
		console.log('Processed ' + doc.id + ' (' + counter + '/' + size + ')' );
	}

	await batch.commit();

	console.log('Done!');

};

const RESET_TWEETS = 'reset-tweets';

const resetTweets = async() => {
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
};

const INITIAL_SET_UP = 'INITIAL_SET_UP';

const initialSetup = () => async (_, getState) => {

	const user = selectUser(getState());

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
		sectionHeadCard.published = true;
		batch.set(cardsCollection.doc(startCardId), sectionHeadCard);

		const contentCard = defaultCardObject(contentCardId, user, key, CARD_TYPE_CONTENT);
		contentCard.published = true;
		batch.set(cardsCollection.doc(contentCardId), contentCard);

		count++;
	}

	const readingListFallbackCard = defaultCardObject(READING_LIST_FALLBACK_CARD, user, '', CARD_TYPE_CONTENT);
	readingListFallbackCard.title = 'About Reading Lists';
	readingListFallbackCard.body = '<p>There are a lot of cards to read in the collection, and it can be hard to keep track.</p><p>You can use a feature called <strong>reading list</strong>&nbsp;to keep track of cards you want to read next. Just hit the reading-list button below any card (it\'s the button that looks like an icon to add to a playlist) and they\'ll show up in the Reading List tab. Once you\'re done reading that card, you can simply tap the button again to remove it from your reading list.</p><p>When you see a link on any card, you can also Ctrl/Cmd-Click it to automatically add it to your reading-list even without opening it. Links to cards that are already on your reading-list will show a double-underline.</p>' ;
	readingListFallbackCard.published = true;
	const starsFallbackCard = defaultCardObject(STARS_FALLBACK_CARD, user, '', CARD_TYPE_CONTENT);
	starsFallbackCard.title = 'About Stars';
	starsFallbackCard.body = '<p>You can star cards, and when you do they\'ll show up in the Starred list at the top nav.</p>';
	starsFallbackCard.published = true;

	batch.set(cardsCollection.doc(READING_LIST_FALLBACK_CARD), readingListFallbackCard);
	batch.set(cardsCollection.doc(STARS_FALLBACK_CARD), starsFallbackCard);

	ensureAuthor(batch, user);

	await batch.commit();

};

const LINKS_TO_REFERENCES = 'links-to-references';

const linksToReferences = async () => {

	let batch = new MultiBatch(db);
	let snapshot = await db.collection(CARDS_COLLECTION).get();
	snapshot.forEach(doc => {

		let data = doc.data();
		let references = {};
		let referencesSentinels = {};
		for (let cardID of data.links) {
			references[cardID] = {
				[REFERENCE_TYPE_LINK]:data.links_text[cardID],
			};
			referencesSentinels[cardID] = true;
		}

		batch.update(doc.ref, {
			[REFERENCES_INFO_CARD_PROPERTY]: references,
			[REFERENCES_CARD_PROPERTY]: referencesSentinels,
			links: deleteSentinel(),
			links_inbound: deleteSentinel(),
			links_text: deleteSentinel(),
			links_inbound_text: deleteSentinel(),
		});
	});

	await batch.commit();
};

const SKIPPED_LINKS_TO_ACK_REFERENCES = 'skipped-links-to-ack-references';

const skippedLinksToAckReferences = async () => {
	let batch = new MultiBatch(db);
	let snapshot = await db.collection(CARDS_COLLECTION).get();
	snapshot.forEach(doc => {

		const card = doc.data();

		const updateCard = {...card};

		references(updateCard).addCardReferencesOfType(REFERENCE_TYPE_ACK, card.auto_todo_skipped_links_inbound || []);

		let update = {
			auto_todo_skipped_links_inbound: deleteSentinel(),
		};

		applyReferencesDiff(card, updateCard, update);

		batch.update(doc.ref, update);
	});

	await batch.commit();

};

const ADD_FONT_SIZE_BOOST = 'add-font-size-boost';

const addFontSizeBoost = async () => {

	let batch = new MultiBatch(db);
	let snapshot = await db.collection(CARDS_COLLECTION).get();
	snapshot.forEach(doc => {
		batch.update(doc.ref, {font_size_boost: {}});
	});

	await batch.commit();
};

const UPDATE_FONT_SIZE_BOOST = 'update-font-size-boost';

const updateFontSizeBoost = async () => {

	let batch = new MultiBatch(db);
	let snapshot = await db.collection(CARDS_COLLECTION).get();
	let counter = 0;
	//if this were forEach then the async gets weird as multiple queue up.
	for (let doc of snapshot.docs) {
		console.log('Processing ' + counter + '/' + snapshot.size);
		counter++;
		const card = doc.data();
		card.id = doc.id;

		const beforeBoosts = card.font_size_boost;
		//NOTE: maintence-view includes a hidden card-stage so this will have a card renderer to use
		const afterBoosts = await fontSizeBoosts(card);

		if (Object.keys(beforeBoosts).length == Object.keys(afterBoosts).length && Object.entries(beforeBoosts).every(entry => entry[1] == afterBoosts[entry[0]])) continue;

		console.log('Card ' + doc.id + ' had an updated boost');
		batch.update(doc.ref, {font_size_boost: afterBoosts});
	}

	await batch.commit();

};

const CONVERT_MULTI_LINKS_DELIMITER = 'convert-multi-links-delimiter';

const convertMultiLinksDelimiter = async () => {
	const OLD_MULTI_LINK_DELIMITER = ' || ';

	let batch = new MultiBatch(db);
	let snapshot = await db.collection(CARDS_COLLECTION).get();
	snapshot.forEach(doc => {
		let card = doc.data();
		let update = {};

		let referencesInfo = card[REFERENCES_INFO_CARD_PROPERTY];
		for (let [otherCardID, referenceMap] of Object.entries(referencesInfo)) {
			for (let [referenceType, value] of Object.entries(referenceMap)) {
				if (value.includes(OLD_MULTI_LINK_DELIMITER)) {
					value = value.split(OLD_MULTI_LINK_DELIMITER).join('\n');
					update[REFERENCES_INFO_CARD_PROPERTY + '.' + otherCardID + '.' + referenceType] = value;
				}
			}
		}

		if (Object.keys(update).length == 0) return;
		console.log('Updating doc: ', doc.id, update);
		batch.update(doc.ref, update);
	});

	await batch.commit();
};

const FLIP_AUTO_TODO_OVERRIDES = 'flip-auto-todo-overrides';

const flipAutoTodoOverrides = async () => {
	let batch = new MultiBatch(db);
	let snapshot = await db.collection(CARDS_COLLECTION).get();
	snapshot.forEach(doc => {
		let card = doc.data();

		const originalOverrides = card.auto_todo_overrides || {};

		if (Object.keys(originalOverrides).length == 0) return;

		const flippedOverrides = Object.fromEntries(Object.entries(originalOverrides).map(entry => [entry[0], !entry[1]]));
		const update = {
			auto_todo_overrides: flippedOverrides,
		};

		console.log('Updating doc: ', doc.id, update);
		batch.update(doc.ref, update);
	});

	await batch.commit();
};

const makeMaintenanceActionCreator = (taskName, taskConfig) => {
	if (taskConfig.recurring) return taskConfig.action;
	const fn = taskConfig.action;
	const nextTaskName = taskConfig.nextTaskName;
	return async () => {
		let ref = db.collection(MAINTENANCE_COLLECTION).doc(taskName);

		let doc = await ref.get();
	
		if (doc.exists) {
			if (!window.confirm('This task has been run before on this database. Do you want to run it again?')) {
				throw taskName + ' has been run before and the user didn\'t want to run again';
			}
		}
	
		await fn();

		await db.collection(MAINTENANCE_COLLECTION).doc(taskName).set({timestamp: serverTimestampSentinel()});
		console.log('done');

		if (nextTaskName) alert('Now run ' + nextTaskName);

		return;
	};
};

/*

	fn: the raw function that does the thing
	maintenanceModeRequired: if true, will be grayed out unless maintenance mode is on. These are tasks that do such expensive processing htat if updateInboudnLinks were to be run it would mess with the db.
	recurring: if true, then the task can be run multiple times.
	nextTaskName: If set, the string name of the task the user should run next.

*/
const RAW_TASKS = {
	[INITIAL_SET_UP]: {
		fn: initialSetup,
	},
	[NORMALIZE_CONTENT_BODY]: {
		fn: normalizeContentBody,
	},
	[RESET_TWEETS]: {
		fn: resetTweets,
		recurring: true,
	},
	[SKIPPED_LINKS_TO_ACK_REFERENCES]: {
		fn: skippedLinksToAckReferences,
	},
	[ADD_FONT_SIZE_BOOST]: {
		fn: addFontSizeBoost,
	},
	[UPDATE_FONT_SIZE_BOOST]: {
		fn: updateFontSizeBoost,
		recurring: true,
	},
	[CONVERT_MULTI_LINKS_DELIMITER]: {
		fn: convertMultiLinksDelimiter,
	},
	[FLIP_AUTO_TODO_OVERRIDES]: {
		fn: flipAutoTodoOverrides,
	},
	[UPDATE_INBOUND_LINKS]: {
		fn: updateInboundLinks,
		maintenanceModeRequired: true,
		recurring: true,
	},
	[LINKS_TO_REFERENCES]: {
		fn: linksToReferences,
		maintenanceModeRequired: true,
		nextTaskName: UPDATE_INBOUND_LINKS,
	}
};

export const MAINTENANCE_TASKS = Object.fromEntries(Object.entries(RAW_TASKS).map(entry => [entry[0], {...entry[1], actionCreator: makeMaintenanceActionCreator(entry[0], entry[1])}]));

export const INITIAL_SET_UP_TASK_NAME = INITIAL_SET_UP;
export const NORMAL_MAINTENANCE_TASK_NAMES = [...Object.keys(MAINTENANCE_TASKS)].filter(key => key != INITIAL_SET_UP && !MAINTENANCE_TASKS[key].maintenanceModeRequired);
export const MAINTENANCE_MODE_MAINTENANCE_TASK_NAMES = [...Object.keys(MAINTENANCE_TASKS)].filter(key => key != INITIAL_SET_UP && MAINTENANCE_TASKS[key].maintenanceModeRequired);
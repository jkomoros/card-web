
import {
	db,
	CARDS_COLLECTION,
	SECTIONS_COLLECTION,
	SECTION_UPDATES_COLLECTION,
	CARD_UPDATES_COLLECTION,
	MESSAGES_COLLECTION,
	MAINTENANCE_COLLECTION
} from './database.js';

import {
	normalizeBodyHTML
} from './editor.js';

import {
	extractCardLinks
} from './data.js';

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
	db.collection(MAINTENANCE_COLLECTION).doc(taskName).set({timestamp: new Date()});
};

//v1 of this set dates fro cards with no messages to when the card was created,
//but that sorted cards with no comments ahead of cards with comments.
const ADD_UPDATED_MESSAGE = 'add-updated-message-v2';

export const addUpdatedMessage = async() => {
	await checkMaintenanceTaskHasBeenRun(ADD_UPDATED_MESSAGE);

	let cardsSnapshot = await db.collection(CARDS_COLLECTION).get();
	let messagesSnapshot = await db.collection(MESSAGES_COLLECTION).get();

	let dateIndex = new Map();

	messagesSnapshot.forEach(doc => {
		let cardId = doc.data().card;
		let created = doc.data().created.toDate();
		if (!dateIndex.has(cardId)) {
			dateIndex.set(cardId, created);
			return;
		}
		//Otherwise, only set it if it's larger than the existing one
		let existingDate = dateIndex.get(cardId);
		if (created > existingDate) dateIndex.set(cardId, created);
	});

	//We now have an index of the most recent message time per card.

	let batch = db.batch();
	
	cardsSnapshot.forEach(doc => {
		let updatedMessage = dateIndex.get(doc.id);

		//If there's no created timestamp (some section-heads don't have one),
		//default to when the app was being created. Remember that monthIndex is
		//0-indexed for some strange reason. We don't use the card's created
		//date, because recently created cards would then show up before cards
		//that actually had comments in the sort.
		if (!updatedMessage) updatedMessage = new Date(2018, 11, 18);
		batch.update(doc.ref, {
			'updated_message': updatedMessage,
		});
	});
	
	await batch.commit();
	await maintenanceTaskRun(ADD_UPDATED_MESSAGE);	
	console.log('Done');
};

const ADD_TAGS_ARRAY = 'add-tags-array';

export const addTagsArray = async() => {
	await checkMaintenanceTaskHasBeenRun(ADD_TAGS_ARRAY);

	let batch = db.batch();

	let snapshot = await db.collection(CARDS_COLLECTION).get();

	snapshot.forEach(doc => {
		batch.update(doc.ref, {'tags': []});
	});

	await batch.commit();

	await maintenanceTaskRun(ADD_TAGS_ARRAY);
	console.log('Done');
};

const UPDATE_LINKS = 'update-links';

//This task has to be rerun after fixing 2ee9374
export const updateLinks = async() => {
	await checkMaintenanceTaskHasBeenRun(UPDATE_LINKS);

	let snapshot = await db.collection(CARDS_COLLECTION).get();

	let counter = 0;
	let size = snapshot.size;

	for (let doc of snapshot.docs) {
		counter++;
		let links = extractCardLinks(doc.data().body);
		await doc.ref.update({
			links: links,
		});
		console.log('Processed ' + doc.id + ' (' + counter + '/' + size + ')' );
	}

	await maintenanceTaskRun(UPDATE_LINKS);
	console.log('Done');
};

const ADD_THREAD_RESOLVED_COUNT = 'add-thread-resolved-count';

export const addThreadResolvedCount = async() => {

	await checkMaintenanceTaskHasBeenRun(ADD_THREAD_RESOLVED_COUNT);

	let batch = db.batch();

	let snapshot = await db.collection(CARDS_COLLECTION).get();

	snapshot.forEach(doc => {
		batch.update(doc.ref, {'thread_resolved_count': 0});
	});

	await batch.commit();

	await maintenanceTaskRun(ADD_THREAD_RESOLVED_COUNT);
	console.log('done!');

};

const ADD_CARD_AUTHOR = 'add-card-author';

export const addCardAuthor = async() => {
	await checkMaintenanceTaskHasBeenRun(ADD_CARD_AUTHOR);

	let batch = db.batch();

	let snapshot = await db.collection(CARDS_COLLECTION).get();

	snapshot.forEach(doc => {
		batch.update(doc.ref, {'author': 'TPo5MOn6rNX9k8K1bbejuBNk4Dr2'});
	});

	await batch.commit();

	await maintenanceTaskRun(ADD_CARD_AUTHOR);
	console.log('done!');
};

const ADD_THREAD_COUNT = 'add-thread-count';

export const addThreadCount = async() => {

	await checkMaintenanceTaskHasBeenRun(ADD_THREAD_COUNT);

	let batch = db.batch();

	let snapshot = await db.collection(CARDS_COLLECTION).get();

	snapshot.forEach(doc => {
		batch.update(doc.ref, {'thread_count': 0});
	});

	await batch.commit();

	await maintenanceTaskRun(ADD_THREAD_COUNT);
	console.log('done!');

};

const ADD_STAR_COUNT = 'add-star-count';

export const addStarCount = async() => {

	await checkMaintenanceTaskHasBeenRun(ADD_STAR_COUNT);

	let batch = db.batch();

	let snapshot = await db.collection(CARDS_COLLECTION).get();

	snapshot.forEach(doc => {
		batch.update(doc.ref, {'star_count': 0});
	});

	await batch.commit();

	await maintenanceTaskRun(ADD_STAR_COUNT);
	console.log('done!');

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
				updated_normalize_body: new Date(),
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
		linkingCardsSnapshot.forEach(linkingCard => {
			linkingCardsIds.push(linkingCard.id);
		});
		await doc.ref.update({
			updated_links_inbound: new Date(),
			links_inbound: linkingCardsIds,
		});
		console.log('Processed ' + doc.id + ' (' + counter + '/' + size + ')' );
	}

	console.log('Done!');

};

const ADD_SECTION_UPDATES_LOG = 'add-section-updates-log';

export const addSectionUpdatesLog = async() => {

	await checkMaintenanceTaskHasBeenRun(ADD_SECTION_UPDATES_LOG);

	let batch = db.batch();

	//Technically this shoudl be a transaction, but meh.

	let snapshot = await db.collection(SECTIONS_COLLECTION).get();

	snapshot.forEach(doc => {
		batch.update(doc.ref, {updated: new Date()});
		let sectionUpdateRef = doc.ref.collection(SECTION_UPDATES_COLLECTION).doc('' + Date.now());
		batch.set(sectionUpdateRef, {timestamp: new Date, cards: doc.data().cards});
	});

	await batch.commit();

	await maintenanceTaskRun(ADD_SECTION_UPDATES_LOG);
	console.log('Done!');

};

const ADD_TWO_OLD_MAINTENANCE_TASKS = 'add-two-old-maintenance-tasks';

export const addTwoOldMaintenanceTasks = async () => {

	//This task is run because 

	await checkMaintenanceTaskHasBeenRun(ADD_TWO_OLD_MAINTENANCE_TASKS);

	await maintenanceTaskRun('add-card-type-to-imported-cards');
	await maintenanceTaskRun('add-section-header-cards');

	await maintenanceTaskRun(ADD_TWO_OLD_MAINTENANCE_TASKS);
	console.log('Done!');


};

const ADD_CARD_TYPE_TO_IMPORTED_CARDS = 'add-card-type-to-imported-cards';

export const addCardTypeToImportedCards = async () => {

	await checkMaintenanceTaskHasBeenRun(ADD_CARD_TYPE_TO_IMPORTED_CARDS);

	let batch = db.batch();

	db.collection(CARDS_COLLECTION).where('imported', '==', true).get().then(snapshot => {
		snapshot.forEach(doc => {
			batch.update(doc.ref, {'card_type': 'content'});
		});
		batch.commit().then(() => {
			maintenanceTaskRun(ADD_CARD_TYPE_TO_IMPORTED_CARDS);
			console.log('Updated!');
		});
	});

};

const ADD_SECTION_HEADER_CARDS = 'add-section-header-cards';

export const addSectionHeaderCards = async () => {

	await checkMaintenanceTaskHasBeenRun(ADD_SECTION_HEADER_CARDS);

	let batch = db.batch();

	let halfBakedCard = newCard('section-half-baked');
	let barelyEdibleCard = newCard('section-barely-edible');
	let stubsCard = newCard('section-stubs');
	let randomThoughtsCard = newCard('section-random-thoughts');

	halfBakedCard.title = 'Half-Baked';
	halfBakedCard.subtitle = 'Ideas that are probably as baked as they’re going to get in this collection';
	halfBakedCard.card_type = 'section-head';
	halfBakedCard.section = 'half-baked';

	barelyEdibleCard.title = 'Barely Edible';
	barelyEdibleCard.subtitle = 'Ideas that have some detail roughed in, but not organized for clarity yet';
	barelyEdibleCard.card_type = 'section-head';
	barelyEdibleCard.section = 'barely-edible';

	stubsCard.title = 'Stubs';
	stubsCard.subtitle = 'Points that I plan to develop more, but haven’t yet';
	stubsCard.card_type = 'section-head';
	stubsCard.section = 'stubs';

	randomThoughtsCard.title = 'Random Thoughts';
	randomThoughtsCard.subtitle = 'A parking lot for early stage thoughts that might be dupes or not worth developing';
	randomThoughtsCard.card_type = 'section-head';
	randomThoughtsCard.section = 'random-thoughts';

	batch.set(db.collection(CARDS_COLLECTION).doc(halfBakedCard.name), halfBakedCard);
	batch.set(db.collection(CARDS_COLLECTION).doc(barelyEdibleCard.name), barelyEdibleCard);
	batch.set(db.collection(CARDS_COLLECTION).doc(stubsCard.name), stubsCard);
	batch.set(db.collection(CARDS_COLLECTION).doc(randomThoughtsCard.name), randomThoughtsCard);

	batch.update(db.collection(SECTIONS_COLLECTION).doc('half-baked'), {start_cards: [halfBakedCard.name]});
	batch.update(db.collection(SECTIONS_COLLECTION).doc('barely-edible'), {start_cards: [barelyEdibleCard.name]});
	batch.update(db.collection(SECTIONS_COLLECTION).doc('stubs'), {start_cards: [stubsCard.name]});
	batch.update(db.collection(SECTIONS_COLLECTION).doc('random-thoughts'), {start_cards: [randomThoughtsCard.name]});

	batch.commit().then(() => {
		maintenanceTaskRun(ADD_SECTION_HEADER_CARDS);
		console.log('Updated!');
	});

};


export const doImport = () => {

	fetch('/src/data/cards.json').then(resp => {
		resp.json().then(data => importCards(data.cards));
	});
};

export const importCards = (cards) => {
	//Designed for one-time bulk import

	let transformedCards = {};

	let sections = {};

	for (let key of Object.keys(cards).sort((a,b) => cards[a].index - cards[b].index)) {
		let card = transformImportCard(cards[key]);

		let sectionName = card.section;
		let section = sections[sectionName] || [];
		section.push(key);
		sections[sectionName] = section;

		transformedCards[key] = card;
	} 

	//we now have a set of transformed cards to add directly in (with their id),
	//and a list of cards per section to overwrite the current things with.

	let mainBatch = db.batch();
	let slideUpdatesBatch = db.batch();

	for (let key of Object.keys(transformedCards)) {
		let card = transformedCards[key];
		let ref = db.collection(CARDS_COLLECTION).doc(key);
		mainBatch.set(ref, card);
		let update = {
			substantive: true,
			timestamp: new Date(),
			import: true
		};
		let updateRef = ref.collection(CARD_UPDATES_COLLECTION).doc('' + Date.now());
		slideUpdatesBatch.set(updateRef, update);
	}

	for (let key of Object.keys(sections)) {
		let sectionCards = sections[key];
		let ref = db.collection(SECTIONS_COLLECTION).doc(key);
		mainBatch.update(ref, {cards:sectionCards});
	}


	mainBatch.commit().then(() => {
		console.log('Main batch Done!');
		slideUpdatesBatch.commit().then(() => {
			console.log('Slide update batch done');
		});
	});


};

const newCard = (name) => {
	return {
		created: new Date(),
		updated: new Date(),
		updated_substantive: new Date(),
		slugs: [],
		name: name
	};
};

const transformImportSectionName = (legacySectionName) => {
	if (!legacySectionName) return 'stubs';
	legacySectionName = legacySectionName.toLowerCase();
	return legacySectionName.split(' ').join('-');
};

const transformImportCard = (legacyCard) => {
	return {
		created: new Date(),
		updated: new Date(),
		updated_substantive: new Date(),
		title: legacyCard.title || '',
		body: legacyCard.body || '',
		links: legacyCard.links || [],
		imported: true,
		links_inbound: legacyCard.inbound_links || [],
		slugs: legacyCard.slugs ? legacyCard.slugs.split(',') : [],
		notes: legacyCard.notes || '',
		tags: legacyCard.tags || [],
		section: transformImportSectionName(legacyCard.sectionname),
		name: legacyCard.name || ''
	};
};

export const tasks = {
	[ADD_TWO_OLD_MAINTENANCE_TASKS]: addTwoOldMaintenanceTasks,
	[ADD_CARD_TYPE_TO_IMPORTED_CARDS]: addCardTypeToImportedCards,
	[ADD_SECTION_HEADER_CARDS]: addSectionHeaderCards,
	[ADD_SECTION_UPDATES_LOG]: addSectionUpdatesLog,
	[UPDATE_INBOUND_LINKS]: updateInboundLinks,
	[NORMALIZE_CONTENT_BODY]: normalizeContentBody,
	[ADD_STAR_COUNT]: addStarCount,
	[ADD_THREAD_COUNT]: addThreadCount,
	[ADD_CARD_AUTHOR]: addCardAuthor,
	[ADD_THREAD_RESOLVED_COUNT]: addThreadResolvedCount,
	[UPDATE_LINKS]: updateLinks,
	[ADD_TAGS_ARRAY]: addTagsArray,
	[ADD_UPDATED_MESSAGE]: addUpdatedMessage,
};
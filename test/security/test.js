
//based on https://github.com/firebase/quickstart-nodejs/tree/master/firestore-emulator/javascript-quickstart
/*eslint-env node*/
const firebase = require('@firebase/testing');
const fs = require('fs');

const projectId = 'compendium-tester';
const firebaseConfig = require('../../firebase.json');
const port = firebaseConfig.emulators && firebaseConfig.emulators.firestore ? firebaseConfig.emulators.firestore.port : 8080;
const coverageUrl = `http://localhost:${port}/emulator/v1/projects/${projectId}:ruleCoverage.html`;

const rules = fs.readFileSync('firestore.rules', 'utf8');

//duplicated from src/actions/database.js
const PERMISSIONS_COLLECTION = 'permissions';
const CARDS_COLLECTION = 'cards';
const TAGS_COLLECTION = 'tags';
const SECTIONS_COLLECTION = 'sections';
const MAINTENANCE_COLLECTION = 'maintenance_tasks';
const AUTHORS_COLLECTION = 'authors';
const USERS_COLLECTION = 'users';
const MESSAGES_COLLECTION = 'messages';
const THREADS_COLLECTION = 'threads';
const STARS_COLLECTION = 'stars';
const READS_COLLECTION = 'reads';
const TWEETS_COLLECTION = 'tweets';
const READING_LISTS_COLLECTION = 'reading_lists';
const UPDATES_COLLECTION = 'updates';

const adminUid = 'admin';
const bobUid = 'bob';
const sallyUid = 'sally';
const jerryUid = 'jerry';
const genericUid = 'generic';
const anonUid = 'anon';

const googleBaseAuth = {firebase: {sign_in_provider: 'google.com'}};
const anonBaseAuth = {firebase: {sign_in_provider: 'anonymous'}};

const adminAuth = {...googleBaseAuth, uid:adminUid, email:'admin@komoroske.com'};
const bobAuth = {...googleBaseAuth, uid:bobUid, email:'bob@gmail.com'};
const sallyAuth = {...googleBaseAuth, uid: sallyUid, email:'sally@gmail.com'};
const jerryAuth = {...googleBaseAuth, uid: jerryUid, email:'jerry@gmail.com'};
const genericAuth = {...googleBaseAuth, uid: genericUid, email: 'generic@gmail.com'};
const anonAuth = {...anonBaseAuth, uid: anonUid, email: ''};

const cardId = 'card';
const unpublishedCardId = 'unpublished-card';
const unpublishedCardIdSallyAuthor = 'unpublished-card-sally-author';
const unpublishedCardIdSallyEditor = 'unpublished-card-sally-editor';
const cardThreadCount = 10;
const cardThreadResolvedCount = 5;
const cardStarCount = 7;

const starId = cardId + '+' + anonUid;
const newStarId = cardId + 'new+' + anonUid;

const messageId = 'message';
const newMessageId = 'newMessage';

const updateId = 'update';
const newUpdateId = 'newUpdate';

function authedApp(auth) {
	return firebase.initializeTestApp({ projectId, auth }).firestore();
}

function addPermissionForUser(uid, permissionToSet) {
	const db = firebase.initializeAdminApp({projectId}).firestore();
	return db.collection(PERMISSIONS_COLLECTION).doc(uid).set({[permissionToSet]:true}, {merge:true});
}

async function setupDatabase() {
	const db = firebase.initializeAdminApp({projectId}).firestore();
	await db.collection(PERMISSIONS_COLLECTION).doc(adminUid).set({admin:true});
	await db.collection(PERMISSIONS_COLLECTION).doc(bobUid).set({viewUnpublished: true});
	await db.collection(PERMISSIONS_COLLECTION).doc(jerryUid).set({edit: true});
	await db.collection(CARDS_COLLECTION).doc(cardId).set({
		body: 'this is the body',
		title: 'this is the title',
		editors: [sallyUid],
		thread_count: cardThreadCount,
		thread_resolved_count: cardThreadResolvedCount,
		star_count: cardStarCount,
		star_count_manual: cardStarCount,
		published: true,
	});
	await db.collection(CARDS_COLLECTION).doc(cardId).collection(UPDATES_COLLECTION).doc(updateId).set({
		foo:3,
	});
	await db.collection(CARDS_COLLECTION).doc(unpublishedCardId).set({
		body: 'this is the body',
		title: 'this is the title',
		thread_count: cardThreadCount,
		thread_resolved_count: cardThreadResolvedCount,
		star_count: cardStarCount,
		star_count_manual: cardStarCount,
		published: false,
	});

	await db.collection(CARDS_COLLECTION).doc(unpublishedCardIdSallyAuthor).set({
		body: 'this is the body',
		title: 'this is the title',
		editors: [sallyUid],
		thread_count: cardThreadCount,
		thread_resolved_count: cardThreadResolvedCount,
		star_count: cardStarCount,
		star_count_manual: cardStarCount,
		published: false,
	});

	await db.collection(CARDS_COLLECTION).doc(unpublishedCardIdSallyEditor).set({
		body: 'this is the body',
		title: 'this is the title',
		author: sallyUid,
		thread_count: cardThreadCount,
		thread_resolved_count: cardThreadResolvedCount,
		star_count: cardStarCount,
		star_count_manual: cardStarCount,
		published: false,
	});

	await db.collection(TAGS_COLLECTION).doc(cardId).set({
		foo:3,
	});
	await db.collection(TAGS_COLLECTION).doc(cardId).collection(UPDATES_COLLECTION).doc(updateId).set({
		foo:4,
	});

	await db.collection(SECTIONS_COLLECTION).doc(cardId).set({
		foo:3,
	});
	await db.collection(SECTIONS_COLLECTION).doc(cardId).collection(UPDATES_COLLECTION).doc(updateId).set({
		foo:4,
	});

	await db.collection(MAINTENANCE_COLLECTION).doc(cardId).set({
		foo: 3,
	});

	await db.collection(MESSAGES_COLLECTION).doc(messageId).set({
		message: 'blah',
		author: bobUid,
	});
	await db.collection(THREADS_COLLECTION).doc(messageId).set({
		author:bobUid,
		messages: [messageId]
	});
	//This is a star/read/reading-list by anon user, not bob, because we'll use
	//an anon user to test that they can create stars (they're allowed to)
	await db.collection(STARS_COLLECTION).doc(starId).set({
		owner: anonUid,
		card: cardId,
	});
	await db.collection(READS_COLLECTION).doc(starId).set({
		owner: anonUid,
		card: cardId,
	});
	await db.collection(READING_LISTS_COLLECTION).doc(anonUid).set({
		owner: anonUid,
		cards: [cardId],
	});
	await db.collection(READING_LISTS_COLLECTION).doc(anonUid).collection(UPDATES_COLLECTION).doc(messageId).set({
		foo: 3,
	});

	await db.collection(TWEETS_COLLECTION).doc(messageId).set({
		card: cardId,
	});
}

beforeEach(async () => {
	// Clear the database between tests
	await firebase.clearFirestoreData({ projectId });
	await setupDatabase();
});

before(async () => {
	await firebase.loadFirestoreRules({ projectId, rules });
});

after(async () => {
	await Promise.all(firebase.apps().map(app => app.delete()));
	console.log(`View rule coverage information at ${coverageUrl}\n`);
});

describe('Compendium Rules', () => {
	it('allows anyone to read a published card', async () => {
		const db = authedApp(null);
		const card = db.collection(CARDS_COLLECTION).doc(cardId);
		await firebase.assertSucceeds(card.get());
	});

	it('allows anyone to query for published card', async () => {
		const db = authedApp(null);
		const query = db.collection(CARDS_COLLECTION).where('published', '==', true);
		await firebase.assertSucceeds(query.get());
	});

	it('disallows default user to query for cards that may include ones that aren\t published', async () => {
		const db = authedApp(null);
		const query = db.collection(CARDS_COLLECTION);
		await firebase.assertFails(query.get());
	});

	it('disallows normal users permission to view unpublished cards', async() => {
		const db = authedApp(sallyAuth);
		const card = db.collection(CARDS_COLLECTION).doc(unpublishedCardId);
		await firebase.assertFails(card.get());
	});

	it ('allows users with viewUnpublished permission to view unpublished card', async() => {
		const db = authedApp(bobAuth);
		const card = db.collection(CARDS_COLLECTION).doc(unpublishedCardId);
		await firebase.assertSucceeds(card.get());
	});

	it ('allows users with edit permission to view unpublished card', async() => {
		const db = authedApp(jerryAuth);
		const card = db.collection(CARDS_COLLECTION).doc(unpublishedCardId);
		await firebase.assertSucceeds(card.get());
	});

	it ('allows users with admin permission to view unpublished card', async() => {
		const db = authedApp(adminAuth);
		const card = db.collection(CARDS_COLLECTION).doc(unpublishedCardId);
		await firebase.assertSucceeds(card.get());
	});

	it ('allows users to view unpublished card they are an author of even without viewUnpublished permission', async() => {
		const db = authedApp(sallyAuth);
		const query = db.collection(CARDS_COLLECTION).where('published', '==', false).where('author', '==', sallyUid);
		await firebase.assertSucceeds(query.get());
	});

	it ('allows users to view unpublished card they are listed as editor of even without viewUnpublished permission', async() => {
		const db = authedApp(sallyAuth);
		const query = db.collection(CARDS_COLLECTION).where('published', '==', false).where('editors', 'array-contains', sallyUid);
		await firebase.assertSucceeds(query.get());
	});

	it('allows admins to create a card', async() => {
		const db = authedApp(adminAuth);
		const card = db.collection(CARDS_COLLECTION).doc(cardId + 'new');
		await firebase.assertSucceeds(card.set({tile:'foo', body:'foo', author:adminUid}));
	});

	it('disallows admins to create a card they aren\'t author of', async() => {
		const db = authedApp(adminAuth);
		const card = db.collection(CARDS_COLLECTION).doc(cardId + 'new');
		await firebase.assertFails(card.set({tile:'foo', body:'foo', author:bobUid}));
	});

	it('does not allow normal users to create a card', async() => {
		const db = authedApp(bobAuth);
		const card = db.collection(CARDS_COLLECTION).doc(cardId + 'new');
		await firebase.assertFails(card.set({tile:'foo', body:'foo'}));
	});

	it('does not allow unauthenticated users to create a card', async() => {
		const db = authedApp(null);
		const card = db.collection(CARDS_COLLECTION).doc(cardId);
		await firebase.assertFails(card.set({tile:'foo', body:'foo'}));
	});

	it('allows any non-anon users to increment thread_count', async() => {
		const db = authedApp(bobAuth);
		const card = db.collection(CARDS_COLLECTION).doc(cardId);
		await firebase.assertSucceeds(card.update({thread_count: cardThreadCount + 1}));
	});

	it('disallows any anon users to increment thread_count', async() => {
		const db = authedApp(anonAuth);
		const card = db.collection(CARDS_COLLECTION).doc(cardId);
		await firebase.assertFails(card.update({thread_count: cardThreadCount + 1}));
	});

	//The next two tests exercise the increment/decrement behavior in general, effectively.
	it('disallows any non-anon users to increment thread_count by more than 1', async() => {
		const db = authedApp(bobAuth);
		const card = db.collection(CARDS_COLLECTION).doc(cardId);
		await firebase.assertFails(card.update({thread_count: cardThreadCount + 2}));
	});

	it('disallows any non-anon users to decrement thread_count', async() => {
		const db = authedApp(bobAuth);
		const card = db.collection(CARDS_COLLECTION).doc(cardId);
		await firebase.assertFails(card.update({thread_count: cardThreadCount - 1}));
	});

	it('disallows any non-anon users to modify another field while incremeting thread_count', async() => {
		const db = authedApp(bobAuth);
		const card = db.collection(CARDS_COLLECTION).doc(cardId);
		await firebase.assertFails(card.update({thread_count: cardThreadCount + 1, body:'other'}));
	});

	it('allows any non-anon users to decrement thread_count by 1 and increment resolved_thread_count by 1', async() => {
		const db = authedApp(bobAuth);
		const card = db.collection(CARDS_COLLECTION).doc(cardId);
		await firebase.assertSucceeds(card.update({thread_count: cardThreadCount - 1, thread_resolved_count: cardThreadResolvedCount + 1}));
	});

	it('disallows any anon users to decrement thread_count by 1 and increment resolved_thread_count by 1', async() => {
		const db = authedApp(anonAuth);
		const card = db.collection(CARDS_COLLECTION).doc(cardId);
		await firebase.assertFails(card.update({thread_count: cardThreadCount - 1, thread_resolved_count: cardThreadResolvedCount + 1}));
	});

	it('disallows any non-anon users to increment thread_count by 1 and increment resolved_thread_count by 1', async() => {
		const db = authedApp(bobAuth);
		const card = db.collection(CARDS_COLLECTION).doc(cardId);
		await firebase.assertFails(card.update({thread_count: cardThreadCount + 1, thread_resolved_count: cardThreadResolvedCount + 1}));
	});

	it('disallows any non-anon users to decrement thread_count by 1 and increment resolved_thread_count by 1 if they have other fields', async() => {
		const db = authedApp(bobAuth);
		const card = db.collection(CARDS_COLLECTION).doc(cardId);
		await firebase.assertFails(card.update({thread_count: cardThreadCount - 1, thread_resolved_count: cardThreadResolvedCount + 1, body: 'foo'}));
	});

	it('allows any signed in users to increment star_count by 1', async() => {
		const db = authedApp(anonAuth);
		const card = db.collection(CARDS_COLLECTION).doc(cardId);
		await firebase.assertSucceeds(card.update({star_count: cardStarCount + 1, star_count_manual: cardStarCount + 1}));
	});

	it('disallows any nonauthenticated  users to increment star_count by 1', async() => {
		const db = authedApp(null);
		const card = db.collection(CARDS_COLLECTION).doc(cardId);
		await firebase.assertFails(card.update({star_count: cardStarCount + 1, star_count_manual: cardStarCount + 1}));
	});

	it('disallows any signed in users to increment star_count by 1 if they edit other fields', async() => {
		const db = authedApp(anonAuth);
		const card = db.collection(CARDS_COLLECTION).doc(cardId);
		await firebase.assertFails(card.update({star_count: cardStarCount + 1, thread_count: cardThreadCount + 1}));
	});

	it('allows any signed in users to decrement star_count by 1', async() => {
		const db = authedApp(anonAuth);
		const card = db.collection(CARDS_COLLECTION).doc(cardId);
		await firebase.assertSucceeds(card.update({star_count: cardStarCount - 1, star_count_manual: cardStarCount - 1}));
	});

	it('disallows any nonauthenticated users to decrement star_count by 1', async() => {
		const db = authedApp(null);
		const card = db.collection(CARDS_COLLECTION).doc(cardId);
		await firebase.assertFails(card.update({star_count: cardStarCount - 1, star_count_manual: cardStarCount - 1}));
	});

	it('disallows any signed in users to decrement star_count by 1 if they edit other fields', async() => {
		const db = authedApp(anonAuth);
		const card = db.collection(CARDS_COLLECTION).doc(cardId);
		await firebase.assertFails(card.update({star_count: cardStarCount - 1, thread_count: cardThreadCount + 1}));
	});

	it('allows any non-anon user to update the updated_message timestamp to now',async() => {
		const db = authedApp(bobAuth);
		const card = db.collection(CARDS_COLLECTION).doc(cardId);
		await firebase.assertSucceeds(card.update({updated_message: firebase.firestore.FieldValue.serverTimestamp()}));
	});

	it('disallows any non-anon user to update the updated_message timestamp to now',async() => {
		const db = authedApp(bobAuth);
		const card = db.collection(CARDS_COLLECTION).doc(cardId);
		await firebase.assertFails(card.update({updated_message: new Date(2015,10,10)}));
	});

	it('disallows any non-anon user to update the updated_message timestamp to now if they also change another field',async() => {
		const db = authedApp(bobAuth);
		const card = db.collection(CARDS_COLLECTION).doc(cardId);
		await firebase.assertFails(card.update({updated_message: firebase.firestore.FieldValue.serverTimestamp(), star_count: cardStarCount + 1}));
	});

	it('disallows any anon user to update the updated_message timestamp to now',async() => {
		const db = authedApp(anonAuth);
		const card = db.collection(CARDS_COLLECTION).doc(cardId);
		await firebase.assertFails(card.update({updated_message: firebase.firestore.FieldValue.serverTimestamp()}));
	});

	it('allows any non-anon user to update the updated_message timestamp to now while also incrementing thread_count',async() => {
		const db = authedApp(bobAuth);
		const card = db.collection(CARDS_COLLECTION).doc(cardId);
		await firebase.assertSucceeds(card.update({updated_message: firebase.firestore.FieldValue.serverTimestamp(), thread_count: cardThreadCount + 1}));
	});

	it('disallows any anon user to update the updated_message timestamp to now while also incrementing thread_count',async() => {
		const db = authedApp(anonAuth);
		const card = db.collection(CARDS_COLLECTION).doc(cardId);
		await firebase.assertFails(card.update({updated_message: firebase.firestore.FieldValue.serverTimestamp(), thread_count: cardThreadCount + 1}));
	});

	it('disallows any non-anon user to update the updated_message timestamp to now if they decrement incrementing thread_count',async() => {
		const db = authedApp(bobAuth);
		const card = db.collection(CARDS_COLLECTION).doc(cardId);
		await firebase.assertFails(card.update({updated_message: firebase.firestore.FieldValue.serverTimestamp(), thread_count: cardThreadCount - 1}));
	});

	it('disallows any non-anon user to update the updated_message timestamp to now while incrementing thread_count if they also touch another field',async() => {
		const db = authedApp(bobAuth);
		const card = db.collection(CARDS_COLLECTION).doc(cardId);
		await firebase.assertFails(card.update({updated_message: firebase.firestore.FieldValue.serverTimestamp(), thread_count: cardThreadCount + 1, star_count: cardStarCount + 1}));
	});

	it('disallows any non-admin user to set arbitrary field on card', async () => {
		const db = authedApp(bobAuth);
		const card = db.collection(CARDS_COLLECTION).doc(cardId);
		await firebase.assertFails(card.update({foo:5}));
	});

	it('allows users explicitly marked as editors for that card to arbitrarily edit a card', async () => {
		//Sally is explicitly listed as an editor on the card
		const db = authedApp(sallyAuth);
		const card = db.collection(CARDS_COLLECTION).doc(cardId);
		await firebase.assertSucceeds(card.update({foo:5}));
	});

	it('allows users explicitly marked as editors to arbitrarily edit a card', async () => {
		//jerry has blanket edit permission
		const db = authedApp(jerryAuth);
		const card = db.collection(CARDS_COLLECTION).doc(cardId);
		await firebase.assertSucceeds(card.update({foo:5}));
	});

	it('allows admins to read card updates', async() => {
		const db = authedApp(adminAuth);
		const update = db.collection(CARDS_COLLECTION).doc(cardId).collection(UPDATES_COLLECTION).doc(updateId);
		await firebase.assertSucceeds(update.get());
	});

	it('allows explicitly listed editors for a card to read card updates', async() => {
		const db = authedApp(sallyAuth);
		const update = db.collection(CARDS_COLLECTION).doc(cardId).collection(UPDATES_COLLECTION).doc(updateId);
		await firebase.assertSucceeds(update.get());
	});

	it('allows explicitly listed editors to read card updates', async() => {
		const db = authedApp(jerryAuth);
		const update = db.collection(CARDS_COLLECTION).doc(cardId).collection(UPDATES_COLLECTION).doc(updateId);
		await firebase.assertSucceeds(update.get());
	});

	it('allows admins to set card updates', async() => {
		const db = authedApp(adminAuth);
		const update = db.collection(CARDS_COLLECTION).doc(cardId).collection(UPDATES_COLLECTION).doc(newUpdateId);
		await firebase.assertSucceeds(update.set({foo:4}));
	});

	it('allows explicitly listed editors for a card to set card updates', async() => {
		const db = authedApp(sallyAuth);
		const update = db.collection(CARDS_COLLECTION).doc(cardId).collection(UPDATES_COLLECTION).doc(newUpdateId);
		await firebase.assertSucceeds(update.set({foo:4}));
	});

	it('allows explicitly listed editors to set card updates', async() => {
		const db = authedApp(jerryAuth);
		const update = db.collection(CARDS_COLLECTION).doc(cardId).collection(UPDATES_COLLECTION).doc(newUpdateId);
		await firebase.assertSucceeds(update.set({foo:4}));
	});

	it('disallows users from reading card updates', async() => {
		const db = authedApp(bobAuth);
		const update = db.collection(CARDS_COLLECTION).doc(cardId).collection(UPDATES_COLLECTION).doc(updateId);
		await firebase.assertFails(update.get());
	});

	it('disallows users from setting card updates', async() => {
		const db = authedApp(bobAuth);
		const update = db.collection(CARDS_COLLECTION).doc(cardId).collection(UPDATES_COLLECTION).doc(newUpdateId);
		await firebase.assertFails(update.set({foo:4}));
	});

	it('allows everyone to read tags collection', async() => {
		const db = authedApp(null);
		const tag = db.collection(TAGS_COLLECTION).doc(cardId);
		await firebase.assertSucceeds(tag.get());
	});

	it('allows admins to set tags collection', async() => {
		const db = authedApp(adminAuth);
		const tag = db.collection(TAGS_COLLECTION).doc(cardId);
		await firebase.assertSucceeds(tag.set({bar: 3}));
	});

	it('disallows everyone to set tags collection', async() => {
		const db = authedApp(bobAuth);
		const tag = db.collection(TAGS_COLLECTION).doc(cardId);
		await firebase.assertFails(tag.set({bar: 3}));
	});

	it('disallows everyone from reading tag updates collection', async() => {
		const db = authedApp(bobAuth);
		const update = db.collection(TAGS_COLLECTION).doc(cardId).collection(UPDATES_COLLECTION).doc(updateId);
		await firebase.assertFails(update.get());
	});

	it('allows admin to set tag updates collection', async() => {
		const db = authedApp(adminAuth);
		const update = db.collection(TAGS_COLLECTION).doc(cardId).collection(UPDATES_COLLECTION).doc(updateId);
		await firebase.assertSucceeds(update.set({bar: 3}));
	});

	it('allows everyone to read sections collection', async() => {
		const db = authedApp(null);
		const section = db.collection(SECTIONS_COLLECTION).doc(cardId);
		await firebase.assertSucceeds(section.get());
	});

	it('allows admins to set sections collection', async() => {
		const db = authedApp(adminAuth);
		const section = db.collection(SECTIONS_COLLECTION).doc(cardId);
		await firebase.assertSucceeds(section.set({bar: 3}));
	});

	it('allows users with edit privileges to set sections collection', async() => {
		const db = authedApp(jerryAuth);
		const section = db.collection(SECTIONS_COLLECTION).doc(cardId);
		await firebase.assertSucceeds(section.set({bar: 3}));
	});

	it('allows users with editSection privileges to set sections collection', async() => {
		const db = authedApp(genericAuth);
		await addPermissionForUser(genericUid,'editSection');
		const section = db.collection(SECTIONS_COLLECTION).doc(cardId);
		await firebase.assertSucceeds(section.set({bar: 3}));
	});

	it('disallows everyone to set sections collection', async() => {
		const db = authedApp(bobAuth);
		const section = db.collection(SECTIONS_COLLECTION).doc(cardId);
		await firebase.assertFails(section.set({bar: 3}));
	});

	it('disallows everyone from reading section updates collection', async() => {
		const db = authedApp(bobAuth);
		const update = db.collection(SECTIONS_COLLECTION).doc(cardId).collection(UPDATES_COLLECTION).doc(updateId);
		await firebase.assertFails(update.get());
	});

	it('allows admin to set section updates collection', async() => {
		const db = authedApp(adminAuth);
		const update = db.collection(SECTIONS_COLLECTION).doc(cardId).collection(UPDATES_COLLECTION).doc(updateId);
		await firebase.assertSucceeds(update.set({bar: 3}));
	});

	it('allows users with edit privileges to set section updates collection', async() => {
		const db = authedApp(jerryAuth);
		const update = db.collection(SECTIONS_COLLECTION).doc(cardId).collection(UPDATES_COLLECTION).doc(updateId);
		await firebase.assertSucceeds(update.set({bar: 3}));
	});

	it('allows admins to read maintenance tasks', async() => {
		const db = authedApp(adminAuth);
		const task = db.collection(MAINTENANCE_COLLECTION).doc(cardId);
		await firebase.assertSucceeds(task.get());
	});

	it('allows admins to set maintenance tasks', async() => {
		const db = authedApp(adminAuth);
		const task = db.collection(MAINTENANCE_COLLECTION).doc(cardId);
		await firebase.assertSucceeds(task.set({foo:4}));
	});

	it('disallows users from reading maintenance tasks', async() => {
		const db = authedApp(bobAuth);
		const task = db.collection(MAINTENANCE_COLLECTION).doc(cardId);
		await firebase.assertFails(task.get());
	});

	it('disallows users from setting maintenance tasks', async() => {
		const db = authedApp(bobAuth);
		const task = db.collection(MAINTENANCE_COLLECTION).doc(cardId);
		await firebase.assertFails(task.set({foo:4}));
	});

	it('allows users to read back their permissions object', async() => {
		const db = authedApp(bobAuth);
		await firebase.assertSucceeds(db.collection(PERMISSIONS_COLLECTION).doc(bobUid).get());
	});

	it('disallows users to read back other users permissions object', async() => {
		const db = authedApp(bobAuth);
		await firebase.assertFails(db.collection(PERMISSIONS_COLLECTION).doc(sallyUid).get());
	});

	it('disallows users to modify their permissions object', async() => {
		const db = authedApp(bobAuth);
		await firebase.assertFails(db.collection(PERMISSIONS_COLLECTION).doc(bobUid).update({admin:true}));
	});

	it('anyone may read authors objects', async() => {
		const db = authedApp(null);
		await firebase.assertSucceeds(db.collection(AUTHORS_COLLECTION).doc(bobUid).get());
	});

	it('users may modify their own author object', async() => {
		const db = authedApp(bobAuth);
		await firebase.assertSucceeds(db.collection(AUTHORS_COLLECTION).doc(bobUid).set({bob:true}));
	});

	it('users may not modify others author object', async() => {
		const db = authedApp(bobAuth);
		await firebase.assertFails(db.collection(AUTHORS_COLLECTION).doc(sallyUid).set({bob:true}));
	});

	it('admins may modify others author object, but only if they don\'t set any keys', async() => {
		const db = authedApp(adminAuth);
		await firebase.assertSucceeds(db.collection(AUTHORS_COLLECTION).doc('newUid').set({}, {merge: true}));
	});

	it('admins may not modify others author object if they set any keys', async() => {
		const db = authedApp(adminAuth);
		await firebase.assertFails(db.collection(AUTHORS_COLLECTION).doc('newUid').set({bob:true}, {merge: true}));
	});

	it('users may modify their own user object', async() => {
		const db = authedApp(bobAuth);
		await firebase.assertSucceeds(db.collection(USERS_COLLECTION).doc(bobUid).set({bob:true}));
	});

	it('users may read their own user object', async() => {
		const db = authedApp(bobAuth);
		await firebase.assertSucceeds(db.collection(USERS_COLLECTION).doc(bobUid).get());
	});

	it('users may not modify others user object', async() => {
		const db = authedApp(bobAuth);
		await firebase.assertFails(db.collection(USERS_COLLECTION).doc(sallyUid).set({bob:true}));
	});

	it('users may not read others user object', async() => {
		const db = authedApp(bobAuth);
		await firebase.assertFails(db.collection(USERS_COLLECTION).doc(sallyUid).get());
	});

	it('allows anyone to read messages', async() => {
		const db = authedApp(null);
		await firebase.assertSucceeds(db.collection(MESSAGES_COLLECTION).doc(messageId).get());
	});

	it('allows anyone to update messages they created', async() => {
		const db = authedApp(bobAuth);
		const message = db.collection(MESSAGES_COLLECTION).doc(messageId);
		await firebase.assertSucceeds(message.update({message: 'new message'}));
	});

	it('allows admins to update any message', async() => {
		const db = authedApp(adminAuth);
		const message = db.collection(MESSAGES_COLLECTION).doc(messageId);
		await firebase.assertSucceeds(message.update({message: 'new message'}));
	});

	it('disallows users who didn\'t create a message to update it', async() => {
		const db = authedApp(sallyAuth);
		const message = db.collection(MESSAGES_COLLECTION).doc(messageId);
		await firebase.assertFails(message.update({message: 'new message'}));
	});

	it('allows any non anonymous user to create a message if they are marked as author', async() => {
		const db = authedApp(bobAuth);
		const message = db.collection(MESSAGES_COLLECTION).doc(newMessageId);
		await firebase.assertSucceeds(message.set({author: bobUid, message: 'new message'}));
	});

	it('disallows any non anonymous user to create a message if they are not marked as author', async() => {
		const db = authedApp(sallyAuth);
		const message = db.collection(MESSAGES_COLLECTION).doc(newMessageId);
		await firebase.assertFails(message.set({author: bobUid, message: 'new message'}));
	});

	it('disallows any anonymous user to create a message even if they are marked as author', async() => {
		const db = authedApp(anonAuth);
		const message = db.collection(MESSAGES_COLLECTION).doc(newMessageId);
		await firebase.assertFails(message.set({author: anonUid, message: 'new message'}));
	});

	it('allows anyone to read threads', async() => {
		const db = authedApp(null);
		await firebase.assertSucceeds(db.collection(THREADS_COLLECTION).doc(messageId).get());
	});

	it('allows anyone to update threads they created', async() => {
		const db = authedApp(bobAuth);
		const thread = db.collection(THREADS_COLLECTION).doc(messageId);
		await firebase.assertSucceeds(thread.update({resolved: true}));
	});

	it('allows admins to update any thread', async() => {
		const db = authedApp(adminAuth);
		const thread = db.collection(THREADS_COLLECTION).doc(messageId);
		await firebase.assertSucceeds(thread.update({resolved: true}));
	});

	it('disallows users who didn\'t create a thread to update it', async() => {
		const db = authedApp(sallyAuth);
		const thread = db.collection(THREADS_COLLECTION).doc(messageId);
		await firebase.assertFails(thread.update({resolved: true}));
	});

	it('allows any non anonymous user to create a thread if they are marked as author', async() => {
		const db = authedApp(bobAuth);
		const thread = db.collection(THREADS_COLLECTION).doc(newMessageId);
		await firebase.assertSucceeds(thread.set({author: bobUid}));
	});

	it('disallows any non anonymous user to create a thread if they are not marked as author', async() => {
		const db = authedApp(sallyAuth);
		const thread = db.collection(THREADS_COLLECTION).doc(newMessageId);
		await firebase.assertFails(thread.set({author: bobUid}));
	});

	it('disallows any anonymous user to create a thread even if they are marked as author', async() => {
		const db = authedApp(anonAuth);
		const thread = db.collection(THREADS_COLLECTION).doc(newMessageId);
		await firebase.assertFails(thread.set({author: anonUid}));
	});

	it('allows non-authors to update a thraed if they are not anonymous and it only adds a message', async() => {
		const db = authedApp(sallyAuth);
		const thread = db.collection(THREADS_COLLECTION).doc(messageId);
		await firebase.assertSucceeds(thread.update({messages: firebase.firestore.FieldValue.arrayUnion(newMessageId), updated:firebase.firestore.FieldValue.serverTimestamp()}));
	});

	it('disallows anonymous users to update a non-author thread even if it only adds message', async() => {
		const db = authedApp(anonAuth);
		const thread = db.collection(THREADS_COLLECTION).doc(messageId);
		await firebase.assertFails(thread.update({messages: firebase.firestore.FieldValue.arrayUnion(newMessageId), updated: firebase.firestore.FieldValue.serverTimestamp()}));
	});

	it('allows any user to create a star they own', async() => {
		const db = authedApp(anonAuth);
		const star = db.collection(STARS_COLLECTION).doc(newStarId);
		await firebase.assertSucceeds(star.set({owner:anonUid, card: cardId}));
	});

	it('disallows user to create a star they don\'t own', async() => {
		const db = authedApp(sallyAuth);
		const star = db.collection(STARS_COLLECTION).doc(newStarId);
		await firebase.assertFails(star.set({owner:anonUid, card: cardId}));
	});

	it('allows any user to update a star they own', async() => {
		const db = authedApp(anonAuth);
		const star = db.collection(STARS_COLLECTION).doc(starId);
		await firebase.assertSucceeds(star.update({card: newMessageId}));
	});

	it('disallows user to update a star they don\'t own', async() => {
		const db = authedApp(sallyAuth);
		const star = db.collection(STARS_COLLECTION).doc(starId);
		await firebase.assertFails(star.update({card: newMessageId}));
	});

	it('allows any user to delete a star they own', async() => {
		const db = authedApp(anonAuth);
		const star = db.collection(STARS_COLLECTION).doc(starId);
		await firebase.assertSucceeds(star.delete());
	});

	it('disallows user to delete a star they don\'t own', async() => {
		const db = authedApp(sallyAuth);
		const star = db.collection(STARS_COLLECTION).doc(starId);
		await firebase.assertFails(star.delete());
	});

	it('allows any user to read a star they own', async() => {
		const db = authedApp(anonAuth);
		const star = db.collection(STARS_COLLECTION).doc(starId);
		await firebase.assertSucceeds(star.get());
	});

	it('disallows user to read a star they don\'t own', async() => {
		const db = authedApp(sallyAuth);
		const star = db.collection(STARS_COLLECTION).doc(starId);
		await firebase.assertFails(star.get());
	});

	it('allows any user to create a read they own', async() => {
		const db = authedApp(anonAuth);
		const read = db.collection(READS_COLLECTION).doc(newStarId);
		await firebase.assertSucceeds(read.set({owner:anonUid, card: cardId}));
	});

	it('disallows user to create a read they don\'t own', async() => {
		const db = authedApp(sallyAuth);
		const read = db.collection(READS_COLLECTION).doc(newStarId);
		await firebase.assertFails(read.set({owner:anonUid, card: cardId}));
	});

	it('allows any user to update a read they own', async() => {
		const db = authedApp(anonAuth);
		const read = db.collection(READS_COLLECTION).doc(starId);
		await firebase.assertSucceeds(read.update({card: newMessageId}));
	});

	it('disallows user to update a read they don\'t own', async() => {
		const db = authedApp(sallyAuth);
		const read = db.collection(READS_COLLECTION).doc(starId);
		await firebase.assertFails(read.update({card: newMessageId}));
	});

	it('allows any user to delete a read they own', async() => {
		const db = authedApp(anonAuth);
		const read = db.collection(READS_COLLECTION).doc(starId);
		await firebase.assertSucceeds(read.delete());
	});

	it('disallows user to delete a read they don\'t own', async() => {
		const db = authedApp(sallyAuth);
		const read = db.collection(READS_COLLECTION).doc(starId);
		await firebase.assertFails(read.delete());
	});

	it('allows any user to read a read they own', async() => {
		const db = authedApp(anonAuth);
		const read = db.collection(READS_COLLECTION).doc(starId);
		await firebase.assertSucceeds(read.get());
	});

	it('disallows user to read a read they don\'t own', async() => {
		const db = authedApp(sallyAuth);
		const read = db.collection(READS_COLLECTION).doc(starId);
		await firebase.assertFails(read.get());
	});

	it('allows anyone to read tweets info', async() => {
		const db = authedApp(null);
		const tweet = db.collection(TWEETS_COLLECTION).doc(messageId);
		await firebase.assertSucceeds(tweet.get());
	});

	it('disallows users to set tweets info', async() => {
		const db = authedApp(bobAuth);
		const tweet = db.collection(TWEETS_COLLECTION).doc(messageId);
		await firebase.assertFails(tweet.update({card: cardId + 'new'}));
	});

	it('allows any user to create a reading-list they own', async() => {
		const db = authedApp(anonAuth);
		const list = db.collection(READING_LISTS_COLLECTION).doc(anonUid);
		await firebase.assertSucceeds(list.set({owner:anonUid, cards: [cardId]}));
	});

	it('disallows user to create a reading-list they don\'t own', async() => {
		const db = authedApp(sallyAuth);
		const list = db.collection(READING_LISTS_COLLECTION).doc(anonUid);
		await firebase.assertFails(list.set({owner:anonUid, cards: [cardId]}));
	});

	it('allows any user to update a reading-list they own', async() => {
		const db = authedApp(anonAuth);
		const list = db.collection(READING_LISTS_COLLECTION).doc(anonUid);
		await firebase.assertSucceeds(list.update({cards: firebase.firestore.FieldValue.arrayUnion(newMessageId)}));
	});

	it('disallows user to update a reading-list they don\'t own', async() => {
		const db = authedApp(sallyAuth);
		const list = db.collection(READING_LISTS_COLLECTION).doc(anonUid);
		await firebase.assertFails(list.update({cards: firebase.firestore.FieldValue.arrayUnion(newMessageId)}));
	});

	it('allows any user to delete a reading-list they own', async() => {
		const db = authedApp(anonAuth);
		const list = db.collection(READING_LISTS_COLLECTION).doc(anonUid);
		await firebase.assertSucceeds(list.delete());
	});

	it('disallows user to delete a reading-list they don\'t own', async() => {
		const db = authedApp(sallyAuth);
		const list = db.collection(READING_LISTS_COLLECTION).doc(anonUid);
		await firebase.assertFails(list.delete());
	});

	it('allows any user to read a reading-list they own', async() => {
		const db = authedApp(anonAuth);
		const list = db.collection(READING_LISTS_COLLECTION).doc(anonUid);
		await firebase.assertSucceeds(list.get());
	});

	it('disallows user to read a reading-list they don\'t own', async() => {
		const db = authedApp(sallyAuth);
		const list = db.collection(READING_LISTS_COLLECTION).doc(anonUid);
		await firebase.assertFails(list.get());
	});

	it('allows owner of reading-list to read updates for a reading-list they own', async() => {
		const db = authedApp(anonAuth);
		const update = db.collection(READING_LISTS_COLLECTION).doc(anonUid).collection(UPDATES_COLLECTION).doc(updateId);
		await firebase.assertSucceeds(update.get());
	});

	it('disallows user to read updates for a reading-list updates they don\'t own', async() => {
		const db = authedApp(sallyAuth);
		const update = db.collection(READING_LISTS_COLLECTION).doc(anonUid).collection(UPDATES_COLLECTION).doc(updateId);
		await firebase.assertFails(update.get());
	});

	it('allows owner of reading-list to write updates for a reading-list they own', async() => {
		const db = authedApp(anonAuth);
		const update = db.collection(READING_LISTS_COLLECTION).doc(anonUid).collection(UPDATES_COLLECTION).doc(newUpdateId);
		await firebase.assertSucceeds(update.set({foo:4}));
	});

	it('disallows user to set updates for a reading-list updates they don\'t own', async() => {
		const db = authedApp(sallyAuth);
		const update = db.collection(READING_LISTS_COLLECTION).doc(anonUid).collection(UPDATES_COLLECTION).doc(newUpdateId);
		await firebase.assertFails(update.set({foo:4}));
	});

});

//based on https://github.com/firebase/quickstart-nodejs/tree/master/firestore-emulator/javascript-quickstart
/*eslint-env node*/
const firebase = require('@firebase/testing');
const fs = require('fs');

const projectId = 'compendium-tester';
const firebasePort = require('../../firebase.json').emulators.firestore.port;
const port = firebasePort ? firebasePort : 8080;
const coverageUrl = `http://localhost:${port}/emulator/v1/projects/${projectId}:ruleCoverage.html`;

const rules = fs.readFileSync('firestore.rules', 'utf8');

//duplicated from src/actions/database.js
const PERMISSIONS_COLLECTION = 'permissions';
const CARDS_COLLECTION = 'cards';
const AUTHORS_COLLECTION = 'authors';
const USERS_COLLECTION = 'users';

const adminUid = 'admin';
const bobUid = 'bob';
const sallyUid = 'sally';
const anonUid = 'anon';

const adminAuth = {uid:adminUid};
const bobAuth = {uid:bobUid};
const anonAuth = {uid: anonUid, token:{firebase:{sign_in_provider: 'anonymous'}}};

const cardId = 'card';
const cardThreadCount = 10;
const cardThreadResolvedCount = 5;
const cardStarCount = 7;

function authedApp(auth) {
	return firebase.initializeTestApp({ projectId, auth }).firestore();
}

async function setupDatabase() {
	const db = firebase.initializeAdminApp({projectId}).firestore();
	await db.collection(PERMISSIONS_COLLECTION).doc(adminUid).set({admin:true});
	await db.collection(CARDS_COLLECTION).doc(cardId).set({
		body: 'this is the body',
		title: 'this is the title',
		thread_count: cardThreadCount,
		thread_resolved_count: cardThreadResolvedCount,
		star_count: cardStarCount,
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
	it('allows anyone to read a card', async () => {
		const db = authedApp(null);
		const card = db.collection(CARDS_COLLECTION).doc(cardId);
		await firebase.assertSucceeds(card.get());
	});

	it('allows admins to create a card', async() => {
		const db = authedApp(adminAuth);
		const card = db.collection(CARDS_COLLECTION).doc(cardId);
		await firebase.assertSucceeds(card.set({tile:'foo', body:'foo'}));
	});

	it('does not allow normal users to create a card', async() => {
		const db = authedApp(bobAuth);
		const card = db.collection(CARDS_COLLECTION).doc(cardId);
		await firebase.assertFails(card.set({tile:'foo', body:'foo'}));
	});

	it('does not allow unauthenticated users to create a card', async() => {
		const db = authedApp(null);
		const card = db.collection(CARDS_COLLECTION).doc(cardId);
		await firebase.assertFails(card.set({tile:'foo', body:'foo'}));
	});

	it('allows any signed in users to increment thread_count', async() => {
		const db = authedApp(anonAuth);
		const card = db.collection(CARDS_COLLECTION).doc(cardId);
		await firebase.assertSucceeds(card.update({thread_count: cardThreadCount + 1}));
	});

	it('disallows any non-signed in users to increment thread_count', async() => {
		const db = authedApp(null);
		const card = db.collection(CARDS_COLLECTION).doc(cardId);
		await firebase.assertFails(card.update({thread_count: cardThreadCount + 1}));
	});

	//The next two tests exercise the increment/decrement behavior in general, effectively.
	it('disallows any signed in users to increment thread_count by more than 1', async() => {
		const db = authedApp(anonAuth);
		const card = db.collection(CARDS_COLLECTION).doc(cardId);
		await firebase.assertFails(card.update({thread_count: cardThreadCount + 2}));
	});

	it('disallows any signed in users to decrement thread_count', async() => {
		const db = authedApp(anonAuth);
		const card = db.collection(CARDS_COLLECTION).doc(cardId);
		await firebase.assertFails(card.update({thread_count: cardThreadCount - 1}));
	});

	it('disallows any signed in users to modify another field while incremeting thread_count', async() => {
		const db = authedApp(anonAuth);
		const card = db.collection(CARDS_COLLECTION).doc(cardId);
		await firebase.assertFails(card.update({thread_count: cardThreadCount + 1, body:'other'}));
	});

	it('allows any signed in users to decrement thread_count by 1 and increment resolved_thread_count by 1', async() => {
		const db = authedApp(anonAuth);
		const card = db.collection(CARDS_COLLECTION).doc(cardId);
		await firebase.assertSucceeds(card.update({thread_count: cardThreadCount - 1, thread_resolved_count: cardThreadResolvedCount + 1}));
	});

	it('disallows any unauthenticated to decrement thread_count by 1 and increment resolved_thread_count by 1', async() => {
		const db = authedApp(null);
		const card = db.collection(CARDS_COLLECTION).doc(cardId);
		await firebase.assertFails(card.update({thread_count: cardThreadCount - 1, thread_resolved_count: cardThreadResolvedCount + 1}));
	});

	it('disallows any signed in users to increment thread_count by 1 and increment resolved_thread_count by 1', async() => {
		const db = authedApp(anonAuth);
		const card = db.collection(CARDS_COLLECTION).doc(cardId);
		await firebase.assertFails(card.update({thread_count: cardThreadCount + 1, thread_resolved_count: cardThreadResolvedCount + 1}));
	});

	it('disallows any signed in users to decrement thread_count by 1 and increment resolved_thread_count by 1 if they have other fields', async() => {
		const db = authedApp(anonAuth);
		const card = db.collection(CARDS_COLLECTION).doc(cardId);
		await firebase.assertFails(card.update({thread_count: cardThreadCount - 1, thread_resolved_count: cardThreadResolvedCount + 1, body: 'foo'}));
	});

	it('allows any signed in users to increment star_count by 1', async() => {
		const db = authedApp(anonAuth);
		const card = db.collection(CARDS_COLLECTION).doc(cardId);
		await firebase.assertSucceeds(card.update({star_count: cardStarCount + 1}));
	});

	it('disallows any nonauthenticated  users to increment star_count by 1', async() => {
		const db = authedApp(null);
		const card = db.collection(CARDS_COLLECTION).doc(cardId);
		await firebase.assertFails(card.update({star_count: cardStarCount + 1}));
	});

	it('disallows any signed in users to increment star_count by 1 if they edit other fields', async() => {
		const db = authedApp(anonAuth);
		const card = db.collection(CARDS_COLLECTION).doc(cardId);
		await firebase.assertFails(card.update({star_count: cardStarCount + 1, thread_count: cardThreadCount + 1}));
	});

	it('allows any signed in users to decrement star_count by 1', async() => {
		const db = authedApp(anonAuth);
		const card = db.collection(CARDS_COLLECTION).doc(cardId);
		await firebase.assertSucceeds(card.update({star_count: cardStarCount - 1}));
	});

	it('disallows any nonauthenticated users to decrement star_count by 1', async() => {
		const db = authedApp(null);
		const card = db.collection(CARDS_COLLECTION).doc(cardId);
		await firebase.assertFails(card.update({star_count: cardStarCount - 1}));
	});

	it('disallows any signed in users to decrement star_count by 1 if they edit other fields', async() => {
		const db = authedApp(anonAuth);
		const card = db.collection(CARDS_COLLECTION).doc(cardId);
		await firebase.assertFails(card.update({star_count: cardStarCount - 1, thread_count: cardThreadCount + 1}));
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

	it('admins may modify anyone\'s author object', async() => {
		const db = authedApp(adminAuth);
		await firebase.assertSucceeds(db.collection(AUTHORS_COLLECTION).doc(bobUid).set({bob:true}));
	});

	it('users may not modify others author object', async() => {
		const db = authedApp(bobAuth);
		await firebase.assertFails(db.collection(AUTHORS_COLLECTION).doc(sallyUid).set({bob:true}));
	});

	it('users may modify their own user object', async() => {
		const db = authedApp(bobAuth);
		await firebase.assertSucceeds(db.collection(USERS_COLLECTION).doc(bobUid).set({bob:true}));
	});

	it('users may read their own user object', async() => {
		const db = authedApp(bobAuth);
		await firebase.assertSucceeds(db.collection(USERS_COLLECTION).doc(bobUid).get());
	});

	it('admins may modify any user object', async() => {
		const db = authedApp(adminAuth);
		await firebase.assertSucceeds(db.collection(USERS_COLLECTION).doc(bobUid).set({bob:true}));
	});

	it('admins may read any user object', async() => {
		const db = authedApp(adminAuth);
		//Unclear why we have to explicitly set something to have the read on
		//the next line succeed. 
		await firebase.assertSucceeds(db.collection(USERS_COLLECTION).doc(bobUid).set({bob:true}));
		//this is the actual condition we're testing
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

});
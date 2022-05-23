//based on https://github.com/firebase/quickstart-testing/blob/master/unit-test-security-rules-v9/test/firestore.spec.js
/*eslint-env node*/
const {
	assertFails,
	assertSucceeds,
	initializeTestEnvironment
} = require('@firebase/rules-unit-testing');

const {
	doc,
	getDoc,
	getDocs,
	setDoc,
	updateDoc,
	deleteDoc,
	query,
	where,
	collection,
	arrayUnion,
	serverTimestamp
} = require('firebase/firestore');

const fs = require('fs');
const http = require('http');

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

let testEnv;

function authedApp(auth) {
	//TODO: if we don't actually pass anything other than auth.uid, just get rid of the auth vs uid indirection
	const context = auth ? testEnv.authenticatedContext(auth.uid) : testEnv.unauthenticatedContext();
	return context.firestore();
}

async function addPermissionForUser(uid, permissionToSet) {
	await testEnv.withSecurityRulesDisabled(async (context) => {
		const db = context.firestore();
		setDoc(doc(db, PERMISSIONS_COLLECTION, uid), {[permissionToSet]:true}, {merge:true});
	});
}

async function setupDatabase() {
	await testEnv.withSecurityRulesDisabled(async (context) => {
		const db = context.firestore();
		await setDoc(doc(db, PERMISSIONS_COLLECTION, adminUid), {admin:true});
		await setDoc(doc(db, PERMISSIONS_COLLECTION, bobUid), {viewUnpublished: true});
		await setDoc(doc(db, PERMISSIONS_COLLECTION, jerryUid), {edit: true});
		await setDoc(doc(db, CARDS_COLLECTION, cardId), {
			body: 'this is the body',
			title: 'this is the title',
			author: bobUid,
			permissions:{
				editCard: [sallyUid],
			} ,
			thread_count: cardThreadCount,
			thread_resolved_count: cardThreadResolvedCount,
			star_count: cardStarCount,
			star_count_manual: cardStarCount,
			published: true,
			references_inbound: {},
			references_info_inbound:{},
		});
		await setDoc(doc(db, CARDS_COLLECTION, cardId, UPDATES_COLLECTION, updateId), {
			foo:3,
		});
		await setDoc(doc(db, CARDS_COLLECTION, unpublishedCardId), {
			body: 'this is the body',
			title: 'this is the title',
			author: bobUid,
			thread_count: cardThreadCount,
			thread_resolved_count: cardThreadResolvedCount,
			star_count: cardStarCount,
			star_count_manual: cardStarCount,
			published: false,
			references_inbound: {},
			references_info_inbound:{},
		});
	
		await setDoc(doc(db, CARDS_COLLECTION, unpublishedCardIdSallyAuthor), {
			body: 'this is the body',
			title: 'this is the title',
			author: sallyUid,
			thread_count: cardThreadCount,
			thread_resolved_count: cardThreadResolvedCount,
			star_count: cardStarCount,
			star_count_manual: cardStarCount,
			published: false,
			references_inbound: {},
			references_info_inbound:{},
		});
	
		await setDoc(doc(db, CARDS_COLLECTION, unpublishedCardIdSallyEditor), {
			body: 'this is the body',
			title: 'this is the title',
			permissions: {
				editCard: [sallyUid],
			},
			thread_count: cardThreadCount,
			thread_resolved_count: cardThreadResolvedCount,
			star_count: cardStarCount,
			star_count_manual: cardStarCount,
			published: false,
			references_inbound: {},
			references_info_inbound:{},
		});
	
		await setDoc(doc(db, TAGS_COLLECTION, cardId), {
			foo:3,
		});

		await setDoc(doc(db, TAGS_COLLECTION, cardId, UPDATES_COLLECTION, updateId), {
			foo:4,
		});
	
		await setDoc(doc(db, SECTIONS_COLLECTION, cardId), {
			foo:3,
		});
		await setDoc(doc(db, SECTIONS_COLLECTION, cardId, UPDATES_COLLECTION, updateId), {
			foo:4,
		});
	
		await setDoc(doc(db, MAINTENANCE_COLLECTION, cardId), {
			foo: 3,
		});
	
		await setDoc(doc(db, MESSAGES_COLLECTION, messageId), {
			message: 'blah',
			author: bobUid,
		});

		await setDoc(doc(db, THREADS_COLLECTION, messageId), {
			author:bobUid,
			messages: [messageId]
		});
		//This is a star/read/reading-list by anon user, not bob, because we'll use
		//an anon user to test that they can create stars (they're allowed to)
		await setDoc(doc(db, STARS_COLLECTION, starId), {
			owner: anonUid,
			card: cardId,
		});
		await setDoc(doc(db, READS_COLLECTION, starId), {
			owner: anonUid,
			card: cardId,
		});
		await setDoc(doc(db, READING_LISTS_COLLECTION, anonUid), {
			owner: anonUid,
			cards: [cardId],
		});
		await setDoc(doc(db, READING_LISTS_COLLECTION, anonUid, UPDATES_COLLECTION, messageId), {
			foo: 3,
		});
	
		await setDoc(doc(db, TWEETS_COLLECTION, messageId), {
			card: cardId,
		});
	});
}

beforeEach(async () => {
	// Clear the database between tests
	await testEnv.clearFirestore();
	await setupDatabase();
});

before(async () => {
	testEnv = await initializeTestEnvironment({
		firestore: {
			rules: fs.readFileSync('firestore.rules', 'utf8'),
		}
	});
});

after(async () => {
	// Delete all the FirebaseApp instances created during testing.
	// Note: this does not affect or clear any data.
	await testEnv.cleanup();

	// Write the coverage report to a file
	const coverageFile = 'firestore-coverage.html';
	const fstream = fs.createWriteStream(coverageFile);
	await new Promise((resolve, reject) => {
		const { host, port } = testEnv.emulators.firestore;
		const quotedHost = host.includes(':') ? `[${host}]` : host;
		http.get(`http://${quotedHost}:${port}/emulator/v1/projects/${testEnv.projectId}:ruleCoverage.html`, (res) => {
			res.pipe(fstream, { end: true });

			res.on('end', resolve);
			res.on('error', reject);
		});
	});

	console.log(`View firestore rule coverage information at ${coverageFile}\n`);
});

describe('Compendium Rules', () => {
	it('allows anyone to read a published card', async () => {
		const db = authedApp(null);
		const card = doc(db, CARDS_COLLECTION, cardId);
		await assertSucceeds(getDoc(card));
	});

	it('allows anyone to query for published card', async () => {
		const db = authedApp(null);
		const q = query(collection(db, CARDS_COLLECTION), where('published', '==', true));
		await assertSucceeds(getDocs(q));
	});

	it('disallows default user to query for cards that may include ones that aren\t published', async () => {
		const db = authedApp(null);
		const q = collection(db, CARDS_COLLECTION);
		await assertFails(getDocs(q));
	});

	it('disallows normal users permission to view unpublished cards', async() => {
		const db = authedApp(sallyAuth);
		const card = doc(db, CARDS_COLLECTION, unpublishedCardId);
		await assertFails(getDoc(card));
	});

	it ('allows users with viewUnpublished permission to view unpublished card', async() => {
		const db = authedApp(bobAuth);
		const card = doc(db, CARDS_COLLECTION, unpublishedCardId);
		await assertSucceeds(getDoc(card));
	});

	it ('allows users with edit permission to view unpublished card', async() => {
		const db = authedApp(jerryAuth);
		const card = doc(db, CARDS_COLLECTION, unpublishedCardId);
		await assertSucceeds(getDoc(card));
	});

	it ('allows users with editCard permission to view unpublished card', async() => {
		const db = authedApp(genericAuth);
		await addPermissionForUser(genericUid, 'editCard');
		const card = doc(db, CARDS_COLLECTION, unpublishedCardId);
		await assertSucceeds(getDoc(card));
	});

	it ('allows users with admin permission to view unpublished card', async() => {
		const db = authedApp(adminAuth);
		const card = doc(db, CARDS_COLLECTION, unpublishedCardId);
		await assertSucceeds(getDoc(card));
	});

	it ('allows users to view unpublished card they are an author of even without viewUnpublished permission', async() => {
		const db = authedApp(sallyAuth);
		const q =  query(collection(db, CARDS_COLLECTION), where('published', '==', false), where('author', '==', sallyUid));
		await assertSucceeds(getDocs(q));
	});

	it ('allows users to view unpublished card they are listed as editor of even without viewUnpublished permission', async() => {
		const db = authedApp(sallyAuth);
		const q =  query(collection(db, CARDS_COLLECTION), where('published', '==', false), where('permissions.editCard', 'array-contains', sallyUid));
		await assertSucceeds(getDocs(q));
	});

	it('allows admins to create a card', async() => {
		const db = authedApp(adminAuth);
		const card = doc(db, CARDS_COLLECTION, cardId + 'new');
		await assertSucceeds(setDoc(card, {tile:'foo', body:'foo', author:adminUid}));
	});

	it('allows users with edit permission to create a card', async() => {
		const db = authedApp(jerryAuth);
		const card = doc(db, CARDS_COLLECTION, cardId + 'new');
		await assertSucceeds(setDoc(card, {tile:'foo', body:'foo', author:jerryUid}));
	});

	it('allows users with createCard permission to create a card', async() => {
		const db = authedApp(genericAuth);
		await addPermissionForUser(genericUid, 'createCard');
		const card = doc(db, CARDS_COLLECTION, cardId + 'new');
		await assertSucceeds(setDoc(card, {tile:'foo', body:'foo', author:genericUid}));
	});

	it('disallows admins to create a card they aren\'t author of', async() => {
		const db = authedApp(adminAuth);
		const card = doc(db, CARDS_COLLECTION, cardId + 'new');
		await assertFails(setDoc(card, {tile:'foo', body:'foo', author:bobUid}));
	});

	it('does not allow normal users to create a card', async() => {
		const db = authedApp(bobAuth);
		const card = doc(db, CARDS_COLLECTION, cardId + 'new');
		await assertFails(setDoc(card, {tile:'foo', body:'foo'}));
	});

	it('does not allow unauthenticated users to create a card', async() => {
		const db = authedApp(null);
		const card = doc(db, CARDS_COLLECTION, cardId);
		await assertFails(setDoc(card, {tile:'foo', body:'foo'}));
	});

	it('allows any non-anon users to increment thread_count', async() => {
		const db = authedApp(bobAuth);
		const card = doc(db, CARDS_COLLECTION, cardId);
		await assertSucceeds(updateDoc(card, {thread_count: cardThreadCount + 1}));
	});

	it('disallows any anon users to increment thread_count', async() => {
		const db = authedApp(anonAuth);
		const card = doc(db, CARDS_COLLECTION, cardId);
		await assertFails(updateDoc(card, {thread_count: cardThreadCount + 1}));
	});

	//The next two tests exercise the increment/decrement behavior in general, effectively.
	it('disallows any non-anon users to increment thread_count by more than 1', async() => {
		const db = authedApp(genericAuth);
		const card = doc(db, CARDS_COLLECTION, cardId);
		await assertFails(updateDoc(card, {thread_count: cardThreadCount + 2}));
	});

	it('disallows any non-anon users to decrement thread_count', async() => {
		const db = authedApp(genericAuth);
		const card = doc(db, CARDS_COLLECTION, cardId);
		await assertFails(updateDoc(card, {thread_count: cardThreadCount - 1}));
	});

	it('disallows any non-anon users to modify another field while incremeting thread_count', async() => {
		const db = authedApp(genericAuth);
		const card = doc(db, CARDS_COLLECTION, cardId);
		await assertFails(updateDoc(card, {thread_count: cardThreadCount + 1, body:'other'}));
	});

	it('allows any non-anon users to decrement thread_count by 1 and increment resolved_thread_count by 1', async() => {
		const db = authedApp(bobAuth);
		const card = doc(db, CARDS_COLLECTION, cardId);
		await assertSucceeds(updateDoc(card, {thread_count: cardThreadCount - 1, thread_resolved_count: cardThreadResolvedCount + 1}));
	});

	it('disallows any anon users to decrement thread_count by 1 and increment resolved_thread_count by 1', async() => {
		const db = authedApp(anonAuth);
		const card = doc(db, CARDS_COLLECTION, cardId);
		await assertFails(updateDoc(card, {thread_count: cardThreadCount - 1, thread_resolved_count: cardThreadResolvedCount + 1}));
	});

	it('disallows any non-anon users to increment thread_count by 1 and increment resolved_thread_count by 1', async() => {
		const db = authedApp(genericAuth);
		const card = doc(db, CARDS_COLLECTION, cardId);
		await assertFails(updateDoc(card, {thread_count: cardThreadCount + 1, thread_resolved_count: cardThreadResolvedCount + 1}));
	});

	it('disallows any non-anon users to decrement thread_count by 1 and increment resolved_thread_count by 1 if they have other fields', async() => {
		const db = authedApp(genericAuth);
		const card = doc(db, CARDS_COLLECTION, cardId);
		await assertFails(updateDoc(card, {thread_count: cardThreadCount - 1, thread_resolved_count: cardThreadResolvedCount + 1, body: 'foo'}));
	});

	it('allows any signed in users to increment star_count by 1', async() => {
		const db = authedApp(anonAuth);
		const card = doc(db, CARDS_COLLECTION, cardId);
		await assertSucceeds(updateDoc(card, {star_count: cardStarCount + 1, star_count_manual: cardStarCount + 1}));
	});

	it('disallows any nonauthenticated  users to increment star_count by 1', async() => {
		const db = authedApp(null);
		const card = doc(db, CARDS_COLLECTION, cardId);
		await assertFails(updateDoc(card, {star_count: cardStarCount + 1, star_count_manual: cardStarCount + 1}));
	});

	it('disallows any signed in users to increment star_count by 1 if they edit other fields', async() => {
		const db = authedApp(anonAuth);
		const card = doc(db, CARDS_COLLECTION, cardId);
		await assertFails(updateDoc(card, {star_count: cardStarCount + 1, thread_count: cardThreadCount + 1}));
	});

	it('allows any signed in users to decrement star_count by 1', async() => {
		const db = authedApp(anonAuth);
		const card = doc(db, CARDS_COLLECTION, cardId);
		await assertSucceeds(updateDoc(card, {star_count: cardStarCount - 1, star_count_manual: cardStarCount - 1}));
	});

	it('disallows any nonauthenticated users to decrement star_count by 1', async() => {
		const db = authedApp(null);
		const card = doc(db, CARDS_COLLECTION, cardId);
		await assertFails(updateDoc(card, {star_count: cardStarCount - 1, star_count_manual: cardStarCount - 1}));
	});

	it('disallows any signed in users to decrement star_count by 1 if they edit other fields', async() => {
		const db = authedApp(anonAuth);
		const card = doc(db, CARDS_COLLECTION, cardId);
		await assertFails(updateDoc(card, {star_count: cardStarCount - 1, thread_count: cardThreadCount + 1}));
	});

	it('allows any non-anon user to update the updated_message timestamp to now',async() => {
		const db = authedApp(bobAuth);
		const card = doc(db, CARDS_COLLECTION, cardId);
		await assertSucceeds(updateDoc(card, {updated_message: serverTimestamp()}));
	});

	it('disallows any non-anon user to update the updated_message timestamp to now',async() => {
		const db = authedApp(genericAuth);
		const card = doc(db, CARDS_COLLECTION, cardId);
		await assertFails(updateDoc(card, {updated_message: new Date(2015,10,10)}));
	});

	it('disallows any non-anon user to update the updated_message timestamp to now if they also change another field',async() => {
		const db = authedApp(genericAuth);
		const card = doc(db, CARDS_COLLECTION, cardId);
		await assertFails(updateDoc(card, {updated_message: serverTimestamp(), star_count: cardStarCount + 1}));
	});

	it('disallows any anon user to update the updated_message timestamp to now',async() => {
		const db = authedApp(anonAuth);
		const card = doc(db, CARDS_COLLECTION, cardId);
		await assertFails(updateDoc(card, {updated_message: serverTimestamp()}));
	});

	it('allows any non-anon user to update the updated_message timestamp to now while also incrementing thread_count',async() => {
		const db = authedApp(bobAuth);
		const card = doc(db, CARDS_COLLECTION, cardId);
		await assertSucceeds(updateDoc(card, {updated_message: serverTimestamp(), thread_count: cardThreadCount + 1}));
	});

	it('disallows any anon user to update the updated_message timestamp to now while also incrementing thread_count',async() => {
		const db = authedApp(anonAuth);
		const card = doc(db, CARDS_COLLECTION, cardId);
		await assertFails(updateDoc(card, {updated_message: serverTimestamp(), thread_count: cardThreadCount + 1}));
	});

	it('disallows any non-anon user to update the updated_message timestamp to now if they decrement incrementing thread_count',async() => {
		const db = authedApp(genericAuth);
		const card = doc(db, CARDS_COLLECTION, cardId);
		await assertFails(updateDoc(card, {updated_message: serverTimestamp(), thread_count: cardThreadCount - 1}));
	});

	it('disallows any non-anon user to update the updated_message timestamp to now while incrementing thread_count if they also touch another field',async() => {
		const db = authedApp(genericAuth);
		const card = doc(db, CARDS_COLLECTION, cardId);
		await assertFails(updateDoc(card, {updated_message: serverTimestamp(), thread_count: cardThreadCount + 1, star_count: cardStarCount + 1}));
	});

	it('disallows any non-admin user to set arbitrary field on card', async () => {
		const db = authedApp(genericAuth);
		const card = doc(db, CARDS_COLLECTION, cardId);
		await assertFails(updateDoc(card, {foo:5}));
	});

	it('allows users with edit permission to arbitrarily edit a card', async () => {
		const db = authedApp(jerryAuth);
		const card = doc(db, CARDS_COLLECTION, cardId);
		await assertSucceeds(updateDoc(card, {foo:5}));
	});

	it('allows users with editCard permission to arbitrarily edit a card', async () => {
		const db = authedApp(genericAuth);
		await addPermissionForUser(genericUid, 'editCard');
		const card = doc(db, CARDS_COLLECTION, cardId);
		await assertSucceeds(updateDoc(card, {foo:5}));
	});

	it('allows users explicitly marked as author for that card to arbitrarily edit a card', async () => {
		//bob is explictly the author
		const db = authedApp(bobAuth);
		const card = doc(db, CARDS_COLLECTION, cardId);
		await assertSucceeds(updateDoc(card, {foo:5}));
	});

	it('allows users explicitly marked as editors for that card to arbitrarily edit a card', async () => {
		//Sally is explicitly listed as an editor on the card
		const db = authedApp(sallyAuth);
		const card = doc(db, CARDS_COLLECTION, cardId);
		await assertSucceeds(updateDoc(card, {foo:5}));
	});

	it('allows users explicitly marked as editors to arbitrarily edit a card', async () => {
		//jerry has blanket edit permission
		const db = authedApp(jerryAuth);
		const card = doc(db, CARDS_COLLECTION, cardId);
		await assertSucceeds(updateDoc(card, {foo:5}));
	});

	it('allows admins to read card updates', async() => {
		const db = authedApp(adminAuth);
		const update = doc(db, CARDS_COLLECTION, cardId, UPDATES_COLLECTION, updateId);
		await assertSucceeds(getDoc(update));
	});

	it('allows explicitly listed author for a card to read card updates', async() => {
		const db = authedApp(bobAuth);
		const update = doc(db, CARDS_COLLECTION, cardId, UPDATES_COLLECTION, updateId);
		await assertSucceeds(getDoc(update));
	});

	it('allows explicitly listed editors for a card to read card updates', async() => {
		const db = authedApp(sallyAuth);
		const update = doc(db, CARDS_COLLECTION, cardId, UPDATES_COLLECTION, updateId);
		await assertSucceeds(getDoc(update));
	});

	it('allows explicitly listed editors to read card updates', async() => {
		const db = authedApp(jerryAuth);
		const update = doc(db, CARDS_COLLECTION, cardId, UPDATES_COLLECTION, updateId);
		await assertSucceeds(getDoc(update));
	});

	it('allows admins to set card updates', async() => {
		const db = authedApp(adminAuth);
		const update = doc(db, CARDS_COLLECTION, cardId, UPDATES_COLLECTION, newUpdateId);
		await assertSucceeds(setDoc(update, {foo:4}));
	});

	it('allows explicitly listed editors for a card to set card updates', async() => {
		const db = authedApp(sallyAuth);
		const update = doc(db, CARDS_COLLECTION, cardId, UPDATES_COLLECTION, newUpdateId);
		await assertSucceeds(setDoc(update, {foo:4}));
	});

	it('allows explicitly listed editors to set card updates', async() => {
		const db = authedApp(jerryAuth);
		const update = doc(db, CARDS_COLLECTION, cardId, UPDATES_COLLECTION, newUpdateId);
		await assertSucceeds(setDoc(update, {foo:4}));
	});

	it('disallows users from reading card updates', async() => {
		const db = authedApp(genericAuth);
		const update = doc(db, CARDS_COLLECTION, cardId, UPDATES_COLLECTION, updateId);
		await assertFails(getDoc(update));
	});

	it('disallows users from setting card updates', async() => {
		const db = authedApp(genericAuth);
		const update = doc(db, CARDS_COLLECTION, cardId, UPDATES_COLLECTION, newUpdateId);
		await assertFails(setDoc(update, {foo:4}));
	});

	it('allows everyone to read tags collection', async() => {
		const db = authedApp(null);
		const tag = doc(db, TAGS_COLLECTION, cardId);
		await assertSucceeds(getDoc(tag));
	});

	it('allows admins to set tags collection', async() => {
		const db = authedApp(adminAuth);
		const tag = doc(db, TAGS_COLLECTION, cardId);
		await assertSucceeds(setDoc(tag, {bar: 3}));
	});

	it('allows users with edit privileges to set tags collection', async() => {
		const db = authedApp(jerryAuth);
		const tag = doc(db, TAGS_COLLECTION, cardId);
		await assertSucceeds(setDoc(tag, {bar: 3}));
	});

	it('allows users with editTag privilegs to set tags collection', async() => {
		const db = authedApp(genericAuth);
		await addPermissionForUser(genericUid, 'editTag');
		const tag = doc(db, TAGS_COLLECTION, cardId);
		await assertSucceeds(setDoc(tag, {bar: 3}));
	});

	it('disallows everyone to set tags collection', async() => {
		const db = authedApp(bobAuth);
		const tag = doc(db, TAGS_COLLECTION, cardId);
		await assertFails(setDoc(tag, {bar: 3}));
	});

	it('disallows everyone from reading tag updates collection', async() => {
		const db = authedApp(bobAuth);
		const update = doc(db, TAGS_COLLECTION, cardId, UPDATES_COLLECTION, updateId);
		await assertFails(getDoc(update));
	});

	it('allows admin to set tag updates collection', async() => {
		const db = authedApp(adminAuth);
		const update = doc(db, TAGS_COLLECTION, cardId, UPDATES_COLLECTION, updateId);
		await assertSucceeds(setDoc(update, {bar: 3}));
	});

	it('allows users with edit privilege to set tag updates collection', async() => {
		const db = authedApp(jerryAuth);
		const update = doc(db, TAGS_COLLECTION, cardId, UPDATES_COLLECTION, updateId);
		await assertSucceeds(setDoc(update, {bar: 3}));
	});

	it('allows users with editTag privilege to set tag updates collection', async() => {
		const db = authedApp(genericAuth);
		await addPermissionForUser(genericUid, 'editTag');
		const update = doc(db, TAGS_COLLECTION, cardId, UPDATES_COLLECTION, updateId);
		await assertSucceeds(setDoc(update, {bar: 3}));
	});

	it('allows everyone to read sections collection', async() => {
		const db = authedApp(null);
		const section = doc(db, SECTIONS_COLLECTION, cardId);
		await assertSucceeds(getDoc(section));
	});

	it('allows admins to set sections collection', async() => {
		const db = authedApp(adminAuth);
		const section = doc(db, SECTIONS_COLLECTION, cardId);
		await assertSucceeds(setDoc(section, {bar: 3}));
	});

	it('allows users with edit privileges to set sections collection', async() => {
		const db = authedApp(jerryAuth);
		const section = doc(db, SECTIONS_COLLECTION, cardId);
		await assertSucceeds(setDoc(section, {bar: 3}));
	});

	it('allows users with editSection privileges to set sections collection', async() => {
		const db = authedApp(genericAuth);
		await addPermissionForUser(genericUid,'editSection');
		const section = doc(db, SECTIONS_COLLECTION, cardId);
		await assertSucceeds(setDoc(section, {bar: 3}));
	});

	it('disallows everyone to set sections collection', async() => {
		const db = authedApp(bobAuth);
		const section = doc(db, SECTIONS_COLLECTION, cardId);
		await assertFails(setDoc(section, {bar: 3}));
	});

	it('disallows everyone from reading section updates collection', async() => {
		const db = authedApp(bobAuth);
		const update = doc(db, SECTIONS_COLLECTION, cardId, UPDATES_COLLECTION, updateId);
		await assertFails(getDoc(update));
	});

	it('allows admin to set section updates collection', async() => {
		const db = authedApp(adminAuth);
		const update = doc(db, SECTIONS_COLLECTION, cardId, UPDATES_COLLECTION, updateId);
		await assertSucceeds(setDoc(update, {bar: 3}));
	});

	it('allows users with edit privileges to set section updates collection', async() => {
		const db = authedApp(jerryAuth);
		const update = doc(db, SECTIONS_COLLECTION, cardId, UPDATES_COLLECTION, updateId);
		await assertSucceeds(setDoc(update, {bar: 3}));
	});

	it('allows users with editSection privileges to set section updates collection', async() => {
		const db = authedApp(genericAuth);
		await addPermissionForUser(genericUid, 'editSection');
		const update = doc(db, SECTIONS_COLLECTION, cardId, UPDATES_COLLECTION, updateId);
		await assertSucceeds(setDoc(update, {bar: 3}));
	});

	it('allows admins to read maintenance tasks', async() => {
		const db = authedApp(adminAuth);
		const task = doc(db, MAINTENANCE_COLLECTION, cardId);
		await assertSucceeds(getDoc(task));
	});

	it('allows admins to set maintenance tasks', async() => {
		const db = authedApp(adminAuth);
		const task = doc(db, MAINTENANCE_COLLECTION, cardId);
		await assertSucceeds(setDoc(task, {foo:4}));
	});

	it('disallows users from reading maintenance tasks', async() => {
		const db = authedApp(bobAuth);
		const task = doc(db, MAINTENANCE_COLLECTION, cardId);
		await assertFails(getDoc(task));
	});

	it('disallows users from setting maintenance tasks', async() => {
		const db = authedApp(bobAuth);
		const task = doc(db, MAINTENANCE_COLLECTION, cardId);
		await assertFails(setDoc(task, {foo:4}));
	});

	it('allows users to read back their permissions object', async() => {
		const db = authedApp(bobAuth);
		await assertSucceeds(getDoc(doc(db, PERMISSIONS_COLLECTION, bobUid)));
	});

	it('disallows users to read back other users permissions object', async() => {
		const db = authedApp(bobAuth);
		await assertFails(getDoc(db, PERMISSIONS_COLLECTION, sallyUid));
	});

	it('disallows users to modify their permissions object', async() => {
		const db = authedApp(bobAuth);
		await assertFails(updateDoc(doc(db, PERMISSIONS_COLLECTION, bobUid), {admin:true}));
	});

	it('allows admins to read back other users permissions object', async() => {
		const db = authedApp(adminAuth);
		await assertSucceeds(getDoc(doc(db, PERMISSIONS_COLLECTION, sallyUid)));
	});

	it('allows admins to set other users permissions object that don\'t contain admin keys', async() => {
		const db = authedApp(adminAuth);
		await assertSucceeds(setDoc(doc(db, PERMISSIONS_COLLECTION, sallyUid), {edit: true, viewUnpublished: true}));
	});

	it('disallows even admins to set other users permissions object that do contain admin keys', async() => {
		const db = authedApp(adminAuth);
		await assertFails(setDoc(doc(db, PERMISSIONS_COLLECTION, sallyUid), {admin: true, viewUnpublished: true}));
	});

	it('allows admins to delete users permissions object', async() => {
		const db = authedApp(adminAuth);
		await setDoc(doc(db, PERMISSIONS_COLLECTION, genericUid), {foo:true});
		await assertSucceeds(deleteDoc(doc(db, PERMISSIONS_COLLECTION, genericUid)));
	});

	it('anyone may read authors objects', async() => {
		const db = authedApp(null);
		await assertSucceeds(getDoc(doc(db, AUTHORS_COLLECTION, bobUid)));
	});

	it('users may modify their own author object', async() => {
		const db = authedApp(bobAuth);
		await assertSucceeds(setDoc(doc(db, AUTHORS_COLLECTION, bobUid), {bob:true}));
	});

	it('users may not modify others author object', async() => {
		const db = authedApp(bobAuth);
		await assertFails(setDoc(doc(db, AUTHORS_COLLECTION, sallyUid), {bob:true}));
	});

	it('admins may modify others author object, but only if they don\'t set any keys', async() => {
		const db = authedApp(adminAuth);
		await assertSucceeds(setDoc(doc(db, AUTHORS_COLLECTION, 'newUid'), {}, {merge: true}));
	});

	it('admins may not modify others author object if they set any keys', async() => {
		const db = authedApp(adminAuth);
		await assertFails(setDoc(doc(db, AUTHORS_COLLECTION, 'newUid'), {bob:true}, {merge: true}));
	});

	it('users may modify their own user object', async() => {
		const db = authedApp(bobAuth);
		await assertSucceeds(setDoc(doc(db, USERS_COLLECTION, bobUid), {bob:true}));
	});

	it('users may read their own user object', async() => {
		const db = authedApp(bobAuth);
		await assertSucceeds(getDoc(doc(db, USERS_COLLECTION, bobUid)));
	});

	it('users may not modify others user object', async() => {
		const db = authedApp(bobAuth);
		await assertFails(setDoc(doc(db, USERS_COLLECTION, sallyUid), {bob:true}));
	});

	it('users may not read others user object', async() => {
		const db = authedApp(bobAuth);
		await assertFails(getDoc(doc(db, USERS_COLLECTION, sallyUid)));
	});

	it('allows anyone to read messages', async() => {
		const db = authedApp(null);
		await assertSucceeds(getDoc(doc(db, MESSAGES_COLLECTION, messageId)));
	});

	it('allows anyone to update messages they created', async() => {
		const db = authedApp(bobAuth);
		const message = doc(db, MESSAGES_COLLECTION, messageId);
		await assertSucceeds(updateDoc(message, {message: 'new message'}));
	});

	it('allows admins to update any message', async() => {
		const db = authedApp(adminAuth);
		const message = doc(db, MESSAGES_COLLECTION, messageId);
		await assertSucceeds(updateDoc(message, {message: 'new message'}));
	});

	it('disallows users who didn\'t create a message to update it', async() => {
		const db = authedApp(sallyAuth);
		const message = doc(db, MESSAGES_COLLECTION, messageId);
		await assertFails(updateDoc(message, {message: 'new message'}));
	});

	it('allows any non anonymous user to create a message if they are marked as author', async() => {
		const db = authedApp(bobAuth);
		const message = doc(db, MESSAGES_COLLECTION, newMessageId);
		await assertSucceeds(setDoc(message, {author: bobUid, message: 'new message'}));
	});

	it('disallows any non anonymous user to create a message if they are not marked as author', async() => {
		const db = authedApp(sallyAuth);
		const message = doc(db, MESSAGES_COLLECTION, newMessageId);
		await assertFails(setDoc(message, {author: bobUid, message: 'new message'}));
	});

	it('disallows any anonymous user to create a message even if they are marked as author', async() => {
		const db = authedApp(anonAuth);
		const message = doc(db, MESSAGES_COLLECTION, newMessageId);
		await assertFails(setDoc(message, {author: anonUid, message: 'new message'}));
	});

	it('allows anyone to read threads', async() => {
		const db = authedApp(null);
		await assertSucceeds(getDoc(doc(db, THREADS_COLLECTION, messageId)));
	});

	it('allows anyone to update threads they created', async() => {
		const db = authedApp(bobAuth);
		const thread = doc(db, THREADS_COLLECTION, messageId);
		await assertSucceeds(updateDoc(thread, {resolved: true}));
	});

	it('allows admins to update any thread', async() => {
		const db = authedApp(adminAuth);
		const thread = doc(db, THREADS_COLLECTION, messageId);
		await assertSucceeds(updateDoc(thread, {resolved: true}));
	});

	it('disallows users who didn\'t create a thread to update it', async() => {
		const db = authedApp(sallyAuth);
		const thread = doc(db, THREADS_COLLECTION, messageId);
		await assertFails(updateDoc(thread, {resolved: true}));
	});

	it('allows any non anonymous user to create a thread if they are marked as author', async() => {
		const db = authedApp(bobAuth);
		const thread = doc(db, THREADS_COLLECTION, newMessageId);
		await assertSucceeds(setDoc(thread, {author: bobUid}));
	});

	it('disallows any non anonymous user to create a thread if they are not marked as author', async() => {
		const db = authedApp(sallyAuth);
		const thread = doc(db, THREADS_COLLECTION, newMessageId);
		await assertFails(setDoc(thread, {author: bobUid}));
	});

	it('disallows any anonymous user to create a thread even if they are marked as author', async() => {
		const db = authedApp(anonAuth);
		const thread = doc(db, THREADS_COLLECTION, newMessageId);
		await assertFails(setDoc(thread, {author: anonUid}));
	});

	it('allows non-authors to update a thraed if they are not anonymous and it only adds a message', async() => {
		const db = authedApp(sallyAuth);
		const thread = doc(db, THREADS_COLLECTION, messageId);
		await assertSucceeds(updateDoc(thread, {messages: arrayUnion(newMessageId), updated:serverTimestamp()}));
	});

	it('disallows anonymous users to update a non-author thread even if it only adds message', async() => {
		const db = authedApp(anonAuth);
		const thread = doc(db, THREADS_COLLECTION, messageId);
		await assertFails(updateDoc(thread, {messages: arrayUnion(newMessageId), updated: serverTimestamp()}));
	});

	it('allows any user to create a star they own', async() => {
		const db = authedApp(anonAuth);
		const star = doc(db, STARS_COLLECTION, newStarId);
		await assertSucceeds(setDoc(star, {owner:anonUid, card: cardId}));
	});

	it('disallows user to create a star they don\'t own', async() => {
		const db = authedApp(sallyAuth);
		const star = doc(db, STARS_COLLECTION, newStarId);
		await assertFails(setDoc(star, {owner:anonUid, card: cardId}));
	});

	it('allows any user to update a star they own', async() => {
		const db = authedApp(anonAuth);
		const star = doc(db, STARS_COLLECTION, starId);
		await assertSucceeds(updateDoc(star, {card: newMessageId}));
	});

	it('disallows user to update a star they don\'t own', async() => {
		const db = authedApp(sallyAuth);
		const star = doc(db, STARS_COLLECTION, starId);
		await assertFails(updateDoc(star, {card: newMessageId}));
	});

	it('allows any user to delete a star they own', async() => {
		const db = authedApp(anonAuth);
		const star = doc(db, STARS_COLLECTION, starId);
		await assertSucceeds(deleteDoc(star));
	});

	it('disallows user to delete a star they don\'t own', async() => {
		const db = authedApp(sallyAuth);
		const star = doc(db, STARS_COLLECTION, starId);
		await assertFails(deleteDoc(star));
	});

	it('allows any user to read a star they own', async() => {
		const db = authedApp(anonAuth);
		const star = doc(db, STARS_COLLECTION, starId);
		await assertSucceeds(getDoc(star));
	});

	it('disallows user to read a star they don\'t own', async() => {
		const db = authedApp(sallyAuth);
		const star = doc(db, STARS_COLLECTION, starId);
		await assertFails(getDoc(star));
	});

	it('allows any user to create a read they own', async() => {
		const db = authedApp(anonAuth);
		const read = doc(db, READS_COLLECTION, newStarId);
		await assertSucceeds(setDoc(read, {owner:anonUid, card: cardId}));
	});

	it('disallows user to create a read they don\'t own', async() => {
		const db = authedApp(sallyAuth);
		const read = doc(db, READS_COLLECTION, newStarId);
		await assertFails(setDoc(read, {owner:anonUid, card: cardId}));
	});

	it('allows any user to update a read they own', async() => {
		const db = authedApp(anonAuth);
		const read = doc(db, READS_COLLECTION, starId);
		await assertSucceeds(updateDoc(read, {card: newMessageId}));
	});

	it('disallows user to update a read they don\'t own', async() => {
		const db = authedApp(sallyAuth);
		const read = doc(db, READS_COLLECTION, starId);
		await assertFails(updateDoc(read, {card: newMessageId}));
	});

	it('allows any user to delete a read they own', async() => {
		const db = authedApp(anonAuth);
		const read = doc(db, READS_COLLECTION, starId);
		await assertSucceeds(deleteDoc(read));
	});

	it('disallows user to delete a read they don\'t own', async() => {
		const db = authedApp(sallyAuth);
		const read = doc(db, READS_COLLECTION, starId);
		await assertFails(deleteDoc(read));
	});

	it('allows any user to read a read they own', async() => {
		const db = authedApp(anonAuth);
		const read = doc(db, READS_COLLECTION, starId);
		await assertSucceeds(getDoc(read));
	});

	it('disallows user to read a read they don\'t own', async() => {
		const db = authedApp(sallyAuth);
		const read = doc(db, READS_COLLECTION, starId);
		await assertFails(getDoc(read));
	});

	it('allows anyone to read tweets info', async() => {
		const db = authedApp(null);
		const tweet = doc(db, TWEETS_COLLECTION, messageId);
		await assertSucceeds(getDoc(tweet));
	});

	it('disallows users to set tweets info', async() => {
		const db = authedApp(bobAuth);
		const tweet = doc(db, TWEETS_COLLECTION, messageId);
		await assertFails(updateDoc(tweet, {card: cardId + 'new'}));
	});

	it('allows any user to create a reading-list they own', async() => {
		const db = authedApp(anonAuth);
		const list = doc(db, READING_LISTS_COLLECTION, anonUid);
		await assertSucceeds(setDoc(list, {owner:anonUid, cards: [cardId]}));
	});

	it('disallows user to create a reading-list they don\'t own', async() => {
		const db = authedApp(sallyAuth);
		const list = doc(db, READING_LISTS_COLLECTION, anonUid);
		await assertFails(setDoc(list, {owner:anonUid, cards: [cardId]}));
	});

	it('allows any user to update a reading-list they own', async() => {
		const db = authedApp(anonAuth);
		const list = doc(db, READING_LISTS_COLLECTION, anonUid);
		await assertSucceeds(updateDoc(list, {cards: arrayUnion(newMessageId)}));
	});

	it('disallows user to update a reading-list they don\'t own', async() => {
		const db = authedApp(sallyAuth);
		const list = doc(db, READING_LISTS_COLLECTION, anonUid);
		await assertFails(updateDoc(list, {cards: arrayUnion(newMessageId)}));
	});

	it('allows any user to delete a reading-list they own', async() => {
		const db = authedApp(anonAuth);
		const list = doc(db, READING_LISTS_COLLECTION, anonUid);
		await assertSucceeds(deleteDoc(list));
	});

	it('disallows user to delete a reading-list they don\'t own', async() => {
		const db = authedApp(sallyAuth);
		const list = doc(db, READING_LISTS_COLLECTION, anonUid);
		await assertFails(deleteDoc(list));
	});

	it('allows any user to read a reading-list they own', async() => {
		const db = authedApp(anonAuth);
		const list = doc(db, READING_LISTS_COLLECTION, anonUid);
		await assertSucceeds(getDoc(list));
	});

	it('disallows user to read a reading-list they don\'t own', async() => {
		const db = authedApp(sallyAuth);
		const list = doc(db, READING_LISTS_COLLECTION, anonUid);
		await assertFails(getDoc(list));
	});

	it('allows owner of reading-list to read updates for a reading-list they own', async() => {
		const db = authedApp(anonAuth);
		const update = doc(db, READING_LISTS_COLLECTION, anonUid, UPDATES_COLLECTION, updateId);
		await assertSucceeds(getDoc(update));
	});

	it('disallows user to read updates for a reading-list updates they don\'t own', async() => {
		const db = authedApp(sallyAuth);
		const update = doc(db, READING_LISTS_COLLECTION, anonUid, UPDATES_COLLECTION, updateId);
		await assertFails(getDoc(update));
	});

	it('allows owner of reading-list to write updates for a reading-list they own', async() => {
		const db = authedApp(anonAuth);
		const update = doc(db, READING_LISTS_COLLECTION, anonUid, UPDATES_COLLECTION, newUpdateId);
		await assertSucceeds(setDoc(update, {foo:4}));
	});

	it('disallows user to set updates for a reading-list updates they don\'t own', async() => {
		const db = authedApp(sallyAuth);
		const update = doc(db, READING_LISTS_COLLECTION, anonUid, UPDATES_COLLECTION, newUpdateId);
		await assertFails(setDoc(update, {foo:4}));
	});

	it('disallows users to delete a card they don\'t own', async() => {
		const db = authedApp(genericAuth);
		const update = doc(db, CARDS_COLLECTION, cardId);
		await assertFails(deleteDoc(update));
	});

	it('disallows users to delete a card they own that is not orphaned', async() => {
		const db = authedApp(jerryAuth);
		const testCardId = 'delete-test';
		const ref = doc(db, CARDS_COLLECTION, testCardId);
		await assertSucceeds(setDoc(ref, {
			body: 'this is the body',
			title: 'this is the title',
			author: jerryUid,
			section: 'random-thoughts',
			tags: [],
			references_inbound: {},
		}));
		await assertFails(deleteDoc(ref));
	});

	it('disallows users to delete a card they own that has tags', async() => {
		const db = authedApp(jerryAuth);
		const testCardId = 'delete-test';
		const ref = doc(db, CARDS_COLLECTION, testCardId);
		await assertSucceeds(setDoc(ref, {
			body: 'this is the body',
			title: 'this is the title',
			author: jerryUid,
			section: '',
			tags: ['bam'],
			references_inbound: {},
		}));
		await assertFails(deleteDoc(ref));
	});

	it('disallows users to delete a card they own that has inbound references', async() => {
		const db = authedApp(jerryAuth);
		const testCardId = 'delete-test';
		const ref = doc(db, CARDS_COLLECTION, testCardId);
		await assertSucceeds(setDoc(ref, {
			body: 'this is the body',
			title: 'this is the title',
			author: jerryUid,
			section: '',
			tags: [],
			references_inbound: {
				'foo': true,
			}
		}));
		await assertFails(deleteDoc(ref));
	});

	it('allows users to delete a card they own that has no section, no tags, and no inbound references', async() => {
		const db = authedApp(jerryAuth);
		const testCardId = 'delete-test';
		const ref = doc(db, CARDS_COLLECTION, testCardId);
		await assertSucceeds(setDoc(ref, {
			body: 'this is the body',
			title: 'this is the title',
			author: jerryUid,
			section: '',
			tags: [],
			references_inbound: {}
		}));
		await assertSucceeds(deleteDoc(ref));
	});

	it('allows users with edit permission to delete a card they own that has no section, no tags, and no inbound references', async() => {
		const testCardId = 'delete-test';
		await testEnv.withSecurityRulesDisabled(async (context) => {
			const db = context.firestore();
			const adminDbRef = doc(db, CARDS_COLLECTION, testCardId);
			await assertSucceeds(setDoc(adminDbRef, {
				body: 'this is the body',
				title: 'this is the title',
				author: bobUid,
				section: '',
				tags: [],
				references_inbound: {}
			}));
		});
		const db = authedApp(jerryAuth);
		const ref = doc(db, CARDS_COLLECTION, testCardId);
		await assertSucceeds(deleteDoc(ref));
	});

	it('disallows users to delete updates from a card they don\'t own', async() => {
		const db = authedApp(genericAuth);
		const update = doc(db, CARDS_COLLECTION, cardId, UPDATES_COLLECTION, updateId);
		await assertFails(deleteDoc(update));
	});

	it('allows users to delete updates from a card they own', async() => {
		const db = authedApp(bobAuth);
		const update = doc(db, CARDS_COLLECTION, cardId, UPDATES_COLLECTION, updateId);
		await assertSucceeds(deleteDoc(update));
	});

	it('allows users to update inbound links on a card they can see but cant edit', async() => {
		const db = authedApp(genericAuth);
		const card = doc(db, CARDS_COLLECTION, cardId);
		await assertSucceeds(updateDoc(card, {
			['references_inbound.' + unpublishedCardId]: true,
			['references_info_inbound.' + unpublishedCardId + '.link']: '',
		}));
	});

	it('disallows users to update inbound links on a card they can see but cant edit if the update contains other edits', async() => {
		const db = authedApp(genericAuth);
		const card = doc(db, CARDS_COLLECTION, cardId);
		await assertFails(updateDoc(card, {
			['references_inbound.' + unpublishedCardId]: true,
			['references_info_inbound.' + unpublishedCardId + '.link']: '',
			body: 'bam'
		}));
	});

	it('disallows users to update inbound links on a card they cannot see', async() => {
		const db = authedApp(genericAuth);
		const card = doc(db, CARDS_COLLECTION, unpublishedCardId);
		await assertFails(updateDoc(card, {
			['references_inbound.' + cardId]: true,
			['references_info_inbound.' + cardId + '.link']: '',
		}));
	});

	it('allows users to update inbound links on an unpublished card they can see but cant edit', async() => {
		const db = authedApp(sallyAuth);
		const card = doc(db, CARDS_COLLECTION, unpublishedCardIdSallyAuthor);
		await assertSucceeds(updateDoc(card, {
			['references_inbound.' + cardId]: true,
			['references_info_inbound.' + cardId + '.link']: '',
		}));
	});

});
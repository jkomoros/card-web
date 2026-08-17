/*eslint-env node, es2022*/

//THE FIRST EXECUTABLE TEST OF A THUNK-LAYER WRITE PATH.
//
//~27,000 LOC of components, thunks, the worker body and the bridge had zero
//executable coverage, guarded only by regex assertions over source text. That
//instrument failed visibly three times: two source-text tests were green while
//pointed at catastrophically broken lines, and test/atomic-group-balance passes
//if you delete the atomic group entirely. Card creation shipped 100% BROKEN —
//a beginAtomicGroup() with no matching end, so every commit threw — through a
//green suite and several deploys.
//
//The stated reason this layer could not be tested was wrong. lib/src/actions/
//data.js imports and runs in plain Node behind the jsdom shim the suite already
//uses elsewhere, and src/firebase.ts has a loopback-only emulator hook. So this
//drives the REAL registered executor, building a REAL MultiBatch, committing to
//a REAL Firestore emulator, and then reads the documents back.
//
//It asserts the WRITE PLAN, not authorization: which documents a creation
//touches and which timestamps the server assigns. Rules are covered by the 201
//tests in test/security, so the emulator here runs permissive rules
//(firestore.harness.rules) — otherwise every write-plan test would also have to
//mint credentials, which is what kept this layer untested.

import assert from 'assert';
import {bootstrapApp, clearAuxQueue, clearHarnessAlerts, harnessAlerts, seedQueuedIntent, wireCard as harnessWireCard} from '../harness-support/app-harness.js';

const app = await bootstrapApp();
const {db, uid: UID, firestore} = app;
const {doc, getDoc} = firestore;

//Importing data.js is what REGISTERS the card-create executor.
await import('../../lib/src/actions/data.js');
const queue = await import('../../lib/src/aux-write-queue.js');



const wireCard = (id) => harnessWireCard(id, UID);

describe('card-create executor (real MultiBatch against the emulator)', () => {
	beforeEach(clearAuxQueue);

	it('commits the card, and its atomic group actually closes', async () => {
		//THE REGRESSION THIS EXISTS FOR: with beginAtomicGroup unclosed, commit
		//throws, the outcome is 'queued' rather than 'committed', and the intent
		//stays in the queue forever while the UI claims the card was saved.
		const id = 'harness-card-' + Date.now();
		const outcome = await queue.runDurableAuxWrite(queue.makeAuxWriteIntent(UID, 'card-create', id, '', {
			kind: 'card-create',
			card: wireCard(id),
			section: '',
			sectionUpdateKey: '',
			serverTimestampFields: ['created', 'updated', 'updated_substantive', 'updated_message']
		}));
		assert.equal(outcome, 'committed', 'the card-create batch must actually commit');
		assert.deepEqual(queue.readPendingAuxWrites(), [], 'a committed intent must clear the queue');

		const snapshot = await getDoc(doc(db, 'cards', id));
		assert.ok(snapshot.exists(), 'the card document must exist on the server');
		const data = snapshot.data();
		assert.equal(data.title, 'harness card');
		assert.equal(data.body, '<p>harness</p>');
		assert.equal(data.author, UID);
	});

	it('lets the SERVER stamp every field that was a sentinel', async () => {
		//The regression this exists for: a serverTimestampSentinel is identified
		//by object identity, so the JSON round trip destroys it. Re-stamping only
		//`updated` left created / updated_substantive / updated_message as
		//CLIENT-CLOCK values — and updated_substantive is the field every
		//`updated/*` collection sorts and buckets on, so a skewed clock parked
		//new cards in the wrong day, or the future.
		const id = 'harness-stamp-' + Date.now();
		const before = Date.now();
		const outcome = await queue.runDurableAuxWrite(queue.makeAuxWriteIntent(UID, 'card-create', id, '', {
			kind: 'card-create',
			card: wireCard(id),
			section: '',
			sectionUpdateKey: '',
			serverTimestampFields: ['created', 'updated', 'updated_substantive', 'updated_message']
		}));
		assert.equal(outcome, 'committed');

		const data = (await getDoc(doc(db, 'cards', id))).data();
		for (const field of ['created', 'updated', 'updated_substantive', 'updated_message']) {
			const millis = data[field].toMillis();
			assert.ok(millis >= before - 1000,
				`${field} must be server-assigned, not the intent's client value (got ${new Date(millis).toISOString()})`);
		}
	});

	it('writes the section fanout and its audit document with the CAPTURED key', async () => {
		//The section must already exist: the executor UPDATEs it (arrayUnion),
		//and an update against a missing document fails the whole atomic group.
		//That is correct behavior — sections are fixed in this product — but it
		//is worth knowing that creating into a concurrently-deleted section
		//fails wholesale rather than partially.
		const {setDoc: seed} = await import('firebase/firestore');
		await seed(doc(db, 'sections', 'harness-section'), {cards: [], title: 'Harness'});
		//The captured key is what makes a replay idempotent: it was Date.now(),
		//so recomputing it would write a SECOND audit entry for one creation.
		const id = 'harness-section-' + Date.now();
		const sectionUpdateKey = 'harness-key-' + Date.now();
		const outcome = await queue.runDurableAuxWrite(queue.makeAuxWriteIntent(UID, 'card-create', id, '', {
			kind: 'card-create',
			card: {...wireCard(id), section: 'harness-section'},
			section: 'harness-section',
			sectionUpdateKey,
			serverTimestampFields: ['created', 'updated', 'updated_substantive', 'updated_message']
		}));
		assert.equal(outcome, 'committed');

		const section = await getDoc(doc(db, 'sections', 'harness-section'));
		assert.ok((section.data().cards || []).includes(id), 'the card must join its section');
		const audit = await getDoc(doc(db, 'sections', 'harness-section', 'updates', sectionUpdateKey));
		assert.ok(audit.exists(), 'the section audit doc must use the captured key');
		assert.equal(audit.data().add_card, id);
	});

	it('writes the author document once, and skips it when asked', async () => {
		//Bulk import carries skipAuthor on all but the first intent: ensureAuthor
		//writes ONE hot document, and doing it per card pushed a single doc past
		//Firestore's sustained per-document write ceiling.
		const withAuthor = 'harness-author-' + Date.now();
		await queue.runDurableAuxWrite(queue.makeAuxWriteIntent(UID, 'card-create', withAuthor, '', {
			kind: 'card-create', card: wireCard(withAuthor), section: '', sectionUpdateKey: '',
			serverTimestampFields: ['created', 'updated']
		}));
		assert.ok((await getDoc(doc(db, 'authors', UID))).exists(), 'the author doc must be written');

		const skipped = 'harness-skip-' + Date.now();
		const outcome = await queue.runDurableAuxWrite(queue.makeAuxWriteIntent(UID, 'card-create', skipped, '', {
			kind: 'card-create', card: wireCard(skipped), section: '', sectionUpdateKey: '',
			skipAuthor: true,
			serverTimestampFields: ['created', 'updated']
		}));
		assert.equal(outcome, 'committed', 'skipping the author write must not break the commit');
		assert.ok((await getDoc(doc(db, 'cards', skipped))).exists());
	});

	it('DELETES a card with its tombstone, atomically', async () => {
		//Deletion had no durable record at all: the UI committed first
		//(editingFinish + navigateToNextCard run before any server work) and the
		//enumeration of the updates subcollection rejects offline into a promise
		//nobody awaited — so the user confirmed, the view moved on, and the card
		//was still there after a reload.
		const id = 'harness-delete-' + Date.now();
		await queue.runDurableAuxWrite(queue.makeAuxWriteIntent(UID, 'card-create', id, '', {
			kind: 'card-create', card: wireCard(id), section: '', sectionUpdateKey: '',
			serverTimestampFields: ['created', 'updated']
		}));
		assert.ok((await getDoc(doc(db, 'cards', id))).exists());

		const outcome = await queue.runDurableAuxWrite(queue.makeAuxWriteIntent(UID, 'card-delete', id, '', {
			kind: 'card-delete', card: wireCard(id)
		}));
		assert.equal(outcome, 'committed');
		assert.ok(!(await getDoc(doc(db, 'cards', id))).exists(), 'the card must be gone');
		//The tombstone is what stops the card resurrecting on every other
		//device; losing it while the delete lands is a permanent ghost.
		const tombstone = await getDoc(doc(db, 'tombstones', id));
		assert.ok(tombstone.exists(), 'a tombstone must be written with the delete');
		assert.equal(tombstone.data().by, UID);
		assert.equal(tombstone.data().published, false);
		assert.ok(tombstone.data().deleted.toMillis() > 0, 'the tombstone is server-stamped');
	});

	it('a REPLAYED delete is a silent success when the card is already gone', async () => {
		const id = 'harness-delete-replay-' + Date.now();
		await queue.runDurableAuxWrite(queue.makeAuxWriteIntent(UID, 'card-create', id, '', {
			kind: 'card-create', card: wireCard(id), section: '', sectionUpdateKey: '',
			serverTimestampFields: ['created', 'updated']
		}));
		await queue.runDurableAuxWrite(queue.makeAuxWriteIntent(UID, 'card-delete', id, '', {
			kind: 'card-delete', card: wireCard(id)
		}));
		clearAuxQueue();
		clearHarnessAlerts();
		const tombstoneBefore = (await getDoc(doc(db, 'tombstones', id))).data().deleted.toMillis();
		await new Promise(resolve => setTimeout(resolve, 1100));

		//Absence SATISFIES a delete, unlike an edit — so this must clear
		//quietly rather than alarming the user about a discarded action.
		seedQueuedIntent(queue.makeAuxWriteIntent(UID, 'card-delete', id, '', {
			kind: 'card-delete', card: wireCard(id)
		}));
		await queue.replayPendingAuxWrites(UID);
		assert.deepEqual(queue.readPendingAuxWrites(), [], 'the already-satisfied delete clears');
		await new Promise(resolve => setTimeout(resolve, 50));
		assert.deepEqual(harnessAlerts, [], 'and does so silently');
		//DISTINGUISHING ASSERTION. Without it this test passes even if the
		//already-gone check is deleted: re-running the batch "works", because
		//deleting an absent document is harmless. What it is NOT harmless to do
		//is REWRITE THE TOMBSTONE — its `deleted` time is what the tombstone
		//plane's cursor keys on, so moving it forward re-delivers the deletion
		//to every other device. (Found by mutation: the mutant survived until
		//this assertion existed.)
		const tombstoneAfter = (await getDoc(doc(db, 'tombstones', id))).data().deleted.toMillis();
		assert.equal(tombstoneAfter, tombstoneBefore,
			'a replayed delete must not rewrite the tombstone timestamp');
	});

	it('REPAIRS a creation whose fanout did not land, without reverting the card', async () => {
		//The card doc existing does not prove the creation finished. A creation's
		//atomic group stays in one underlying batch only while it FITS: an
		//oversized group (forking a hub card, >~248 inbound references) is split
		//across batches that commit CONCURRENTLY with independent success. So the
		//card batch can land while the section/tag/inbound batch does not -- and
		//the old preflight returned on "card exists", cleared the intent, and made
		//that a permanent, silent loss of membership.
		const {setDoc, deleteDoc} = await import('firebase/firestore');
		await setDoc(doc(db, 'sections', 'repair-section'), {cards: [], title: 'Repair'});
		const id = 'harness-repair-' + Date.now();
		const sectionUpdateKey = 'repair-key-' + Date.now();
		const payload = {
			kind: 'card-create',
			card: {...wireCard(id), section: 'repair-section'},
			section: 'repair-section',
			sectionUpdateKey,
			serverTimestampFields: ['created', 'updated']
		};
		assert.equal(await queue.runDurableAuxWrite(queue.makeAuxWriteIntent(UID, 'card-create', id, '', payload)), 'committed');

		//Simulate the half that did NOT land: membership and its audit doc gone,
		//card doc present.
		await setDoc(doc(db, 'sections', 'repair-section'), {cards: [], title: 'Repair'});
		await deleteDoc(doc(db, 'sections', 'repair-section', 'updates', sectionUpdateKey));
		//And an edit made after the creation, which the replay must NOT revert.
		await setDoc(doc(db, 'cards', id), {...(await getDoc(doc(db, 'cards', id))).data(), body: '<p>edited since</p>'});

		clearAuxQueue();
		seedQueuedIntent(queue.makeAuxWriteIntent(UID, 'card-create', id, '', payload));
		await queue.replayPendingAuxWrites(UID);

		const section = await getDoc(doc(db, 'sections', 'repair-section'));
		assert.ok((section.data().cards || []).includes(id),
			'the replay must restore the membership the failed batch never wrote');
		assert.ok((await getDoc(doc(db, 'sections', 'repair-section', 'updates', sectionUpdateKey))).exists(),
			'and its audit document, under the captured key');
		//THE OTHER HALF. The card document is the one write that is NOT
		//idempotent -- re-setting it reverts everything saved since -- and
		//skipping it is the entire reason the preflight exists.
		assert.equal((await getDoc(doc(db, 'cards', id))).data().body, '<p>edited since</p>',
			'the replay must not revert the card itself');
		assert.deepEqual(queue.readPendingAuxWrites(), [], 'and it must clear the intent');
	});

	it('leaves the CARD alone on replay when it already exists', async () => {
		//Idempotency: the preflight asks whether the card exists, and a replay
		//must NOT re-run `set` — that would silently revert edits made since.
		//Note it is not a whole no-op: the idempotent fanout is re-applied, for
		//the reason the repair test above documents. Only the card document,
		//the one write that cannot be repeated safely, is skipped.
		const id = 'harness-replay-' + Date.now();
		const payload = {
			kind: 'card-create', card: wireCard(id), section: '', sectionUpdateKey: '',
			serverTimestampFields: ['created', 'updated']
		};
		await queue.runDurableAuxWrite(queue.makeAuxWriteIntent(UID, 'card-create', id, '', payload));
		//Simulate an edit landing after the creation.
		const {setDoc} = await import('firebase/firestore');
		await setDoc(doc(db, 'cards', id), {...(await getDoc(doc(db, 'cards', id))).data(), body: '<p>edited since</p>'});

		//Now replay the same intent.
		const replayIntent = queue.makeAuxWriteIntent(UID, 'card-create', id, '', payload);
		globalThis.localStorage.setItem('card-web-aux-writes-v2-i-' + replayIntent.id, JSON.stringify(replayIntent));
		globalThis.localStorage.setItem('card-web-aux-writes-v2-index',
			JSON.stringify([{id: replayIntent.id, uid: UID, kind: 'card-create', createdAt: replayIntent.createdAt}]));
		await queue.replayPendingAuxWrites(UID);

		const data = (await getDoc(doc(db, 'cards', id))).data();
		assert.equal(data.body, '<p>edited since</p>',
			'a replay must not overwrite content written after the creation');
		assert.deepEqual(queue.readPendingAuxWrites(), [], 'and it must clear the intent');
	});
});

//--- Bulk import: what is TRUE at the moment it hands control back ----------
//
//The import ends by selecting every card it created and navigating there, and
//the very next thing a user does is Edit All Cards. So the invariant that
//matters is not "the cards were written" — it is "everything this import just
//selected is present in THIS TAB". It was not: the import awaited only ids[0],
//which is typically back long before the last card has even been committed, so
//it returned with roughly half its selection still in flight. Measured on a
//real 100-card import through the shipping stack: ~50 outstanding at hand-back.
//
//The suite has no Firestore listener, so this stands in for one — it delivers
//the created cards into Redux the way the worker's delta listener would, one at
//a time and deliberately staggered, and records what the selection looked like
//at the exact instant the import declared success.
describe('bulk import hand-back', () => {
	let store;
	let bulkCreateWorkingNotes;
	let selectSelectedCardsMissingCount;

	before(async () => {
		const bootstrapped = await bootstrapApp();
		store = bootstrapped.store;
		//The import ends with a navigation, and the routing actions read the
		//BARE globals rather than window.*. Set here rather than in the shared
		//harness so no other suite's behavior changes.
		globalThis.location = bootstrapped.dom.window.location;
		globalThis.history = bootstrapped.dom.window.history;
		//store.js registers only `app` and `data`; the import selects cards and
		//navigates, so it needs these two as well.
		store.addReducers({
			collection: (await import('../../lib/src/reducers/collection.js')).default,
			bulkImport: (await import('../../lib/src/reducers/bulk-import.js')).default,
		});
		bulkCreateWorkingNotes = (await import('../../lib/src/actions/data.js')).bulkCreateWorkingNotes;
		selectSelectedCardsMissingCount = (await import('../../lib/src/selectors.js')).selectSelectedCardsMissingCount;
	});

	it('does not select a card it has not received yet', async function() {
		this.timeout(120000);
		clearAuxQueue();
		clearHarnessAlerts();
		store.dispatch({type: 'UPDATE_CORPUS_STATUS', status: 'live', message: ''});
		store.dispatch({type: 'UPDATE_USER_PERMISSIONS', permissions: {edit: true}});

		const CARDS = 6;
		const marker = 'bulk-handback-' + Date.now();
		const bodies = Array.from({length: CARDS}, (_, i) => `<p>${marker} ${i}</p>`);

		//Stand in for the delta listener: poll the server for the cards this
		//import created and hand them to Redux one at a time. Staggered on
		//purpose — simultaneous delivery is exactly the assumption ("they'll all
		//come back in one batch anyway") that made the old code look correct.
		const {getDocs, query, collection: coll, where} = firestore;
		const delivered = new Set();
		const deliverOne = async () => {
			const snapshot = await getDocs(query(coll(db, 'cards'), where('card_type', '==', 'working-notes')));
			for (const docSnapshot of snapshot.docs) {
				const card = docSnapshot.data();
				if (delivered.has(docSnapshot.id) || !String(card.body || '').includes(marker)) continue;
				delivered.add(docSnapshot.id);
				store.dispatch({type: 'UPDATE_CARDS', cards: {[docSnapshot.id]: {...card, id: docSnapshot.id}}, fetchType: 'unpublished'});
				return;
			}
		};
		const deliveryTimer = setInterval(() => { void deliverOne(); }, 60);

		//The state AT hand-back, captured from the store rather than after the
		//fact: by the time the await below returns, the stragglers have arrived
		//and the bug is invisible.
		let missingAtSuccess = null;
		let selectedAtSuccess = null;
		const unsubscribe = store.subscribe(() => {
			if (missingAtSuccess !== null) return;
			const state = store.getState();
			if (state.bulkImport && state.bulkImport.open) return;
			const selected = Object.keys(state.collection.selectedCards);
			if (!selected.length) return;
			selectedAtSuccess = selected.length;
			missingAtSuccess = selectSelectedCardsMissingCount(state);
		});

		try {
			await store.dispatch(bulkCreateWorkingNotes(bodies, {importer: 'google-docs-flat', importer_version: 1}));
		} finally {
			clearInterval(deliveryTimer);
			unsubscribe();
		}

		assert.strictEqual(store.getState().data.cardModificationError, null,
			`the import itself must succeed (alerts: ${JSON.stringify(harnessAlerts)})`);
		assert.ok(selectedAtSuccess, 'the import must select the cards it created');
		assert.strictEqual(missingAtSuccess, 0,
			`every selected card must already be in this tab when the import hands back (${missingAtSuccess} of ${selectedAtSuccess} were not)`);
		assert.strictEqual(selectedAtSuccess, CARDS, 'and all of them must be selected');
	});

	it('gives up on a card that never arrives instead of freezing the dialog', async function() {
		this.timeout(120000);
		clearAuxQueue();
		clearHarnessAlerts();
		store.dispatch({type: 'UPDATE_CORPUS_STATUS', status: 'live', message: ''});
		store.dispatch({type: 'UPDATE_USER_PERMISSIONS', permissions: {edit: true}});

		const CARDS = 4;
		const marker = 'bulk-stall-' + Date.now();
		const bodies = Array.from({length: CARDS}, (_, i) => `<p>${marker} ${i}</p>`);

		//Deliver all but one, forever. The import dialog is scrimmed and has no
		//cancel, so the wait is a budget for how long the user stares at a frozen
		//modal. Waiting the full per-card timeout here turned a two-second race
		//into a measured 60.5s freeze whenever a single card was slow.
		const {getDocs, query, collection: coll, where} = firestore;
		const delivered = new Set();
		const deliveryTimer = setInterval(() => {
			if (delivered.size >= CARDS - 1) return;
			void (async () => {
				const snapshot = await getDocs(query(coll(db, 'cards'), where('card_type', '==', 'working-notes')));
				for (const docSnapshot of snapshot.docs) {
					const card = docSnapshot.data();
					if (delivered.has(docSnapshot.id) || !String(card.body || '').includes(marker)) continue;
					if (delivered.size >= CARDS - 1) return;
					delivered.add(docSnapshot.id);
					store.dispatch({type: 'UPDATE_CARDS', cards: {[docSnapshot.id]: {...card, id: docSnapshot.id}}, fetchType: 'unpublished'});
					return;
				}
			})();
		}, 50);

		const started = Date.now();
		try {
			await store.dispatch(bulkCreateWorkingNotes(bodies, {importer: 'google-docs-flat', importer_version: 1}));
		} finally {
			clearInterval(deliveryTimer);
		}
		const elapsed = Date.now() - started;

		//The bound is 15s; allow generous slack for a loaded machine while still
		//failing loudly if the per-card 60s timeout is what governs.
		assert.ok(elapsed < 40000, `the import must not hold its modal for the full per-card timeout (took ${elapsed}ms)`);
		assert.strictEqual(Object.keys(store.getState().collection.selectedCards).length, CARDS - 1,
			'only the cards that actually arrived may be selected');
		//The report is deferred a tick on purpose, so it cannot block the
		//dispatch that closes the dialog (the queued-cards report does the same).
		await new Promise(resolve => setTimeout(resolve, 50));
		assert.ok(harnessAlerts.some(message => /have not synced back to this tab/.test(message)),
			`the user must be told which cards are missing (got ${JSON.stringify(harnessAlerts)})`);
	});
});

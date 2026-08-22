/*eslint-env node, es2022*/

//Pins the #761 fix end-to-end: a bulk import stamps one shared client
//timestamp on created/updated_substantive/updated_message (the recency- and
//creation-driving fields) so the group ties under sort/recent and reads in
//paste order, while `updated` stays a per-commit server timestamp (rules'
//bumpsUpdated + watermark sync). Written by the #761 adversarial review to
//close the gap that nothing executable asserted what actually lands in
//Firestore for the new ['updated']-only serverTimestampFields shape —
//including across a crash-and-replay JSON round trip.

import assert from 'assert';
import {bootstrapApp, clearAuxQueue, clearHarnessAlerts, seedQueuedIntent, wireCard} from '../harness-support/app-harness.js';

const app = await bootstrapApp();
const {db, store, uid: UID, firestore} = app;
const {doc, getDoc, getDocs, getDocsFromServer, query, collection: coll, where, Timestamp} = firestore;

await import('../../lib/src/actions/data.js');
const queue = await import('../../lib/src/aux-write-queue.js');

//The exact stamp shape bulkCreateWorkingNotes produces after persistableCard:
//one shared client timestamp, wire-marked, on the three fields; `updated`
//also wire-marked (its sentinel identity is destroyed by serialization) but
//named in serverTimestampFields so the executor re-vends it.
const STAMP = {__wireTimestamp: true, seconds: 1600000000, nanoseconds: 123000000};

const bulkShapedIntent = (id) => queue.makeAuxWriteIntent(UID, 'card-create', id, '', {
	kind: 'card-create',
	card: wireCard(id, UID, {
		card_type: 'working-notes',
		created: STAMP,
		updated_substantive: STAMP,
		updated_message: STAMP,
		updated: {__wireTimestamp: true, seconds: 1600000001, nanoseconds: 0},
	}),
	section: '',
	sectionUpdateKey: '',
	serverTimestampFields: ['updated'],
	skipAuthor: false,
});

const assertWrittenShape = async (id, label) => {
	const snapshot = await getDoc(doc(db, 'cards', id));
	assert.ok(snapshot.exists(), `${label}: card must exist`);
	const data = snapshot.data();
	for (const field of ['created', 'updated_substantive', 'updated_message']) {
		assert.ok(data[field] instanceof Timestamp,
			`${label}: ${field} must come back as a real Firestore Timestamp, got ${JSON.stringify(data[field])}`);
		assert.strictEqual(data[field].seconds, STAMP.seconds, `${label}: ${field} seconds preserved`);
		assert.strictEqual(data[field].nanoseconds, STAMP.nanoseconds, `${label}: ${field} nanoseconds preserved`);
		assert.strictEqual(typeof data[field].toMillis, 'function', `${label}: ${field} has toMillis`);
	}
	assert.ok(data.updated instanceof Timestamp, `${label}: updated must be a Timestamp`);
	//Server-stamped: must NOT be the client value carried in the wire card.
	assert.ok(data.updated.seconds > 1700000000,
		`${label}: updated must be server time, not the client husk (got seconds=${data.updated.seconds})`);
};

describe('bulk-import stamps through the executor (#761)', () => {
	beforeEach(clearAuxQueue);

	it('same-session: stamped fields land as real timestamps, updated is server-stamped', async () => {
		const id = 'stamp-761-live-' + Date.now();
		const outcome = await queue.runDurableAuxWrite(bulkShapedIntent(id));
		assert.strictEqual(outcome, 'committed');
		await assertWrittenShape(id, 'live');
	});

	it('crash-replay: the JSON round trip through localStorage preserves the stamps identically', async () => {
		const id = 'stamp-761-replay-' + Date.now();
		const intent = bulkShapedIntent(id);
		//Simulate the crash: intent persisted, session died, next boot replays.
		seedQueuedIntent(JSON.parse(JSON.stringify(intent)));
		await queue.replayPendingAuxWrites(UID);
		assert.deepEqual(queue.readPendingAuxWrites(), [], 'replay must clear the intent');
		await assertWrittenShape(id, 'replay');
	});
});

describe('one import shares one stamp, end to end (#761)', () => {
	let bulkCreateWorkingNotes;

	before(async () => {
		globalThis.location = app.dom.window.location;
		globalThis.history = app.dom.window.history;
		store.addReducers({
			collection: (await import('../../lib/src/reducers/collection.js')).default,
			bulkImport: (await import('../../lib/src/reducers/bulk-import.js')).default,
		});
		bulkCreateWorkingNotes = (await import('../../lib/src/actions/data.js')).bulkCreateWorkingNotes;
	});

	after(() => {
		//The import ends by selecting its cards; later suites in this dir
		//share the store and read selection state at hand-back, so leave it
		//as we found it.
		store.dispatch({type: 'CLEAR_SELECTED_CARDS'});
	});

	it('all cards of a group share one client stamp; updated is server time', async function() {
		this.timeout(120000);
		clearAuxQueue();
		clearHarnessAlerts();
		store.dispatch({type: 'UPDATE_CORPUS_STATUS', status: 'live', message: ''});
		store.dispatch({type: 'UPDATE_USER_PERMISSIONS', permissions: {edit: true}});

		const CARDS = 5;
		const marker = 'stamp-e2e-' + Date.now();
		const bodies = Array.from({length: CARDS}, (_, i) => `<p>${marker} ${i}</p>`);

		//Delta-listener stand-in: bulkCreateWorkingNotes waits for its cards
		//to arrive in the store, which in the app the listener provides.
		const delivered = new Set();
		const deliveryTimer = setInterval(() => {
			void (async () => {
				const snapshot = await getDocs(query(coll(db, 'cards'), where('card_type', '==', 'working-notes')));
				for (const docSnapshot of snapshot.docs) {
					const card = docSnapshot.data();
					if (delivered.has(docSnapshot.id) || !String(card.body || '').includes(marker)) continue;
					delivered.add(docSnapshot.id);
					store.dispatch({type: 'UPDATE_CARDS', cards: {[docSnapshot.id]: {...card, id: docSnapshot.id}}, fetchType: 'unpublished'});
				}
			})();
		}, 50);

		const clientBefore = Date.now();
		try {
			await store.dispatch(bulkCreateWorkingNotes(bodies, {importer: 'google-docs-flat', importer_version: 1}));
		} finally {
			clearInterval(deliveryTimer);
		}
		const clientAfter = Date.now();

		//FromServer, not the default read: the shared SDK instance serves a
		//latency-compensated local view in which a just-acked write's
		//serverTimestamp can still read as null — observed as a flaky
		//"updated must be a Timestamp" failure. The assertion is about what
		//the SERVER holds.
		const snapshot = await getDocsFromServer(query(coll(db, 'cards'), where('card_type', '==', 'working-notes')));
		const groupCards = snapshot.docs.map(d => d.data()).filter(c => String(c.body || '').includes(marker));
		assert.strictEqual(groupCards.length, CARDS, 'all cards must land');

		const key = (t) => `${t.seconds}.${t.nanoseconds}`;
		const createdKeys = new Set();
		for (const card of groupCards) {
			for (const field of ['created', 'updated_substantive', 'updated_message']) {
				assert.ok(card[field] instanceof Timestamp, `${field} must be a real Timestamp`);
			}
			assert.strictEqual(key(card.updated_substantive), key(card.created), 'updated_substantive === created within a card');
			assert.strictEqual(key(card.updated_message), key(card.created), 'updated_message === created within a card');
			createdKeys.add(key(card.created));
			assert.ok(card.updated instanceof Timestamp, 'updated must be a Timestamp');
			//The client stamp was taken between clientBefore and clientAfter.
			const ms = card.created.toMillis();
			assert.ok(ms >= clientBefore - 1000 && ms <= clientAfter + 1000,
				`created must be the client stamp taken during the import (got ${ms}, window ${clientBefore}..${clientAfter})`);
		}
		assert.strictEqual(createdKeys.size, 1,
			`the group must share ONE stamp, got ${[...createdKeys].join(', ')}`);
	});
});

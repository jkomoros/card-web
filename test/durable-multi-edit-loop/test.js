/*eslint-env node, es2022*/

//EXECUTABLE COVERAGE FOR THE DURABLE MULTI-EDIT CHUNK LOOP.
//
//This is the loop that every card edit on the branch now goes through — the
//one-card editor Save included (kind 'single'). Before this file its behavior
//was asserted only by reading it: the resume arithmetic, the server marker
//probe, and the overwrite guard's integration with the loop had no test that
//would fail if they broke. test/durable-overwrite-guard covers the guard's pure
//comparison function, and test/durable-operation-recovery covers reading a
//corrupt record; NEITHER exercises the loop that calls them.
//
//The three things it pins are the three that lose data or corrupt history:
//  - RESUME: a record that stopped partway must write only the remainder. If
//    the arithmetic slips it either re-writes committed cards (double audit
//    history) or skips cards (silently unsaved edits).
//  - MARKER PROBING: probing must keep skipping forward while markers are
//    found. Clearing the flag after the FIRST probe was a real bug: a chunk
//    another tab had already committed got re-planned, and because audit doc
//    ids derive from batch id + chunk boundaries — which are not stable across
//    replanning — that wrote a SECOND card_updates doc per card and overwrote
//    the marker with a wrong next_index.
//  - THE OVERWRITE GUARD IN SITU: a resume hours later must refuse to replace
//    content written in between, must keep the record (so the work is not
//    lost), and must proceed once the user acknowledges.
//
//Like the other harness suites this asserts the WRITE PLAN against a real
//Firestore emulator under permissive rules; authorization is covered by
//test/security.

import assert from 'assert';
import {bootstrapApp, clearAuxQueue, clearHarnessAlerts, clearWhatUserWasTold, harnessAlerts, whatUserWasTold, wireCard as harnessWireCard} from '../harness-support/app-harness.js';

const app = await bootstrapApp();
const {db, store, uid: UID, firestore} = app;
const {doc, getDoc, setDoc, getDocs, collection} = firestore;

const {modifyCardsWithDurableMultiEdit, modifyCardsWithDurableTagOperation, retryPendingBulkTagOperation, modifyCardWithBatch, receiveCards} = await import('../../lib/src/actions/data.js');
const {MultiBatch} = await import('../../lib/src/multi_batch.js');
const {applyCardFirebaseUpdate} = await import('../../lib/src/card_diff.js');
const {arrayUnionSentinel} = await import('../../lib/src/firebase.js');
const {arrayUnion: rawArrayUnion} = await import('firebase/firestore');

const MULTI_EDIT_KEY = 'card-web-pending-multi-edit-v1';

//`durableSaveEligible` short-circuits true on a live corpus, which is the state
//every real save happens in.
const markCorpusLive = () => store.dispatch({type: 'UPDATE_CORPUS_STATUS', status: 'live', message: ''});

const putCardsInStore = (cards) => store.dispatch({
	type: 'UPDATE_CARDS',
	cards: Object.fromEntries(cards.map(card => [card.id, card])),
	fetchType: 'unpublished',
});

let counter = 0;
//A card that exists BOTH on the server (the loop re-reads authoritative copies
//before every chunk) and in Redux (where baseFields are recorded from).
const seedCard = async (suffix, overrides = {}) => {
	const id = `mel-${Date.now()}-${counter++}-${suffix}`;
	const card = {...harnessWireCard(id, UID), id, ...overrides};
	await setDoc(doc(db, 'cards', id), card);
	return card;
};

//Trimmed because the body a real save writes has been through the HTML
//normalizer, which appends a trailing newline. Comparing raw would make every
//assertion here fail for a reason that has nothing to do with the chunk loop.
const serverBody = async (id) => ((await getDoc(doc(db, 'cards', id))).data().body || '').trim();

const updateDocCount = async (id) =>
	(await getDocs(collection(doc(db, 'cards', id), 'updates'))).size;

const readRecord = () => {
	const raw = globalThis.localStorage.getItem(MULTI_EDIT_KEY);
	return raw ? JSON.parse(raw) : null;
};

//Write the durable record directly, which is what a reload/resume actually
//reads. `id` is chosen by the test so it can also plant server markers for it.
const writeRecord = (record) => globalThis.localStorage.setItem(MULTI_EDIT_KEY, JSON.stringify(record));

const clearRecord = () => globalThis.localStorage.removeItem(MULTI_EDIT_KEY);

const makeRecord = (operationID, targetIDs, update, extra = {}) => ({
	version: 1,
	id: operationID,
	uid: UID,
	targetIDs,
	nextIndex: 0,
	modifiedCount: 0,
	update,
	substantive: false,
	kind: 'multi',
	baseFields: {},
	...extra,
});

const plantMarker = (operationID, chunkStart, nextIndex, cardIDs, modifiedCount) =>
	setDoc(doc(db, 'users', UID, 'multi_edit_chunks', `${operationID}-${chunkStart}`), {
		operation_id: operationID,
		next_index: nextIndex,
		modified_count: modifiedCount,
		skipped_count: 0,
		card_ids: cardIDs,
		update: {},
		updated: new Date(),
	});

describe('durable multi-edit chunk loop (real thunk against the emulator)', function() {
	//Each case seeds cards and commits real batches; the emulator is local but
	//a 12-card run is still a few dozen round trips.
	this.timeout(120000);

	beforeEach(() => {
		clearAuxQueue();
		clearRecord();
		localStorage.removeItem('card-web-pending-bulk-tag-operation-v1');
		clearHarnessAlerts();
		markCorpusLive();
	});

	it('commits every card across MULTIPLE chunks and clears the record', async () => {
		//12 targets with a chunk size of 10 is the smallest run that proves the
		//loop advances past its first chunk at all.
		const cards = [];
		for (let i = 0; i < 12; i++) cards.push(await seedCard(`multi-${i}`));
		putCardsInStore(cards);

		await store.dispatch(modifyCardsWithDurableMultiEdit(cards, {body: '<p>chunked</p>'}));

		for (const card of cards) {
			assert.equal(await serverBody(card.id), '<p>chunked</p>', `${card.id} must have been written`);
		}
		assert.equal(readRecord(), null, 'a completed operation must clear its durable record');
		//The success report moved from alert() to the snack-bar (#758):
		//transient, non-blocking, same words.
		assert.ok(!harnessAlerts.some(message => /cards modified/.test(message)),
			`success must not alert() any more (got ${JSON.stringify(harnessAlerts)})`);
		//The snack-bar holds a QUEUE now, not one overwritable message: a second
		//outcome used to destroy the first and reset its clock.
		const messages = store.getState().app.snackbars.map(entry => entry.message);
		assert.ok(messages.some(message => /12 cards modified/.test(message)),
			`the user must be told what happened, via the snack-bar (got ${JSON.stringify(messages)})`);
	});

	it('RESUMES from nextIndex and leaves the already-committed prefix alone', async () => {
		const cards = [];
		for (let i = 0; i < 4; i++) cards.push(await seedCard(`resume-${i}`));
		putCardsInStore(cards);
		const targetIDs = cards.map(card => card.id);
		const update = {body: '<p>resumed</p>'};

		//Simulate a tab that committed the first two and died: the record says
		//they are done. Their server body is deliberately made DISTINCT from
		//what this update would write — not because a real prior commit would
		//leave it different, but because it is the only way the test can see
		//the difference. If the prefix held the update's own value, a loop that
		//wrongly restarted from zero would produce an empty diff for those
		//cards, write nothing, and pass. (Confirmed by mutation: the first
		//version of this test survived a loop that re-processed the prefix.)
		for (const card of cards.slice(0, 2)) {
			await setDoc(doc(db, 'cards', card.id), {...card, body: '<p>committed by the dead tab</p>'});
		}
		const beforeUpdateCounts = await Promise.all(cards.map(card => updateDocCount(card.id)));
		writeRecord(makeRecord('resume-op-' + Date.now(), targetIDs, update, {nextIndex: 2, modifiedCount: 2}));

		await store.dispatch(modifyCardsWithDurableMultiEdit(cards, update));

		for (const card of cards.slice(2)) {
			assert.equal(await serverBody(card.id), '<p>resumed</p>');
		}
		//DISTINGUISHING ASSERTIONS. A restart from zero would rewrite the prefix
		//— changing its body and adding a second card_updates doc apiece, which
		//is exactly the history corruption the marker machinery exists to
		//prevent.
		for (const [index, card] of cards.slice(0, 2).entries()) {
			assert.equal(await serverBody(card.id), '<p>committed by the dead tab</p>',
				`${card.id} is behind nextIndex; the resume must not touch it`);
			assert.equal(await updateDocCount(card.id), beforeUpdateCounts[index],
				`${card.id} was already committed; resuming must not re-write it`);
		}
		for (const [index, card] of cards.slice(2).entries()) {
			assert.equal(await updateDocCount(card.id), beforeUpdateCounts[index + 2] + 1,
				`${card.id} was outstanding; the resume must write it`);
		}
		assert.equal(readRecord(), null, 'the finished resume clears the record');
	});

	it('keeps probing markers across CONSECUTIVE chunks, not just the first', async () => {
		//THE REGRESSION: probing used to stop after the first marker was found.
		//With two chunks already committed elsewhere, the second chunk's marker
		//was never read, so those 10 cards were re-planned and re-committed —
		//duplicating their audit history and overwriting the marker with a
		//next_index derived from new, different chunk boundaries.
		const cards = [];
		for (let i = 0; i < 22; i++) cards.push(await seedCard(`probe-${i}`));
		putCardsInStore(cards);
		const targetIDs = cards.map(card => card.id);
		const update = {body: '<p>probed</p>'};
		const operationID = 'probe-op-' + Date.now();

		//Another tab committed chunks [0,10) and [10,20): both markers exist, so
		//both are done and neither may be touched. As in the resume case their
		//bodies are made distinct from the update's so that a wrongly re-planned
		//chunk is VISIBLE rather than a silent no-op diff.
		for (const card of cards.slice(0, 20)) {
			await setDoc(doc(db, 'cards', card.id), {...card, body: '<p>committed elsewhere</p>'});
		}
		await plantMarker(operationID, 0, 10, targetIDs.slice(0, 10), 10);
		await plantMarker(operationID, 10, 20, targetIDs.slice(10, 20), 10);
		const beforeUpdateCounts = await Promise.all(cards.map(card => updateDocCount(card.id)));

		writeRecord(makeRecord(operationID, targetIDs, update));
		await store.dispatch(modifyCardsWithDurableMultiEdit(cards, update));

		for (const [index, card] of cards.slice(0, 20).entries()) {
			assert.equal(await serverBody(card.id), '<p>committed elsewhere</p>',
				`${card.id} is covered by a marker; it must not be re-written`);
			assert.equal(await updateDocCount(card.id), beforeUpdateCounts[index],
				`${card.id} is covered by a marker; it must not be re-committed`);
		}
		for (const [index, card] of cards.slice(20).entries()) {
			assert.equal(await serverBody(card.id), '<p>probed</p>');
			assert.equal(await updateDocCount(card.id), beforeUpdateCounts[index + 20] + 1,
				`${card.id} is past the markers and must actually be written`);
		}
		assert.equal(readRecord(), null);
	});

	it('does NOT trust a marker belonging to a different operation', async () => {
		//Marker doc ids are `${operationID}-${chunkStart}`, so a foreign marker
		//can only collide by way of a bug — but the loop validates operation_id
		//anyway, and that validation is what keeps a rewound/replanned record
		//from inheriting someone else's completion claim.
		const cards = [];
		for (let i = 0; i < 2; i++) cards.push(await seedCard(`foreign-${i}`));
		putCardsInStore(cards);
		const targetIDs = cards.map(card => card.id);
		const operationID = 'foreign-op-' + Date.now();
		await setDoc(doc(db, 'users', UID, 'multi_edit_chunks', `${operationID}-0`), {
			operation_id: 'some-other-operation',
			next_index: 2,
			modified_count: 2,
			skipped_count: 0,
			card_ids: targetIDs,
			update: {},
			updated: new Date(),
		});

		writeRecord(makeRecord(operationID, targetIDs, {body: '<p>not-skipped</p>'}));
		await store.dispatch(modifyCardsWithDurableMultiEdit(cards, {body: '<p>not-skipped</p>'}));

		for (const card of cards) {
			assert.equal(await serverBody(card.id), '<p>not-skipped</p>',
				'a marker from another operation must not cause these cards to be skipped');
		}
	});

	it('REFUSES to overwrite content written after the record was saved, and keeps the record', async () => {
		const card = await seedCard('conflict');
		putCardsInStore([card]);
		const update = {body: '<p>my pending save</p>'};

		//The record remembers what the card held when the save was planned...
		writeRecord(makeRecord('conflict-op-' + Date.now(), [card.id], update, {
			baseFields: {[card.id]: {body: card.body}},
		}));
		//...and then another device rewrote it.
		await setDoc(doc(db, 'cards', card.id), {...card, body: '<p>written on my phone</p>'});

		await store.dispatch(modifyCardsWithDurableMultiEdit([card], update));

		assert.equal(await serverBody(card.id), '<p>written on my phone</p>',
			'the other device\'s content must survive');
		const record = readRecord();
		assert.ok(record, 'the pending save must be RETAINED, not discarded — it is the user\'s work');
		assert.ok(/Changed elsewhere after you saved:/.test(record.lastError || ''),
			`the record must carry the conflict so the pill can offer Retry (got ${record.lastError})`);
		assert.equal(record.nextIndex, 0, 'nothing was committed, so nothing may be marked done');
	});

	it('proceeds once the user acknowledges the overwrite', async () => {
		const card = await seedCard('acknowledged');
		putCardsInStore([card]);
		const update = {body: '<p>mine wins</p>'};
		writeRecord(makeRecord('ack-op-' + Date.now(), [card.id], update, {
			baseFields: {[card.id]: {body: card.body}},
			overwriteAcknowledged: true,
		}));
		await setDoc(doc(db, 'cards', card.id), {...card, body: '<p>written on my phone</p>'});

		await store.dispatch(modifyCardsWithDurableMultiEdit([card], update));

		assert.equal(await serverBody(card.id), '<p>mine wins</p>',
			'an acknowledged retry must actually replace the other content');
		assert.equal(readRecord(), null, 'and then clear');
	});

	it('a same-value edit is not a conflict on retry of a partially-committed chunk', async () => {
		//Our OWN committed write must not read as somebody else's change, or a
		//retry after a lost acknowledgement would wedge permanently.
		const card = await seedCard('selfsame');
		putCardsInStore([card]);
		const update = {body: '<p>already landed</p>'};
		writeRecord(makeRecord('self-op-' + Date.now(), [card.id], update, {
			baseFields: {[card.id]: {body: card.body}},
		}));
		//The commit landed but the acknowledgement was lost: the server already
		//holds exactly what we would write.
		await setDoc(doc(db, 'cards', card.id), {...card, body: '<p>already landed</p>'});

		await store.dispatch(modifyCardsWithDurableMultiEdit([card], update));

		assert.equal(readRecord(), null,
			'a retry whose target already equals our own pending value must complete, not conflict');
		assert.equal(await serverBody(card.id), '<p>already landed</p>');
	});

	it('names the targets a multi-edit skipped because they no longer existed, as a persistent outcome', async () => {
		//The committed snackbar used to count skipped cards and vanish. A
		//target that was not edited is something the user has to act on, so
		//it is reported persistently, by title, with what did happen.
		const kept = await seedCard('kept', {title: 'Kept card'});
		const gone = await seedCard('gone', {title: 'Vanished card'});
		const other = await seedCard('other', {title: 'Other card'});
		putCardsInStore([kept, gone, other]);
		await firestore.deleteDoc(doc(db, 'cards', gone.id));
		clearWhatUserWasTold(store);

		await store.dispatch(modifyCardsWithDurableMultiEdit([kept, gone, other], {body: '<p>edited</p>'}));

		assert.equal(await serverBody(kept.id), '<p>edited</p>');
		assert.equal(await serverBody(other.id), '<p>edited</p>');
		const banners = store.getState().errors.errors;
		const banner = banners.find(entry => /no longer existed/.test(entry.what));
		assert.ok(banner, `a persistent banner names the skipped card (told: ${JSON.stringify(whatUserWasTold(store))})`);
		assert.match(banner.what, /^2 of 3 cards were edited\. One card no longer existed and was skipped: “Vanished card”\.$/);
		assert.match(banner.reassurance, /The other cards kept their changes\./);
		assert.ok(!store.getState().app.snackbars.some(item => /cards modified/.test(item.message)), 'no committed snackbar competes with the banner');
		assert.ok(!store.getState().data.cardModificationError, 'the edit itself is not a failure');
	});

	it('keeps naming skipped targets past the record cap and across a resume', async () => {
		//The record stores at most 200 skipped ids and its reader rejects
		//more, so the cap and the validator are coupled: without the cap a
		//210-skip operation would pause as "corrupt" mid-run. And a resume
		//must still name the ids persisted before the crash.
		const kept = await seedCard('kept-cap', {title: 'Kept card'});
		const gone = [];
		for (let index = 0; index < 210; index++) {
			const id = `mel-${Date.now()}-${counter++}-gone-${index}`;
			gone.push({...harnessWireCard(id, UID), id, title: `Gone ${index}`});
		}
		putCardsInStore([kept, ...gone]);
		clearWhatUserWasTold(store);
		await store.dispatch(modifyCardsWithDurableMultiEdit([kept, ...gone], {body: '<p>capped</p>'}));
		assert.equal(await serverBody(kept.id), '<p>capped</p>', 'the operation completed rather than pausing as corrupt');
		assert.equal(readRecord(), null, 'the record was cleared');
		let banner = store.getState().errors.errors.find(entry => /no longer existed/.test(entry.what));
		assert.ok(banner, `banner present (told: ${JSON.stringify(whatUserWasTold(store))})`);
		assert.match(banner.what, /^1 of 211 cards were edited\. 210 cards no longer existed and were skipped: “Gone 0”, “Gone 1”, “Gone 2”, “Gone 3”, “Gone 4” and 205 more\.$/);

		//A resume: the record from a crashed run already names one skipped
		//target the store no longer holds; the live run skips another.
		const live = await seedCard('kept-resume', {title: 'Live card'});
		const vanished = await seedCard('vanished-resume', {title: 'Vanished live'});
		putCardsInStore([live, vanished]);
		await firestore.deleteDoc(doc(db, 'cards', vanished.id));
		const operationID = `resume-skipped-${Date.now()}`;
		const earlier = 'earlier-skipped-id';
		writeRecord(makeRecord(operationID, [earlier, live.id, vanished.id], {body: '<p>resumed</p>'}, {nextIndex: 1, modifiedCount: 0, skippedCount: 1, skippedIDs: [earlier]}));
		clearWhatUserWasTold(store);
		await store.dispatch(modifyCardsWithDurableMultiEdit([{id: earlier}, live, vanished], {body: '<p>resumed</p>'}));
		assert.equal(await serverBody(live.id), '<p>resumed</p>');
		banner = store.getState().errors.errors.find(entry => entry.dedupeKey === `multi-edit-skipped-${operationID}`);
		assert.ok(banner, `resume banner present (told: ${JSON.stringify(whatUserWasTold(store))})`);
		assert.match(banner.what, /^1 of 3 cards were edited\. 2 cards no longer existed and were skipped: earlier-skipped-id, “Vanished live”\.$/);

		//Skips known only by count (reconciled from another tab's server
		//markers, which carry no ids) end the sentence at the count, and a
		//long title is cut rather than filling the banner.
		const longTitle = 'A title that goes on and on and on and on and on and on and on and on and on and on and on';
		const trimmed = await seedCard('kept-long', {title: longTitle});
		const longGone = await seedCard('gone-long', {title: longTitle});
		putCardsInStore([trimmed, longGone]);
		await firestore.deleteDoc(doc(db, 'cards', longGone.id));
		const markerOperation = `marker-skipped-${Date.now()}`;
		writeRecord(makeRecord(markerOperation, ['marker-a', 'marker-b', trimmed.id, longGone.id], {body: '<p>marker</p>'}, {nextIndex: 2, modifiedCount: 0, skippedCount: 2}));
		clearWhatUserWasTold(store);
		await store.dispatch(modifyCardsWithDurableMultiEdit([{id: 'marker-a'}, {id: 'marker-b'}, trimmed, longGone], {body: '<p>marker</p>'}));
		banner = store.getState().errors.errors.find(entry => entry.dedupeKey === `multi-edit-skipped-${markerOperation}`);
		assert.ok(banner, `marker banner present (told: ${JSON.stringify(whatUserWasTold(store))})`);
		assert.match(banner.what, /^1 of 4 cards were edited\. 3 cards no longer existed and were skipped: “A title that goes on and on and on and on and on and on and on and on…” and 2 more\.$/);
		//Nothing edited at all: one skip known by count, the other live.
		writeRecord(makeRecord(`${markerOperation}-b`, ['marker-c', longGone.id], {body: '<p>marker-b</p>'}, {nextIndex: 1, modifiedCount: 0, skippedCount: 1}));
		clearWhatUserWasTold(store);
		await store.dispatch(modifyCardsWithDurableMultiEdit([{id: 'marker-c'}, longGone], {body: '<p>marker-b</p>'}));
		banner = store.getState().errors.errors.find(entry => entry.dedupeKey === `multi-edit-skipped-${markerOperation}-b`);
		assert.ok(banner, `nothing-edited banner present (told: ${JSON.stringify(whatUserWasTold(store))})`);
		assert.match(banner.what, /^0 of 2 cards were edited\. 2 cards no longer existed and were skipped: “A title that goes on and on and on and on and on and on and on and on…” and 1 more\.$/);
		assert.equal(banner.reassurance, 'Nothing else was changed.');
	});

	it('tells the user when a single-card save\'s target no longer exists', async () => {
		//The card was deleted on another device while this editor was open. The
		//loop writes nothing (absent cards are skipped), and reporting success
		//here would clear the recovery draft and lose the edit outright.
		const card = await seedCard('vanished');
		putCardsInStore([card]);
		const {deleteDoc} = firestore;
		await deleteDoc(doc(db, 'cards', card.id));
		clearHarnessAlerts();

		await store.dispatch(modifyCardsWithDurableMultiEdit([card], {body: '<p>into the void</p>'}, false, 'single'));

		const failure = store.getState().data.cardModificationError;
		assert.ok(failure, 'the save must be reported as FAILED, not silently succeed');
		assert.ok(/no longer exists on the server/.test(String(failure.message || failure)),
			`the message must say the card is gone (got ${String(failure.message || failure)})`);
	});

	it('a single save arriving during another save\'s round trip PARKS and then runs (#763)', async () => {
		//With per-card editor sessions, save A → immediately save B is the
		//normal rapid workflow. The old entry refused B with a blocking
		//alert AND dispatched a MODIFY_CARD_FAILURE that cleared A's healthy
		//pending state. Now B waits for A's runner to settle and then runs.
		const cardA = await seedCard('park-a');
		const cardB = await seedCard('park-b');
		putCardsInStore([cardA, cardB]);

		const savePromiseA = store.dispatch(modifyCardsWithDurableMultiEdit([cardA], {body: '<p>first</p>'}, false, 'single'));
		//B arrives while A's runner is mid-flight (same tick — the widest
		//possible overlap).
		const savePromiseB = store.dispatch(modifyCardsWithDurableMultiEdit([cardB], {body: '<p>second</p>'}, false, 'single'));
		await Promise.all([savePromiseA, savePromiseB]);

		assert.equal(await serverBody(cardA.id), '<p>first</p>', 'save A must land');
		assert.equal(await serverBody(cardB.id), '<p>second</p>', 'the parked save B must land after A');
		assert.equal(readRecord(), null, 'both operations must clear their records');
		assert.ok(!harnessAlerts.some(message => /already running/.test(message)),
			`a parked save must not fire the old refusal alert (got ${JSON.stringify(harnessAlerts)})`);
		assert.equal(store.getState().data.cardModificationError, null,
			'a parked save must not report a failure');
	});

	it('an impatient re-press of the SAME parked save is dropped silently', async () => {
		const cardA = await seedCard('repress-a');
		const cardB = await seedCard('repress-b');
		putCardsInStore([cardA, cardB]);

		const savePromiseA = store.dispatch(modifyCardsWithDurableMultiEdit([cardA], {body: '<p>first</p>'}, false, 'single'));
		const savePromiseB1 = store.dispatch(modifyCardsWithDurableMultiEdit([cardB], {body: '<p>second</p>'}, false, 'single'));
		//The double Cmd-Enter: identical card + update while already parked.
		const savePromiseB2 = store.dispatch(modifyCardsWithDurableMultiEdit([cardB], {body: '<p>second</p>'}, false, 'single'));
		await Promise.all([savePromiseA, savePromiseB1, savePromiseB2]);

		assert.equal(await serverBody(cardB.id), '<p>second</p>');
		assert.ok(!harnessAlerts.some(message => /already running/.test(message)),
			`a duplicate re-press must not alert (got ${JSON.stringify(harnessAlerts)})`);
		//Exactly one operation ran for B: a duplicate would have written a
		//second card_updates audit doc.
		const updates = await getDocs(collection(db, 'cards', cardB.id, 'updates'));
		assert.equal(updates.size, 1, 'the re-pressed save must not run twice');
	});

	//--- What the LOCAL copy looks like after a tag edit --------------------
	//A tag change is written as a Firestore array transform so a concurrent tag
	//edit from another device is not clobbered by our stale complete array. The
	//local echo used to be built from that same object, so Redux ended up with
	//an ArrayUnionFieldValueImpl in card.tags. Nothing here failed; the damage
	//landed on the next reader that iterated tags — in production, the
	//multi-edit dialog's own tag-union selector, throwing out of store.dispatch
	//inside this very loop and aborting it with a chunk still to go.
	//
	//test/card-echo pins the shared materialization rule. This pins the real
	//client SDK wiring: the actual arrayUnion sentinel, the actual
	//clientSentinels config, the actual thunk.
	const storeTags = (id) => store.getState().data.cards[id].tags;

	//Two things a tag edit needs that the other cases do not: permission
	//(getUserMayEditTag) and an existing tags/{tag} document, because the
	//denormalized mirror write is an update() and update() on a missing doc
	//fails the whole batch. Both are torn back down so no later case inherits
	//them.
	const seedTags = (names) => Promise.all(names.map(name =>
		setDoc(doc(db, 'tags', name), {cards: [], start_cards: [], title: name, color: '#ffffff', updated: new Date()})));

	const withTagEditPermission = async (tagNames, body) => {
		store.dispatch({type: 'UPDATE_USER_PERMISSIONS', permissions: {edit: true}});
		await seedTags(tagNames);
		try {
			await body();
		} finally {
			store.dispatch({type: 'UPDATE_USER_PERMISSIONS', permissions: {}});
		}
	};

	for (const mixed of [false, true]) {
		for (const afterCommit of [false, true]) {
			it(`${mixed ? 'mixed' : 'pure-tag'} echo preserves concurrent edits delivered ${afterCommit ? 'after' : 'before'} commit`, async () => {
				const tag = `race-${Date.now()}-${counter++}`;
				await withTagEditPermission([tag], async () => {
					const cards = await Promise.all([seedCard('race-first'), seedCard('race-second')]);
					putCardsInStore(cards);
					const originalCommit = MultiBatch.prototype.commit;
					let delivered = false;
					const deliverConcurrentEdit = async () => {
						const ref = doc(db, 'cards', cards[0].id);
						await firestore.updateDoc(ref, {body: '<p>New concurrent content</p>', tags: ['keep-concurrent-tag'], updated: firestore.serverTimestamp()});
						const snapshot = await getDoc(ref);
						//The real ingestion thunk PARKS this card while the other
						//target is pending. A direct UPDATE_CARDS misses that path.
						store.dispatch(receiveCards({[cards[0].id]: {...snapshot.data(), id: cards[0].id}}, 'unpublished'));
						delivered = true;
					};
					MultiBatch.prototype.commit = async function() {
						if (!afterCommit) await deliverConcurrentEdit();
						const result = await originalCommit.call(this);
						if (afterCommit) await deliverConcurrentEdit();
						return result;
					};
					try {
						await store.dispatch(mixed
							? modifyCardsWithDurableMultiEdit(cards, {add_tags: [tag], auto_todo_overrides_disablements: ['prioritized']})
							: modifyCardsWithDurableTagOperation(cards, tag, true));
					} finally {
						MultiBatch.prototype.commit = originalCommit;
					}
					assert.ok(delivered, 'must exercise the concurrent server edit and listener delivery');
					const remote = (await getDoc(doc(db, 'cards', cards[0].id))).data();
					const local = store.getState().data.cards[cards[0].id];
					assert.equal(local.body, remote.body, 'the old echo must not revert newer content');
					assert.deepEqual(local.tags, remote.tags, 'preserve unrelated labels and a later removal of the requested label');
					assert.ok(local.tags.includes('keep-concurrent-tag'));
					assert.equal(local.tags.includes(tag), !afterCommit);
					assert.ok((await getDoc(doc(db, 'cards', cards[1].id))).data().tags.includes(tag));
				});
			});
		}
	}

	it('reconciles mixed-edit targets after recovering a committed marker', async () => {
		await withTagEditPermission(['mixed-marker-tag'], async () => {
			const card = await seedCard('mixed-marker-echo');
			putCardsInStore([card]);
			const update = {add_tags: ['mixed-marker-tag'], auto_todo_overrides_disablements: ['prioritized']};
			const originalCommit = MultiBatch.prototype.commit;
			MultiBatch.prototype.commit = async function() {
				await originalCommit.call(this);
				throw new Error('Lost mixed-edit acknowledgement');
			};
			try {
				await store.dispatch(modifyCardsWithDurableMultiEdit([card], update));
			} finally {
				MultiBatch.prototype.commit = originalCommit;
			}
			assert.equal(readRecord().nextIndex, 0, 'the acknowledgement must be lost before local progress');
			await store.dispatch(modifyCardsWithDurableMultiEdit([], update, false, 'multi', [card.id]));
			const server = (await getDoc(doc(db, 'cards', card.id))).data();
			assert.deepEqual(store.getState().data.cards[card.id].tags, server.tags);
			assert.deepEqual(store.getState().data.cards[card.id].auto_todo_overrides, server.auto_todo_overrides);
			assert.equal(await updateDocCount(card.id), 1, 'reconciliation must not repeat the write');
		});
	});

	for (const adding of [true, false]) {
		it(`echoes a pure tag ${adding ? 'addition' : 'removal'} into the local corpus after commit`, async () => {
			await withTagEditPermission(['pure-echo'], async () => {
				const card = await seedCard('pure-echo', {tags: adding ? ['keep'] : ['keep', 'pure-echo']});
				putCardsInStore([card]);
				await store.dispatch(modifyCardsWithDurableTagOperation([card], 'pure-echo', adding));
				assert.deepEqual(storeTags(card.id), adding ? ['keep', 'pure-echo'] : ['keep']);
				assert.deepEqual(storeTags(card.id), (await getDoc(doc(db, 'cards', card.id))).data().tags);
			});
		});

		it(`uses server tag state for every selected card when ${adding ? 'adding' : 'removing'} a tag`, async () => {
			await withTagEditPermission(['stale-selection'], async () => {
				const card = await seedCard('stale-tag', {tags: adding ? [] : ['stale-selection']});
				//The tab believes the target already matches. Another device has
				//changed it since this copy was delivered.
				const stale = {...card, tags: adding ? ['stale-selection'] : []};
				putCardsInStore([stale]);
				await store.dispatch(modifyCardsWithDurableTagOperation([stale], 'stale-selection', adding));
				const saved = (await getDoc(doc(db, 'cards', card.id))).data();
				assert.strictEqual(saved.tags.includes('stale-selection'), adding);
				assert.equal(await updateDocCount(card.id), 1, 'the actual change must have canonical history');
			});
		});
	}

	it('does not rewrite cards that already match on the server', async () => {
		await withTagEditPermission(['matching-tag'], async () => {
			const card = await seedCard('matching-tag', {tags: ['matching-tag', 'keep-other-tag']});
			const stale = {...card, tags: []};
			putCardsInStore([stale]);
			await store.dispatch(modifyCardsWithDurableTagOperation([stale], 'matching-tag', true));
			assert.equal(await updateDocCount(card.id), 0, 'no-op must not invent card history');
			assert.deepStrictEqual((await getDoc(doc(db, 'cards', card.id))).data().tags, card.tags);
			assert.deepStrictEqual(storeTags(card.id), card.tags, 'authoritative no-op must repair the stale local tags too');
		});
	});

	for (const scopeChange of ['account', 'permissions']) {
		it(`does not echo private pure-tag cards after ${scopeChange} change during commit`, async () => {
			await withTagEditPermission(['scope-echo'], async () => {
				const card = await seedCard('scope-echo');
				putCardsInStore([card]);
				const originalCommit = MultiBatch.prototype.commit;
				const originalUser = store.getState().user.user;
				MultiBatch.prototype.commit = async function(...args) {
					await originalCommit.apply(this, args);
					if (scopeChange === 'account') store.dispatch({type: 'SIGNIN_SUCCESS', user: {...originalUser, uid: 'other-account'}});
					else store.dispatch({type: 'UPDATE_USER_PERMISSIONS', permissions: {}});
					store.dispatch({type: 'REMOVE_CARDS', cardIDs: [card.id]});
				};
				try {
					await store.dispatch(modifyCardsWithDurableTagOperation([card], 'scope-echo', true));
					assert.equal(store.getState().data.cards[card.id], undefined, 'old private card must not be republished');
					assert.deepEqual((await getDoc(doc(db, 'cards', card.id))).data().tags, ['scope-echo']);
				} finally {
					MultiBatch.prototype.commit = originalCommit;
					store.dispatch({type: 'SIGNIN_SUCCESS', user: originalUser});
				}
			});
		});
	}

	for (const lostAcknowledgement of [false, true]) {
		it(`retains skipped pure-tag targets across ${lostAcknowledgement ? 'a lost acknowledgement' : 'a later chunk failure'} and retry`, async () => {
			await withTagEditPermission(['skip-resume'], async () => {
				const cards = [];
				for (let i = 0; i < 17; i++) cards.push(await seedCard(`skip-resume-${i}`));
				putCardsInStore(cards);
				await firestore.deleteDoc(doc(db, 'cards', cards[0].id));
				const originalCommit = MultiBatch.prototype.commit;
				let commits = 0;
				MultiBatch.prototype.commit = async function(...args) {
					commits++;
					if (lostAcknowledgement) {
						await originalCommit.apply(this, args);
						throw new Error('injected lost acknowledgement');
					}
					if (commits === 2) throw new Error('injected later chunk failure');
					return originalCommit.apply(this, args);
				};
				try {
					await store.dispatch(modifyCardsWithDurableTagOperation(cards, 'skip-resume', true));
				} finally {
					MultiBatch.prototype.commit = originalCommit;
				}
				const key = 'card-web-pending-bulk-tag-operation-v1';
				const paused = JSON.parse(localStorage.getItem(key));
				assert.equal(paused.nextIndex, lostAcknowledgement ? 0 : 15);
				if (!lostAcknowledgement) assert.equal(paused.skippedCount, 1, 'durable progress must retain prior skipped cards');
				const marker = (await getDoc(doc(db, 'users', UID, 'multi_edit_chunks', `${paused.id}-0`))).data();
				assert.equal(marker.skipped_count, 1, 'server acknowledgement must carry skips for crash recovery');
				//A later edit must remain intact when a confirmed chunk is
				//reconciled from its marker instead of replaying old intent.
				if (lostAcknowledgement) await setDoc(doc(db, 'cards', cards[1].id), {...cards[1], tags: ['newer-tag']});
				clearWhatUserWasTold(store);
				await store.dispatch(retryPendingBulkTagOperation());
				assert.equal(localStorage.getItem(key), null);
				assert.ok(store.getState().app.snackbars.some(item => /1 no longer existed and were skipped/.test(item.message)));
				for (const card of cards.slice(1)) {
					assert.equal(await updateDocCount(card.id), 1, 'retry must not duplicate committed card history');
					assert.deepEqual(storeTags(card.id), lostAcknowledgement && card === cards[1] ? ['newer-tag'] : ['skip-resume']);
				}
			});
		});
	}

	it('refuses a new tag selection while another selection is pending', async () => {
		await withTagEditPermission(['same-tag'], async () => {
			const older = await seedCard('old-tag-target');
			const newer = await seedCard('new-tag-target');
			putCardsInStore([older, newer]);
			localStorage.setItem('card-web-pending-bulk-tag-operation-v1', JSON.stringify({
				version: 1, id: 'pending-other-selection', uid: UID,
				tag: 'same-tag', adding: true, targetIDs: [older.id], nextIndex: 0,
			}));
			await store.dispatch(modifyCardsWithDurableTagOperation([newer], 'same-tag', true));
			assert.ok(store.getState().data.cardModificationError, 'new selection must be explicitly refused, never silently replaced');
			assert.ok(localStorage.getItem('card-web-pending-bulk-tag-operation-v1'), 'original work stays retryable');
			for (const card of [older, newer]) assert.equal(await updateDocCount(card.id), 0);
		});
	});

	it('retries the complete saved tag selection even when a target is not loaded locally', async () => {
		await withTagEditPermission(['resume-unloaded-tag'], async () => {
			const card = await seedCard('unloaded-tag-target');
			//No UPDATE_CARDS: replay must preserve the durable IDs rather than
			//mistake the available local cards for a different selection.
			localStorage.setItem('card-web-pending-bulk-tag-operation-v1', JSON.stringify({
				version: 1, id: 'pending-unloaded-selection', uid: UID,
				tag: 'resume-unloaded-tag', adding: true, targetIDs: [card.id], nextIndex: 0,
			}));
			await store.dispatch(retryPendingBulkTagOperation());
			assert.ok((await getDoc(doc(db, 'cards', card.id))).data().tags.includes('resume-unloaded-tag'));
			assert.equal(localStorage.getItem('card-web-pending-bulk-tag-operation-v1'), null);
		});
	});

	it('finishes a saved tag selection with deleted targets, including stale local copies', async () => {
		await withTagEditPermission(['deleted-target-tag'], async () => {
			const live = await seedCard('surviving-tag-target');
			const stale = await seedCard('deleted-stale-target');
			const absent = await seedCard('deleted-absent-target');
			putCardsInStore([live, stale]);
			await firestore.deleteDoc(doc(db, 'cards', stale.id));
			await firestore.deleteDoc(doc(db, 'cards', absent.id));
			const operationID = `deleted-selection-${Date.now()}`;
			const targetIDs = [stale.id, live.id, absent.id];
			localStorage.setItem('card-web-pending-bulk-tag-operation-v1', JSON.stringify({
				version: 1, id: operationID, uid: UID,
				tag: 'deleted-target-tag', adding: true, targetIDs, nextIndex: 0,
			}));
			await store.dispatch(retryPendingBulkTagOperation());
			assert.ok((await getDoc(doc(db, 'cards', live.id))).data().tags.includes('deleted-target-tag'));
			assert.equal((await getDoc(doc(db, 'cards', stale.id))).exists(), false);
			assert.equal((await getDoc(doc(db, 'cards', absent.id))).exists(), false);
			assert.equal(localStorage.getItem('card-web-pending-bulk-tag-operation-v1'), null);
			const checkpoint = (await getDoc(doc(db, 'users', UID, 'multi_edit_chunks', `${operationID}-0`))).data();
			assert.equal(checkpoint.next_index, targetIDs.length);
			assert.deepEqual(checkpoint.card_ids, targetIDs);
			assert.ok(store.getState().app.snackbars.some(item => /2 no longer existed and were skipped/.test(item.message)));
		});
	});

	it('saves tag and priority on every target despite unchanged duplicate concept titles', async () => {
		await withTagEditPermission(['bits-and-bobs'], async () => {
			const cards = [];
			for (let i = 0; i < 12; i++) {
				cards.push(await seedCard(`metadata-${i}`, i >= 10 ? {
					card_type: 'concept', title: 'unchanged duplicate concept',
				} : {}));
			}
			putCardsInStore(cards);
			const update = {add_tags: ['bits-and-bobs'], auto_todo_overrides_disablements: ['prioritized']};
			await store.dispatch(modifyCardsWithDurableMultiEdit(cards, update));
			for (const card of cards) {
				const saved = (await getDoc(doc(db, 'cards', card.id))).data();
				assert.ok(saved.tags.includes('bits-and-bobs'), `${card.id}: tag must save`);
				assert.strictEqual(saved.auto_todo_overrides.prioritized, false, `${card.id}: priority must save`);
				assert.strictEqual(saved.title, card.title, 'metadata edits must leave titles unchanged');
			}
			assert.equal(readRecord(), null, 'all requested metadata must complete');
		});
	});

	it('still rejects duplicate concept names when content is explicitly changed', async () => {
		const first = await seedCard('duplicate-content-a', {card_type: 'concept', title: 'first concept'});
		const second = await seedCard('duplicate-content-b', {card_type: 'concept', title: 'second concept'});
		putCardsInStore([first, second]);
		await store.dispatch(modifyCardsWithDurableMultiEdit([second], {title: first.title}));
		assert.strictEqual((await getDoc(doc(db, 'cards', second.id))).data().title, second.title);
		assert.match(readRecord().lastError, /overlapped/);
	});

	it('leaves a real ARRAY in the local card after adding tags', async () => { await withTagEditPermission(['already-here', 'added-one', 'added-two'], async () => {
		const card = await seedCard('echo-add', {tags: ['already-here']});
		putCardsInStore([card]);

		await store.dispatch(modifyCardsWithDurableMultiEdit([card], {add_tags: ['added-one', 'added-two']}));

		const tags = storeTags(card.id);
		assert.ok(Array.isArray(tags),
			`local card.tags must be an array, not a write instruction (got ${Object.getPrototypeOf(tags)?.constructor?.name})`);
		assert.deepStrictEqual([...tags].sort(), ['added-one', 'added-two', 'already-here']);
		//And nothing iterating it may throw — that is the actual failure mode.
		assert.doesNotThrow(() => [...tags]);
	});
	});

	it('leaves a real ARRAY in the local card after removing tags', async () => { await withTagEditPermission(['keep-me', 'drop-me'], async () => {
		const card = await seedCard('echo-remove', {tags: ['keep-me', 'drop-me']});
		putCardsInStore([card]);

		await store.dispatch(modifyCardsWithDurableMultiEdit([card], {remove_tags: ['drop-me']}));

		const tags = storeTags(card.id);
		assert.ok(Array.isArray(tags), 'local card.tags must be an array after a removal too');
		assert.deepStrictEqual([...tags], ['keep-me']);
	});
	});

	it('RESUMES for a card this tab does not hold, instead of dead-ending', async () => { await withTagEditPermission(['resume-tag'], async () => {
		//selectCardIDsUserMayEdit is a projection over Redux, so a card the tab
		//does not HOLD reads as "not allowed" whatever the user's permissions
		//are. A durable record resumed for such a card therefore failed with
		//"User isn't allowed to edit the given card" — and kept failing, because
		//the record survives and every automatic resume repeats it, leaving Edit
		//disabled. The sibling bulk-label path already lets the security rules
		//be the authority for authoritatively-read cards; this one now does too.
		const card = await seedCard('resume-unheld', {tags: []});
		//Deliberately NOT putCardsInStore: this is the state after a reload
		//where the corpus has not delivered this card.
		assert.ok(!store.getState().data.cards[card.id], 'the card must be absent from Redux for this to test anything');
		writeRecord(makeRecord('unheld-op-' + Date.now(), [card.id], {add_tags: ['resume-tag']}));

		await store.dispatch(modifyCardsWithDurableMultiEdit([], {add_tags: ['resume-tag']}, false, 'multi', [card.id]));

		const failure = store.getState().data.cardModificationError;
		assert.ok(!failure, `the resume must not fail (got ${String(failure && failure.message || failure)})`);
		assert.equal(readRecord(), null, 'and it must clear its record rather than retrying forever');
		const server = (await getDoc(doc(db, 'cards', card.id))).data().tags;
		assert.deepStrictEqual([...server], ['resume-tag'], 'the edit must actually land on the server');
	});
	});

	//REGRESSION GUARD, not a bug-catcher: this passes against the original
	//broken code too, because that code also wrote a transform. It exists so the
	//fix for the echo cannot be "simplified" into sending the whole array.
	it('still writes a TRANSFORM, so a concurrent tag change survives', async () => { await withTagEditPermission(['original', 'from-another-device', 'added-here'], async () => {
		//WHY the write cannot simply send the materialized array. This drives
		//modifyCardWithBatch directly with a deliberately STALE base card,
		//because the chunk loop above re-reads each card authoritatively before
		//planning — which hides the difference: a whole-array write built from a
		//fresh read happens to contain the concurrent tag too. The real window
		//is between that read and the commit, and a transform is what closes it.
		const card = await seedCard('echo-concurrent', {tags: ['original']});
		putCardsInStore([card]);
		//Another device adds a tag. Our base card still says ['original'].
		await setDoc(doc(db, 'cards', card.id), {...card, tags: ['original', 'from-another-device']});

		const batch = new MultiBatch(db);
		await modifyCardWithBatch(store.getState(), card, {add_tags: ['added-here']}, false, batch);
		await batch.commit();

		const server = (await getDoc(doc(db, 'cards', card.id))).data().tags;
		assert.deepStrictEqual([...server].sort(), ['added-here', 'from-another-device', 'original'],
			'the concurrent tag must survive, which only a transform guarantees');
	});
	});

	//The CLIENT sentinel config itself, not a stand-in. test/card-echo pins the
	//shared materialization rule with a fake config, and the thunk cases above
	//no longer reach the transform branch at all — after the call-site fix,
	//cardUpdateObject.tags is always a materialized array, so nothing hands
	//applyCardFirebaseUpdate a transform any more. That makes the sentinel layer
	//a GUARD for call sites that do not use the vending wrappers, and a guard
	//with no test is a guess. These two cases call it directly with the real
	//src/firebase.ts sentinels.
	it('materializes a VENDED array transform into a real array', () => {
		const card = {...harnessWireCard('sentinel-vended', UID), id: 'sentinel-vended', tags: ['already-here']};
		const updated = applyCardFirebaseUpdate(card, {tags: arrayUnionSentinel('added')});
		assert.ok(Array.isArray(updated.tags), 'a vended transform must resolve to an array');
		assert.deepStrictEqual([...updated.tags].sort(), ['added', 'already-here']);
		assert.deepStrictEqual(card.tags, ['already-here'], 'and must not mutate the card it was given');
	});

	it('REFUSES to store a raw SDK transform, leaving the field stale instead', () => {
		//A call site that bypasses the vending wrappers. Stale is recoverable —
		//the server echo repairs it moments later. A FieldValue in the field is
		//not: the next reader that iterates it throws.
		const card = {...harnessWireCard('sentinel-raw', UID), id: 'sentinel-raw', tags: ['already-here']};
		const updated = applyCardFirebaseUpdate(card, {tags: rawArrayUnion('added')});
		assert.ok(Array.isArray(updated.tags), 'a card must never end up holding a FieldValue');
		assert.deepStrictEqual(updated.tags, ['already-here'], 'the field stays at its previous value');
	});

	//REGRESSION GUARD, not a bug-catcher: the mixed branch was always correct
	//(it kept cardUpdateObject intact and stripped `tags` from the write). It is
	//here so the two branches cannot drift apart again — that asymmetry is the
	//whole reason the pure add/remove case was broken and unnoticed.
	it('leaves a real ARRAY when adds and removes are mixed', async () => { await withTagEditPermission(['keep-me', 'drop-me', 'added-one'], async () => {
		const card = await seedCard('echo-mixed', {tags: ['keep-me', 'drop-me']});
		putCardsInStore([card]);

		await store.dispatch(modifyCardsWithDurableMultiEdit([card], {add_tags: ['added-one'], remove_tags: ['drop-me']}));

		const tags = storeTags(card.id);
		assert.ok(Array.isArray(tags), 'the mixed branch must materialize too');
		assert.deepStrictEqual([...tags].sort(), ['added-one', 'keep-me']);
		const server = (await getDoc(doc(db, 'cards', card.id))).data().tags;
		assert.deepStrictEqual([...server].sort(), ['added-one', 'keep-me']);
	});
	});
});

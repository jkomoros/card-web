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
import {bootstrapApp, clearAuxQueue, clearHarnessAlerts, harnessAlerts, wireCard as harnessWireCard} from '../harness-support/app-harness.js';

const app = await bootstrapApp();
const {db, store, uid: UID, firestore} = app;
const {doc, getDoc, setDoc, getDocs, collection} = firestore;

const {modifyCardsWithDurableMultiEdit, modifyCardWithBatch} = await import('../../lib/src/actions/data.js');
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
		assert.ok(harnessAlerts.some(message => /12 cards modified/.test(message)),
			`the user must be told what happened (got ${JSON.stringify(harnessAlerts)})`);
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

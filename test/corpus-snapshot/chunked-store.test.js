/*eslint-env node, es2022*/

//The snapshot store splits the cards across part records: Chromium refuses a
//single IndexedDB value above ~127 MiB, and the privileged snapshot of the
//real corpus crossed that at 46.5k cards, so every save failed — reported as
//"ownership changed" because a failing put's error event reaches the
//transaction before transaction.error is set. Driven against an in-memory
//IndexedDB that reproduces both the size refusal and that event order.

import assert from 'assert';
import {installFakeIndexedDB} from '../harness-support/fake-indexeddb.js';

const DB = 'corpus-worker-snapshot';
const STORE = 'snapshots';

let CorpusSnapshotStore;
let SNAPSHOT_CARDS_PER_PART;

const card = (id, body = 'b') => ({id, title: 'T ' + id, body, published: false});
const corpus = (n) => Object.fromEntries(Array.from({length: n}, (_, i) => ['c' + i, card('c' + i)]));
const owner = {ownerID: 'tab-a', epoch: 1};

describe('chunked snapshot store', () => {
	before(async () => {
		({CorpusSnapshotStore, SNAPSHOT_CARDS_PER_PART} = await import('../../lib/src/worker/corpus-snapshot.js'));
	});

	const freshStore = async (fake, key = 'proj:uid:privileged', token = owner) => {
		const store = new CorpusSnapshotStore(key, token);
		assert.strictEqual(await store.claimOwnership(), true);
		return store;
	};

	it('saves a manifest plus parts of at most SNAPSHOT_CARDS_PER_PART cards, and loads the whole corpus back', async () => {
		const fake = installFakeIndexedDB();
		const store = await freshStore(fake);
		const n = SNAPSHOT_CARDS_PER_PART * 2 + 17;
		const cards = corpus(n);
		await store.save(cards, ['c1'], ['gone'], {seconds: 1, nanoseconds: 2}, null, {sections: {s: {id: 's'}}, tags: {}}, {c0: ['s1', '1/1/26 words']});
		const records = fake.records(DB, STORE);
		const manifest = records.get('proj:uid:privileged');
		assert.strictEqual(manifest.schemaVersion, 3);
		assert.strictEqual(manifest.cardsParts, 3);
		assert.strictEqual(manifest.cardsCount, n);
		assert.strictEqual(manifest.cards, undefined, 'the manifest carries no cards');
		for (let i = 0; i < 3; i++) {
			const part = records.get(`proj:uid:privileged:cards:${i}`);
			assert.ok(part, `part ${i} exists`);
			assert.ok(Object.keys(part).length <= SNAPSHOT_CARDS_PER_PART);
		}
		const loaded = await store.load();
		assert.strictEqual(loaded.schemaVersion, 2, 'callers see the V2 shape');
		assert.strictEqual(Object.keys(loaded.cards).length, n);
		assert.deepStrictEqual(loaded.cards.c17, cards.c17);
		assert.deepStrictEqual(loaded.clientClockCardIDs, ['c1']);
		assert.deepStrictEqual(loaded.tombstoneCursor, {seconds: 1, nanoseconds: 2});
		assert.deepStrictEqual(loaded.displayTitles, {c0: ['s1', '1/1/26 words']});
		assert.deepStrictEqual(loaded.sections, {s: {id: 's'}});
	});

	it('a smaller re-save deletes the previous save’s surplus parts in the same transaction', async () => {
		const fake = installFakeIndexedDB();
		const store = await freshStore(fake);
		await store.save(corpus(SNAPSHOT_CARDS_PER_PART * 3 + 1), [], [], null, null);
		assert.strictEqual(fake.records(DB, STORE).get('proj:uid:privileged').cardsParts, 4);
		await store.save(corpus(5), [], [], null, null);
		const records = fake.records(DB, STORE);
		assert.strictEqual(records.get('proj:uid:privileged').cardsParts, 1);
		assert.ok(records.has('proj:uid:privileged:cards:0'));
		for (let i = 1; i < 4; i++) assert.ok(!records.has(`proj:uid:privileged:cards:${i}`), `surplus part ${i} removed`);
		assert.strictEqual(Object.keys((await store.load()).cards).length, 5);
	});

	it('still loads a legacy single-record snapshot, and the next save replaces it with a manifest', async () => {
		const fake = installFakeIndexedDB();
		const store = await freshStore(fake);
		const legacy = {schemaVersion: 2, cards: {a: card('a')}, clientClockCardIDs: [], processedTombstoneIDs: [], tombstoneCursor: null, watermarkClamp: null, savedAt: 1};
		fake.records(DB, STORE).set('proj:uid:privileged', legacy);
		assert.deepStrictEqual(await store.load(), legacy);
		await store.save({b: card('b')}, [], [], null, null);
		assert.strictEqual(fake.records(DB, STORE).get('proj:uid:privileged').schemaVersion, 3);
		assert.deepStrictEqual(Object.keys((await store.load()).cards), ['b']);
	});

	it('a missing part makes the snapshot unusable rather than smaller', async () => {
		const fake = installFakeIndexedDB();
		const store = await freshStore(fake);
		await store.save(corpus(SNAPSHOT_CARDS_PER_PART + 1), [], [], null, null);
		fake.records(DB, STORE).delete('proj:uid:privileged:cards:1');
		assert.strictEqual(await store.load(), null);
	});

	it('an oversized value is reported as the put’s own error, not as an ownership change', async () => {
		//Parts fit under the limit; a manifest fat with titles does not.
		const fake = installFakeIndexedDB({maxValueBytes: 5000});
		const store = await freshStore(fake);
		const titles = Object.fromEntries(Array.from({length: 400}, (_, i) => ['c' + i, ['s' + i, 'a title with several words ' + i]]));
		await assert.rejects(store.save(corpus(10), [], [], null, null, undefined, titles), /too large/);
		//The transaction rolled back as a whole: no manifest and no part.
		assert.strictEqual(fake.records(DB, STORE).size, 1, 'only the ownership token remains');
	});

	it('a failing middle part is reported as its own cause, not as the AbortError of the parts queued behind it, and the previous complete snapshot survives', async () => {
		const fake = installFakeIndexedDB();
		const store = await freshStore(fake);
		await store.save(corpus(3), [], [], null, null);
		const before = new Map(fake.records(DB, STORE));
		//Big enough for a part of small cards and the manifest, not for the
		//part holding one fat card.
		const limit = 400000;
		fake.setMaxValueBytes(limit);
		const cards = corpus(SNAPSHOT_CARDS_PER_PART * 3);
		const fatID = 'c' + (SNAPSHOT_CARDS_PER_PART + 1);
		cards[fatID] = card(fatID, 'x'.repeat(limit));
		await assert.rejects(store.save(cards, [], [], null, null), err => {
			assert.strictEqual(err.name, 'UnknownError', `got ${err.name}: ${err.message}`);
			assert.match(err.message, /too large/);
			return true;
		});
		assert.deepStrictEqual(fake.records(DB, STORE), before, 'the previous snapshot is intact');
		assert.strictEqual(Object.keys((await store.load()).cards).length, 3);
	});

	it('parts stay well under the per-value limit on a realistic corpus', async () => {
		//Chromium refuses a value above ~127 MiB. Cards here carry a body
		//and reference mirrors sized like the real corpus's mean (~3 KB
		//serialized), so a part is checked against a budget a long way
		//below the limit; the pathological real part (the 2,000 fattest
		//cards, ~18 MB) is covered by the comment on SNAPSHOT_CARDS_PER_PART.
		const fake = installFakeIndexedDB();
		const store = await freshStore(fake);
		const realistic = (id) => ({
			id, title: 'Card ' + id, body: 'word '.repeat(400), published: false,
			references_info: Object.fromEntries(Array.from({length: 12}, (_, i) => ['r' + i, {link: ''}])),
			references_info_inbound: Object.fromEntries(Array.from({length: 12}, (_, i) => ['i' + i, {link: ''}])),
			updated: {seconds: 1, nanoseconds: 0}, created: {seconds: 1, nanoseconds: 0},
		});
		const cards = Object.fromEntries(Array.from({length: SNAPSHOT_CARDS_PER_PART}, (_, i) => ['c' + i, realistic('c' + i)]));
		await store.save(cards, [], [], null, null);
		const part = fake.records(DB, STORE).get('proj:uid:privileged:cards:0');
		const bytes = JSON.stringify(part).length;
		const BUDGET = 16 * 1024 * 1024;
		assert.ok(bytes < BUDGET, `a full part of realistic cards is ${bytes} bytes, over the ${BUDGET} byte budget`);
	});

	it('clear and save drop parts an older build’s single-record manifest no longer counts', async () => {
		const fake = installFakeIndexedDB();
		const store = await freshStore(fake);
		await store.save(corpus(SNAPSHOT_CARDS_PER_PART * 2 + 1), [], [], null, null);
		const legacy = {schemaVersion: 2, cards: {a: card('a')}, clientClockCardIDs: [], processedTombstoneIDs: [], tombstoneCursor: null, watermarkClamp: null, savedAt: 1};
		//An older build overwrote the manifest, knowing nothing of parts.
		fake.records(DB, STORE).set('proj:uid:privileged', legacy);
		await store.save(corpus(1), [], [], null, null);
		let records = fake.records(DB, STORE);
		assert.ok(records.has('proj:uid:privileged:cards:0'));
		for (let i = 1; i < 3; i++) assert.ok(!records.has(`proj:uid:privileged:cards:${i}`), `orphan part ${i} removed by save`);
		await store.save(corpus(SNAPSHOT_CARDS_PER_PART * 2 + 1), [], [], null, null);
		fake.records(DB, STORE).set('proj:uid:privileged', legacy);
		await store.clear();
		records = fake.records(DB, STORE);
		assert.strictEqual(records.size, 0, `orphan parts removed by clear: ${[...records.keys()]}`);
	});

	it('an ownership mismatch names both tokens', async () => {
		const fake = installFakeIndexedDB();
		const store = await freshStore(fake);
		fake.records(DB, STORE).set('proj:uid:privileged:owner', {ownerID: 'tab-b', epoch: 2});
		await assert.rejects(store.save(corpus(2), [], [], null, null), /held \{tab-a, epoch 1\}, record \{tab-b, epoch 2\}/);
	});

	it('clear removes the manifest, every part and the ownership token', async () => {
		const fake = installFakeIndexedDB();
		const store = await freshStore(fake);
		await store.save(corpus(SNAPSHOT_CARDS_PER_PART + 1), [], [], null, null);
		await store.clear();
		assert.strictEqual(fake.records(DB, STORE).size, 0);
	});
});

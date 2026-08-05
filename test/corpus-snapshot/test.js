/*eslint-env node*/

import assert from 'assert';

let validCorpusSnapshot;

describe('corpus snapshot', () => {
	before(async () => {
		({validCorpusSnapshot} = await import('../../lib/src/worker/corpus-snapshot.js'));
	});

	it('accepts legacy v1 records for conservative fallback', () => {
		assert.strictEqual(validCorpusSnapshot({
			schemaVersion: 1,
			cards: {a: {id: 'a'}},
			clientClockCardIDs: ['a'],
			processedTombstoneIDs: ['deleted-card'],
			savedAt: 123
		}), true);
		assert.strictEqual(validCorpusSnapshot({
			schemaVersion: 1,
			cards: {},
			clientClockCardIDs: [],
			savedAt: 123
		}), true);
	});

	it('accepts a v2 atomic cards-and-safety checkpoint', () => {
		assert.strictEqual(validCorpusSnapshot({
			schemaVersion: 2,
			cards: {a: {id: 'a'}},
			clientClockCardIDs: ['a'],
			processedTombstoneIDs: ['deleted-card'],
			tombstoneCursor: {seconds: 10, nanoseconds: 20},
			watermarkClamp: null,
			savedAt: 123
		}), true);
	});

	it('rejects old schemas and malformed timestamp-exclusion metadata', () => {
		assert.strictEqual(validCorpusSnapshot({
			schemaVersion: 0,
			cards: {},
			clientClockCardIDs: []
		}), false);
		assert.strictEqual(validCorpusSnapshot({
			schemaVersion: 1,
			cards: {},
			clientClockCardIDs: [],
			processedTombstoneIDs: [42]
		}), false);
		assert.strictEqual(validCorpusSnapshot({
			schemaVersion: 1,
			cards: {},
			clientClockCardIDs: [42]
		}), false);
		assert.strictEqual(validCorpusSnapshot({
			schemaVersion: 1,
			cards: [],
			clientClockCardIDs: []
		}), false);
		assert.strictEqual(validCorpusSnapshot({
			schemaVersion: 2,
			cards: {},
			clientClockCardIDs: [],
			processedTombstoneIDs: [],
			tombstoneCursor: {seconds: 1, nanoseconds: 1_000_000_000},
			watermarkClamp: null,
			savedAt: 123
		}), false);
		assert.strictEqual(validCorpusSnapshot({
			schemaVersion: 2,
			cards: {},
			clientClockCardIDs: [],
			processedTombstoneIDs: [],
			tombstoneCursor: null,
			savedAt: 123
		}), false);
	});

	it('rejects malformed card records instead of hydrating junk into Redux', () => {
		const base = {
			schemaVersion: 1,
			clientClockCardIDs: [],
			savedAt: 123,
		};
		assert.strictEqual(validCorpusSnapshot({...base, cards: {a: null}}), false);
		assert.strictEqual(validCorpusSnapshot({...base, cards: {a: []}}), false);
		assert.strictEqual(validCorpusSnapshot({...base, cards: {a: {id: 'b'}}}), false);
	});
});

describe('published-scope snapshots (anonymous readers)', () => {
	let snapshot;
	before(async () => {
		snapshot = await import('../../lib/src/worker/corpus-snapshot.js');
	});

	it('keys the published record WITHOUT a uid, and the privileged record with one', () => {
		//Published content is identical for every viewer, so one shared record
		//serves them all AND survives the anonymous uid churning between
		//sessions -- which is what makes an anonymous second visit warm at all.
		assert.strictEqual(snapshot.corpusSnapshotKey('proj', 'anon-uid-1', 'published'), 'proj:published');
		assert.strictEqual(snapshot.corpusSnapshotKey('proj', 'anon-uid-2', 'published'), 'proj:published');
		//A privileged record must never be shared between accounts.
		assert.strictEqual(snapshot.corpusSnapshotKey('proj', 'u1', 'privileged'), 'proj:u1:privileged');
		assert.notStrictEqual(
			snapshot.corpusSnapshotKey('proj', 'u1', 'privileged'),
			snapshot.corpusSnapshotKey('proj', 'u2', 'privileged'));
	});

	it('PAIRS the key with the filter, for every scope', () => {
		//THE ACTUAL PRIVACY BOUNDARY, and the thing testing the two halves
		//separately could never catch: a shared (uid-less) key must imply
		//published-only contents. Both now derive from one scope value, so this
		//iterates every scope the session function can produce and asserts they
		//agree -- rather than asserting each half in isolation and hoping the
		//call sites line up.
		const unpublished = {published: false};
		for (const mayViewUnpublished of [true, false]) {
			const scope = snapshot.snapshotScopeForSession(mayViewUnpublished);
			const keyA = snapshot.corpusSnapshotKey('proj', 'user-a', scope);
			const keyB = snapshot.corpusSnapshotKey('proj', 'user-b', scope);
			const shared = keyA === keyB;
			assert.strictEqual(shared, snapshot.snapshotScopeIsShared(scope),
				`scope ${scope}: "shared" must mean "the same key for different accounts"`);
			if (shared) {
				assert.strictEqual(snapshot.snapshotEligibleCard(unpublished, scope), false,
					`scope ${scope} is SHARED between accounts, so an unpublished card must never be eligible`);
				assert.ok(!keyA.includes('user-a'),
					'a shared key must not be scoped to one account');
			} else {
				assert.ok(keyA.includes('user-a'),
					`scope ${scope} is per-account, so its key must carry the uid`);
			}
		}
	});

	it('gives a privileged session a per-account key, and a reader the shared one', () => {
		//The session predicate is the single decision both halves hang off, so
		//pin what it returns rather than leaving it implied by the call sites.
		assert.strictEqual(snapshot.snapshotScopeForSession(true), 'privileged');
		assert.strictEqual(snapshot.snapshotScopeForSession(false), 'published');
	});

	it('never lets an unpublished card into the SHARED published record', () => {
		//This is a privacy boundary, not an optimization. A signed-in
		//non-privileged user also runs author/editor listeners, so their own
		//unpublished cards are in the same corpus; writing those into the
		//uid-less shared record would hand them to the next anonymous visitor
		//on that device.
		assert.strictEqual(snapshot.snapshotEligibleCard({published: true}, 'published'), true);
		assert.strictEqual(snapshot.snapshotEligibleCard({published: false}, 'published'), false);
		//Absent is not published.
		assert.strictEqual(snapshot.snapshotEligibleCard({}, 'published'), false);
		//The privileged record is per-user, so it keeps everything.
		assert.strictEqual(snapshot.snapshotEligibleCard({published: false}, 'privileged'), true);
		assert.strictEqual(snapshot.snapshotEligibleCard({}, 'privileged'), true);
	});
});

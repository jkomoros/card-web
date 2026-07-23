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

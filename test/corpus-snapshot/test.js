/*eslint-env node*/

import assert from 'assert';

let validCorpusSnapshot;

describe('corpus snapshot', () => {
	before(async () => {
		({validCorpusSnapshot} = await import('../../lib/src/worker/corpus-snapshot.js'));
	});

	it('accepts the current atomic record shape', () => {
		assert.strictEqual(validCorpusSnapshot({
			schemaVersion: 1,
			cards: {a: {id: 'a'}},
			clientClockCardIDs: ['a'],
			processedTombstoneIDs: ['deleted-card'],
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
	});
});

import assert from 'assert';

import {
	dropCardsAlreadyAtUpdatedVersion,
	sameUpdatedTimestamp
} from '../../lib/src/worker/fast-dedupe.js';

const timestamp = (seconds, nanoseconds) => ({seconds, nanoseconds});
const card = (id, updated, body = id) => ({id, updated, body});

describe('worker initial-listener fast dedupe', () => {
	it('recognizes only an exact seconds-and-nanoseconds version match', () => {
		const existing = card('a', timestamp(10, 20));
		assert.strictEqual(sameUpdatedTimestamp(existing, card('a', timestamp(10, 20))), true);
		assert.strictEqual(sameUpdatedTimestamp(existing, card('a', timestamp(10, 21))), false);
		assert.strictEqual(sameUpdatedTimestamp(existing, card('a', timestamp(11, 20))), false);
		assert.strictEqual(sameUpdatedTimestamp(existing, card('a', undefined)), false);
		assert.strictEqual(sameUpdatedTimestamp(undefined, card('a', timestamp(10, 20))), false);
	});

	it('drops exact-version redeliveries but preserves new, changed, and unversioned cards', () => {
		const existing = new Map([
			['same', card('same', timestamp(10, 20), 'old body')],
			['new-version', card('new-version', timestamp(10, 20), 'old body')],
			['unversioned', card('unversioned', undefined, 'old body')],
		]);
		const cards = {
			//Content is deliberately different: the invariant is that an equal
			//updated timestamp denotes the same persisted version.
			same: card('same', timestamp(10, 20), 'redelivered body'),
			'new-version': card('new-version', timestamp(10, 21), 'new body'),
			new: card('new', timestamp(10, 20), 'new card'),
			unversioned: card('unversioned', undefined, 'new body'),
		};

		dropCardsAlreadyAtUpdatedVersion(cards, existing);

		assert.deepStrictEqual(Object.keys(cards).sort(), ['new', 'new-version', 'unversioned']);
		assert.strictEqual(cards['new-version'].body, 'new body');
	});
});

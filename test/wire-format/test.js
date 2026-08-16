/*eslint-env node*/

//Tests for the worker-boundary wire format: Timestamps must round-trip across
//structured clone as real Timestamp instances, and untouched subtrees must
//keep object identity.

import assert from 'assert';

import {
	toWire,
	fromWire
} from '../../lib/src/worker/wire-format.js';

//A stand-in for Firestore's Timestamp: a class instance that would lose its
//prototype under structured clone.
class FakeTimestamp {
	constructor(seconds, nanoseconds) {
		this.seconds = seconds;
		this.nanoseconds = nanoseconds;
	}
	toDate() {
		return new Date(this.seconds * 1000);
	}
}

const isTimestamp = (value) => value instanceof FakeTimestamp;
const getTime = (timestamp) => ({seconds: timestamp.seconds, nanoseconds: timestamp.nanoseconds});
const makeTimestamp = (seconds, nanoseconds) => new FakeTimestamp(seconds, nanoseconds);

describe('wire format', () => {
	it('round-trips timestamps at any depth', async () => {
		const card = {
			id: 'a',
			title: 'Title',
			created: new FakeTimestamp(100, 5),
			updated: new FakeTimestamp(200, 6),
			nested: {
				inner: new FakeTimestamp(300, 7),
				list: [new FakeTimestamp(400, 8), 'plain'],
			},
			references: {b: {link: ''}},
		};
		const wire = toWire(card, isTimestamp, getTime);
		//Simulate structured clone: JSON round-trip strips prototypes just
		//as thoroughly.
		const cloned = JSON.parse(JSON.stringify(wire));
		const restored = fromWire(cloned, makeTimestamp);
		assert.ok(restored.created instanceof FakeTimestamp);
		assert.strictEqual(restored.created.seconds, 100);
		assert.strictEqual(restored.created.nanoseconds, 5);
		assert.ok(restored.nested.inner instanceof FakeTimestamp);
		assert.ok(restored.nested.list[0] instanceof FakeTimestamp);
		assert.strictEqual(restored.nested.list[0].seconds, 400);
		assert.strictEqual(restored.nested.list[1], 'plain');
		assert.strictEqual(restored.title, 'Title');
		assert.deepStrictEqual(restored.references, {b: {link: ''}});
		//And the restored timestamp behaves like one.
		assert.strictEqual(restored.created.toDate().getTime(), 100000);
	});

	it('keeps identity for subtrees without timestamps', async () => {
		const references = {b: {link: 'text'}};
		const tags = ['x', 'y'];
		const card = {id: 'a', references, tags, updated: new FakeTimestamp(1, 2)};
		const wire = toWire(card, isTimestamp, getTime);
		assert.notStrictEqual(wire, card);
		assert.strictEqual(wire.references, references);
		assert.strictEqual(wire.tags, tags);
		//A card with no timestamps at all passes through by identity.
		const plain = {id: 'b', references, tags};
		assert.strictEqual(toWire(plain, isTimestamp, getTime), plain);
		assert.strictEqual(fromWire(plain, makeTimestamp), plain);
	});

	it('handles primitives and null', async () => {
		assert.strictEqual(toWire(null, isTimestamp, getTime), null);
		assert.strictEqual(toWire(5, isTimestamp, getTime), 5);
		assert.strictEqual(fromWire('str', makeTimestamp), 'str');
	});
});

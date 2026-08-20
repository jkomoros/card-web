/*eslint-env node*/

//Tests for the worker-boundary wire format: Timestamps must round-trip across
//structured clone as real Timestamp instances, and untouched subtrees must
//keep object identity.

import assert from 'assert';
import fs from 'fs';

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

//#738: the toWire invariant on card-bearing post() payloads is enforced by
//the COMPILER via the branded Wire<T> type — deleting the toWire call from
//corpus-bridge's setEditingCard post site used to leave every suite green
//(the field was `unknown`, which accepted the raw card, a string, or a
//function); it is now a build-breaking type error, verified by performing
//exactly that deletion against tsc. These pins keep the guarantee WIRED:
//they fail if the protocol fields regress to unknown or the brand is
//removed, at which point the compile-time enforcement is gone even though
//tsc still passes.
describe('the Wire<T> brand stays wired (#738)', () => {
	const read = (relativePath) => fs.readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');

	it('toWire returns Wire<T> and fromWire accepts it', () => {
		const source = read('src/worker/wire-format.ts');
		//The SUBSTANCE of the brand, not just its name: `export type
		//Wire<T> = T;` would disarm the whole compile-time guarantee while
		//every call site, tsc, and a name-only pin stayed green.
		assert.match(source, /declare const wireBrand : unique symbol;/);
		assert.match(source, /export type Wire<T> = \{readonly \[wireBrand\] : T\};/);
		assert.match(source, /export const toWire = <T>\(value : T,[\s\S]{0,200}\) : Wire<T>/);
		assert.match(source, /export const fromWire = <T>\(value : Wire<T>,[\s\S]{0,120}\) : T/);
	});

	it('every card-bearing main→worker field is Wire-branded, not unknown', () => {
		const protocol = read('src/worker/worker-protocol.ts');
		assert.match(protocol, /\{type: 'action', generation: WorkerGeneration, action : Wire<SomeAction>\}/);
		assert.match(protocol, /hydration : Wire<CollectionStateHydration>\}/);
		assert.match(protocol, /card : Wire<ProcessedCard \| null>, similarity/);
	});

	it('the setEditingCard post site converts (the exact #737 bug site)', () => {
		const bridge = read('src/corpus-bridge.ts');
		assert.match(bridge, /post\(\{type: 'setEditingCard', generation, card: toWire\(card, isTimestamp, getTime\), similarity\}\);/);
	});
});

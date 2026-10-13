/* eslint-env node, mocha, es2022 */
import assert from 'node:assert/strict';
import {
	cardDerivedMembershipsFromFilterMaps,
	cardDerivedMembershipsFromPrime,
	membershipKeys,
	primeBitsFor,
	updateCardDerivedMembership,
} from '../../lib/shared/filter_membership.js';
//lib/shared, not shared/dist: the product (and card-filter-projection) use
//the lib copy, and the prime-source registry is per module instance.
import {cardFilterBitsForWire, validCardFilterBits} from '../../lib/src/card-filter-projection.js';

const prime = (ids, predicates) => {
	const words = predicates.map(() => new Uint32Array(Math.ceil(ids.length / 32)));
	for (let i = 0; i < ids.length; i++) for (let f = 0; f < predicates.length; f++) if (predicates[f](i)) words[f][i >>> 5] |= 1 << (i & 31);
	return {words, memberships: cardDerivedMembershipsFromPrime(ids, words)};
};

describe('prime bitset projection for the wire', () => {
	it('a membership knows its prime bits until it is updated; imported maps never do', () => {
		const ids = ['a', 'b', 'c'];
		const {words, memberships} = prime(ids, [i => i !== 1, () => false]);
		assert.strictEqual(primeBitsFor(memberships[0]).ids, ids);
		assert.strictEqual(primeBitsFor(memberships[0]).words, words[0]);
		assert.equal(primeBitsFor(updateCardDerivedMembership(memberships[0], {add: ['b']})), undefined, 'an updated membership is no longer the prime');
		assert.strictEqual(updateCardDerivedMembership(memberships[0], {add: ['a']}), memberships[0], 'a no-op update keeps the prime object');
		assert.equal(primeBitsFor(cardDerivedMembershipsFromFilterMaps([{a: true}])[0]), undefined);
		assert.equal(primeBitsFor({a: true}), undefined);
	});

	it('the wire gets bits only while every filter is still exactly the prime, from one prime', () => {
		const ids = ['x', 'y'];
		const {memberships} = prime(ids, [i => i === 0, i => i === 1, () => true]);
		const filters = {one: memberships[0], two: memberships[1], all: memberships[2]};
		const bits = cardFilterBitsForWire(filters);
		assert.deepEqual(bits.names, ['one', 'two', 'all']);
		assert.strictEqual(bits.ids, ids);
		assert.deepEqual(membershipKeys(cardDerivedMembershipsFromPrime(bits.ids, bits.words)[1]), ['y']);
		assert.equal(cardFilterBitsForWire({...filters, two: updateCardDerivedMembership(memberships[1], {add: ['x']})}), null, 'a raced update falls back');
		const other = prime(['x', 'y'], [() => true]).memberships[0];
		assert.equal(cardFilterBitsForWire({...filters, all: other}), null, 'a membership from a different prime cannot share the ids');
		assert.equal(cardFilterBitsForWire({}), null);
	});

	it('validates the received shape: names, unique ids, one sized bitset per name', () => {
		const ids = Array.from({length: 40}, (_, i) => 'c' + i);
		const {words} = prime(ids, [() => true, i => i % 2 === 0]);
		const good = {ids, names: ['p', 'q'], words};
		assert.equal(validCardFilterBits(good, ['q', 'p']), true);
		assert.equal(validCardFilterBits({...good, names: ['p']}, ['p', 'q']), false, 'a name missing');
		assert.equal(validCardFilterBits({...good, names: ['p', 'z']}, ['p', 'q']), false, 'an unknown name');
		assert.equal(validCardFilterBits({...good, names: ['p', 'p']}, ['p', 'q']), false, 'a repeated name');
		assert.equal(validCardFilterBits({...good, words: [words[0]]}, ['p', 'q']), false, 'too few bitsets');
		assert.equal(validCardFilterBits({...good, words: [words[0], new Uint32Array(3)]}, ['p', 'q']), false, 'a bitset the wrong length');
		assert.equal(validCardFilterBits({...good, words: [words[0], Array.from(words[1])]}, ['p', 'q']), false, 'a bitset that is not a Uint32Array');
		assert.equal(validCardFilterBits({...good, ids: [...ids.slice(0, 39), 'c0']}, ['p', 'q']), false, 'a repeated id');
		assert.equal(validCardFilterBits({...good, ids: [...ids.slice(0, 39), '']}, ['p', 'q']), false, 'an empty id');
	});
});

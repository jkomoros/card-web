/*eslint-env node*/

//The everything set carried forward incrementally must be EXACTLY what a
//full sort produces: it feeds sort-order arithmetic (adjacent placement for
//a new card) and every everything-set collection on both threads. Asserted
//with a seeded random battery of adds, removes and sort_order changes, not
//a handful of fixtures, because the merge's edge is the equal-key boundary
//and a hand-written case is unlikely to hit it.

import assert from 'assert';

import {
	makeEverythingSetFromCards,
	updateEverythingSet,
	INCREMENTAL_EVERYTHING_SET_MAX_TOUCHED
} from '../../lib/src/set-projections.js';

import {
	createCardsDiffSelector,
	anyChangedCardDiffers
} from '../../lib/src/incremental-selectors.js';

//Deterministic PRNG so a failure reproduces.
const rng = (seed) => () => {
	seed = (seed * 1664525 + 1013904223) >>> 0;
	return seed / 0x100000000;
};

const card = (id, sortOrder) => ({id, card_type: 'content', sort_order: sortOrder});

//Distinct sort orders by construction: ties are explicitly not a contract
//(see updateEverythingSet), so the parity battery stays off them.
const corpus = (n, random) => {
	const cards = {};
	const used = new Set();
	for (let i = 0; i < n; i++) {
		let sortOrder;
		do { sortOrder = Math.floor(random() * 1e6); } while (used.has(sortOrder));
		used.add(sortOrder);
		cards['c' + i] = card('c' + i, sortOrder);
	}
	return {cards, used};
};

describe('updateEverythingSet', () => {
	it('matches a full sort across a random battery of adds, removes and moves', () => {
		const random = rng(12345);
		for (let round = 0; round < 40; round++) {
			const {cards, used} = corpus(200 + Math.floor(random() * 300), random);
			let previous = makeEverythingSetFromCards(cards);
			for (let step = 0; step < 25; step++) {
				const next = {...cards};
				const upserted = [];
				const removed = [];
				const ids = Object.keys(next);
				const touched = 1 + Math.floor(random() * 6);
				for (let t = 0; t < touched; t++) {
					const roll = random();
					if (roll < 0.3 && ids.length) {
						const id = ids[Math.floor(random() * ids.length)];
						if (!next[id]) continue;
						delete next[id];
						removed.push(id);
					} else if (roll < 0.6) {
						const id = 'n' + round + '-' + step + '-' + t;
						let sortOrder;
						do { sortOrder = Math.floor(random() * 1e6); } while (used.has(sortOrder));
						used.add(sortOrder);
						next[id] = card(id, sortOrder);
						upserted.push(id);
					} else if (ids.length) {
						const id = ids[Math.floor(random() * ids.length)];
						if (!next[id]) continue;
						let sortOrder;
						do { sortOrder = Math.floor(random() * 1e6); } while (used.has(sortOrder));
						used.add(sortOrder);
						next[id] = card(id, sortOrder);
						upserted.push(id);
					}
				}
				//A removal that is also listed as upserted (same delta) is dropped.
				if (removed.length && random() < 0.2) upserted.push(removed[0]);
				const incremental = updateEverythingSet(previous, next, {upserted, removed});
				const full = makeEverythingSetFromCards(next);
				assert.deepStrictEqual(incremental, full, `round ${round} step ${step}: upserted ${upserted} removed ${removed}`);
				previous = incremental;
				for (const id of Object.keys(cards)) delete cards[id];
				Object.assign(cards, next);
			}
		}
	});

	it('returns the previous array untouched for an empty delta and falls back to a full sort past the threshold', () => {
		const random = rng(7);
		const {cards} = corpus(50, random);
		const previous = makeEverythingSetFromCards(cards);
		assert.strictEqual(updateEverythingSet(previous, cards, {upserted: [], removed: []}), previous);
		//Past the threshold every id is re-sorted: still exact, and the carried
		//array is not consulted (a deliberately wrong one proves it).
		const big = corpus(INCREMENTAL_EVERYTHING_SET_MAX_TOUCHED + 10, rng(9)).cards;
		const result = updateEverythingSet(['bogus'], big, {upserted: Object.keys(big), removed: []});
		assert.deepStrictEqual(result, makeEverythingSetFromCards(big));
	});

	it('places an upserted card after existing cards with an equal sort_order, as a stable sort of an appended key does', () => {
		const a = card('a', 5), b = card('b', 5), z = card('z', 1);
		const cards = {a, b, z};
		const previous = makeEverythingSetFromCards(cards);
		assert.deepStrictEqual(previous, ['a', 'b', 'z']);
		const next = {...cards, n: card('n', 5)};
		assert.deepStrictEqual(updateEverythingSet(previous, next, {upserted: ['n'], removed: []}), ['a', 'b', 'n', 'z']);
		assert.deepStrictEqual(makeEverythingSetFromCards(next), ['a', 'b', 'n', 'z'], 'the full sort agrees for an appended key');
	});
});

describe('createCardsDiffSelector update hook', () => {
	it('carries the previous result through update instead of recomputing, and still computes from scratch first', () => {
		let computes = 0;
		let updates = 0;
		const selector = createCardsDiffSelector({
			name: 'test-update',
			needsRecompute: delta => anyChangedCardDiffers(delta, (prev, next) => prev.sort_order !== next.sort_order),
			compute: (cards) => { computes++; return makeEverythingSetFromCards(cards); },
			update: (previous, cards, delta) => {
				updates++;
				return updateEverythingSet(previous, cards, {
					upserted: [...delta.added.map(c => c.id), ...delta.changed.filter(([p, n]) => p.sort_order !== n.sort_order).map(([, n]) => n.id)],
					removed: delta.removed.map(c => c.id),
				});
			},
		});
		const a = card('a', 3), b = card('b', 2);
		const first = selector({a, b});
		assert.deepStrictEqual(first, ['a', 'b']);
		assert.strictEqual(computes, 1);
		assert.strictEqual(updates, 0);
		//An unrelated change keeps identity and runs neither path.
		assert.strictEqual(selector({a: card('a', 3), b}), first);
		assert.strictEqual(updates, 0);
		//A relevant change goes through update, never compute.
		const second = selector({a, b, c: card('c', 9)});
		assert.deepStrictEqual(second, ['c', 'a', 'b']);
		assert.strictEqual(computes, 1);
		assert.strictEqual(updates, 1);
		const third = selector({a: card('a', 10), c: card('c', 9)});
		assert.deepStrictEqual(third, ['a', 'c']);
		assert.strictEqual(computes, 1);
		assert.strictEqual(updates, 2);
	});
});

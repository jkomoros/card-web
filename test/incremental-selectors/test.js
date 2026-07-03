/*eslint-env node*/

import assert from 'assert';

import {
	diffCards,
	createCardsDiffSelector,
	anyCardMatches,
	anyChangedCardDiffers,
	membershipChanged,
	arraysEqual
} from '../../lib/src/incremental-selectors.js';

const card = (id, extras) => ({id, card_type: 'content', sort_order: 1.0, ...extras});

describe('diffCards', () => {
	it('detects added, removed, and changed cards', async () => {
		const a = card('a');
		const b = card('b');
		const prev = {a, b};
		const bChanged = card('b', {sort_order: 2.0});
		const c = card('c');
		const next = {a, b: bChanged, c};
		const delta = diffCards(prev, next);
		assert.deepStrictEqual(delta.added, [c]);
		assert.deepStrictEqual(delta.removed, []);
		assert.deepStrictEqual(delta.changed, [[b, bChanged]]);
		const removalDelta = diffCards(next, {a});
		assert.deepStrictEqual(removalDelta.removed.map(removed => removed.id).sort(), ['b', 'c']);
	});
});

describe('createCardsDiffSelector', () => {
	it('keeps result identity when needsRecompute returns false', async () => {
		let computeCount = 0;
		const selector = createCardsDiffSelector({
			name: 'test',
			needsRecompute: delta => anyChangedCardDiffers(delta, (prev, next) => prev.sort_order !== next.sort_order),
			compute: (cards) => {
				computeCount++;
				return Object.keys(cards).sort();
			}
		});
		const a = card('a');
		const first = selector({a});
		assert.strictEqual(computeCount, 1);
		//Same map identity: no recompute, same result.
		assert.strictEqual(selector({a}), first);
		assert.strictEqual(computeCount, 1);
		//New map identity, changed card that doesn't affect projection: same
		//result identity, no recompute.
		const aChanged = card('a', {title: 'new title'});
		assert.strictEqual(selector({a: aChanged}), first);
		assert.strictEqual(computeCount, 1);
		//Changed card that does affect the projection: recompute.
		const aResorted = card('a', {sort_order: 5.0});
		const second = selector({a: aResorted});
		assert.strictEqual(computeCount, 2);
		assert.deepStrictEqual(second, ['a']);
	});

	it('always recomputes on membership changes when using membershipChanged', async () => {
		let computeCount = 0;
		const selector = createCardsDiffSelector({
			name: 'test2',
			needsRecompute: membershipChanged,
			compute: (cards) => {
				computeCount++;
				return Object.keys(cards).length;
			}
		});
		const a = card('a');
		selector({a});
		assert.strictEqual(computeCount, 1);
		selector({a, b: card('b')});
		assert.strictEqual(computeCount, 2);
	});
});

describe('helpers', () => {
	it('anyCardMatches inspects both sides of changed cards', async () => {
		const prev = card('a', {card_type: 'concept'});
		const next = card('a', {card_type: 'content'});
		const delta = {changed: [[prev, next]], added: [], removed: []};
		assert.strictEqual(anyCardMatches(delta, c => c.card_type === 'concept'), true);
		assert.strictEqual(anyCardMatches(delta, c => c.card_type === 'working-notes'), false);
	});

	it('arraysEqual is shallow', async () => {
		assert.strictEqual(arraysEqual([1, 2], [1, 2]), true);
		assert.strictEqual(arraysEqual([1, 2], [2, 1]), false);
		assert.strictEqual(arraysEqual([1], [1, 2]), false);
	});
});

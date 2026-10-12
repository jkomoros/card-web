/* eslint-env node, mocha, es2022 */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {diffCards, sharedDiffCards, createCardsDiffSelector} from '../../lib/src/incremental-selectors.js';

const card = (id, sort_order = 1) => ({id, card_type: 'content', title: id, sort_order});

describe('shared immutable card deltas', () => {
	it('preserves pure delta results through update, reorder, addition, removal, reset and branch interleaving', () => {
		const a = card('a'), b = card('b');
		const initial = {a, b};
		const edited = {...initial, a: {...a, title: 'Renamed'}};
		const reordered = {...edited, b: {...b, sort_order: 9}};
		const added = {...reordered, c: card('c')};
		const removed = {b: added.b, c: added.c};
		const states = [initial, edited, reordered, added, removed, {}, initial];
		for (let index = 1; index < states.length; index++) {
			const previous = states[index - 1], next = states[index];
			const result = sharedDiffCards(previous, next);
			assert.deepEqual(result, diffCards(previous, next));
			sharedDiffCards(next, previous);
			assert.equal(sharedDiffCards(previous, next), result);
		}
	});

	it('shares one comparison across interleaved selector instances and direct callers', () => {
		const before = {a: card('a')}, next = {...before, a: card('a', 2)}, unrelated = {z: card('z')};
		const observed = [];
		const selectors = Array.from({length: 3}, () => createCardsDiffSelector({name: 'delta-sharing', needsRecompute: delta => { observed.push(delta); return false; }, compute: Object.keys}));
		for (const selector of selectors) selector(before);
		const expected = sharedDiffCards(before, next);
		for (const selector of selectors) {
			sharedDiffCards(unrelated, before);
			selector(next);
		}
		assert(observed.every(delta => delta === expected));
	});

	it('does not retain either corpus map when only the opposite map remains reachable', () => {
		const url = pathToFileURL(path.resolve('lib/src/incremental-selectors.js')).href;
		const script = `
import assert from 'node:assert/strict';
import {sharedDiffCards} from ${JSON.stringify(url)};
const held = {};
let previousWeak, nextWeak;
(function () {
 const previous = {old: {id: 'old'}};
 const next = {fresh: {id: 'fresh'}};
 previousWeak = new WeakRef(previous);
 nextWeak = new WeakRef(next);
 sharedDiffCards(previous, held);
 sharedDiffCards(held, next);
})();
for (let index = 0; index < 8; index++) { await new Promise(resolve => setImmediate(resolve)); global.gc(); }
assert.equal(previousWeak.deref(), undefined, 'previous corpus retained');
assert.equal(nextWeak.deref(), undefined, 'next corpus retained');
assert.deepEqual(held, {});
`;
		execFileSync(process.execPath, ['--expose-gc', '--input-type=module', '-e', script], {stdio: 'pipe'});
	});
});

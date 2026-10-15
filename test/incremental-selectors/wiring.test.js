/*eslint-env node*/

//The product's selectors, not an inline selector: the update hook is wired
//into selectEverythingSet (and its snapshot twin), so a one-card change
//carries the ordering forward instead of re-sorting the corpus.

import assert from 'assert';
import {spawnSync} from 'child_process';

describe('everything-set selector wiring', () => {
	it('selectEverythingSet takes the incremental path on a one-card change, with the full sort’s result', () => {
		const run = spawnSync(process.execPath, [new URL('./fixtures/everything-set-wiring.fixture.js', import.meta.url).pathname], {encoding: 'utf8', timeout: 60000});
		assert.strictEqual(run.status, 0, run.stdout + run.stderr);
		const result = JSON.parse(run.stdout.trim().split('\n').pop());
		assert.strictEqual(result.firstMatchesFull, true);
		assert.strictEqual(result.secondMatchesFull, true);
		assert.strictEqual(result.recomputes, 1, 'the first call computes from scratch');
		assert.strictEqual(result.updates, 1, 'the one-card change goes through update, not a re-sort');
	});
});

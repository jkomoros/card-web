/* eslint-env node, mocha, es2022 */

//The ≥1000-card prime from empty filters has its own card-major bitset
//path; the incremental path produces the same memberships, only ~1.6x
//slower at 12k. Every other test passes with the prime path deleted, so
//this one asserts the path is TAKEN (its perf counter) and that the one
//input it cannot take — duplicate ids — falls back instead of throwing.

import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

describe('card-filter prime path', () => {
	const run = () => {
		const result = spawnSync(process.execPath, [new URL('./fixtures/prime-path.fixture.js', import.meta.url).pathname], {encoding: 'utf8', timeout: 30000});
		assert.equal(result.status, 0, result.stdout + result.stderr);
		return JSON.parse(result.stdout.trim().split('\n').pop());
	};

	it('a ≥1000-card update onto empty filters takes the prime path; later updates do not', () => {
		const result = run();
		assert.equal(result.afterPrime, 1, 'the prime path was taken');
		assert.equal(result.publishedCount, 600);
		assert.equal(result.afterSecondLargeUpdate, 1, 'a large update onto populated filters is incremental');
		assert.equal(result.secondUpdateApplied, true);
	});

	it('duplicate card ids in a large batch fall back to the incremental path instead of throwing', () => {
		const result = run();
		assert.equal(result.dupPrimeCount, 0, 'the prime path was not taken');
		assert.equal(result.dupHasC5, true);
		assert.equal(result.dupContentSize, 1200);
	});
});

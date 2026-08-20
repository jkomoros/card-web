/*eslint-env node, es2022*/

//Pins the #749 fix: makeExtrasForFilterFunc no longer pins corpora. The
//plain memoize(fn, 3) held its last three argument tuples STRONGLY — args
//including the whole processed cards map — so the last three distinct
//extras each pinned a corpus (measured on the issue: 51.0 → 30.6 MB freed
//by flushing the memo), and #744's weak-keying of the downstream
//configurable-filter cache delivered zero net benefit. The memo is now
//weakly keyed on the cards map itself.

import assert from 'assert';

import {spawnSync} from 'child_process';

let memoizeWeakFirstArg;

describe('memoizeWeakFirstArg (#749)', () => {
	before(async () => {
		({memoizeWeakFirstArg} = await import('../../lib/src/memoize.js'));
	});

	it('returns an identical result for identical calls (identity is the contract)', () => {
		//Downstream caches key on the RESULT identity of the memoized
		//function; a fresh object per call would bust them every run.
		let calls = 0;
		const fn = memoizeWeakFirstArg((first, second) => {
			calls++;
			return {first, second};
		});
		const key = {corpus: true};
		const a = fn(key, 'x');
		const b = fn(key, 'x');
		assert.strictEqual(a, b);
		assert.strictEqual(calls, 1);
	});

	it('keeps several distinct rest-tuples per key, with recency-refresh eviction', () => {
		let calls = 0;
		const fn = memoizeWeakFirstArg((first, second) => {
			calls++;
			return {first, second};
		}, 2);
		const key = {corpus: true};
		const a = fn(key, 'a');
		fn(key, 'b');
		//'a' is refreshed to most-recent, so adding 'c' evicts 'b', not 'a'.
		assert.strictEqual(fn(key, 'a'), a);
		fn(key, 'c');
		assert.strictEqual(fn(key, 'a'), a, 'the recently-used tuple must survive eviction');
		assert.strictEqual(calls, 3, 'a, b, c computed; the two a-hits were cached');
		fn(key, 'b');
		assert.strictEqual(calls, 4, 'b was evicted by c and recomputes');
	});

	it('keys are independent', () => {
		const fn = memoizeWeakFirstArg((first, second) => ({first, second}));
		const keyA = {a: true};
		const keyB = {b: true};
		assert.notStrictEqual(fn(keyA, 'x'), fn(keyB, 'x'));
		assert.strictEqual(fn(keyA, 'x'), fn(keyA, 'x'));
	});
});

describe('the extras memo no longer pins a dropped corpus (#749)', () => {
	//The real assertion runs in a child with --expose-gc, because
	//WeakRef.deref() keeps its target alive for the rest of the current
	//job — a synchronous drop-then-check falsely reports "reachable" (the
	//issue documents the trap), so GC must be forced between macrotasks.
	//Non-vacuousness was verified by swapping the compiled helper back to
	//the strong memoize: the probe then prints 'retained'.
	it('a real collection run through a corpus leaves it collectible once dropped', function() {
		this.timeout(30000);
		//timeout is load-bearing: spawnSync is synchronous, so mocha's own
		//timeout cannot fire while the child runs — without this a wedged
		//probe hangs the whole test process rather than failing in bounds.
		const result = spawnSync(process.execPath, ['--expose-gc', new URL('../harness-support/gc-probe-749.mjs', import.meta.url).pathname], {encoding: 'utf8', timeout: 20000});
		assert.strictEqual(result.status, 0, `probe failed: ${result.stderr}`);
		const verdict = result.stdout.trim().split('\n').pop();
		assert.strictEqual(verdict, 'collected',
			'the processed cards map must be collectible after every app-side reference is dropped');
	});
});

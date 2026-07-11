/*eslint-env node*/

//Tests for the cold-sweep adaptive pacing math (replaced the daily budget:
//FAST COLD BOOT directive).

import assert from 'assert';

let initialPaceState;
let concurrencyForPace;
let paceOnThrottle;
let paceOnCleanPage;
let throttleBackoffMs;
let isResourceExhausted;
let CONCURRENCY_LADDER;
let CLEAN_PAGES_TO_RESTORE;
let THROTTLE_BACKOFF_MAX_MS;

describe('cold-pace', () => {
	before(async () => {
		({
			initialPaceState,
			concurrencyForPace,
			paceOnThrottle,
			paceOnCleanPage,
			throttleBackoffMs,
			isResourceExhausted,
			CONCURRENCY_LADDER,
			CLEAN_PAGES_TO_RESTORE,
			THROTTLE_BACKOFF_MAX_MS
		} = await import('../../lib/src/worker/cold-pace.js'));
	});

	it('starts at full parallelism', () => {
		assert.strictEqual(concurrencyForPace(initialPaceState()), CONCURRENCY_LADDER[0]);
	});

	it('each throttle halves down the ladder and pins at the bottom', () => {
		let state = initialPaceState();
		const seen = [concurrencyForPace(state)];
		for (let i = 0; i < CONCURRENCY_LADDER.length + 2; i++) {
			state = paceOnThrottle(state);
			seen.push(concurrencyForPace(state));
		}
		assert.deepStrictEqual(seen.slice(0, CONCURRENCY_LADDER.length), CONCURRENCY_LADDER);
		//Pinned at the bottom rung, never below.
		assert.strictEqual(seen[seen.length - 1], CONCURRENCY_LADDER[CONCURRENCY_LADDER.length - 1]);
	});

	it('a run of clean pages restores one rung at a time', () => {
		let state = paceOnThrottle(paceOnThrottle(initialPaceState())); //rung 2
		for (let i = 0; i < CLEAN_PAGES_TO_RESTORE - 1; i++) {
			state = paceOnCleanPage(state);
			assert.strictEqual(state.rung, 2, `restored early at clean page ${i + 1}`);
		}
		state = paceOnCleanPage(state);
		assert.strictEqual(state.rung, 1);
		//The counter reset: another full run is needed for the next rung.
		for (let i = 0; i < CLEAN_PAGES_TO_RESTORE - 1; i++) state = paceOnCleanPage(state);
		assert.strictEqual(state.rung, 1);
		state = paceOnCleanPage(state);
		assert.strictEqual(state.rung, 0);
	});

	it('at full parallelism clean pages are a no-op on the rung', () => {
		let state = initialPaceState();
		for (let i = 0; i < CLEAN_PAGES_TO_RESTORE * 2; i++) state = paceOnCleanPage(state);
		assert.strictEqual(state.rung, 0);
	});

	it('a throttle resets restore progress', () => {
		let state = paceOnThrottle(initialPaceState()); //rung 1
		for (let i = 0; i < CLEAN_PAGES_TO_RESTORE - 1; i++) state = paceOnCleanPage(state);
		state = paceOnThrottle(state); //rung 2, progress gone
		assert.strictEqual(state.rung, 2);
		assert.strictEqual(state.cleanPages, 0);
	});

	it('backoff doubles per consecutive throttle and caps', () => {
		assert.strictEqual(throttleBackoffMs(1), 1000);
		assert.strictEqual(throttleBackoffMs(2), 2000);
		assert.strictEqual(throttleBackoffMs(3), 4000);
		assert.strictEqual(throttleBackoffMs(100), THROTTLE_BACKOFF_MAX_MS);
	});

	it('a clean page resets the consecutive-throttle exponent', () => {
		let state = paceOnThrottle(paceOnThrottle(initialPaceState()));
		assert.strictEqual(state.consecutiveThrottles, 2);
		state = paceOnCleanPage(state);
		assert.strictEqual(state.consecutiveThrottles, 0);
	});

	it('recognizes resource-exhausted in code and message shapes', () => {
		assert.strictEqual(isResourceExhausted({code: 'resource-exhausted'}), true);
		assert.strictEqual(isResourceExhausted({code: 'firestore/resource-exhausted'}), true);
		assert.strictEqual(isResourceExhausted(new Error('FirebaseError: [code=resource-exhausted]: Quota exceeded.')), true);
		assert.strictEqual(isResourceExhausted({code: 'unavailable'}), false);
		assert.strictEqual(isResourceExhausted(new Error('deadline exceeded')), false);
		assert.strictEqual(isResourceExhausted(null), false);
		assert.strictEqual(isResourceExhausted(undefined), false);
	});
});

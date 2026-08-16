/*eslint-env node*/

//Tests for the corpus worker's retry helper.

import assert from 'assert';

let retryWithBackoff;

describe('retryWithBackoff', () => {
	before(async () => {
		({retryWithBackoff} = await import('../../lib/src/worker/retry.js'));
	});

	it('returns the first successful result without retrying', async () => {
		let calls = 0;
		const result = await retryWithBackoff(async () => {
			calls++;
			return 'ok';
		}, {baseDelayMs: 1});
		assert.strictEqual(result, 'ok');
		assert.strictEqual(calls, 1);
	});

	it('retries failures until success', async () => {
		let calls = 0;
		const retries = [];
		const result = await retryWithBackoff(async () => {
			calls++;
			if (calls < 3) throw new Error('flaky ' + calls);
			return 'recovered';
		}, {baseDelayMs: 1, onRetry: (error, attempt, delayMs) => retries.push({attempt, delayMs})});
		assert.strictEqual(result, 'recovered');
		assert.strictEqual(calls, 3);
		assert.strictEqual(retries.length, 2);
		//Backoff doubles.
		assert.strictEqual(retries[0].delayMs, 1);
		assert.strictEqual(retries[1].delayMs, 2);
	});

	it('throws the last error once attempts are exhausted', async () => {
		let calls = 0;
		await assert.rejects(retryWithBackoff(async () => {
			calls++;
			throw new Error('always failing ' + calls);
		}, {attempts: 3, baseDelayMs: 1}), /always failing 3/);
		assert.strictEqual(calls, 3);
	});

	it('stops when shouldContinue flips false', async () => {
		let calls = 0;
		let alive = true;
		await assert.rejects(retryWithBackoff(async () => {
			calls++;
			alive = false;
			throw new Error('stale generation');
		}, {attempts: 5, baseDelayMs: 1, shouldContinue: () => alive}), /stale generation/);
		//One real attempt; the retry loop aborts at the next liveness check.
		assert.strictEqual(calls, 1);
	});

	it('caps the backoff delay at maxDelayMs', async () => {
		let calls = 0;
		const delays = [];
		await retryWithBackoff(async () => {
			calls++;
			if (calls < 5) throw new Error('flaky');
			return 'done';
		}, {attempts: 5, baseDelayMs: 2, maxDelayMs: 4, onRetry: (error, attempt, delayMs) => delays.push(delayMs)});
		assert.deepStrictEqual(delays, [2, 4, 4, 4]);
	});
});

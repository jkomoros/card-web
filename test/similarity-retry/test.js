import assert from 'node:assert/strict';
const flush = () => new Promise(resolve => setImmediate(resolve));

let SimilarityRetryCoordinator;

const harness = (options = {}) => {
	let now = 0;
	let nextTimer = 1;
	const timers = new Map();
	const cancelled = [];
	const retries = [];
	const coordinator = new SimilarityRetryCoordinator({
		baseDelayMs: 10,
		maxDelayMs: 25,
		maxPending: options.maxPending ?? 8,
		maxConcurrent: options.maxConcurrent ?? options.maxPending ?? 8,
		now: () => now++,
		random: () => 0.5,
		schedule: (callback, delayMs) => {
			const id = nextTimer++;
			timers.set(id, {callback, delayMs});
			return id;
		},
		cancelTimer: id => {
			cancelled.push(id);
			timers.delete(id);
		},
		onRetry: (key, attempt, delayMs) => retries.push({key, attempt, delayMs})
	});
	const fireNext = async () => {
		const item = timers.entries().next().value;
		assert.ok(item, 'expected a pending timer');
		const [id, timer] = item;
		timers.delete(id);
		timer.callback();
		await flush();
	};
	return {coordinator, timers, cancelled, retries, fireNext};
};

describe('SimilarityRetryCoordinator', () => {
	before(async () => {
		({SimilarityRetryCoordinator} = await import('../../lib/src/similarity-retry.js'));
	});
	it('coalesces the same card version and backs off with a cap', async () => {
		const h = harness();
		let calls = 0;
		const run = async () => {
			calls++;
			return calls < 4 ? 'retry' : 'done';
		};
		assert.equal(h.coordinator.request('card', 7, run), true);
		assert.equal(h.coordinator.request('card', 7, run), false);
		await flush();
		assert.equal(calls, 1);
		assert.deepEqual(h.retries.map(item => item.delayMs), [10]);
		await h.fireNext();
		await h.fireNext();
		await h.fireNext();
		assert.equal(calls, 4);
		assert.deepEqual(h.retries.map(item => item.delayMs), [10, 20, 25]);
		assert.equal(h.coordinator.pendingCount, 0);
	});

	it('cancels an older card version and exposes cancellation to an in-flight run', async () => {
		const h = harness();
		let release;
		let oldWasCurrent = true;
		const oldRun = async (_attempt, isCurrent) => {
			await new Promise(resolve => { release = resolve; });
			oldWasCurrent = isCurrent();
			return 'done';
		};
		h.coordinator.request('card', 1, oldRun);
		await flush();
		h.coordinator.request('card', 2, async () => 'done');
		release();
		await flush();
		assert.equal(oldWasCurrent, false);
		assert.equal(h.coordinator.pendingCount, 0);
	});

	it('bounds navigation leftovers by cancelling the least recently demanded key', async () => {
		const h = harness({maxPending: 2});
		const retry = async () => 'retry';
		h.coordinator.request('old', 1, retry);
		h.coordinator.request('kept', 1, retry);
		await flush();
		assert.equal(h.coordinator.pendingCount, 2);
		h.coordinator.request('new', 1, retry);
		await flush();
		assert.equal(h.coordinator.pendingCount, 2);
		assert.equal(h.cancelled.length, 1);
		assert.equal(h.coordinator.request('kept', 1, retry), false);
		assert.equal(h.coordinator.request('old', 1, retry), true);
	});

	it('never exceeds the active-run limit while newer requests queue', async () => {
		const h = harness({maxPending: 8, maxConcurrent: 2});
		const releases = [];
		let active = 0;
		let maxActive = 0;
		const run = async () => {
			active++;
			maxActive = Math.max(maxActive, active);
			await new Promise(resolve => releases.push(resolve));
			active--;
			return 'done';
		};
		for (const key of ['a', 'b', 'c', 'd']) h.coordinator.request(key, 1, run);
		await flush();
		assert.equal(releases.length, 2);
		assert.equal(h.coordinator.activeCount, 2);
		releases.shift()();
		await flush();
		assert.equal(releases.length, 2, 'one queued request should replace the completed run');
		assert.equal(h.coordinator.activeCount, 2);
		releases.shift()();
		await flush();
		assert.equal(releases.length, 2);
		while (releases.length) {
			releases.shift()();
			await flush();
		}
		assert.equal(maxActive, 2);
		assert.equal(h.coordinator.activeCount, 0);
		assert.equal(h.coordinator.pendingCount, 0);
	});

	it('keeps a cancelled in-flight run in its concurrency slot until it settles', async () => {
		const h = harness({maxPending: 2, maxConcurrent: 1});
		let releaseOld;
		let releaseNew;
		const started = [];
		h.coordinator.request('old', 1, async () => {
			started.push('old');
			await new Promise(resolve => { releaseOld = resolve; });
			return 'done';
		});
		h.coordinator.request('queued', 1, async () => {
			started.push('queued');
			return 'done';
		});
		//This evicts the least-recently-demanded entry (`old`), but its
		//uncancellable Firebase request must continue to occupy the only slot.
		h.coordinator.request('new', 1, async () => {
			started.push('new');
			await new Promise(resolve => { releaseNew = resolve; });
			return 'done';
		});
		await flush();
		assert.deepEqual(started, ['old']);
		assert.equal(h.coordinator.activeCount, 1);
		releaseOld();
		await flush();
		assert.deepEqual(started, ['old', 'new']);
		assert.ok(h.coordinator.activeCount <= 1);
		releaseNew();
		await flush();
		assert.deepEqual(started, ['old', 'new', 'queued']);
		assert.equal(h.coordinator.activeCount, 0);
	});

	it('cleans up unexpected exceptions without retrying or leaking', async () => {
		const h = harness();
		const originalWarn = console.warn;
		console.warn = () => {};
		try {
			h.coordinator.request('card', 1, async () => { throw new Error('boom'); });
			await flush();
			assert.equal(h.coordinator.pendingCount, 0);
			assert.equal(h.timers.size, 0);
		} finally {
			console.warn = originalWarn;
		}
	});
});

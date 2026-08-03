/*eslint-env node*/

//The star/read/reading-list toggles never applied anything locally: the UI was
//painted entirely by the Firestore listener echo, which was instant only because
//the write and the listener shared one Firestore instance. Those listeners now
//live in the CORPUS WORKER -- the only context with a persistent cache, so its
//re-attach bills deltas instead of the whole result set -- and that instance
//knows nothing about the main thread's pending write.
//
//So the optimistic layer is not a nicety here; without it every toggle would
//wait for a server round trip before visibly doing anything.
//
//The subtle rule, and the reason this file exists: 'queued' must NOT revert. A
//queued intent is durable and will be retried, which is exactly what the UI
//promises the user -- reverting it would silently undo an action taken offline.

import assert from 'assert';
//actions/user.js reaches the browser globals at import time (via the store and
//firebase), so it needs the same jsdom shim the other thunk-layer suites use.
import {bootstrapApp} from '../harness-support/app-harness.js';

let applyOptimistically;

describe('optimistic per-user state updates', () => {
	before(async () => {
		await bootstrapApp();
		({applyOptimistically} = await import('../../lib/src/actions/user.js'));
	});

	const run = async (outcome) => {
		const events = [];
		await applyOptimistically(
			() => events.push('apply'),
			() => events.push('revert'),
			async () => {
				events.push('write');
				if (outcome === 'throw') throw new Error('write blew up');
				return outcome;
			});
		return events;
	};

	it('applies BEFORE the write is attempted', async () => {
		//Applying after the await would reintroduce exactly the latency this
		//exists to remove.
		assert.deepEqual(await run('committed'), ['apply', 'write']);
	});

	it('keeps the update when the write is QUEUED', async () => {
		//THE ONE THAT MATTERS. A queued intent is durable and will be retried,
		//so the optimistic state is the truth the user was promised. Reverting
		//here would silently undo an action taken offline.
		assert.deepEqual(await run('queued'), ['apply', 'write']);
	});

	it('reverts when the write is DISCARDED', async () => {
		//Permanent failure: the write is gone, so the UI must stop claiming it.
		assert.deepEqual(await run('discarded'), ['apply', 'write', 'revert']);
	});

	it('reverts when the write throws', async () => {
		//We cannot promise it landed. If it threw before persisting, reverting
		//is right; if it threw after, the queue replays it and the echo
		//re-applies -- the stars/reads reducers are set-based, so that is a
		//no-op rather than a double-apply.
		assert.deepEqual(await run('throw'), ['apply', 'write', 'revert']);
	});
});

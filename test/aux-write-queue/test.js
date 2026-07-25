/*eslint-env node*/

//Behavioral tests for the durable auxiliary-write queue (stars/reads/
//reading-list offline durability). Runs in Node with a localStorage shim.

import assert from 'assert';

//Minimal localStorage for the module under test.
const storage = new Map();
globalThis.localStorage = {
	getItem: (key) => storage.has(key) ? storage.get(key) : null,
	setItem: (key, value) => storage.set(key, String(value)),
	removeItem: (key) => storage.delete(key),
};

let queue;

describe('aux write queue', () => {
	before(async () => {
		queue = await import('../../lib/src/aux-write-queue.js');
	});

	beforeEach(() => {
		storage.clear();
		queue.resetAuxWriteQueueForTesting();
	});

	it('clears the intent on server ack and keeps it on transient failure', async () => {
		const attempts = [];
		queue.registerAuxWriteExecutor('star-add', async (intent) => { attempts.push(intent.cardID); });
		queue.registerAuxWriteExecutor('read-add', async () => { throw new Error('offline'); });
		await queue.runDurableAuxWrite(queue.makeAuxWriteIntent('u1', 'star-add', 'cardA'));
		assert.deepStrictEqual(queue.readPendingAuxWrites(), [], 'acked intent must clear');
		await queue.runDurableAuxWrite(queue.makeAuxWriteIntent('u1', 'read-add', 'cardB'));
		const pending = queue.readPendingAuxWrites();
		assert.strictEqual(pending.length, 1, 'unacked intent must survive');
		assert.strictEqual(pending[0].cardID, 'cardB');
		assert.deepStrictEqual(attempts, ['cardA']);
	});

	it('drops permanently-failing intents instead of retrying forever', async () => {
		queue.registerAuxWriteExecutor('star-add', async () => {
			const error = new Error('nope');
			error.code = 'permission-denied';
			throw error;
		});
		await queue.runDurableAuxWrite(queue.makeAuxWriteIntent('u1', 'star-add', 'cardA'));
		assert.deepStrictEqual(queue.readPendingAuxWrites(), []);
	});

	it('replays survivors strictly in order, with the replay flag, for the right uid only', async () => {
		const replayed = [];
		queue.registerAuxWriteExecutor('star-add', async (intent, isReplay) => {
			if (!isReplay) throw new Error('offline');
			replayed.push('add:' + intent.cardID);
		});
		queue.registerAuxWriteExecutor('star-remove', async (intent, isReplay) => {
			if (!isReplay) throw new Error('offline');
			replayed.push('remove:' + intent.cardID);
		});
		await queue.runDurableAuxWrite(queue.makeAuxWriteIntent('u1', 'star-add', 'cardA'));
		await queue.runDurableAuxWrite(queue.makeAuxWriteIntent('u2', 'star-add', 'other'));
		await queue.runDurableAuxWrite(queue.makeAuxWriteIntent('u1', 'star-remove', 'cardA'));
		assert.strictEqual(queue.readPendingAuxWrites().length, 3);
		await queue.replayPendingAuxWrites('u1');
		//The offline star-then-unstar pair replays add THEN remove (net
		//correct); the other uid's intent is untouched.
		assert.deepStrictEqual(replayed, ['add:cardA', 'remove:cardA']);
		const remaining = queue.readPendingAuxWrites();
		assert.strictEqual(remaining.length, 1);
		assert.strictEqual(remaining[0].uid, 'u2');
	});

	it('stops replay at the first transient failure, preserving order', async () => {
		const replayed = [];
		let failFirst = true;
		queue.registerAuxWriteExecutor('read-add', async (intent) => {
			if (failFirst && intent.cardID === 'first') { throw new Error('offline again'); }
			replayed.push(intent.cardID);
		});
		await queue.runDurableAuxWrite(queue.makeAuxWriteIntent('u1', 'read-add', 'first')).catch(() => {});
		failFirst = true;
		// simulate: both failed initially
		queue.registerAuxWriteExecutor('read-add', async (intent) => { throw new Error('offline'); });
		await queue.runDurableAuxWrite(queue.makeAuxWriteIntent('u1', 'read-add', 'second'));
		// now first fails on replay, second must NOT run
		queue.registerAuxWriteExecutor('read-add', async (intent) => {
			if (intent.cardID === 'first') throw new Error('offline again');
			replayed.push(intent.cardID);
		});
		await queue.replayPendingAuxWrites('u1');
		assert.deepStrictEqual(replayed, [], 'nothing after the first failure may run');
		assert.strictEqual(queue.readPendingAuxWrites().length, 2, 'both intents retained in order');
	});

	it('reading-list intents carry the original audit key for idempotent replay', () => {
		const intent = queue.makeAuxWriteIntent('u1', 'reading-list-add', 'cardA', '1234567');
		assert.strictEqual(intent.auditKey, '1234567');
	});

	it('survives a corrupt storage record without wedging', async () => {
		storage.set('card-web-pending-aux-writes-v1', '{not json');
		assert.deepStrictEqual(queue.readPendingAuxWrites(), []);
		queue.registerAuxWriteExecutor('star-add', async () => {});
		await queue.runDurableAuxWrite(queue.makeAuxWriteIntent('u1', 'star-add', 'cardA'));
		assert.deepStrictEqual(queue.readPendingAuxWrites(), []);
	});
});

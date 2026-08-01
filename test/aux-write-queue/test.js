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

	//--- C18: card creation and comments ------------------------------------

	it('round-trips a card-create plan through storage', async () => {
		const persisted = [];
		queue.registerAuxWriteExecutor('card-create', async (intent) => { persisted.push(intent); throw new Error('offline'); });
		await queue.runDurableAuxWrite(queue.makeAuxWriteIntent('u1', 'card-create', 'card-new', '', {
			kind: 'card-create',
			card: {id: 'card-new', title: 'hi', created: {seconds: 5, nanoseconds: 0}},
			section: 'stubs',
			sectionUpdateKey: '1700000000000',
		}));
		//Survives the failure AND survives re-reading from storage: a plan that
		//does not validate is silently dropped, which would lose the card.
		const survivors = queue.readPendingAuxWrites();
		assert.equal(survivors.length, 1, 'card-create intent must survive a transient failure');
		assert.equal(survivors[0].payload.kind, 'card-create');
		assert.equal(survivors[0].payload.section, 'stubs');
		assert.equal(survivors[0].payload.sectionUpdateKey, '1700000000000',
			'the captured audit key must survive, or a replay writes a SECOND audit entry');
		assert.equal(survivors[0].payload.card.title, 'hi');
	});

	it('round-trips a comment-add plan and preserves the message text', async () => {
		queue.registerAuxWriteExecutor('comment-add', async () => { throw new Error('offline'); });
		await queue.runDurableAuxWrite(queue.makeAuxWriteIntent('u1', 'comment-add', 'cardA', '', {
			kind: 'comment-add',
			messageID: 'msg1',
			threadID: 'thread1',
			message: 'a comment with / and .. in the TEXT',
			newThread: true,
		}));
		const survivors = queue.readPendingAuxWrites();
		assert.equal(survivors.length, 1);
		assert.equal(survivors[0].payload.message, 'a comment with / and .. in the TEXT',
			'message text is content, not a path, and must not be path-validated away');
		assert.equal(survivors[0].payload.newThread, true);
	});

	it('rejects payload-bearing kinds whose plan is missing or malformed', () => {
		const cases = [
			{kind: 'card-create', payload: undefined, why: 'missing plan'},
			{kind: 'card-create', payload: {kind: 'comment-add', messageID: 'm', threadID: 't', message: '', newThread: false}, why: 'plan for a different kind'},
			{kind: 'card-create', payload: {kind: 'card-create', card: {}, section: 'a/b', sectionUpdateKey: ''}, why: 'section with a path separator'},
			{kind: 'comment-add', payload: {kind: 'comment-add', messageID: '../evil', threadID: 't', message: '', newThread: false}, why: 'id escaping its collection'},
			{kind: 'comment-add', payload: {kind: 'comment-add', messageID: 'm', threadID: 't', message: 5, newThread: false}, why: 'non-string message'},
		];
		for (const {kind, payload, why} of cases) {
			storage.clear();
			const intent = {version: 1, id: 'i1', uid: 'u1', kind, cardID: 'cardA', auditKey: '', createdAt: Date.now()};
			if (payload !== undefined) intent.payload = payload;
			globalThis.localStorage.setItem('card-web-pending-aux-writes-v1', JSON.stringify([intent]));
			assert.deepEqual(queue.readPendingAuxWrites(), [], `must reject: ${why}`);
		}
	});

	it('keeps the original six kinds valid without a payload', () => {
		const intent = {version: 1, id: 'i1', uid: 'u1', kind: 'star-add', cardID: 'cardA', auditKey: '', createdAt: Date.now()};
		globalThis.localStorage.setItem('card-web-pending-aux-writes-v1', JSON.stringify([intent]));
		assert.equal(queue.readPendingAuxWrites().length, 1,
			'records persisted before payloads existed must still load');
	});

	it('tells a card-create executor when it is a replay, so it can preflight', async () => {
		const flags = [];
		queue.registerAuxWriteExecutor('card-create', async (intent, isReplay) => {
			flags.push(isReplay);
			if (!isReplay) throw new Error('offline');
		});
		const payload = {kind: 'card-create', card: {id: 'c'}, section: '', sectionUpdateKey: ''};
		await queue.runDurableAuxWrite(queue.makeAuxWriteIntent('u1', 'card-create', 'c', '', payload));
		assert.deepEqual(flags, [false]);
		await queue.replayPendingAuxWrites('u1');
		assert.deepEqual(flags, [false, true], 'replay must be flagged, or the executor cannot preflight');
		assert.deepEqual(queue.readPendingAuxWrites(), [], 'a successful replay clears the intent');
	});

	it('reports which of the three outcomes actually happened', async () => {
		queue.registerAuxWriteExecutor('card-create', async () => {});
		const payload = {kind: 'card-create', card: {id: 'c'}, section: '', sectionUpdateKey: ''};
		assert.equal(await queue.runDurableAuxWrite(queue.makeAuxWriteIntent('u1', 'card-create', 'c', '', payload)), 'committed');

		queue.registerAuxWriteExecutor('card-create', async () => { throw new Error('offline'); });
		assert.equal(await queue.runDurableAuxWrite(queue.makeAuxWriteIntent('u1', 'card-create', 'c2', '', payload)), 'queued');

		queue.registerAuxWriteExecutor('card-create', async () => {
			const err = new Error('nope'); err.code = 'permission-denied'; throw err;
		});
		//A discarded creation must NOT look like a committed one: the caller
		//goes on to wait for the card to exist and chase an auto-slug.
		assert.equal(await queue.runDurableAuxWrite(queue.makeAuxWriteIntent('u1', 'card-create', 'c3', '', payload)), 'discarded');
	});

	it('survives a corrupt storage record without wedging', async () => {
		storage.set('card-web-pending-aux-writes-v1', '{not json');
		assert.deepStrictEqual(queue.readPendingAuxWrites(), []);
		queue.registerAuxWriteExecutor('star-add', async () => {});
		await queue.runDurableAuxWrite(queue.makeAuxWriteIntent('u1', 'star-add', 'cardA'));
		assert.deepStrictEqual(queue.readPendingAuxWrites(), []);
	});

	//Regression: a live claim held by another tab must STOP the replay for that
	//uid, not cause it to skip ahead. Skipping let a star-remove execute while
	//the matching star-add was still owned elsewhere; the remove no-ops against
	//an absent star, the add then lands, and the card ends up starred — the
	//opposite of the user's last action.
	it('stops at a head intent claimed by another tab rather than reordering', async () => {
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
		await queue.runDurableAuxWrite(queue.makeAuxWriteIntent('u1', 'star-remove', 'cardA'));

		//Simulate a sibling tab holding a fresh claim on the HEAD intent.
		const pending = queue.readPendingAuxWrites();
		assert.strictEqual(pending.length, 2);
		const claimed = pending.map((intent, index) => index === 0
			? {...intent, claimedBy: 'some-other-tab', claimedAt: Date.now()}
			: intent);
		globalThis.localStorage.setItem('card-web-pending-aux-writes-v1', JSON.stringify(claimed));

		await queue.replayPendingAuxWrites('u1');
		assert.deepStrictEqual(replayed, [],
			'the remove must NOT run ahead of the add that another tab owns');
		assert.strictEqual(queue.readPendingAuxWrites().length, 2, 'both intents survive for the next replay');
	});
});

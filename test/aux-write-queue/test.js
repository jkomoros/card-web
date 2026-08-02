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

	it('replays survivors when a late-loading module registers their executor', async () => {
		//The regression this guards: card-create/comment-add executors live in
		//modules that are not loaded when boot replay runs, so replay skipped
		//them and NOTHING re-triggered it — the intent survived every boot and
		//never executed. Registration must itself be a trigger.
		const payload = {kind: 'card-create', card: {id: 'c'}, section: '', sectionUpdateKey: ''};
		//Persist an intent whose executor then goes away, exactly as it is on a
		//fresh boot before actions/data.js has been imported.
		queue.registerAuxWriteExecutor('card-create', async () => { throw new Error('offline'); });
		await queue.runDurableAuxWrite(queue.makeAuxWriteIntent('u1', 'card-create', 'c', '', payload));
		assert.equal(queue.readPendingAuxWrites().length, 1);

		queue.resetAuxWriteQueueForTesting();
		await queue.replayPendingAuxWrites('u1');
		assert.equal(queue.readPendingAuxWrites().length, 1, 'no executor: the intent must be retained, not dropped');

		const ran = [];
		//The uid provider is what a resolved auth install leaves behind.
		queue.installAuxWriteReplayWatcher(() => 'u1');
		queue.registerAuxWriteExecutor('card-create', async (intent) => { ran.push(intent.cardID); });
		//Registration alone must drain it, with no other trigger. The wait
		//covers the queue's deferred retry: installing the watcher starts its
		//own replay, so a replay requested while one is running is rescheduled
		//rather than run concurrently.
		await new Promise(resolve => setTimeout(resolve, 600));
		assert.deepEqual(ran, ['c'], 'registering the executor must replay its waiting intents');
		assert.deepEqual(queue.readPendingAuxWrites(), []);
	});

	it('reports queued rather than hanging when a write never settles', async () => {
		//A Firestore commit on the memory-only main-thread cache neither
		//resolves nor rejects while offline. Awaiting it forever meant the
		//caller never learned the write had not landed, and the intent stayed
		//in-flight where replay skips it — permanently.
		queue.setAuxWriteAttemptTimeoutForTesting(30);
		queue.registerAuxWriteExecutor('card-create', () => new Promise(() => {}));
		const payload = {kind: 'card-create', card: {id: 'c'}, section: '', sectionUpdateKey: ''};
		const outcome = await queue.runDurableAuxWrite(queue.makeAuxWriteIntent('u1', 'card-create', 'c', '', payload));
		assert.equal(outcome, 'queued', 'a write that never settles must report queued, not hang');
		assert.equal(queue.readPendingAuxWrites().length, 1, 'and it must stay persisted');

		//It must also be replayable — the whole point is that a later trigger
		//can pick it up.
		const ran = [];
		queue.registerAuxWriteExecutor('card-create', async (intent) => { ran.push(intent.cardID); });
		await queue.replayPendingAuxWrites('u1');
		assert.deepEqual(ran, ['c'], 'a stranded attempt must not block replay forever');
	});

	it('quarantines an unreadable queue instead of erasing it', async () => {
		globalThis.localStorage.setItem('card-web-pending-aux-writes-v1', '{not json');
		assert.deepEqual(queue.readPendingAuxWrites(), []);
		const quarantined = [...storage.keys()].filter(k => k.includes('-corrupt-'));
		assert.equal(quarantined.length, 1, 'the raw blob must be recoverable, not discarded');
		assert.equal(storage.get(quarantined[0]), '{not json');
	});

	it('refuses to report a high-value write as durable when it could not be persisted', async () => {
		const realSet = globalThis.localStorage.setItem;
		globalThis.localStorage.setItem = () => { throw new Error('QuotaExceededError'); };
		queue.registerAuxWriteExecutor('card-create', async () => {});
		const payload = {kind: 'card-create', card: {id: 'c'}, section: '', sectionUpdateKey: ''};
		await assert.rejects(
			queue.runDurableAuxWrite(queue.makeAuxWriteIntent('u1', 'card-create', 'c', '', payload)),
			/could not be saved locally/,
			'a creation that was never persisted must not be reported as durable');
		//A best-effort kind still degrades to session-only rather than failing.
		queue.registerAuxWriteExecutor('star-add', async () => {});
		assert.equal(await queue.runDurableAuxWrite(queue.makeAuxWriteIntent('u1', 'star-add', 'c')), 'committed');
		globalThis.localStorage.setItem = realSet;
	});

	it('persists a whole group before attempting any of it', async () => {
		let attempted = 0;
		let seenAtFirstAttempt = -1;
		queue.registerAuxWriteExecutor('card-create', async () => {
			if (attempted++ === 0) seenAtFirstAttempt = queue.readPendingAuxWrites().length;
			await new Promise(resolve => setTimeout(resolve, 1));
		});
		const payload = i => ({kind: 'card-create', card: {id: 'c' + i}, section: '', sectionUpdateKey: ''});
		const intents = [0, 1, 2, 3, 4].map(i => queue.makeAuxWriteIntent('u1', 'card-create', 'c' + i, '', payload(i)));
		const outcomes = await queue.runDurableAuxWrites(intents, 2);
		//The regression: intents were persisted one at a time inside each
		//awaited call, so a stall on the first lost every one after it.
		assert.equal(seenAtFirstAttempt, 5, 'all intents must be durable before the first attempt runs');
		assert.deepEqual(outcomes, ['committed', 'committed', 'committed', 'committed', 'committed']);
		assert.deepEqual(queue.readPendingAuxWrites(), []);
	});

	it('refuses an oversized group whole, before persisting any of it', async () => {
		queue.registerAuxWriteExecutor('card-create', async () => {});
		const big = 'x'.repeat(20000);
		const intents = Array.from({length: 90}, (unused, i) => queue.makeAuxWriteIntent('u1', 'card-create', 'c' + i, '', {
			kind: 'card-create', card: {id: 'c' + i, body: big}, section: '', sectionUpdateKey: ''}));
		await assert.rejects(queue.runDurableAuxWrites(intents), /more than can be safely queued/);
		//Not partially populated: the caller's failure path must run with
		//nothing committed, or the user is told it failed while some of it
		//quietly replays later.
		assert.deepEqual(queue.readPendingAuxWrites(), []);
	});

	it('refuses an oversized group by COUNT as well as bytes', async () => {
		queue.registerAuxWriteExecutor('card-create', async () => {});
		const intents = Array.from({length: 300}, (unused, i) => queue.makeAuxWriteIntent('u1', 'card-create', 'c' + i, '', {
			kind: 'card-create', card: {id: 'c' + i}, section: '', sectionUpdateKey: ''}));
		await assert.rejects(queue.runDurableAuxWrites(intents), /300 of a 250 limit/);
		assert.deepEqual(queue.readPendingAuxWrites(), []);
	});

	it('over budget, a best-effort write still degrades to session-only', async () => {
		//Fill past the byte budget with high-value intents.
		queue.registerAuxWriteExecutor('card-create', async () => { throw new Error('offline'); });
		const big = 'x'.repeat(20000);
		for (let i = 0; i < 80; i++) {
			await queue.runDurableAuxWrite(queue.makeAuxWriteIntent('u1', 'card-create', 'c' + i, '', {
				kind: 'card-create', card: {id: 'c' + i, body: big}, section: '', sectionUpdateKey: ''})).catch(() => {});
		}
		//A star must not be refused just because the queue is full of cards —
		//it degrades exactly as it does on quota.
		queue.registerAuxWriteExecutor('star-add', async () => {});
		assert.equal(await queue.runDurableAuxWrite(queue.makeAuxWriteIntent('u1', 'star-add', 'cardA')), 'committed');
		//...while another card IS refused loudly.
		await assert.rejects(queue.runDurableAuxWrite(queue.makeAuxWriteIntent('u1', 'card-create', 'zz', '', {
			kind: 'card-create', card: {id: 'zz', body: big}, section: '', sectionUpdateKey: ''})), /more than can be safely queued/);
	});

	//--- L2b: comment edit and delete ---------------------------------------

	it('validates each payload-bearing kind against its OWN schema', async () => {
		//The regression guard for the implicit-else fallthrough: validPayload
		//used to check anything that was not card-create against comment-add's
		//shape, so a well-formed comment-edit would have failed on the missing
		//threadID/newThread and been silently dropped on the next read.
		queue.registerAuxWriteExecutor('comment-edit', async () => { throw new Error('offline'); });
		await queue.runDurableAuxWrite(queue.makeAuxWriteIntent('u1', 'comment-edit', 'cardA', '', {
			kind: 'comment-edit', messageID: 'm1', message: 'new / text', baseMessage: 'old .. text'}));
		const survivors = queue.readPendingAuxWrites();
		assert.equal(survivors.length, 1, 'a well-formed comment-edit must survive a read');
		assert.equal(survivors[0].payload.message, 'new / text', 'message text is content, not a path');
		assert.equal(survivors[0].payload.baseMessage, 'old .. text', 'the base is the only record of what may be replaced');
	});

	it('rejects malformed comment-edit and comment-delete plans', () => {
		const cases = [
			{kind: 'comment-edit', payload: {kind: 'comment-edit', messageID: '../evil', message: 'a', baseMessage: 'b'}, why: 'id escaping its collection'},
			{kind: 'comment-edit', payload: {kind: 'comment-edit', messageID: 'm', message: 5, baseMessage: 'b'}, why: 'non-string message'},
			{kind: 'comment-edit', payload: {kind: 'comment-edit', messageID: 'm', message: 'a'}, why: 'missing base'},
			{kind: 'comment-edit', payload: {kind: 'comment-add', messageID: 'm', threadID: 't', message: 'a', newThread: false}, why: 'plan for a different kind'},
			{kind: 'comment-delete', payload: {kind: 'comment-delete', messageID: 'm', baseMessage: 7}, why: 'non-string base'},
		];
		for (const {kind, payload, why} of cases) {
			storage.clear();
			const intent = {version: 1, id: 'i1', uid: 'u1', kind, cardID: 'cardA', auditKey: '', payload, createdAt: Date.now()};
			globalThis.localStorage.setItem('card-web-pending-aux-writes-v1', JSON.stringify([intent]));
			assert.deepEqual(queue.readPendingAuxWrites(), [], `must reject: ${why}`);
		}
	});

	it('refuses an unpersistable comment-edit but lets a comment-delete degrade', async () => {
		const realSet = globalThis.localStorage.setItem;
		globalThis.localStorage.setItem = () => { throw new Error('QuotaExceededError'); };
		queue.registerAuxWriteExecutor('comment-edit', async () => {});
		queue.registerAuxWriteExecutor('comment-delete', async () => {});
		//An edit carries text that exists nowhere else, so it must reject and
		//let composeCommit put the words back.
		await assert.rejects(queue.runDurableAuxWrite(queue.makeAuxWriteIntent('u1', 'comment-edit', 'cardA', '', {
			kind: 'comment-edit', messageID: 'm1', message: 'a', baseMessage: 'b'})), /could not be saved locally/);
		//A delete carries nothing typed and is dispatched unawaited — a
		//rejection there would be an unhandled one.
		assert.equal(await queue.runDurableAuxWrite(queue.makeAuxWriteIntent('u1', 'comment-delete', 'cardA', '', {
			kind: 'comment-delete', messageID: 'm1', baseMessage: 'b'})), 'committed');
		globalThis.localStorage.setItem = realSet;
	});

	it('replays an add, an edit and a delete for one message in creation order', async () => {
		const order = [];
		for (const kind of ['comment-add', 'comment-edit', 'comment-delete']) {
			queue.registerAuxWriteExecutor(kind, async (intent) => { order.push(`${intent.kind}:${intent.payload.messageID}`); });
		}
		//An edit applied before its add would be a not-found discard.
		const intents = [
			queue.makeAuxWriteIntent('u1', 'comment-add', 'cardA', '', {kind: 'comment-add', messageID: 'm1', threadID: 't1', message: 'a', newThread: true}),
			queue.makeAuxWriteIntent('u1', 'comment-edit', 'cardA', '', {kind: 'comment-edit', messageID: 'm1', message: 'b', baseMessage: 'a'}),
			queue.makeAuxWriteIntent('u1', 'comment-delete', 'cardA', '', {kind: 'comment-delete', messageID: 'm1', baseMessage: 'b'}),
		];
		globalThis.localStorage.setItem('card-web-pending-aux-writes-v1', JSON.stringify(intents));
		await queue.replayPendingAuxWrites('u1');
		assert.deepEqual(order, ['comment-add:m1', 'comment-edit:m1', 'comment-delete:m1']);
		assert.deepEqual(queue.readPendingAuxWrites(), []);
	});

	it('pendingCommentTextFor reports the text the queue will leave behind', async () => {
		const intents = [
			queue.makeAuxWriteIntent('u1', 'comment-add', 'cardA', '', {kind: 'comment-add', messageID: 'm1', threadID: 't1', message: 'first', newThread: true}),
			queue.makeAuxWriteIntent('u1', 'comment-edit', 'cardA', '', {kind: 'comment-edit', messageID: 'm1', message: 'second', baseMessage: 'first'}),
		];
		globalThis.localStorage.setItem('card-web-pending-aux-writes-v1', JSON.stringify(intents));
		//This is what stops a post-reload second edit from recording a base the
		//first edit has already moved past — Redux still shows the old text.
		assert.equal(queue.pendingCommentTextFor('m1'), 'second');
		assert.equal(queue.pendingCommentTextFor('nope'), null);
		const withDelete = [...intents, queue.makeAuxWriteIntent('u1', 'comment-delete', 'cardA', '', {kind: 'comment-delete', messageID: 'm1', baseMessage: 'second'})];
		globalThis.localStorage.setItem('card-web-pending-aux-writes-v1', JSON.stringify(withDelete));
		assert.equal(queue.pendingCommentTextFor('m1'), '');
	});

	it('discards a conflicting comment-edit and retains a transient one', async () => {
		//The conflict guard throws a CODED error, because permanentFailure()
		//classifies by code only — a codeless throw would replay forever.
		queue.registerAuxWriteExecutor('comment-edit', async () => {
			const err = new Error('changed elsewhere'); err.code = 'failed-precondition'; throw err;
		});
		await queue.runDurableAuxWrite(queue.makeAuxWriteIntent('u1', 'comment-edit', 'cardA', '', {
			kind: 'comment-edit', messageID: 'm1', message: 'a', baseMessage: 'b'}));
		assert.deepEqual(queue.readPendingAuxWrites(), [], 'a conflict is permanent and must be discarded, not retried');

		queue.registerAuxWriteExecutor('comment-edit', async () => { throw new Error('the comment this edit targets has not posted yet'); });
		await queue.runDurableAuxWrite(queue.makeAuxWriteIntent('u1', 'comment-edit', 'cardB', '', {
			kind: 'comment-edit', messageID: 'm2', message: 'a', baseMessage: 'b'}));
		assert.equal(queue.readPendingAuxWrites().length, 1, 'a codeless throw must be retained for the next trigger');
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

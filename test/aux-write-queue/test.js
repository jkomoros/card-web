/*eslint-env node*/

//Behavioral tests for the durable auxiliary-write queue. It started as
//stars/reads/reading-list offline durability, and that is now the smaller half
//of it: the queue also carries card creation and the whole comment
//add/edit/delete family (plan schema validation, conflict discard,
//pendingCommentTextFor), whole-group persistence with an oversize refusal,
//quarantine of unreadable storage, cross-tab head-claim ordering, wedge
//reporting, and queue-depth notifications. Runs in Node with a localStorage
//shim.

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

	//R15-6. A wedged intent is the queue's ONLY way of telling the user that
	//their work is not going through. Reporting was keyed on the failure count
	//being EQUAL to the threshold, so anything that skipped the report at
	//exactly that count silenced it permanently — counts 5, 6, 7 ... never
	//matched again. The offline suppression is exactly such a thing.
	describe('wedge reporting', () => {
		let reports;
		let priorNavigator;
		let priorConsoleError;

		//One intent, retried in place: the failure counter is per intent id, so
		//creating a second intent would both double-count and leave the first
		//one replaying alongside it.
		const failOnce = () => queue.runDurableAuxWrite(queue.makeAuxWriteIntent('u1', 'star-add', 'wedged'));
		const retry = (n = 1) => Promise.all([]).then(async () => {
			for (let i = 0; i < n; i++) await queue.replayPendingAuxWrites('u1');
		});

		beforeEach(() => {
			reports = [];
			priorConsoleError = console.error;
			//Only the WEDGE report counts. The queue logs other things at error
			//level, and counting those made this suite measure the wrong thing.
			console.error = (...args) => {
				const line = args.join(' ');
				if (line.includes('has failed')) reports.push(line);
			};
			priorNavigator = globalThis.navigator;
			globalThis.navigator = {onLine: true};
			queue.registerAuxWriteExecutor('star-add', async () => { throw new Error('the same deterministic bug'); });
		});

		afterEach(() => {
			console.error = priorConsoleError;
			if (priorNavigator === undefined) delete globalThis.navigator;
			else globalThis.navigator = priorNavigator;
		});

		it('reports a repeatedly-failing intent exactly ONCE', async () => {
			await failOnce();
			await retry(2);
			assert.strictEqual(reports.length, 0, 'below the threshold the user is not bothered');
			await retry(1);
			assert.strictEqual(reports.length, 1, 'at the threshold the user is told');
			await retry(3);
			assert.strictEqual(reports.length, 1, 'and is not told again for the same error');
		});

		it('DEFERS the report when offline instead of losing it', async () => {
			//THE REGRESSION. Offline at exactly the threshold used to mean the
			//user was never told at all, however long the intent stayed wedged.
			globalThis.navigator.onLine = false;
			await failOnce();
			await retry(5);
			assert.strictEqual(reports.length, 0, 'an offline user is not told their connection is broken');
			globalThis.navigator.onLine = true;
			await retry(1);
			assert.strictEqual(reports.length, 1,
				'once back online the user MUST be told; the report is deferred, not cancelled');
		});

		it('re-arms for a DIFFERENT error', async () => {
			await failOnce();
			await retry(3);
			assert.strictEqual(reports.length, 1);
			queue.registerAuxWriteExecutor('star-add', async () => { throw new Error('a completely different bug'); });
			await retry(4);
			assert.strictEqual(reports.length, 2, 'a new problem is worth a new report');
		});
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

	it('does not commit a RIVAL copy of an attempt that has not settled', async () => {
		//The attempt timeout drops the intent from `inFlight` on purpose, so a
		//stranded attempt cannot wedge the queue for the session. That also
		//re-opened a double-apply: offline, the SDK has the mutation queued
		//locally and flushes it on reconnect, and the replay triggered by that
		//same `online` event could commit a SECOND copy. star_count and
		//thread_count are increment() fanouts, so a second commit is a
		//permanently wrong count, not a harmless repeat.
		queue.setAuxWriteAttemptTimeoutForTesting(30);
		let commits = 0;
		//Settles AFTER the timeout — i.e. the write does land, just late. This
		//is the reconnect case, not the stranded case.
		queue.registerAuxWriteExecutor('star-add', () => new Promise(resolve => {
			commits++;
			setTimeout(resolve, 60);
		}));
		const outcome = await queue.runDurableAuxWrite(queue.makeAuxWriteIntent('u1', 'star-add', 'cardA'));
		assert.equal(outcome, 'queued', 'the caller is told it did not confirm in time');
		assert.equal(commits, 1);

		await queue.replayPendingAuxWrites('u1');
		assert.equal(commits, 1, 'replay must WAIT for the outstanding attempt, not race it');
		assert.deepEqual(queue.readPendingAuxWrites(), [],
			'and the original attempt landing is what clears the intent');
	});

	it('still replays an attempt that never settles at all', async () => {
		//The bounded wait must not turn a stranded attempt into a permanent
		//block — that is the regression the timeout was added to fix.
		queue.setAuxWriteAttemptTimeoutForTesting(20);
		queue.registerAuxWriteExecutor('star-add', () => new Promise(() => {}));
		await queue.runDurableAuxWrite(queue.makeAuxWriteIntent('u1', 'star-add', 'cardA'));
		const ran = [];
		queue.registerAuxWriteExecutor('star-add', async (intent) => { ran.push(intent.cardID); });
		await queue.replayPendingAuxWrites('u1');
		assert.deepEqual(ran, ['cardA'], 'a genuinely stranded attempt is still replayed');
	});

	it('does not let a HANGING replay wedge the queue forever', async () => {
		//A Firestore commit on a memory-only cache neither resolves nor rejects
		//while offline. A bare `await executor(...)` on the replay path hung the
		//loop forever WHILE HOLDING THE REPLAY WEB LOCK -- so no tab could
		//replay anything after it -- and the intent accumulated exactly one
		//failure, so the wedge report (which needs four) could never fire. The
		//wedge-alert fix was recorded as complete while this half was untouched.
		queue.setAuxWriteAttemptTimeoutForTesting(30);
		queue.registerAuxWriteExecutor('star-add', async () => { throw new Error('offline'); });
		await queue.runDurableAuxWrite(queue.makeAuxWriteIntent('u1', 'star-add', 'cardA'));
		assert.equal(queue.readPendingAuxWrites().length, 1);

		//Now it hangs rather than throwing.
		queue.registerAuxWriteExecutor('star-add', () => new Promise(() => {}));
		const start = Date.now();
		await queue.replayPendingAuxWrites('u1');
		assert.ok(Date.now() - start < 5000, 'the replay must give up rather than hang');
		assert.equal(queue.readPendingAuxWrites().length, 1,
			'and RETAIN the intent: a timeout is not evidence the write failed');

		//The queue must still be usable afterwards -- the lock was released.
		const ran = [];
		queue.registerAuxWriteExecutor('star-add', async (intent) => { ran.push(intent.cardID); });
		await queue.replayPendingAuxWrites('u1');
		assert.deepEqual(ran, ['cardA'], 'a later replay still works');
		assert.deepEqual(queue.readPendingAuxWrites(), []);
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
		//card-delete is high-value for the same reason: deleteCard navigates
		//away BEFORE the write is attempted, so degrading to session-only means
		//telling the user "the deletion has been saved and will apply
		//automatically" when nothing was persisted at all -- the exact failure
		//the durable record was introduced to remove. It was added to
		//AuxWriteKind, AUX_WRITE_KINDS, KINDS_REQUIRING_PAYLOAD and
		//DISCARD_LABELS but not to this set.
		queue.registerAuxWriteExecutor('card-delete', async () => {});
		await assert.rejects(
			queue.runDurableAuxWrite(queue.makeAuxWriteIntent('u1', 'card-delete', 'c', '', {kind: 'card-delete', card: {id: 'c'}})),
			/could not be saved locally/,
			'a deletion that was never persisted must not be reported as durable');
		//A best-effort kind still degrades to session-only rather than failing.
		queue.registerAuxWriteExecutor('star-add', async () => {});
		assert.equal(await queue.runDurableAuxWrite(queue.makeAuxWriteIntent('u1', 'star-add', 'c')), 'committed');
		globalThis.localStorage.setItem = realSet;
	});

	it('reports each outcome through onOutcome as it lands (#758 progress)', async () => {
		queue.registerAuxWriteExecutor('card-create', async () => {
			await new Promise(resolve => setTimeout(resolve, 1));
		});
		const payload = i => ({kind: 'card-create', card: {id: 'p' + i}, section: '', sectionUpdateKey: ''});
		const intents = [0, 1, 2, 3].map(i => queue.makeAuxWriteIntent('u1', 'card-create', 'p' + i, '', payload(i)));
		const reported = [];
		const outcomes = await queue.runDurableAuxWrites(intents, 2, (index, outcome) => reported.push([index, outcome]));
		//Advisory progress: one report per intent, matching the returned
		//array (before the correction pass — for committed outcomes they
		//are identical).
		assert.equal(reported.length, 4);
		assert.deepEqual(reported.map(entry => entry[1]), ['committed', 'committed', 'committed', 'committed']);
		assert.deepEqual([...reported.map(entry => entry[0])].sort(), [0, 1, 2, 3]);
		assert.deepEqual(outcomes, ['committed', 'committed', 'committed', 'committed']);
		//And omitting it stays legal.
		const more = [4, 5].map(i => queue.makeAuxWriteIntent('u1', 'card-create', 'p' + i, '', payload(i)));
		assert.deepEqual(await queue.runDurableAuxWrites(more, 2), ['committed', 'committed']);
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

	//The SDK serializes every mutation over one ordered write stream, so a
	//group's "concurrent" attempts ack one at a time — the 30th commit
	//legitimately waits ~30 round trips. A per-attempt deadline that starts at
	//attempt START measures queue depth, not health: at production latency a
	//32-card import reported 8 committed writes as 'queued', alerted the user
	//that 8 cards failed, and — because bulk import selects exactly the
	//committed cards — left 8 freshly created cards out of the selection.
	it('does not report queued while OTHER writes are still settling (serialized acks)', async () => {
		queue.setAuxWriteAttemptTimeoutForTesting(60);
		//Model the write stream: each commit acks 20ms after the one before
		//it, so most attempts wait far longer than their own 60ms window.
		let streamTail = Promise.resolve();
		queue.registerAuxWriteExecutor('card-create', () => {
			const mine = streamTail.then(() => new Promise(resolve => setTimeout(resolve, 20)));
			streamTail = mine;
			return mine;
		});
		const intents = Array.from({length: 10}, (unused, i) => queue.makeAuxWriteIntent('u1', 'card-create', 'c' + i, '', {
			kind: 'card-create', card: {id: 'c' + i}, section: '', sectionUpdateKey: ''}));
		const outcomes = await queue.runDurableAuxWrites(intents, 8);
		assert.deepEqual(outcomes, intents.map(() => 'committed'),
			'a healthy-but-serialized pipeline must not produce false queued outcomes');
		assert.deepEqual(queue.readPendingAuxWrites(), [], 'every intent cleared on its ack');
	});

	it('corrects a queued outcome whose write settled before the group drained', async () => {
		//Even when an attempt DOES time out, the raced result is a snapshot,
		//not a verdict: the write is usually still on the wire, and by the
		//time the whole pool drains it has often landed. Callers act on the
		//outcomes (bulk import selects exactly the committed cards), so the
		//group must return the truth known at return time.
		queue.setAuxWriteAttemptTimeoutForTesting(30);
		const resolvers = new Map();
		queue.registerAuxWriteExecutor('card-create', (intent) => new Promise(resolve => resolvers.set(intent.cardID, resolve)));
		const intents = ['a', 'b'].map(id => queue.makeAuxWriteIntent('u1', 'card-create', id, '', {
			kind: 'card-create', card: {id}, section: '', sectionUpdateKey: ''}));
		//Concurrency 1: 'a' must time out before 'b' even starts.
		const group = queue.runDurableAuxWrites(intents, 1);
		//Let 'a' pass its full quiet window (nothing else is settling) and
		//'b' begin.
		await new Promise(resolve => setTimeout(resolve, 45));
		//'a' acks late — while the pool is still busy with 'b'.
		resolvers.get('a')();
		await new Promise(resolve => setTimeout(resolve, 5));
		resolvers.get('b')();
		const outcomes = await group;
		assert.deepEqual(outcomes, ['committed', 'committed'],
			'a write that landed before the group returned must be reported committed');
		assert.deepEqual(queue.readPendingAuxWrites(), [], 'the late ack still cleared the intent');
	});

	it('a genuinely dead pipeline still reports queued, boundedly, for a whole group', async () => {
		//The progress-aware deadline must not turn "offline" into a hang: with
		//nothing settling anywhere, every attempt gets exactly one quiet
		//window and then reports.
		queue.setAuxWriteAttemptTimeoutForTesting(30);
		queue.registerAuxWriteExecutor('card-create', () => new Promise(() => {}));
		const intents = Array.from({length: 3}, (unused, i) => queue.makeAuxWriteIntent('u1', 'card-create', 'c' + i, '', {
			kind: 'card-create', card: {id: 'c' + i}, section: '', sectionUpdateKey: ''}));
		const start = Date.now();
		const outcomes = await queue.runDurableAuxWrites(intents, 3);
		assert.deepEqual(outcomes, ['queued', 'queued', 'queued']);
		assert.ok(Date.now() - start < 5000, 'must give up rather than extend forever');
		assert.equal(queue.readPendingAuxWrites().length, 3, 'all three stay persisted for replay');
	});

	it('sibling settlements extend a hung write, and a quiet window then ends it', async () => {
		//Two commits land immediately; the third hangs forever. The early
		//settlements re-arm the hung write's deadline once — provably: the
		//group takes at least two windows, where the old fixed timeout took
		//one — but as soon as a full window passes with no progress it must
		//report queued.
		queue.setAuxWriteAttemptTimeoutForTesting(30);
		queue.registerAuxWriteExecutor('card-create', (intent) =>
			intent.cardID === 'hung' ? new Promise(() => {}) : Promise.resolve());
		const intents = ['ok1', 'ok2', 'hung'].map(id => queue.makeAuxWriteIntent('u1', 'card-create', id, '', {
			kind: 'card-create', card: {id}, section: '', sectionUpdateKey: ''}));
		const start = Date.now();
		const outcomes = await queue.runDurableAuxWrites(intents, 3);
		const elapsed = Date.now() - start;
		assert.deepEqual(outcomes, ['committed', 'committed', 'queued']);
		assert.ok(elapsed >= 55, `the ok settlements must have bought the hung write a second window (took ${elapsed}ms)`);
		assert.deepEqual(queue.readPendingAuxWrites().map(i => i.cardID), ['hung'],
			'only the write that truly never settled stays queued');
	});

	it('caps extensions: steady unrelated traffic cannot keep a hung write in flight forever', async () => {
		//"Attempts are finite" is false in practice — auto-mark-read fires
		//every ~5s while the user browses, inside every 8s window. A
		//deterministically hung attempt riding that traffic must not stay in
		//`inFlight` indefinitely: there replay skips it, its caller's await
		//never resolves, and recordFailure (whose wedge report exists exactly
		//for deterministic hangs) never runs.
		queue.setAuxWriteAttemptTimeoutForTesting(20);
		queue.registerAuxWriteExecutor('card-create', () => new Promise(() => {}));
		queue.registerAuxWriteExecutor('star-add', () => new Promise(resolve => setTimeout(resolve, 5)));
		let stopTraffic = false;
		const traffic = (async () => {
			while (!stopTraffic) {
				await queue.runDurableAuxWrite(queue.makeAuxWriteIntent('u1', 'star-add', 'noise'));
				await new Promise(resolve => setTimeout(resolve, 5));
			}
		})();
		const intent = queue.makeAuxWriteIntent('u1', 'card-create', 'hung', '', {
			kind: 'card-create', card: {id: 'hung'}, section: '', sectionUpdateKey: ''});
		const start = Date.now();
		const outcome = await queue.runDurableAuxWrite(intent);
		const elapsed = Date.now() - start;
		stopTraffic = true;
		await traffic;
		assert.equal(outcome, 'queued');
		//1 initial window + at most MAX_DEADLINE_EXTENSIONS (4) more = 100ms
		//at this test's 20ms window; the margin is CI slack, and the real
		//assertion is that the bound is a small constant, not the traffic's
		//lifetime.
		assert.ok(elapsed < 1000, `the capped deadline must end the wait (took ${elapsed}ms)`);
		assert.ok(queue.readPendingAuxWrites().some(i => i.cardID === 'hung'),
			'the hung intent is retained for replay');
		assert.ok(storage.has(`card-web-aux-writes-v2-f-${intent.id}`),
			'and its failure was COUNTED, so the wedge report can eventually fire');
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

	it('does not let a sibling tab erase a queued high-value intent (F8)', async () => {
		//THE WINDOW: readPendingAuxWrites() and writePendingAuxWrites() are two
		//separate localStorage operations, so another renderer can write
		//BETWEEN them — and this tab then overwrites with a snapshot that
		//predates that write. The storage listener only restores intents in
		//THIS tab's inFlight, and an intent leaves inFlight the moment its
		//attempt settles or times out, so a card-create whose first attempt
		//failed is guarded by nothing at all.
		const tabB = await import('../../lib/src/aux-write-queue.js?f8-tab-b');
		tabB.registerAuxWriteExecutor('card-create', async () => { throw new Error('offline'); });
		queue.registerAuxWriteExecutor('star-add', async () => {});

		//Tab A reads an EMPTY queue, then tab B queues the user's card, then
		//tab A writes its star on top of the snapshot it read.
		const realGet = globalThis.localStorage.getItem;
		let injected = false;
		let pending = null;
		globalThis.localStorage.getItem = function(key) {
			const value = realGet.call(this, key);
			//Set BEFORE the sibling call: tab B reads the queue too, and
			//guarding on `pending` (assigned after) recursed forever.
			if (key === 'card-web-aux-writes-v2-index' && !injected) {
				injected = true;
				pending = tabB.runDurableAuxWrite(tabB.makeAuxWriteIntent('u1', 'card-create', 'kept', '', {
					kind: 'card-create', card: {id: 'kept', body: 'the user typed this'}, section: '', sectionUpdateKey: ''}));
			}
			return value;
		};
		await queue.runDurableAuxWrite(queue.makeAuxWriteIntent('u1', 'star-add', 'cardA'));
		globalThis.localStorage.getItem = realGet;
		await pending;

		//The star is best-effort and reconstructible. The card is neither — it
		//exists nowhere else once this queue drops it. The body is the source
		//of truth, so the recovery scan must adopt it back; a replay trigger is
		//what runs that scan, and is the point at which the card would
		//otherwise have been silently gone forever.
		queue.registerAuxWriteExecutor('card-create', async () => {});
		await queue.replayPendingAuxWrites('u1');
		const replayedCard = !queue.readPendingAuxWrites().some(i => i.cardID === 'kept');
		assert.ok(replayedCard,
			'a queued card-create must survive a sibling tab writing between our read and our write');
	});

	it('reports an intent that keeps failing with the SAME error, and keeps it', async () => {
		//A deterministic bug throws identically forever. The queue cannot know
		//that, so it retains — correctly — but it used to keep promising the
		//write would go through when the connection recovered. Exactly what
		//happened when the card-create executor opened an atomic group it never
		//closed: creation was 100% broken and the UI said "saved".
		const alerts = [];
		globalThis.window = globalThis.window || {};
		globalThis.window.setTimeout = (fn) => { fn(); return 0; };
		globalThis.alert = (m) => alerts.push(String(m));
		queue.setAuxWriteAttemptTimeoutForTesting(30);
		queue.registerAuxWriteExecutor('card-create', async () => { throw new Error('the same deterministic bug'); });
		const payload = {kind: 'card-create', card: {id: 'c'}, section: '', sectionUpdateKey: ''};
		for (let i = 0; i < 4; i++) {
			await queue.runDurableAuxWrite(queue.makeAuxWriteIntent('u1', 'card-create', 'c' + i, '', payload));
		}
		//Each intent is distinct, so none of them individually reaches the
		//threshold — the count is per intent, and a changing error resets it.
		assert.equal(alerts.length, 0, 'four different intents failing once each is not a wedge');

		const wedged = queue.makeAuxWriteIntent('u1', 'card-create', 'stuck', '', payload);
		for (let i = 0; i < 4; i++) {
			//Same intent id retried: this is the wedge shape.
			await queue.runDurableAuxWrite({...wedged, id: wedged.id});
		}
		assert.equal(alerts.length, 1, 'the user is told once, not on every retry');
		assert.match(alerts[0], /not going through/);
		assert.ok(queue.readPendingAuxWrites().some(i => i.cardID === 'stuck'),
			'and the work is RETAINED — a wedge is not a reason to throw it away');
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
		//Claims live in their own key now, so the body stays immutable and no
		//tab ever rewrites another tab's intent. Written below via that key.
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

		//Simulate a sibling tab holding a fresh claim on the HEAD intent. The
		//claim is its own key now, so this no longer rewrites the intent body.
		const pending = queue.readPendingAuxWrites();
		assert.strictEqual(pending.length, 2);
		globalThis.localStorage.setItem(`card-web-aux-writes-v2-c-${pending[0].id}`,
			JSON.stringify({by: 'some-other-tab', at: Date.now()}));

		await queue.replayPendingAuxWrites('u1');
		assert.deepStrictEqual(replayed, [],
			'the remove must NOT run ahead of the add that another tab owns');
		assert.strictEqual(queue.readPendingAuxWrites().length, 2, 'both intents survive for the next replay');
	});

	//The status indicator's amber layer: the queue pushes its own depth so no
	//selector ever reads localStorage on Redux's hot paths.
	describe('queue depth notifications', () => {
		it('reports the current depth on registration and pushes changes on enqueue and drain', async () => {
			let failing = true;
			queue.registerAuxWriteExecutor('star-add', async () => {
				if (failing) throw new Error('offline');
			});
			const depths = [];
			queue.onAuxWriteQueueDepthChanged(count => depths.push(count));
			assert.deepStrictEqual(depths, [0], 'registration must report the current depth immediately');
			await queue.runDurableAuxWrite(queue.makeAuxWriteIntent('u1', 'star-add', 'cardA'));
			//Notifications are deferred one tick so a bulk enqueue reports once.
			await new Promise(resolve => setTimeout(resolve, 5));
			assert.strictEqual(depths[depths.length - 1], 1, 'a retained intent must raise the depth');
			failing = false;
			await queue.replayPendingAuxWrites('u1');
			await new Promise(resolve => setTimeout(resolve, 5));
			assert.strictEqual(depths[depths.length - 1], 0, 'a drained queue must report zero');
		});

		it('a late subscriber learns about intents surviving from a previous session', async () => {
			queue.registerAuxWriteExecutor('star-add', async () => { throw new Error('offline'); });
			await queue.runDurableAuxWrite(queue.makeAuxWriteIntent('u1', 'star-add', 'cardA'));
			const depths = [];
			queue.onAuxWriteQueueDepthChanged(count => depths.push(count));
			assert.deepStrictEqual(depths, [1]);
		});
	});
});

/*eslint-env node, es2022*/

//Executable coverage for the comment write paths (L2b), which shipped with
//their queue-level contracts unit-tested but their Firestore-facing logic —
//the server preflight, the conflict refusal, the already-applied no-op —
//reasoned about and never run.
//
//Those are exactly the branches that decide whether a user's typed words are
//kept, refused, or silently overwritten, so they get run here against a real
//emulator rather than argued about.

import assert from 'assert';
import {bootstrapApp, clearAuxQueue, clearHarnessAlerts, harnessAlerts, seedQueuedIntent, wireCard} from '../harness-support/app-harness.js';

const app = await bootstrapApp();
const {db, uid, firestore} = app;
const {doc, getDoc, setDoc} = firestore;

//Importing these REGISTERS the comment executors.
await import('../../lib/src/actions/comments.js');
const queue = await import('../../lib/src/aux-write-queue.js');

const seedCard = async (id) => {
	//createThread runs a transaction that reads the card and throws if absent.
	await setDoc(doc(db, 'cards', id), {...wireCard(id, uid), id, thread_count: 0});
	return id;
};

const postComment = async (cardID, messageID, threadID, text, newThread = true) =>
	queue.runDurableAuxWrite(queue.makeAuxWriteIntent(uid, 'comment-add', cardID, '', {
		kind: 'comment-add', messageID, threadID, message: text, newThread
	}));

let counter = 0;
const ids = () => {
	counter++;
	const stamp = `${Date.now()}-${counter}`;
	return {card: `hc-${stamp}`, message: `hm-${stamp}`, thread: `ht-${stamp}`};
};

describe('comment executors (real writes against the emulator)', () => {
	beforeEach(() => {
		clearAuxQueue();
		clearHarnessAlerts();
	});

	it('opening a thread writes the message, the thread, and bumps thread_count', async () => {
		const {card, message, thread} = ids();
		await seedCard(card);
		assert.equal(await postComment(card, message, thread, 'first post'), 'committed');

		const messageDoc = (await getDoc(doc(db, 'messages', message))).data();
		assert.equal(messageDoc.message, 'first post');
		assert.equal(messageDoc.card, card);
		assert.equal(messageDoc.deleted, false);
		const threadDoc = (await getDoc(doc(db, 'threads', thread))).data();
		assert.deepEqual(threadDoc.messages, [message]);
		//The transaction's whole point: the counter moves with the write.
		assert.equal((await getDoc(doc(db, 'cards', card))).data().thread_count, 1);
	});

	it('an edit replaces the text', async () => {
		const {card, message, thread} = ids();
		await seedCard(card);
		await postComment(card, message, thread, 'before');
		assert.equal(await queue.runDurableAuxWrite(queue.makeAuxWriteIntent(uid, 'comment-edit', card, '', {
			kind: 'comment-edit', messageID: message, message: 'after', baseMessage: 'before'
		})), 'committed');
		assert.equal((await getDoc(doc(db, 'messages', message))).data().message, 'after');
	});

	it('a REPLAYED edit applies when the server still holds the base', async () => {
		const {card, message, thread} = ids();
		await seedCard(card);
		await postComment(card, message, thread, 'base text');
		clearAuxQueue();

		seedQueuedIntent(queue.makeAuxWriteIntent(uid, 'comment-edit', card, '', {
			kind: 'comment-edit', messageID: message, message: 'replayed text', baseMessage: 'base text'
		}));
		await queue.replayPendingAuxWrites(uid);
		assert.equal((await getDoc(doc(db, 'messages', message))).data().message, 'replayed text');
		assert.deepEqual(queue.readPendingAuxWrites(), [], 'a successful replay clears the intent');
	});

	it('a REPLAYED edit REFUSES when the text changed underneath, and is discarded', async () => {
		//The clobber hazard: without this the edit would silently replace words
		//written on another device after this edit was composed.
		const {card, message, thread} = ids();
		await seedCard(card);
		await postComment(card, message, thread, 'base text');
		clearAuxQueue();

		const current = (await getDoc(doc(db, 'messages', message))).data();
		await setDoc(doc(db, 'messages', message), {...current, message: 'someone else rewrote this'});

		seedQueuedIntent(queue.makeAuxWriteIntent(uid, 'comment-edit', card, '', {
			kind: 'comment-edit', messageID: message, message: 'my stale edit', baseMessage: 'base text'
		}));
		await queue.replayPendingAuxWrites(uid);

		assert.equal((await getDoc(doc(db, 'messages', message))).data().message, 'someone else rewrote this',
			'the other device\'s text must survive');
		//A conflict is PERMANENT — it must be discarded, not retried forever.
		//That requires the executor to throw a CODED error, since the queue
		//classifies by code only.
		assert.deepEqual(queue.readPendingAuxWrites(), [],
			'a conflicting edit must be discarded, not left retrying a write that can never be right');
		//...and discarding the user's words SILENTLY is the failure mode this
		//whole branch keeps rediscovering. They must be told.
		await new Promise(resolve => setTimeout(resolve, 50));
		assert.ok(harnessAlerts.some(a => /saving your edit to that comment/.test(a)),
			`the user must be told their edit was discarded; alerts were ${JSON.stringify(harnessAlerts)}`);
	});

	it('a REPLAYED edit that is already applied is a no-op, not a conflict', async () => {
		const {card, message, thread} = ids();
		await seedCard(card);
		await postComment(card, message, thread, 'base text');
		clearAuxQueue();

		//The server already holds exactly what we would write — our own earlier
		//attempt landed. That is the intent's goal, not a conflict.
		const current = (await getDoc(doc(db, 'messages', message))).data();
		await setDoc(doc(db, 'messages', message), {...current, message: 'the same edit'});

		seedQueuedIntent(queue.makeAuxWriteIntent(uid, 'comment-edit', card, '', {
			kind: 'comment-edit', messageID: message, message: 'the same edit', baseMessage: 'base text'
		}));
		await queue.replayPendingAuxWrites(uid);
		assert.equal((await getDoc(doc(db, 'messages', message))).data().message, 'the same edit');
		assert.deepEqual(queue.readPendingAuxWrites(), [], 'and the intent clears');
		//DISTINGUISHING ASSERTION. Without it this test passes even if the
		//already-applied branch is deleted — execution just falls through to the
		//conflict check, which also leaves this text in place and also clears
		//the intent, so both assertions above hold FOR THE WRONG REASON.
		//(Found by deleting the branch and watching the test stay green.)
		//A no-op is silent; a conflict tells the user their edit was discarded.
		await new Promise(resolve => setTimeout(resolve, 50));
		assert.deepEqual(harnessAlerts, [],
			`an already-applied edit is the intent's goal, not a conflict — the user must NOT be told it was discarded; got ${JSON.stringify(harnessAlerts)}`);
	});

	it('a delete blanks the text and marks it deleted', async () => {
		const {card, message, thread} = ids();
		await seedCard(card);
		await postComment(card, message, thread, 'to be deleted');
		assert.equal(await queue.runDurableAuxWrite(queue.makeAuxWriteIntent(uid, 'comment-delete', card, '', {
			kind: 'comment-delete', messageID: message, baseMessage: 'to be deleted'
		})), 'committed');
		const data = (await getDoc(doc(db, 'messages', message))).data();
		assert.equal(data.deleted, true);
		assert.equal(data.message, '');
	});

	it('a REPLAYED delete is a silent no-op when it is already deleted', async () => {
		//Absence SATISFIES a delete, unlike an edit: the user asked for it to be
		//gone and it is.
		const {card, message, thread} = ids();
		await seedCard(card);
		await postComment(card, message, thread, 'gone soon');
		await queue.runDurableAuxWrite(queue.makeAuxWriteIntent(uid, 'comment-delete', card, '', {
			kind: 'comment-delete', messageID: message, baseMessage: 'gone soon'
		}));
		clearAuxQueue();

		seedQueuedIntent(queue.makeAuxWriteIntent(uid, 'comment-delete', card, '', {
			kind: 'comment-delete', messageID: message, baseMessage: 'gone soon'
		}));
		await queue.replayPendingAuxWrites(uid);
		assert.deepEqual(queue.readPendingAuxWrites(), [], 'an already-satisfied delete clears quietly');
		assert.equal((await getDoc(doc(db, 'messages', message))).data().deleted, true);
	});

	it('an edit whose comment has not posted yet is RETAINED, not discarded', async () => {
		//Replay skips (rather than stops at) an in-flight intent, so an `online`
		//event inside the attempt window can reach an edit whose add has not
		//landed. An update against a missing message returns not-found, which
		//the queue treats as PERMANENT — it would throw the user's edit away.
		const {card, message} = ids();
		await seedCard(card);
		clearAuxQueue();

		//A pending add for this message, never attempted...
		seedQueuedIntent(queue.makeAuxWriteIntent(uid, 'comment-add', card, '', {
			kind: 'comment-add', messageID: message, threadID: 'ht-unposted', message: 'unposted', newThread: true
		}));
		//...and an edit of it queued behind.
		seedQueuedIntent(queue.makeAuxWriteIntent(uid, 'comment-edit', card, '', {
			kind: 'comment-edit', messageID: message, message: 'edited', baseMessage: 'unposted'
		}));
		await queue.replayPendingAuxWrites(uid);

		//Ordered replay runs the add first, so both should land. The property
		//that matters either way: the edit is never DISCARDED.
		const survivors = queue.readPendingAuxWrites();
		const editSurvived = survivors.some(i => i.kind === 'comment-edit');
		const applied = (await getDoc(doc(db, 'messages', message))).exists() &&
			(await getDoc(doc(db, 'messages', message))).data().message === 'edited';
		assert.ok(editSurvived || applied,
			'the edit must either apply or be retained — never silently dropped');
	});
});

/*eslint-env node*/

//Tests for the single source of truth for "card sync is not ready" copy
//(src/sync-copy.ts). The strings themselves are product surface — every
//disabled write control's tooltip and every action-level refusal renders
//them — so the contract under test is:
//1. the reason tracks the ACTUAL status (the original sin was asserting
//   "verifying" during an interruption), and
//2. the verifying-window copy answers "what CAN I still do?" (read, browse,
//   edit) — not merely "when does it unlock?".

import assert from 'assert';

let blockedReason;
let blockedError;
let SAVE_VERB;
let CREATE_VERB;
let DELETE_VERB;
let IMPORT_VERB;
let REORDER_VERB;
let SUGGESTION_VERB;

describe('sync-copy blocked reasons', () => {
	before(async () => {
		({blockedReason, blockedError, SAVE_VERB, CREATE_VERB, DELETE_VERB, IMPORT_VERB, REORDER_VERB, SUGGESTION_VERB} = await import('../../lib/src/sync-copy.js'));
	});

	it('the verifying window says what IS still safe, not just what is blocked', () => {
		const reason = blockedReason('loading', SAVE_VERB);
		assert.ok(reason.startsWith('Saving is unavailable because card sync is still verifying.'), reason);
		//The whole point of the copy: reading/browsing/editing continue to work.
		assert.ok(reason.includes('reading'), reason);
		assert.ok(reason.includes('browsing'), reason);
		assert.ok(reason.includes('editing'), reason);
		//And it sets a time expectation so the user knows to just wait.
		assert.ok(reason.includes('under a minute'), reason);
	});

	it('an interruption is reported as an interruption, never as verifying', () => {
		const reason = blockedReason('stale', SAVE_VERB);
		assert.ok(reason.includes('card sync is interrupted'), reason);
		assert.ok(!reason.includes('verifying'), reason);
	});

	it('other-tab ownership points at the fix (use this tab)', () => {
		const reason = blockedReason('contended', CREATE_VERB);
		assert.ok(reason.includes('another tab'), reason);
		assert.ok(reason.includes('Use this tab'), reason);
	});

	it('terminal states (unsupported, degraded) make no promise of self-resolution', () => {
		for (const status of ['unsupported', 'ownership-error', 'degraded']) {
			const reason = blockedReason(status, SAVE_VERB);
			assert.ok(!reason.includes('unlocks'), `${status}: ${reason}`);
			assert.ok(!reason.includes('under a minute'), `${status}: ${reason}`);
		}
	});

	it('every verb reads as a gerund phrase heading the sentence', () => {
		for (const verb of [SAVE_VERB, CREATE_VERB, DELETE_VERB, IMPORT_VERB, REORDER_VERB, SUGGESTION_VERB]) {
			const reason = blockedReason('loading', verb);
			assert.ok(reason.startsWith(`${verb} is unavailable because `), reason);
		}
	});

	it('blockedError appends the your-work-is-kept reassurance', () => {
		const error = blockedError('loading', SAVE_VERB);
		assert.ok(error.startsWith(blockedReason('loading', SAVE_VERB)), error);
		assert.ok(error.endsWith('Your work is kept.'), error);
	});
});

/*eslint-env node*/

//S4, the same-session half. Firestore's persistent cache in the worker is a
//second, larger copy of the privileged corpus — unpublished bodies included —
//and it cannot be cleared while the SDK instance is live, so sign-out RECORDS a
//purge and the next worker boot deletes the database before Firestore opens it.
//`purgePersistence` rides only the FIRST connect message, though, and signing
//out then signing in as a different account never reloads the page. The new
//account kept running against the previous account's cache.
//
//The decision is tested here rather than reasoned about in the bridge, because
//every one of these branches is a way to get it wrong: reload when you did not
//need to (a spurious reload on an ordinary boot), reload over unsaved work, or
//reload forever.

import assert from 'assert';

const {accountHandoverDecision} = await import('../../lib/src/account-handover.js');

const decide = (overrides) => accountHandoverDecision({
	uid: 'B',
	pendingPurgeUid: 'A',
	connectSent: true,
	editing: false,
	alreadyReloaded: false,
	...overrides,
});

describe('same-session account handover', () => {

	it('reloads when a DIFFERENT account signs in on a running page', () => {
		//The actual hazard: no boot will happen, so nothing else will ever
		//purge A's cache.
		assert.equal(decide({}), 'reload');
	});

	it('does nothing when the SAME account comes back', () => {
		//Sign out and sign back in is the common case. A reload here costs a
		//full cold prime for nothing, and the caller cancels the purge instead.
		assert.equal(decide({uid: 'A'}), 'no-handover');
	});

	it('does nothing while signed out', () => {
		//Sign-out is what RECORDS the purge; it is not itself a handover.
		assert.equal(decide({uid: ''}), 'no-handover');
	});

	it('does nothing when no purge is pending', () => {
		assert.equal(decide({pendingPurgeUid: ''}), 'no-handover');
	});

	it('does NOT reload on an ordinary fresh boot', () => {
		//Previous account signed out in an EARLIER session; this page has not
		//connected a worker yet, so the connect about to be sent already carries
		//purgePersistence. Reloading would be pure loss — and this is the most
		//likely way to turn a privacy fix into a visible regression, because it
		//is the path every returning user takes.
		assert.equal(decide({connectSent: false}), 'boot-will-purge');
	});

	it('never reloads over an open editor', () => {
		//The same promise the service-worker update path makes. The purge
		//request survives in localStorage, so the next ordinary boot honors it.
		assert.equal(decide({editing: true}), 'defer-editing');
		//And the editor outranks the reload even on the first attempt.
		assert.equal(decide({editing: true, alreadyReloaded: false}), 'defer-editing');
	});

	it('reloads at most once per pending purge', () => {
		//If the purge itself fails the request survives, and without this every
		//subsequent auth resolution would reload — forever.
		assert.equal(decide({alreadyReloaded: true}), 'already-reloaded');
	});
});

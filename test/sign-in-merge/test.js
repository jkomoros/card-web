/*eslint-env node, es2022*/

//THE RULE FOR SWITCHING TO AN EXISTING GOOGLE ACCOUNT (#789): ask only when
//the anonymous session has something to lose, and say exactly what.

import assert from 'assert';

let mergeDecision;
let switchAccountQuestion;
let READS_WORTH_ASKING_ABOUT;

describe('mergeDecision', () => {
	before(async () => {
		({mergeDecision, switchAccountQuestion, READS_WORTH_ASKING_ABOUT} = await import('../../lib/src/sign-in-merge.js'));
	});

	it('switches without asking when there is nothing to lose', () => {
		assert.deepStrictEqual(mergeDecision({stars: 0, readingList: 0, reads: 0, loaded: true}), {kind: 'switch'});
		assert.deepStrictEqual(mergeDecision({stars: 0, readingList: 0, reads: READS_WORTH_ASKING_ABOUT - 1, loaded: true}), {kind: 'switch'});
	});

	it('asks for a single star or reading-list card, or a few dozen reads', () => {
		assert.deepStrictEqual(mergeDecision({stars: 1, readingList: 0, reads: 0, loaded: true}), {kind: 'ask', lose: {stars: 1, readingList: 0, reads: 0}});
		assert.deepStrictEqual(mergeDecision({stars: 0, readingList: 1, reads: 0, loaded: true}), {kind: 'ask', lose: {stars: 0, readingList: 1, reads: 0}});
		assert.deepStrictEqual(mergeDecision({stars: 0, readingList: 0, reads: READS_WORTH_ASKING_ABOUT, loaded: true}), {kind: 'ask', lose: {stars: 0, readingList: 0, reads: READS_WORTH_ASKING_ABOUT}});
	});

	it('never switches on a guess: unloaded counts ask, with nothing to name', () => {
		assert.deepStrictEqual(mergeDecision({stars: 0, readingList: 0, reads: 0, loaded: false}), {kind: 'ask', lose: null});
	});
});

describe('switchAccountQuestion', () => {
	before(async () => {
		({switchAccountQuestion} = await import('../../lib/src/sign-in-merge.js'));
	});

	it('names only what is there, in the app\'s voice', () => {
		const question = switchAccountQuestion({stars: 3, readingList: 2, reads: 0});
		assert.strictEqual(question.title, 'Switch Account');
		assert.strictEqual(question.verb, 'Switch account');
		assert.strictEqual(question.what, 'You\u2019ve signed in with that Google account before. Switching to it leaves behind your stars on 3 cards and 2 cards in your reading list.');
		assert.strictEqual(switchAccountQuestion({stars: 1, readingList: 0, reads: 0}).what, 'You\u2019ve signed in with that Google account before. Switching to it leaves behind your stars on 1 card.');
		assert.match(switchAccountQuestion({stars: 1, readingList: 1, reads: 1200}).what, /your stars on 1 card, 1 card in your reading list and your read marks on 1,200 cards\./);
		//Reads below the threshold are not worth a mention even beside a star.
		assert.ok(!/read/.test(switchAccountQuestion({stars: 1, readingList: 0, reads: 10}).what));
	});

	it('with unknown counts, names nothing it cannot count', () => {
		assert.strictEqual(switchAccountQuestion(null).what, 'You\u2019ve signed in with that Google account before. Switching to it leaves behind any stars, read marks and reading list from this session.');
	});

	it('leaves the irreversibility phrasing to the dialog, which owns it', () => {
		assert.ok(!/undone/.test(switchAccountQuestion({stars: 1, readingList: 0, reads: 0}).what));
	});
});

//THE TWO LEGS SHARE ONE PATH (#789). Source pins, comment-stripped: each fact
//is about which call exists, and the thunk needs Firebase Auth to run.
describe('both sign-in legs take the existing-account path through the dialog', () => {
	let source;
	before(async () => {
		const {readFile} = await import('fs/promises');
		source = (await readFile(new URL('../../src/actions/user.ts', import.meta.url), 'utf8')).replace(/^\s*\/\/.*$/gm, '');
	});

	const slice = (start, end) => {
		const from = source.indexOf(start);
		assert.ok(from >= 0, `missing ${start}`);
		const to = source.indexOf(end, from);
		assert.ok(to > from, `missing ${end}`);
		return source.slice(from, to);
	};

	it('neither leg calls a native confirm, and both dispatch the one thunk', () => {
		const popup = slice('export const signIn = ', 'export const completeRedirectSignIn');
		const legsAndThunk = popup + slice('export const completeRedirectSignIn', 'export const signOutSuccess');
		assert.ok(!/[^a-zA-Z]confirm\(/.test(legsAndThunk), 'the native confirm is gone from sign-in (showNeedSignin\'s is a separate, unmigrated site)');
		assert.match(popup, /if \(err instanceof FirebaseError && err\.code === 'auth\/credential-already-in-use'\) \{\s*await dispatch\(handleCredentialInUse\(err\)\);/);
		const redirect = slice('export const completeRedirectSignIn', 'const googleProvider = ');
		assert.match(redirect, /code === 'auth\/credential-already-in-use'\) \{[\s\S]*await dispatch\(handleCredentialInUse\(err\)\);/, 'the redirect leg asks the same question instead of a dead-end banner');
		assert.ok(!/already linked to different data/.test(source), 'the dead-end banner is gone');
	});

	it('the thunk decides from the counts, asks through the seam, re-checks the session, and never loops', () => {
		const thunk = slice('export const handleCredentialInUse = ', 'export const signOutSuccess');
		assert.match(thunk, /const decision = mergeDecision\(\{stars, readingList, reads, loaded\}\);/);
		assert.match(thunk, /if \(decision\.kind === 'ask'\) \{\s*const go = await confirmDestructive\(switchAccountQuestion\(decision\.lose\)\);\s*if \(!go\) \{\s*dispatch\(\{type: SIGNIN_CANCELLED\}\);\s*return;/, 'declining clears pending and keeps the anonymous session');
		assert.match(thunk, /const current = auth\.currentUser;\s*if \(!current \|\| !current\.isAnonymous \|\| current\.uid !== abandonedUid\) \{\s*dispatch\(\{type: SIGNIN_CANCELLED\}\);/, 'the session is re-checked after the await');
		assert.match(thunk, /GoogleAuthProvider\.credentialFromError\(err\)/);
		assert.match(thunk, /await signInWithCredential\(auth, credential\);/);
		assert.match(thunk, /await freshSignIn\(abandonedUid\);/, 'a missing or expired credential falls back to a fresh sign-in');
		assert.match(thunk, /discardPendingAuxWritesForUid\(abandonedUid\);/);
		assert.match(thunk, /if \(decision\.kind === 'switch'\) \{\s*dispatch\(showSnackbar\(/, 'a silent switch says so');
		const fresh = slice('const freshSignIn = ', 'export const handleCredentialInUse');
		assert.ok(!/linkWith/.test(fresh), 'the fresh sign-in is never a link, so it cannot fail the same way');
		assert.match(fresh, /rememberAbandonedUid\(abandonedUid\);\s*await signInWithRedirect\(auth, provider\);/);
	});

	it('the previous-sign-in marker is read behind a try, like it is written', () => {
		const read = slice('const hasPreviousSignIn = ', 'const ensureRichestDataForUser');
		assert.match(read, /try \{\s*return localStorage\.getItem\(LOCAL_STORAGE_HAS_PREVIOUS_SIGN_IN_KEY\) \? true : false;\s*\} catch \{\s*return false;/);
	});

	it('every early return clears pending, and Google is asked to show the account picker', () => {
		const popup = slice('export const signIn = ', 'export const completeRedirectSignIn');
		assert.match(popup, /if \(!user\) \{[\s\S]*?dispatch\(\{type: SIGNIN_CANCELLED\}\);\s*return;/);
		assert.match(source, /provider\.setCustomParameters\(\{prompt: 'select_account'\}\);/);
		assert.ok(!/'Sign-in /.test(source), 'the glossary: the subject of a sentence is "Sign in"');
	});
});

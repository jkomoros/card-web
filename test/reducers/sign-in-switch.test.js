/*eslint-env node, es2020*/

//AN ACCOUNT SWITCH WITHOUT A SIGN-OUT BETWEEN (#789): anonymous → the existing
//account via signInWithCredential. SIGNIN_SUCCESS used to reset stars and
//reads but not the reading list or the three loaded flags, so the abandoned
//session's reading list sat under the new account and the flags claimed its
//deliveries had already arrived. A same-uid resolution (a link, a boot) must
//keep them: its listeners do not deliver again.

import assert from 'assert';

describe('SIGNIN_SUCCESS on a uid switch', () => {
	let reducer;
	let SIGNIN_SUCCESS;
	let SIGNIN_CANCELLED;
	let SIGNIN_USER;
	const user = (uid, isAnonymous) => ({uid, isAnonymous, photoURL: '', displayName: '', email: ''});
	before(async () => {
		({default: reducer} = await import('../../lib/src/reducers/user.js'));
		({SIGNIN_SUCCESS, SIGNIN_CANCELLED, SIGNIN_USER} = await import('../../lib/src/actions.js'));
	});
	const loaded = (state) => ({
		...state,
		readingList: ['a'], readingListSnapshot: ['a'], stars: {a: true}, reads: {b: true},
		starsLoaded: true, readsLoaded: true, readingListLoaded: true,
	});

	it('resets the reading list and the loaded flags when the uid changes', () => {
		const before = loaded(reducer(undefined, {type: SIGNIN_SUCCESS, user: user('anon-1', true)}));
		const after = reducer(before, {type: SIGNIN_SUCCESS, user: user('real-1', false)});
		assert.deepStrictEqual(after.readingList, []);
		assert.deepStrictEqual(after.readingListSnapshot, []);
		assert.deepStrictEqual(after.stars, {});
		assert.deepStrictEqual(after.reads, {});
		assert.strictEqual(after.starsLoaded, false);
		assert.strictEqual(after.readsLoaded, false);
		assert.strictEqual(after.readingListLoaded, false);
		assert.strictEqual(after.user.uid, 'real-1');
	});

	it('keeps them all when the same uid resolves again (a link keeps the uid)', () => {
		const before = loaded(reducer(undefined, {type: SIGNIN_SUCCESS, user: user('anon-1', true)}));
		const after = reducer(before, {type: SIGNIN_SUCCESS, user: user('anon-1', false)});
		assert.deepStrictEqual(after.readingList, ['a']);
		assert.deepStrictEqual(after.stars, {a: true}, 'a link does not wipe the stars its uid still owns');
		assert.deepStrictEqual(after.reads, {b: true});
		assert.strictEqual(after.readingListLoaded, true);
		assert.strictEqual(after.starsLoaded, true);
	});

	it('a cancelled sign-in only brings pending down', () => {
		const before = loaded(reducer(undefined, {type: SIGNIN_SUCCESS, user: user('anon-1', true)}));
		const pending = reducer(before, {type: SIGNIN_USER});
		assert.strictEqual(pending.pending, true);
		const after = reducer(pending, {type: SIGNIN_CANCELLED});
		assert.strictEqual(after.pending, false);
		assert.deepStrictEqual(after.readingList, ['a']);
		assert.strictEqual(after.user.uid, 'anon-1');
	});
});

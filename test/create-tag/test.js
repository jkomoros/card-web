/*eslint-env node, es2022*/

//D19: THE DENSEST SILENT-REFUSAL CLUSTER IN THE APP (HS-3.5)
//
//createTag had EIGHT ways to fail and every one of them was
//`console.warn(...); return;`. An admin answers two prompts, they close, and
//then nothing at all happens — no tag, no message, no way to tell which of the
//eight rules was broken. Every one of them is a refusal the person can act on
//once told, which is what makes the silence indefensible rather than merely
//unhelpful.
//
//A ninth problem turned up while writing these tests, and it is the reason this
//file asserts on the TEXT rather than merely on "something was said":
//reservedCollectionName returns true both when a name really is reserved AND
//when sections have not loaded yet, so the first version of the fix told the
//user "'foo' is a reserved word" about a name that was very likely available.
//A message that is present but false is not an improvement on silence, so the
//two cases are now separate and both are pinned below.

import assert from 'assert';
import {bootstrapApp} from '../harness-support/app-harness.js';

const app = await bootstrapApp();
const store = app.store;
const data = await import('../../lib/src/actions/data.js');

const snackbars = () => (store.getState().app.snackbars || []).map(entry => entry.message);
const lastSaid = () => {
	const said = snackbars();
	return said.length ? said[said.length - 1] : '';
};

//createTag awaits getDoc on two paths; the refusals under test all return
//before that, but settle anyway so a regression that reaches Firestore does not
//masquerade as silence.
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

const attempt = async (name, displayName) => {
	store.dispatch({type: 'SHOW_SNACKBAR', message: {id: 'reset', message: '', kind: 'info', durationMs: 0, dedupeKey: 'create-tag'}});
	await store.dispatch(data.createTag(name, displayName));
	await settle();
	return lastSaid();
};

describe('creating a tag never fails silently (HS-3.5, D19)', () => {

	it('says something for a missing short name', async () => {
		const said = await attempt('', 'Display');
		assert.notStrictEqual(said, '', 'a refused tag creation must not be silent');
		assert.match(said, /short name/i);
	});

	it('quotes what was typed when the name normalizes away', async () => {
		const said = await attempt('!!!', 'Display');
		//The person typed "!!!" and normalizeSlug turned it into nothing. Telling
		//them "a tag needs a short name" would be false — they provided one.
		assert.match(said, /!!!/, `the message must quote what was actually typed; got "${said}"`);
		assert.match(said, /letters or numbers/i);
	});

	it('does not call a name reserved when the truth is that nothing is loaded', async () => {
		//The harness has no sections loaded, which is exactly the state that made
		//reservedCollectionName answer "true" for every name.
		const said = await attempt('probably-fine-name', 'Display');
		assert.notStrictEqual(said, '', 'this path must not be silent either');
		assert.doesNotMatch(said, /reserved/i,
			`"probably-fine-name" is not reserved; saying so is a false statement, not a refusal. Got "${said}"`);
		assert.match(said, /still loading/i);
	});

	it('never leaks an internal concept into any of its refusals', async () => {
		const attempts = [['', 'D'], ['!!!', 'D'], ['ok-name', ''], ['ok-name', 'D']];
		for (const [name, displayName] of attempts) {
			const said = await attempt(name, displayName);
			assert.doesNotMatch(said, /normalizeSlug|selectUserIsAdmin|firestore|undefined|\[object/i,
				`"${said}" leaks an internal concept (HS-1.4)`);
		}
	});

	it('ends every refusal as a sentence', async () => {
		const attempts = [['', 'D'], ['!!!', 'D'], ['ok-name', ''], ['ok-name', 'D']];
		for (const [name, displayName] of attempts) {
			const said = await attempt(name, displayName);
			assert.match(said, /[.!?]$/, `"${said}" should end as a sentence (HS-2)`);
		}
	});

	//The source pin covers the paths this harness cannot reach: the two that
	//await Firestore, and the admin/signed-in checks that sit behind them. What
	//it guards is the property that matters — that NO path out of this function
	//is a bare console.warn-and-return.
	it('has no console-only refusal left anywhere in createTag', async () => {
		const {readFileSync} = await import('fs');
		const raw = readFileSync(new URL('../../src/actions/data.ts', import.meta.url), 'utf8');
		const start = raw.indexOf('export const createTag');
		assert.ok(start > 0, 'createTag not found — this pin has stopped seeing it');
		const end = raw.indexOf('\nexport const ', start + 10);
		const body = raw.slice(start, end < 0 ? undefined : end);

		//Every `return;` that follows a guard must have been preceded by a
		//refusal that reaches the user.
		const consoleOnly = [...body.matchAll(/console\.(warn|log)\([^)]*\);\s*\n\s*return;/g)].map(match => match[0]);
		assert.deepStrictEqual(consoleOnly, [],
			`these paths still refuse to the console only, so the user sees nothing:\n${consoleOnly.join('\n')}`);
	});
});

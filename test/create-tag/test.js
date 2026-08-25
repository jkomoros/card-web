/*eslint-env node, es2022*/

//D19: THE DENSEST SILENT-REFUSAL CLUSTER IN THE APP (HS-3.5)
//
//createTag had eight ways to fail and every one was `console.warn(...); return;`.
//An admin answers two prompts, they close, and then nothing happens — no tag,
//no message, no way to tell which of the eight rules was broken.
//
//THE FIRST VERSION OF THIS FILE WAS VACUOUS, and how is worth recording.
//`attempt()` "reset" the surface by dispatching {type: 'SHOW_SNACKBAR'} — an
//action type that does not exist; the real one is PUSH_SNACKBAR — so the
//reducer ignored it, the previous case's message survived, and because dedupe
//replaces in place, a case whose code path said NOTHING read the preceding
//case's message and passed. Review proved it by reverting the !displayName
//guard to a bare `return;`: all five tests stayed green.
//
//And the one message the D19 commit specifically called out as pre-existing
//and wrong — the missing-display-name branch reporting "No short name
//provided", a different field — was the single refusal with no coverage at all.
//It has its own case now.

import assert from 'assert';
import {readFileSync} from 'fs';
import {bootstrapApp, clearWhatUserWasTold, whatUserWasTold} from '../harness-support/app-harness.js';

const app = await bootstrapApp();
const store = app.store;
const data = await import('../../lib/src/actions/data.js');

const settle = () => new Promise(resolve => setTimeout(resolve, 0));

//Returns EVERYTHING said during this attempt and nothing left over from the
//last one. If a path is silent, this is empty — which is the whole point.
const attempt = async (name, displayName) => {
	clearWhatUserWasTold(store);
	assert.deepStrictEqual(whatUserWasTold(store), [], 'the surface must actually be clear before the attempt, or a silent path inherits the previous message');
	await store.dispatch(data.createTag(name, displayName));
	await settle();
	return whatUserWasTold(store);
};

const only = said => {
	assert.strictEqual(said.length, 1, `expected exactly one message, got ${JSON.stringify(said)}`);
	return said[0];
};

describe('creating a tag never fails silently (HS-3.5, D19)', () => {

	it('says something for a missing short name', async () => {
		assert.match(only(await attempt('', 'Display')), /short name/i);
	});

	it('names the DISPLAY name when that is what is missing', async () => {
		//The branch that used to say "No short name provided" — the wrong field.
		//Untested until review pointed out it was the only one uncovered.
		const said = only(await attempt('ok-name', ''));
		assert.match(said, /display name/i, `the message must name the field that is actually missing; got "${said}"`);
	});

	it('quotes what was typed when the name normalizes away', async () => {
		const said = only(await attempt('!!!', 'Display'));
		assert.match(said, /!!!/, `the message must quote what was actually typed; got "${said}"`);
		assert.match(said, /letters or numbers/i);
	});

	it('does not call a name reserved when the truth is that nothing is loaded', async () => {
		const said = only(await attempt('probably-fine-name', 'Display'));
		assert.doesNotMatch(said, /reserved/i,
			`"probably-fine-name" is not reserved; saying so is a false statement, not a refusal. Got "${said}"`);
		assert.match(said, /still loading/i);
	});

	it('says something different for each distinct failure', async () => {
		//Four different rules, four different sentences. The vacuous version of
		//this file could not tell these apart at all.
		const messages = [
			only(await attempt('', 'Display')),
			only(await attempt('ok-name', '')),
			only(await attempt('!!!', 'Display')),
			only(await attempt('probably-fine-name', 'Display')),
		];
		assert.strictEqual(new Set(messages).size, 4,
			`each rule needs its own sentence, otherwise the message cannot tell the admin what to change: ${JSON.stringify(messages)}`);
	});

	it('never leaks an internal concept, and reads as a sentence', async () => {
		for (const [name, displayName] of [['', 'D'], ['!!!', 'D'], ['ok-name', ''], ['ok-name', 'D']]) {
			const said = only(await attempt(name, displayName));
			assert.doesNotMatch(said, /normalizeSlug|selectUserIsAdmin|firestore|undefined|\[object/i,
				`"${said}" leaks an internal concept (HS-1.4)`);
			assert.match(said, /[.!?]$/, `"${said}" should end as a sentence (HS-2)`);
		}
	});

	//SOURCE PIN for the paths this harness cannot reach — the two that await
	//Firestore and the admin/signed-in checks behind them. Comments are
	//stripped first: a pin that reads raw source is satisfied by a commented-out
	//call, which review demonstrated against the sibling suite.
	it('has no console-only refusal left anywhere in createTag', () => {
		const raw = readFileSync(new URL('../../src/actions/data.ts', import.meta.url), 'utf8')
			.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
		const start = raw.indexOf('export const createTag');
		assert.ok(start > 0, 'createTag not found — this pin has stopped seeing it');
		const end = raw.indexOf('\nexport const ', start + 10);
		const body = raw.slice(start, end < 0 ? undefined : end);
		const consoleOnly = [...body.matchAll(/console\.(warn|log)\([^)]*\);\s*\n\s*return;/g)].map(match => match[0].replace(/\s+/g, ' '));
		assert.deepStrictEqual(consoleOnly, [],
			`these paths still refuse to the console only, so the user sees nothing:\n${consoleOnly.join('\n')}`);
	});
});

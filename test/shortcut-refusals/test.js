/*eslint-env node, es2022*/

//A SHORTCUT HAS NO DISABLED STATE (HS-3.5)
//
//A BUTTON that cannot be used greys out and carries its reason in a tooltip, so
//a guard behind it may refuse quietly. A KEYBOARD SHORTCUT has none of that:
//press Cmd-M without permission to create cards, or Cmd-E on a card you may not
//edit, and the app does nothing whatsoever — indistinguishable from a key that
//was never bound, which teaches the user the feature is broken rather than that
//they lack permission.
//
//The rule is narrower than "never console.warn":
//  - refusals reachable by a SHORTCUT must speak;
//  - refusals behind an already-disabled-with-reason control need not;
//  - a prompt the user CANCELLED must not (they cancelled; they know);
//  - invariant guards only a programming error can trip must not, because a
//    message aimed at someone who cannot act on it is noise, and noise is what
//    makes real messages ignorable.
//
//TWO WAYS THE FIRST VERSION OF THIS FILE WAS FAKE, both found by review:
//
//1. Its runtime tests never reached a single migrated guard. createCard gates on
//   durableSaveEligible FIRST, and the harness corpus is not live, so the
//   function returned at the top every time. What the test saw was the
//   PRE-EXISTING corpus-gate banner — code this change never touched. Having
//   already been caught once reading only the snackbars, I had "fixed" it to
//   read both surfaces, which only made it pass more reliably on the wrong one.
//   The corpus is now made live so the guards are actually reachable.
//
//2. Its source pins matched raw text, so a COMMENTED-OUT call satisfied them.
//   Review got all three of these past it: `//refuseCardCreation(...)`,
//   `refuseCardCreation(dispatch, '')`, and `if (false) refuseCardCreation(...)`.
//   Comments are stripped now, the message must be non-empty, and the call must
//   not sit behind a nested condition.

import assert from 'assert';
import {readFileSync} from 'fs';
import {bootstrapApp, clearWhatUserWasTold, whatUserWasTold, makeCorpusLive} from '../harness-support/app-harness.js';

const app = await bootstrapApp();
const store = app.store;
const data = await import('../../lib/src/actions/data.js');

const settle = () => new Promise(resolve => setTimeout(resolve, 0));

const stripComments = source => source
	.replace(/\/\*[\s\S]*?\*\//g, '')
	.replace(/^\s*\/\/.*$/gm, '');

const readSource = name => stripComments(readFileSync(new URL(`../../src/actions/${name}`, import.meta.url), 'utf8'));

const bodyOf = (source, exportName) => {
	const start = source.indexOf(`export const ${exportName}`);
	assert.ok(start > 0, `${exportName} not found — this pin has stopped seeing it`);
	const end = source.indexOf('\nexport const ', start + 10);
	return source.slice(start, end < 0 ? undefined : end);
};

describe('a shortcut that refuses says why (HS-3.5, D7)', () => {

	beforeEach(() => {
		clearWhatUserWasTold(store);
		//Without this, createCard returns at its corpus gate and NONE of the
		//guards under test is reachable — which is exactly how this file came
		//to assert against a banner produced by code it does not cover.
		makeCorpusLive(store);
	});

	it('actually reaches the guards it claims to test', async () => {
		//A canary for the vacuity above. If createCard starts returning early
		//again, this fails loudly instead of the suite passing on the wrong
		//surface.
		store.dispatch({type: 'SIGNOUT_SUCCESS'});
		await store.dispatch(data.createCard({}));
		await settle();
		const said = whatUserWasTold(store);
		assert.ok(said.length > 0, 'Cmd-M did nothing and said nothing');
		assert.ok(said.some(text => /signed in/i.test(text)),
			`expected the not-signed-in refusal from createCard's own guard, got ${JSON.stringify(said)} — ` +
			'if this is the corpus-gate message, the test is no longer reaching the code it covers');
	});

	it('says it in the user\'s words, not the console\'s', async () => {
		store.dispatch({type: 'SIGNOUT_SUCCESS'});
		await store.dispatch(data.createCard({}));
		await settle();
		const said = whatUserWasTold(store).join(' ');
		assert.doesNotMatch(said, /no user|isn.t allowed to create card|orphanedByDefault|cardType|sortOrder/i,
			`"${said}" is the console's phrasing, not the user's (HS-2.4)`);
	});

	//The guard's OWN body, brace-matched. `indexOf(condition)` then
	//`indexOf('return;')` is not good enough and this file proved it: the
	//condition `!section && !CARD_TYPE_CONFIG.orphanedByDefault` appears TWICE in
	//createCard — once to assign a default section, once to refuse — so the naive
	//slice ran from the first occurrence, straight through the second, to a
	//return that belonged to neither. Review flagged exactly this risk; the
	//nested-condition check is what surfaced it.
	const guardBlock = (body, condition) => {
		const marker = `if (${condition})`;
		let at = body.indexOf(marker);
		const blocks = [];
		while (at >= 0) {
			const open = body.indexOf('{', at + marker.length);
			assert.ok(open > 0, `no block for "${condition}"`);
			let depth = 0;
			let end = open;
			for (; end < body.length; end++) {
				if (body[end] === '{') depth++;
				else if (body[end] === '}') {
					depth--;
					if (depth === 0) break;
				}
			}
			blocks.push(body.slice(open + 1, end));
			at = body.indexOf(marker, at + marker.length);
		}
		assert.ok(blocks.length > 0, `guard "${condition}" not found — it moved or was renamed, and this pin stopped watching it`);
		//The refusing occurrence is the one that returns.
		const refusing = blocks.filter(block => /\breturn;/.test(block));
		assert.strictEqual(refusing.length, 1,
			`expected exactly one refusing "${condition}" guard, found ${refusing.length}`);
		return refusing[0];
	};

	//A guard "speaks" only if the call is real: present after comments are
	//stripped, carrying a non-empty message, and not nested behind another
	//condition. All three mutants review used are covered by those three checks.
	const assertSpeaks = (block, callee, context) => {
		const call = new RegExp(`${callee}\\(\\s*dispatch\\s*,\\s*(['"\`])\\s*\\S`);
		assert.match(block, call,
			`${context} does not tell the user (a call with an empty message does not count):\n${block}`);
		assert.doesNotMatch(block, /\bif\s*\(/,
			`${context}'s refusal sits behind a nested condition, so it may never run:\n${block}`);
	};

	const MUST_SPEAK = [
		['createCard', '!user'],
		['createCard', '!selectUserMayCreateCard(state)'],
		['createCard', '!section && !CARD_TYPE_CONFIG.orphanedByDefault'],
		['createCard', 'section && !getUserMayEditSection(state, section)'],
		['createCard', 'sortOrderIsDangerous(sortOrder)'],
		['createForkedCard', '!getUserMayEditSection(state, section)'],
		['createForkedCard', '!user'],
		['createForkedCard', '!selectUserMayCreateCard(state)'],
	];

	for (const [fn, condition] of MUST_SPEAK) {
		it(`${fn}'s "${condition}" guard tells the user`, () => {
			const block = guardBlock(bodyOf(readSource('data.ts'), fn), condition);
			assertSpeaks(block, 'refuseCardCreation', `${fn}'s "${condition}"`);
		});
	}

	it('editingStart tells the user when they may not edit', () => {
		const block = guardBlock(bodyOf(readSource('editor.ts'), 'editingStart'), '!selectUserMayEditActiveCard(state)');
		assert.match(block, /showSnackbar\(\s*(['"`])\s*\S/, 'Cmd-E must not be indistinguishable from an unbound key');
		assert.doesNotMatch(block, /\bif\s*\(/, 'the refusal must not sit behind a nested condition');
	});

	//THE OTHER HALF OF THE RULE: these two assert a guard stays QUIET.
	it('keeps the save-still-finishing guard silent on purpose', () => {
		const body = bodyOf(readSource('editor.ts'), 'editingStart');
		const at = body.indexOf('durableCardMutationPendingForCard');
		assert.ok(at > 0, 'the save-still-finishing guard moved');
		const block = body.slice(at, body.indexOf('return;', at));
		assert.match(block, /console\.warn/,
			'this guard is deliberately silent: the Edit affordance is already disabled with this exact reason in its tooltip');
		assert.doesNotMatch(block, /showSnackbar|reportPersistentError/,
			'migrating this one produces a message storm on a held shortcut — it repeats once per keypress');
	});

	it('says nothing when the user cancelled the title prompt', () => {
		const body = bodyOf(readSource('data.ts'), 'createCard');
		const at = body.indexOf('if (!titleFromPrompt)');
		assert.ok(at > 0, 'the cancelled-title guard moved');
		const block = body.slice(at, body.indexOf('return;', at));
		assert.doesNotMatch(block, /showSnackbar|refuseCardCreation/,
			'the user cancelled this themselves; telling them they cancelled is noise');
	});
});

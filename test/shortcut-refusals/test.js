/*eslint-env node, es2022*/

//A SHORTCUT HAS NO DISABLED STATE (HS-3.5)
//
//This is the distinction that decides which console.warn guards deserve a
//message and which do not, and it is worth writing down, because a blanket
//"migrate every console.warn" sweep would be wrong — I wrote that sweep first
//and it flagged six guards that are correctly silent.
//
//A BUTTON that cannot be used greys out and carries its reason in a tooltip, so
//a guard behind it may refuse quietly — the user already knows. editingStart's
//save-still-finishing guard does exactly that, deliberately, and its comment
//says so. A KEYBOARD SHORTCUT has none of that: press Cmd-M without permission
//to create cards, or Cmd-E on a card you may not edit, and the app does nothing
//whatsoever. That is indistinguishable from a key that was never bound, which
//is the worst available feedback, because it teaches the user the feature is
//broken rather than that they lack permission.
//
//The rule, then, is narrower than "never console.warn":
//  - refusals reachable by a SHORTCUT must speak;
//  - refusals behind an already-disabled-with-reason control need not;
//  - a prompt the user CANCELLED must not (they know: they cancelled);
//  - invariant guards only a programming error can trip must not, because a
//    message aimed at someone who cannot act on it is noise, and noise is what
//    makes real messages ignorable.
//
//Both halves are pinned below. If the last test starts failing, someone has
//migrated a guard that was supposed to stay quiet.

import assert from 'assert';
import {readFileSync} from 'fs';
import {bootstrapApp} from '../harness-support/app-harness.js';

const app = await bootstrapApp();
const store = app.store;
const data = await import('../../lib/src/actions/data.js');

//EVERYTHING the user was told, on either surface. The first version of this
//file read only the snackbars and concluded a path was silent — it was not, it
//reported on the error banner, because createCard's corpus gate fires before
//the permission guards. Asserting silence while looking in one of two places is
//how a test comes to agree with its author.
const told = () => {
	const state = store.getState();
	const snacks = (state.app.snackbars || []).map(entry => entry.message);
	const banners = (state.errors?.errors || []).map(entry => `${entry.what} ${entry.reassurance || ''}`);
	return [...snacks, ...banners].filter(text => text && text.trim());
};

const settle = () => new Promise(resolve => setTimeout(resolve, 0));

const readSource = name => readFileSync(new URL(`../../src/actions/${name}`, import.meta.url), 'utf8');

const bodyOf = (source, exportName) => {
	const start = source.indexOf(`export const ${exportName}`);
	assert.ok(start > 0, `${exportName} not found — this pin has stopped seeing it`);
	const end = source.indexOf('\nexport const ', start + 10);
	return source.slice(start, end < 0 ? undefined : end);
};

describe('a shortcut that refuses says why (HS-3.5, D7)', () => {

	it('never leaves a Cmd-M press with nothing said at all', async () => {
		store.dispatch({type: 'SIGNOUT_SUCCESS'});
		await store.dispatch(data.createCard({}));
		await settle();
		const said = told();
		assert.ok(said.length > 0,
			'Cmd-M did nothing and said nothing — indistinguishable from an unbound key');
	});

	it('says it in the user\'s words, not the console\'s', async () => {
		store.dispatch({type: 'SIGNOUT_SUCCESS'});
		await store.dispatch(data.createCard({}));
		await settle();
		const said = told().join(' ');
		assert.doesNotMatch(said, /no user|isn.t allowed to create card|orphanedByDefault|cardType|sortOrder/i,
			`"${said}" is the console's phrasing, not the user's (HS-2.4)`);
	});

	//PER-GUARD PIN, replacing a blanket "no console-only refusal in this
	//function" version that was simply the wrong rule: it flagged the cancelled
	//prompt, the optional-slug skip and an invariant cardType check, none of
	//which should speak, and it false-positived on the card-finisher guard,
	//which already dispatches a snackbar on the line above its console.warn.
	//These are the guards a shortcut can actually reach.
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
			const body = bodyOf(readSource('data.ts'), fn);
			const at = body.indexOf(`if (${condition})`);
			assert.ok(at > 0, `guard "${condition}" not found in ${fn} — it moved or was renamed, and this pin stopped watching it`);
			//The guard's own block, up to its return.
			const block = body.slice(at, body.indexOf('return;', at));
			assert.match(block, /refuseCardCreation\(/,
				`this guard is reachable by a shortcut and refuses without telling the user:\n${block}`);
		});
	}

	it('editingStart tells the user when they may not edit', () => {
		const body = bodyOf(readSource('editor.ts'), 'editingStart');
		const at = body.indexOf('if (!selectUserMayEditActiveCard(state))');
		assert.ok(at > 0, 'the may-edit guard moved — this pin stopped watching it');
		const block = body.slice(at, body.indexOf('return;', at));
		assert.match(block, /showSnackbar\(/, 'Cmd-E must not be indistinguishable from an unbound key');
	});

	//THE OTHER HALF OF THE RULE. This one asserts a guard stays QUIET.
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

	//And this one asserts a CANCELLED prompt stays quiet.
	it('says nothing when the user cancelled the title prompt', () => {
		const body = bodyOf(readSource('data.ts'), 'createCard');
		const at = body.indexOf('if (!titleFromPrompt)');
		assert.ok(at > 0, 'the cancelled-title guard moved');
		const block = body.slice(at, body.indexOf('return;', at));
		assert.doesNotMatch(block, /showSnackbar|refuseCardCreation/,
			'the user cancelled this themselves; telling them they cancelled is noise');
	});
});

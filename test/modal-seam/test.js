/*eslint-env node, es2022*/

//THE ASYNC MODAL SEAM (#708)
//
//#708 asks for alert/confirm/prompt to be indirected "behind async methods that
//currently call out to those methods", so that ~81 call sites migrate ONCE
//rather than twice. src/modal.ts is that seam. These tests pin the two halves
//that a migrating call site depends on:
//
//  - the fallback really does call the native function, and really does return
//    what the caller expects, so a site migrated today behaves identically to
//    the day before it was migrated;
//  - once a dialog installs a handler, the request is parked in the store as a
//    PLAIN OBJECT and the promise resolves from whatever the dialog reports.
//
//The store must never hold a function. The first version of this file said that
//constraint was pinned by test/reactive-state; it is not — that test asserts
//@state() decorators via the TypeScript AST and has nothing to do with the
//store. Nothing enforces it today, which is exactly why it is asserted here, on
//the loaded case: the original "never puts a function in the store" test used a
//field with NO validator, i.e. it avoided the only property that could be one,
//and stayed green while the product shipped a function in the store.

import assert from 'assert';
import {bootstrapApp} from '../harness-support/app-harness.js';

const app = await bootstrapApp();
const {dom, store} = app;

const {
	confirmDestructive,
	askForInput,
	installModalHandler,
	uninstallModalHandler,
	cancelAllModals,
	resolveModal,
	seedForField
} = await import('../../lib/src/modal.js');

//The seam's fallbacks call the globals. Capture them rather than letting jsdom's
//"not implemented" noise through, and record what they were asked.
const calls = {confirm: [], prompt: []};
let confirmAnswer = true;
let promptAnswer = 'typed';
globalThis.confirm = dom.window.confirm = (message) => { calls.confirm.push(String(message)); return confirmAnswer; };
globalThis.prompt = dom.window.prompt = (message, value) => { calls.prompt.push({message: String(message), value}); return promptAnswer; };

const reset = () => {
	calls.confirm.length = 0;
	calls.prompt.length = 0;
	confirmAnswer = true;
	promptAnswer = 'typed';
};

const modalState = () => store.getState().modal;

describe('the async modal seam (#708)', () => {

	describe('before an in-app dialog exists, it falls back to the native call', () => {

		beforeEach(reset);

		it('confirms destructively and returns what the user said', async () => {
			confirmAnswer = true;
			assert.strictEqual(await confirmDestructive({title: 'Delete Card', what: 'This card will be deleted.', verb: 'Delete card'}), true);
			confirmAnswer = false;
			assert.strictEqual(await confirmDestructive({title: 'Delete Card', what: 'This card will be deleted.', verb: 'Delete card'}), false);
			assert.strictEqual(calls.confirm.length, 2);
		});

		it('composes the confirm body the way the dialog will, ending in the one approved phrasing', async () => {
			await confirmDestructive({
				title: 'Stop Operation',
				what: 'The remaining 18 cards will be left unchanged.',
				survives: 'The 12 cards already saved will keep their changes.',
				verb: 'Stop operation',
			});
			const body = calls.confirm[0];
			//HOUSE-STYLE §2.4: what is lost, then what survives. §2.7: exactly
			//one irreversibility phrasing, and none of the four it replaced.
			assert.ok(body.indexOf('The remaining 18 cards') < body.indexOf('already saved'), 'what is lost should come before what survives');
			assert.ok(body.includes('This can\'t be undone.'), 'missing the approved irreversibility phrasing');
			for (const banned of ['cannot be undone', 'forever', 'Permanently']) {
				assert.ok(!body.includes(banned), `body still uses the banned phrasing "${banned}"`);
			}
		});

		it('asks for input and returns one value per field', async () => {
			promptAnswer = 'a name';
			const values = await askForInput({title: 'New Tag', verb: 'Create tag', fields: [
				{label: 'Base Name'},
				{label: 'Display Name', value: 'defaulted'},
			]});
			assert.deepStrictEqual(values, ['a name', 'a name']);
			assert.strictEqual(calls.prompt.length, 2, 'the chained pair should be two prompts in the fallback');
			assert.strictEqual(calls.prompt[1].value, 'defaulted', 'a field default should reach the native prompt');
		});

		it('returns null when the user cancels, and asks nothing further', async () => {
			promptAnswer = null;
			const values = await askForInput({title: 'New Tag', verb: 'Create tag', fields: [
				{label: 'Base Name'},
				{label: 'Display Name'},
			]});
			assert.strictEqual(values, null);
			assert.strictEqual(calls.prompt.length, 1, 'cancelling the first field should not ask for the second');
		});

		//The reason `fields` is an array at all: a tag's base name, then its
		//display name defaulted from what the user just typed. An earlier
		//version could not express this, so migrating the two sites it named
		//would have shown an empty box instead of the typed name.
		it('seeds a chained field from the answer before it', async () => {
			promptAnswer = 'typed-base';
			await askForInput({title: 'New Tag', verb: 'Create tag', fields: [
				{label: 'Base Name'},
				{label: 'Display Name', defaultFromField: 0},
			]});
			assert.strictEqual(calls.prompt[1].value, 'typed-base', 'the second field must default from the first answer');
		});

		it('carries the question, the specifics and what survives into the body', async () => {
			await confirmDestructive({
				title: 'Fork Card?',
				what: 'These tags will be dropped.',
				detail: ['tag-one', 'tag-two'],
				survives: 'The card itself is unchanged.',
				verb: 'Fork card',
			});
			const body = calls.confirm[0];
			for (const fragment of ['Fork Card?', 'These tags will be dropped.', 'tag-one', 'tag-two', 'The card itself is unchanged.']) {
				assert.ok(body.includes(fragment), `the confirm body dropped "${fragment}", which the user needs to answer the question`);
			}
		});

		it('refuses a value its validator rejects', async () => {
			promptAnswer = 'not a uid';
			const values = await askForInput({title: 'Add User', verb: 'Add user', fields: [
				{label: 'User ID', validator: 'uid'},
			]});
			assert.strictEqual(values, null, 'a rejected value must not be returned as if it were accepted');
		});

	});

	describe('field seeding is shared by the fallback and the dialog', () => {

		it('prefers a chained answer over a static default', () => {
			const request = {title: 'T', verb: 'V', fields: [{label: 'A'}, {label: 'B', value: 'static', defaultFromField: 0}]};
			assert.strictEqual(seedForField(request, 1, ['chained']), 'chained');
		});

		it('falls back to the static default, then to empty', () => {
			const request = {title: 'T', verb: 'V', fields: [{label: 'A', value: 'static'}, {label: 'B'}]};
			assert.strictEqual(seedForField(request, 0, []), 'static');
			assert.strictEqual(seedForField(request, 1, []), '');
		});

	});

	describe('once a dialog installs a handler', () => {

		before(() => {
			installModalHandler('destructive-confirm');
			installModalHandler('input');
		});

		beforeEach(reset);

		it('parks the request in the store instead of calling the native function', async () => {
			const pending = confirmDestructive({title: 'Delete Card', what: 'Gone.', verb: 'Delete card'});
			await Promise.resolve();

			assert.strictEqual(calls.confirm.length, 0, 'the native confirm should not be reached once a handler exists');
			assert.strictEqual(modalState().requests.length, 1);
			const request = modalState().requests[0];
			assert.strictEqual(request.kind, 'destructive-confirm');
			assert.strictEqual(request.verb, 'Delete card');

			resolveModal(request.id, {confirmed: true});
			assert.strictEqual(await pending, true);
			assert.strictEqual(modalState().requests.length, 0, 'resolving should clear the request');
		});

		//The first version of this test used a field with NO validator, which is
		//the only field property that could be a function — so it passed while
		//the product shipped a function in the store. Use the loaded case.
		it('never puts a function in the store, INCLUDING a validated field', async () => {
			const pending = askForInput({title: 'Add User', verb: 'Add user', fields: [
				{label: 'User ID', validator: 'uid'},
				{label: 'Notes', defaultFromField: 0},
			]});
			await Promise.resolve();

			const request = modalState().requests[0];
			for (const field of request.fields) {
				assert.notStrictEqual(typeof field.validator, 'function', 'a validator reached the store as a function');
			}
			assert.deepStrictEqual(JSON.parse(JSON.stringify(request)), request, 'the parked request must survive a JSON round trip');

			resolveModal(request.id, {values: ['abcdefghijklmnopqrstuvwxyz12', 'note']});
			assert.ok(await pending);
		});

		//Validation must not live only in the fallback, or a migrated caller
		//stops refusing bad input the day the dialog installs.
		it('still refuses a value the validator rejects once a dialog is answering', async () => {
			const pending = askForInput({title: 'Add User', verb: 'Add user', fields: [{label: 'User ID', validator: 'uid'}]});
			await Promise.resolve();
			const request = modalState().requests[0];

			resolveModal(request.id, {values: ['not a uid at all']});
			assert.strictEqual(await pending, null, 'an invalid value must not be returned as if accepted');
		});

		//resolveModal used to return an action-or-null for the caller to
		//dispatch, so the already-handled case threw inside redux.
		it('tolerates a repeat resolve without throwing', async () => {
			const pending = confirmDestructive({title: 'Delete Card', what: 'Gone.', verb: 'Delete card'});
			await Promise.resolve();
			const request = modalState().requests[0];

			resolveModal(request.id, {confirmed: true});
			await pending;
			assert.doesNotThrow(() => resolveModal(request.id, {confirmed: false}), 'a second resolve must be a no-op');
			assert.strictEqual(modalState().requests.length, 0);
		});

		//A parked request whose promise never settles retains everything its
		//awaiting thunk captured. deleteCard captures a whole state snapshot.
		it('cancelAllModals settles every outstanding promise and empties the store', async () => {
			const a = confirmDestructive({title: 'A', what: 'a.', verb: 'Do a'});
			const b = askForInput({title: 'B', verb: 'Do b', fields: [{label: 'B'}]});
			await Promise.resolve();
			assert.strictEqual(modalState().requests.length, 2);

			cancelAllModals();
			assert.strictEqual(await a, false, 'a cancelled confirm should read as "no"');
			assert.strictEqual(await b, null, 'a cancelled input should read as null');
			assert.strictEqual(modalState().requests.length, 0, 'cancelling must not strand requests in the store');
		});

		//A one-way install flag is a trap: a dialog that unmounts would leave
		//every later call hanging with no fallback and nothing to answer it.
		it('uninstalling a handler settles what it had parked', async () => {
			const pending = confirmDestructive({title: 'A', what: 'a.', verb: 'Do a'});
			await Promise.resolve();
			assert.strictEqual(modalState().requests.length, 1);

			uninstallModalHandler('destructive-confirm');
			assert.strictEqual(await pending, false);
			assert.strictEqual(modalState().requests.length, 0);
			installModalHandler('destructive-confirm');
		});

		//#708 anticipates "a stack of those currently active messages", because
		//in-app dialogs do not block the way the native ones do.
		it('holds more than one outstanding request, and resolves them independently', async () => {
			const first = confirmDestructive({title: 'First', what: 'One.', verb: 'Do first'});
			const second = confirmDestructive({title: 'Second', what: 'Two.', verb: 'Do second'});
			await Promise.resolve();

			assert.strictEqual(modalState().requests.length, 2, 'the seam must hold a stack, not a slot');
			const [a, b] = modalState().requests;

			//Out of order on purpose: dismissing the older one first must not
			//strand the newer one.
			resolveModal(a.id, {confirmed: false});
			assert.strictEqual(await first, false);
			assert.strictEqual(modalState().requests.length, 1);
			assert.strictEqual(modalState().requests[0].id, b.id, 'resolving one request should not drop the other');

			resolveModal(b.id, {confirmed: true});
			assert.strictEqual(await second, true);
		});

		it('reports a cancelled input as null rather than an empty answer', async () => {
			const pending = askForInput({title: 'Slug', verb: 'Add slug', fields: [{label: 'Slug'}]});
			await Promise.resolve();
			const request = modalState().requests[0];

			//The dialog reporting no values IS a cancel; '' would be a real
			//answer and callers branch on the difference.
			resolveModal(request.id, {});
			assert.strictEqual(await pending, null);
		});

	});

});

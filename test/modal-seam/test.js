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
//The store must never hold the resolver — test/reactive-state pins
//serializability, and a function in the store breaks it. That is asserted here
//directly rather than left to a comment.

import assert from 'assert';
import {bootstrapApp} from '../harness-support/app-harness.js';

const app = await bootstrapApp();
const {dom, store} = app;

const {
	confirmDestructive,
	askForInput,
	installModalHandler,
	resolveModal
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

		it('refuses a value its validator rejects', async () => {
			promptAnswer = 'not a uid';
			const values = await askForInput({title: 'Add User', verb: 'Add user', fields: [
				{label: 'User ID', validate: value => value.includes(' ') ? 'That does not look like a user ID.' : null},
			]});
			assert.strictEqual(values, null, 'a rejected value must not be returned as if it were accepted');
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

			store.dispatch(resolveModal(request.id, {confirmed: true}));
			assert.strictEqual(await pending, true);
			assert.strictEqual(modalState().requests.length, 0, 'resolving should clear the request');
		});

		//A function in the store would break serializability, which
		//test/reactive-state pins. The resolver lives in a module-local map.
		it('never puts a function in the store', async () => {
			const pending = askForInput({title: 'Slug', verb: 'Add slug', fields: [{label: 'Slug'}]});
			await Promise.resolve();

			const request = modalState().requests[0];
			assert.deepStrictEqual(JSON.parse(JSON.stringify(request)), request, 'the parked request must survive a JSON round trip');

			store.dispatch(resolveModal(request.id, {values: ['a-slug']}));
			assert.deepStrictEqual(await pending, ['a-slug']);
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
			store.dispatch(resolveModal(a.id, {confirmed: false}));
			assert.strictEqual(await first, false);
			assert.strictEqual(modalState().requests.length, 1);
			assert.strictEqual(modalState().requests[0].id, b.id, 'resolving one request should not drop the other');

			store.dispatch(resolveModal(b.id, {confirmed: true}));
			assert.strictEqual(await second, true);
		});

		it('treats a repeat resolve as already-handled rather than an error', async () => {
			const pending = confirmDestructive({title: 'Delete Card', what: 'Gone.', verb: 'Delete card'});
			await Promise.resolve();
			const request = modalState().requests[0];

			store.dispatch(resolveModal(request.id, {confirmed: true}));
			await pending;
			//A dialog closed while its commit is in flight can report twice.
			assert.strictEqual(resolveModal(request.id, {confirmed: false}), null, 'a second resolve should be a no-op, not a throw');
		});

		it('reports a cancelled input as null rather than an empty answer', async () => {
			const pending = askForInput({title: 'Slug', verb: 'Add slug', fields: [{label: 'Slug'}]});
			await Promise.resolve();
			const request = modalState().requests[0];

			//The dialog reporting no values IS a cancel; '' would be a real
			//answer and callers branch on the difference.
			store.dispatch(resolveModal(request.id, {}));
			assert.strictEqual(await pending, null);
		});

	});

});

/*eslint-env node, es2022*/

//A FAILED WRITE HAS A SURFACE NOW
//
//modifyCardFailure did `alert(err)` — the raw Error, so the user read
//"Error: <internal message>" in OS chrome — and adversarial review established
//that it was the ONLY surface for roughly 25 dispatch paths. The save-status
//pill does not cover them: card-web-app computes _saveStatus from
//hasDurableBulkIntent, so it is 'idle' for a single-card failure and
//cardModificationError landed in a store where nothing rendered it.
//
//Which is why deleting the alert without building this first would have turned
//25 rude failures into 25 silent ones. These tests pin that it did not.

import assert from 'assert';
import {bootstrapApp, harnessAlerts, clearHarnessAlerts} from '../harness-support/app-harness.js';

const app = await bootstrapApp();
const {store} = app;

const {
	reportPersistentError,
	dismissPersistentError,
	runPersistentErrorAction,
	registerPersistentErrorAction
} = await import('../../lib/src/actions/app.js');

const {modifyCardFailure} = await import('../../lib/src/actions/data.js');

const errors = () => store.getState().errors.errors;

const clear = () => {
	for (const entry of [...errors()]) store.dispatch(dismissPersistentError(entry.id));
	clearHarnessAlerts();
};

describe('the persistent error banner', () => {

	beforeEach(clear);

	describe('what a failed card write does now', () => {

		it('reports the failure instead of alerting a raw Error', () => {
			store.dispatch(modifyCardFailure(new Error('FIRESTORE_INTERNAL: permission-denied on /cards/foo')));

			assert.strictEqual(harnessAlerts.length, 0, 'a failed write must not open OS chrome any more');
			assert.strictEqual(errors().length, 1, 'and it must not be silent either — that is the trade this replaces');
		});

		//§2.4: never show a raw error object. err.message is written for a
		//developer and frequently names internals.
		it('never puts the Error text in front of the user', () => {
			store.dispatch(modifyCardFailure(new Error('FIRESTORE_INTERNAL: permission-denied on /cards/foo')));

			const shown = errors()[0].what + ' ' + (errors()[0].reassurance || '');
			for (const internal of ['FIRESTORE_INTERNAL', 'permission-denied', '/cards/foo']) {
				assert.ok(!shown.includes(internal), `"${internal}" is internal detail and must stay in the console`);
			}
		});

		it('says what happened and what is still true', () => {
			store.dispatch(modifyCardFailure(new Error('boom')));
			const entry = errors()[0];
			assert.ok(entry.what.length > 0, '§2.4 part 1: what happened');
			assert.ok(entry.reassurance && entry.reassurance.length > 0, '§2.4 part 3: what survives');
		});

		//One write retrying is one problem, not N. Without this a failing save
		//would paper the screen.
		it('collapses a repeating failure into one banner', () => {
			for (let i = 0; i < 5; i++) store.dispatch(modifyCardFailure(new Error('boom')));
			assert.strictEqual(errors().length, 1);
		});

		//The editor's disabled Save carries its own reason; that caller opts out.
		it('stays quiet when the caller already shows the failure itself', () => {
			store.dispatch(modifyCardFailure(new Error('boom'), true));
			assert.strictEqual(errors().length, 0);
			assert.strictEqual(harnessAlerts.length, 0);
		});

		it('still records the failure in the store for anything else that reads it', () => {
			store.dispatch(modifyCardFailure(new Error('boom')));
			assert.ok(store.getState().data.cardModificationError, 'MODIFY_CARD_FAILURE must still be dispatched');
		});

	});

	describe('the banner itself', () => {

		it('can be dismissed, which the old cardModificationError never could', () => {
			store.dispatch(reportPersistentError({what: 'Something broke.'}));
			const [entry] = errors();

			store.dispatch(dismissPersistentError(entry.id));

			assert.strictEqual(errors().length, 0);
		});

		it('keeps two unrelated failures apart', () => {
			store.dispatch(reportPersistentError({what: 'A failed.', dedupeKey: 'a'}));
			store.dispatch(reportPersistentError({what: 'B failed.', dedupeKey: 'b'}));
			assert.strictEqual(errors().length, 2);
		});

		it('never puts a function in the store', () => {
			registerPersistentErrorAction('retry-it', () => {});
			store.dispatch(reportPersistentError({what: 'Broke.', action: {label: 'Retry', actionID: 'retry-it'}}));
			const [entry] = errors();
			assert.strictEqual(typeof entry.action.actionID, 'string');
			assert.deepStrictEqual(JSON.parse(JSON.stringify(entry)), entry, 'a banner must survive a JSON round trip');
		});

		it('runs its action and clears itself', () => {
			let ran = 0;
			registerPersistentErrorAction('retry-run', () => { ran++; });
			store.dispatch(reportPersistentError({what: 'Broke.', action: {label: 'Retry', actionID: 'retry-run'}}));
			const [entry] = errors();

			store.dispatch(runPersistentErrorAction(entry.id, 'retry-run'));

			assert.strictEqual(ran, 1);
			assert.strictEqual(errors().length, 0);
		});

		it('does not run an action for a banner that is already gone', () => {
			let ran = 0;
			registerPersistentErrorAction('retry-stale', () => { ran++; });
			store.dispatch(reportPersistentError({what: 'Broke.', action: {label: 'Retry', actionID: 'retry-stale'}}));
			const [entry] = errors();
			store.dispatch(dismissPersistentError(entry.id));

			store.dispatch(runPersistentErrorAction(entry.id, 'retry-stale'));

			assert.strictEqual(ran, 0, 'a press that races its own dismissal must do nothing');
		});

		//It is persistent by definition. A timer would make it a snackbar.
		it('has no duration at all', () => {
			store.dispatch(reportPersistentError({what: 'Broke.'}));
			assert.strictEqual(errors()[0].durationMs, undefined);
		});

	});

	describe('mounted for real', () => {

		let element;

		before(async function() {
			this.timeout(20000);
			await import('../../lib/src/components/card-web-app.js');
			element = app.dom.window.document.createElement('card-web-app');
			app.dom.window.document.body.appendChild(element);
			await new Promise(resolve => setTimeout(resolve, 0));
		});

		after(() => element.remove());

		it('renders the failure where a user can read it', async () => {
			store.dispatch(modifyCardFailure(new Error('boom')));
			element.stateChanged(store.getState());
			await element.updateComplete;

			const banner = element.shadowRoot.querySelector('.error-banner');
			assert.ok(banner, 'a failed write must actually render something');
			assert.ok(banner.textContent.includes('could not be saved'));
			assert.strictEqual(banner.getAttribute('role'), 'alert', 'a broken durability promise is work at risk');
		});

		//The banners each used to be position:fixed with a hand-computed bottom:
		//two banners needed four values, and their comments record two real bugs
		//from getting that arithmetic wrong. A third would have needed eight.
		it('stacks the banners in one container instead of hand-computed offsets', async () => {
			store.dispatch(modifyCardFailure(new Error('boom')));
			element.stateChanged(store.getState());
			await element.updateComplete;

			const container = element.shadowRoot.querySelector('.banners');
			assert.ok(container, 'the banners need a container that owns the corner');
			assert.ok(container.querySelector('.error-banner'), 'the error banner must live inside it, not beside it');
		});

		it('pins the layout invariants jsdom cannot see', async () => {
			const {readFileSync} = await import('fs');
			const source = readFileSync(new URL('../../src/components/card-web-app.ts', import.meta.url), 'utf8');

			assert.ok(/\.banners\s*\{[^}]*position:\s*fixed/.test(source), 'the container owns the fixed positioning');
			assert.ok(/\.banners\s*\{[^}]*pointer-events:\s*none/.test(source), 'the container must not eat clicks meant for what is underneath');
			assert.ok(/\.banners\.editor-open\s*\{[^}]*bottom/.test(source), 'the editor Save/Cancel row still needs clearing — one offset, on the container');
			assert.ok(!/\.draft-recovery\s*\{\s*bottom/.test(source), 'the per-banner bottom offsets should be gone');
		});

	});

});

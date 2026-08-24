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
import {readFileSync, readdirSync} from 'fs';
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

		//THE CONTRACT THIS SUITE ORIGINALLY GOT BACKWARDS.
		//
		//The first version asserted that err.message NEVER reaches the user, on
		//the premise that it is written for a developer, and it passed —
		//because its fixture was a fabricated Firestore string that no call site
		//produces. Roughly 20 of the 27 real callers compose their message TO
		//§2.4 before throwing, two of them lifted verbatim from HOUSE-STYLE, and
		//the generic sentence destroyed every one. These use REAL strings.
		it('passes a composed message through untouched', () => {
			//The canonical §5 helper's output. It says saving is REFUSED and
			//will stay refused; "could not be saved, try again" is both wrong
			//and useless advice.
			const composed = 'Saving is unavailable because card sync is interrupted. It unlocks when sync reconnects. Your work is kept.';
			store.dispatch(modifyCardFailure(new Error(composed)));

			assert.strictEqual(errors()[0].what, composed, 'a message already written for the user must not be replaced');
		});

		it('does not bolt generic reassurance onto a message that carries its own', () => {
			store.dispatch(modifyCardFailure(new Error('That card no longer exists on the server, so your edit was not saved. Your draft has been kept.')));

			assert.strictEqual(errors()[0].reassurance, undefined, 'appending "try again" to a message that already explains itself contradicts it');
		});

		//The minority that throw a raw SDK Error still need something sayable.
		it('falls back to a written sentence when there is no message at all', () => {
			store.dispatch(modifyCardFailure(new Error('')));

			assert.ok(errors()[0].what.length > 0, 'an empty Error must not produce an empty banner');
			assert.ok(errors()[0].reassurance, 'the fallback carries its own §2.4 part 3');
		});

		//One write retrying is one problem, not N.
		it('collapses a repeating failure into one banner', () => {
			for (let i = 0; i < 5; i++) store.dispatch(modifyCardFailure(new Error('The same thing went wrong.')));
			assert.strictEqual(errors().length, 1);
		});

		//A constant dedupeKey silently replaced one failure with an unrelated
		//one, so the user saw the second and never knew about the first.
		it('does NOT collapse two genuinely different failures', () => {
			store.dispatch(modifyCardFailure(new Error('That card no longer exists on the server.')));
			store.dispatch(modifyCardFailure(new Error('Saving is unavailable because card sync is interrupted.')));

			assert.strictEqual(errors().length, 2, 'two different problems are two banners');
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

		//A banner whose actionID names nothing renders a button that does nothing
		//when pressed — runPersistentErrorAction dismisses the banner and then
		//finds no thunk, so the failure looks like it was handled. Source-text
		//pin because the alternative is importing user.js, which drags in
		//firebase. Idiom follows test/util/scrollbar-convention.test.js.
		it('registers every actionID that any banner names', () => {
			const root = new URL('../../src/', import.meta.url);
			const walk = dir => readdirSync(dir, {withFileTypes: true}).flatMap(entry => {
				const child = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir);
				return entry.isDirectory() ? walk(child) : (entry.name.endsWith('.ts') ? [child] : []);
			});
			const files = walk(root);
			const sources = files.map(file => readFileSync(file, 'utf8'));
			const stripped = sources.map(source => source
				.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''));
			const joined = stripped.join('\n');

			//Both the literal form and the `actionID: SOME_CONST` form, resolved
			//through the const's own declaration.
			const consts = new Map([...joined.matchAll(/const\s+([A-Z][A-Z0-9_]*)\s*=\s*'([^']+)'/g)]
				.map(match => [match[1], match[2]]));
			const named = [...joined.matchAll(/actionID:\s*(?:'([^']+)'|([A-Za-z_$][\w$]*))/g)]
				.map(match => match[1] || consts.get(match[2]) || match[2]);
			const registered = new Set([...joined.matchAll(/registerPersistentErrorAction\(\s*(?:'([^']+)'|([A-Za-z_$][\w$]*))/g)]
				.map(match => match[1] || consts.get(match[2]) || match[2]));

			assert.ok(named.length > 0, 'found no banner actions at all — this test has stopped seeing them');
			const dead = [...new Set(named)].filter(id => !registered.has(id));
			assert.deepStrictEqual(dead, [], `these banner buttons name an action nothing registers, so pressing them dismisses the banner and does nothing: ${dead.join(', ')}`);
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
			assert.ok(banner.textContent.includes('boom'), 'the composed message is what the user should read');
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

		//COMMENTS ARE STRIPPED FIRST. Three times on this branch a source pin
		//matched PROSE rather than code — twice on a comment explaining why the
		//very thing being forbidden is absent. A pin that can be satisfied or
		//broken by a comment is not testing the product.
		//
		//And these assert VALUES, not existence. Adversarial review showed the
		//earlier existence-only pins surviving a mutation that set the
		//editor-open clearance to 0.1rem — restoring, with the suite green, the
		//exact shipped bug whose comment says it "told the user to press
		//exactly the two controls it was blocking".
		it('pins the layout invariants jsdom cannot see', async () => {
			const {readFileSync} = await import('fs');
			const raw = readFileSync(new URL('../../src/components/card-web-app.ts', import.meta.url), 'utf8');
			const source = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

			assert.ok(/\.banners\s*\{[^}]*position:\s*fixed/.test(source), 'the container owns the fixed positioning');
			assert.ok(/\.banners\s*\{[^}]*pointer-events:\s*none/.test(source), 'the container must not eat clicks meant for what is underneath');
			//The editor's fixed Save/Cancel row sits in this corner. 4.25rem is
			//the value the old .update-ready.editor-open used, and it is what
			//keeps a banner off those two controls.
			assert.ok(/\.banners\.editor-open\s*\{[^}]*bottom:\s*4\.25rem/.test(source), 'the editor Save/Cancel clearance must be 4.25rem, not merely present');
			//card-drawer's create-card buttons occupy x 16-104 at bottom-left.
			//Real clicks at 390px landed on the draft banner's DISCARD control
			//when the banner width let it reach them.
			assert.ok(/max-width:\s*calc\(100vw\s*-\s*11\.5rem\)/.test(source), 'the banner width must leave the drawer create buttons alone');
			assert.ok(!/\.draft-recovery\s*\{\s*bottom/.test(source), 'the per-banner bottom offsets should be gone');
			//A toast arriving must not shove the persistent banners: the column
			//is bottom-anchored, so the snack bar goes FIRST.
			const markup = source.slice(source.indexOf('banners $'));
			assert.ok(markup.indexOf('<snack-bar>') < markup.indexOf('error-banner'), 'the snack bar must be the first child, or every toast moves the stack');
		});

	});

});

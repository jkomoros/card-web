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
import {bootstrapApp, harnessAlerts, clearHarnessAlerts, clearAuxQueue} from '../harness-support/app-harness.js';

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

		//A stuck write that is later discarded must REPLACE its own notice, not
		//stack a second one under it. Review demonstrated the two-key version:
		//"still saved on this device and is being retried" left sitting directly
		//above "won't be retried again", with no way to clear the false one but by
		//hand. Every intent that ages out at 30 days takes exactly this path, so it
		//is the ordinary route rather than an exotic one. The key is the INTENT's
		//id (minted once, stable through the whole lifecycle), so one write's two
		//states still collapse.
		it('replaces a stuck notice when the same write is later discarded', () => {
			store.dispatch(reportPersistentError({
				what: 'Saving your edit to that comment isn\u2019t going through.',
				reassurance: 'Your change is still saved on this device and is being retried.',
				dedupeKey: 'aux-write-1724-1-abc123'
			}));
			store.dispatch(reportPersistentError({
				what: 'Saving your edit to that comment didn\u2019t go through, and won\u2019t be retried again.',
				reassurance: 'You can try it again.',
				dedupeKey: 'aux-write-1724-1-abc123'
			}));
			const live = errors();
			assert.strictEqual(live.length, 1, `the discard must replace the stuck notice, not stack under it; got ${JSON.stringify(live.map(entry => entry.what))}`);
			assert.match(live[0].what, /won\u2019t be retried again/);
			assert.doesNotMatch(`${live[0].what} ${live[0].reassurance}`, /still saved on this device/,
				'the retry reassurance is false once the write has been given up on');
		});

		//The two banners can only replace each other if they SHARE a key, so pin
		//that the two subscribers still derive it the same way \u2014 and that the
		//derivation is per intent.id, NOT per intent.kind. The kind-based key
		//collapsed two DIFFERENT lost writes of the same kind (two comments on
		//different cards discarded in one replay pass) into one banner: the
		//reducer's replace-in-place told the user about the second loss and never
		//the first. The behavioral half of that lives in the 'two losses' suite
		//below.
		it('derives one dedupe key per INTENT for both the stuck and discarded reports', () => {
			const source = readFileSync(new URL('../../src/actions/user.ts', import.meta.url), 'utf8');
			const keys = [...source.matchAll(/dedupeKey:\s*([^,\n}]+)/g)]
				.map(match => match[1].trim())
				.filter(raw => /aux/i.test(raw));
			assert.ok(keys.length >= 2, `expected both aux-write reports to set a dedupeKey, found ${keys.length}`);
			assert.strictEqual(new Set(keys).size, 1,
				`stuck and discarded must share one key or they stack: ${JSON.stringify(keys)}`);
			//Comments stripped first, per this file's own rule: a pin a comment can
			//satisfy is not testing the product.
			const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
			const derivation = code.match(/auxWriteBannerKey\s*=[^;]*=>\s*`aux-write-\$\{intent\.(\w+)\}`/);
			assert.ok(derivation, 'auxWriteBannerKey must derive the key from a single intent field this test can see');
			assert.strictEqual(derivation[1], 'id',
				`the key must ride the intent's identity, not its ${derivation[1]}: a per-kind key collapses distinct losses into one banner`);
		});

		it('keeps two unrelated failures apart', () => {
			store.dispatch(reportPersistentError({what: 'A failed.', dedupeKey: 'a'}));
			store.dispatch(reportPersistentError({what: 'B failed.', dedupeKey: 'b'}));
			assert.strictEqual(errors().length, 2);
		});

		//A banner whose actionID names nothing renders a button that, when
		//pressed, dismisses the banner and then silently finds no thunk — the
		//failure looks handled. Source-text pin because the alternative is
		//importing user.js, which drags in firebase; idiom from
		//test/util/scrollbar-convention.test.js.
		//
		//WHAT THIS CANNOT DO, stated plainly so nobody trusts it further than it
		//goes: it is a SPELLING check, not a liveness check. Registration is lazy
		//(ensureSignInRetryRegistered), so whether a thunk is actually found at
		//press time depends on whether that ran — and deleting the call would
		//leave this green. An earlier version of this test also only caught the
		//single literal form it had been mutation-tested against; review showed
		//template-literal, double-quoted, shorthand and helper-call forms all
		//sailing through. So the rule now is: every actionID must be statically
		//resolvable, and anything this test cannot resolve is a FAILURE rather
		//than a silent pass. "I could not analyse it" must never read as "fine".
		it('registers every actionID that any banner names', () => {
			const root = new URL('../../src/', import.meta.url);
			const walk = dir => readdirSync(dir, {withFileTypes: true}).flatMap(entry => {
				const child = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir);
				return entry.isDirectory() ? walk(child) : (entry.name.endsWith('.ts') ? [child] : []);
			});
			const joined = walk(root)
				.map(file => readFileSync(file, 'utf8'))
				.map(source => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''))
				.join('\n');

			//Const declarations in either quote style, so `actionID: SOME_CONST`
			//and `registerPersistentErrorAction(SOME_CONST, …)` both resolve.
			const consts = new Map([...joined.matchAll(/const\s+([A-Za-z_$][\w$]*)\s*=\s*['"]([^'"]+)['"]/g)]
				.map(match => [match[1], match[2]]));
			const resolve = raw => {
				const trimmed = raw.trim();
				const literal = trimmed.match(/^['"]([^'"]*)['"]$/);
				if (literal) return literal[1];
				//A template literal with no ${} is just a string; one WITH ${} is
				//computed and therefore unresolvable, which is the point.
				const template = trimmed.match(/^`([^`]*)`$/);
				if (template && !template[1].includes('${')) return template[1];
				if (consts.has(trimmed)) return consts.get(trimmed);
				return null;
			};

			//Everything up to the closing brace or the next property. TYPE positions
			//match this shape too — `actionID : string` in the PersistentError type,
			//and `{[actionID : string] : ThunkSomeAction}` in the registry — so drop
			//values that are a bare TS primitive. Those are declarations, not banners.
			const named = [...joined.matchAll(/actionID\s*:\s*([^,}\n]+)/g)]
				.map(match => match[1])
				.filter(raw => !/^(string|number|boolean)\b/.test(raw.trim()));
			//THE UNION IS NECESSARY, AND IT IS WHY THE COUNTS BELOW EXIST.
			//
			//The `actionID:` property shape is shared by both action registries —
			//persistent-error banners AND snackbar messages (the collection
			//composer's navigation receipts were the first snackbar actions in
			//src/). The invariant is the same for both surfaces: a named action
			//nothing registers is a dead button. Text-level scanning cannot tell
			//which registry a given `actionID:` SITE belongs to — the property
			//sits in an options object, not in the registering call — so this
			//counts registrations in either.
			//
			//On its own that is a real weakening: a banner naming an id only the
			//SNACKBAR registry holds would pass. So the mechanism gets a ratchet
			//of its own rather than a wider net and a shrug. Pinning the exact
			//count of each register variant is what makes a DELETED or renamed
			//registration fail here instead of being absorbed by the other
			//registry's names.
			const persistentRegistrations = [...joined.matchAll(/registerPersistentErrorAction\(\s*([^,]+),/g)];
			const snackbarRegistrations = [...joined.matchAll(/registerSnackbarAction\(\s*([^,]+),/g)];
			const registered = new Set([...persistentRegistrations, ...snackbarRegistrations]
				.map(match => resolve(match[1])).filter(id => id !== null));

			//Measured, and a deliberate edit to change. One persistent-error
			//action (the sign-in retry) and one snackbar action (undo a
			//collection navigation). Adding either kind is fine and costs one
			//line here; losing one silently is what this stops.
			assert.strictEqual(persistentRegistrations.length, 1,
				'the number of registerPersistentErrorAction calls changed — if that is deliberate, say so by editing this line');
			assert.strictEqual(snackbarRegistrations.length, 1,
				'the number of registerSnackbarAction calls changed — if that is deliberate, say so by editing this line');
			//And every registration has to be statically resolvable, or the set
			//above is short a name and the dead check below is lying.
			assert.strictEqual(registered.size, persistentRegistrations.length + snackbarRegistrations.length,
				'a registration\'s actionID is computed or duplicated, so this test cannot vouch for it');

			assert.ok(named.length > 0, 'found no banner actions at all — this test has stopped seeing them');

			const unresolvable = named.filter(raw => resolve(raw) === null);
			assert.deepStrictEqual(unresolvable, [],
				'these actionIDs are computed, so this test cannot tell whether anything registers them. ' +
				'Use a literal or a module-level const instead, or this check is worthless for them: ' + unresolvable.join(', '));

			const dead = [...new Set(named.map(resolve))].filter(id => !registered.has(id));
			assert.deepStrictEqual(dead, [],
				`these banner buttons name an action nothing registers, so pressing them dismisses the banner and does nothing: ${dead.join(', ')}`);
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

//TWO DIFFERENT LOSSES ARE TWO BANNERS, driven through the real queue and the
//real reporters rather than the reducer alone. The per-kind dedupe key made
//two comments on different cards, discarded in one replay pass, collapse into
//one banner: the reducer's replace-in-place told the user about the second
//loss and never the first. The key justification — a stuck write's discard
//must REPLACE its own notice — only ever covered two states of the SAME
//intent, and the intent's once-minted id serves it equally well.
describe('two distinct losses of the same kind', () => {

	let queue;

	before(async function() {
		this.timeout(20000);
		//Importing user.js registers the discard/stuck banner reporters at
		//module scope (deliberately — see the comment there: reporting a lost
		//write must not be contingent on any install step). It also registers
		//the real Firestore executors, which the test below overrides with a
		//stub — nothing here touches the network.
		await import('../../lib/src/actions/user.js');
		queue = await import('../../lib/src/aux-write-queue.js');
	});

	beforeEach(() => {
		for (const entry of [...errors()]) store.dispatch(dismissPersistentError(entry.id));
		clearHarnessAlerts();
		clearAuxQueue();
	});

	//A coded error, so the queue classifies it permanent and DISCARDS rather
	//than retaining for retry — the discard is what mints a banner.
	const permanent = () => Object.assign(new Error('Missing or insufficient permissions.'), {code: 'permission-denied'});

	it('produces TWO banners instead of the second silently replacing the first', async () => {
		queue.registerAuxWriteExecutor('star-add', async () => { throw permanent(); });
		//Two different cards, one kind, both given up on — the shape of one
		//pass discarding two separate writes.
		await queue.runDurableAuxWrite(queue.makeAuxWriteIntent(app.uid, 'star-add', 'card-loss-one'));
		await queue.runDurableAuxWrite(queue.makeAuxWriteIntent(app.uid, 'star-add', 'card-loss-two'));
		await new Promise(resolve => setTimeout(resolve, 0));
		const live = errors();
		assert.strictEqual(live.length, 2,
			`two lost writes are two pieces of news, not one banner replaced in place; got ${JSON.stringify(live.map(entry => entry.what))}`);
		assert.notStrictEqual(live[0].dedupeKey, live[1].dedupeKey,
			'distinct intents must carry distinct dedupe keys or the reducer collapses them');
	});
});

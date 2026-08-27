/*eslint-env node, es2022*/

//THE SNACK BAR HOLDS A QUEUE, AND THE TIMER LIVES WITH VISIBILITY
//
//The old snack-bar had one message string and one MODULE-LEVEL timer handle that
//every showSnackbar() cleared and reset. So a second outcome both replaced the
//first's text and restarted its clock: two things happening close together
//showed one of them, silently. #758 documents the consequence — the one
//non-modal messaging channel the app already had was "used once, ever", because
//it could not be trusted to actually show what it was given.
//
//These tests pin the queue, the per-message timers, and the vocabulary from
//#758's already-clean three-valued model (committed / queued / discarded), where
//only `discarded` is bad news and `queued` must never lead with a failure verb.

import assert from 'assert';
import {bootstrapApp} from '../harness-support/app-harness.js';

const app = await bootstrapApp();
const {dom, store} = app;

const {
	showSnackbar,
	dismissSnackbar,
	runSnackbarAction,
	registerSnackbarAction
} = await import('../../lib/src/actions/app.js');

const {outcomeMessage, DEFAULT_DURATIONS, MINIMUM_DURATION_WITH_ACTION} = await import('../../lib/src/snackbar-copy.js');

const snackbars = () => store.getState().app.snackbars;

const clear = () => {
	for (const entry of [...snackbars()]) store.dispatch(dismissSnackbar(entry.id));
};

describe('the snack bar queue (#758)', () => {

	beforeEach(clear);

	//THE headline bug. Two messages in one turn used to leave one.
	it('keeps BOTH messages when two arrive together', () => {
		store.dispatch(showSnackbar('first'));
		store.dispatch(showSnackbar('second'));

		const messages = snackbars().map(entry => entry.message);
		assert.deepStrictEqual(messages, ['first', 'second'], 'a second message must not destroy the first');
	});

	it('gives each message its own identity, so dismissing one leaves the other', () => {
		store.dispatch(showSnackbar('first'));
		store.dispatch(showSnackbar('second'));
		const [first] = snackbars();

		store.dispatch(dismissSnackbar(first.id));

		assert.deepStrictEqual(snackbars().map(entry => entry.message), ['second']);
	});

	it('refreshes in place when a message carries a dedupeKey', () => {
		store.dispatch(showSnackbar('You are now offline.', {dedupeKey: 'connectivity'}));
		store.dispatch(showSnackbar('You are now online.', {dedupeKey: 'connectivity'}));
		store.dispatch(showSnackbar('You are now offline.', {dedupeKey: 'connectivity'}));

		assert.strictEqual(snackbars().length, 1, 'connectivity flapping should refresh one message, not stack three');
		assert.strictEqual(snackbars()[0].message, 'You are now offline.', 'the refreshed message should be the latest');
	});

	it('does not confuse two different dedupeKeys', () => {
		store.dispatch(showSnackbar('a', {dedupeKey: 'one'}));
		store.dispatch(showSnackbar('b', {dedupeKey: 'two'}));
		assert.strictEqual(snackbars().length, 2);
	});

	it('treats a repeat dismiss as already-handled', () => {
		store.dispatch(showSnackbar('only'));
		const [entry] = snackbars();

		store.dispatch(dismissSnackbar(entry.id));
		//A timer can fire on a message the user just closed.
		assert.doesNotThrow(() => store.dispatch(dismissSnackbar(entry.id)));
		assert.strictEqual(snackbars().length, 0);
	});

	describe('durations come from the kind, not from each call site guessing', () => {

		it('makes a discarded write STICKY, because that is the one that lost data', () => {
			store.dispatch(showSnackbar(outcomeMessage('discarded', 'card', 3), {kind: 'discarded'}));
			assert.strictEqual(snackbars()[0].durationMs, 0, 'a discarded write must not evaporate on a timer');
		});

		it('gives a queued write the durability-promise duration the app already chose', () => {
			store.dispatch(showSnackbar('queued', {kind: 'queued'}));
			assert.strictEqual(snackbars()[0].durationMs, DEFAULT_DURATIONS['queued']);
		});

		it('lengthens anything with a button, so it cannot vanish mid-reach', () => {
			store.dispatch(showSnackbar('sign in?', {kind: 'info', action: {label: 'Sign in', actionID: 'sign-in'}}));
			assert.ok(snackbars()[0].durationMs >= MINIMUM_DURATION_WITH_ACTION);
		});

		it('does not un-stick a sticky message just because it has a button', () => {
			store.dispatch(showSnackbar('lost', {kind: 'discarded', action: {label: 'Retry', actionID: 'retry'}}));
			assert.strictEqual(snackbars()[0].durationMs, 0, 'a discarded write stays until dismissed even with an action');
		});

	});

	describe('the outcome vocabulary', () => {

		//#758: five prose phrasings all reconstructing one clean enum, and the
		//only one that means data did NOT survive is the hardest to pick out.
		it('never leads a queued write with a failure verb', () => {
			const message = outcomeMessage('queued', 'card', 2);
			for (const verb of ['could not', 'failed', 'error', 'Failed']) {
				assert.ok(!message.includes(verb), `a queued write is SAVED; "${verb}" tells the user it was not`);
			}
			assert.ok(message.includes('Nothing is lost.'), 'the reassurance is the point of this message');
		});

		it('does say plainly when a write was discarded', () => {
			assert.ok(/could not be saved/.test(outcomeMessage('discarded', 'card', 1)));
		});

		it('agrees with itself about singular and plural', () => {
			assert.ok(outcomeMessage('committed', 'card', 1).includes('1 card '), 'one card, not one cards');
			assert.ok(outcomeMessage('committed', 'card', 2).includes('2 cards '));
		});

	});

	it('settles the promise of a message a dedupeKey replaces', async () => {
		const first = store.dispatch(showSnackbar('offline', {dedupeKey: 'connectivity'}));
		store.dispatch(showSnackbar('online', {dedupeKey: 'connectivity'}));

		//The replaced message is gone from the screen, so its promise must
		//settle. It used to sit unresolved forever, and any caller awaiting it
		//hung.
		assert.strictEqual(await first, 'dismissed');
	});

	describe('the action button', () => {

		it('runs the registered thunk and reports that it was pressed', async () => {
			let ran = 0;
			registerSnackbarAction('test-action', () => { ran++; });
			const outcome = showSnackbar('press me', {action: {label: 'Press', actionID: 'test-action'}});
			const pending = store.dispatch(outcome);
			const [entry] = snackbars();

			store.dispatch(runSnackbarAction(entry.id, 'test-action'));

			assert.strictEqual(await pending, 'action', 'the caller should be able to tell a press from a timeout');
			assert.strictEqual(ran, 1);
			assert.strictEqual(snackbars().length, 0, 'pressing the button should dismiss the message');
		});

		it('reports a plain dismissal as dismissed, not as a press', async () => {
			const pending = store.dispatch(showSnackbar('ignore me'));
			const [entry] = snackbars();

			store.dispatch(dismissSnackbar(entry.id));

			assert.strictEqual(await pending, 'dismissed');
		});

		it('never puts a function in the store', () => {
			registerSnackbarAction('serializable-check', () => {});
			store.dispatch(showSnackbar('press me', {action: {label: 'Press', actionID: 'serializable-check'}}));
			const [entry] = snackbars();
			assert.strictEqual(typeof entry.action.actionID, 'string');
			assert.deepStrictEqual(JSON.parse(JSON.stringify(entry)), entry, 'a queued message must survive a JSON round trip');
		});

	});

	describe('mounted for real', () => {

		let element;

		before(async function() {
			this.timeout(20000);
			await import('../../lib/src/components/snack-bar.js');
			element = dom.window.document.createElement('snack-bar');
			dom.window.document.body.appendChild(element);
			await new Promise(resolve => setTimeout(resolve, 0));
		});

		after(() => element.remove());

		beforeEach(async () => {
			clear();
			element.stateChanged(store.getState());
			await element.updateComplete;
		});

		//A live region created at the same moment as its content is not
		//announced, so both must exist before anything is pushed.
		it('has both live regions before any message exists', () => {
			assert.ok(element.shadowRoot.querySelector('[role=status][aria-live=polite]'), 'missing the polite region');
			assert.ok(element.shadowRoot.querySelector('[role=alert]'), 'missing the alert region');
		});

		//This test used to assert that no element carries aria-live=assertive,
		//and it passed — while role='alert' supplied assertive IMPLICITLY. It
		//pinned the absence of an attribute while the behaviour was the thing it
		//claimed to forbid. A discarded write IS work at risk under §3.6.4, so
		//the routing stays and the false claim goes.
		it('routes ONLY a discarded write to the assertive region', async () => {
			store.dispatch(showSnackbar('routine', {kind: 'committed'}));
			element.stateChanged(store.getState());
			await element.updateComplete;
			assert.strictEqual(element.shadowRoot.querySelector('[role=alert]').textContent.trim(), '', 'a routine outcome must not interrupt');

			store.dispatch(showSnackbar('lost it', {kind: 'discarded'}));
			element.stateChanged(store.getState());
			await element.updateComplete;
			assert.ok(element.shadowRoot.querySelector('[role=alert]').textContent.includes('lost it'));
		});

		//The live regions carry TEXT ONLY. When the toasts lived inside them,
		//every arrival re-announced the whole subtree including button labels,
		//because status and alert are implicitly aria-atomic.
		it('announces words, not the whole toast subtree', async () => {
			store.dispatch(showSnackbar('a message', {action: {label: 'Press me', actionID: 'noop'}}));
			element.stateChanged(store.getState());
			await element.updateComplete;

			const polite = element.shadowRoot.querySelector('[role=status]');
			assert.ok(polite.textContent.includes('a message'));
			assert.ok(!polite.textContent.includes('Press me'), 'a button label must not be read out as part of the message');
			assert.strictEqual(polite.querySelector('button'), null, 'the live region must not contain controls');
		});

		//Layout lived on :host, whose only children were the two live-region
		//divs — so gap never separated toasts and column-reverse only swapped
		//the regions. Three messages rendered as one flush slab, oldest on top.
		it('lays out the toasts themselves, newest first', async () => {
			store.dispatch(showSnackbar('older'));
			store.dispatch(showSnackbar('newer'));
			element.stateChanged(store.getState());
			await element.updateComplete;

			const list = element.shadowRoot.querySelector('.toasts');
			assert.ok(list, 'the toasts need their own flex container');
			assert.strictEqual(list.querySelectorAll('.toast').length, 2, 'both toasts must be children of the list that has the flex');
			//column-reverse renders the LAST child at the top.
			const texts = [...list.querySelectorAll('.toast')].map(node => node.textContent.trim());
			assert.ok(texts[texts.length - 1].includes('newer'), 'the newest must be last in DOM so column-reverse puts it on top');
		});

		//mobile was a @property, and Lit does not reflect by default, so
		//:host([mobile]) could never match: the entire mobile branch was dead
		//and a toast covered the update banner's Reload button on a phone.
		it('marks mobile as a CLASS on the host, so the mobile rule can match', async () => {
			const state = store.getState();
			element.stateChanged({...state, app: {...state.app, mobileMode: true}});
			await element.updateComplete;
			assert.ok(element.classList.contains('mobile'), 'the mobile branch is unreachable without a class on the host');

			element.stateChanged({...state, app: {...state.app, mobileMode: false}});
			await element.updateComplete;
			assert.ok(!element.classList.contains('mobile'));
		});

		it('routes a discarded write to the alert region and everything else to the polite one', async () => {
			store.dispatch(showSnackbar('lost it', {kind: 'discarded'}));
			store.dispatch(showSnackbar('saved it', {kind: 'committed'}));
			element.stateChanged(store.getState());
			await element.updateComplete;

			const alertText = element.shadowRoot.querySelector('[role=alert]').textContent;
			const politeText = element.shadowRoot.querySelector('[role=status]').textContent;
			assert.ok(alertText.includes('lost it'), 'a discarded write should be announced as an alert');
			assert.ok(politeText.includes('saved it'));
			assert.ok(!politeText.includes('lost it'));
			//Both messages are still SHOWN, whatever their announcement routing.
			const shown = element.shadowRoot.querySelector('.toasts').textContent;
			assert.ok(shown.includes('lost it') && shown.includes('saved it'), 'announcement routing must not change what is visible');
		});

		it('shows at most three at once, and does not lose the rest', async () => {
			for (let i = 0; i < 5; i++) store.dispatch(showSnackbar(`message ${i}`));
			element.stateChanged(store.getState());
			await element.updateComplete;

			assert.strictEqual(element.shadowRoot.querySelectorAll('.toast').length, 3, 'more than three stacked toasts is a wall, not a report');
			assert.strictEqual(snackbars().length, 5, 'the overflow must still be queued, not dropped');
		});

		//A 'discarded' message is sticky by design. Taking the OLDEST three for
		//the visible window let one sticky message plus two others hold it
		//permanently, so a burst showed three and silently never showed the
		//rest.
		it('does not let a sticky message starve everything queued behind it', async () => {
			store.dispatch(showSnackbar('lost it', {kind: 'discarded'}));
			for (let i = 0; i < 4; i++) store.dispatch(showSnackbar(`later ${i}`));
			element.stateChanged(store.getState());
			await element.updateComplete;

			const shown = element.shadowRoot.textContent;
			assert.ok(shown.includes('later 3'), 'the newest message must be visible even behind a sticky one');
			assert.strictEqual(snackbars().length, 5, 'the sticky message must still be queued, not dropped');
			assert.ok(snackbars().some(entry => entry.kind === 'discarded'), 'a discarded write must not be evicted to make room');
		});

		//A REFUSAL MUST NOT LOOK LIKE A RUNNING COMMENTARY.
		//
		//The dot existed for 'queued' and 'discarded' only, so 'refused' — the
		//app declining to do what was asked — rendered pixel-identical to
		//'info'. The three dotted kinds are the three that are not routine;
		//committed and info stay bare, because a dot for "it worked" is noise.
		it('marks a refusal, and leaves routine outcomes unmarked', async () => {
			const dotFor = async (kind) => {
				clear();
				store.dispatch(showSnackbar(`A ${kind} outcome.`, {kind}));
				element.stateChanged(store.getState());
				await element.updateComplete;
				return element.shadowRoot.querySelector('.toast .dot');
			};
			assert.ok(await dotFor('refused'), 'a refusal is not routine and must be marked');
			assert.ok(await dotFor('queued'));
			assert.ok(await dotFor('discarded'));
			assert.strictEqual(await dotFor('info'), null, 'a dot for "it worked" is noise');
			assert.strictEqual(await dotFor('committed'), null);

			//And the mark DIFFERS from the one 'discarded' carries: both are
			//red, because in neither case did the user get what they asked for,
			//but a refusal lost nothing, so it is hollow rather than filled.
			//JSDOM computes no styles, so the rules are read directly.
			const styles = element.constructor.styles.map(sheet => String(sheet.cssText || '')).join('\n');
			const refused = styles.match(/\.toast\[data-kind='refused'\] \.dot \{[^}]*\}/);
			assert.ok(refused, 'the refused kind needs a treatment of its own');
			assert.match(refused[0], /var\(--app-warning-color\)/, 'what was asked for did not happen (HS-4.5)');
			assert.ok(!/background:/.test(refused[0]),
				'a filled dot is what "happened and did not survive" means; a refusal lost nothing');
			assert.match(styles, /\.toast\[data-kind='discarded'\] \.dot \{[^}]*background:\s*var\(--app-warning-color\)/,
				'and discarded keeps the filled one it had');
		});

		it('names its dismiss button for hover AND assistive tech', async () => {
			store.dispatch(showSnackbar('a message'));
			element.stateChanged(store.getState());
			await element.updateComplete;

			const dismiss = element.shadowRoot.querySelector('button.discard');
			assert.strictEqual(dismiss.getAttribute('aria-label'), 'Dismiss');
			assert.strictEqual(dismiss.getAttribute('title'), 'Dismiss');
		});

		it('clears every pending timer when it is torn down', async () => {
			store.dispatch(showSnackbar('a message'));
			element.stateChanged(store.getState());
			await element.updateComplete;
			assert.ok(element._timers.size > 0, 'precondition: a visible message should be counting down');

			element.disconnectedCallback();
			assert.strictEqual(element._timers.size, 0, 'a torn-down element must not dispatch later');
			element.connectedCallback();
		});

		it('restarts timers after a hover ends', async () => {
			store.dispatch(showSnackbar('a message'));
			element.stateChanged(store.getState());
			await element.updateComplete;

			element._handlePause();
			assert.strictEqual(element._timers.size, 0, 'hovering should stop the clock');
			element._handleResume();
			assert.ok(element._timers.size > 0, 'leaving must restart it, or one hover pins every message forever');
		});

		it('restarts timers when it is reconnected', async () => {
			store.dispatch(showSnackbar('a message'));
			element.stateChanged(store.getState());
			await element.updateComplete;

			element.disconnectedCallback();
			assert.strictEqual(element._timers.size, 0);
			element.connectedCallback();
			await element.updateComplete;
			assert.ok(element._timers.size > 0, 'a DOM move must not make everything on screen permanent');
		});

		//jsdom does no layout, so the tests above assert the DOM contract
		//(newest LAST so column-reverse puts it on top) and cannot verify that
		//the CSS actually does it. Adversarial review confirmed the gap by
		//mutation: flipping column-reverse to column left all of them green.
		//These are source-text pins, the same idiom test/util uses, for the
		//three CSS invariants that carry real user consequences and that jsdom
		//cannot reach.
		it('pins the CSS invariants jsdom cannot see', async () => {
			const {readFileSync} = await import('fs');
			const source = readFileSync(new URL('../../src/components/snack-bar.ts', import.meta.url), 'utf8');

			assert.ok(/\.toasts\s*\{[^}]*flex-direction:\s*column-reverse/.test(source), 'the toast list must be column-reverse, or the newest message renders at the bottom');
			assert.ok(/:host\s*\{[^}]*pointer-events:\s*none/.test(source), 'the host must not eat clicks meant for what is underneath it');
			//It used to anchor itself bottom-centre over everything else. There
			//is only one bottom band, and the banner stack already owns it — a
			//fixed toast landed on top of the error banner at narrow widths and
			//won on z-index. card-web-app renders this inside .banners now, so
			//positioning itself would put it back on top of them.
			assert.ok(!/:host\s*\{[^}]*position:\s*fixed/.test(source), 'the snack bar must not position itself; it shares the banner stack');
			//Matches a DECLARATION, not the word. An earlier version of this pin
			//used /z-index/ and failed on the comment that explains why there
			//is no z-index — the second time on this branch that a source pin
			//matched prose instead of code.
			assert.ok(!/z-index:\s*\d/.test(source), 'z-index belongs to the container that owns the corner, not to a member of the stack');
			assert.ok(/:host\(\.mobile\)/.test(source), 'the mobile rule must key off a CLASS; an attribute selector cannot match an unreflected property');
		});

		//The structural fix: a message waiting behind others has no clock at
		//all, so its time starts when it appears rather than while it is hidden.
		it('does not start a timer for a message that is not visible yet', async () => {
			for (let i = 0; i < 5; i++) store.dispatch(showSnackbar(`message ${i}`));
			element.stateChanged(store.getState());
			await element.updateComplete;

			assert.strictEqual(element._timers.size, 3, 'only the visible messages should be counting down');
		});

		it('does not start a timer for a sticky message', async () => {
			store.dispatch(showSnackbar('lost it', {kind: 'discarded'}));
			element.stateChanged(store.getState());
			await element.updateComplete;

			assert.strictEqual(element._timers.size, 0, 'a sticky message must not be on a clock');
		});

	});

});

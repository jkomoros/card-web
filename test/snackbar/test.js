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

		//HOUSE-STYLE §3.6.4 reserves assertive for work at risk, and names the
		//unsaved-draft banner as the bar. A toast is never that.
		it('never uses aria-live=assertive', () => {
			assert.strictEqual(element.shadowRoot.querySelector('[aria-live=assertive]'), null);
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

		it('names its dismiss button for hover AND assistive tech', async () => {
			store.dispatch(showSnackbar('a message'));
			element.stateChanged(store.getState());
			await element.updateComplete;

			const dismiss = element.shadowRoot.querySelector('button.small');
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

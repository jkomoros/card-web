/*eslint-env node, es2022*/

//DOES THE DIALOG FOCUS CONTRACT ACTUALLY HOLD?
//
//DialogElement grew ARIA, a Tab trap and return-focus-on-close. Three separate
//adversarial reviews found three separate user-visible regressions in that
//work, and `npm run test:ci` was green for all three, because nothing in the
//suite exercised dialog focus, Tab, or ARIA at all. Every one of them was
//caught by hand-driven Playwright and would have shipped otherwise.
//
//The three, and the assertion each one earns below:
//
//  1. The first trap compared against shadowRoot.activeElement, which reports
//     the HOST when focus is inside a child custom element. Any dialog
//     containing a tag-list or a card-drawer therefore concluded "focus is
//     nowhere in my list" and yanked it to the first control: multi-edit
//     collapsed to a three-element Tab cycle and find-dialog's "Next 250 cards"
//     button became unreachable. => the walk must DESCEND INTO SHADOW ROOTS.
//
//  2. The sentinels were first placed as CHILDREN of .content, so the start
//     sentinel sat after the panel in tab order and could not tell "wrapped
//     from the end" from "arrived from before the panel". Clicking a dialog's
//     title and pressing Tab jumped to the last control, and Shift-Tab escaped
//     the dialog entirely. => the sentinels must be SIBLINGS of .content.
//
//  3. Return-focus-on-close fired unconditionally. Cmd-K linking is
//     focusPolicy:'allow-text-fields' on purpose, so it runs from the Title
//     field; closing the find dialog then restored the caret to the card BODY
//     and this code pulled focus back to Title, sending the user's next
//     keystroke into the wrong field. => return-focus must NOT fire when
//     something else has taken focus.
//
//Two assertions that looked reasonable were removed after mutation testing
//showed they could not fail: one asserted the walk never returns a sentinel
//(unreachable — the walk starts at .content and the sentinels are siblings of
//it), and one asserted that closing with a detached opener does not throw
//(.focus() on a detached element is a silent no-op). A test that cannot fail
//inflates the count and implies coverage that is not there, which is the exact
//problem this file exists to correct.
//
//jsdom does no layout, so offsetParent is null for everything and the real
//visibility filter cannot run. It is stubbed per-test below; that is honest for
//the traversal shape (descent, summary, sentinel exclusion), which is what
//regressed, and it is NOT a substitute for pressing real Tab keys. The
//real-key guard belongs in test/perf-harness, which is the only place in this
//repo that presses a key in a real browser.

import assert from 'assert';
import {bootstrapApp} from '../harness-support/app-harness.js';

const app = await bootstrapApp();
const {dom} = app;

const nextTurn = () => new Promise(resolve => setTimeout(resolve, 0));

//Make everything "visible" except nodes explicitly marked, so the walk's
//offsetParent filter is exercised rather than short-circuited.
const stubLayout = () => {
	Object.defineProperty(dom.window.HTMLElement.prototype, 'offsetParent', {
		configurable: true,
		get() { return this.hasAttribute('data-test-hidden') ? null : (this.parentNode || dom.window.document.body); },
	});
};

describe('the DialogElement focus contract', () => {

	let element;

	before(async function() {
		this.timeout(20000);
		stubLayout();
		await import('../../lib/src/components/dialog-element.js');
		element = dom.window.document.createElement('dialog-element');
		element.title = 'Test Dialog';
		dom.window.document.body.appendChild(element);
		await nextTurn();
	});

	after(() => {
		element.remove();
	});

	describe('structure and ARIA', () => {

		it('labels the close button for both hover and assistive tech', () => {
			const close = element.shadowRoot.querySelector('#close');
			assert.ok(close, 'no close button');
			//This one button is the close control of every dialog in the app,
			//so an unlabelled one is eight unlabelled controls.
			assert.strictEqual(close.getAttribute('aria-label'), 'Close dialog');
			assert.strictEqual(close.getAttribute('title'), 'Close dialog');
		});

		it('marks the panel as a modal dialog labelled by its own heading', () => {
			const content = element.shadowRoot.querySelector('.content');
			assert.strictEqual(content.getAttribute('role'), 'dialog');
			assert.strictEqual(content.getAttribute('aria-modal'), 'true');
			const labelledBy = content.getAttribute('aria-labelledby');
			const heading = element.shadowRoot.querySelector('#' + labelledBy);
			assert.ok(heading, 'aria-labelledby points at nothing');
			assert.strictEqual(heading.textContent, 'Test Dialog');
		});

		it('lets a subclass declare itself an alertdialog', async () => {
			element.dialogRole = 'alertdialog';
			await element.updateComplete;
			assert.strictEqual(element.shadowRoot.querySelector('.content').getAttribute('role'), 'alertdialog');
			element.dialogRole = 'dialog';
			await element.updateComplete;
		});

		//REGRESSION 2. As children of .content the start sentinel sat after the
		//panel in tab order, so backward navigation never reached it and
		//Shift-Tab walked out of the dialog into the page behind.
		it('places both focus sentinels as SIBLINGS of the panel, not inside it', () => {
			const shadowRoot = element.shadowRoot;
			const background = shadowRoot.querySelector('.background');
			const children = [...background.children];
			const sentinels = children.filter(child => child.classList.contains('focus-sentinel'));
			assert.strictEqual(sentinels.length, 2, 'expected exactly two sentinels in .background');
			assert.strictEqual(shadowRoot.querySelector('.content').querySelectorAll('.focus-sentinel').length, 0, 'a sentinel is inside .content; backward Tab will escape the dialog');
			assert.strictEqual(children[0], sentinels[0], 'the first sentinel must precede the panel');
			assert.strictEqual(children[children.length - 1], sentinels[1], 'the last sentinel must follow the panel');
			assert.ok(sentinels.every(sentinel => sentinel.getAttribute('tabindex') === '0'), 'a sentinel is not in the tab order');
		});

	});

	describe('the focusable walk', () => {

		//REGRESSION 1. The original implementation could not see past a shadow
		//boundary, which is where most of a real dialog's controls live.
		it('descends into nested shadow roots', () => {
			const host = dom.window.document.createElement('div');
			const inner = host.attachShadow({mode: 'open'});
			const nested = dom.window.document.createElement('button');
			nested.id = 'nested-button';
			inner.appendChild(nested);
			element.shadowRoot.querySelector('#inner').appendChild(host);

			const found = element._deepFocusableElements();
			assert.ok(found.includes(nested), 'the walk cannot see a control inside a child shadow root; the trap becomes a cage');
			host.remove();
		});

		it('includes summary, which is natively tabbable', () => {
			const details = dom.window.document.createElement('details');
			const summary = dom.window.document.createElement('summary');
			details.appendChild(summary);
			element.shadowRoot.querySelector('#inner').appendChild(details);

			assert.ok(element._deepFocusableElements().includes(summary), 'summary is a native tab stop and must be a wrap target');
			details.remove();
		});

		it('skips hidden controls', () => {
			const hidden = dom.window.document.createElement('button');
			hidden.setAttribute('data-test-hidden', '');
			element.shadowRoot.querySelector('#inner').appendChild(hidden);

			assert.ok(!element._deepFocusableElements().includes(hidden), 'a hidden control was offered as a wrap target');
			hidden.remove();
		});

		it('always offers at least the close button, so a wrap never has nowhere to go', () => {
			const found = element._deepFocusableElements();
			assert.ok(found.length > 0);
			assert.strictEqual(found[0].id, 'close', 'the close button should be the first wrap target');
		});

	});

	describe('return focus on close', () => {

		let opener;

		beforeEach(async () => {
			opener = dom.window.document.createElement('button');
			dom.window.document.body.appendChild(opener);
			opener.focus();
			element.open = true;
			await element.updateComplete;
			await nextTurn();
		});

		afterEach(async () => {
			element.open = false;
			await element.updateComplete;
			opener.remove();
		});

		it('hands focus back to the opener when the dialog still has it', async () => {
			element.shadowRoot.querySelector('#close').focus();
			assert.ok(element.shadowRoot.activeElement, 'precondition: focus should be inside the dialog');

			element.open = false;
			await element.updateComplete;

			assert.strictEqual(dom.window.document.activeElement, opener, 'closing a dialog should return focus to whatever opened it');
		});

		//A backdrop click blurs to <body> on MOUSEDOWN, before the click handler
		//that closes the dialog ever runs — so by the time return-focus is
		//considered, the dialog owns nothing. Guarding only on "the dialog still
		//has focus" silently dropped return-focus for every backdrop close.
		it('restores focus after a backdrop close, where the blur already happened', async () => {
			const close = element.shadowRoot.querySelector('#close');
			close.focus();
			//Stand in for the mousedown blur that precedes the close: pressing
			//on the non-focusable backdrop drops focus to <body>.
			close.blur();
			assert.strictEqual(element.shadowRoot.activeElement, null, 'precondition: the dialog should no longer hold focus');
			assert.strictEqual(dom.window.document.activeElement, dom.window.document.body, 'precondition: focus should have fallen to body');

			element.open = false;
			await element.updateComplete;

			assert.strictEqual(dom.window.document.activeElement, opener, 'a backdrop close should still return focus to the opener');
		});

		//REGRESSION 3. The Cmd-K link flow restores the caret to the card body
		//as the dialog closes; firing return-focus anyway sent the user's next
		//keystroke into the Title field instead.
		it('does NOT steal focus back from something that took it deliberately', async () => {
			const elsewhere = dom.window.document.createElement('input');
			dom.window.document.body.appendChild(elsewhere);

			//Stand in for restoreSelectionRange(): something outside the dialog
			//claims focus on purpose while the dialog is closing.
			elsewhere.focus();
			assert.strictEqual(element.shadowRoot.activeElement, null, 'precondition: focus should have left the dialog');

			element.open = false;
			await element.updateComplete;

			assert.strictEqual(dom.window.document.activeElement, elsewhere, 'the dialog stole focus back from a deliberate claim; the next keystroke lands in the wrong field');
			elsewhere.remove();
		});

	});

});

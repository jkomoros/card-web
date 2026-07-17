/*eslint-env node, es2022*/

//WHAT IS LEFT OF THIS SUITE AFTER THE HOUSE-STYLE LANDING.
//
//This file originally asserted the composer branch's own DialogElement work:
//a keydown-intercepting Tab trap, an inert-the-surroundings walk, an
//invoker-tracking return-focus, and a per-dialog `Close <title>` label. All of
//that is superseded — master rebuilt the same contract with focus sentinels
//placed OUTSIDE the panel, a shadow-descending focusable walk, and a
//return-focus that declines to steal focus from something that took it on
//purpose. test/dialog-focus asserts every one of those, with three named
//regressions behind it, so re-asserting them here would be duplicate coverage
//of an implementation this branch no longer owns.
//
//What this branch DOES still own, and what remains here, is one line in
//ShortcutRegistry.dispatch: a keydown whose default has already been prevented
//is not a command. The composer needs it because its own child controls cancel
//Escape and Enter to keep them local, and master has no equivalent line. The
//dialog is the surface where it is observable, which is why the assertion lives
//with the dialog rather than with the registry's unit tests.

import assert from 'assert';
import {bootstrapApp} from '../harness-support/app-harness.js';

const app = await bootstrapApp();
const {dom} = app;

const nextTurn = () => new Promise(resolve => setTimeout(resolve, 0));

describe('dialog-element and the shortcut registry', () => {

	let element;
	let closeRequests;

	before(async function() {
		this.timeout(20000);
		await import('../../lib/src/components/dialog-element.js');
		element = dom.window.document.createElement('dialog-element');
		element.title = 'Compose a collection';
		dom.window.document.body.appendChild(element);
		await nextTurn();
		element.open = true;
		await element.updateComplete;
		element.addEventListener('dialog-should-close', () => closeRequests++);
	});

	beforeEach(() => {
		closeRequests = 0;
	});

	after(() => {
		element.open = false;
		element.remove();
	});

	it('closes on a plain Escape, so the decline cases below can fail', () => {
		const event = new dom.window.KeyboardEvent('keydown', {key: 'Escape', cancelable: true});
		dom.window.dispatchEvent(event);
		assert.strictEqual(closeRequests, 1);
	});

	//The branch's one line in ShortcutRegistry.dispatch. A child control that
	//has already cancelled the event decided what the keystroke meant; the
	//global registry must not decide again.
	it('declines an Escape a child control has already handled', () => {
		const event = new dom.window.KeyboardEvent('keydown', {key: 'Escape', cancelable: true});
		event.preventDefault();
		dom.window.dispatchEvent(event);
		assert.strictEqual(closeRequests, 0);
	});

	it('declines a keystroke that an input method is composing', () => {
		const event = new dom.window.KeyboardEvent('keydown', {key: 'Escape', cancelable: true});
		Object.defineProperty(event, 'isComposing', {value: true});
		dom.window.dispatchEvent(event);
		assert.strictEqual(closeRequests, 0);
	});

});

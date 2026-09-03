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
import {readFileSync} from 'fs';
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
		element.title = 'Compose a Collection';
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

	//THE TITLE IS THE ACCESSIBLE NAME, and there is only one of it.
	//
	//A dialog whose visible heading and announced name differ is a dialog
	//nobody can talk to anybody else about. They cannot differ here, and this
	//pins why: aria-labelledby points at the same h2 the title property
	//renders, so there is no second string to keep in sync.
	it('names itself with the heading it shows', () => {
		const heading = element.shadowRoot.querySelector('h2');
		const content = element.shadowRoot.querySelector('.content');
		assert.strictEqual(heading.textContent, 'Compose a Collection');
		assert.strictEqual(content.getAttribute('aria-label'), null,
			'a second name would be free to drift from the visible one');
		assert.strictEqual(content.getAttribute('aria-labelledby'), heading.id,
			'the name must BE the heading, not a copy of it');
	});

	//§4.3 assigns --app-header-font-family to titles, and the composer spec
	//asks for a Raleway heading "consistent with current dialogs" — which no
	//dialog was: this rule named no family, so every dialog title inherited
	//Source Sans Pro from the body.
	it('sets its title in the app\'s header family', () => {
		//The dialog's OWN block: SharedStyles also carries an h2 rule, and this
		//one comes after it and overrides what it sets.
		const sheets = element.constructor.styles;
		const styles = String(sheets[sheets.length - 1].cssText || '');
		assert.match(styles, /\.focus-sentinel/, 'the last sheet must be dialog-element\'s own');
		const rule = styles.match(/\n\s*h2 \{[^}]*\}/);
		assert.ok(rule, 'the dialog title needs a rule of its own');
		assert.match(rule[0], /font-family:\s*var\(--app-header-font-family\)/);
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

	//THE GUARD'S BLAST RADIUS, PINNED WHERE THE GUARD IS PINNED.
	//
	//"A keydown whose default has been prevented is not a command" is right, and
	//it made a pre-existing wart load-bearing. card-editor's two tab strips
	//matched on `e.key === 'Enter'` alone and called killEvent — which is
	//preventDefault — so Cmd-Enter, the app's SAVE, looked to them exactly like
	//the plain Enter that activates a tab. Before the guard that was cosmetic (a
	//spurious re-select of the tab you were already on, and the card still
	//saved); with it, clicking a tab and pressing Cmd-Enter saved nothing, said
	//nothing, and looked like a broken key.
	//
	//Driven end to end: the REAL handler, attached the way card-editor attaches
	//it, on a real focusable tab label, with a real bubbling composed event that
	//reaches the registry's window listener the way a browser's would.
	describe('a modified Enter on a tab strip still reaches the registry', () => {

		let tabs;
		let label;
		let editor;
		let commits;
		let unregister;
		//What the event looked like the instant the strip was done with it —
		//read here rather than after dispatch, because the registry's own window
		//listener legitimately preventDefaults a keystroke it HANDLED, and that
		//is the opposite of the defect.
		let preventedByStrip;

		before(async function() {
			this.timeout(20000);
			await import('../../lib/src/components/card-editor.js');
			const shortcuts = await import('../../lib/src/shortcuts.js');
			editor = dom.window.document.createElement('card-editor');
			tabs = dom.window.document.createElement('div');
			label = dom.window.document.createElement('label');
			label.setAttribute('role', 'tab');
			label.setAttribute('tabindex', '0');
			label.setAttribute('data-name', 'config');
			tabs.appendChild(label);
			dom.window.document.body.appendChild(tabs);
			//The binding card-editor's strips were shadowing: commit-edit is
			//declared `any-focus` precisely so a save works wherever the caret is.
			unregister = shortcuts.registerShortcut({
				id: 'harness-commit-edit',
				keys: {key: 'Enter', mod: true, allowExtraShiftAlt: true},
				label: 'Harness commit',
				focusPolicy: 'any-focus',
				handler: () => void commits++,
			});
			tabs.addEventListener('keydown', (e) => {
				editor._handleTabKeyDown(e);
				preventedByStrip = e.defaultPrevented;
			});
		});

		beforeEach(() => {
			commits = 0;
			preventedByStrip = null;
		});

		after(() => {
			if (unregister) unregister();
			tabs.remove();
		});

		const press = (key, init = {}) => {
			const event = new dom.window.KeyboardEvent('keydown', {
				key, bubbles: true, composed: true, cancelable: true, ...init,
			});
			label.dispatchEvent(event);
			return event;
		};

		it('lets Cmd-Enter through to the save binding', () => {
			press('Enter', {metaKey: true});
			assert.strictEqual(preventedByStrip, false,
				'the tab strip must not consume a modified Enter');
			assert.strictEqual(commits, 1, 'Cmd-Enter on a focused tab must still save');
		});

		//allowExtraShiftAlt means Cmd-Shift-Enter is the same command, so the
		//strip has to decline that too.
		it('lets Cmd-Shift-Enter through as well', () => {
			press('Enter', {metaKey: true, shiftKey: true});
			assert.strictEqual(preventedByStrip, false);
			assert.strictEqual(commits, 1);
		});

		//AND THE STRIP KEEPS ITS OWN KEYS. Refusing the modified forms must not
		//cost a keyboard user the plain ones, which are the whole grammar here —
		//there is no arrow handling on these strips at all.
		it('still activates the tab on a bare Enter and a bare Space', () => {
			press('Enter');
			assert.strictEqual(preventedByStrip, true, 'a bare Enter still activates the tab');
			press(' ');
			assert.strictEqual(preventedByStrip, true, 'and so does a bare Space');
			assert.strictEqual(commits, 0, 'and an unmodified key is not a save');
		});
	});

	//THE STACKING LADDER. Dialogs claim a rising z-index per open, which was
	//introduced so a dialog opened from inside another paints above it — and
	//which silently overtook corpus-ownership-gate, whose flat 1000 had been
	//winning its tie with dialogs on DOM order alone. The gate inerts every
	//sibling, so a dialog painting over it is a full-viewport scrim the user can
	//see, cannot use, and cannot dismiss, hiding the only controls that recover
	//the session. The gate is above everything now; dialogs stay in their band.
	it('keeps the corpus gate above every dialog, however many have opened', async () => {
		await import('../../lib/src/components/corpus-ownership-gate.js');
		const gate = dom.window.customElements.get('corpus-ownership-gate');
		const gateStyles = [].concat(gate.styles).map(sheet => String(sheet.cssText || '')).join('\n');
		const gateZ = Number((gateStyles.match(/z-index:\s*(\d+)/) || [])[1]);
		assert.ok(gateZ > 0, 'the gate must declare a z-index');

		//Open enough dialogs that the counter is exercised, then read what the
		//most recent one actually claimed.
		let claimed = 0;
		for (let round = 0; round < 5; round++) {
			const extra = dom.window.document.createElement('dialog-element');
			dom.window.document.body.appendChild(extra);
			extra.open = true;
			await extra.updateComplete;
			claimed = Number(extra.style.getPropertyValue('--dialog-z'));
			extra.remove();
		}
		assert.ok(claimed > 1000, 'each open claims the next z-index');
		assert.ok(gateZ > claimed,
			`the gate (${gateZ}) must paint above a freshly opened dialog (${claimed})`);

		//And the band is bounded, so no session can climb into it.
		const source = readFileSync(new URL('../../src/components/dialog-element.ts', import.meta.url), 'utf8');
		const cap = Number((source.match(/MAXIMUM_DIALOG_Z\s*=\s*(\d+)/) || [])[1]);
		assert.ok(cap > 0, 'the dialog band must declare its ceiling');
		assert.ok(gateZ > cap, `the gate (${gateZ}) must sit above the whole dialog band (${cap})`);
	});

});

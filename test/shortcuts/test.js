/*eslint-env node, es2020*/

//Pins #740 stage 1: bindings as data, one shared applicability check, one
//suppression discipline. The dispatch core (ShortcutRegistry) is driven
//directly with synthetic events and states, so every hazard class the
//layer exists to prevent is asserted, not hoped for.

import {
	JSDOM
} from 'jsdom';

import assert from 'assert';

import fs from 'fs';
import path from 'path';

const dom = new JSDOM('');
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.Document = dom.window.Document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.customElements = dom.window.customElements;
globalThis.CSSStyleSheet = dom.window.CSSStyleSheet;

let shortcuts;

//A synthetic keydown: enough surface for the registry (matcher fields,
//repeat/composing, composedPath, and the two suppression methods).
const makeEvent = (key, {mod = false, shift = false, alt = false, repeat = false, composing = false, target = null} = {}) => {
	const calls = {preventDefault: 0, stopPropagation: 0};
	return {
		key,
		metaKey: mod,
		ctrlKey: false,
		shiftKey: shift,
		altKey: alt,
		repeat,
		isComposing: composing,
		composedPath: () => [target],
		preventDefault: () => calls.preventDefault++,
		stopPropagation: () => calls.stopPropagation++,
		calls,
	};
};

//A state whose corpus gate is open ('live' is not in
//CORPUS_STATUS_BLOCKS_INTERACTION); the blocking variant uses 'degraded'.
const openState = () => ({data: {corpusStatus: 'live'}});
const gateBlockedState = () => ({data: {corpusStatus: 'degraded'}});

describe('shortcut layer (#740 stage 1)', () => {
	before(async () => {
		shortcuts = await import('../../lib/src/shortcuts.js');
	});

	after(() => {
		dom.window.close();
		for (const handle of process._getActiveHandles()) {
			if (handle.constructor?.name === 'MessagePort' && typeof handle.unref === 'function') handle.unref();
		}
	});

	describe('combo matching', () => {
		it('Shift+letter bindings are matchable (the H5 defect)', () => {
			//e.key uppercases under Shift, so a handler switching on raw
			//e.key could never match a Shift+letter binding. Shift is a
			//declared field here and letters compare case-insensitively.
			assert.ok(shortcuts.comboMatches(
				{key: 'K', metaKey: true, ctrlKey: false, shiftKey: true, altKey: false},
				{key: 'k', mod: true, shift: true}));
			//Caps Lock + Shift yields a LOWERCASE letter with shiftKey true.
			assert.ok(shortcuts.comboMatches(
				{key: 'k', metaKey: true, ctrlKey: false, shiftKey: true, altKey: false},
				{key: 'k', mod: true, shift: true}));
		});

		it('undeclared modifiers must be absent, so the browser keeps its own combos', () => {
			const cmdR = {key: 'r', metaKey: true, ctrlKey: false, shiftKey: false, altKey: false};
			assert.ok(!shortcuts.comboMatches(cmdR, {key: 'r', mod: true, alt: true}),
				'Cmd-R (browser reload) must not match the Cmd-Alt-R binding');
			assert.ok(!shortcuts.comboMatches(
				{key: 'm', metaKey: true, ctrlKey: false, shiftKey: true, altKey: false},
				{key: 'm', mod: true}),
			'Cmd-Shift-M must not match the Cmd-M binding');
		});

		it('either meta or ctrl satisfies mod', () => {
			assert.ok(shortcuts.comboMatches(
				{key: 'e', metaKey: false, ctrlKey: true, shiftKey: false, altKey: false},
				{key: 'e', mod: true}));
		});
	});

	describe('focus classification (#747)', () => {
		it('classifies contenteditable, text inputs, and activation controls', () => {
			const editable = document.createElement('div');
			editable.setAttribute('contenteditable', 'true');
			document.body.appendChild(editable);
			assert.strictEqual(shortcuts.classifyFocusTarget(editable), 'contenteditable');
			const input = document.createElement('input');
			document.body.appendChild(input);
			assert.strictEqual(shortcuts.classifyFocusTarget(input), 'text-input');
			const button = document.createElement('button');
			document.body.appendChild(button);
			assert.strictEqual(shortcuts.classifyFocusTarget(button), 'control');
			assert.strictEqual(shortcuts.classifyFocusTarget(document.body), 'none');
			assert.strictEqual(shortcuts.classifyFocusTarget(null), 'none');
		});

		it('policies gate by kind: formatting only in contenteditable, dispatching from text fields', () => {
			//The #747 decision: execCommand bindings require a selection
			//inside a contenteditable; dispatching bindings stay available
			//from the title and notes fields.
			assert.ok(shortcuts.focusPolicyAllows('in-contenteditable', 'contenteditable'));
			assert.ok(!shortcuts.focusPolicyAllows('in-contenteditable', 'text-input'));
			assert.ok(shortcuts.focusPolicyAllows('allow-text-fields', 'text-input'));
			assert.ok(shortcuts.focusPolicyAllows('allow-text-fields', 'contenteditable'));
			assert.ok(!shortcuts.focusPolicyAllows('allow-text-fields', 'control'));
			//Bare-key default: nothing focusable may have focus — a focused
			//button must receive its own Space/Enter.
			assert.ok(!shortcuts.focusPolicyAllows('no-focused-control', 'control'));
			assert.ok(!shortcuts.focusPolicyAllows('no-focused-control', 'text-input'));
			assert.ok(!shortcuts.focusPolicyAllows('no-focused-control', 'contenteditable'));
			assert.ok(shortcuts.focusPolicyAllows('no-focused-control', 'none'));
		});
	});

	describe('dispatch', () => {
		it('priority ends the Escape double-fire: the dialog consumes, the page binding never runs', () => {
			const registry = new shortcuts.ShortcutRegistry();
			const ran = [];
			registry.register({id: 'blur-focused', keys: {key: 'Escape'}, label: '', focusPolicy: 'any-focus', handler: () => void ran.push('blur')});
			registry.register({id: 'dialog-escape', keys: {key: 'Escape'}, label: '', priority: shortcuts.DIALOG_SHORTCUT_PRIORITY, focusPolicy: 'any-focus', handler: () => void ran.push('dialog')});
			const event = makeEvent('Escape');
			assert.strictEqual(registry.dispatch(event, openState()), true);
			assert.deepStrictEqual(ran, ['dialog'], 'exactly one binding may act on one press');
			assert.strictEqual(event.calls.preventDefault, 1);
			assert.strictEqual(event.calls.stopPropagation, 1);
		});

		it('a declining handler passes the search on and leaves the browser default alone', () => {
			const registry = new shortcuts.ShortcutRegistry();
			const ran = [];
			registry.register({id: 'high', keys: {key: 'Escape'}, label: '', priority: 10, focusPolicy: 'any-focus', handler: () => {
				ran.push('high');
				return false;
			}});
			registry.register({id: 'low', keys: {key: 'Escape'}, label: '', focusPolicy: 'any-focus', handler: () => void ran.push('low')});
			const event = makeEvent('Escape');
			assert.strictEqual(registry.dispatch(event, openState()), true);
			assert.deepStrictEqual(ran, ['high', 'low']);
			const event2 = makeEvent('Escape');
			const registry2 = new shortcuts.ShortcutRegistry();
			registry2.register({id: 'only', keys: {key: 'Escape'}, label: '', focusPolicy: 'any-focus', handler: () => false});
			assert.strictEqual(registry2.dispatch(event2, openState()), false);
			assert.strictEqual(event2.calls.preventDefault, 0, 'a declined event must keep its default');
		});

		it('key-repeat is blocked by default; navigation opts in', () => {
			const registry = new shortcuts.ShortcutRegistry();
			const ran = [];
			registry.register({id: 'space', keys: {key: ' '}, label: '', handler: () => void ran.push('space')});
			registry.register({id: 'down', keys: {key: 'ArrowDown'}, label: '', allowRepeat: true, handler: () => void ran.push('down')});
			assert.strictEqual(registry.dispatch(makeEvent(' ', {repeat: true}), openState()), false);
			assert.strictEqual(registry.dispatch(makeEvent('ArrowDown', {repeat: true}), openState()), true);
			assert.deepStrictEqual(ran, ['down']);
		});

		it('IME composition keystrokes never fire anything', () => {
			const registry = new shortcuts.ShortcutRegistry();
			registry.register({id: 'commit', keys: {key: 'Enter', mod: true}, label: '', focusPolicy: 'any-focus', handler: () => assert.fail('must not run')});
			assert.strictEqual(registry.dispatch(makeEvent('Enter', {mod: true, composing: true}), openState()), false);
		});

		it('the corpus gate blocks every binding — inert does not stop document keydown', () => {
			const registry = new shortcuts.ShortcutRegistry();
			registry.register({id: 'edit', keys: {key: 'e', mod: true}, label: '', focusPolicy: 'any-focus', handler: () => assert.fail('must not run behind the gate')});
			assert.strictEqual(registry.dispatch(makeEvent('e', {mod: true}), gateBlockedState()), false);
		});

		it('the default focus policy blocks typing contexts, including contenteditable', () => {
			const registry = new shortcuts.ShortcutRegistry();
			const ran = [];
			registry.register({id: 'space', keys: {key: ' '}, label: '', handler: () => void ran.push('space')});
			const editable = document.createElement('div');
			editable.setAttribute('contenteditable', 'true');
			document.body.appendChild(editable);
			assert.strictEqual(registry.dispatch(makeEvent(' ', {target: editable}), openState()), false,
				'the legacy focused-control list missed [contenteditable] (#747-adjacent hazard)');
			assert.strictEqual(registry.dispatch(makeEvent(' ', {target: document.body}), openState()), true);
			assert.deepStrictEqual(ran, ['space']);
		});

		it('unregister removes the binding', () => {
			const registry = new shortcuts.ShortcutRegistry();
			const ran = [];
			const unregister = registry.register({id: 'x', keys: {key: 'x', mod: true}, label: '', focusPolicy: 'any-focus', handler: () => void ran.push('x')});
			assert.strictEqual(registry.dispatch(makeEvent('x', {mod: true}), openState()), true);
			unregister();
			unregister(); //idempotent
			assert.strictEqual(registry.dispatch(makeEvent('x', {mod: true}), openState()), false);
			assert.deepStrictEqual(ran, ['x']);
		});

		it('equal priority resolves newest-first, so Escape peels stacked dialogs top-down', () => {
			//The review demonstrated the oldest-first version closing the
			//HIDDEN dialog under a stacked image browser: properties opened
			//first, browser stacked on top, Escape closed properties behind
			//the browser. Dialogs register on OPEN, so newest-first makes
			//the top of the stack win.
			const registry = new shortcuts.ShortcutRegistry();
			const ran = [];
			registry.register({id: 'dialog-escape', keys: {key: 'Escape'}, label: '', priority: shortcuts.DIALOG_SHORTCUT_PRIORITY, focusPolicy: 'any-focus', handler: () => void ran.push('under')});
			registry.register({id: 'dialog-escape', keys: {key: 'Escape'}, label: '', priority: shortcuts.DIALOG_SHORTCUT_PRIORITY, focusPolicy: 'any-focus', handler: () => void ran.push('top')});
			assert.strictEqual(registry.dispatch(makeEvent('Escape'), openState()), true);
			assert.deepStrictEqual(ran, ['top'], 'the most recently opened dialog must win');
			//And it peels: a top dialog that closes (and so unregisters) on
			//its own Escape leaves the next press for the one underneath.
			const registry2 = new shortcuts.ShortcutRegistry();
			const order = [];
			registry2.register({id: 'dialog-escape', keys: {key: 'Escape'}, label: '', priority: shortcuts.DIALOG_SHORTCUT_PRIORITY, focusPolicy: 'any-focus', handler: () => void order.push('under')});
			const unregisterTop = registry2.register({id: 'dialog-escape', keys: {key: 'Escape'}, label: '', priority: shortcuts.DIALOG_SHORTCUT_PRIORITY, focusPolicy: 'any-focus', handler: () => {
				order.push('top');
				unregisterTop();
			}});
			registry2.dispatch(makeEvent('Escape'), openState());
			registry2.dispatch(makeEvent('Escape'), openState());
			assert.deepStrictEqual(order, ['top', 'under'], 'each press closes exactly one dialog, top-down');
		});

		it('mutations during a dispatch take effect on the NEXT keystroke', () => {
			//dispatch iterates a snapshot: the review drove the
			//un-snapshotted version into an infinite loop via a handler that
			//registered bindings mid-scan. The pinned invariant: what a
			//handler registers or unregisters never affects the current
			//keystroke.
			const registry = new shortcuts.ShortcutRegistry();
			const ran = [];
			let registeredExtra = false;
			registry.register({id: 'a', keys: {key: 'x'}, label: '', focusPolicy: 'any-focus', handler: () => {
				ran.push('a');
				if (!registeredExtra) {
					registeredExtra = true;
					registry.register({id: 'b', keys: {key: 'x'}, label: '', priority: 50, focusPolicy: 'any-focus', handler: () => void ran.push('b')});
				}
				return false;
			}});
			registry.dispatch(makeEvent('x'), openState());
			assert.deepStrictEqual(ran, ['a'], 'a binding registered mid-dispatch must not run this keystroke');
			registry.dispatch(makeEvent('x'), openState());
			assert.deepStrictEqual(ran, ['a', 'b'], 'it runs on the next one (and outranks by priority)');
			//And unregistration mid-dispatch also lands next keystroke: the
			//removed binding still runs this time (a is consulted first and
			//removes b before the scan reaches it — b runs anyway).
			const registry3 = new shortcuts.ShortcutRegistry();
			const ran3 = [];
			let unregisterB3 = null;
			registry3.register({id: 'a', keys: {key: 'y'}, label: '', priority: 10, focusPolicy: 'any-focus', handler: () => {
				ran3.push('a');
				if (unregisterB3) unregisterB3();
				return false;
			}});
			unregisterB3 = registry3.register({id: 'b', keys: {key: 'y'}, label: '', focusPolicy: 'any-focus', handler: () => void ran3.push('b')});
			registry3.dispatch(makeEvent('y'), openState());
			assert.deepStrictEqual(ran3, ['a', 'b'], 'documented: mid-dispatch unregistration lands next keystroke');
			registry3.dispatch(makeEvent('y'), openState());
			assert.deepStrictEqual(ran3, ['a', 'b', 'a'], 'gone on the next');
		});

		it('registering a reserved DevTools combo throws unless acknowledged (#729)', () => {
			const registry = new shortcuts.ShortcutRegistry();
			assert.throws(() => registry.register({id: 'bad', keys: {key: 'c', mod: true, shift: true}, label: '', handler: () => undefined}),
				/reserved combo/);
			assert.throws(() => registry.register({id: 'bad2', keys: {key: 'I', mod: true, shift: true}, label: '', handler: () => undefined}),
				/reserved combo/);
			assert.doesNotThrow(() => registry.register({id: 'acknowledged', keys: {key: 'c', mod: true, shift: true}, label: '', dangerouslyAllowReservedCombo: true, handler: () => undefined}));
		});
	});

	describe('label rendering (#740 stage 2)', () => {
		it('one notation, platform-aware', () => {
			assert.strictEqual(shortcuts.formatShortcutCombo({key: 'm', mod: true, shift: true}, true), 'Cmd-Shift-M');
			assert.strictEqual(shortcuts.formatShortcutCombo({key: 'm', mod: true, shift: true}, false), 'Ctrl-Shift-M');
			assert.strictEqual(shortcuts.formatShortcutCombo({key: 'r', mod: true, alt: true}, true), 'Cmd-Alt-R');
			assert.strictEqual(shortcuts.formatShortcutCombo({key: ' '}, true), 'Space');
			assert.strictEqual(shortcuts.formatShortcutCombo({key: 'ArrowDown'}, false), '↓');
			assert.strictEqual(shortcuts.formatShortcutCombo({key: 'Enter', mod: true}, false), 'Ctrl-Enter');
		});

		it('shortcutKeys reads the canonical table', () => {
			assert.strictEqual(shortcuts.shortcutKeys('edit-card', true), 'Cmd-E');
			assert.strictEqual(shortcuts.shortcutKeys('edit-card', false), 'Ctrl-E');
			assert.strictEqual(shortcuts.shortcutKeys('random-card', true), 'Cmd-Alt-Shift-R');
			assert.strictEqual(shortcuts.shortcutKeys('create-working-notes-card', false), 'Ctrl-Shift-M');
		});

		it('isMacPlatform reads the platform string', () => {
			assert.strictEqual(shortcuts.isMacPlatform('MacIntel'), true);
			assert.strictEqual(shortcuts.isMacPlatform('Win32'), false);
			assert.strictEqual(shortcuts.isMacPlatform(''), false);
		});

		it('every registered binding draws its combos from the table (no inline drift)', () => {
			//The whole point of the table: a binding and its label cannot
			//disagree. Inline `keys: {key: ...}` in a migrated component
			//would reopen the drift channel.
			const fs2 = fs;
			for (const file of ['main-view.ts', 'card-view.ts', 'card-editor.ts', 'dialog-element.ts']) {
				const source = fs2.readFileSync(path.join(new URL('../../src/components/', import.meta.url).pathname, file), 'utf8');
				assert.ok(!/keys: \{key:/.test(source),
					`${file} must reference SHORTCUT_COMBOS, not inline combos`);
			}
		});

		it('no migrated display string hardcodes a combo notation', () => {
			//The six strings in three notations, hand-synced, were the stage-2
			//motivation; the UI once said "Edit card (E)" for weeks after the
			//binding became Cmd-E.
			const files = ['components/card-view.ts', 'components/card-drawer.ts', 'components/card-editor.ts', 'tabs.ts'];
			for (const file of files) {
				const source = fs.readFileSync(path.join(new URL('../../src/', import.meta.url).pathname, file), 'utf8');
				assert.ok(!/⌘|Cmd-[A-Z0-9]|Ctrl-[A-Z0-9]/.test(source.replace(/\/\/[^\n]*/g, '')),
					`${file} must derive shortcut text from shortcutKeys, not hardcode it`);
			}
		});
	});

	describe('the legacy handlers are gone (source-text pins)', () => {
		const read = (file) => fs.readFileSync(path.join(new URL('../../src/components/', import.meta.url).pathname, file), 'utf8');

		it('no migrated component registers its own global keydown listener', () => {
			for (const file of ['main-view.ts', 'card-view.ts', 'card-editor.ts', 'dialog-element.ts']) {
				const source = read(file);
				assert.ok(!/addEventListener\('keydown'/.test(source),
					`${file} must route keyboard handling through the shortcut registry`);
			}
		});

		it('card-web-app keeps only its modifier-state trackers', () => {
			//H1/H2 track Cmd/Ctrl pressed-ness for hover affordances; they
			//are stateful trackers (need keyup + blur), not shortcuts, and
			//deliberately stay put.
			const source = read('card-web-app.ts');
			assert.ok(/addEventListener\('keydown', this\._handleKeyDown/.test(source));
			assert.ok(/addEventListener\('keyup', this\._handleKeyUp/.test(source));
		});

		it('commit-edit fires with ANY focus — Chrome focuses buttons and selects on click', () => {
			//The review caught the allow-text-fields version dead-keying the
			//core save flow: click the section <select>, press Cmd-Enter —
			//focus is on a control, the binding declined, and the unconsumed
			//modified-Enter ACTIVATED the focused button instead of saving.
			const source = read('main-view.ts');
			assert.match(source, /id: 'commit-edit',[\s\S]{0,1200}focusPolicy: 'any-focus'/);
		});

		it('dialogs register their Escape on OPEN, not on connect', () => {
			//Connect-time registration froze the stacking order at mount
			//order; see the newest-first dispatch test. willUpdate, not
			//updated: two subclasses override updated() without super.
			const source = read('dialog-element.ts');
			assert.match(source, /willUpdate[\s\S]{0,400}_syncEscapeShortcut/);
			assert.ok(!/connectedCallback\(\)[\s\S]{0,600}registerShortcut/.test(source),
				'dialog Escape must not register at connect time');
		});

		it('the #747 decision is encoded per binding', () => {
			const editor = read('card-editor.ts');
			assert.match(editor, /id: 'format-bold',[\s\S]{0,200}focusPolicy: 'in-contenteditable'/);
			assert.match(editor, /id: 'find-card-to-link',[\s\S]{0,200}focusPolicy: 'allow-text-fields'/);
			assert.match(editor, /id: 'accept-suggested-concepts',[\s\S]{0,1200}focusPolicy: 'allow-text-fields'/);
		});
	});
});

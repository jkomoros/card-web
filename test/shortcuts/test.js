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

		it('commit-edit tolerates extra Shift/Alt, as the legacy handler did', () => {
			//The pre-registry handler committed on `Enter && (metaKey ||
			//ctrlKey)` with any Shift/Alt state. Refusing Cmd-Shift-Enter
			//(habituated from other apps, or Shift still held from typing a
			//capital) is worse than a dead key: dispatch declines without
			//consuming, and the unconsumed modified Enter can activate
			//whatever control has focus.
			const [combo] = shortcuts.SHORTCUT_COMBOS['commit-edit'];
			assert.ok(combo.allowExtraShiftAlt, 'precondition: the table declares the tolerance');
			assert.ok(shortcuts.comboMatches(
				{key: 'Enter', metaKey: true, ctrlKey: false, shiftKey: true, altKey: false}, combo),
			'Cmd-Shift-Enter must commit');
			assert.ok(shortcuts.comboMatches(
				{key: 'Enter', metaKey: true, ctrlKey: false, shiftKey: false, altKey: true}, combo),
			'Cmd-Alt-Enter must commit');
			assert.ok(shortcuts.comboMatches(
				{key: 'Enter', metaKey: false, ctrlKey: true, shiftKey: true, altKey: true}, combo),
			'Ctrl-Shift-Alt-Enter must commit');
			//mod is never loosened: plain and Shift-Enter mean "newline" in
			//every text field, not "commit".
			assert.ok(!shortcuts.comboMatches(
				{key: 'Enter', metaKey: false, ctrlKey: false, shiftKey: false, altKey: false}, combo),
			'bare Enter must not commit');
			assert.ok(!shortcuts.comboMatches(
				{key: 'Enter', metaKey: false, ctrlKey: false, shiftKey: true, altKey: false}, combo),
			'Shift-Enter must not commit');
		});

		it('the tolerance still requires DECLARED shift/alt, and is a commit-edit exception, not a policy change', () => {
			assert.ok(!shortcuts.comboMatches(
				{key: 'Enter', metaKey: true, ctrlKey: false, shiftKey: false, altKey: false},
				{key: 'Enter', mod: true, shift: true, allowExtraShiftAlt: true}),
			'a declared modifier is still required under the flag');
			//Exact-match must stay the table's default: tolerance is what lets
			//a combo shadow its shifted sibling (Cmd-M vs Cmd-Shift-M are
			//different bindings) and the browser's own defaults.
			const flagged = Object.entries(shortcuts.SHORTCUT_COMBOS)
				.filter(([, combos]) => combos.some(combo => combo.allowExtraShiftAlt))
				.map(([id]) => id);
			assert.deepStrictEqual(flagged, ['commit-edit'], 'no other combo may quietly go loose');
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

		it('the Shift/Alt tolerance never leaks into labels', () => {
			//allowExtraShiftAlt widens what MATCHES; the canonical chord the
			//sheet and tooltips advertise is unchanged.
			assert.strictEqual(shortcuts.shortcutKeys('commit-edit', true), 'Cmd-Enter');
			assert.strictEqual(shortcuts.shortcutKeys('commit-edit', false), 'Ctrl-Enter');
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
				assert.ok(!/keys:\s*\[?\s*\{\s*key:/.test(source),
					`${file} must reference SHORTCUT_COMBOS, not inline combos (array forms included)`);
			}
		});

		it('tabs.ts derives the random-card suffix from the table', () => {
			//The notation pins prove nothing is HARDCODED; this proves the
			//suffix was not simply deleted (review N4).
			const source = fs.readFileSync(path.join(new URL('../../src/', import.meta.url).pathname, 'tabs.ts'), 'utf8');
			assert.ok(source.includes('${shortcutKeys(\'random-card\')}'),
				'the random tab must advertise its shortcut via the table');
		});

		it('no migrated display string hardcodes a combo notation', () => {
			//The six strings in three notations, hand-synced, were the stage-2
			//motivation; the UI once said "Edit card (E)" for weeks after the
			//binding became Cmd-E.
			const files = ['components/card-view.ts', 'components/card-drawer.ts', 'components/card-editor.ts', 'tabs.ts'];
			for (const file of files) {
				const source = fs.readFileSync(path.join(new URL('../../src/', import.meta.url).pathname, file), 'utf8');
				assert.ok(!/⌘|⌥|⇧|\b(cmd|ctrl|command|control|option)[-+][a-z0-9]\b/i.test(source.replace(/\/\/[^\n]*/g, '')),
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

//#740 STAGE 2: THE SHEET
//
//Stage 1 shipped the registry. Nineteen bindings each carried a `label` that
//shortcuts.ts described in a comment as "not rendered anywhere yet" — so the app
//had nineteen shortcuts and no way to discover any of them.
//
//The contract that matters is COMPLETENESS: the sheet enumerates the registry,
//so a new binding appears without anyone remembering to update a list. #740 asks
//for exactly that ("a registry that can be enumerated"). These would catch a
//sheet that had quietly gone back to holding its own copy.
describe('the shortcut sheet catalog (#740 stage 2)', () => {

	//Every declared combo must actually be registered or declared somewhere, or
	//it exists in the table and appears in no reference. Checked against the
	//SOURCE rather than by importing the components, because those need a DOM
	//this suite does not have — and a source pin catches the drift either way.
	it('has a home for every combo in the canonical table', async () => {
		const {readFileSync, readdirSync} = await import('fs');
		const {SHORTCUT_COMBOS} = await import('../../lib/src/shortcuts-data.js');

		const dir = new URL('../../src/components/', import.meta.url);
		let sources = '';
		for (const name of readdirSync(dir)) {
			if (name.endsWith('.ts')) sources += readFileSync(new URL(name, dir), 'utf8') + '\n';
		}

		//Comments stripped first. Review deleted the entire show-shortcuts
		//binding, left `//TODO: reinstate. id: 'show-shortcuts'`, and this pin
		//stayed green while `?` did nothing at all. HOUSE-STYLE §6 already
		//prescribes stripping, and names test/util's idiom.
		const code = sources.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
		const homeless = Object.keys(SHORTCUT_COMBOS).filter(id => !code.includes(`id: '${id}'`));
		assert.deepStrictEqual(homeless, [], 'a combo with no registerShortcut/declareShortcut call can never reach the sheet');
	});

	it('picks up a NEW binding with no change to the sheet', async () => {
		const {ShortcutRegistry} = await import('../../lib/src/shortcuts.js');
		const local = new ShortcutRegistry();
		local.register({id: 'synthetic-binding', keys: [{key: 'q', mod: true}], label: 'Do a synthetic thing', handler: () => true});

		assert.ok(local.describe().some(entry => entry.id === 'synthetic-binding'), 'a new binding must appear automatically, or the sheet drifts from reality');
	});

	//dialog-element registers its Escape only while a dialog is OPEN, and
	//card-editor registers its concept binding only while connected. A scan of
	//what is live right now shows a set that blinks depending on when the sheet
	//was opened.
	it('does not forget a binding that has been unregistered', async () => {
		const {ShortcutRegistry} = await import('../../lib/src/shortcuts.js');
		const local = new ShortcutRegistry();
		const unregister = local.register({id: 'transient', keys: [{key: 'q', mod: true}], label: 'Transient', handler: () => true});
		unregister();

		assert.strictEqual(local._bindings.length, 0, 'precondition: it should no longer be live');
		assert.ok(local.describe().some(entry => entry.id === 'transient'), 'the catalog must survive unregistration');
	});

	//This iterated ZERO entries and passed unconditionally: the suite imports no
	//component module, so nothing had registered. A loop over an empty list is
	//not a test. Populate a registry explicitly, and assert it is non-empty
	//before believing anything it says.
	it('gives every catalogued binding a label and a real group', async () => {
		const {ShortcutRegistry} = await import('../../lib/src/shortcuts.js');
		const {SHORTCUT_COMBOS} = await import('../../lib/src/shortcuts-data.js');
		const groups = ['browsing', 'editing', 'formatting', 'dialogs'];
		const local = new ShortcutRegistry();
		for (const id of Object.keys(SHORTCUT_COMBOS)) {
			local.catalog({id, keys: SHORTCUT_COMBOS[id], label: 'Label for ' + id, group: 'browsing', handler: () => true});
		}

		const entries = local.describe();
		assert.ok(entries.length > 0, 'a loop over an empty catalog asserts nothing');
		assert.strictEqual(entries.length, Object.keys(SHORTCUT_COMBOS).length);
		for (const entry of entries) {
			assert.ok(entry.label && entry.label.length > 0, entry.id + ' has no label to render');
			assert.ok(groups.includes(entry.group), entry.id + ' is in unknown group ' + entry.group);
		}
	});

	//B1: one catalogued id outside SHORTCUT_COMBOS used to throw inside the
	//render and blank the ENTIRE sheet — zero rows under a heading. The combo
	//comes from the catalog's own keys now.
	it('renders a binding whose id is not in the canonical table', async () => {
		const {ShortcutRegistry} = await import('../../lib/src/shortcuts.js');
		const local = new ShortcutRegistry();
		local.register({id: 'not-in-the-table', keys: [{key: 'q', mod: true}], label: 'Synthetic', group: 'browsing', handler: () => true});

		const entry = local.describe().find(candidate => candidate.id === 'not-in-the-table');
		assert.ok(entry, 'it must be catalogued');
		assert.ok(entry.keys, 'and it must carry its OWN keys, or the sheet has nothing to render from');
	});

	//B2: a user-overridden binding displayed the frozen table's combo, which is
	//the opposite of leaving #740 stage 3 possible.
	it('carries overridden keys rather than the frozen table\'s', async () => {
		const {ShortcutRegistry} = await import('../../lib/src/shortcuts.js');
		const local = new ShortcutRegistry();
		local.register({id: 'edit-card', keys: [{key: 'y', mod: true}], label: 'Edit card', group: 'browsing', handler: () => true});

		const entry = local.describe().find(candidate => candidate.id === 'edit-card');
		assert.strictEqual(entry.keys[0].key, 'y', 'the catalog must hold what was registered, not what the table says');
	});

	//A tooltip wants the primary combo; a reference sheet must show them all, or
	//it teaches a binding the user cannot find.
	it('renders every combo a binding accepts, not just the first', async () => {
		const {shortcutKeysAll} = await import('../../lib/src/shortcuts-data.js');
		assert.ok(shortcutKeysAll('next-card', true).includes(' or '), 'next-card has two combos and both belong in a reference');
	});

	it('shares one formatter with the tooltips', async () => {
		const {shortcutKeys, shortcutKeysAll} = await import('../../lib/src/shortcuts-data.js');
		//Where a binding has one combo the two must agree exactly; #740 was
		//filed about six hand-written strings in three notations.
		assert.strictEqual(shortcutKeysAll('edit-card', true), shortcutKeys('edit-card', true));
	});

	it('registers its own combo without tripping the reserved-combo denylist', async () => {
		const {ShortcutRegistry} = await import('../../lib/src/shortcuts.js');
		const {SHORTCUT_COMBOS} = await import('../../lib/src/shortcuts-data.js');
		const local = new ShortcutRegistry();
		assert.doesNotThrow(() => local.register({id: 'show-shortcuts', keys: SHORTCUT_COMBOS['show-shortcuts'], label: 'Show keyboard shortcuts', handler: () => true}));
	});

	//comboMatches requires undeclared modifiers to be ABSENT, and '?' is Shift-/
	//on a US layout but unshifted on several others.
	it('accepts the question mark shifted AND unshifted', async () => {
		const {SHORTCUT_COMBOS} = await import('../../lib/src/shortcuts-data.js');
		const combos = SHORTCUT_COMBOS['show-shortcuts'];
		assert.ok(combos.some(combo => combo.shift), 'the US-layout spelling');
		assert.ok(combos.some(combo => !combo.shift), 'and the layouts where ? needs no shift');
	});

	//Arrows and Space must not navigate cards behind the sheet's own scrim.
	//selectKeyboardNavigates enumerates dialogs by hand, and this is the ninth.
	it('suppresses card navigation while it is open', async () => {
		const {selectKeyboardNavigates} = await import('../../lib/src/selectors.js');
		const {store} = await import('../../lib/src/store.js');
		const {openShortcutSheet, closeShortcutSheet} = await import('../../lib/src/actions/app.js');

		store.dispatch(closeShortcutSheet());
		const before = selectKeyboardNavigates(store.getState());
		store.dispatch(openShortcutSheet());
		assert.strictEqual(selectKeyboardNavigates(store.getState()), false, 'the sheet must suppress navigation like every other dialog');
		store.dispatch(closeShortcutSheet());
		assert.strictEqual(selectKeyboardNavigates(store.getState()), before);
	});

	//The #708 modal seam: a parked confirm/prompt request must suppress
	//navigation exactly like the hand-enumerated dialogs. modal.ts promised
	//selectKeyboardNavigates would consult selectModalOpen, and forkCard
	//already routes through confirmDestructive — arrows and Space navigating
	//cards behind a "This can't be undone" dialog is the armed version of the
	//hazard the enumeration exists to prevent.
	it('suppresses card navigation while a modal request is parked', async () => {
		const {selectKeyboardNavigates} = await import('../../lib/src/selectors.js');
		const {store} = await import('../../lib/src/store.js');
		const {UPDATE_PAGE, MODAL_OPEN, MODAL_RESOLVE} = await import('../../lib/src/actions.js');
		const {PAGE_DEFAULT} = await import('../../lib/src/actions/app.js');

		//Force the rest of the state into a navigating shape first, so the
		//suppression assertion below is the MODAL flipping the answer — a
		//baseline that was already false would let this pass vacuously.
		store.dispatch({type: UPDATE_PAGE, location: '/' + PAGE_DEFAULT + '/', page: PAGE_DEFAULT, pageExtra: ''});
		assert.strictEqual(selectKeyboardNavigates(store.getState()), true, 'precondition: everything else navigates');
		store.dispatch({type: MODAL_OPEN, request: {kind: 'destructive-confirm', id: 'shortcut-suite-modal', title: 'Fork Card?', what: 'These tags will be dropped.', verb: 'Fork card'}});
		assert.strictEqual(selectKeyboardNavigates(store.getState()), false, 'a parked modal request must suppress navigation');
		store.dispatch({type: MODAL_RESOLVE, requestID: 'shortcut-suite-modal'});
		assert.strictEqual(selectKeyboardNavigates(store.getState()), true, 'and release it when the request resolves');
	});

});

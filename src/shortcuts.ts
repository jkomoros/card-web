//The keyboard-shortcut layer (#740, stage 1: handling). Bindings are DATA,
//dispatched by one listener, guarded by one shared applicability check, and
//consumed under one suppression discipline — replacing five global keydown
//handlers (split across document and window, none of which ever
//unregistered) that each invented their own notion of "am I applicable".
//
//The hazard classes this structure exists to prevent, from the audit in
//0ed8dc69 and #740:
//- A shortcut firing while the user is typing (bare `e` once inserted the
//  rest of a typed phrase into a real card). The FOCUS POLICY guard runs
//  for every binding; the old per-handler checks missed [contenteditable]
//  entirely (#747's actual bug).
//- Shift+letter bindings that can never match (e.key uppercases under
//  Shift; one handler switched on raw e.key). Matching here lowercases
//  single characters and treats Shift as its own declared field.
//- Escape double-firing (card-view on document blurred, then
//  dialog-element on window ALSO cancelled): a consumed binding stops the
//  search, and dialogs register at higher priority.
//- Global shortcuts firing behind the corpus gate overlay (`inert` does
//  not stop document-level keydown): the gate guard runs for every binding.
//- Browser-reserved combos (Cmd/Ctrl-Shift-C and -I are DevTools; Chrome
//  delivers the keydown to the page as well): registering one THROWS
//  unless explicitly acknowledged, so #729's class needs a deliberate
//  override instead of a prose comment nobody re-reads.
//
//Stage 2 (shared rendering of binding labels, then user configuration) is
//deliberately not here; see the decision on #740.

import {
	store
} from './store.js';

import {
	State
} from './types.js';

import {
	selectKeyboardNavigates,
	selectCorpusGateBlocking
} from './selectors.js';

import {
	ShortcutCombo
} from './shortcuts-data.js';

export type {ShortcutCombo};


//What may have focus for a binding to fire. The classifier pierces shadow
//DOM via the event's composed path.
//- 'no-focused-control' (the DEFAULT): nothing focusable may have focus.
//  Required for bare-key bindings — Space on a focused button must activate
//  the button (eating it silently broke destructive controls), and typing
//  in any field must never trigger navigation.
//- 'allow-text-fields': fires from inputs, textareas and contenteditables,
//  but not from activation controls. For modified combos that do real work
//  wherever the user is typing (Cmd-Enter commit; Cmd-K from the title
//  field, which the #747 decision explicitly keeps working).
//- 'in-contenteditable': fires ONLY when focus is inside a contenteditable.
//  The #747 decision's default for execCommand formatting bindings, which
//  are meaningless anywhere else.
//- 'any-focus': always fires. For Escape-class bindings whose entire job
//  concerns the focused element or a modal surface.
export type ShortcutFocusPolicy = 'no-focused-control' | 'allow-text-fields' | 'in-contenteditable' | 'any-focus';

export type ShortcutBinding = {
	//Stable identifier; stage 2's label rendering and user configuration
	//key on it. Also used in error messages.
	id : string,
	keys : ShortcutCombo | readonly ShortcutCombo[],
	//For stage 2 and the eventual help sheet; not rendered anywhere yet.
	label : string,
	//Higher priority is consulted first. Dialogs use DIALOG_SHORTCUT_PRIORITY
	//so a dialog's Escape beats the page-level Escape.
	priority? : number,
	focusPolicy? : ShortcutFocusPolicy,
	//Key-repeat is blocked by default; navigation bindings opt in.
	allowRepeat? : boolean,
	//Extra applicability beyond the universal guards.
	when? : (state : State) => boolean,
	//Returning false DECLINES (the binding did not apply after all; the
	//search continues and the browser default survives). Any other return
	//consumes the event.
	handler : (e : KeyboardEvent, state : State) => boolean | void,
	//Required to register a combo on the reserved-combo denylist. #729:
	//Cmd/Ctrl-Shift-C and -I are DevTools keys and Chrome delivers the
	//keydown to the page AS WELL as acting on it, so a binding there fires
	//as a side effect of opening DevTools.
	dangerouslyAllowReservedCombo? : boolean,
};

export const DIALOG_SHORTCUT_PRIORITY = 100;

//The canonical combo table and label helpers live in shortcuts-data.ts — a
//LEAF module with zero imports — because this module imports selectors,
//which imports tabs.ts, which needs shortcutKeys at module-eval time: the
//table living here put tabs in a temporal dead zone. Re-exported for
//convenience.
export {
	SHORTCUT_COMBOS,
	formatShortcutCombo,
	shortcutKeys,
	isMacPlatform,
} from './shortcuts-data.js';

export type {ShortcutID} from './shortcuts-data.js';


//The #729 class. Checked at REGISTRATION so an unsafe combo is a
//development-time throw, not a latent hazard.
const RESERVED_COMBOS : ShortcutCombo[] = [
	{key: 'c', mod: true, shift: true},
	{key: 'i', mod: true, shift: true},
	//The macOS spellings of the same DevTools keys (Cmd-Alt-I/J/C): the
	//stage-2 review caught the denylist covering only the Shift variants.
	{key: 'c', mod: true, alt: true},
	{key: 'i', mod: true, alt: true},
	{key: 'j', mod: true, alt: true},
	{key: 'j', mod: true, shift: true},
];

const comboKey = (combo : ShortcutCombo) : string =>
	[combo.mod ? 'mod' : '', combo.shift ? 'shift' : '', combo.alt ? 'alt' : '', combo.key.length === 1 ? combo.key.toLowerCase() : combo.key].join('+');

//Whether the event matches the combo, exactly: undeclared modifiers must
//not be held, so declared combos never shadow the browser's own unmodified
//or differently-modified defaults.
export const comboMatches = (e : Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>, combo : ShortcutCombo) : boolean => {
	const key = combo.key.length === 1 && e.key.length === 1 ? e.key.toLowerCase() === combo.key.toLowerCase() : e.key === combo.key;
	if (!key) return false;
	const mod = e.metaKey || e.ctrlKey;
	if (Boolean(combo.mod) !== mod) return false;
	if (Boolean(combo.shift) !== e.shiftKey) return false;
	if (Boolean(combo.alt) !== e.altKey) return false;
	return true;
};

export type FocusTargetKind = 'none' | 'contenteditable' | 'text-input' | 'control';

//Classifies the element the keydown targeted (composedPath()[0], which is
//the deep focused element even across shadow roots).
export const classifyFocusTarget = (target : unknown) : FocusTargetKind => {
	if (!(target instanceof HTMLElement)) return 'none';
	//isContentEditable is the browser's authoritative answer (it resolves
	//inherit chains); the attribute selector is the fallback for
	//environments that don't implement it (jsdom) and costs nothing where
	//they agree.
	if (target.isContentEditable || target.closest('[contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]')) return 'contenteditable';
	if (target.closest('input, textarea')) return 'text-input';
	//The legacy list from main-view, which every bare-key binding relied on.
	if (target.closest('button, a, select, [role="button"]')) return 'control';
	return 'none';
};

export const focusPolicyAllows = (policy : ShortcutFocusPolicy, kind : FocusTargetKind) : boolean => {
	switch (policy) {
	case 'no-focused-control':
		return kind === 'none';
	case 'allow-text-fields':
		return kind !== 'control';
	case 'in-contenteditable':
		return kind === 'contenteditable';
	case 'any-focus':
		return true;
	}
};

type RegisteredBinding = ShortcutBinding & {
	//Monotonic, so equal priorities dispatch in registration order.
	order : number,
};

//The dispatch core, separable from the window/store wiring so tests can
//drive it with synthetic events and states.
export class ShortcutRegistry {
	_bindings : RegisteredBinding[] = [];
	_nextOrder = 0;

	register(binding : ShortcutBinding) : () => void {
		const combos = Array.isArray(binding.keys) ? binding.keys : [binding.keys];
		for (const combo of combos) {
			if (binding.dangerouslyAllowReservedCombo) continue;
			if (RESERVED_COMBOS.some(reserved => comboKey(reserved) === comboKey(combo))) {
				throw new Error(`Shortcut '${binding.id}' binds reserved combo ${comboKey(combo)}: Cmd/Ctrl-Shift-C and -I are DevTools keys the browser also delivers to the page (#729). Pick another combo, or acknowledge with dangerouslyAllowReservedCombo.`);
			}
		}
		const registered : RegisteredBinding = {...binding, order: this._nextOrder++};
		this._bindings.push(registered);
		//Sorted at registration (rare) so dispatch (hot) is a plain scan.
		//Equal priority resolves NEWEST-FIRST: instance-scoped bindings
		//register when their context becomes live (a dialog registers on
		//OPEN), so the most recently opened surface wins its combo — Escape
		//on stacked dialogs peels the TOP one. The adversarial review
		//demonstrated the oldest-first version closing the hidden dialog
		//under a stacked image browser.
		this._bindings.sort((a, b) => (b.priority || 0) - (a.priority || 0) || b.order - a.order);
		let registeredStill = true;
		return () => {
			if (!registeredStill) return;
			registeredStill = false;
			this._bindings = this._bindings.filter(candidate => candidate !== registered);
		};
	}

	//Returns true when a binding consumed the event. The universal guards
	//run for EVERY binding — this is the one shared applicability check the
	//legacy handlers each approximated differently.
	dispatch(e : KeyboardEvent, state : State) : boolean {
		//An IME composition keystroke is text entry, never a command.
		if (e.isComposing) return false;
		//`inert` does not stop document-level keydown, so without this every
		//global shortcut fired behind the corpus gate overlay — including in
		//a tab whose store had been purged.
		if (selectCorpusGateBlocking(state)) return false;
		const kind = classifyFocusTarget(e.composedPath ? e.composedPath()[0] : null);
		//Iterate a SNAPSHOT: a handler may register or unregister bindings
		//(a dialog closing itself unregisters its own Escape), and mutating
		//the live array mid-scan re-ran already-consulted handlers — the
		//adversarial review drove the un-snapshotted version into an
		//infinite loop. The invariant this buys, pinned by tests:
		//registrations and unregistrations made DURING a dispatch take
		//effect on the next keystroke, never the current one.
		for (const binding of [...this._bindings]) {
			const combos = Array.isArray(binding.keys) ? binding.keys : [binding.keys];
			if (!combos.some(combo => comboMatches(e, combo))) continue;
			if (e.repeat && !binding.allowRepeat) continue;
			if (!focusPolicyAllows(binding.focusPolicy || 'no-focused-control', kind)) continue;
			if (binding.when && !binding.when(state)) continue;
			if (binding.handler(e, state) === false) continue;
			//One suppression discipline: a binding that matched is consumed,
			//period. (The legacy handlers disagreed: killEvent was
			//preventDefault-only, main-view added stopPropagation, dialogs
			//did neither — which is exactly how Escape double-fired.)
			e.preventDefault();
			e.stopPropagation();
			return true;
		}
		return false;
	}
}

const registry = new ShortcutRegistry();

//Registers a binding for the life of the app (static app-wide shortcuts,
//declared at module scope near the feature they serve). Returns an
//unregister function for component-scoped bindings — components with
//instance state (a dialog's cancel, the editor's suggested-concept list)
//register in connectedCallback/firstUpdated and MUST unregister in
//disconnectedCallback; the legacy handlers never unregistering is one of
//the defects this layer retires.
export const registerShortcut = (binding : ShortcutBinding) : (() => void) => registry.register(binding);

export const registerShortcuts = (bindings : ShortcutBinding[]) : (() => void) => {
	const unregisters = bindings.map(binding => registry.register(binding));
	return () => unregisters.forEach(unregister => unregister());
};

//Applicability helper most page-level bindings share: no editor session, no
//dialog, on the default page, corpus gate open. The selector enumerates
//every modal by hand; bindings that want it opt in via `when` — but unlike
//the legacy handlers, opting in is one reference, not a re-implementation.
export const whenKeyboardNavigates = (state : State) : boolean => selectKeyboardNavigates(state);

//The one global listener, replacing five. Window + bubble phase, so a
//component's own local @keydown handlers (a focus trap, a textarea's Enter
//binding — deliberately NOT migrated, per the #740 decision) run first and
//may stopPropagation to keep a key entirely local.
if (typeof window !== 'undefined') {
	window.addEventListener('keydown', (e : KeyboardEvent) => {
		registry.dispatch(e, store.getState() as State);
	});
}

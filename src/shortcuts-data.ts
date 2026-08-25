//The canonical shortcut combo table and label rendering (#740 stage 2).
//A LEAF module — zero imports — so config modules evaluated early in the
//import graph (tabs.ts, via selectors) can derive display strings at
//module-eval time with no cycle or registration-order hazards. The
//dispatching registry lives in shortcuts.ts and re-exports everything here.

//A single key combination. `mod` means Cmd OR Ctrl (every legacy handler
//accepted either, so every shortcut works on Windows/Linux; stage 2 owns
//displaying the right symbol per platform). Undeclared modifier fields mean
//"must NOT be held": Cmd-R and Cmd-Alt-R are different combos, and the
//browser keeps the ones we don't declare.
export type ShortcutCombo = {
	//Compared case-insensitively for single characters; exactly otherwise
	//('Escape', 'ArrowDown', ' ', 'Enter').
	key : string,
	mod? : boolean,
	shift? : boolean,
	alt? : boolean,
	//Loosens "undeclared modifier fields mean must NOT be held" for shift and
	//alt ONLY: declared ones are still required, extra ones no longer
	//disqualify. For chords whose legacy handler tolerated them — commit-edit
	//accepted Cmd-Shift-Enter (habituated from other apps, or Shift still held
	//from typing a capital) and Cmd-Alt-Enter, and refusing them is worse than
	//a dead key: the unconsumed modified Enter can ACTIVATE whatever control
	//has focus. Exact-match stays the default because tolerance is what lets a
	//combo shadow its shifted sibling (Cmd-M vs Cmd-Shift-M are DIFFERENT
	//bindings) and the browser's own differently-modified defaults. `mod` is
	//never loosened. Display code ignores this field entirely: the canonical
	//label stays e.g. Cmd-Enter.
	allowExtraShiftAlt? : boolean,
};

//THE canonical combo table (#740 stage 2): pure data, importable from
//anywhere (config modules included) with no registration-order or
//import-cycle hazards. Binding declarations reference it for their keys and
//label rendering reads it — one source, so a tooltip can no longer
//advertise a combo the handler stopped honoring (the UI said "Edit card
//(E)" for weeks after the binding became Cmd-E). Deleting an entry breaks
//both the registration and every label that names it AT COMPILE TIME.
export const SHORTCUT_COMBOS = {
	//allowExtraShiftAlt: the pre-registry handler committed on
	//`Enter && (metaKey || ctrlKey)` with any Shift/Alt state; see the flag's
	//comment. Plain Enter and Shift-Enter still never commit — no mod, and
	//they mean "newline" in every text field.
	'commit-edit': [{key: 'Enter', mod: true, allowExtraShiftAlt: true}],
	'edit-card': [{key: 'e', mod: true}],
	'find-card': [{key: 'f', mod: true}],
	'toggle-card-selected': [{key: ' '}],
	'next-card': [{key: 'ArrowDown'}, {key: 'ArrowRight'}],
	'previous-card': [{key: 'ArrowUp'}, {key: 'ArrowLeft'}],
	'blur-focused': [{key: 'Escape'}],
	'create-card': [{key: 'm', mod: true}],
	'create-working-notes-card': [{key: 'm', mod: true, shift: true}],
	'navigate-to-path': [{key: 'l', mod: true, shift: true}],
	'randomize-collection': [{key: 'r', mod: true, alt: true}],
	'random-card': [{key: 'r', mod: true, alt: true, shift: true}],
	'format-bold': [{key: 'b', mod: true}],
	'format-italic': [{key: 'i', mod: true}],
	'format-ordered-list': [{key: '7', mod: true}],
	'format-unordered-list': [{key: '8', mod: true}],
	'find-card-to-link': [{key: 'k', mod: true}],
	'accept-suggested-concepts': [{key: 'k', mod: true, shift: true}],
	'dialog-escape': [{key: 'Escape'}],
	//BOTH spellings on purpose. comboMatches requires undeclared modifiers to
	//be ABSENT, and '?' is Shift-/ on a US layout but an unshifted key on
	//several others — declaring only the shifted form would dead-key the sheet
	//outside the US.
	'show-shortcuts': [{key: '?', shift: true}, {key: '?'}],
} as const satisfies {[id : string] : readonly ShortcutCombo[]};

export type ShortcutID = keyof typeof SHORTCUT_COMBOS;

//True on Macs, where the mod key renders as Cmd; everywhere else it is
//Ctrl (every binding accepts either at MATCH time — this is display only).
//Exported for tests to drive both branches.
export const isMacPlatform = (platformString? : string) : boolean => {
	const platform = platformString ?? (typeof navigator !== 'undefined' ? navigator.platform || '' : '');
	return platform.toLowerCase().includes('mac');
};

const displayKey = (key : string) : string => {
	if (key === ' ') return 'Space';
	if (key === 'ArrowUp') return '↑';
	if (key === 'ArrowDown') return '↓';
	if (key === 'ArrowLeft') return '←';
	if (key === 'ArrowRight') return '→';
	return key.length === 1 ? key.toUpperCase() : key;
};

//One notation, platform-aware: 'Cmd-Shift-M' on Macs, 'Ctrl-Shift-M'
//elsewhere. The legacy strings used three notations, all Mac-only, hand-
//synced — and drifting, which is how a tooltip lied for weeks.
export const formatShortcutCombo = (combo : ShortcutCombo, mac = isMacPlatform()) : string => {
	const parts : string[] = [];
	if (combo.mod) parts.push(mac ? 'Cmd' : 'Ctrl');
	if (combo.alt) parts.push('Alt');
	if (combo.shift) parts.push('Shift');
	parts.push(displayKey(combo.key));
	return parts.join('-');
};

//The display string for a binding's primary combo, e.g. for a tooltip:
//`Edit card (${shortcutKeys('edit-card')})`. Reads the canonical table, so
//it needs no registration to have happened and cannot drift from it.
export const shortcutKeys = (id : ShortcutID, mac? : boolean) : string =>
	formatShortcutCombo(SHORTCUT_COMBOS[id][0], mac);

//EVERY combo for a binding, e.g. 'Down or Right' for next-card. A tooltip wants
//the primary only; a reference sheet has to show them all, or it teaches a
//binding the user cannot find. Shares formatShortcutCombo with shortcutKeys, so
//the sheet and the tooltips cannot drift into the "six strings in three
//notations" state #740 was filed about.
export const shortcutKeysAll = (id : ShortcutID, mac? : boolean) : string =>
	SHORTCUT_COMBOS[id].map(combo => formatShortcutCombo(combo, mac)).join(' or ');

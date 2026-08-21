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
};

//THE canonical combo table (#740 stage 2): pure data, importable from
//anywhere (config modules included) with no registration-order or
//import-cycle hazards. Binding declarations reference it for their keys and
//label rendering reads it — one source, so a tooltip can no longer
//advertise a combo the handler stopped honoring (the UI said "Edit card
//(E)" for weeks after the binding became Cmd-E). Deleting an entry breaks
//both the registration and every label that names it AT COMPILE TIME.
export const SHORTCUT_COMBOS = {
	'commit-edit': [{key: 'Enter', mod: true}],
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

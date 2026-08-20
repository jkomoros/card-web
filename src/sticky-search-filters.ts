//Sticky extra filter expression for the search dialog (#745): a filter
//expression ANDed onto every GENERIC search, persisted per-device, so search
//is useful out of the box (the motivating default: only `prioritized` OR
//`published` cards) without re-checking anything each session.
//
//Decisions from the issue, recorded here because this module implements
//them:
//- The stored value is a GENERAL serialized filter expression — the same
//  syntax collection URLs use — not a fixed menu. `prioritized+published`
//  is a single `+`-union component: `makeFilterUnionSet` merges
//  ALREADY-COMPUTED filter memberships (a set merge, not a corpus scan) and
//  handles inverse filters, which matters because `prioritized` is one.
//  Reach for `combine/` only if a member is itself a configurable filter —
//  it is a whole-corpus scan per evaluation, and this expression re-runs on
//  every debounced keystroke.
//- Per-device localStorage, not the user doc: it is a UI preference, it
//  should work signed out, and it does not need to sync across devices.
//- Generic search mode only. In the pick-a-card modes (linking,
//  referencing, permissions) a sticky expression would silently hide the
//  card being linked to, from a constraint set days earlier.
//- Validated on read: localStorage outlives filter renames, and a stale
//  expression must degrade to "no extra filters" with a warning rather
//  than a silently-empty or throwing collection (#731 is what silent
//  failure looks like here).
//
//House storage pattern per corpus-mode.ts (leaf module, guarded reads,
//default on miss) with edit-draft.ts's versioned-JSON shape. DEFERRED to a
//later stage, deliberately: the cross-tab `storage` listener the issue
//named as the model (edit-draft.ts) — a toggle in one tab leaves another
//tab stale until reload, which is acceptable for an on/off preference.

const LOCAL_STORAGE_KEY = 'card-web-sticky-search-filters-v1';

export const DEFAULT_STICKY_SEARCH_EXPRESSION = 'prioritized+published';

type StickySearchFiltersRecord = {
	version : 1,
	//A serialized filter expression (one or more URL filter components,
	//'/'-joined). Empty string is legal and means "no extra filters" while
	//still remembering enabled=false vs true distinctly.
	expression : string,
	enabled : boolean,
};

const DEFAULT_RECORD : StickySearchFiltersRecord = {
	version: 1,
	expression: DEFAULT_STICKY_SEARCH_EXPRESSION,
	//Selected by default, per the owner's decision: this changes search
	//behaviour for existing users, accepted deliberately because unfiltered
	//results were too noisy.
	enabled: true,
};

const readRecord = () : StickySearchFiltersRecord => {
	//typeof window probe inside try: the probe itself can THROW when storage
	//is blocked by policy (see corpus-mode.ts:53).
	try {
		if (typeof window === 'undefined') return DEFAULT_RECORD;
		const raw = window.localStorage.getItem(LOCAL_STORAGE_KEY);
		if (!raw) return DEFAULT_RECORD;
		const value = JSON.parse(raw) as StickySearchFiltersRecord;
		if (value.version !== 1 || typeof value.expression !== 'string' || typeof value.enabled !== 'boolean') return DEFAULT_RECORD;
		return value;
	} catch {
		return DEFAULT_RECORD;
	}
};

const writeRecord = (record : StickySearchFiltersRecord) : void => {
	try {
		if (typeof window === 'undefined') return;
		//House pattern: remove when the value equals the default, so the
		//storage stays empty for users who never touched it.
		if (record.enabled === DEFAULT_RECORD.enabled && record.expression === DEFAULT_RECORD.expression) {
			window.localStorage.removeItem(LOCAL_STORAGE_KEY);
			return;
		}
		window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(record));
	} catch {
		//Best effort; the in-memory session still works.
	}
};

export const readStickySearchEnabled = () : boolean => readRecord().enabled;

export const readStickySearchExpression = () : string => readRecord().expression;

export const writeStickySearchEnabled = (enabled : boolean) : void => {
	writeRecord({...readRecord(), enabled});
};

//Parses the stored expression into filter components, validating each with
//the caller-provided validator (the real CollectionDescription round-trip —
//injected rather than imported so this stays a leaf module with no app
//dependencies). Invalid expressions degrade to [] with a warning.
export const stickySearchFilterComponents = (enabled : boolean, expression : string, validate : (expression : string) => string[] | null) : string[] => {
	if (!enabled) return [];
	if (!expression) return [];
	const components = validate(expression);
	if (components === null) {
		//Once per expression string: this runs inside a selector that can
		//recompute often (its inputs include the live filter memberships).
		if (!warnedExpressions.has(expression)) {
			warnedExpressions.add(expression);
			console.warn(`Sticky search filter expression '${expression}' no longer resolves; ignoring it. Reset it from the search dialog.`);
		}
		return [];
	}
	return components;
};

const warnedExpressions = new Set<string>();

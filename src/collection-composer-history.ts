import { CollectionDescription } from './collection_description.js';
import { NONE_FILTER_NAME } from './filter-constants.js';
import {
	collectionDescriptionHasRelativeDateMemory,
	collectionDescriptionWithRelativeDateMemory,
} from './collection-composer-memory.js';
import { currentURLDiagnostics } from '../shared/url-diagnostics.js';
import { urlDiagnosticsForRawURL } from './url-diagnostics-scope.js';

const STORAGE_PREFIX = 'collection-composer-history:';
const MAX_RECENT_COLLECTIONS = 50;

export type RecentCollectionEntry = {
  canonical: string;
  authoring: string;
  visitedAt: number;
  visits: number;
  relativeCanonical?: string;
  relativeAuthoring?: string;
};

export type RememberedCollectionEntry = RecentCollectionEntry & {
  frequent?: boolean;
  relative?: boolean;
};

//`none` is not a collection anybody chose. actions/collection.ts installs it as
//a PLACEHOLDER while a card-link redirect resolves — a description that matches
//no cards and exists for about one dispatch. Recorded as a visit it became
//permanent: CONTINUE offered 'Open Main AND None · 0 cards' forever, with a chip
//that read the bare word 'None'.
//
//The check lives HERE rather than at the one call site, so every future caller
//of recordRecentCollection inherits it, and it runs on READ as well as on write
//so an already-poisoned localStorage heals itself the next time it is opened.
export const collectionDescriptionIsPlaceholder = (description: CollectionDescription): boolean =>
	description.filters.includes(NONE_FILTER_NAME);

//RECENTS MUST NOT LAUNDER A BROKEN COLLECTION INTO A CONFIDENT DESTINATION.
//
//A URL with a clause the app could not understand shows a "Didn't understand"
//notice and a count computed WITHOUT that clause. Recorded as a visit, the
//broken URL came back as a Continue row offering 'Tag 33x' with a card count
//beside it — a phantom collection presented with more confidence than the
//arrival it came from ever had. The same guard that keeps the `none`
//placeholder out keeps these out, and for the same reason: what is recorded is
//a place the user can be sent BACK to.
//
//The signal is the arrival's own diagnostics, scoped the way the drawer notice
//scopes them. rawURL is what the router was actually given, when the caller
//knows it: several report sites name parts the parser DROPPED, which by
//construction never appear in the description's serialization.
export const collectionDescriptionArrivedWithDiagnostics = (description: CollectionDescription, rawURL = ''): boolean => {
	const diagnostics = currentURLDiagnostics();
	if (!diagnostics.length) return false;
	if (urlDiagnosticsForRawURL(diagnostics, description.serializeOriginalOrder()).length) return true;
	return Boolean(rawURL) && urlDiagnosticsForRawURL(diagnostics, rawURL).length > 0;
};

//A filter name this app has no definition for. Configurable filters carry
//their arguments after a '/', and a union is legal as long as one member
//resolves — the same rule the collection engine itself applies.
const filterNameIsKnown = (filterName: string, knownFilterNames: ReadonlySet<string>): boolean => {
	if (filterName.includes('/')) return true;
	return filterName.split('+').some(part => knownFilterNames.has(part));
};

export const collectionDescriptionNamesUnknownFilter = (description: CollectionDescription, knownFilterNames?: ReadonlySet<string>): boolean => {
	if (!knownFilterNames || !knownFilterNames.size) return false;
	return description.filters.some(filterName => !filterNameIsKnown(filterName, knownFilterNames));
};

export const collectionDescriptionActuallyVisited = (
	requested: CollectionDescription,
	active: CollectionDescription,
	updatesCollection: boolean
) : CollectionDescription => updatesCollection ? requested : active;

const storageKey = (scope: string): string =>
	STORAGE_PREFIX + encodeURIComponent(scope || 'public');

const normalizedEntry = (value: unknown): RecentCollectionEntry | null => {
	if (!value || typeof value !== 'object') return null;
	const candidate = value as Partial<RecentCollectionEntry>;
	if (
		typeof candidate.canonical !== 'string' ||
    typeof candidate.authoring !== 'string'
	)
		return null;
	if (
		typeof candidate.visitedAt !== 'number' ||
    !Number.isFinite(candidate.visitedAt)
	)
		return null;
	if (
		typeof candidate.visits !== 'number' ||
    !Number.isFinite(candidate.visits) ||
    candidate.visits < 1
	)
		return null;
	try {
		const description = CollectionDescription.deserialize(candidate.authoring);
		if (description.serialize() !== candidate.canonical) return null;
		//Pruned on read, so a list poisoned before this guard existed heals.
		if (collectionDescriptionIsPlaceholder(description)) return null;
		const relativeDescription = candidate.relativeAuthoring ? CollectionDescription.deserialize(candidate.relativeAuthoring) : null;
		if (relativeDescription && relativeDescription.serialize() !== candidate.relativeCanonical) return null;
		return {
			canonical: candidate.canonical,
			authoring: description.serializeOriginalOrder(),
			visitedAt: candidate.visitedAt,
			visits: Math.floor(candidate.visits),
			...(relativeDescription ? {
				relativeCanonical: relativeDescription.serialize(),
				relativeAuthoring: relativeDescription.serializeOriginalOrder(),
			} : {}),
		};
	} catch {
		return null;
	}
};

//The remembered list is derived purely from the recent list, and the recent
//list now has a stable identity while storage is unchanged — so repeated reads
//during one keystroke's worth of renders reuse the same array rather than
//re-grouping fifty entries, and the composer's downstream memos see an
//argument that did not change.
let rememberedMemo : {recent: RecentCollectionEntry[], knownFilterNames: ReadonlySet<string> | undefined, result: RememberedCollectionEntry[]} | null = null;

//HEALING ON READ, WITHOUT DESTROYING HISTORY.
//
//An entry recorded before the guard above existed can still name a filter this
//app has no definition for. Those are suppressed HERE rather than pruned from
//storage, because "unknown" is not always permanent: section and tag filter
//names load async, and a list rewritten during that window would lose real
//history for good. Suppressed entries come back on their own once the names
//arrive. The caller supplies the names it knows; with no set (or an empty one,
//which is the not-loaded-yet state) nothing is suppressed.
export const readRememberedCollections = (scope = '', knownFilterNames?: ReadonlySet<string>): RememberedCollectionEntry[] => {
	const recent = readRecentCollections(scope);
	if (rememberedMemo && rememberedMemo.recent === recent && rememberedMemo.knownFilterNames === knownFilterNames) return rememberedMemo.result;
	const legible = knownFilterNames && knownFilterNames.size ?
		recent.filter(entry => !collectionDescriptionNamesUnknownFilter(CollectionDescription.deserialize(entry.authoring), knownFilterNames)) :
		recent;
	const result = computeRememberedCollections(legible);
	rememberedMemo = {recent, knownFilterNames, result};
	return result;
};

const computeRememberedCollections = (recent: RecentCollectionEntry[]): RememberedCollectionEntry[] => {
	const groups = new Map<string, {
    authoring: string;
    exactCanonicals: Set<string>;
    visits: number;
    visitedAt: number;
    intrinsicallyRelative: boolean;
    visitedDays: Set<string>;
  }>();
	for (const entry of recent) {
		const canonical = entry.relativeCanonical || entry.canonical;
		const group = groups.get(canonical) || {
			authoring: entry.relativeAuthoring || entry.authoring,
			exactCanonicals: new Set<string>(),
			visits: 0,
			visitedAt: 0,
			intrinsicallyRelative: entry.relativeCanonical === entry.canonical,
			visitedDays: new Set<string>(),
		};
		group.exactCanonicals.add(entry.canonical);
		group.visits += entry.visits;
		group.visitedAt = Math.max(group.visitedAt, entry.visitedAt);
		group.intrinsicallyRelative ||= entry.relativeCanonical === entry.canonical;
		const visitDate = new Date(entry.visitedAt);
		group.visitedDays.add(`${visitDate.getFullYear()}-${visitDate.getMonth() + 1}-${visitDate.getDate()}`);
		groups.set(canonical, group);
	}
	const frequent = [...groups.entries()]
		.filter(([, group]) => {
			if (group.intrinsicallyRelative) return group.visits >= 2;
			if (group.exactCanonicals.size === 1) return group.visits >= 3;
			return group.visits >= 3 && group.visitedDays.size >= 2;
		})
		.sort((left, right) => right[1].visits - left[1].visits || right[1].visitedAt - left[1].visitedAt)
		.map(([canonical, group]) => {
			const inferredRelative = group.exactCanonicals.size >= 2;
			const exactCanonical = [...group.exactCanonicals][0];
			const exactEntry = recent.find(entry => entry.canonical === exactCanonical);
			return {
				canonical: inferredRelative || group.intrinsicallyRelative ? canonical : exactCanonical,
				authoring: inferredRelative || group.intrinsicallyRelative ? group.authoring : (exactEntry?.authoring || group.authoring),
				visitedAt: group.visitedAt,
				visits: group.visits,
				frequent: true,
				relative: inferredRelative,
			};
		});
	//THREE, because a rotation has three legs. Two immediate slots plus one
	//frequency-promoted slot cannot hold an a→b→c→a loop: the collection on
	//screen is suppressed at display time, the promoted row spends a slot on
	//whichever leg is the hub, and the third leg falls off the end of the list
	//the composer actually shows. Three immediate slots plus the promoted one
	//is the smallest budget that keeps every leg of the smallest rotation
	//reachable without typing.
	//
	//The promoted row is chosen from what is NOT already immediate, and the
	//tail is the rest of the recents in recency order, so when frequency
	//promotes nothing new the fourth row backfills with the next distinct
	//recent rather than going blank. That is the same `seen` set doing both
	//jobs; there is no separate backfill pass to keep in sync.
	const immediate = recent.slice(0, 3);
	const seen = new Set(immediate.map(entry => entry.canonical));
	const promoted = frequent.find(entry => !seen.has(entry.canonical));
	if (promoted) seen.add(promoted.canonical);
	return [
		...immediate,
		...(promoted ? [promoted] : []),
		...recent.filter(entry => !seen.has(entry.canonical)),
	].slice(0, MAX_RECENT_COLLECTIONS);
};

const parseRecentCollections = (raw: string | null): RecentCollectionEntry[] => {
	if (!raw) return [];
	const parsed = JSON.parse(raw);
	if (!Array.isArray(parsed)) return [];
	const seen = new Set<string>();
	const result: RecentCollectionEntry[] = [];
	for (const value of parsed) {
		const entry = normalizedEntry(value);
		if (!entry || seen.has(entry.canonical)) continue;
		seen.add(entry.canonical);
		result.push(entry);
		if (result.length >= MAX_RECENT_COLLECTIONS) break;
	}
	return result;
};

//Parsing the stored list costs up to fifty deserialize+serialize round trips,
//and every collection navigation used to pay it on the main thread before the
//collection update was even dispatched. The parse is keyed on the exact string
//that produced it, so a write from another tab (or a test writing storage
//directly) still invalidates it — the cheap getItem happens either way; only
//the validation is skipped.
const parsedCache = new Map<string, {raw: string | null, entries: RecentCollectionEntry[]}>();

//A recorded visit that has not been serialized to storage yet. Reads are served
//from here, so the composer opened one instruction after a navigation still
//sees that navigation. baseRaw is what storage held when the entry was built:
//if storage has since changed underneath us, the pending write is stale and is
//dropped rather than clobbering the newer value.
const pendingWrites = new Map<string, {baseRaw: string | null, entries: RecentCollectionEntry[]}>();
let flushScheduled = false;

//The write itself — JSON.stringify plus a synchronous localStorage set — is the
//part that has no business running inside a navigation. It is deferred to idle
//(or, where that does not exist, to the end of the current task), and forced
//before the page goes away.
export const flushRecentCollections = (): void => {
	flushScheduled = false;
	if (typeof window === 'undefined') return;
	for (const [key, pending] of [...pendingWrites.entries()]) {
		pendingWrites.delete(key);
		try {
			const raw = JSON.stringify(pending.entries);
			window.localStorage.setItem(key, raw);
			parsedCache.set(key, {raw, entries: pending.entries});
		} catch {
			//History is an enhancement and must never block navigation.
		}
	}
};

const scheduleFlush = (): void => {
	if (flushScheduled || typeof window === 'undefined') return;
	flushScheduled = true;
	const idle = (window as unknown as {requestIdleCallback? : (callback : () => void, options? : {timeout : number}) => void}).requestIdleCallback;
	if (idle) idle.call(window, flushRecentCollections, {timeout: 500});
	else queueMicrotask(flushRecentCollections);
};

if (typeof window !== 'undefined') {
	//pagehide, not beforeunload: it fires for bfcache navigations too, and it
	//never blocks the unload.
	window.addEventListener('pagehide', flushRecentCollections);
}

export const readRecentCollections = (scope = ''): RecentCollectionEntry[] => {
	if (typeof window === 'undefined') return [];
	try {
		const key = storageKey(scope);
		const raw = window.localStorage.getItem(key);
		const pending = pendingWrites.get(key);
		if (pending) {
			if (pending.baseRaw === raw) return pending.entries;
			pendingWrites.delete(key);
		}
		const cached = parsedCache.get(key);
		if (cached && cached.raw === raw) return cached.entries;
		const entries = parseRecentCollections(raw);
		parsedCache.set(key, {raw, entries});
		return entries;
	} catch {
		return [];
	}
};

//What the caller knows about the arrival, beyond the description itself.
export type CollectionArrival = {
	//The selector the router was actually given. Several diagnostic sites name
	//parts the parser DROPPED, which by construction never appear in the
	//description's serialization, so the raw text catches more than it can.
	rawURL? : string,
	//Every filter name resolvable right now; empty or absent means "cannot
	//tell yet", and nothing is judged on that basis.
	knownFilterNames? : ReadonlySet<string>,
};

export const recordRecentCollection = (
	description: CollectionDescription,
	scope = '',
	visitedAt = Date.now(),
	arrival: CollectionArrival = {}
): void => {
	if (typeof window === 'undefined') return;
	if (collectionDescriptionIsPlaceholder(description)) return;
	//Spec §Activation failure: "Recent is recorded only after successful
	//activation." An arrival that raised diagnostics did not activate as the
	//URL described it — a clause was dropped and the count is of something
	//else — so it is not a destination to offer back.
	//
	//Two signals, because they catch different halves. Diagnostics are
	//reported LAZILY by the filter run, so at record time they cover the
	//eagerly-parsed parts (a bogus view mode, a bad sort) but not necessarily
	//this arrival's filters yet. The name check covers exactly those, without
	//waiting for anything.
	if (collectionDescriptionNamesUnknownFilter(description, arrival.knownFilterNames)) return;
	if (collectionDescriptionArrivedWithDiagnostics(description, arrival.rawURL)) return;
	try {
		const key = storageKey(scope);
		const pending = pendingWrites.get(key);
		const baseRaw = pending ? pending.baseRaw : window.localStorage.getItem(key);
		const recent = readRecentCollections(scope);
		const canonical = description.serialize();
		const previous = recent.find((entry) => entry.canonical === canonical);
		const relativeDescription = collectionDescriptionWithRelativeDateMemory(description, new Date(visitedAt));
		const hasRelativeDateMemory = relativeDescription.serialize() !== canonical || collectionDescriptionHasRelativeDateMemory(description);
		//Repeated card navigation within one collection should not crowd history
		//or inflate frequency. Only transitions back to a collection count as a
		//new visit.
		if (recent[0]?.canonical === canonical) return;
		const entry: RecentCollectionEntry = {
			canonical,
			authoring: description.serializeOriginalOrder(),
			visitedAt,
			visits: (previous?.visits || 0) + 1,
			...(hasRelativeDateMemory ? {
				relativeCanonical: relativeDescription.serialize(),
				relativeAuthoring: relativeDescription.serializeOriginalOrder(),
			} : {}),
		};
		const next = [
			entry,
			...recent.filter((item) => item.canonical !== canonical),
		].slice(0, MAX_RECENT_COLLECTIONS);
		pendingWrites.set(key, {baseRaw, entries: next});
		scheduleFlush();
	} catch {
		//History is an enhancement and must never block navigation.
	}
};

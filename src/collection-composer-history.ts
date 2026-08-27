import { CollectionDescription } from './collection_description.js';
import { NONE_FILTER_NAME } from './filter-constants.js';
import {
	collectionDescriptionHasRelativeDateMemory,
	collectionDescriptionWithRelativeDateMemory,
} from './collection-composer-memory.js';

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
let rememberedMemo : {recent: RecentCollectionEntry[], result: RememberedCollectionEntry[]} | null = null;

export const readRememberedCollections = (scope = ''): RememberedCollectionEntry[] => {
	const recent = readRecentCollections(scope);
	if (rememberedMemo && rememberedMemo.recent === recent) return rememberedMemo.result;
	const result = computeRememberedCollections(recent);
	rememberedMemo = {recent, result};
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
	const immediate = recent.slice(0, 2);
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

export const recordRecentCollection = (
	description: CollectionDescription,
	scope = '',
	visitedAt = Date.now()
): void => {
	if (typeof window === 'undefined') return;
	if (collectionDescriptionIsPlaceholder(description)) return;
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

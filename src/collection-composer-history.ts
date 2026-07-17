import { CollectionDescription } from "./collection_description.js";
import {
  collectionDescriptionHasRelativeDateMemory,
  collectionDescriptionWithRelativeDateMemory,
} from "./collection-composer-memory.js";

const STORAGE_PREFIX = "collection-composer-history:";
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

export const collectionDescriptionActuallyVisited = (
	requested: CollectionDescription,
	active: CollectionDescription,
	updatesCollection: boolean
) : CollectionDescription => updatesCollection ? requested : active;

const storageKey = (scope: string): string =>
  STORAGE_PREFIX + encodeURIComponent(scope || "public");

const normalizedEntry = (value: unknown): RecentCollectionEntry | null => {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<RecentCollectionEntry>;
  if (
    typeof candidate.canonical !== "string" ||
    typeof candidate.authoring !== "string"
  )
    return null;
  if (
    typeof candidate.visitedAt !== "number" ||
    !Number.isFinite(candidate.visitedAt)
  )
    return null;
  if (
    typeof candidate.visits !== "number" ||
    !Number.isFinite(candidate.visits) ||
    candidate.visits < 1
  )
    return null;
  try {
    const description = CollectionDescription.deserialize(candidate.authoring);
    if (description.serialize() !== candidate.canonical) return null;
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

export const readRememberedCollections = (scope = ""): RememberedCollectionEntry[] => {
  const recent = readRecentCollections(scope);
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
    .map(([canonical, group]) => ({
      canonical,
      authoring: group.authoring,
      visitedAt: group.visitedAt,
      visits: group.visits,
      frequent: true,
      relative: group.exactCanonicals.size >= 2,
    }));
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

export const readRecentCollections = (scope = ""): RecentCollectionEntry[] => {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(storageKey(scope));
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
  } catch {
    return [];
  }
};

export const recordRecentCollection = (
  description: CollectionDescription,
  scope = "",
  visitedAt = Date.now()
): void => {
  if (typeof window === "undefined") return;
  try {
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
    window.localStorage.setItem(storageKey(scope), JSON.stringify(next));
  } catch {
    //History is an enhancement and must never block navigation.
  }
};

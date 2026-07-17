import { CollectionDescription } from "./collection_description.js";

const STORAGE_PREFIX = "collection-composer-history:";
const MAX_RECENT_COLLECTIONS = 20;

export type RecentCollectionEntry = {
  canonical: string;
  authoring: string;
  visitedAt: number;
  visits: number;
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
    return {
      canonical: candidate.canonical,
      authoring: description.serializeOriginalOrder(),
      visitedAt: candidate.visitedAt,
      visits: Math.floor(candidate.visits),
    };
  } catch {
    return null;
  }
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
    //Repeated card navigation within one collection should not crowd history
    //or inflate frequency. Only transitions back to a collection count as a
    //new visit.
    if (recent[0]?.canonical === canonical) return;
    const entry: RecentCollectionEntry = {
      canonical,
      authoring: description.serializeOriginalOrder(),
      visitedAt,
      visits: (previous?.visits || 0) + 1,
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

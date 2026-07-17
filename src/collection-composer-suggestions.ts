import {
  CollectionDescription,
  collectionDescriptionWithFilterAppended,
  collectionDescriptionWithFilterRemoved,
  collectionDescriptionWithQuery,
  collectionDescriptionWithSelected,
  collectionDescriptionWithSet,
  collectionDescriptionWithSortReversed,
} from "./collection_description.js";

import { CONFIGURABLE_FILTER_INFO, SELECTED_FILTER_NAME } from "./filters.js";

export type CollectionComposerSuggestionKind =
  | "add"
  | "broaden"
  | "pivot"
  | "recent"
  | "source"
  | "search";

export type CollectionComposerSuggestion = {
  id: string;
  kind: CollectionComposerSuggestionKind;
  label: string;
  detail: string;
  description: CollectionDescription;
};

export type CollectionComposerContext = {
  cardsSelected?: boolean;
  recentCollections?: Array<{
    description: CollectionDescription;
    visits: number;
  }>;
};

const humanize = (value: string): string =>
  value
    .split(/[- ]/)
    .map((word) => (word ? word[0].toUpperCase() + word.slice(1) : ""))
    .join(" ");

const readableFilter = (filter: string): string => {
  const [family, ...rawValues] = filter.split("/");
  if (!rawValues.length) return humanize(family);
  const values = rawValues.map((value) => {
    try {
      return humanize(decodeURIComponent(value).split("+").join(" "));
    } catch {
      return humanize(value);
    }
  });
  return `${humanize(family)} ${values.join(" · ")}`;
};

const defaultFilter = (name: string): string => {
  const configurable = CONFIGURABLE_FILTER_INFO[name];
  if (!configurable) return name;
  return (
    name +
    "/" +
    configurable.arguments.map((argument) => argument.default).join("/")
  );
};

export const collectionDescriptionFromComposerSource = (
  rawSource: string
): CollectionDescription | null => {
  let source = rawSource.trim();
  if (!source) return null;
  try {
    let routeSource = false;
    if (/^https?:\/\//i.test(source)) {
      source = new URL(source).pathname;
      routeSource = source.startsWith("/c/");
    }
    if (source.startsWith("/")) source = source.slice(1);
    if (source.startsWith("c/")) {
      source = source.slice(2);
      routeSource = true;
    }
    //Fragments describe only the collection and therefore receive the
    //default-card terminator. Routes already contain selected-card policy.
    if (!routeSource && !source.endsWith("/")) source += "/";
    const [description] = CollectionDescription.deserializeWithExtra(source);
    return description;
  } catch {
    return null;
  }
};

const removalSuggestions = (
  current: CollectionDescription
): CollectionComposerSuggestion[] =>
  current.filters.map((filter, index) => ({
    id: `remove:${index}:${filter}`,
    kind: "broaden",
    label: `Remove ${humanize(filter.split("/")[0])}`,
    detail: `Broadens this collection by removing ${filter}`,
    description: collectionDescriptionWithFilterRemoved(current, index),
  }));

const collectionDifference = (
  current: CollectionDescription,
  destination: CollectionDescription,
  visits: number
): string => {
  const changes: string[] = [];
  if (current.set !== destination.set) {
    changes.push(
      `Uses ${humanize(destination.set)} instead of ${humanize(current.set)}`
    );
  }
  const currentFilters = new Set(current.filters);
  const destinationFilters = new Set(destination.filters);
  const removed = current.filters.filter(
    (filter) => !destinationFilters.has(filter)
  );
  const added = destination.filters.filter(
    (filter) => !currentFilters.has(filter)
  );
  if (removed.length)
    changes.push(`Removes ${removed.map(readableFilter).join(", ")}`);
  if (added.length)
    changes.push(`Adds ${added.map(readableFilter).join(", ")}`);
  if (
    current.sort !== destination.sort ||
    current.sortReversed !== destination.sortReversed
  ) {
    changes.push(
      `Sorts by ${destination.sortReversed ? "reverse " : ""}${humanize(
        destination.sort
      )}`
    );
  }
  changes.push(visits > 1 ? `Visited ${visits} times` : "Recently visited");
  return changes.join(" · ");
};

const recentSuggestions = (
  current: CollectionDescription,
  context: CollectionComposerContext
): CollectionComposerSuggestion[] => {
  const seen = new Set<string>();
  const result: CollectionComposerSuggestion[] = [];
  for (const recent of context.recentCollections || []) {
    const canonical = recent.description.serialize();
    if (canonical === current.serialize() || seen.has(canonical)) continue;
    seen.add(canonical);
    result.push({
      id: `recent:${canonical}`,
      kind: "recent",
      label: `Back to ${readableCollectionExpression(recent.description)}`,
      detail: collectionDifference(current, recent.description, recent.visits),
      description: recent.description,
    });
    if (result.length >= 3) break;
  }
  return result;
};

const EMPTY_STATE_FILTERS = ["starred", "unread", "working-notes"];

const emptyStateSuggestions = (
  current: CollectionDescription,
  context: CollectionComposerContext
): CollectionComposerSuggestion[] => {
  const result: CollectionComposerSuggestion[] = recentSuggestions(
    current,
    context
  );
  if (
    context.cardsSelected &&
    !current.filters.includes(SELECTED_FILTER_NAME)
  ) {
    result.push({
      id: "add:selected",
      kind: "add",
      label: "Keep only the selected cards",
      detail:
        "Adds the ordinary Selected filter; clear selection to change its members",
      description: collectionDescriptionWithSelected(current),
    });
  }
  result.push(...removalSuggestions(current));
  for (const filter of EMPTY_STATE_FILTERS) {
    if (current.filters.includes(filter)) continue;
    result.push({
      id: `add:${filter}`,
      kind: "add",
      label: `Keep only ${humanize(filter)}`,
      detail: `Adds ${filter} to this collection`,
      description: collectionDescriptionWithFilterAppended(current, filter),
    });
  }
  if (current.set !== "everything") {
    result.push({
      id: "set:everything",
      kind: "broaden",
      label: "Start from Everything",
      detail: `Replaces the ${humanize(current.set)} set with Everything`,
      description: collectionDescriptionWithSet(current, "everything"),
    });
  }
  result.push({
    id: "sort:reverse",
    kind: "pivot",
    label: current.sortReversed
      ? "Use normal sort direction"
      : "Reverse the current sort",
    detail: current.sortReversed
      ? "Turns off reversed sorting"
      : "Keeps every clause and reverses only the sort",
    description: collectionDescriptionWithSortReversed(
      current,
      !current.sortReversed
    ),
  });
  return result.slice(0, 8);
};

export const collectionComposerSuggestions = (
  current: CollectionDescription,
  input: string,
  filterDescriptions: { [filterName: string]: string },
  context: CollectionComposerContext = {}
): CollectionComposerSuggestion[] => {
  const query = input.trim();
  if (!query) return emptyStateSuggestions(current, context);

  const result: CollectionComposerSuggestion[] = [];
  const looksLikeSource = query.includes("/") || /^https?:\/\//i.test(query);
  if (looksLikeSource) {
    const description = collectionDescriptionFromComposerSource(query);
    if (description) {
      result.push({
        id: `source:${description.serialize()}`,
        kind: "source",
        label: "Open this collection source",
        detail: description.serializeShortOriginalOrder(),
        description,
      });
    }
  }

  const normalizedQuery = query.toLowerCase();
  for (const [name, detail] of Object.entries(filterDescriptions)) {
    if (
      !name.toLowerCase().includes(normalizedQuery) &&
      !detail.toLowerCase().includes(normalizedQuery)
    )
      continue;
    const filter = defaultFilter(name);
    result.push({
      id: `filter:${filter}`,
      kind: "add",
      label: `Add ${humanize(name)}`,
      detail: CONFIGURABLE_FILTER_INFO[name]
        ? `${detail} · starts with an editable default`
        : detail,
      description: collectionDescriptionWithFilterAppended(current, filter),
    });
    if (result.length >= 7) break;
  }

  if (!looksLikeSource) {
    result.push({
      id: `query:${normalizedQuery}`,
      kind: "search",
      label: `Text contains “${query}”`,
      detail: "Explicitly adds a text-query clause to this collection",
      description: collectionDescriptionWithQuery(current, query),
    });
  }

  return result.slice(0, 8);
};

export const readableCollectionExpression = (
  description: CollectionDescription
): string => {
  const clauses = [humanize(description.set)];
  clauses.push(...description.filters.map(readableFilter));
  let result = clauses.join(" AND ");
  if (description.sort !== "default" || description.sortReversed) {
    result += ` · sorted by ${
      description.sortReversed ? "reverse " : ""
    }${humanize(description.sort)}`;
  }
  return result;
};

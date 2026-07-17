import {
  CollectionDescription,
  collectionDescriptionWithFilterAppended,
  collectionDescriptionWithConfigurableFilter,
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
  action: "open" | "add" | "remove" | "replace";
  label: string;
  detail: string;
  description: CollectionDescription;
};

export type CollectionComposerCandidate = {
  filter: string;
  category: "section" | "tag" | "card type" | "todo" | "relationship" | "date" | "author";
  label: string;
  detail: string;
  aliases?: string[];
  searchValues?: string[];
};

export type CollectionComposerContext = {
  cardsSelected?: boolean;
  candidates?: CollectionComposerCandidate[];
  recentCollections?: Array<{
    description: CollectionDescription;
    visits: number;
  }>;
};

const candidateRelevance = (candidate: CollectionComposerCandidate, query: string): number => {
  const values = candidate.searchValues || [candidate.label, candidate.filter, candidate.category, ...(candidate.aliases || [])]
    .map(value => value.toLowerCase());
  if (values.some(value => value === query)) return 0;
  if (values.some(value => value.startsWith(query))) return 1;
  const tokens = query.split(/\s+/).filter(Boolean);
  if (tokens.length && tokens.every(token => values.some(value => value.includes(token)))) return 2;
  if (values.some(value => value.includes(query))) return 3;
  return Number.POSITIVE_INFINITY;
};

const humanize = (value: string): string =>
  value
    .split(/[- ]/)
    .map((word) => (word ? word[0].toUpperCase() + word.slice(1) : ""))
    .join(" ");

export const readableCollectionFilter = (filter: string): string => {
  const [family, ...rawValues] = filter.split("/");
  const readableFamily = (value: string) => {
    try {
      const alternatives = decodeURIComponent(value).split("+").map(humanize);
      return alternatives.length > 1 ? `(${alternatives.join(" OR ")})` : alternatives[0];
    } catch {
      const alternatives = value.split("+").map(humanize);
      return alternatives.length > 1 ? `(${alternatives.join(" OR ")})` : alternatives[0];
    }
  };
  const readableValue = (value: string) => {
    try {
      return humanize(decodeURIComponent(value).split("+").join(" "));
    } catch {
      return humanize(value.split("+").join(" "));
    }
  };
  if (!rawValues.length) return readableFamily(family);
  return `${readableFamily(family)} ${rawValues.map(readableValue).join(" · ")}`;
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
    action: "remove",
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
    changes.push(`Removes ${removed.map(readableCollectionFilter).join(", ")}`);
  if (added.length)
    changes.push(`Adds ${added.map(readableCollectionFilter).join(", ")}`);
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
      action: "open",
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
      action: "add",
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
      action: "add",
      label: `Keep only ${humanize(filter)}`,
      detail: `Adds ${filter} to this collection`,
      description: collectionDescriptionWithFilterAppended(current, filter),
    });
  }
  if (current.set !== "everything") {
    result.push({
      id: "set:everything",
      kind: "broaden",
      action: "replace",
      label: "Start from Everything",
      detail: `Replaces the ${humanize(current.set)} set with Everything`,
      description: collectionDescriptionWithSet(current, "everything"),
    });
  }
  result.push({
    id: "sort:reverse",
    kind: "pivot",
    action: "replace",
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
        action: "open",
        label: "Open this collection source",
        detail: description.serializeShortOriginalOrder(),
        description,
      });
    }
  }

  const normalizedQuery = query.toLowerCase();
  const matchingCandidates = (context.candidates || [])
    .map(candidate => ({candidate, relevance: candidateRelevance(candidate, normalizedQuery)}))
    .filter(match => Number.isFinite(match.relevance))
    .sort((left, right) => left.relevance - right.relevance || left.candidate.label.localeCompare(right.candidate.label));
  const matchingFilters = Object.entries(filterDescriptions)
    .filter(([name, detail]) =>
      name.toLowerCase().includes(normalizedQuery) || detail.toLowerCase().includes(normalizedQuery)
    )
    .map(([name, detail]) => {
      const relevance = (() => {
        const normalizedName = name.toLowerCase();
        if (normalizedName === normalizedQuery) return 0;
        if (normalizedName.startsWith(normalizedQuery)) return 1;
        if (normalizedName.includes(normalizedQuery)) return 2;
        if (detail.toLowerCase().startsWith(normalizedQuery)) return 3;
        return 4;
      })();
      return {name, detail, relevance};
    });
  const interpretations = [
    ...matchingCandidates.map(match => ({type: "candidate" as const, ...match})),
    ...matchingFilters.map(match => ({type: "filter" as const, ...match})),
  ].sort((left, right) => left.relevance - right.relevance ||
    (left.type === "candidate" ? left.candidate.label : left.name).localeCompare(right.type === "candidate" ? right.candidate.label : right.name));
  const seenDestinations = new Set(result.map(suggestion => suggestion.description.serialize()));
  let concreteCandidateCount = 0;
  for (const interpretation of interpretations) {
    let suggestion: CollectionComposerSuggestion;
    if (interpretation.type === "candidate") {
      const candidate = interpretation.candidate;
      if (current.filters.includes(candidate.filter) || concreteCandidateCount >= 6) continue;
      suggestion = {
        id: `candidate:${candidate.category}:${candidate.filter}`,
        kind: "add",
        action: "add",
        label: candidate.label,
        detail: `${candidate.detail} · Adds “${candidate.filter}” to the collection URL`,
        description: collectionDescriptionWithFilterAppended(current, candidate.filter),
      };
    } else {
      const {name, detail} = interpretation;
      const filter = defaultFilter(name);
      const configurable = CONFIGURABLE_FILTER_INFO[name];
      const existingConfigurable = configurable && current.filters.some(currentFilter => currentFilter.startsWith(name + "/"));
      if (!configurable && current.filters.includes(filter)) continue;
      suggestion = {
        id: `filter:${filter}`,
        kind: "add",
        action: existingConfigurable ? "replace" : "add",
        label: `${existingConfigurable ? "Reset" : "Add"} ${humanize(name)}`,
        detail: configurable ? `${detail} · starts with an editable default` : detail,
        description: existingConfigurable ? collectionDescriptionWithConfigurableFilter(current, filter) : collectionDescriptionWithFilterAppended(current, filter),
      };
    }
    const destination = suggestion.description.serialize();
    if (seenDestinations.has(destination)) continue;
    seenDestinations.add(destination);
    if (interpretation.type === "candidate") concreteCandidateCount++;
    result.push(suggestion);
    if (result.length >= 7) break;
  }

  result.push({
    id: `query:${normalizedQuery}`,
    kind: "search",
    action: current.filters.some(filter => filter.startsWith("query/")) ? "replace" : "add",
    label: `Text contains “${query}”`,
    detail: "Explicitly adds a text-query clause to this collection",
    description: collectionDescriptionWithQuery(current, query),
  });

  return result.slice(0, 8);
};

export const readableCollectionExpression = (
  description: CollectionDescription
): string => {
  const parts = collectionExpressionParts(description);
  const clauses = [parts.set.label];
  clauses.push(...parts.filters.map(filter => filter.label));
  let result = clauses.join(" AND ");
  if (parts.modifiers.length) result += ` · ${parts.modifiers.join(" · ")}`;
  return result;
};

export type CollectionExpressionParts = {
  set: { raw: string; label: string };
  filters: Array<{ raw: string; label: string; index: number }>;
  modifiers: string[];
};

export const collectionExpressionParts = (
  description: CollectionDescription
): CollectionExpressionParts => {
  const modifiers: string[] = [];
  if (description.sort !== "default" || description.sortReversed) {
    modifiers.push(`sorted by ${description.sortReversed ? "reverse " : ""}${humanize(description.sort)}`);
  }
  if (description.viewMode !== "list") {
    let view = `viewed as ${humanize(description.viewMode)}`;
    if (description.viewModeExtra) view += ` (${humanize(description.viewModeExtra)})`;
    modifiers.push(view);
  }
  return {
    set: {raw: description.set, label: humanize(description.set)},
    filters: description.filters.map((raw, index) => ({raw, index, label: readableCollectionFilter(raw)})),
    modifiers,
  };
};

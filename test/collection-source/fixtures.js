/*eslint-env node*/

//This catalog deliberately records two different truths:
//
//  * legacyObserved is what today's route parser does. Tests freeze it so a
//    future parser migration can measure compatibility instead of guessing.
//  * desired classifies what a lossless editing parser should preserve. It is
//    documentation for the next parser and is not an assertion that the legacy
//    behavior is desirable.
//
//source is what a user may type or paste. legacyInput is the collection-shaped
//portion that today's app ultimately passes to deserializeWithExtra after its
//router has removed origin, /c/, query, and fragment information.

export const LEGACY_COLLECTION_SOURCE_FIXTURES = [
  {
    name: "ordinary filter with a trailing slash",
    mode: "fragment",
    source: "starred/",
    legacyInput: "starred/",
    legacyObserved: {
      set: "main",
      filters: ["starred"],
      sort: "default",
      sortReversed: false,
      viewMode: "list",
      viewModeExtra: "",
      selectedCard: "",
      setExplicit: true,
    },
    desired: { classification: "executable", preserveRaw: false },
  },
  {
    name: "fragment without a trailing slash",
    mode: "fragment",
    source: "starred",
    legacyInput: "starred",
    legacyObserved: {
      set: "main",
      filters: [],
      sort: "default",
      sortReversed: false,
      viewMode: "list",
      viewModeExtra: "",
      selectedCard: "starred",
      setExplicit: true,
    },
    desired: {
      classification: "executable",
      preserveRaw: true,
      note:
        "Fragment mode treats starred as a filter; only route mode may infer a selected-card suffix.",
    },
  },
  {
    name: "route with an explicit set and selected-card placeholder",
    mode: "route",
    source: "/c/everything/working-notes/_",
    legacyInput: "everything/working-notes/_",
    legacyObserved: {
      set: "everything",
      filters: ["working-notes"],
      sort: "default",
      sortReversed: false,
      viewMode: "list",
      viewModeExtra: "",
      selectedCard: "_",
      setExplicit: true,
    },
    desired: { classification: "executable", preserveRaw: false },
  },
  {
    name: "production-shaped full URL",
    mode: "full-url",
    source:
      "https://thecompendium.cards/c/everything/about-concept/inductively-knowable/_?force-collection#context",
    legacyInput: "everything/about-concept/inductively-knowable/_",
    legacyObserved: {
      set: "everything",
      filters: ["about-concept/inductively-knowable"],
      sort: "default",
      sortReversed: false,
      viewMode: "list",
      viewModeExtra: "",
      selectedCard: "_",
      setExplicit: true,
    },
    desired: {
      classification: "executable",
      preserveRaw: false,
      note:
        "The application adapter, not shared fragment grammar, owns origin, route, query, and fragment policy.",
    },
  },
  {
    name: "incomplete configurable filter",
    mode: "fragment",
    source: "updated/",
    legacyInput: "updated/",
    legacyObserved: {
      set: "main",
      filters: [],
      sort: "default",
      sortReversed: false,
      viewMode: "list",
      viewModeExtra: "",
      selectedCard: "",
      setExplicit: true,
    },
    desired: { classification: "incomplete", preserveRaw: true },
  },
  {
    name: "incomplete nested date filter",
    mode: "fragment",
    source: "updated/before/",
    legacyInput: "updated/before/",
    legacyObserved: {
      set: "main",
      filters: [],
      sort: "default",
      sortReversed: false,
      viewMode: "list",
      viewModeExtra: "",
      selectedCard: "",
      setExplicit: true,
    },
    desired: { classification: "incomplete", preserveRaw: true },
  },
  {
    name: "relative date filter",
    mode: "fragment",
    source: "updated/after/7-days-ago/",
    legacyInput: "updated/after/7-days-ago/",
    legacyObserved: {
      set: "main",
      filters: ["updated/after/7-days-ago"],
      sort: "default",
      sortReversed: false,
      viewMode: "list",
      viewModeExtra: "",
      selectedCard: "",
      setExplicit: true,
    },
    desired: { classification: "executable", preserveRaw: false },
  },
  {
    name: "unknown sort",
    mode: "fragment",
    source: "sort/future-sort/",
    legacyInput: "sort/future-sort/",
    legacyObserved: {
      set: "main",
      filters: [],
      sort: "future-sort",
      sortReversed: false,
      viewMode: "list",
      viewModeExtra: "",
      selectedCard: "",
      setExplicit: true,
    },
    desired: { classification: "unsupported", preserveRaw: true },
  },
  {
    name: "duplicate sorts use the last value",
    mode: "fragment",
    source: "sort/recent/sort/updated/",
    legacyInput: "sort/recent/sort/updated/",
    legacyObserved: {
      set: "main",
      filters: [],
      sort: "updated",
      sortReversed: false,
      viewMode: "list",
      viewModeExtra: "",
      selectedCard: "",
      setExplicit: true,
    },
    desired: {
      classification: "invalid",
      preserveRaw: true,
      note:
        "A lossless editor diagnoses duplicate singleton fields before canonicalizing them.",
    },
  },
  {
    name: "unknown ordinary filter",
    mode: "fragment",
    source: "future-filter/",
    legacyInput: "future-filter/",
    legacyObserved: {
      set: "main",
      filters: ["future-filter"],
      sort: "default",
      sortReversed: false,
      viewMode: "list",
      viewModeExtra: "",
      selectedCard: "",
      setExplicit: true,
    },
    desired: { classification: "unsupported", preserveRaw: true },
  },
  {
    name: "encoded query value",
    mode: "fragment",
    source: "query/Inductively%20Knowable/",
    legacyInput: "query/Inductively%20Knowable/",
    legacyObserved: {
      set: "main",
      filters: ["query/Inductively%20Knowable"],
      sort: "default",
      sortReversed: false,
      viewMode: "list",
      viewModeExtra: "",
      selectedCard: "",
      setExplicit: true,
    },
    desired: {
      classification: "executable",
      preserveRaw: true,
      note:
        "Decode exactly once for display/execution and retain the original token for source editing.",
    },
  },
  {
    name: "invalid view throws in the legacy parser",
    mode: "fragment",
    source: "view/grid/",
    legacyInput: "view/grid/",
    legacyObserved: { throws: "ZodError" },
    desired: { classification: "invalid", preserveRaw: true },
  },
];

//Two ANDed query filters both match both cards. Collection evaluation must use
//the same canonical filter order as serialization, so authoring order cannot
//change result order through the single `query` sort-extra slot.
export const ORDERED_QUERY_BEHAVIOR_FIXTURE = {
  name: "repeated query filters have canonical, order-independent behavior",
  firstSource: "everything/query/alpha/query/beta/",
  secondSource: "everything/query/beta/query/alpha/",
  cards: {
    alphaFirst: { title: "Alpha", body: "<p>beta</p>", sort_order: 1.0 },
    betaFirst: { title: "Beta", body: "<p>alpha</p>", sort_order: 2.0 },
  },
};

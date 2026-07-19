# Collection Composer implementation plan

**Date:** 2026-07-16

**Status:** Working draft for product and engineering refinement

**Product specification:** [Collection Composer](./collection-composer-spec.md)

**Implementation base:** the fast-corpus stack rebased onto `master` at
`3fa9f3a1`, with rewritten fast-corpus tip `f4bc4673`; this base includes
shift-range selection

## Purpose

This plan turns the product specification into a sequence of independently
reviewable changes. It is intentionally a migration plan rather than a rewrite.
Existing collection URLs and `CollectionDescription` execution must remain
stable while a safer editing model and a familiar, delightful composer are
introduced around them.

The implementation succeeds when:

- old URLs continue to produce the same ordered cards;
- incomplete, invalid, legacy, and unsupported source can be edited without
  being silently lost;
- a draft cannot mutate the active collection before explicit Open;
- the first normal-user release includes the complete signature loop, not
  merely a command palette shell; narrower slices may be exposed only through
  explicit development/admin dogfooding;
- every slice can be disabled or rolled back without changing URL semantics.

## Current architecture: useful seams and hazards

### Useful seams

1. `shared/collection_description_base.ts` already contains pure URL parsing
   helpers and accepts configurable-filter grammar as input. This is the right
   home for the new lossless source parser because it can remain independent of
   browser, Redux, Firebase, and Lit.
2. `CollectionDescription` already provides canonical serialization,
   equivalence, and execution. It can remain the lowering and execution target
   during migration.
3. Existing immutable helpers in `src/collection_description.ts` already model
   add, replace, remove, set, sort, query, selected, and key-card changes. They
   are useful behavioral references for pure draft transformations.
4. `CONFIGURABLE_FILTER_INFO`, `CARD_FILTER_DESCRIPTIONS`, set information,
   sorts, tag/section selectors, and card pickers contain much of the raw data
   needed for a registry adapter.
5. The card drawer's existing count area is a natural home for the persistent
   collection sentence and Refine affordance.
6. Ctrl-Shift-L already has a single action entry point that can be redirected
   to source mode behind a capability switch.
7. `implement/fast-corpus` already runs the real `CollectionDescription` and
   `Collection` machinery inside `src/worker/query-engine.ts`. Its
   `runCollection` and subscription protocols already carry generation guards,
   corpus trust/completeness state, selection, identity, permissions, tags,
   sections, reading-list state, editing-card state, restart recovery, shadow
   comparison, and performance instrumentation. Composer preview and membership
   tracing should extend that engine.
8. The fast-corpus performance harness and Playwright configuration provide
   concrete starting points for preview benchmarks and browser smoke coverage.

### Hazards to remove or isolate

1. `deserializeWithExtra()` assumes the last path segment is a selected-card
   suffix. The lower parser drops incomplete multipart filters, accepts unknown
   sorts, and can throw on invalid views. Existing URL tests currently
   characterize some of that loss as expected behavior.
2. `CollectionDescription` combines canonical execution state with traces of
   source intent. It cannot by itself represent invalid text, diagnostics,
   unsupported tokens, or stable editable-clause identity.
3. The existing Configure Collection reducer snapshot becomes the active
   collection on close. That lifecycle is incompatible with preview/commit and
   must not be reused for composer drafts.
4. `navigatePathTo()` silently returns while editing and pushes browser history
   before there is an activation success contract. The composer needs an
   explicit navigation transaction rather than treating this action as a
   reliable commit API.
5. Ctrl/Cmd-K is already card-editor link creation. The global composer must
   never steal it from an editable context.
6. `dialog-element` is visually reusable but lacks full dialog semantics,
   background inertness, focus containment, and reliable invoker restoration.
   Shared button styles remove focus outlines.
7. Filter metadata is split across execution maps, configurable-filter
   configuration, descriptions, selectors, sets, sorts, tags, and sections.
   Replacing those sources in one step would have excessive blast radius.
8. The worker protocol does not yet expose clause-level counts, deltas,
   completeness provenance, or membership traces. Adding those to the existing
   query engine must preserve its trust gates and avoid creating a preview-only
   evaluator with subtly different semantics.
9. `CollectionDescription.serialize()` sorts filters even though execution
   iterates stored filter order. Repeated configurable-filter families can
   overwrite sort extras according to order. Canonical serialization is not a
   safe draft-baseline or activation fingerprint until order independence is
   proven or execution is corrected.

## Architecture strategy

### Strangler boundary

The new system sits in front of existing execution:

```text
source / quick actions / builder controls
                  ↓
       CollectionSourceAst
                  ↓
        CollectionDraft
                  ↓ validate + compile
       CollectionDescription
                  ↓
      existing collection engine
```

During migration, `CollectionDescription` remains the execution authority.
The AST and draft are editing authorities. They may preserve more information
than `CollectionDescription`, but they may not invent a second execution
semantics.

### Proposed modules

| Module                                                | Responsibility                                                                        |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `shared/collection_source.ts`                         | Total fragment tokenization, raw preservation, versioned grammar, diagnostics         |
| `src/collection_route_source.ts`                      | Full URL/route policy, allowed origins, query/hash, selected-card suffix              |
| `src/collection_source_adapter.ts`                    | Supplies app filter grammar and lowers valid AST into `CollectionDescription`         |
| `src/collection_draft.ts`                             | Stable clause IDs, editable structure, pure transformations, source preservation      |
| `src/collection_filter_registry.ts`                   | Product metadata adapter over existing filter/set/sort sources                        |
| `src/collection_expression.ts`                        | Plain-language descriptions and compact collection sentences                          |
| `src/collection_suggestions.ts`                       | Candidate generation, action grammar, suppression, stable IDs, deterministic ranking  |
| `src/collection_preview_client.ts`                    | Composer adapter over the existing corpus-worker bridge and protocol                  |
| `src/worker/query-engine.ts` and worker protocol      | Extend real execution with bounded preview, deltas, completeness, and optional traces |
| `src/collection_activation.ts`                        | Preflight, edit conflict, navigation token, activation confirmation, Recent recording |
| `src/collection_recent_store.ts`                      | Private versioned Recent schema, namespacing, dependencies, expiry, deduplication     |
| `src/components/collection-expression.ts`             | Shared quick/builder/read-only expression rendering                                   |
| `src/components/collection-summary.ts`                | Familiar persistent sentence, count, Refine, Copy Link                                |
| `src/components/collection-composer-dialog.ts`        | Quick and source shell, keyboard contract, suggestion list, mode transitions          |
| `src/components/collection-membership-explanation.ts` | Why-in-this-collection clause trace                                                   |

Names are provisional. The boundaries are the important part.

## Core technical decisions

### 1. Shared grammar and application routing are separate

The parser accepts one of three modes:

- `fragment`: collection source only; a missing trailing slash does not
  silently turn the last filter into a selected card;
- `route`: an app `/c/...` route in which a selected-card suffix is legal;
- `full-url`: parsed by an application adapter with `URL`, allowed-origin and
  route checks, then delegated to route parsing.

It returns a result rather than throwing:

```ts
interface CollectionSourceParseResult {
  ast: CollectionSourceAst;
  rawSegments: RawSourceSegment[];
  diagnostics: CollectionSourceDiagnostic[];
  selectedCard?: RawSourceSegment;
  grammarVersion: string;
}
```

Every segment is `executable`, `unsupported`, `incomplete`, or `invalid`.
Compilation to `CollectionDescription` is a separate function and only succeeds
when the required semantics are executable.

The shared module owns total tokenization, raw preservation, versioned fragment
grammar, and diagnostics. `src/collection_route_source.ts` owns deployment
origins, `/c/` routing, query/hash handling, and selected-card suffix policy.

The first composer dogfood slice emits only legacy-safe canonical URLs. Parser
cutover is explicit rather than accidental:

- valid legacy syntax must lower identically;
- new syntax is editing-only until normal routing supports it;
- incomplete and invalid source is never routable;
- unsupported legacy syntax stays raw and invokes an explicit legacy execution
  policy.

Use named entry points such as `parseSourceForEditing` and
`legacyParseForExecution`. A later cutover PR may route the proven-valid subset
through new-parser lowering with a rollback switch.

### 2. Draft state is not the active Redux snapshot

Redux remains authoritative for the committed active collection. A single
application-scoped, framework-independent `CollectionDraftController`, owned
beside the store rather than by a Lit component lifecycle, contains:

- the draft AST and stable clause IDs;
- exact source text and last valid compiled description;
- the active-description baseline fingerprint;
- corpus, identity, permission, selection, active-card, and time dependencies;
- monotonically increasing draft and preview generations;
- the highlighted suggestion's stable semantic ID;
- session-storage recovery data.

The controller exposes explicit `open(contextSnapshot)`, `transition(command)`,
`externalRevisionChanged(revision)`, `prepare()`, `commit()`, and `close()`
operations. Its transition core is pure; clock, storage, preview, activation,
and Recent are injectable ports. Lit renders controller state and dispatches
commands. Redux needs only composer visibility, entry mode, and invoking context
if other components must open it. Draft keystrokes should not produce global
actions or reuse `collection.snapshot`.

If the committed collection changes while the composer is open, the controller
freezes the draft and asks whether to rebase, keep it as a new destination, or
cancel.

### 3. Product descriptors are serializable and separate from execution

The first registry validates against existing metadata rather than importing
the full execution system into composer UI:

- normal filter descriptions from `CARD_FILTER_DESCRIPTIONS`;
- configurable argument shape from `CONFIGURABLE_FILTER_INFO` through a
  build/test adapter, not through a runtime UI import of factories;
- sets and sorts from their current maps;
- tags, sections, users, and cards through value providers;
- hand-authored product metadata overrides for the first-release filters.

Hand-authored serializable descriptors contain grammar arity, title, keywords,
argument codecs/editors, context dependencies, authorization class,
completeness policy, cost, and layer capabilities. Worker and main-thread
execution registries bind descriptor IDs to factories separately. Execution
factories remain where they are. Over time, metadata can move behind the
descriptor registry one family at a time. A completeness audit reports filters with
missing title, keywords, argument editor, context policy, cost, authorization,
or preview support.

### 4. Suggestions are typed actions, not UI-shaped objects

```ts
type CollectionAction =
  | { kind: "open"; destination: CollectionDraft }
  | { kind: "add"; clauses: CollectionClauseDraft[] }
  | { kind: "remove"; clauseKeys: string[] }
  | { kind: "replace"; clauseKeys: string[]; clauses: CollectionClauseDraft[] }
  | { kind: "edit"; clauseKey: string };

interface CollectionSuggestion {
  id: string;
  action: CollectionAction;
  title: string;
  explanation: string;
  family:
    | "continue"
    | "focus"
    | "pivot"
    | "return"
    | "resume"
    | "interpretation";
  rank: DeterministicRank;
}
```

Candidate generation, suppression, ranking, and presentation are tested
separately. Async preview data annotates suggestions but cannot change action
identity or reorder the list while keyboard focus is active.

### 5. Preview extends the fast-corpus execution engine

The composer uses the existing fast-corpus worker bridge and
`src/worker/query-engine.ts`. It must not create a second corpus mirror or a
preview-only implementation of boolean/filter semantics.

Extend the real evaluator result contract:

```ts
interface CollectionEvaluationResult {
  ids: CardID[];
  labels: string[];
  matchCount: number;
  fallback: CollectionFallbackState;
  partialMatches: CardBooleanMap;
  completeness: CollectionCompleteness;
  contextRevision: CollectionContextRevision;
  clauseCounts?: ClauseCount[];
  delta?: CollectionDelta;
  clauseTrace?: ClauseTrace;
}
```

Add bounded `previewCollection` and later `traceCollection` requests to the
existing generation-keyed protocol. Unsupported trace/delta capabilities return
`unavailable`; they never fall back to repeated main-thread execution on the
typing path. Reuse worker trust gates, reconnect behavior, permission/identity
revisions, selection, editing-card state, and performance instrumentation.

Before designing protocol changes, benchmark existing `runCollection` at 5k,
20k, 40k, and 60k for representative accepted clauses. Decide whether
highlight preview needs cancellation/coalescing or whether preview-on-accept is
already sufficient. The worker design follows measured latency.

### 6. Activation has explicit stages

The composer does not call `navigatePathTo()` and assume success. It uses:

1. compile and validate the draft;
2. freeze the accepted suggestion payload and allocate a navigation token;
3. resolve pending card edits explicitly;
4. preflight locally executable collection semantics;
5. initiate one navigation;
6. synchronously compare-and-commit the expected route exactly once;
7. confirm that scoped/trustworthy results or an explicit degraded result are
   usable;
8. clear session recovery and record Recent according to the defined success
   point;
9. show the semantic receipt and preserve browser Back as underlying Undo.

The state machine distinguishes `prepared`, `route-committed`,
`results-usable`, and `settled`. The route-level API reports whether it pushed
history and does not promise atomic rollback after that point. The minimum
source/quick Open path includes pending-edit resolution, validation before
`pushState`, duplicate-commit protection, an explicit failure result, active
card behavior, and draft retention. Existing navigation callers do not have to
migrate immediately.

### 7. Baselines preserve ordered behavior

Until order independence is proven, the draft baseline and activation
comparison use the complete ordered `CollectionConfiguration` plus contextual
bindings—not canonical serialization. Differential tests compare ordered card
IDs, labels, sort extras, partial matches, fallback state, preview state, and
corpus completeness.

### 8. Accessibility evolves the existing visual primitive

The composer should not create a second visual dialog system. Add an accessible
modal implementation behind the existing `DialogElement` API and styles:

1. visible `:focus-visible` treatment in shared button styles;
2. proper dialog labeling, focus containment, inert background, Escape, and
   invoker restoration;
3. a native `<dialog>` implementation where browser/shadow-DOM testing supports
   it;
4. combobox/listbox behavior owned by the composer, with DOM focus remaining in
   the input.

Roll the foundation through a small existing dialog as a canary before making
it the default for all subclasses. Visual style remains familiar, but visible
focus and other necessary accessibility feedback are intentional improvements,
not regressions to hide.

## Delivery sequence

Each numbered slice should be independently reviewable. Exposure is a separate
decision: incomplete quick-composer slices remain development/admin-only until
the public-v1 gate passes. The PR names are illustrative.

### Track 0 — Validate the interaction and integration target

#### Spike 0A: Disposable interaction prototype

- Build a development-only prototype against a fixed/sanitized corpus and the
  existing `CollectionDescription` helpers.
- Support six to eight common filters, current-collection initialization,
  readable expression, explicit actions, Tab Add, Enter Open, removal, and a
  few fake or intentionally absent consequence previews.
- Prototype at least three native drawer-summary variants: second-line
  sentence, sentence-primary/count-secondary, and compact count/Refine with an
  expandable sentence.
- Test novice and expert tasks before shared shell dimensions, action wording,
  or keyboard behavior harden into platform code.

**Exit:** the primary user can complete the signature flow with no explanation;
the chosen interaction feels familiar first and unusually capable second.

#### Spike 0B: Fast-corpus preview and trace feasibility

- Benchmark existing worker `runCollection` for representative accepted clauses
  and current-context changes at 5k, 20k, 40k, and 60k cards.
- Measure warm/cold latency, request coalescing needs, worker memory, live index
  update cost, trust-gate behavior, and worker restart behavior.
- Prototype the smallest `previewCollection` result extension without changing
  filter semantics.
- Characterize repeated same-family configurable filters and determine whether
  ordered execution can diverge from canonical serialization.

**Exit:** preview timing and protocol design are based on the shipping corpus
engine; ordered semantic behavior is understood before fingerprints are chosen.

### Track A — Prove the semantic bedrock

#### PR 1: Characterize legacy source behavior

- Move URL fixtures into a table-driven corpus usable by old and new parsers.
- Add explicit cases for incomplete filters, missing trailing slashes, selected
  cards, invalid views, unknown sorts/filters, duplicate sort/view, encoded
  values, full URLs, query strings, fragments, and legacy routes.
- Label current lossy behavior as `legacyObserved`, not desired behavior.
- Add production-derived fixtures after removing private values.
- Add ordered behavioral fixtures executed through the fast-corpus
  Node-runnable `QueryEngine`, including IDs, labels, sort extras, partial
  matches, fallback state, context, and completeness.
- Add the minimal typed `collection_composer` capability used for development
  dogfooding and parser shadow comparison.

**Exit:** the current parser's behavior and known hazards are measurable without
changing production execution; canonical and ordered semantic equivalence are
not conflated.

#### PR 2: Add the total lossless parser in shadow mode

- Implement `shared/collection_source.ts` and the grammar adapter.
- Add fuzz/property tests asserting parsing never throws or loses raw input.
- Compile valid current syntax to `CollectionDescription`.
- In development/admin mode, compare legacy and new behavioral results and
  report or locally inspect mismatch categories without source content.
- Do not route production navigation through the new parser yet.
- Document the compatibility matrix and named route-cutover PR. Composer output
  remains legacy-safe until that cutover.

**Exit:** supported production fixtures compile equivalently; unsupported and
invalid fixtures retain exact input and diagnostics. This semantic track does
not block Spike 0A or the first development-only vertical slice.

#### PR 3: Add the application-scoped draft and descriptor subset

- Implement stable clause identity and pure add/remove/replace/invert/OR
  transformations.
- Round-trip every valid fixture through AST → draft → AST → description.
- Build the serializable descriptor subset without importing execution
  factories into the UI bundle, plus a registry completeness report.
- Add readable expression generation for set, common filters, sort, and view;
  unknown clauses remain explicit manual source.

**Exit:** all valid legacy descriptions can enter and leave a draft without
semantic loss; common expressions have native readable descriptions; controller
state survives Lit remounts and is fully transition-tested.

### Track B — Establish the familiar interaction foundation

#### PR 4: Accessible dialog and shortcut foundations

- Add focus-visible styles and targeted browser coverage.
- Implement correct dialog behavior for the composer while reusing the existing
  visual API; canary broadly shared changes before making them defaults.
- Handle Ctrl-K at the existing card-view boundary with deep editable-context
  detection. Preserve card-editor Ctrl/Cmd-K. Do not centralize unrelated app
  shortcuts until more consumers prove the abstraction.
- Add tests for nested shadow focus, Escape, invoker restoration, and editor
  shortcut precedence.

**Exit:** the composer can open without stealing editing commands and can host
an accessible combobox. VoiceOver/Safari and one non-WebKit screen-reader/browser
combination pass the source/quick shell semantics relevant to this slice.

#### PR 5: Thin development-only quick-composer vertical slice

- Add `collection-composer-dialog` behind a capability switch.
- Open the application-scoped draft from the current collection.
- Implement the supported descriptor subset, readable continuous expression,
  typed Open/Add/Remove/Replace/Edit actions, value steps, and targeted filter
  discovery.
- Implement pointer, keyboard, mobile, IME, and screen-reader paths for Tab Add,
  Enter Open, Backspace clause editing, nested Escape, and explicit Open/Cancel.
- Use legacy-safe canonical output and the minimum safe navigation-result
  contract. Retain the old configurator and do not expose the slice to normal
  users.
- Add pure controller/action tests plus one Playwright browser smoke path.

**Exit:** the real app supports the same core flow validated in Spike 0A for the
first-release filter subset, without preview or anticipatory destinations.

#### PR 6: Persistent collection sentence

- Add the shared expression renderer and a compact `collection-summary` inside
  the existing drawer count area.
- Start conservatively: readable clauses, count, Refine, Copy Link, and
  truncation disclosure. Do not turn the drawer into an omnibox.
- Land read-only or dark during development. Do not label the action **Refine**
  while it still opens the legacy commit-on-close configurator. When the new
  composer is enabled, Refine opens it and the old configurator remains an
  explicit fallback.
- Test narrow drawers, long expressions, mobile, 200% zoom, and screen readers.

**Exit:** the chosen prototype variant fits the actual drawer at narrow widths,
mobile, 200% zoom, forced colors, and long translated text. It is not yet a
normal-user discoverability claim until the public composer gate opens.

### Track C — Ship the signature loop

#### PR 7: Recent history and three no-typing destination families

- Add a versioned, capped Recent store namespaced by deployment, UID/session,
  schema, and permission epoch; clear/isolate it on identity change.
- Generate deterministic Return, Focus, and Continue candidate families first.
  Defer Pivot and Resume until observed usefulness justifies them.
- Cap the initial surface at six rows, with exact action/diff explanations and
  stable identity.
- Define the complete argument loop for every advertised filter. Omit filters
  that lead to source-only or unimplemented argument dead ends.

**Exit:** opening without typing routinely offers a useful, inspectable next
destination during dogfooding without feeling busy, bureaucratic, or spooky.

#### PR 8: Extend fast-corpus with consequence preview

- Extend the existing worker protocol and `QueryEngine`; do not add a second
  corpus/index/evaluator.
- Add generation-keyed/coalesced preview requests only as indicated by Spike
  0B measurements.
- Return scoped completeness/provenance, final count, and up to three
  entering/leaving/surviving IDs from real collection execution.
- Preserve focused suggestion identity as annotations arrive.
- Add parity tests and 5k/20k/40k/60k performance gates using the existing
  harness, with documented browser/hardware, warm/cold, median/p95, long-task,
  memory, and live-update definitions.

**Exit:** the audited authorability matrix identifies which filters are
discoverable, configurable, previewable, explainable, and complete in each
corpus mode; no preview invents semantics or falsely claims global exactness.

#### PR 9: Safe activation, continuity, and recovery

- Implement prepared → route-committed → results-usable → settled activation
  states and a router compare-and-commit result.
- Resolve pending edits explicitly, block duplicate commits, preserve the draft
  through failure, and never record Recent before the defined success state.
- Preserve the active card when it remains; disclose the destination card when
  it does not.
- Add the lightweight semantic receipt and browser-Back-based Undo.
- Keep recovery storage minimal, versioned, expiring, and namespaced by
  deployment and UID.

**Exit:** every visible Open path is deterministic, failure-reporting,
reversible, and safe during editing, corpus degradation, permission changes,
double activation, and worker restart.

#### PR 10: Public-v1 hardening and release gate

- Close accessibility, mobile, IME, forced-colors, zoom, long-label, touch,
  permission, partial-corpus, privacy, and performance gaps.
- Add a minimal supported-clause membership explanation or explicitly narrow
  v1's knowability promise to transformation explanation.
- Verify the complete signature demonstration: visible current collection,
  useful no-typing destination, explicit interpretations, Tab composition,
  honest effect, Enter Open, active-card continuity, receipt/Undo, and copied
  canonical link.
- Enable one public `collection_composer_v1` bundle only when all dependent
  capabilities pass. Individual PRs remain reviewable and dogfoodable but are
  not fragmented normal-user releases.

**Exit:** first-time users recognize familiar search/filter navigation and
experience delight through relevance, consequence, continuity, and recovery.

### Track D — Deepen knowability and breadth

#### PR 11: Excellent source mode and explicit parser cutover

- Add exact source input, diagnostics, last-valid interpretation, canonical
  diff, Copy, Cancel, and explicit Open to the shared shell.
- Open only legacy-safe output until the named router cutover is complete.
- Redirect Ctrl-Shift-L for opted-in users while retaining the prompt fallback.
- Decide and implement either editor-only parsing indefinitely or production
  route cutover for the proven-valid compatibility classes.
- Keep shared shell anatomy and focus behavior optimized for both quick and
  source layers; source is a deeper representation, not the component's default
  personality.

#### PR 12: Why in this collection?

- Produce base-set and clause pass/fail/unknown traces from the same evaluator
  definitions used for execution/preview.
- Add OR, NOT, partial-corpus, and sort explanations.
- Offer Remove, Invert, Edit, and Compose from this card.

#### PR 13: Rebuilt visual builder

- Render the draft vertically with task-oriented filter discovery.
- Add specialized editors one filter family at a time.
- Preserve manual/unsupported nodes and provide source escape hatches.
- Keep the old configurator available until representative complex URLs pass
  round-trip and novice task testing.

#### Later slices

- selection-as-query and richer relationship/similarity previews through the
  existing fast-corpus query engine;
- saved/pinned collections with explicit context portability policies;
- compact structured typing syntax;
- learned ranking after deterministic quality and trust are established;
- possible Find/Compose convergence based on observed intent, not assumption.

## Rollout and rollback

Use supported capability bundles, not arbitrary combinations:

- `collection_composer`: master normal-user release gate, default false until
  PR 10;
- development/admin override: enables incomplete vertical slices for dogfood;
- `collection_composer_preview`: subordinate operational gate because worker
  protocol and performance have distinct failure modes;
- parser shadow comparison: development/admin diagnostic capability;
- source mode and visual builder: later capabilities with explicit dependencies.

The fast-corpus work already demonstrates typed build-time/runtime configuration
for corpus capabilities. Reuse that narrow mechanism rather than creating a
general experimentation platform. Document whether disabling a production flag
requires redeploy or supports a remote override; do not call redeploy-only
behavior an immediate kill switch.

Dependency rules are enforced:

- summary may be read-only alone; **Refine** requires quick composition;
- contextual destinations require typed actions and diff rendering;
- previews require quick/builder presentation plus completeness labels;
- source requires lossless editing parse, safe activation, and accessible shell;
- builder requires draft round-trip safety and descriptor/editor coverage.

Rollback rules:

- old navigation and `CollectionDescription` execution remain callable until
  ordered behavioral equivalence passes for the supported compatibility
  classes;
- Ctrl-Shift-L can return to its prompt independently of the quick composer;
- the old configurator remains available until the builder passes round-trip
  gates;
- disabling preview never disables composition and does not create blank
  loading-shaped UI;
- disabling contextual suggestions leaves filter discovery and Recent intact.

## Test architecture

### Pure semantic tests

- table-driven production/legacy source fixtures;
- parser fuzzing with a deterministic seed corpus;
- parse → draft → serialize → parse semantic properties;
- legacy/new ordered behavioral differential execution through the fast-corpus
  Node-runnable `QueryEngine` over generated corpora and contextual bindings;
- transformation and suggestion golden tests;
- context materialization and completeness propagation.

### Component tests

- dialog focus lifecycle and combobox semantics;
- action grammar and key hints;
- stable focus while async annotations arrive;
- source invalid/last-valid recovery;
- persistent sentence truncation and interaction;
- shortcut precedence inside and outside editors.
- IME composition, pointer-only, touch-only, forced-colors, reduced motion,
  mobile virtual-keyboard resizing, 200% zoom, and long translated labels.

### Integration and race tests

- Back/forward and external navigation while composing;
- corpus, selection, identity, and permission revision changes;
- late preview results and worker restart;
- double Enter and click/keyboard overlap;
- pending card edits;
- activation timeout/offline/failure and draft recovery;
- permission noninterference.
- supported capability bundles and rejection/normalization of invalid flag
  combinations.

### Performance gates

- composer warm open under 100 ms;
- local suggestion update under 50 ms;
- clause acceptance under 50 ms;
- no long task caused by preview at 5k, 20k, 40k, or 60k cards;
- bounded worker memory and index-update cost measured separately from typing.

Reuse the fast-corpus harness and Playwright setup. Each blocking gate specifies
browser/version, hardware class, corpus distribution, warm/cold state, median
and p95, main-thread long-task threshold, worker memory ceiling, and live-update
budget. Tests that are too environment-sensitive for CI are named release
checks with stored baselines rather than pretending to be deterministic CI.

## Product checkpoints

Engineering completion is not sufficient. Pause at these checkpoints:

1. **After Spike 0A:** Are starting from the current collection, Tab Add / Enter
   Open, bare-text interpretation, and the centered composer understood without
   teaching?
2. **After Spike 0B:** Can the existing fast-corpus worker deliver trustworthy
   consequence previews within budget, and which request semantics are needed?
3. **After PR 5:** Does the real vertical slice preserve the prototype's
   familiar-but-delightful interaction under actual app state?
4. **After PR 6:** Does the persistent sentence feel like a natural improvement
   to the current drawer, or like a foreign navigation bar?
5. **After PR 7:** Are no-typing destinations useful without feeling busy,
   bureaucratic, or spooky?
6. **After PR 8:** Do changed-card previews add understanding and delight, or
   visual weight without enough value?
7. **Before PR 10 public enablement:** Can the complete signature demo run
   without explanation, and do immediate Back/Undo rates indicate surprises?
8. **Before retiring the old configurator:** Can novices reproduce
   representative hand-authored URLs and explain what will happen?

## Recommended first implementation slice

Start Track 0 and PR 1 in parallel:

- **Spike 0A** validates the central product interaction before platform
  architecture hardens around an untested contract.
- **Spike 0B** measures and prototypes against the existing fast-corpus query
  engine rather than assuming a new worker.
- **PR 1** characterizes legacy and ordered semantic behavior without changing
  production execution.

Together the first slices should produce:

1. a tested interaction contract and chosen drawer-summary direction;
2. measured fast-corpus preview/trace constraints;
3. a reusable fixture schema;
4. a catalog of observed versus desired parser outcomes;
5. explicit route/fragment/full-URL and ordered-filter cases;
6. sanitized production-shaped examples;
7. a behavioral differential harness ready for the new parser and draft.

The prototypes remain development-only. PR 1 does not change parsing,
navigation, UI, or URL serialization.

## Decisions to refine together

1. Should the first visible summary say **Refine**, **Filter**, or make the
   readable sentence itself the obvious button? The implementation can support
   all three, but the first test should use one clear affordance.
2. Which 8–12 filters form the hand-authored first-release metadata subset?
   A likely starting set is card type, section, tag, TODO, published, updated,
   text, author, inbound/outbound references, selected cards, and sort.
3. Is the first rollout admin/development-only, or should source mode go to all
   existing Ctrl-Shift-L users after its later parser/activation gates pass?
4. Should recent collection history remain device-local for the whole first
   release, or is cross-device continuity important enough to design before
   PR 7?
5. Which existing dialog is the lowest-risk accessibility canary?
6. Does v1 require a minimal **Why in this collection?** trace, or is exact
   transformation explanation sufficient until PR 12?
7. Should normal route parsing ever cut over to the lossless parser, or should
   it remain an editor that emits legacy-safe canonical URLs indefinitely?

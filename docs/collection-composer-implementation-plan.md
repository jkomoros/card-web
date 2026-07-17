# Collection Composer implementation plan

**Date:** 2026-07-16

**Status:** Working draft for product and engineering refinement

**Product specification:** [Collection Composer](./collection-composer-spec.md)

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
- the first visible release includes the complete signature loop, not merely a
  command palette shell;
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
8. There is no existing web-worker query infrastructure. Live previews must not
   be implemented by repeatedly constructing full collections on the input
   event path.

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

| Module                                                | Responsibility                                                                                      |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `shared/collection_source.ts`                         | Total parsing, raw-token preservation, diagnostics, grammar versions, full URL/route/fragment modes |
| `src/collection_source_adapter.ts`                    | Supplies the app grammar and lowers valid AST into `CollectionDescription`                          |
| `src/collection_draft.ts`                             | Stable clause IDs, editable structure, pure transformations, source preservation                    |
| `src/collection_filter_registry.ts`                   | Product metadata adapter over existing filter/set/sort sources                                      |
| `src/collection_expression.ts`                        | Plain-language descriptions and compact collection sentences                                        |
| `src/collection_suggestions.ts`                       | Candidate generation, action grammar, suppression, stable IDs, deterministic ranking                |
| `src/collection_preview_client.ts`                    | Generation-keyed worker protocol, scope/completeness/provenance results                             |
| `src/workers/collection-preview-worker.ts`            | Bounded indexed evaluation for explicitly supported preview operations                              |
| `src/collection_activation.ts`                        | Preflight, edit conflict, navigation token, activation confirmation, Recent recording               |
| `src/components/collection-expression.ts`             | Shared quick/builder/read-only expression rendering                                                 |
| `src/components/collection-summary.ts`                | Familiar persistent sentence, count, Refine, Copy Link                                              |
| `src/components/collection-composer-dialog.ts`        | Quick and source shell, keyboard contract, suggestion list, mode transitions                        |
| `src/components/collection-membership-explanation.ts` | Why-in-this-collection clause trace                                                                 |

Names are provisional. The boundaries are the important part.

## Core technical decisions

### 1. Parse modes are explicit

The parser accepts one of three modes:

- `fragment`: collection source only; a missing trailing slash does not
  silently turn the last filter into a selected card;
- `route`: an app `/c/...` route in which a selected-card suffix is legal;
- `full-url`: parsed with `URL`, allowed-origin and route checks, then delegated
  to route parsing.

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

### 2. Draft state is not the active Redux snapshot

Redux remains authoritative for the committed active collection. The composer
owns a session-scoped `CollectionDraftController` containing:

- the draft AST and stable clause IDs;
- exact source text and last valid compiled description;
- the active-description baseline fingerprint;
- corpus, identity, permission, selection, active-card, and time dependencies;
- monotonically increasing draft and preview generations;
- the highlighted suggestion's stable semantic ID;
- session-storage recovery data.

Redux needs only composer visibility, entry mode, and invoking context if other
components must open it. Draft keystrokes should not produce global actions or
reuse `collection.snapshot`.

If the committed collection changes while the composer is open, the controller
freezes the draft and asks whether to rebase, keep it as a new destination, or
cancel.

### 3. The registry begins as an adapter

The first registry reads existing metadata rather than moving every filter:

- normal filter descriptions from `CARD_FILTER_DESCRIPTIONS`;
- configurable arguments and factories from `CONFIGURABLE_FILTER_INFO`;
- sets and sorts from their current maps;
- tags, sections, users, and cards through value providers;
- hand-authored product metadata overrides for the first-release filters.

Execution factories remain where they are. Over time, metadata can move behind
the registry one family at a time. A completeness audit reports filters with
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

### 5. Preview is opt-in per filter and never falls back to expensive UI work

The preview client initially supports only operations that can be evaluated in
a bounded worker index. Unsupported filters return `unavailable`; they do not
fall back to constructing a full collection on the typing path.

The first worker can mirror compact card-index and filter-membership data for:

- base sets;
- normal filters already represented by membership maps;
- tags and sections;
- simple AND, OR, and NOT composition;
- final counts and up to three entering/leaving/surviving card IDs.

Configurable relationships, date ranges, queries, similarity, expansions,
offset/limit, random ordering, and remote filters join only after they have a
bounded worker evaluator and honest completeness policy. Cache keys include all
context dependencies, not only serialized source.

### 6. Activation is a transaction

The composer does not call `navigatePathTo()` and assume success. It uses:

1. compile and validate the draft;
2. freeze the accepted suggestion payload and allocate a navigation token;
3. resolve pending card edits explicitly;
4. preflight locally executable collection semantics;
5. initiate one navigation;
6. confirm the expected active-description fingerprint or report failure;
7. clear session recovery and record Recent only after confirmation;
8. show the semantic receipt and preserve browser Back as underlying Undo.

The transaction has timeout, abort, duplicate-commit, and stale-baseline
outcomes. Existing navigation callers do not have to migrate immediately.

### 7. Accessibility evolves the existing visual primitive

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
it the default for all subclasses. Visual changes should be negligible.

## Delivery sequence

Each numbered slice should be reviewable and releasable independently. The PR
names are illustrative.

### Track A — Prove the semantic bedrock

#### PR 1: Characterize legacy source behavior

- Move URL fixtures into a table-driven corpus usable by old and new parsers.
- Add explicit cases for incomplete filters, missing trailing slashes, selected
  cards, invalid views, unknown sorts/filters, duplicate sort/view, encoded
  values, full URLs, query strings, fragments, and legacy routes.
- Label current lossy behavior as `legacyObserved`, not desired behavior.
- Add production-derived fixtures after removing private values.

**Exit:** the current parser's behavior and known hazards are measurable without
changing production execution.

#### PR 2: Add the total lossless parser in shadow mode

- Implement `shared/collection_source.ts` and the grammar adapter.
- Add fuzz/property tests asserting parsing never throws or loses raw input.
- Compile valid current syntax to `CollectionDescription`.
- In development/admin mode, compare legacy and new compiled configurations and
  report aggregate mismatch categories without source content.
- Do not route production navigation through the new parser yet.

**Exit:** supported production fixtures compile equivalently; unsupported and
invalid fixtures retain exact input and diagnostics.

#### PR 3: Add the draft model and registry adapter

- Implement stable clause identity and pure add/remove/replace/invert/OR
  transformations.
- Round-trip every valid fixture through AST → draft → AST → description.
- Build the registry completeness report.
- Add readable expression generation for set, common filters, sort, and view;
  unknown clauses remain explicit manual source.

**Exit:** all valid legacy descriptions can enter and leave a draft without
semantic loss; common expressions have native readable descriptions.

### Track B — Establish the familiar interaction foundation

#### PR 4: Accessible dialog and shortcut foundations

- Add focus-visible styles and regression screenshots.
- Add the accessible modal implementation and canary it on one existing dialog.
- Add a centralized shortcut dispatcher with editable-context detection.
- Preserve card-editor Ctrl/Cmd-K and route Ctrl-Shift-L through an injectable
  source-mode opener.
- Add tests for nested shadow focus, Escape, invoker restoration, and editor
  shortcut precedence.

**Exit:** the composer can open without stealing editing commands and can host
an accessible combobox.

#### PR 5: Composer shell and excellent source mode

- Add `collection-composer-dialog` behind a capability switch.
- Open from the current collection and keep its draft component-local.
- Implement source input, diagnostics, last-valid interpretation, canonical
  diff, Copy, Cancel, and explicit Open.
- Redirect Ctrl-Shift-L to source mode for opted-in users; retain the prompt as
  immediate rollback.
- Use the activation transaction for source Open.

**Exit:** source mode is safer and at least as fast as the existing prompt; no
quick suggestions are required yet.

#### PR 6: Persistent collection sentence

- Add the shared expression renderer and a compact `collection-summary` inside
  the existing drawer count area.
- Start conservatively: readable clauses, count, Refine, Copy Link, and
  truncation disclosure. Do not turn the drawer into an omnibox.
- Until quick composition is ready, Refine continues to open the familiar old
  configurator. The summary capability may land dark and should not send a
  novice directly into source mode. Once PR 7 ships, Refine opens the same
  composer shell; the old configurator remains an explicit fallback.
- Test narrow drawers, long expressions, mobile, 200% zoom, and screen readers.

**Exit:** novices can discover collection composition through a familiar
filter-summary affordance without knowing a shortcut.

### Track C — Ship the signature loop

#### PR 7: Quick composition and action grammar

- Add the continuous expression input and accessible suggestion list.
- Implement Open/Add/Remove/Replace/Edit typed actions.
- Add filter-family search, value providers, progressive bare-text
  interpretations, and Browse all filters.
- Implement Tab Add, Enter Open, Backspace clause edit, Escape, and persistent
  key hints.
- Initially omit counts where the worker cannot answer honestly.

**Exit:** common collections can be composed quickly with an unambiguous,
familiar keyboard and pointer contract.

#### PR 8: Recent history and deterministic no-typing destinations

- Add private namespaced Recent storage after successful activation.
- Generate small deterministic Continue, Focus, Pivot, Return, and Resume
  candidate sets.
- Ship golden examples and suppression rules; cap the initial list at 6–8 rows.
- Explain every compound destination as an exact clause diff.

**Exit:** opening without typing routinely proposes a useful, inspectable next
destination without learned ranking.

#### PR 9: Indexed preview worker and consequence preview

- Add the worker protocol, index lifecycle, bounded evaluation, generation
  cancellation, and performance harness.
- Support exact/scoped counts and representative deltas only for the audited
  simple-filter subset.
- Preserve focused suggestion identity as preview data arrives.
- Add 5k/20k/60k typing and preview gates.

**Exit:** signature suggestions show trustworthy consequence without main-thread
typing stalls or false global exactness.

#### PR 10: Navigation receipt and active-card continuity

- Preserve the active card when it remains in the destination.
- Preview the move when it will not remain.
- Complete activation failure recovery and session draft restoration.
- Add the lightweight semantic receipt and Undo.

**Exit:** the complete first-release signature loop is continuous, reversible,
and reliable.

### Track D — Deepen knowability and breadth

#### PR 11: Why in this collection?

- Produce base-set and clause pass/fail/unknown traces from the same evaluator
  definitions used for execution/preview.
- Add OR, NOT, partial-corpus, and sort explanations.
- Offer Remove, Invert, Edit, and Compose from this card.

#### PR 12: Rebuilt visual builder

- Render the draft vertically with task-oriented filter discovery.
- Add specialized editors one filter family at a time.
- Preserve manual/unsupported nodes and provide source escape hatches.
- Keep the old configurator available until representative complex URLs pass
  round-trip and novice task testing.

#### Later slices

- selection-as-query and relationship/similarity worker support;
- saved/pinned collections with explicit context portability policies;
- compact structured typing syntax;
- learned ranking after deterministic quality and trust are established;
- possible Find/Compose convergence based on observed intent, not assumption.

## Rollout and rollback

Introduce independently controllable capabilities rather than one master flag:

- lossless parser shadow comparison;
- source composer;
- persistent collection summary;
- quick composer;
- indexed previews;
- contextual destinations;
- visual builder.

The project does not currently have a general feature-flag framework. The first
PR needing a user-visible rollout should add a small typed capability mechanism
to existing app configuration, with safe defaults and admin/development
overrides. It must not grow into a general experimentation platform as part of
this feature.

Rollback rules:

- old navigation and `CollectionDescription` execution remain callable until
  parser shadow mismatches are zero for the supported corpus;
- Ctrl-Shift-L can return to its prompt independently of the quick composer;
- the old configurator remains available until the builder passes round-trip
  gates;
- disabling preview never disables composition;
- disabling contextual suggestions leaves filter discovery and Recent intact.

## Test architecture

### Pure semantic tests

- table-driven production/legacy source fixtures;
- parser fuzzing with a deterministic seed corpus;
- parse → draft → serialize → parse semantic properties;
- legacy/new differential execution over generated small corpora;
- transformation and suggestion golden tests;
- context materialization and completeness propagation.

### Component tests

- dialog focus lifecycle and combobox semantics;
- action grammar and key hints;
- stable focus while async annotations arrive;
- source invalid/last-valid recovery;
- persistent sentence truncation and interaction;
- shortcut precedence inside and outside editors.

### Integration and race tests

- Back/forward and external navigation while composing;
- corpus, selection, identity, and permission revision changes;
- late preview results and worker restart;
- double Enter and click/keyboard overlap;
- pending card edits;
- activation timeout/offline/failure and draft recovery;
- permission noninterference.

### Performance gates

- composer warm open under 100 ms;
- local suggestion update under 50 ms;
- clause acceptance under 50 ms;
- no long task caused by preview at 5k, 20k, or 60k cards;
- bounded worker memory and index-update cost measured separately from typing.

## Product checkpoints

Engineering completion is not sufficient. Pause at these checkpoints:

1. **After PR 5:** Is source mode clearly safer and faster for existing
   Ctrl-Shift-L users?
2. **After PR 6:** Does the persistent sentence feel like a natural improvement
   to the current drawer, or like a foreign navigation bar?
3. **After PR 7:** Do new users recognize ordinary search/filter behavior before
   discovering composition power?
4. **After PR 8:** Are no-typing destinations useful without feeling busy,
   bureaucratic, or spooky?
5. **After PR 9:** Do changed-card previews add understanding and delight, or
   visual weight without enough value?
6. **Before retiring the old configurator:** Can novices reproduce
   representative hand-authored URLs and explain what will happen?

## Recommended first implementation slice

Start with **PR 1: Characterize legacy source behavior**. It is small,
read-only with respect to production semantics, and unlocks the most important
architectural decision: whether the lossless parser can be introduced as a
clean extension of `shared/collection_description_base.ts` or needs a separate
versioned grammar module.

The first slice should produce:

1. a reusable fixture schema;
2. a catalog of observed versus desired parser outcomes;
3. explicit route/fragment/full-URL cases;
4. sanitized production-shaped examples;
5. a differential test harness ready to receive the new parser in PR 2.

It should not change parsing, navigation, UI, or URL serialization.

## Decisions to refine together

1. Should the first visible summary say **Refine**, **Filter**, or make the
   readable sentence itself the obvious button? The implementation can support
   all three, but the first test should use one clear affordance.
2. Which 8–12 filters form the hand-authored first-release metadata subset?
   A likely starting set is card type, section, tag, TODO, published, updated,
   text, author, inbound/outbound references, selected cards, and sort.
3. Is the first rollout admin/development-only, or should source mode go to all
   existing Ctrl-Shift-L users once equivalence gates pass?
4. Should recent collection history remain device-local for the whole first
   release, or is cross-device continuity important enough to design before
   PR 8?
5. Which existing dialog is the lowest-risk accessibility canary?

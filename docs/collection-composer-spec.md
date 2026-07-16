# Collection Composer: collection composition as primary navigation

**Date:** 2026-07-16

**Status:** Proposed

**Related issues:** [#498](https://github.com/jkomoros/card-web/issues/498), [#481](https://github.com/jkomoros/card-web/issues/481), [#131](https://github.com/jkomoros/card-web/issues/131), [#158](https://github.com/jkomoros/card-web/issues/158), [#685](https://github.com/jkomoros/card-web/issues/685), [#574](https://github.com/jkomoros/card-web/issues/574), [#152](https://github.com/jkomoros/card-web/issues/152), [#169](https://github.com/jkomoros/card-web/issues/169), [#115](https://github.com/jkomoros/card-web/issues/115)

## Summary

Card Web's most powerful organizing primitive is the **collection
description**: a composable description of a set of cards, its order, and its
view. Collection descriptions are encoded directly in URLs, so every view can
be navigated to, bookmarked, copied, and linked.

The product should make composing a collection the primary way to navigate.
Pressing **Ctrl-K** opens a Collection Composer initialized with the current
collection. A user can type to add or change a condition, choose a recent or
related collection, broaden or narrow the current collection, or navigate to a
saved collection. **Tab** accepts a clause and continues composing; **Enter**
navigates to the resulting collection.

The same collection has three synchronized representations:

1. **Quick composer:** keyboard-first suggestions and structured clauses.
2. **Visual builder:** discoverable controls for sets, filters, boolean groups,
   sorts, and views.
3. **Source:** the canonical URL collection-description grammar, with
   completion, validation, and a plain-language interpretation.

These are not three query systems. They are three editors for the same
`CollectionDescription`. Switching representations must preserve semantics.
The URL remains canonical.

## Product thesis

Most applications treat filtering as configuration applied after navigation.
Card Web can invert that relationship:

> **Composing a collection is navigation.**

Full-text search is a filter. A tag is a filter. “Cards referenced by this
card” is a filter. Similarity is a filter. Recent views, tabs, shared links,
saved views, and AI context are all collection descriptions.

The Collection Composer should make this model approachable without flattening
its power:

- A novice should be able to discover and combine filters without learning URL
  syntax.
- A regular user should be able to refine a collection rapidly through typed
  suggestions.
- A power user should be able to type or paste a collection description faster
  than navigating any visual UI.
- Every resulting collection should remain linkable, explainable, and
  round-trippable.

This should become one of Card Web's defining interactions, not an
administrative dialog hidden in the card-drawer overflow.

## Governing doctrine: inductively knowable power

This feature should embody the principle described by the production cards
[Inductively knowable](https://thecompendium.cards/c/everything/c-985-fbb171),
[Magic is in tension with knowability](https://thecompendium.cards/c/everything/c-706-acb390),
and [Conceptual burden is number of necessary help articles](https://thecompendium.cards/c/everything/c-500-cff576).

A system can be extremely large and powerful without being opaque. Each layer
must be understandable on its own, including how it connects to the layer
immediately above and below. A user need only understand the cleanly factored
subset necessary for the goal at hand, while retaining confidence that they
could zoom in to explain surprising behavior.

That principle resolves an apparent tension in the desired experience:

> The top of the Collection Composer should feel magical because it is so
> effective, but never because its behavior is unknowable.

The “magic” is compression and excellent defaults. The causality remains
mechanistic and inspectable.

### The ladder of knowability

The feature is organized as a stack. Every layer compiles into the layer below
it, and every layer can be expanded to reveal that lower layer:

```
Contextual suggestions
  “Recently active working notes that need attention”
              ↓ Show why / Show changes

Quick composition
  Everything AND Working notes AND Has TODO AND Updated in 30 days
              ↓ Expand

Visual structure
  FROM / WHERE / AND / OR / NOT / SORT / VIEW
              ↓ Edit source

Canonical collection description
  everything/working-notes/has-todo/updated/after/.../sort/updated/
              ↓ Execute

Collection engine
  sets, filter maps, relationship traversal, sorting, and card IDs
```

No layer is a parallel source of truth. Each higher layer is a more helpful
projection of the same mechanism.

### Inductive knowability requirements

1. **Local explainability:** A user can understand one clause or suggestion
   without first understanding the complete filter system.
2. **Adjacent-layer visibility:** Every magical-looking result offers a concise
   “Why this?” or “Show changes” explanation that reveals the explicit
   collection transformation beneath it.
3. **Stable composition:** A clause means the same thing everywhere it appears.
   Combining clauses changes results according to visible AND, OR, and NOT
   structure—not contextual hidden rules.
4. **Zoomability:** Quick composer → builder → source is a continuous descent
   into detail. Moving back up preserves meaning.
5. **Bounded conceptual burden:** Common goals require only a small vocabulary:
   start set, condition, AND/OR/NOT, sort, and open. Advanced filter families
   can be learned independently when needed.
6. **Mechanistic suggestions:** Suggestions always resolve to explicit changes
   to a collection description. Even if machine learning later helps rank or
   generate suggestions, it does not create uninspectable execution semantics.
7. **Surprise repair:** When results are unexpected, the interface helps the
   user locate which clause included or excluded a card and inspect that
   clause's meaning.
8. **Power without prerequisite mastery:** Users can benefit from a higher layer
   before understanding lower layers. Discovering the mechanism should increase
   mastery rather than reveal that the original explanation was false.

### Bedrock and magic

The canonical collection description and deterministic collection engine are
the bedrock. They should be boring in the best sense: stable, exact,
round-trippable, testable, and durable enough to put in a URL.

Magic is layered above that bedrock:

- readable names instead of raw filter identifiers;
- completions that know which arguments a filter needs;
- counts that explain the effect of adding a clause;
- suggestions that recognize useful narrowings and broadenings;
- recent and related collections that make navigation feel anticipatory;
- eventually, semantic suggestions that infer a useful destination from the
  active card or selected examples.

Every magical layer must terminate in a normal collection description the user
can inspect, copy, modify, and revisit.

## Goals

### Primary goals

1. Make Ctrl-K the fastest way to navigate to a known or newly composed
   collection.
2. Make filters discoverable through readable suggestions, examples, and a
   browsable catalog.
3. Teach the collection model by showing small transformations of the current
   collection.
4. Preserve the canonical URL grammar and expert source-editing workflow.
5. Make AND, OR, NOT, set, sort, and view semantics understandable without
   exposing implementation encodings such as `+`, `exclude`, and `combine`.
6. Give the user confidence about what a collection means and roughly how many
   cards it contains before navigating.
7. Support every existing legal `CollectionDescription`, including descriptions
   that the visual builder does not yet know how to author.
8. Make every capability inductively knowable: useful before it is understood,
   locally explainable when inspected, and precisely represented at the layer
   below.

### Secondary goals

1. Provide a natural home for recent, pinned, and eventually named collections.
2. Suggest useful related collections based on the current collection, active
   card, current selection, and recent navigation.
3. Make advanced capabilities such as relationship, expansion, and semantic
   filters discoverable.
4. Create a filter metadata system from which the composer, builder,
   documentation, validation, and autocomplete can all be generated.

## Non-goals

1. Replacing the collection-description URL with opaque saved-query IDs.
2. Inventing an unrestricted natural-language query engine whose interpretation
   cannot be inspected.
3. Automatically changing a collection because the system believes another
   interpretation was more likely.
4. Building arbitrary unbounded boolean algebra in the first release.
5. Replacing the normal card find dialog immediately. The two surfaces may
   converge later, but the initial composer is collection navigation.
6. Persisting named collections in the first implementation slice.
7. Running expensive full-corpus or semantic work on every keystroke.

## Existing system and constraints

### Collection-description model

`CollectionDescription` currently captures:

- a base set (`main`, `reading-list`, or `everything`);
- zero or more filters, intersected by default;
- union filters;
- configurable filters with URL arguments;
- a sort and reversed state;
- a view mode and optional view-mode argument.

`CollectionDescription.serialize()` creates a canonical URL representation.
`serializeOriginalOrder()` preserves authoring order where needed. Parsing is
handled by `CollectionDescription.deserialize()` and
`deserializeWithExtra()`.

This model is the authority. The composer must use it rather than introduce a
parallel query format that can drift.

### Current collection configurator

The existing `configure-collection-dialog` is a useful proof of concept:

- it snapshots the active collection configuration;
- it can add, modify, union, and remove several filter types;
- it exposes set and sort controls;
- it has custom controls for dates, key cards, and multiple cards;
- it eventually applies the snapshot to the active collection.

It also demonstrates limitations the new design must address:

- an ungrouped dropdown containing a very large filter vocabulary;
- implementation-oriented filter names;
- weak support for `exclude`, `combine`, nested subfilters, unknown filters,
  and relationship-filter arguments;
- prompts for card IDs;
- little explanation of the resulting expression;
- no coherent distinction between previewing and committing navigation;
- no primary keyboard composition flow;
- no recent, related, or suggested collections;
- no single metadata source rich enough to generate high-quality UI.

### Existing shortcuts

- Ctrl/Cmd-F opens card find.
- Ctrl-Shift-L prompts for a path and navigates without a full-page browser
  load.
- Ctrl-K is available as the proposed Collection Composer shortcut, subject to
  a final platform-specific shortcut audit.

Ctrl-Shift-L should become a direct entry into Collection Composer source mode,
not remain a separate prompt-based feature.

## Terminology

**Active collection:** The committed collection currently represented by the
application URL.

**Draft collection:** The valid collection currently being composed but not yet
navigated to.

**Clause:** A user-readable structural component such as “Card type is Working
notes,” “Updated in the last seven days,” or “Has tag AI.”

**Expression:** The full readable composition of set, clauses, sort, and view.

**Interpretation:** A semantic meaning offered for typed input. The input
`systems`, for example, may have tag, section, concept, or text-query
interpretations.

**Transformation:** A suggested change relative to the current draft, such as
adding, removing, replacing, or inverting a clause.

**Source:** The URL-compatible collection-description text.

**Filter definition:** Metadata and behavior describing a filter family,
including how it is rendered, parsed, validated, suggested, and edited.

## Design principles

### 1. Begin from where the user is

Ctrl-K opens with the current collection as the draft. The common operation is
not “start a new search”; it is “adjust what I am looking at.”

This makes the system spatially coherent and allows suggestions such as:

- Narrow to cards updated this month.
- Broaden by removing Has TODO.
- Replace Working notes with Content.
- Reverse the current sort.
- Show references to the active card within this collection.

An explicit **Clear and start from Everything** action is available, but it is
not the default.

### 2. Never hide ambiguity

Bare typed text can map to multiple structural meanings. The composer must show
those meanings separately rather than silently choosing one.

For `systems`, possible results might include:

- **Tag is Systems** — 86 cards
- **Section is Systems** — 41 cards
- **About concept Systems** — 113 cards
- **Text contains “systems”** — 204 cards
- **Saved collection: Systems reading queue** — 17 cards

Ranking may prioritize likely interpretations, but accepting an interpretation
is always explicit. Once accepted, the draft stores the structural clause, not
the ambiguous input string.

### 3. Never hide causality

The system may hide incidental complexity, but it may not hide the reason a
collection has its members. Every complete suggestion exposes:

- the collection it starts from;
- the clauses it adds, removes, replaces, or reorders;
- whether the result is exact, approximate, partial, or remote;
- an affordance to inspect the resulting expression before opening.

The top result may be delightfully concise. Its explanation must still be one
gesture away.

### 4. Prefer transformations over recipes

Suggestions should usually explain how they modify the current draft. “Add
Updated this month” is more educational than presenting a mysterious finished
collection.

When a complete suggested collection is shown, its compact expression must be
visible.

### 5. Progressive disclosure without semantic tiers

Quick composer, visual builder, and source mode expose different levels of
detail, not different capabilities or data models.

A source expression the builder cannot edit must still be rendered as a
read-only/manual clause rather than discarded or corrupted.

### 6. The URL is a feature

The URL should remain visible enough that users understand collections are
linkable. Source mode should be excellent rather than apologetic.

Named and saved collections, when added, point to collection descriptions.
They do not become the only way to address a collection.

### 7. Preview deliberately; commit clearly

Editing a draft must not mutate browser history or the canonical URL. The
application navigates only when the user presses Enter or activates an explicit
Open action.

The user may preview counts and representative cards while composing, but the
active collection remains intact until commit.

### 8. Teach through consequence

Where practical, the builder shows the progressive result count:

```
Everything                         41,202
AND Card type is Working notes      1,842
AND Has any TODO                      184
AND (Tag AI OR Tag Systems)            43
```

This makes boolean structure concrete and helps expose unexpectedly broad or
empty clauses.

## Primary surface: Ctrl-K quick composer

### Opening state

Ctrl-K opens a modal palette over the current view. Focus is placed in the
input. Above it, the draft collection is rendered as a concise readable
expression.

Example:

> **Everything** AND **Working notes** AND **Has any TODO** SORTED BY
> **Recently updated**

The initial suggestion list appears before typing and is grouped as follows:

1. **Recent collections**
2. **Saved collections** (when implemented)
3. **Narrow this collection**
4. **Broaden this collection**
5. **Related to this collection**
6. **Discover filters**

Groups with no useful results are omitted. The list should remain compact; it
is not a complete filter catalog.

### Typing modes

The input accepts all of the following:

1. **Filter discovery:** `updated`, `author`, `todo`, `references`, `similar`.
2. **Values:** `systems`, a person name, a card title, or a date.
3. **Compact structured text:** eventually, expressions such as
   `type:working-notes updated:7d -published sort:recent`.
4. **Collection source:** a pasted path or collection-description fragment.
5. **Complete natural phrases:** `working notes updated this month`, parsed as
   a sequence of suggestions but never committed through an invisible
   interpretation.

The first release only needs filter discovery, values, and pasted source. A
compact human DSL can follow after the structural model is stable.

### Suggestion anatomy

Each suggestion contains:

- a readable primary label;
- a short semantic explanation;
- a preview count when inexpensive and available;
- a category icon or text label;
- the transformation it will perform, when not obvious;
- a cost/status indicator for expensive, partial, unavailable, or permissioned
  filters.
- a **Why this?** explanation for contextual suggestions;
- a **Show changes** affordance when the suggestion transforms more than one
  clause.

Example:

```
Updated in the last 7 days
Add a relative date filter; this collection stays current when linked
29 cards
```

Suggestions must not display raw identifiers when a readable title is known.
Raw syntax may be shown as secondary help for users learning source mode.

### Keyboard behavior

| Input | Behavior |
|---|---|
| Ctrl-K | Open composer; if already open, focus input |
| Up/Down | Move through suggestions |
| Tab | Accept highlighted clause and continue composing |
| Enter with non-empty input | Accept the highlighted interpretation; if the input already represents a complete unambiguous source description, offer/open it |
| Enter with empty input | Navigate to the current draft |
| Shift-Enter | Open draft in a new browser tab, if browser behavior can be supported safely |
| Backspace with empty input | Select the last editable clause; a second Backspace removes it |
| Left/Right with empty input | Move clause focus |
| Delete | Remove the focused clause |
| Escape | Close without navigating; a nested picker consumes the first Escape |
| Ctrl-Shift-L | Open directly in source mode with source selected |

Platform conventions must be audited before finalizing Ctrl versus Cmd. The UI
should display the shortcut appropriate to the current platform.

### Clause editing

Accepted clauses appear as readable, focusable tokens. Activating a token opens
its value editor or a menu with:

- Change
- Invert
- Add OR alternative
- Remove
- Explain this filter
- Edit in source

Operators are structural separators, not editable text tokens.

### Committing navigation

When the input is empty, Enter commits the draft:

1. Serialize the draft through `CollectionDescription`.
2. Navigate using client-side routing.
3. Add one browser-history entry.
4. Record the semantic collection in recent history.
5. Close the composer.

If the draft is equivalent to the active collection, Enter simply closes the
composer. It must not add a duplicate history entry.

## Empty-state suggestions and ranking

### Recent collections

Recent history should store:

- serialized canonical description;
- last authoring-order description when useful;
- last visited timestamp;
- visit count;
- last known count;
- optional user-provided name when saved collections exist.

Consecutive duplicate visits are collapsed. Invalid descriptions are ignored,
not allowed to break the palette.

Recent collections are ranked by recency with a modest frequency boost.
Repeatedly alternating between two collections should keep both near the top.

### Narrow suggestions

Narrowing adds a clause likely to be useful in the current context. Candidate
sources include:

- common filters not already present;
- the active card's type, tags, section, author, TODOs, and relationships;
- the current selection;
- relative-date ranges;
- filters frequently paired with the existing clauses;
- contextual application state such as “selected cards.”

Suggestions should be suppressed when they are redundant, contradictory, or
known to produce the same set.

### Broaden suggestions

Broaden suggestions remove or relax one part of the expression:

- remove a clause;
- replace an absolute date with a wider relative date;
- change a direct relationship to a multi-ply relationship;
- remove a limit;
- move from `main` to `everything`;
- replace an AND group with a broader OR group.

Every broaden suggestion explicitly names what will change.

### Related collections

Related collections are useful semantic neighbors, including:

- swap one tag, section, card type, TODO, or author for a sibling;
- show inbound instead of outbound relationships;
- show similar cards instead of explicit connections;
- reverse or replace the sort;
- show a relationship neighborhood for the active card;
- find cards similar to the current selection;
- reuse the current filters around another key card.

The first release should use deterministic transformations. Learned ranking can
follow only after the interaction is trustworthy.

Learned ranking may decide which valid suggestions appear first. It may not
quietly alter the semantics of a chosen suggestion. A generated suggestion must
still be rendered as an ordinary, inspectable collection transformation before
navigation.

### Ranking policy

Suggestion ranking should combine:

1. textual match quality;
2. structural relevance to the current draft;
3. recent use;
4. likely information value;
5. availability and expected latency;
6. category diversity.

The list must avoid filling entirely with many near-identical tags or sections.
At least the top several results should represent distinct interpretations when
the input is ambiguous.

## Expanded visual builder

The visual builder is available from:

- an **Expand** action in the quick composer;
- the visible collection summary near the card count;
- the existing Configure Collection affordance;
- “Browse all filters.”

It should be a roomy dialog or full-height panel, not a small form containing
dozens of compressed dropdowns.

### Readable structure

The primary column renders the expression vertically:

```
FROM   Everything

WHERE  Card type is Working notes
AND    Has any TODO
AND    ┌ Tag is AI
       └ OR Tag is Systems

SORT   Recently updated first
VIEW   List
```

Each row includes its controls and, when available, the progressive count.

The visual language should keep AND between rows, OR within a visibly grouped
row, and NOT attached to the condition it negates. Users should not need to
manage `exclude`, `combine`, or `+` directly.

### Filter catalog

The secondary column is a searchable catalog grouped by user intent:

1. **Common:** card type, section, tag, TODO, published state.
2. **Time:** created, updated, last tweeted, relative and absolute ranges.
3. **People:** author and collaborator.
4. **Relationships:** parents, children, references, connections, ancestors,
   descendants.
5. **Content and quality:** query, strict query, missing concept, no title, no
   body, possible duplicate when available.
6. **Similarity:** similar to a card, selected cards, or a text query.
7. **Advanced:** expand, offset, limit, explicit card list, manual source.

Each catalog item includes a plain-language description and an example. Filters
not available because of permissions or corpus state should explain why rather
than disappear when discovery would still be useful.

### Argument editors

Filter arguments use specialized controls generated from metadata:

- cards use the find dialog or an inline card autocomplete, never raw-ID
  prompts;
- tags and sections use searchable titled options;
- dates support relative and absolute forms;
- users display identity information rather than UIDs;
- reference types support inclusion and exclusion lists;
- integers and floats have meaningful labels, validation, and bounds;
- nested filters open a nested expression editor;
- query text remains visibly text rather than masquerading as a structural
  filter.

### Unknown and unsupported source

If the parser accepts a filter that the builder cannot edit, the builder shows:

```
Manual filter: <source>
This filter is preserved but does not yet have a visual editor.
[Edit source] [Remove]
```

Opening the builder must never drop, default, reorder incorrectly, or
reinterpret unsupported source.

## Source mode

Source mode replaces the current Ctrl-Shift-L prompt.

### Presentation

It contains:

- an editable collection-description field;
- syntax completion for set, filters, arguments, sort, and view;
- inline validation located at the problematic segment;
- a plain-language interpretation of the last valid parse;
- a preview count for the last valid parse;
- a visible full resulting URL;
- actions to copy, open, or return to the visual representation.

The input should accept either:

- a collection-description fragment;
- an app-relative `/c/...` path;
- a full Card Web URL.

When a full URL includes a selected card, source mode clearly separates the
collection portion from the selected-card suffix.

### Error recovery

Parsing is incremental. While source is invalid:

- preserve the user's exact text;
- keep displaying the interpretation and preview of the last valid draft;
- show the expected token or argument;
- disable Open, except when the current source is valid;
- allow switching back to quick or visual mode only if doing so will not lose
  invalid text, otherwise request confirmation.

### Canonicalization

Before navigation, source mode shows the canonical result if it differs from
what the user typed. Benign reordering or elision should not feel like an
error.

The system should retain authoring order during the editing session so visual
rows do not jump around. Canonical ordering applies when producing the final
canonical URL.

## Boolean expression model

### User-facing model

The user-facing model is:

- one base set;
- zero or more AND conditions;
- an AND condition may contain OR alternatives;
- any condition may be negated;
- some advanced filters contain a nested subcollection or expansion rule;
- one sort and direction;
- one view and optional view configuration.

This covers common use without exposing arbitrary expression trees initially.

### Internal editing model

The current `CollectionDescription.filters: string[]` is suitable for canonical
execution but insufficient as the sole editing representation. The composer
needs stable identity and structured editing.

Introduce a draft-only representation along these lines:

```ts
interface CollectionDraft {
  set: SetName;
  clauses: CollectionClauseDraft[];
  sort: SortName;
  sortReversed: boolean;
  viewMode: ViewMode;
  viewModeExtra: string;
  sourceText?: string;
  lastValidDescription: CollectionDescription;
}

interface CollectionClauseDraft {
  key: string; // Stable for rendering and edits; not serialized.
  expression: FilterExpression;
  source?: string; // Preserves unsupported/manual syntax.
}

type FilterExpression =
  | {kind: 'filter'; filter: StructuredFilter}
  | {kind: 'or'; alternatives: StructuredFilter[]}
  | {kind: 'not'; child: FilterExpression}
  | {kind: 'manual'; source: string};
```

The precise types may change after auditing all `combine`, `exclude`, `expand`,
and union encodings. The invariant is more important than the proposed shape:

> `CollectionDescription → draft → CollectionDescription` must preserve
> semantics for every valid existing description.

### Round-trip contract

Round-trip tests are mandatory for:

- every normal filter;
- every configurable filter;
- unions;
- exclusions;
- combinations;
- expansion filters;
- date ranges;
- multiple-card arguments;
- key-card inclusion syntax;
- sorts and reversed sorts;
- view modes and extras;
- unknown-but-parseable filters;
- explicitly set versus elided default sets;
- descriptions with selected-card suffixes.

## Filter metadata registry

The current filter configuration contains some descriptions and argument types,
but the product experience requires a richer, centralized definition.

Each filter family should expose metadata equivalent to:

```ts
interface FilterDefinition {
  id: string;
  title: string;
  shortTitle?: string;
  description: string;
  category: FilterCategory;
  keywords: string[];
  examples: FilterExample[];
  arguments: FilterArgumentDefinition[];
  supportsNegation: boolean;
  supportsUnion: boolean;
  availability: (state: State) => FilterAvailability;
  cost: 'instant' | 'local-expensive' | 'remote';
  parse(source: string): StructuredFilter | ParseFailure;
  serialize(filter: StructuredFilter): string;
  describe(filter: StructuredFilter, context: DescriptionContext): string;
  suggest(input: string, context: ComposerContext): FilterSuggestion[];
}
```

This registry should drive:

- quick-composer autocomplete;
- visual-builder catalog and controls;
- source completion and validation;
- readable clause descriptions;
- contextual help;
- generated documentation;
- permission and cost messaging;
- deterministic related-collection suggestions.

Dynamic tags and sections participate through generated definitions or a
separate value provider. They must not flood the primary registry list.

## Preview behavior

### Count preview

The quick composer shows the count of the current valid draft. The builder may
show progressive counts after each clause.

Counts are categorized as:

- **Exact:** current local collection engine has completed.
- **Calculating:** debounced work is in progress.
- **Approximate:** a cheaper preview is used for expensive or partially loaded
  corpus state.
- **Unavailable:** permission, corpus mode, or remote dependency prevents a
  useful preview.

The UI must not show stale exact counts as though they belong to a newer draft.
Preview results are keyed by canonical draft description and generation.

### Card preview

The first release does not need a separate mini result list; the count and
existing page behind the modal are sufficient. A later version may show up to
five representative cards, particularly for ambiguous semantic filters.

### Debouncing and cancellation

- Purely structural suggestions update immediately.
- Local count calculation begins only after a clause becomes syntactically
  complete and is debounced.
- In-flight preview work is canceled or generation-discarded when the draft
  changes.
- Remote semantic queries run only after explicit acceptance of the semantic
  clause, not while typing its label.

## History, saved collections, and naming

### Recent history

Recent collection history belongs in the first useful release because it makes
Ctrl-K valuable before the user learns any syntax.

History is local per user/device initially. It records navigation, not every
draft preview. Private collection descriptions must not be sent to analytics.

### Saved collections

Saved collections are a follow-on feature. A saved collection contains:

- name;
- canonical collection description;
- optional description;
- optional pinned state;
- created and updated timestamps;
- owner, if synchronized.

Opening a saved collection navigates to its URL. Editing the current URL does
not silently mutate the saved definition. If the active collection originated
from a saved collection and diverges, the UI may offer **Update saved
collection** or **Save as new**.

### Naming suggestions

The system may generate a readable default label from the expression, but names
are never required. Examples:

- Working notes to connect
- Recently updated cards about AI
- References to “Goodhart's Law”

## Relationship to card find

Card find and collection composition overlap but have different immediate
intent:

- **Find** answers “take me to a card.”
- **Compose** answers “show me a collection.”

The first release keeps Ctrl/Cmd-F as card find and Ctrl-K as collection
composition. However:

- the composer can offer text-query filters;
- find results can offer **Show all results as a collection**;
- composer results can include a direct-card destination when the input exactly
  matches a card;
- both should share text normalization, card autocomplete, and eventually
  ranking infrastructure.

Do not merge the surfaces until testing shows that combined intent can remain
clear.

## Visual design: unmistakably Card Web

The Collection Composer must look and feel like a powerful articulation of the
current Card Web interface. It must not resemble a generic dark command palette,
an IDE bolted onto the application, or a separate design system.

### Existing visual language to preserve

The current application establishes a recognizable vocabulary:

- Source Sans Pro for ordinary interface and card text;
- Raleway for display/header moments;
- a light canvas with white or very-light cards and soft card shadows;
- purple as the primary navigational/action color;
- teal as a secondary relationship/link color;
- restrained gray labels, dividers, counts, and secondary actions;
- material-style icons already defined in `shared/icons.ts`;
- small transparent icon controls for local actions;
- larger filled actions only when an action deserves visual weight;
- card, tag-chip, drawer, and dialog surfaces that already communicate the
  product's object model.

The composer should reuse existing CSS custom properties, typography, icon
assets, button behaviors, transitions, shadows, and responsive conventions.
New tokens or components should be introduced only when they generalize back
into Card Web.

### Quick composer appearance

On desktop, Ctrl-K opens a centered white surface over the current canvas:

- use the existing dialog background treatment and `--card-shadow` lineage;
- leave enough of the current card and drawer visible to preserve navigational
  context;
- use a left-aligned Raleway heading consistent with current dialogs;
- make the input prominent through spacing and typography, not a foreign
  oversized search treatment;
- render suggestions as flat rows separated by rhythm and subtle dividers, not
  as a stack of nested cards;
- use the light transparent primary color for keyboard selection and the
  secondary teal only where relationship semantics genuinely apply;
- use existing icons and small icon-button conventions for remove, expand,
  source, history, and help actions;
- render counts and explanations in the same quiet gray language as the drawer
  card count and existing labels.

The surface should feel fast and light. It is an aperture onto the collection
system, not a new page.

### Expression appearance

The readable expression should borrow from existing tags and card-reference
chips without turning every word into a colorful pill.

- Concrete values such as a tag, section, person, card, or TODO may use the
  appropriate existing chip treatment.
- Operators such as AND, OR, NOT, SORTED BY, and FROM remain quiet textual
  structure.
- Filter-family labels are plain language, not loud badges.
- Color reinforces known Card Web semantics; it does not assign a decorative
  rainbow to arbitrary filter categories.
- Focused/editable clauses receive a clear outline or subtle primary wash using
  existing theme colors.

The expression should read naturally as a sentence at a glance and reveal its
editing affordances on focus, hover, or activation.

### Expanded builder appearance

The builder extends the current Configure Collection dialog but gives the
expression room to breathe:

- one principal white dialog/panel surface;
- a vertical expression aligned with FROM, WHERE, AND, OR, NOT, SORT, and VIEW;
- familiar tag lists and card pickers inside clauses;
- thin `--app-divider-color` rules for structure;
- no nested shadows for every condition;
- the filter catalog presented like the existing drawer/info vocabulary rather
  than a dashboard sidebar from another product;
- the primary Open action uses `--app-primary-color` and existing button
  behavior;
- destructive removal remains visually quiet until focused and uses warning
  color only when actual data or work would be lost.

Progressive counts should sit close to their clause as small gray annotations,
making the mechanism visible without turning the builder into an analytics
screen.

### Source mode appearance

Source mode should feel like the deepest layer of the same surface:

- use the same dialog and expression summary;
- use a simple monospaced text field only for the source itself;
- keep the readable interpretation immediately adjacent;
- highlight parse errors with the existing warning color;
- show completions in the same suggestion-row treatment as quick composition;
- avoid terminal styling, syntax-theme chrome, or developer-tool metaphors.

The source is powerful product UI, not a debug console.

### Motion and transitions

Use Card Web's existing short fade timing. Transitions should communicate layer
changes:

- quick expression expanding into the builder;
- a suggestion becoming an explicit clause;
- a clause revealing its arguments;
- source resolving into a readable expression.

Avoid ornamental motion. The user's spatial context and clause order should
remain stable so that expanding a layer feels like zooming in, not navigating to
an unrelated interface.

### Mobile appearance

On mobile, the composer becomes a full-screen Card Web dialog using the current
mobile dialog convention. Keep the same typography, colors, chips, and action
hierarchy. The expression becomes a vertical readable sequence rather than a
horizontally scrolling token strip.

### Visual acceptance criteria

1. A screenshot without the app title is still recognizably Card Web because it
   uses the same typography, colors, iconography, card shadow, labels, and chip
   vocabulary.
2. The composer looks native beside the existing card stage and drawer at both
   desktop and mobile widths.
3. Quick, builder, and source modes visibly belong to one component family.
4. AND, OR, NOT, clause values, counts, focus, and expensive/partial states are
   distinguishable without relying on decorative color.
5. The interface adds no gratuitous panels, nested cards, shadows, gradients,
   or category colors.
6. Existing components such as `dialog-element`, `tag-list`, card find/pickers,
   button styles, and shared icons are reused or deliberately evolved rather
   than visually reimplemented.

## Accessibility

1. The composer uses a native dialog with a labeled combobox/listbox pattern.
2. Screen readers announce the active suggestion, its semantic category, and
   count—not merely its position.
3. Clauses are focusable controls with accessible names such as “Working notes
   filter; activate to edit.”
4. AND, OR, and NOT are present in accessible expression text, not conveyed by
   indentation or color alone.
5. Preview changes are announced politely and do not interrupt typing.
6. All operations are keyboard accessible without requiring bespoke shortcuts.
7. Focus returns to the invoking element on cancel and to the main collection
   view on navigation.
8. Motion is unnecessary; if transitions are used, reduced-motion preferences
   are honored.
9. Filter descriptions and validation errors meet contrast and text-size
   requirements.

## Mobile behavior

On narrow screens, Ctrl-K's toolbar affordance opens a full-screen composer.
The quick expression wraps into readable rows. Suggestions remain the initial
surface.

The visual builder uses one column:

1. expression;
2. Add condition action;
3. filter catalog presented as a searchable sheet;
4. sticky Open action showing the current count.

Source mode uses a multiline input. It must not rely on hover, tiny token close
buttons, or horizontal scrolling.

## Permissions, partial corpus, and privacy

1. Filter availability is explicit. An AI-only semantic filter may be visible
   with an explanation rather than silently absent.
2. Counts and suggestions must respect visibility permissions and must not leak
   hidden card titles, tags, authors, or collection membership.
3. In partial-corpus mode, local-only filters disclose that results may exclude
   unloaded cards when that is materially possible.
4. Related-query generation using active cards must not expose inaccessible
   relationship targets.
5. Recent collection history is private by default and excluded from general
   analytics payloads.
6. Pasting a URL is parsed locally unless the selected filter explicitly
   requires remote execution.

## Performance requirements

The Collection Composer is navigation infrastructure and must feel immediate.

### Interaction budgets

- Opening with cached suggestions: target under 100 ms.
- Typing-to-local-suggestion update: target under 50 ms.
- Structural clause acceptance: target under 50 ms.
- Count preview: asynchronous; never blocks input.
- No remote request occurs merely from opening the composer.

### Architecture

1. Filter metadata and static suggestions load with the composer code.
2. Dynamic value providers for cards, tags, sections, and users expose indexed
   search APIs rather than rebuilding option arrays per keystroke.
3. Preview collection computations run through the existing worker/query engine
   where available.
4. Results are generation-keyed; stale preview responses are discarded.
5. Common collection counts are cached by canonical description and relevant
   corpus generation.
6. Expensive filter modules are loaded only when selected.
7. Composer opening must not trigger word clouds, suggestions, or other
   unrelated full-corpus consumers.

## Error and edge states

### Empty result

An empty draft is valid. The composer says **No cards currently match** and
offers deterministic recovery transformations such as removing the most
restrictive clause. It does not silently substitute a fallback collection.

### Contradictory clauses

The builder may flag obvious contradictions, such as requiring and excluding
the same concrete filter. The user can still inspect and edit the expression.
Navigation may remain allowed if the underlying description is legal.

### Unavailable filter

If a previously valid URL contains a filter unavailable in the current state,
preserve it and explain the limitation. Do not remove it during visual editing.

### Deleted dynamic values

If a referenced tag, section, user, or key card no longer resolves, retain the
source value and mark it unresolved. Offer Remove or Replace.

### Corpus changes during composition

Counts may update, but clause meaning must not. The preview generation guards
against results from an older corpus or draft being attached to a newer one.

### Navigation to selected card

If the current URL includes a selected card and a draft transformation removes
that card from the result, committing navigates to the default item in the new
collection. If the card remains, preserving it may be offered, but the default
Ctrl-K mental model is collection navigation rather than card retention.

## Analytics and product learning

Any telemetry must avoid recording raw query text, source URLs, card IDs, tag
names, or other corpus content.

Safe aggregate events may include:

- composer opened;
- entry representation used;
- suggestion category accepted;
- number of clauses in committed draft;
- builder opened;
- source parse error category;
- composer canceled versus navigated;
- time from open to navigation;
- whether navigation came from recent, transform, catalog, or source.

The most important qualitative research questions are:

1. Do users understand that they are constructing a linkable destination?
2. Do users expect bare text to search card content or to expose structural
   interpretations?
3. Do users discover filters by typing ordinary words?
4. Are counts sufficient to explain boolean composition?
5. Do users understand the distinction between Tab-to-add and Enter-to-open?
6. Does starting from the current collection feel empowering or surprising?

## Implementation plan

### Phase 0: model and metadata audit

1. Enumerate every legal existing collection-description shape.
2. Add round-trip fixtures covering all normal and configurable filters.
3. Audit `exclude`, `combine`, `expand`, union, key-card, and nested-filter
   semantics.
4. Define the structured draft representation.
5. Extend filter metadata with readable titles, categories, keywords,
   argument definitions, and describers.
6. Inventory the existing dialog, drawer, chip, card-picker, button, typography,
   color, icon, and responsive primitives to establish which are reused and
   which require a general Card Web evolution.

**Exit criterion:** every fixture can parse into a draft and serialize without
semantic loss.

### Phase 1: excellent source editor

1. Replace `askForPathToNavigateTo()`'s prompt with the composer shell in
   source mode.
2. Accept fragments, paths, and full URLs.
3. Add incremental validation and plain-language interpretation.
4. Add source completion from filter metadata.
5. Preserve the last valid preview and provide client-side navigation.

**Exit criterion:** Ctrl-Shift-L is strictly faster and safer than the current
prompt for existing power users.

### Phase 2: Ctrl-K composer foundation

1. Open from the active collection.
2. Render the current expression readably.
3. Add recent collections.
4. Search filter definitions, tags, sections, people, and card values.
5. Implement explicit interpretation suggestions.
6. Implement Tab-to-add, Backspace-to-remove, and Enter-to-navigate.
7. Add debounced exact count preview for inexpensive local filters.

**Exit criterion:** common collections can be created without opening the
builder or typing URL syntax.

### Phase 3: contextual transformations

1. Add deterministic narrow and broaden suggestions.
2. Add related collection suggestions based on the active card.
3. Add selection-based relationship and similarity suggestions.
4. Diversify and rank ambiguous interpretations.
5. Add cost and partial-corpus messaging.

**Exit criterion:** opening Ctrl-K without typing routinely presents a useful
next destination.

### Phase 4: rebuilt visual builder

1. Replace the existing flat configurator with the structured expression UI.
2. Add the categorized filter catalog.
3. Add specialized argument editors.
4. Add AND, OR, and NOT controls.
5. Add progressive counts.
6. Preserve unsupported clauses through manual/source rows.

**Exit criterion:** a novice can reproduce representative hand-authored URLs
through the builder and explain the resulting collection.

### Phase 5: saved collections and richer composition

1. Add named and pinned collections.
2. Add compact structured typed syntax if user testing supports it.
3. Add query-by-exemplar and semantic-text filters.
4. Add generated documentation and filter examples from the registry.
5. Consider convergence points with card find.

## Testing strategy

### Unit tests

1. Parse/serialize round trips for all collection fixtures.
2. Structured draft transformations: add, replace, remove, invert, union.
3. Stable clause identity during edits and reordering.
4. Source validation and recovery from partial input.
5. Suggestion deduplication, diversification, and redundancy suppression.
6. Canonical equivalence detection.
7. Dynamic value resolution and unresolved-value preservation.

### Component tests

1. Opening inherits the active collection.
2. Keyboard navigation follows the specified contract.
3. Tab adds without navigating; Enter commits once.
4. Escape cancels without changing URL or browser history.
5. Ambiguous input shows multiple labeled interpretations.
6. Expensive filters do not run before explicit acceptance.
7. Unknown/manual clauses survive builder edits.
8. Screen-reader labels include expression semantics.

### Integration tests

1. Composer navigation creates one history entry and updates the active
   collection.
2. Back/forward restores prior collection descriptions.
3. Ctrl-Shift-L source edits navigate without a full-page load.
4. Counts do not attach to the wrong generation after rapid edits.
5. Partial corpus and permission states do not leak unavailable data.
6. Mobile layout supports composing, editing, and opening without horizontal
   overflow.

### Manual scenario suite

1. `Everything AND Working notes AND Has TODO, sorted Recent`.
2. `(Tag AI OR Tag Systems) AND Updated this month`.
3. Cards referencing the active card, excluding quotes.
4. Cards similar to three selected cards above a cutoff.
5. Created between two dates by the current user.
6. An existing complex `expand` URL opened in the builder and returned to
   source unchanged.
7. An invalid pasted URL corrected through completion.
8. A deleted tag or missing key card preserved as unresolved source.

## Acceptance criteria for the first product release

1. Ctrl-K opens within 100 ms on a warm application and starts from the active
   collection.
2. The active collection is rendered as a readable expression.
3. Users can discover and add common card-type, section, tag, TODO, date,
   author, text-query, and relationship filters.
4. Ambiguous text presents explicit interpretations.
5. Tab adds a clause; Enter navigates; Escape cancels; all work by keyboard.
6. Recent collections appear without requiring typed input.
7. Draft editing does not modify the URL or browser history before commit.
8. Committing produces one canonical, shareable collection URL.
9. Ctrl-Shift-L opens an autocomplete-enabled source editor with inline
   validation.
10. Source, quick composer, and the supported builder subset round-trip without
    semantic loss.
11. Unsupported-but-valid clauses are preserved visibly.
12. Preview work never blocks typing and stale results are discarded.
13. The experience is available to non-admin users for every filter their data
    and permissions support.
14. The collection-configuring affordance is visible near the collection title
    or count, not hidden exclusively in an overflow panel.
15. Every contextual suggestion can reveal the exact collection transformation
    it proposes and then descend into builder and source representations.
16. For any previewed card, the user can inspect which clauses included or
    excluded it without learning unrelated filter families.
17. The composer uses Card Web's existing typography, colors, iconography,
    shadows, chips, buttons, and mobile dialog conventions and is visually
    coherent beside the current card stage and drawer.

## Decisions made by this specification

1. **Ctrl-K starts from the current collection**, not an empty query.
2. **The URL remains canonical.** Saved collections are aliases/bookmarks, not
   replacements.
3. **Bare text is not silently interpreted.** The user selects among structural
   and text-query meanings.
4. **Tab composes; Enter navigates.** This distinction is central to rapid
   keyboard use.
5. **Preview is staged.** URL and browser history change only on commit.
6. **AND, OR, and NOT are the UI grammar.** Encoding details remain in source
   mode.
7. **The visual builder preserves unsupported source.** It never performs a
   lossy rewrite.
8. **Deterministic suggestions ship before learned suggestions.** Trust and
   explainability come first.
9. **Find and Compose remain distinct initially.** Integration points are
   intentionally provided without prematurely merging intent.
10. **Apparent magic must compile to inspectable mechanism.** Ranking may be
    learned; collection semantics may not be hidden.
11. **The composer extends Card Web's visual language.** It does not introduce
    a visually independent command-palette design system.

## Open questions for product refinement

1. Should Ctrl-K use Ctrl on every platform, the platform primary modifier, or
   support both? This needs conflict testing with browser, OS, and editor
   shortcuts.
2. When the input contains uncommitted bare text and the user presses Enter,
   should Enter accept the highlighted interpretation or create a text-query
   clause by default? This specification currently favors accepting the
   explicit highlighted interpretation.
3. Should the first release allow editing a clause in place inside the quick
   composer, or always open a specialized popover?
4. Should navigation preserve the active card when it matches the new
   collection, or consistently navigate to the collection's default card?
5. How many recent collections should be retained, and should history sync
   across devices?
6. Which contextual transformations are sufficiently predictable for the first
   release?
7. Should relative date syntax such as `7d` be part of the first compact typed
   grammar or remain suggestion-driven initially?
8. How should `combine` and nested `expand` expressions appear when the visual
   builder cannot flatten them into the common AND/OR model?
9. Should exact count computation begin after Tab accepts a clause or while a
   complete highlighted suggestion is merely selected?
10. Does the product call this surface **Collection Composer**, **Collection
    Bar**, or simply **Go to collection**? The internal concept can remain
    Collection Composer even if the visible title is more direct.

## Product-quality bar

This feature succeeds only if it makes Card Web's underlying collection model
feel coherent and unusually powerful.

It is not sufficient to put autocomplete around existing filter names. The
finished experience must:

- invite exploration before the user knows what to type;
- explain ambiguity rather than hide it;
- make small refinements exceptionally fast;
- reveal advanced relationship filters without overwhelming the default list;
- preserve every hand-authored URL;
- remain responsive on a very large corpus;
- produce destinations that are always linkable and shareable;
- make every layer understandable in isolation and connected to adjacent
  layers;
- make surprising membership traceable to explicit clauses;
- feel visually native to Card Web while raising the quality and coherence of
  its shared interaction primitives;
- reward increasing fluency, from clicking suggestions to composing source from
  memory.

The desired feeling is that a user can think of a subset of their card web,
press Ctrl-K, describe it, and arrive there—with the collection's precise,
durable definition visible whenever they want it.

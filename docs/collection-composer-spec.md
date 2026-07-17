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
The current collection is always visible as a compact, readable sentence near
the card drawer title and count. Clicking that sentence—or pressing **Ctrl-K**
outside a card editor—opens a Collection Composer initialized with the current
collection. Before the user types, it offers a small number of useful,
destination-shaped next moves. **Tab** materializes the highlighted
transformation and continues composing; **Enter** opens the collection that is
currently previewed.

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

The current deserialization path is not yet a lossless editing parser. It can
misclassify the final segment as a selected-card suffix, drop incomplete
configurable filters, accept unsupported sort values, or throw on invalid view
state. Unknown filters may also execute differently from what a source editor
would reasonably imply. Phase 0 therefore wraps existing execution in a total,
diagnostic parser before any composer representation claims round-trip safety.

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
- Ctrl/Cmd-K currently creates a link when focus is inside the card editor. The
  proposed Collection Composer shortcut is available outside editable contexts,
  subject to a final platform/browser audit. The established editor behavior
  wins inside card content.

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

**Destination:** A complete collection or card location that can be opened.

**Action type:** The single explicit operation performed by a result: Open,
Add, Remove, Replace, or Edit.

**Context dependency:** A value on which a collection's meaning depends but
which may not be fully contained in its source, such as the current user,
selected cards, active card, time, similarity index, or random seed.

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
detail over one data model. Every layer preserves all semantics. Higher layers
may not author every semantic form, but they never conceal, discard, or silently
rewrite one and always provide an adjacent-layer escape hatch.

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

These are labeled **cards remaining after conditions above**. AND clauses are
commutative, so the order changes the intermediate teaching counts but never
the final collection. The final count remains visually primary.

Counts alone are not sufficient. When space and cost allow, a highlighted
transformation also shows representative cards entering, leaving, or surviving
the change. This ties the abstract expression to concrete objects the user
already understands.

### 9. Familiar shape, delightful consequence

The composer must feel recognizable on first contact: a light Card Web dialog,
a search-like text field, a short result list, familiar filter controls,
ordinary Back/Undo behavior, and explicit Open and Cancel actions. It should
not ask users to learn a novel spatial metaphor, gesture language, query
canvas, or animated mode system before they can use it.

Delight comes from the system being unusually attentive within those familiar
forms:

- the current collection is already present when the surface opens;
- useful destinations appear before typing;
- suggestions use the user's cards and current context;
- the effect of a choice is visible before commitment;
- the same readable expression follows the user through quick, builder, source,
  URL, history, and sharing;
- mistakes are cheap to inspect and undo.

The interaction should produce the reaction “of course it works this way,”
followed by recognition that it is more capable than expected. Novelty is
permitted only when it makes the underlying collection model easier to learn.

## The signature interaction loop

The defining experience uses familiar search, filtering, preview, and undo
patterns in a continuous loop between collection, expression, destination, and
explanation:

1. The ordinary card drawer/header persistently shows a readable collection
   sentence, for example **Working notes · Has TODO · Recent · 43 cards**.
2. Clicking the sentence or pressing Ctrl-K opens it for composition without
   changing the active collection.
3. Before typing, the composer presents a few useful destinations expressed in
   the user's domain, not in filter-system taxonomy.
4. Highlighting a destination previews the exact clause diff, count delta, and
   representative changed cards when available.
5. Tab adds that transformation to the draft and keeps composing. Enter opens
   the highlighted destination—including its visible preview—or the current
   draft when no suggestion is highlighted.
6. After navigation, a lightweight receipt names the change and offers Undo;
   browser Back remains the durable underlying undo.
7. On any card, **Why in this collection?** explains membership clause by
   clause and offers reversible refinements.

The first product release must implement this loop end to end for a small set
of deterministic suggestions. It must not ship merely as a faster version of
Configure Collection.

### Persistent collection sentence

The sentence is a modest evolution of the existing collection title/count area,
not a replacement header, omnibox, or foreign toolbar. It:

- exposes the active collection's important clauses and final count;
- has a visible **Refine** affordance and platform-appropriate shortcut hint;
- opens the same composer as the keyboard shortcut;
- offers **Copy link** nearby and describes the linked view after copying;
- uses **Show cards matching…** as the first-use/Everything invitation;
- remains available as a compact action on mobile;
- briefly highlights only the clause that changed after navigation.

The sentence is readable rather than exhaustive. When truncated, it must
indicate that more clauses exist and expose the complete expression on focus,
hover, or activation.

## The action grammar

Every interactive result has exactly one primary action type. The UI never
requires the user to infer whether choosing a row will modify the draft or
leave for another destination.

| Action  | Meaning                                    | Example                                |
| ------- | ------------------------------------------ | -------------------------------------- |
| Open    | Navigate to a complete destination         | **Open** Systems reading queue         |
| Add     | Add one or more visible clauses            | **Add** tag Systems                    |
| Remove  | Remove named clauses                       | **Remove** Has TODO                    |
| Replace | Exchange one visible structure for another | **Replace** Working notes with Content |
| Edit    | Focus an existing clause or representation | **Edit** Updated this month            |

Requirements:

1. Verb labels lead whenever the result could be ambiguous.
2. **Destinations** and **Refine this collection** are visually separate.
3. A transformation affecting multiple clauses shows a compact before/after
   expression before it can be applied or opened.
4. Each suggestion has a stable semantic ID, action type, immutable
   transformation payload, and deterministic tie-breaker.
5. Keyboard focus remains attached to suggestion identity. Asynchronous counts
   may update a row but may not reorder the focused list until the input or
   draft changes.
6. The transformation accepted on keydown is the one visibly highlighted on
   keydown, even if asynchronous data resolves before the event completes.
7. Mouse activation, Tab, and Enter behavior are defined per action type:
   transformations materialize into the draft; destinations open. A secondary
   action may preview or add a destination's expression, but must be labeled.

## Primary surface: Ctrl-K quick composer

### Opening state

Ctrl-K opens a modal palette over the current view. Focus is placed in an input
embedded at the end of the concise readable draft expression, so composing
feels like continuing a sentence rather than filling in a separate form.

Example:

> **Everything** AND **Working notes** AND **Has any TODO** AND
> **[type another condition…]** SORTED BY **Recently updated**

The initial list contains at most 6–8 rows in two stable sections:

1. **Continue:** recent, pinned, resumable, or active-card destinations.
2. **Refine this collection:** useful narrow, broaden, pivot, and discovery
   transformations.

**Browse all filters** is the final durable escape hatch. Narrow, broaden,
related, and recent remain ranking metadata; they are not a bureaucratic set of
top-level categories the user must understand.

Rows describe destinations and consequences:

```
Working notes connected to this card                         8
Adds Working notes + References within 2 steps

Updated since you were last here                            7
Adds Updated after July 15, 2026 9:42 AM

Keep only cards tagged Systems                             18
Adds Tag is Systems
```

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
- representative cards entering, leaving, or surviving the transformation
  when that preview is inexpensive and permission-safe.

Example:

```
Updated in the last 7 days
Add a relative date filter; this collection stays current when linked
29 cards
```

Suggestions must not display raw identifiers when a readable title is known.
Raw syntax may be shown as secondary help for users learning source mode.

### Keyboard behavior

| Input                                | Behavior                                                                                                                                                      |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ctrl-K                               | Open composer; if already open, focus input                                                                                                                   |
| Up/Down                              | Move through suggestions                                                                                                                                      |
| Tab                                  | Materialize the highlighted transformation into the draft and continue composing; captured only while the suggestion list is open and the combobox owns focus |
| Enter with highlighted suggestion    | Open the collection including the visibly previewed suggestion; an explicit Open destination opens directly                                                   |
| Enter with no highlighted suggestion | Navigate to the current valid draft                                                                                                                           |
| Shift-Enter                          | Open draft in a new browser tab, if browser behavior can be supported safely                                                                                  |
| Backspace with empty input           | Select the last editable clause; a second Backspace removes it                                                                                                |
| Left/Right with empty input          | Move clause focus                                                                                                                                             |
| Delete                               | Remove the focused clause                                                                                                                                     |
| Escape                               | Close without navigating; a nested picker consumes the first Escape                                                                                           |
| Ctrl-Shift-L                         | Open directly in source mode with source selected                                                                                                             |

Platform conventions must be audited before finalizing Ctrl versus Cmd. The UI
should display the shortcut appropriate to the current platform. A persistent,
context-sensitive footer states the active contract, for example **Tab Add ·
Enter Open · Esc Cancel**.

Ctrl/Cmd-K keeps its existing link-creation meaning while focus is in a card
editor or other supported editable field. The composer shortcut applies
outside editing contexts and is always paired with the visible collection
sentence. Opening the composer through another affordance while edits are
pending must never cause navigation to fail silently; Open offers **Save and
navigate**, **Discard and navigate**, or **Cancel** as appropriate.

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

Enter commits the visibly previewed destination, or the draft if no suggestion
is highlighted:

1. Serialize the draft through `CollectionDescription`.
2. Navigate using client-side routing.
3. Add one browser-history entry.
4. Wait for the destination to activate successfully.
5. Record the semantic collection in recent history.
6. Close the composer and show a lightweight semantic receipt with Undo.

If the draft is equivalent to the active collection, Enter simply closes the
composer. It must not add a duplicate history entry.

Commit is single-flight and idempotent. A navigation token prevents double
Enter, click/keypress overlap, or late preview state from dispatching duplicate
navigation.

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
They are described relative to the current collection when that makes the
destination easier to understand:

> **Back to Working notes to connect**
> Removes Systems · adds Has TODO · visited yesterday

Recent entries preserve the dependency bindings and completeness state needed
to explain whether reopening will reproduce, refresh, or reinterpret the
collection.

### First-release destination families

Before typing, the first useful release generates a small deterministic set of
candidate destinations:

1. **Continue this thread:** relationship neighborhoods, nearby cards, and
   similar cards around the active card when available.
2. **Focus this set:** a high-information tag, section, card type, TODO state,
   date range, or other property represented in the current result.
3. **Pivot:** replace one tag, section, relationship direction, key card, sort,
   or other visible clause with a nearby alternative.
4. **Return:** revisit a recent or pinned collection, described by how it
   differs from the current draft.
5. **Resume:** show cards changed since the user last successfully visited this
   collection, compiled to an explicit timestamp clause.

Each family needs golden examples, deterministic candidate generation,
suppression rules, and a stable tie-breaker. Learned ranking is not required to
make the initial state routinely useful.

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

Ranking may recommend an interpretation without forcing the user to resolve
the complete Card Web ontology. Bare text uses a familiar fallback and
progressive alternatives:

- lead with **Search card text for “systems”** when no structural intent was
  expressed;
- group structural alternatives beneath **Use “systems” as…**;
- show only a few diverse meanings initially, followed by **More ways to use
  this**;
- when the user starts with a filter family, first choose the family and then
  its value.

This is explicit ambiguity without decision fatigue.

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
  | { kind: "filter"; filter: StructuredFilter }
  | { kind: "or"; alternatives: StructuredFilter[] }
  | { kind: "not"; child: FilterExpression }
  | { kind: "manual"; source: string };
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

The current parser is not assumed to satisfy this contract. Phase 0 introduces
a total, lossless parser that never throws and never silently drops a segment:

```ts
interface ParsedCollectionSource {
  ast: CollectionSourceAst;
  diagnostics: SourceDiagnostic[];
  rawSegments: RawSourceSegment[];
  selectedCardSuffix?: RawSourceSegment;
}
```

Every segment is classified as **valid and executable**, **valid but
unsupported**, **incomplete**, or **invalid**. Only a validated AST is lowered
to `CollectionDescription`. Unsupported and legacy syntax retains its raw
spelling so adjacent representations cannot corrupt it.

Full URLs are parsed with the platform `URL` parser. The implementation
enforces allowed origins/routes, separates path/query/hash, decodes each token
exactly once, preserves case-sensitive values, defines duplicate-key
precedence, and selects an explicit legacy grammar version. Any canonical
rewrite is previewed as a diff before navigation.

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
  cost: "instant" | "local-expensive" | "remote";
  contextKind:
    | "context-free"
    | "context-bound"
    | "time-relative"
    | "ephemeral"
    | "remote-derived";
  completeness: (state: State) => CompletenessCapability;
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

Computation status and corpus completeness are separate. A completed local
calculation is not globally exact merely because it has finished. Every preview
result carries:

```ts
interface CollectionPreview<T> {
  value?: T;
  status: "calculating" | "complete" | "unavailable" | "failed";
  scope: PreviewScope;
  completeness: "exact" | "lower-bound" | "approximate" | "unknown";
  provenance: PreviewProvenance;
  generation: number;
}
```

User-facing examples include:

- **Exact across all available cards**;
- **Exact for 5,000 loaded cards**;
- **At least 83 cards**;
- **Approximate**;
- **Global count unavailable**.

Each filter and base set declares which completeness claims it can support.
Relationship, author, similarity, missing-concept, and remote filters may have
different completeness even inside one expression.

The UI must not show stale exact counts as though they belong to a newer draft.
Preview results are keyed by canonical draft description and generation.

### Card preview

The first release previews up to three representative changed cards for the
small set of signature deterministic destinations when that work is immediate
and permission-safe. A narrowing emphasizes survivors; a broadening emphasizes
entrants. Other suggestions may remain count-only. The preview is a compact
extension of the familiar result row, not a second card drawer or carousel.

The delta is primary:

> **184 → 29 cards**
> Keeps “Inductively knowable,” “Magic is in tension…,” and 27 others

No preview is preferable to a stale, misleading, or permission-sensitive one.

### Debouncing and cancellation

- Purely structural suggestions update immediately.
- Local count calculation begins only after a clause becomes syntactically
  complete and is debounced.
- In-flight preview work is canceled or generation-discarded when the draft
  changes.
- Remote semantic queries run only after explicit acceptance of the semantic
  clause, not while typing its label.
- The visible list does not reorder under keyboard focus when a count or
  dynamic provider resolves.
- Local preview execution runs off the UI thread. Cancellation includes
  cooperative abort points so expensive work stops rather than merely having
  its answer discarded.
- Progressive counts use a costed plan and may be limited or omitted for long
  expressions. Cache keys include corpus, permission, identity, selection,
  active card, similarity-index, time-bucket, and random-seed dependencies.

### Explain membership

Every displayed card offers **Why in this collection?** from an existing card
action location. The explanation is concrete rather than theoretical:

- whether the card belongs to the base set;
- pass, fail, or unknown for every clause;
- which OR alternatives passed;
- the result of negation;
- whether partial-corpus or remote state limits certainty;
- the sort value and resulting position when useful.

An AND clause does not claim to have independently “included” a card; the card
passes the expression as a whole. An excluded card may visibly fail multiple
clauses. Each row may offer familiar, reversible actions such as **Remove this
condition**, **Invert**, or **Edit**.

The companion **Compose from this card** action offers deterministic object-led
transformations such as keeping its section, following its references, or
excluding its card type. Users can therefore learn filters from cards already
on screen rather than beginning with an abstract catalog.

## History, saved collections, and naming

### Recent history

Recent collection history belongs in the first useful release because it makes
Ctrl-K valuable before the user learns any syntax.

History is local per user/device initially. It records navigation, not every
draft preview. Private collection descriptions must not be sent to analytics.

History is namespaced by deployment, user ID, and permission epoch and is
purged or made inaccessible on identity change. A recent entry is recorded
only after its destination activates successfully.

Every entry stores the source plus any dependency binding needed to interpret
it. A context-dependent collection must say whether reopening will:

- preserve dynamic meaning;
- materialize the values captured at visit time; or
- require context that is no longer available.

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

Before saving or sharing a context-bound, time-relative, ephemeral, or
remote-derived collection, the UI applies the filter family's declared policy:
**keep dynamic**, **freeze current values**, or **cannot be made portable**.
This is especially important for selected cards, the active card, `me`,
relative dates, similarity state, and random ordering.

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

One restrained native transition may connect cause and effect: an accepted
suggestion settles into its place in the readable expression, the count
crossfades, and the composer contracts toward the persistent collection
sentence on commit. Existing clause positions remain stable. Relationship
transformations may use the existing teal semantics; ordinary filters remain
purple or neutral.

Avoid ornamental motion, spatial novelty, or choreography that users must
interpret. The surface must remain fully understandable when transitions are
disabled. Expanding a layer should feel like revealing familiar detail, not
navigating to an unrelated interface.

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
7. A first-time user recognizes the surface as a familiar search/filter dialog
   before noticing its more powerful composition behavior.
8. Delight is attributable to useful context, preview, continuity, and
   reversibility—not decorative novelty.

## Accessibility

An accessible dialog and button foundation is a Phase 0 prerequisite. Existing
components may be visually reused, but they must be deliberately evolved where
they lack semantics, focus containment/restoration, background inertness, or
visible focus. Blanket removal of focus outlines is not acceptable.

1. The composer uses native `<dialog>` or a complete ARIA dialog implementation
   with labeling, focus trapping, inert background, and invoker restoration.
2. The input uses a labeled combobox/listbox pattern. DOM focus remains in the
   input and the active suggestion is exposed through `aria-activedescendant`;
   clause editing is a separate roving-tabindex region.
3. Screen readers announce the active suggestion, its semantic category, and
   count—not merely its position.
4. Clauses are focusable controls with accessible names such as “Working notes
   filter; activate to edit.”
5. AND, OR, and NOT are present in accessible expression text, not conveyed by
   indentation or color alone.
6. Accepted-clause result changes are announced politely; incidental
   asynchronous count churn is exposed without repeated live-region chatter.
7. All operations are keyboard accessible without requiring bespoke shortcuts.
   Tab retains normal focus traversal unless the suggestion combobox is active
   and its visible footer says Tab will add.
8. Focus returns to the invoking element on cancel and to the main collection
   view on navigation.
9. Motion is unnecessary; if transitions are used, reduced-motion preferences
   are honored.
10. Filter descriptions and validation errors meet contrast and text-size
    requirements.
11. Touch targets, persistent edit affordances, long expressions, and 200%
    zoom meet platform accessibility expectations; no essential control is
    hover-only or unlabeled icon-only.

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
7. Catalog availability is presentation, not authorization. Execution, counts,
   dynamic values, and remote previews independently authorize every request
   against the current identity and permission epoch.
8. Adding an inaccessible card must not change visible suggestions, counts,
   timing classes, or error shapes. Permission noninterference is tested.
9. Cached privileged values and history are never reused after logout, account
   switching, or a permission-epoch change.

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
3. Preview collection computations run off the UI thread. Filters that cannot
   yet execute safely outside the main thread do not receive live preview.
4. Results are generation-keyed; stale preview responses are discarded.
5. Common collection counts are cached by canonical description and relevant
   corpus generation.
6. Expensive filter modules are loaded only when selected.
7. Composer opening must not trigger word clouds, suggestions, or other
   unrelated full-corpus consumers.
8. Preview execution uses a costed plan, hard CPU/time budgets, cooperative
   cancellation, timeout states, and bounded progressive-count work.
9. The draft records the active-description revision, permission revision,
   corpus generation, context bindings, and a monotonic draft generation.
10. Commit is single-flight and navigation is idempotent.

Performance gates cover 5k, 20k, and 60k-card corpora. Opening, candidate
search, keyboard focus, and clause acceptance must remain responsive even when
counts, relationships, similarity, or remote dependencies are unavailable.

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

If the active collection, identity, permissions, or navigation context changes
outside the composer, the draft does not silently commit against a new
baseline. It freezes with **The page changed while you were composing** and
offers **Rebase draft**, **Keep draft**, or **Cancel** where semantically safe.

### Navigation to selected card

If the current URL includes a selected card and a draft transformation removes
that card from the result, the preview says where navigation will move and
committing navigates to the default item in the new collection. If the card
remains, preserve it by default. This behavior is deterministic across mouse,
keyboard, recent-history, and saved-collection navigation.

### Activation failure

Draft source and AST remain in session storage until the destination activates
successfully. Worker crashes, remote timeouts, permission changes, offline
state, or an execution failure must leave the old active collection intact and
offer **Retry**, **Open partial results** when honest and safe, **Edit draft**,
or **Copy source**. Every wait has a timeout and abort path; Recent is recorded
only after successful activation.

### Presentation fallback

Semantic matches and presentation fallback cards are distinct. Composer counts
and membership explanations never imply that fallback cards matched the
expression. Prefer disabling fallback substitution for ad-hoc composed
collections; otherwise say, for example, **0 match; 3 fallback cards will be
shown**.

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
2. Harvest representative production URLs, including legacy, malformed,
   context-dependent, selected-card, full-URL, query, fragment, encoded-value,
   and unsupported-filter cases.
3. Introduce a total lossless parser with AST, raw segments, diagnostics, and
   explicit valid/unsupported/incomplete/invalid states.
4. Add round-trip fixtures covering all normal and configurable filters.
5. Audit `exclude`, `combine`, `expand`, union, key-card, and nested-filter
   semantics.
6. Define the structured draft representation, context-dependency model,
   completeness model, and activation transaction.
7. Extend filter metadata with readable titles, categories, keywords, argument
   definitions, describers, cost, authorization, context, and completeness.
8. Add semantic differential and property-based harnesses comparing old and new
   parsing/execution over production fixtures and generated corpora.
9. Run the parser in shadow mode before it becomes authoritative; version the
   adapter and keep existing execution as the initial lowering target.
10. Inventory the existing dialog, drawer, chip, card-picker, button, typography,
    color, icon, and responsive primitives to establish which are reused and
    which require a general Card Web evolution.
11. Evolve the shared dialog/button foundations to meet the specified dialog,
    combobox, focus, keyboard, touch-target, and visible-focus requirements.
12. Resolve Ctrl/Cmd-K precedence with card-editor linking and define pending
    edit navigation behavior.

**Exit criterion:** parsing never throws or drops input; every legal fixture can
parse into a draft and serialize without semantic loss; old and new execution
are semantically equivalent for the supported grammar; contextual and partial
meaning are represented honestly; the shared interaction foundation passes its
accessibility checks.

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

1. Add the persistent collection sentence by evolving the existing title/count
   area, including Refine and Copy Link affordances.
2. Open from the active collection through Ctrl-K and the visible affordance.
3. Render the current expression as a familiar continuous sentence.
4. Implement the normative Open/Add/Remove/Replace/Edit action grammar.
5. Add recent collections and deterministic Continue/Focus/Pivot/Return/Resume
   suggestions with stable IDs and golden examples.
6. Search filter definitions, tags, sections, people, and card values.
7. Implement explicit but progressive interpretation suggestions.
8. Implement Tab-to-add, Backspace-to-remove, and Enter-to-open with persistent
   key hints and accessible focus behavior.
9. Add scoped completeness-aware count deltas and representative-card deltas
   for the small signature suggestion set.
10. Add the post-navigation semantic receipt and Undo.

**Exit criterion:** the complete signature loop feels like a familiar Card Web
search/filter interaction; common collections can be created without the
builder or URL syntax; opening without typing routinely offers a useful,
inspectable next destination.

### Phase 3: contextual transformations

1. Expand deterministic narrow, broaden, pivot, and active-card suggestions.
2. Add **Why in this collection?** and **Compose from this card**.
3. Add selection-based relationship and similarity suggestions after their
   contextual portability and completeness behavior is defined.
4. Add inspectable compound destinations compiled from ordinary clauses.
5. Diversify and rank ambiguous interpretations without moving focused rows.
6. Expand cost, provenance, permission, and partial-corpus messaging.

**Exit criterion:** users can move from card → collection → explanation →
refinement without leaving the familiar interaction family or encountering
hidden semantics.

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
8. Property test: parse → draft → serialize → parse preserves AST semantics.
9. Parser fuzzing: malformed and hostile URLs never throw or lose raw input.
10. Differential execution: old and new representations produce identical
    ordered card IDs, labels, partial matches, fallback status, and preview
    status where semantics are intended to match.
11. Context classification, materialization, and share/save policies.
12. Preview scope and completeness propagation through mixed expressions.
13. Suggestion stable identity, deterministic tie-breaking, and frozen
    acceptance payload.

### Component tests

1. Opening inherits the active collection.
2. Keyboard navigation follows the specified contract.
3. Tab adds without navigating; Enter commits once.
4. Escape cancels without changing URL or browser history.
5. Ambiguous input shows multiple labeled interpretations.
6. Expensive filters do not run before explicit acceptance.
7. Unknown/manual clauses survive builder edits.
8. Screen-reader labels include expression semantics.
9. Async counts do not reorder the focused suggestion list.
10. Ctrl/Cmd-K retains editor linking while invoking the composer elsewhere.
11. Pending card edits cannot cause silent navigation failure.
12. The persistent collection sentence exposes Refine, full expression, and
    Copy Link at keyboard, pointer, touch, and screen-reader entry points.

### Integration tests

1. Composer navigation creates one history entry and updates the active
   collection.
2. Back/forward restores prior collection descriptions.
3. Ctrl-Shift-L source edits navigate without a full-page load.
4. Counts do not attach to the wrong generation after rapid edits.
5. Partial corpus and permission states do not leak unavailable data.
6. Mobile layout supports composing, editing, and opening without horizontal
   overflow.
7. Fake-scheduler races cover rapid typing, late counts, double Enter, corpus
   changes, permission changes, identity changes, and Back/forward while open.
8. Draft recovery survives worker failure, remote timeout, offline activation,
   and reload until successful navigation.
9. Permission noninterference covers identity × permission × partial-corpus
   combinations.
10. 5k/20k/60k performance gates verify typing and keyboard interaction remain
    responsive during expensive or unavailable previews.

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
9. On “Inductively knowable,” open the composer and continue to related working
   notes while inspecting the exact clause diff and representative entrants.
10. Add Has TODO, inspect survivors, add Updated this month, and open the
    durable canonical destination.
11. Use **Why in this collection?** on an unexpected card, edit the responsible
    clause, and return to the revised collection.
12. Resume cards updated since the last visit and inspect the materialized
    timestamp before copying the link.
13. Paste a complex source expression, resolve it into readable clauses, add a
    contextual transformation, and verify the canonical source addition.

## Acceptance criteria for the first product release

1. The existing collection title/count area visibly and accessibly exposes a
   familiar readable collection sentence, Refine, and Copy Link.
2. Ctrl-K opens within 100 ms on a warm application outside editing contexts
   and starts from the active collection; editor linking retains its established
   shortcut behavior.
3. The active collection is rendered as a readable continuous expression.
4. Users can discover and add common card-type, section, tag, TODO, date,
   author, text-query, and relationship filters.
5. Ambiguous text presents a familiar text-search fallback and progressively
   disclosed structural interpretations without silent commitment.
6. Every row visibly performs Open, Add, Remove, Replace, or Edit.
7. Tab adds a clause while the combobox is active; Enter opens the visible
   preview; Escape cancels; the current key contract is always visible.
8. A compact deterministic set of useful Continue and Refine destinations
   appears without requiring typed input.
9. Highlighting a signature suggestion reveals its exact clause diff, honest
   scoped count delta, and representative changed cards when safe and cheap.
10. Draft editing does not modify the URL or browser history before commit.
11. Committing produces one canonical, shareable collection URL and one history
    entry only after successful activation.
12. Ctrl-Shift-L opens an autocomplete-enabled source editor with inline
    validation.
13. Source, quick composer, and the supported builder subset round-trip without
    semantic loss.
14. Unsupported, incomplete, invalid, and legacy clauses are distinguished and
    exact source text is never silently dropped.
15. Preview work never blocks typing, stale work is canceled/discarded, and
    focused suggestions do not move asynchronously.
16. The experience is available to non-admin users for every filter their data
    and permissions support.
17. Every contextual suggestion can reveal the exact collection transformation
    it proposes and then descend into builder and source representations.
18. For any displayed card, **Why in this collection?** reports base-set and
    clause pass/fail/unknown state, OR/NOT behavior, completeness limits, and
    sort position where useful.
19. Context-bound and partial-corpus collections state their portability,
    scope, completeness, and provenance honestly.
20. Activation failure preserves both the old active view and recoverable
    draft; no operation waits indefinitely.
21. The composer uses Card Web's existing typography, colors, iconography,
    shadows, chips, buttons, and mobile dialog conventions and is visually
    coherent beside the current card stage and drawer.
22. In first-use testing, users recognize the surface as familiar
    search/filter navigation; delight is attributable to relevance, preview,
    continuity, and recovery rather than unfamiliar controls or decoration.

## Decisions made by this specification

1. **Ctrl-K starts from the current collection**, not an empty query.
2. **The URL remains canonical.** Saved collections are aliases/bookmarks, not
   replacements.
3. **Bare text is not silently interpreted.** The user selects among structural
   and text-query meanings.
4. **Tab composes; Enter opens the visible preview.** Tab is captured only while
   the suggestion combobox is active; otherwise it retains normal focus
   traversal.
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
12. **Familiarity is the interaction baseline.** Delight comes from relevance,
    preview, continuity, explainability, and reversibility—not novelty for its
    own sake.
13. **The action grammar is explicit.** Every result Opens, Adds, Removes,
    Replaces, or Edits.
14. **The persistent collection sentence is the novice entrance.** Ctrl-K is an
    accelerator, not the only way to discover composition.
15. **A deterministic magical layer ships with the foundation.** A small,
    excellent set of contextual destinations is part of the first useful
    release rather than deferred polish.
16. **Phase 0 is a semantic safety project.** A total parser, dependency model,
    completeness model, differential tests, accessibility foundation, and
    shortcut resolution precede composer UI authority.
17. **The active card is preserved when it remains in the destination.** When
    it does not, the preview discloses the move before commit.

## Open questions for product refinement

1. Should Ctrl-K use Ctrl on every platform, the platform primary modifier, or
   support both? This needs conflict testing with browser, OS, and editor
   shortcuts.
2. How strongly should exact card destinations rank in Ctrl-K relative to text
   filters and collection destinations? They must remain explicitly labeled as
   **Open card**, **Show collection**, or **Filter text**.
3. Should the first release allow editing a clause in place inside the quick
   composer, or always open a specialized popover?
4. What compact form of the collection sentence remains useful at narrow drawer
   widths without turning into an unfamiliar omnibox?
5. How many recent collections should be retained, and should history sync
   across devices?
6. Which deterministic Continue/Focus/Pivot/Return/Resume examples are useful
   often enough to earn a place in the first 6–8 rows?
7. Should relative date syntax such as `7d` be part of the first compact typed
   grammar or remain suggestion-driven initially?
8. How should `combine` and nested `expand` expressions appear when the visual
   builder cannot flatten them into the common AND/OR model?
9. For which first-release suggestions are scoped count and representative-card
   deltas cheap and trustworthy enough to compute on highlight?
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
- produce destinations that are linkable and state their contextual portability
  honestly when exact meaning cannot travel;
- make every layer understandable in isolation and connected to adjacent
  layers;
- make surprising membership traceable to explicit clauses;
- feel visually native to Card Web while raising the quality and coherence of
  its shared interaction primitives;
- feel familiar immediately and reveal its sophistication progressively;
- reward increasing fluency, from clicking suggestions to composing source from
  memory.

The desired feeling is that a user can click the collection sentence or press
Ctrl-K, use controls that already make sense, describe a subset of their card
web, and arrive there—with the collection's precise definition visible whenever
they want it. The interaction is delightful because Card Web understood the
next useful move and made its consequence obvious, not because the interface
behaved unlike anything the user had seen before.

# Proposal C — Grow It Native

*One of four independent redesign proposals produced 2026-08-28 (see 00-context-and-owner-feedback.md). Stance assigned: rebuild the composer from the app's own existing vocabulary, as if the original author had grown it organically. **This proposal was selected as the spine of the implemented meta-proposal** (see 05-meta-proposal-native-sentence.md).*

**Stance:** the composer should look like the app's original author grew it out of the app's own vocabulary. Card Web already has a chip language (tag-chip), a type-and-pick dialog (find-dialog), a sentence-plus-count header (card-drawer/card-view), one button system, one dialog base, and a receipt/undo idiom. The current composer at 4,123 lines invented a parallel vocabulary on top of these — verb chips, catalog walls, anchored editor panels, boxed clause-cells, a four-select setup strip. The owner's eleven complaints are almost all symptoms of that parallel vocabulary. The fix is not to polish it; it is to delete it and let the existing idioms do the work. Familiarity IS discoverability; reuse IS elegance.

One honest disclosure up front: the spec itself warns against "turning every word into a colorful pill," and this design leans into pills anyway — deliberately, because the owner's own words ("hard edges… unlike anything else in the app") name the pill-less-ness as the defect. Where the vocabulary genuinely runs out (negation rendering, OR-groups), it is extended minimally and flagged.

---

## 1. Concept model

Five concepts:

| # | Concept | What the user holds | Power payoff |
|---|---|---|---|
| 1 | **The sentence** | A collection is a sentence of pills: *Everything · ⟨pill⟩ · ⟨pill⟩ · sorted by updated*. The same sentence appears in the drawer header, the palette, every recent row, and (spelled in slashes) the URL. | Reading = understanding, everywhere. One rendering function (`collectionExpressionParts`) means the surfaces can never disagree. |
| 2 | **Type to grow it** | Type a word at the sentence's end; the list offers interpretations with counts; Tab adds a pill, Enter opens. | 90% of composition is typing words the user already knows. The loved core, fed better (synonyms + descriptions). |
| 3 | **A pill is editable where it stands** | Click (or arrow to) a pill: one quiet row of controls appears under the sentence — change its value, flip it, add an "or", remove it. | Everything visible is changeable at the place you see it. No second representation of the clause. |
| 4 | **Pills compose like pills** | "Or" fuses two pills into one grouped pill; "flip" turns a pill into its opposite. A grouped pill is just a pill. | The entire boolean algebra — AND, OR, NOT, and the `exclude`/`combine` nesting — is **one** recursive concept. No user ever meets the words exclude or combine. |
| 5 | **The count answers before you commit** | One number is always about the sentence as it stands; every row and pill-edit shows what it would become. | Count-delta teaching now covers OR, NOT, and removal. |

Set, sort, and view are not additional concepts: they are the first and last words of the sentence, edited the same way a pill is.

---

## 2. The surfaces

### 2a. The drawer sentence (kept, sharpened)

The card-view collection summary is already right. Two additions from existing idioms: clause spans become real **tag-chips** (subtle mode) so drawer and palette share pixels — a tag clause is the tag's own chip in its own color (hover previews a card via tag-chip's existing machinery); on hover, chips show tag-chip's existing **X**: removing a clause from the drawer navigates immediately with the existing receipt + Undo. Cheap refinement without opening anything.

### 2b. The palette (Ctrl-K / click the sentence)

One `DialogElement` subclass. Not a 90%-height, 64em workspace — a light palette (~44em, content-height with a max), because it contains three things instead of seven:

```
┌────────────────────────────────────────────────────────────────┐
│  Collection                                                ✕   │
│                                                                │
│  Everything  (systems) (working-notes) (unpublished)           │
│  ______________________________________________  ⓘ            │
│   type another condition…                                      │
│   · sorted by recently updated                                 │
│                                                                │
│  Recent                                                        │
│    Everything · systems · has TODO                    43       │
│    Working notes · updated this week                  12       │
│    Reading list                                       17       │
│  Refine                                                        │
│    updated in the last 7 days                  1,842 → 184     │
│    has TODO                                    1,842 → 96      │
│                                                                │
│  Tab adds · Enter opens · Esc cancels        1,842 cards  (⦿)  │
└────────────────────────────────────────────────────────────────┘
```

Element-by-element reuse: dialog shell = DialogElement unchanged; clause pills = tag-chip (real tag/section/person colors for value pills; **neutral gray fill** for property pills — two fills, one shape; color appears only where it already means something); input = find-dialog's #query treatment; list rows = flat find-dialog/card-drawer treatment — label, quiet gray count, thin separators, translucent primary wash on keyboard highlight, **no verb chips** (the section heading carries the grammar; a navigating row under a typing list gets the small OPEN_IN_BROWSER_ICON); recents rows = the sentence idiom itself, miniature; counts = drawer's formatters and grays; open = button.round.primary; keyboard = existing contract; receipt = existing snackbar + Undo.

**Empty state**: sentence + input; Recent (if any) then a *short* deterministic Refine. Zero-card draft: the existing "No cards currently match" note + recovery rows from the existing broaden machinery.

**Typing state**: the list becomes Interpretations — current ambiguity handling survives verbatim. Matching extended: candidates already carry aliases and searchValues; extend scoring to match filterDescriptions prose and tagInfos[].description. Typing "old" finds "Not updated in 90 days". A ranking-input change in collection-composer-suggestions.ts, not a new system.

**Argument editing — the pill row** (replaces the anchored editor): selecting a configurable pill opens ONE row directly under the sentence:

```
Everything (systems) (updated after Jan 1)✎ …
├─ updated after [2026-01-01] [–– no end ––]      · draft now matches 184
│  [or…]  [flip]  [remove]        without this pill: 1,842
```

Date/number inputs inline in plain form-control treatment (existing argument controls reparented); card values open **find-dialog in picker mode** (exists); tag/section/person values use **tag-list's own "Add Tag…" select**. `without this pill: N` replaces the "Remove X" suggestion rows entirely. Edits apply live with the existing draft receipt + Undo. A one-row editor can't squash.

**Counts**: one primary count (footer, beside Open). Rows show `current → would-be`. Pill row shows `without: N`. That's the whole story.

**Commit**: unchanged from what works.

**Mobile**: DialogElement full-screen mode; pills wrap naturally; 44px everywhere; existing round "Compose collection" toolbar button stays.

**"Browse all filters"**: one quiet text link that seeds the *same list* with every family under the same h3 headings, one line each: name + gray description. No examples-per-row, no Not toggles, no verb chips, no setup strip.

**Sort / set / view**: quiet words in the sentence; clicking either fills the list with alternatives; also typable. The four-select strip is deleted.

**Source mode**: kept, one link, largely as-is.

---

## 3. The recursive boolean story

**Vocabulary**: never *exclude*, *combine*, *not*, or *invert* as UI nouns. The two verbs are **or…** and **flip**.

**Flip** uses the app's own inverse names first: `INVERSE_FILTER_NAMES` pairs mean flipping *published* yields a pill that simply reads **unpublished** — plain language, no operator. Only a filter with no named inverse gets the fallback: a quiet "not " prefix and the pill renders **outlined** (white fill, its color as border+text — fill inversion mirrors meaning inversion). *(Flagged extension #1: one CSS state on tag-chip.)*

**Or** fuses pills: `(tagged systems  or  tagged AI)` — a single tag-chip-shaped container whose segments keep their own colors, joined by the quiet lowercase operator. *(Flagged extension #2: a pill-group container = tag-list's inline rendering in one rounded border.)*

**Authoring `a AND (b OR c) AND NOT d` — keyboard:** type `a` Tab; `b` Tab; type `c` → because *c* is a sibling value of pill *(b)*'s family, the list includes **"…or tagged c — widens ⟨b⟩ · 43 → 61"** — Tab fuses. Or explicitly: ← to select pill (b), press **+** (footer says `+ adds an or`), type c, Tab. `+` is literally the URL's own OR spelling, so the shortcut teaches the source grammar. Type `-d` → "not d" leads → Tab. Or: select pill (d), press **-** (footer: `- flips`). Enter opens.

**Mouse:** pill → pill row → [or…] / [flip] / [remove]. On a group: clicking a segment scopes to it; clicking the group's edge scopes to the whole. The row's first line names the scope.

**Reading:** AND is whitespace/interpunct; OR is inside a pill; NOT is inside a pill's name. Structure is containment.

**Engine mapping:** AND = segments; plain OR-group = `b+c`; flipped simple pill = inverse name or `exclude/d`; flipped group / OR over configurables = `exclude/…` / `combine/…` (chained pairwise for n-ary). Requires the spec's draft-layer `FilterExpression` model (filter | or | not | manual) with round-trip tests — the one real piece of new engineering, spec-mandated. Deeper source-authored shapes round-trip as a **manual pill**: gray, its source as label, offering only Edit-in-source / Remove.

**Explaining back**: see flow 5.

---

## 4. Discoverability — the ladder

1. The drawer sentence is the doorknob — always on screen, already says *Refine · ⌘K*, pills are tag chips the user has clicked a hundred times.
2. The palette opens showing what you already have: your collection as the same pills, recents underneath.
3. Typing teaches filtering: interpretations with count deltas.
4. Pills teach editing: the pill row appears with three labeled verbs; `without this pill: N` teaches what each clause does.
5. or…/flip teach boolean structure; the sibling-value "…or" interpretation offers OR before you knew to ask.
6. `+`/`-` and Edit source teach the URL: the footer's `+` hint is the grammar leaking upward on purpose.

---

## 5. Deleted vs. survives

**Deleted:** catalog mode as a surface (setup strip, category walls with per-row examples, Not toggles, "Already in this collection" rows, accordions); verb chips + the rowConsequence chip system; "Remove X" rows; anchored editor panels hosting the full family editor; "only for you" badges (honesty → copy-link confirmation + source status, both existing); Edit verbs on non-editables; receipt strips duplicating the sentence; the legacy builder render; the three-mode architecture (compose/catalog collapse; source stays).

**Survives:** engine, URL canonicality, count/preview machinery, worker bridge; suggestions module nearly whole (candidates, aliases, display names, ranking, dedupe, expression parts); history store whole; source parser/diagnostics/completions + source UI; receipt/undo; keyboard registry; drawer sentence + empty state; find-dialog picker; help(); D1's collection-definition sentence.

---

## 6. The five flows

**① Novice on a shared link**: drawer header = count over pills (the systems pill IS the tag chip they know; hover previews a card); struck-through clause + notice for not-understood parts (exists); *Refine · ⌘K* names act and shortcut. **② Daily bounce**: ⌘K → Recent is the first section as mini-sentences with counts → ⌘K ↓ Enter. **③ tag-3 OR tag-7 published by updated**: sibling-value "…or" row ranked first when a same-family pill exists; aliases catch "pub"; sorts are interpretations; receipt + copy-link from the drawer. **④ Date window twice**: click the pill → pill row right under the sentence, live count → identical the second time, zero navigation. **⑤ Why is this card here**: the card-info panel gains **In this collection** — the sentence's pills vertically, passing pills lit, failing subtle (tag-chip's existing grayscale-subtle state), the passing OR-segment lit; tapping a pill opens the palette with it selected. Membership = "every pill lit."

---

## 7. Visual language — offender by offender

| Offender | Replacement |
|---|---|
| Mixed type voices | Raleway once (h2); everything else default family at the app's subordinate sizes; HS §2.1 casing |
| Square clause boxes with internal divider | tag-chip: 0.3em radius, colored fill, bold small text, X-on-hover |
| Verb chips + consequence system | Deleted; panel-h3 section headings + one navigate glyph |
| Four-select setup strip | Quiet sentence words; alternatives in the shared list |
| Anchored editor panels | One pill row: label + button.small + plain inputs |
| "Not" toggles | flip → named inverse filters (*unpublished*) or outlined not-pills |
| Alien buttons | ButtonSharedStyles only; zero local button CSS |
| Loud purple set-name | Drawer-summary hierarchy: names at body weight, operators subordinate, counts quiet gray |
| Hard-edged workspace | DialogElement's own surface; pills are round because pills are the app's one sanctioned rounding |
| "Only for you" badges | Copy link + Source status only |

---

## 8. Feasibility

Reused as-is ≈80% of the branch's machinery. Net-new: (1) boolean draft layer — FilterExpression with lossless `+`/`exclude`/`combine` mapping + round-trip tests, ~500–700 lines, spec-mandated regardless; (2) pill components — outlined-not state, pill-group container (~150), pill row (~250, mostly reparenting); (3) palette rebuild — a much smaller innerRender over surviving state machinery, replacing ~2,000+ lines with ~600–800 (**net LOC plausibly negative**); (4) ranking inputs + sibling-value "…or" rows (~100–200); (5) In-this-collection panel section (~200 + selector). Source mode and the drawer sentence ship day one unchanged.

---

## 9. Self-critique

1. **The spec explicitly warns against this** ("without turning every word into a colorful pill"). Two-fill discipline is itself a rule to absorb; if gray pills read as disabled, one confusion traded for another. Text-first with chips only for concrete values is the defensible retreat.
2. **"No new concepts" is partly spin**: tag-chip has no selection state, menu row, grouping, or outlined variant today. The fused or-pill and flip are new interactions wearing old clothes; segment-vs-group tap scoping is exactly the kind of invisible spatial rule the spec forbids.
3. **Killing the catalog bets everything on search.** The wall guaranteed the long tail was findable. "Browse all" as a seeded list is the same wall with less signage unless the one-line descriptions are excellent — and synonym metadata is only as good as its curation.

## Fidelity map (owner's 11 points)

1 → drawer sentence door + palette opens on your collection + recents. 2 → §7 table. 3 → a clause lives in one form (the pill) in two places (same component). 4 → one-line pill row; find-dialog; tag-list select. 5 → short deterministic Refine; typed interpretations; sibling-or rows visibly caused by your pills. 6 → Recent first, always, as mini-sentences. 7 → flip → named inverses or outlined not-pills; `-` while typing. 8 → no per-row verbs; manual pill says what it offers. 9 → removed; copy-link + source only. 10 → sentence + input + one list + one button; five concepts. 11 → typing is the spine with synonym/description matching; OR/NOT are pill operations with `+`/`-`; no exclude/combine words anywhere.

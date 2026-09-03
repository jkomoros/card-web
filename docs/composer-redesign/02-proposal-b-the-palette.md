# Proposal B — The Palette

*One of four independent redesign proposals produced 2026-08-28 (see 00-context-and-owner-feedback.md). Stance assigned: command-palette purism — one input, one list, nothing else at rest.*

**Stance:** the composer is a launcher in the Spotlight/Raycast/Linear lineage. ONE input, ONE list, nothing else at rest. Everything else the current dialog renders is either folded into that list, made a drill-in, or deleted.

Engine grounding (verified): segments AND together, `a+b` unions plain filters inside one segment, `combine/` exists only to union configurable filters, and `exclude/` wraps any sub-filter — so the engine's native shape is exactly "AND of conditions, where a condition may be an OR-group and may be negated." That is the shape this palette authors.

---

## 1. Concept model

Five concepts.

| # | Concept | What the user must hold | Power payoff |
|---|---|---|---|
| 1 | **The sentence** | "That one line is my collection, and the number is how big it is." | Reads the entire draft at all times, on every screen of the palette. It is the app's persistent drawer sentence, continued. |
| 2 | **The list** | "There is one list. It shows me what I can do right now." | At rest: destinations. Typing: interpretations. Editing: my own conditions. Configuring: the choices for one argument. Four states, zero new surfaces. |
| 3 | **Tab adds, Enter opens** | Two keys. | The loved type-to-filter core, unchanged. Counts on every row teach what each key will do before it's pressed. |
| 4 | **Drill in / Esc backs out** | "A row that needs more becomes the whole palette for a moment." | Kills the squashed anchored editor. A date window, an OR group, the full catalog, the source editor — each a focused screen with one job, one Esc from home. |
| 5 | **A condition** | "Each part of the sentence is a condition. A condition can also-match alternatives, and can be flipped to *not*." | The entire boolean algebra the engine supports, learned as two verbs on one noun — never as `exclude`, `combine`, or `+`. |

---

## 2. The surfaces

One `DialogElement` subclass rendering one column: **sentence → input → list → footer**. The list's content is a small stack (`root` → `conditions` → `condition` → `argument`, plus `catalog` and `source` as drill-ins). Esc pops the stack; Esc at root closes.

### 2.1 At rest

```
┌────────────────────────────────────────────────────────────┐
│ Go to Collection                                       ✕   │
│                                                            │
│  Working notes · has TODO · newest first          43 cards │  ← THE SENTENCE. Read-only text.
│  ┌──────────────────────────────────────────────────────┐  │
│  │ Type to filter, or pick a destination…               │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                            │
│  RECENT                                                    │  ← unmissable: first pixels below input
│  ▸ Working notes to connect                          184   │
│  ▸ Everything tagged systems                          86   │
│  ▸ Reading list                                       12   │
│                                                            │
│  REFINE                                                    │  ← at most 3, deterministic
│  + Updated since you were last here                    7   │
│  + Keep only cards tagged systems                     18   │
│  ⌫ Drop "has TODO"                                 1,842   │
│                                                            │
│  ⚙ Edit this collection's conditions…                      │
│  ⌸ All filters…                                            │
│                                                            │
│  Tab add · Enter open · Esc close              (Open  ➔)   │
└────────────────────────────────────────────────────────────┘
```

- **The sentence is not interactive.** Clicking anywhere on it opens the conditions list (§2.4). That single gesture replaces every chip affordance.
- **The count lives at the sentence's right edge, always**, on every screen of the palette.
- **Recents are rows 1–3**, ranked by the existing recency+frequency store. Detail line appears **only on the highlighted row**.
- **Refine capped at 3** deterministic rows.
- **Row anatomy everywhere:** leading glyph (`▸` open, `+` add, `⌫` remove), one label, right-aligned quiet count, detail on highlight only. Kills the triple verb redundancy.

### 2.2 Typing — interpretations REPLACE the list

```
│  + tagged systems                              43 → 9      │  ← AND: narrows
│  + in section Systems                          43 → 4      │
│  + text contains "sys"                         43 → 17     │
│  ~ has TODO, or tagged systems                 43 → 118    │  ← OR: widens an existing condition
│  – not tagged systems                          43 → 34     │  ← NOT
│  ▸ Everything tagged systems                        86     │  ← destination (recent match)
```

**This list is where booleans are born.** The `+ / ~ / –` rows are the AND/OR/NOT interpretations of one typed token, each with a before→after count. Synonym/description/fuzzy matching over the catalog's keywords + descriptions.

### 2.3 Drill-in: arguments get the whole body

Highlight `+ updated…`, Tab → the list becomes the argument screen: radio rows of common windows each with counts, `after a date…` / `between two dates…` descending one level to full-width fields with a live "would match N". The anti-"squashed": one thing at a time, generous space. Existing guided controls reused as the bodies.

### 2.4 The conditions list (draft editing)

Reached by clicking the sentence, Backspace on empty input, or the `⚙` row. FROM/KEEPING ONLY/SORTED BY sections with progressive counts ("remaining after the rows above"). Enter on a condition drills into the condition screen; Delete removes. Set/sort/view are rows here (the four-dropdown setup strip is deleted).

### 2.5 Counts and commit

Row counts are *predictions* (`43 → 9`); the sentence count is *the fact*. Two roles, two placements, no other copies. Enter commits (single-flight, receipt + Undo — all kept); one `button.round.primary` bottom-right.

### 2.6 The catalog as a list state

`⌸ All filters…` drills into the full catalog in the same list: category headings, rows = name + one-line description. No example sentences, no Not toggles, no verb chips.

### 2.7 Source mode

Kept nearly verbatim as one more drill-in. **Viewer-dependence speaks here and only here** — at the copy-link moment.

### 2.8 Mobile

Full-screen; drill-in is native to mobile. Tapping a transform row adds and stays open; tapping a destination opens. Condition rows get trailing ✕ at 44px. Sticky round primary.

---

## 3. The recursive boolean story

### 3.1 At insertion — the palette grammar

Every typed token generates up to three valences (`+` narrows / `~` widens an existing compatible condition / `–` excludes), each a plain sentence with a count delta. `a AND (b OR c) AND NOT d` = type a, Tab; type b, Tab; type c, pick the `~ tagged b, or c` row; type d (or `-d` / `not d` to lead with NOT), pick `– not tagged d`. The user authored the whole shape by choosing between English sentences with numbers on them.

Ranking: `+` leads; `~` appears only when a compatible condition exists, labeled with what it widens; `–` ranked below unless the token starts with not/-.

### 3.2 By repair — the condition screen

Enter on `tagged b or c` in the conditions list → one condition, its alternatives with counts and ✕s, and exactly two structural verbs: **Also match another…** (grows the OR) and **⇄ Flip: only cards that DON'T match this** (with its count consequence shown). Fully recursive over the model.

### 3.3 The honest concession

The palette authors exactly the spec's user-facing model (one AND list; OR inside a condition; NOT on a condition). `(a AND b) OR c` is not palette-authorable; a pasted description outside the model renders as a preserved `manual` condition with *Edit in source*. Principled: the common cases are all inside the model; source is one drill-in away and round-trips losslessly.

---

## 4. Discoverability

1. The drawer sentence + `Refine (⌘K)` + first-use invitation is the entrance.
2. The palette opens *already showing destinations with counts*; recents are literally the first rows. `help()` badge defines "collection".
3. Typing produces sentences with count deltas; the `~`/`–` rows teach OR and NOT exactly when the user's own draft makes them meaningful.
4. The conditions list is taught by three redundant routes (click the sentence, the visible ⚙ row, Backspace).
5. Condition screens teach OR-groups and NOT with before→after counts on the verbs themselves.
6. Every drill-in shows its condition's `code` spelling as quiet secondary detail; Edit source at the bottom of the conditions list; Ctrl-Shift-L for the committed.

---

## 5. Deleted vs. survives

**DELETED:** interactive chip row; "Remove X" suggestion rows; draft receipt strips (beyond one transient line); catalog "Already in this collection" rows and per-row example sentences; catalog as a separate mode with the setup strip; Not polarity toggles; Edit verb chips; "only for you" badges; the anchored editor panel; natural-language action-verb labels + verb chips + detail restatements; Refine sections beyond 3 rows.

**SURVIVES:** engine untouched; history store verbatim; suggestions module repointed (candidates, names, expression parts reused; row rendering replaced); catalog data as the index; source mode ~intact; preview-count plumbing verbatim; configurable argument controls rehoused; DialogElement/ButtonSharedStyles/help()/shortcuts; snackbar receipt + Undo; drawer sentence.

---

## 6. The five flows

(a) **Novice on a shared link**: sentence + count + Refine at top of drawer; palette opens with three counted Refine rows; worst case Esc, best case one click navigates their first composition. (b) **Daily bounce**: ⌘K → the three collections are rows 1–3 → ↓ Enter. (c) **tag-3 OR tag-7 published by updated**: the `~` row's widening count makes OR self-evident; ~30 keystrokes, no mode switch. (d) **Date window twice**: conditions list → Enter → a screen whose only job is two dates; second edit identical. (e) **Why is this card here**: "Why in this collection?" opens the conditions list annotated per-clause (✓/✗, which OR alternative matched); Enter on the responsible row is the reversible fix.

---

## 7. Visual language

Only DialogElement + ButtonSharedStyles + tokens; Source Sans body, Raleway h2 only; square corners (house law — what read alien was hard edges *plus* foreign buttons *plus* font drift); rows use the drawer's count vocabulary; keyboard selection is the translucent primary wash; tag values carry tag-chip color as a small swatch; icons never literal glyphs; `--app-divider-color` hairlines; `--transition-fade`; the single 900px mobile property.

---

## 8. Feasibility

~70% of the branch's non-UI work reused as-is. Net-new: screen stack (~250–400 lines, mostly *deleting* coordination code); condition model + compiler (~300 lines + round-trip tests — the only genuinely new semantics, spec-mandated anyway); valence interpretation generator (~150–250); conditions-list + condition-screen renders (~400–600). Deleted: plausibly 1,200–1,800 lines. **Net: the dialog shrinks.** 2–3 weeks.

---

## 9. Fidelity map (owner's 11 points)

1 Discoverable → drawer sentence entrance + pre-populated palette. 2 Alien styling → only existing primitives. 3 Duplication → one sentence (fact), one list (options). 4 No-texture NL actions → glyph + label + right-aligned count; prose on highlight only. 5 Squashed controls → whole-body drill-ins. 6 Random suggestions → capped at 3 deterministic. 7 Recents → rows 1–3 always. 8 Not toggle → counted `–` rows and the Flip verb. 9 Dead Edit buttons → only drillable rows drill. 10 Only-for-you → once, at copy-link. 11 Recursion → OR/NOT as valences at insertion + two verbs at repair, compiling to `+`/`combine`/`exclude` invisibly.

---

## 10. Self-critique

1. **Drill-in trades context for space.** While editing a date you cannot see your other conditions; tasks that compare across conditions cost navigation. Raycast can afford statelessness; a query builder arguably cannot.
2. **The read-only sentence sacrifices the chip-✕** — the most guessable removal gesture in software — for purity; the conditions list must be *taught*. The spec's principle 9 ("familiar shape") gives doctrinal grounds to object to the palette lineage itself.
3. **Boolean-at-insertion is order-sensitive and quietly deep.** The `~` row only appears if a compatible condition already exists; valence rows triple the interpretation list at exactly the moment of ambiguity; and the recursion concession means the advertised strength has a visible floor a power user will hit.

# Proposal D — The Sentence (wildcard): kill the dialog, compose in the page

*One of four independent redesign proposals produced 2026-08-28 (see 00-context-and-owner-feedback.md). Stance assigned: wildcard — first principles, free rein.*

**Thesis.** The spec says "composing a collection is navigation." The current build contradicts its own thesis: it navigates you *away* from the collection — into a modal with three modes — to compose the collection you were just looking at. The drawer already **is** a collection view. It already shows the count. Its cards already are the truest possible preview. The URL is already the bedrock. So the composer should not be a room you go to. It should be **one line of the page you are already on**: the collection sentence, always visible, always readable, and — when you click into it or press Ctrl-K — directly editable, with the live drawer beneath it as the preview. No modal, no modes, no catalog page, no suggestion feed. There is a sentence, and everything else is what happens when you put a caret in it.

This is the doctrine's ladder collapsed into a single physical place: the sentence *is* the quick composer, expands chip-by-chip into the visual builder, and re-spells itself as the URL on demand.

---

## 1. Concept model

Five concepts (the current build asks ~thirteen):

| # | Concept | What the user must understand | Power it pays for |
|---|---|---|---|
| 1 | **The sentence** | Every view of cards is described by one readable line above the cards; the line is the address — it and the URL are the same thing in two spellings. | Reading any collection ever; sharing; understanding the whole app as "a sentence and its cards." |
| 2 | **Type to add** | Put the caret in the sentence (click, or Ctrl-K) and type. Completions under the caret; Tab accepts; count and cards react. Matching includes synonyms and descriptions; empty input shows where you've been. | The entire vocabulary, values, recents, sorts, pasted URLs — one input. |
| 3 | **Chips open** | Every condition is a chip. Click it: it opens in place — change value, flip **is / is not**, add **"or …"** alternatives, or remove. | All editing, negation, and OR — zero vocabulary. |
| 4 | **A chip can hold a sentence** | An alternative inside a chip may itself be "cards matching: …" — a miniature sentence, edited exactly like the big one. | Unlimited recursion for zero new concepts. Depth 3 works like depth 1 because it *is* depth 1. |
| 5 | **Enter opens, Esc puts it back** | With the caret in the sentence you are previewing, not committed. | Fearless experimentation without a "draft" concept. |

The count is deliberately not a concept — it is the sentence's punctuation. The true protagonist is the cards: the full result list is the preview, because the composer never covers it with a scrim.

---

## 2. The surfaces

One surface, four states, plus one popover — all living in the card-drawer header block that already exists.

**Rest state**: sentence of chips + quiet operators + sort tail + copy-link `button.small`. After copy: `Link copied`; if viewer-dependent: `Link copied — it shows each person their own starred cards` (the entire surviving footprint of "only for you"). Hover: light primary wash + `Refine this collection (Ctrl-K)`. Truncation: `… +2 more`, expanding on focus/hover.

**Composing state** (click or Ctrl-K): the sentence grows a caret; nothing navigates; nothing is covered. Completion popover under the caret; the drawer previews the draft (phase-1 fallback below) with the existing loading-dim + count crossfade. Empty input: at most 6 rows — `Jump back` (recents as miniature chip-sentences with counts, recency+frequency) then 2–3 `For this collection` moves, then `Everything else…`. Typing filters to completions: one line each, name + async count, synonyms/descriptions via the catalog module's existing searchValues. `Everything else…` expands the same popover to the grouped full index — the catalog demoted from destination to scroll. Pasting a URL/path parses via the existing total parser into one adoptable row.

**Chip editor** (click a chip): a small anchored popover — `is ● / is not ○`, the argument controls (date fields, ply, find-dialog picker), `or also allow…`, Remove. `is/is not` replaces the Not toggle; compiles to inverse names or `exclude/`. Chips without arguments open an editor with just is/is-not, or-also, Remove — no dead Edit buttons because "edit" isn't a verb anymore; it's what clicking a chip does.

**Groups**: `(Tagged systems  or  tag-7)` one pill with quiet "or" inside; `not (…)` quiet prefix; an alternative may be `cards matching: Working notes and Has TODO ▸` — a nested sentence editing identically.

**The other spelling**: a quiet `</>` affordance (Ctrl-Shift-L) swaps the sentence line in place for the monospaced URL path with grammar completions, the readable sentence rendered just below — two spellings visibly the same thing, stacked. While composing in chips, the compiled path shows in one quiet line beneath the popover: the grammar is learnable by osmosis the whole time.

**Mobile**: tapping the compact sentence opens a full-screen sheet — the identical component vertically wrapped; chips full-width 44px rows; sticky `Open 43 cards`.

**Other states**: rest-truncated; rest-with-diagnostics (drawer's existing notice stays adjacent); zero-result draft (`No cards match — try removing (not Published)` with the guilty chip identified by count machinery); failed-computation (drawer's existing line outranks); why-here (flow 5).

---

## 3. The recursive boolean story

The grammar the user learns is English's: between chips everything is "and" (adjacency); inside a chip the only words are **or** and **not**.

Keyboard from `Everything`: `Ctrl-K` · `a ⇥` · `b ⇥` · `or c ⇥` ("or " as first word binds to the previous chip; the popover header says "or, in addition to b:") · `not d ⇥` ("not " prefixes negated readings; `-d` works — the search-engine idiom) · `⏎`. URL: `/c/everything/a/b+c/exclude/d/`.

Deep nesting `(a AND b) OR c`: in the or-chip's editor, `…several conditions together` embeds a miniature sentence as that alternative — same chips, same caret, one level down. Reading back: `(Published  or  cards matching: a and b)`.

Mouse: chip → is/is-not for negation; `or also allow…` for alternatives; removing the second-to-last alternative dissolves the group; negating a group is the group editor's own is/is-not.

Why recursion feels native: no advanced mode, no structural editor, no tree view — the mental move at every depth is the one learned in the first thirty seconds. Reading is free because the rendering is a nested sentence, which humans already parse.

Round-trip honesty: any legal URL the chip renderer can't pretty-print renders as a monospace chip `⟨exclude/…⟩` — click opens the text spelling scoped to it. Preserved verbatim.

---

## 4. Discoverability

Layer zero is unskippable — the sentence is on every screen describing the collection the user is already looking at. (1) Reading teaches the model. (2) Hover teaches entry. (3) Clicking teaches recents and moves. (4) Typing teaches the vocabulary with counts. (5) Accepting teaches structure — your words visibly become a chip. (6) Chips teach editing, or, and not — discovered the way tag chips taught deletion: by poking the pill. (7) The quiet path line teaches source by osmosis.

---

## 5. Deleted / survives

**Deleted:** the dialog as the composition surface (~2,900 UI lines; HOUSE-STYLE §3.2 already convicted it); the suggestion feed (recents survive as empty-input rows; top contextual candidates as `For this collection`; the rest of the ranking survives as completion ranking); the catalog as a browsable mode (data survives as the completion index); receipt strips (the committed chip flashes once); "only for you" badges; edit verb chips; source as a room; the footer key-hint bar.

**Survives:** engine untouched; `collection-source.ts` total parser (text spelling, paste, manual-chip escape hatch); history store untouched; suggestions module (candidates, names, expression parts, viewer-dependence detection retargeted at copy-link); catalog data as index + polarity pairs as the is/is-not compiler; count preview machinery; guided editors' internals; find-dialog picker; tag-chip/tag-list lineage; drawer's stale/dim/failure/diagnostic states.

---

## 6. The five flows

**① Novice on a shared link**: the page opens on the drawer; the top line tells her, in English, what she is looking at and how many — before touching anything. The URL she clicked and the sentence she reads are visibly the same statement. **② Daily bounce**: Ctrl-K → `Jump back` is the first content of the first gesture → ↓ ↓ Enter. **③ tag-3 OR tag-7, published, by updated**: `tag-3 ⇥ · or tag-7 ⇥ · pub ⇥ · updated…(sort row) ⇥ · ⏎` — five accepts, the drawer previewing throughout. **④ Date window twice**: the chip is in the sentence; click → popover with full-size fields, count reacting an inch above; tomorrow the same chip is in the same place — pure muscle memory. **⑤ Why here**: `Why is it here?` annotates each chip with a verdict mark; the explanation *is the sentence*, annotated; repair is the chips' own editors.

---

## 7. Visual language

This design adds almost no new surface to style — the sentence lives in the existing drawer header; the chips are the tag-chip pill family. Source Sans everywhere (no dialog title, because it is not a place); one monospace exception for the text spelling; pills keep tag colors, non-tag chips neutral (999px pills, the app's sanctioned rounding); popover white/square/`--card-shadow`/hairlines; `button.small` for ×/copy/`</>`; purple = commit + selection; amber never appears; `--transition-fade` with the accepted-completion settle. A screenshot is mostly the app itself.

---

## 8. Feasibility (honest)

Survives ≈0-cost: engine; parser; history; catalog data; suggestion machinery; guided editor internals; find-dialog; drawer state machinery. Net-new: `collection-sentence` (chips + caret + input + operators; ~2–3 weeks incl. a11y); completion popover (~1 week, re-skin); chip editor popovers (~1–1.5 weeks); or-group/nested-sentence + boolean draft model with round-trip matrix (~1.5–2 weeks — the real risk, owed under any design); mobile sheet (~1 week).

**The one expensive departure, named:** live draft preview in the drawer needs a draft-collection channel through the worker pipeline. **Phase 1 ships without it** (count crossfade + existing dim on committed cards); **Phase 2** routes the draft through the worker's stale/echo machinery (the latency-compensation seam is the precedent). Total: **roughly 6–8 weeks for phase 1**.

---

## 9. Fidelity map (owner's 11 points)

1 → layer zero is the always-visible sentence. 2 → no dialog to style; tag-chip pills, drawer header, existing tokens. 3 → one representation exists. 4 → one filter's editor at a time in a content-sized popover. 5 → the feed is gone; recents + 2–3 moves; everything else appears only when typed for. 6 → recents are the first content of the first gesture. 7 → "is / is not" inside the chip; typing `not`/`-`. 8 → the verb is gone; chips open; every chip has something real inside. 9 → one honest sentence at copy-link. 10 → rest state is one line; complexity appears where the caret is and vanishes with it. 11 → type-to-add is the only input, upgraded; or/not are English words; recursion is chips-in-chips, identical at every depth.

---

## 10. Self-critique

1. **It trades a familiar shape for a novel one, against the spec's own warning** (§9 "familiar shape"). The draft/committed boundary is subtler without a modal frame; some users will be surprised the first time Esc reverts. If they routinely fail to notice they haven't committed, the fix (a floating `Open 43 · Esc to put back` pill while dirty) is a patch on a real weakness.
2. **Demoting the catalog may hurt long-tail discovery.** `Everything else…` inside a popover is a weaker invitation than a browsable wall; the design bets everything on completion quality, and that bet must be paid in metadata curation.
3. **Horizontal sentences have a geometry ceiling, and recursion can hit it.** Wrapping chips-in-chips legibly is genuinely hard; desktop's rest state must truncate, re-hiding the structure the design exists to reveal. And phase 1's count-only preview means the marquee claim — "the drawer is the preview" — is an IOU at first ship.

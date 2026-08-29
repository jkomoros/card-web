# Proposal A — The Sentence Is the Only Surface

*One of four independent redesign proposals produced 2026-08-28 in response to the owner's acceptance-test feedback (see 00-context-and-owner-feedback.md). Stance assigned: the draft expression, rendered as directly-manipulable nested tokens, is the entire UI.*

**Stance:** The draft expression — rendered as a directly-manipulable sentence of nested tokens — is the entire UI. There is no suggestion list restating what tokens already say, no catalog screen, no builder mode. Typing continues the sentence. Every token is the single locus of its own actions. Boolean structure is recursive structure you touch. Everything else (recents, completions, editors, counts, source) appears *attached to the sentence*, only when the sentence needs it, and gets out of the way.

The owner's north star is power-per-concept. This design's bet: **one concept — the live token — applied recursively, is worth more than every panel the current dialog has.** The engine already thinks this way (`a+b`, `exclude/<sub>`, `combine/<a>/<b>` are a recursive grammar); the current UI flattens that recursion into four parallel flat surfaces and then duplicates them at each other. Stop flattening. Render the recursion.

---

## 1. Concept model

Six concepts. Each is listed with the power it buys — the owner's metric.

| # | Concept | What the user holds | Power payoff |
|---|---|---|---|
| 1 | **The sentence** | "What I'm looking at is a readable sentence; the URL is the same sentence spelled tersely." | Reading = understanding. Editing = navigating. Sharing = copying. One mental object covers the drawer header, the composer, the URL, and history. |
| 2 | **The token** | "Every meaningful word in the sentence is live. Touch it to act on it." | One gesture grammar covers all 40+ filters, tags, sections, people, dates, sort, set, and view. No token ever has an action it can't perform (kills dead Edit buttons by construction). |
| 3 | **Typing continues the sentence** | "Type anywhere; it matches names, synonyms, and descriptions; Tab makes it real." | The loved core, upgraded. All discovery routes through the one input. The catalog becomes an index feeding matches, not a screen. |
| 4 | **Groups** | "A token can hold tokens. `(b or c)` is one token. Groups nest." | Full boolean algebra — AND, OR, NOT, exclude, combine — with **zero additional concepts**, because a group obeys the exact same token grammar as a leaf. This is where power-per-concept goes vertical. |
| 5 | **The count** | "The number at the end is live; every candidate shows what it would do to it." | Consequence before commitment. Count deltas already taught a naive user intersection "without the word AND" — the same arithmetic teaches OR (count rises) and NOT (complement). |
| 6 | **Enter opens, Esc walks away** | "It's a draft until I say go." | Fearless play. All exploration is free. |

That is the complete vocabulary. Notably absent: "suggestion," "catalog," "builder," "mode," "polarity," "configure," "exclude," "combine," "union." Users never need those words; the words *not*, *any of*, *all of*, and parentheses carry all of it.

---

## 2. The surfaces

One dialog (still a `DialogElement`, light, top-third of screen like `find-dialog`), whose content is the sentence plus whatever the sentence currently needs. The persistent drawer-header sentence is the same renderer, asleep.

### 2a. Empty-of-intent state (just opened, nothing typed)

```
┌──────────────────────────────────────────────────────────────────────┐
│  Everything  and ‹working notes›  and ‹has todo›   caret▎    43 cards│
│  sorted by recently updated                                          │
│                                                                      │
│  Recent                                                              │
│   ‹main›                                            412 · this morning│
│   ‹everything› and ‹tag stewardship›                 61 · yesterday   │
│   ‹working notes› and ‹updated last 7 days›          29 · Tue         │
│                                                                      │
│  ↓ choose · ⏎ open · type to add a condition · esc cancel            │
│                                                    ( ⏎ Open  43 )    │
└──────────────────────────────────────────────────────────────────────┘
```

- `‹chips›` are tag-chip-vocabulary tokens (see §7); `and`/`sorted by` are quiet lowercase connective text in `--app-dark-text-color-light`. The set token (`Everything`) leads; the sort token trails on its own quiet line; a view token appears only when non-default.
- The input caret lives **inside the sentence**, after the last condition. There is no separate search box.
- **Recents are the only list shown when the sentence is empty of intent** — and they are the *first thing under the caret*, rendered as miniature sentences in the same token style, ranked by the existing frequency+recency store. Focusing one reveals its one-line diff ("removes has todo · adds tag stewardship") as a quiet second line; unfocused rows are just sentence + count + when. This is where the owner's missing recents become unmissable.
- The moment one character is typed, Recents yield to completions. The moment the input empties, they return. Recents never compete with intent.

### 2b. Typing state

```
│  Everything  and ‹working notes›  and  syst▎                 43 cards│
│                        ┌───────────────────────────────────────────┐ │
│                        │ ‹tag systems›                    43 → 12  │ │
│                        │ ‹section systems›                43 → 7   │ │
│                        │ ‹about concept systems›          43 → 19  │ │
│                        │ ‹text contains "syst"›           43 → 31  │ │
│                        │ ‹not tag systems›                43 → 31  │ │
│                        └───────────────────────────────────────────┘ │
│  ⇥ add and keep typing · ⏎ add and open · esc dismiss                │
```

- Completions render **as the token they would become** — the interpretation *is* the spelling (`tag systems` vs `section systems`). This kills verb chips, detail sentences, and "natural language actions" in one move: everything a completion does is *become part of the sentence*, so no verb is needed. Ambiguity is displayed, never resolved silently (spec principle 2 preserved).
- Matching runs over display names, **synonyms/keywords, and descriptions** from the filter metadata (the `keywords[]` and `description` fields the catalog module already carries). Typing `stale` matches "updated before…" via its description; the matched words render highlighted in the row's quiet second line only when the match wasn't on the name.
- Each row shows `current → resulting` count. The delta is the explanation.
- Typing `-` or `not ` prefixes the negated interpretation to the top. Typing `or ` when a token precedes the caret offers group-growing completions (§3).
- A trailing row, always last, quiet: `everything you can filter by…` — opens the full completion index *inside the same popover*, scrollable, grouped by the existing categories. This is the catalog demoted from a screen to a long completion list. Same rows, same behavior: choose one, it becomes a token.

### 2c. Token-focused state

Click a token, or press ← from the empty input (Backspace-selects-last survives unchanged):

```
│  Everything  and ‹working notes›  and ⟦‹updated after Jul 1›⟧  … 43  │
│              ┌────────────────────────────────────────────────────┐  │
│              │  after ▾   [Jul 1, 2026    ▾]                      │  │
│              │  keeps 43 of 118 in this collection                │  │
│              │  [not]  [+ or…]                          [remove]  │  │
│              └────────────────────────────────────────────────────┘  │
```

- The editor is **anchored to the token, full sentence width** — the existing anchored-editor pattern, kept, but given the whole row instead of `min(22em, 40vh)` of squashed selects. One editor open at a time; it *is* the progressive disclosure ("zoom into a token"), never a mode switch.
- Every token gets the same four affordances and no others: **edit-in-place** (the argument controls, only rendered when the filter *has* arguments — a token with nothing to edit simply has no editor region, killing dead Edit buttons structurally), **not**, **+ or…**, **remove**. Keyboard, shown right there: `⏎ edit · ! not · + or · ⌫ remove`.
- The `not` action puts the word **not** *inside* the token boundary: `‹not published›`. The word itself is clickable to remove. No toggle widget, no polarity dropdown — negation is a word in the sentence, exactly where you'd read it.
- "keeps 43 of 118" is the per-token teaching count (spec §"Teach through consequence"), computed lazily on focus only.

### 2d. Nested-group state

```
│  Everything  and ‹working notes›                                     │
│      and ( ‹tag ai›  or  ‹tag systems›  or  + )                      │
│      and ‹not ( ‹has todo› and ‹published› )›              …  17 cards│
```

- A group is a hairline-bordered container (`1px var(--app-divider-color)`, same 0.3em radius as tag-chips, no shadow) whose connective word (`or` / `and`) is itself a token — click it to flip any-of ↔ all-of. The trailing `+` inside an open group is the caret's landing spot for the next alternative.
- The group as a whole is focusable (click its border/padding; ↑ from a member): then the same four affordances apply *to the group* — not it, or-wrap it, remove it, or enter it (↓). **Recursion in the UI is literally the same component rendering itself.**
- Compilation: top-level `and` = path segments; `(a or b)` = `a+b` (or `combine`-spelled union when members are configurable); `not X` = `exclude/X`; `not (a and b)` = `exclude/combine/a/b`. The user authors arbitrary shapes; the compiler picks the legal URL spelling; a shape the grammar cannot spell is flagged **at the token, at authoring time** ("this grouping is deeper than a link can express"), never silently dropped — and unknown-but-parsed source renders as a verbatim gray manual token, preserved per spec.

### 2e. Count placement and commit

- The final count is the last word of the sentence, right-aligned, drawer-count gray. It crossfades on every draft change (`--transition-fade`).
- Commit: `⏎` anywhere with no completion highlighted; for pointer/touch, one `button.round.primary` bottom-right with `ARROW_FORWARD` icon, count adjacent — the standard dialog contract (HS §3.3), the *only* filled button on the surface.
- Next to the count, a quiet `button.small` **copy-link**. Viewer-dependent honesty lives *here and only here*: copying a draft containing `starred`/`unread`/`me` produces the snackbar "Link copied — starred shows each person their own starred cards." No badges in the sentence.

### 2f. Mobile

Full-screen dialog (existing mobile dialog convention). The sentence wraps into readable rows, one clause per line if needed; tokens get 44px targets (fixing the HS §4.2 debt as this ships). Tapping a token opens its editor as a full-width section directly beneath its row — same anchored pattern, no bottom-sheet novelty. Completions render as a full-width list under the input row. Recents identical. Sticky footer: `Open · 43` primary button. No hover-only affordance exists anywhere in this design (the token action row is revealed by *focus*, which tap provides), so mobile is the same design, wrapped.

---

## 3. The recursive boolean story

Target: `a AND (b OR c) AND NOT d` — by a user who has never seen the words exclude or combine.

**Keyboard (12–20 keystrokes of actual typing):**
1. `a` … completions appear … `⇥` — token `‹a›` materializes, caret stays hot. *(The loved core, untouched.)*
2. `b` `⇥` — `‹a› and ‹b›`.
3. `+` on the empty input — the just-made token `‹b›` grows into a group and the caret drops inside it: `and ( ‹b› or ▎)`. The footer said so before they pressed it: `+ or`. *(Deliberate rhyme: `+` is literally the URL's union spelling — the key they press today is the character they'll one day read in source mode. The ladder teaches downward.)*
4. `c` `⇥` — `( ‹b› or ‹c› )`. `→` steps out of the group.
5. `-d` — top completion is `‹not d›` (typing `not d` works identically; `-` is the power spelling, `not` the discoverable one). `⇥`.
6. Sentence reads: `Everything and ‹a› and ( ‹b› or ‹c› ) and ‹not d› — 43 cards`. `⏎` opens it.

Alternate negation path, no prefix knowledge needed: materialize `‹d›`, press `←` (token focused, its strip appears: `⏎ edit · ! not · + or · ⌫ remove`), press `!`.

**Mouse:** click after the sentence, click completion rows to add; on any focused token click **not** or **+ or…** in its strip; click a group's `or` word to flip it to `and`; click the group border to select the whole group, then **not** — producing `not ( … )`.

**The exclude/combine nesting** (`NOT (has-todo AND published)`, i.e. `exclude/combine/has-todo/published`): make `‹has todo›`, make `‹published›`; select `‹has todo›`, press `+` — group opens as *or*; click the `or` word → *and*; press `↑` to select the group; press `!`. Read back: `and not ( has todo and published )`. Four gestures, all previously learned, zero new vocabulary. The words exclude and combine appear exactly once in the product: in source mode, where the same structure is visible spelled as `exclude/combine/has-todo/published` — and because the user *built* the parenthesis, the spelling decodes itself.

**Navigation model, complete:** `←`/`→` traverse tokens at the current nesting level, `↓` enters a group, `↑` exits to its parent, `⌫` on empty input selects-then-removes. Four arrows are the entire recursive navigation. Reading order equals traversal order equals URL order.

---

## 4. Discoverability: how each layer teaches the next

The spec's ladder (contextual → quick → structure → source → engine) survives intact, but the rungs become *zoom levels of one sentence* instead of modes:

1. **Rung 0 — the sleeping sentence.** The drawer header renders the active collection with this same renderer: tokens, quiet connectives, count. It is visibly the *name of what you're looking at*, and it's a button (hover outline + "Refine (Ctrl-K)"). On the default collection it reads `Show cards matching…` — the spec's first-use invitation. Discoverability is solved by making the entry point *the thing users already stare at all day*, not a dialog behind an icon.
2. **Rung 1 — tokens are alive.** First click anywhere on the sentence opens the composer with that token focused and its strip showing. The user learns concept #2 by accident, safely (Esc costs nothing).
3. **Rung 2 — typing.** The caret sits in the sentence with `type another condition…` as its placeholder. Count deltas on completions teach AND arithmetically, as the persona testing already proved.
4. **Rung 3 — structure.** The `+ or` affordance is printed on every focused token's strip; `not` likewise. Groups teach nesting by being *visible parentheses* — users have known parentheses since arithmetic class. Recents render other people's/-days' sentences, seeding structural vocabulary passively.
5. **Rung 4 — source.** The copy-link button and the URL bar show the sentence spelled tersely; `Ctrl-Shift-L` (or the quiet `view as link…` affordance under the sentence) unfolds the source line *beneath the sentence* — not a mode, an annotation — with the existing parser, diagnostics, and completions. The `+` key already taught the first source glyph.

Every rung is reachable from the previous one by one gesture, and every rung up remains visible from below (the sentence stays on screen above the source line). That is inductive knowability rendered literally.

---

## 5. What gets DELETED, what survives

**Deleted from the UI (be ruthless):**

| Gone | Why |
|---|---|
| The entire suggestion list as a surface — Continue/Refine sections, verb chips (Open/Add/Remove/Replace/Configure/Edit), detail sentences, "Why this?" rows, receipt strips | Triple-redundant with the sentence; "Remove X" rows restate an X the chip already wears. Removal = the token's ×. Broadening = removing/editing tokens. |
| The catalog screen: category accordions, 40 rows × full example sentences, Add/Configure/Edit chips, Not polarity toggles | Becomes the completion index behind `everything you can filter by…`. The per-row example sentences (which restated the whole draft to differ by one word) die entirely — the *draft on screen* is the example. |
| The setup strip (Start From / Order By / Direction / Display As dropdowns) | Set, sort, and view are tokens in the sentence, edited like any other token. |
| Mode switching (quick / catalog / source as screens) | Source is an annotation under the sentence; there are no modes. |
| "Only for you" badges | Honesty relocates to the copy-link snackbar, the only moment it matters. |
| Not-toggles on catalog rows | Negation is the word *not* on the token. |
| Edit verbs on unconfigurable filters | Tokens without arguments simply have no editor; structurally impossible to regress. |
| The multi-line key-hints footer prose | One quiet contract line, context-sensitive, always true. |

**Survives (engine and machinery — untouched or repurposed):**

- `CollectionDescription`, serialization, the total source parser (`src/collection-source.ts`), diagnostics, completions — the source annotation uses all of it as-is.
- Count-preview machinery, preview IDs, generation keying — now feeding the sentence-final count, per-token "keeps N of M," and completion deltas.
- `src/collection-composer-history.ts` — unchanged; finally *rendered where the owner can see it*.
- `src/collection-composer-suggestions.ts` — candidate generation, display names, `collectionFilterExplanation`, `collectionExpressionParts`, ranking (`rankedComposerSuggestions`) — repurposed as the completion corpus and the sentence-renderer's label source. Its narrow/broaden candidate generators become *ranking hints* for completions (typing `up` surfaces "updated in last 7 days" high because it's a known-good narrowing), not rows of their own.
- `src/collection-filter-catalog.ts` — becomes the index behind the long completion list; categories become group headers inside it.
- The argument-editor components (`configure-collection-date`, key-card, multiple-cards, ply controls) — re-anchored under tokens at full width.
- `DialogElement`, `ButtonSharedStyles`, `tag-chip`/`tag-list` vocabulary, `shared/icons.ts`, `shortcuts.ts`, `help()` badges (the "a collection is a set of cards you can link to" definition rides on the sentence, per HS-1.3).

---

## 6. The five flows, walked

**① Novice arrives on a shared link.** The drawer header reads `Everything and ‹tag stewardship› and ‹updated last 30 days› — 61 cards`. That sentence *is* the explanation of what they were sent — no action needed. Curiosity clicks a token; the composer opens with it focused, showing "keeps 61 of 204" and the not/+or/remove strip. They press Esc; nothing changed. They have learned the whole concept model's first three entries in fifteen seconds, without a single mode, and the count told them why the collection contains what it contains.

**② Daily bounce between three collections.** `Ctrl-K`. Recents sit directly under the caret, frequency+recency ranked — the three bounce targets are rows 1–3 by construction (the existing store already promotes alternation). `↓ ⏎`. Two keys. Or type any distinctive word from a recent — typed text matches recents *first* (they render above filter completions while any recent matches) — `sys ⏎`. Muscle memory in a day.

**③ Compose: tag-3 OR tag-7, published, sorted by updated.** `Ctrl-K` `tag-3 ⇥` `+` `tag-7 ⇥` `→` `published ⇥` — sentence reads `…and ( ‹tag-3› or ‹tag-7› ) and ‹published›`. Click the trailing `sorted by …` token (or type `sort` — sort options are completions too), pick *recently updated*. `⏎`. Count updated at every step; total ~25 keystrokes; zero screens visited.

**④ Edit a date window twice.** The token reads `‹updated after Jul 1›`. Click it: the date control opens anchored beneath, full width, live "keeps N of M." Change, click away — the sentence absorbs it, count crossfades. Tomorrow: same click, same place, same editor. Editing the second time is *identical* to the first — no catalog re-entry, no configure-vs-edit distinction, no squash.

**⑤ Understand why a card is in the result.** With a card active and the composer open, every token wears a tiny pass mark for that card (quiet teal ✓ / quiet gray ✗ — never warning red; nothing is wrong): `‹working notes› ✓ and ( ‹tag ai› ✗ or ‹tag systems› ✓ ) ✓ and ‹not archived› ✓`. **The sentence is the membership explanation** — which OR alternative fired is visible because the group's members each carry their own mark while the group carries the aggregate. The fix for "why is this here?" is one gesture away on the responsible token: not / edit / remove. This is spec requirement "surprise repair," delivered by the same surface as everything else.

---

## 7. Visual language: native to the actual app

- **One text face.** Source Sans Pro (`--app-default-font-family`) for every word including the sentence; Raleway appears nowhere in this surface except the `DialogElement` `<h2>` — and the h2 is *omitted*: the sentence is the title. Weights 400/700 only.
- **Tokens are the tag-chip vocabulary.** Same 0.3em radius, same bold-at-small-size treatment, same color pipeline: real tags/sections take their `tagInfos` colors (users recognize their own tags instantly — this is what "native" means); property filters take the neutral chip treatment; the unknown/manual token takes the subtle/disabled treatment tag-chip already has. Connectives (`and or not sorted by`) are plain quiet text in `--app-dark-text-color-light` — the spec's own rule: operators are structure, not badges.
- **Buttons come from `ButtonSharedStyles` and nowhere else.** Token remove = `button.small` with `CANCEL_ICON` (never a literal ×, HS §4.2). Open = `button.round.primary` with `ARROW_FORWARD_ICON`. Copy link = `button.small`. The not/+or strip uses `button.small` text verbs. No new button system, no outlines, no ghosts.
- **Surface:** square corners (HS §4.4 — the "hard edges" complaint was about *foreignness*, not radius; squareness is correct *when everything else matches*), white, `--card-shadow`, thin `--app-divider-color` hairlines for group borders and the completion popover. Focus ring: the shared `2px --app-primary-color`. Selection wash: `--app-primary-color-light` translucent. Counts in the exact gray of the drawer's card count. Pass marks in `--app-secondary-color` (teal = "live/exists," per HS §4.5).
- **Motion:** `--transition-fade` only — completion popover fades, count crossfades, an accepted completion settles into its chip position; on commit the composer contracts toward the drawer sentence. `prefers-reduced-motion` honored.

---

## 8. Feasibility sketch

**Kept without modification:** engine, parser (`collection-source.ts`), history, catalog data, preview-count plumbing, argument-editor components, all shared primitives.

**Repurposed:** `collection-composer-suggestions.ts` — candidate generation, labels, descriptions, ranking survive as the completion corpus; the row-presentation half (verb labels, detail sentences, receipt text) is deleted. Estimate 60% survives.

**Net-new (the real work):**
1. **Token-tree draft model** (~300 lines + tests): essentially the spec's own `FilterExpression` sketch (`filter | or | not | manual`) plus `and`-group, with the compiler to/from `CollectionDescription` spellings (`+`, `exclude/`, `combine/`). The round-trip fixture suite the spec already mandates is the acceptance gate; unspellable nestings are detected here and flagged at the token. This is the riskiest module and the first to build.
2. **Sentence renderer** (~500 lines): recursive token/group rendering, focus model (4-arrow traversal), token strip, pass-marks. Reuses `collectionExpressionParts` for labels and `tag-chip` for leaves. Also replaces the drawer-header sentence (one renderer, two hosts).
3. **Caret completion popover** (~300 lines): anchored listbox; reuses ranking, `aria-activedescendant` machinery, and the no-reorder-under-focus rules already implemented in the current dialog's combobox.
4. **Anchored token editor** (~150 lines): the existing anchored-editor pattern, re-anchored and un-capped.

**Deleted:** the majority of the dialog — three mode renderers, mode toggling, receipt/hint prose. The dialog likely lands at ~1,800–2,200 lines; the whole change is roughly **net-negative in UI code** while adding the boolean authoring path that today has *no UI at all*. Ballpark: 3–4 weeks of focused work, engine untouched.

---

## 9. Self-critique: the three strongest arguments against

1. **Inline recursive structure editing is famously easy to demo and hard to live in.** A caret inside nested wrapping groups, token focus vs text focus, precise touch targets on group borders — this is the interaction class (query builders, expression editors) where fiddliness hides until real corpora produce four-line sentences. The current list UI is duller but mechanically bulletproof. Mitigations exist (4-arrow model, one-editor-at-a-time, wrap-by-clause), but the engineering risk concentrates exactly where the design's elegance claim lives — if token focus feels janky, the whole thesis reads as clutter with better typography.
2. **Deleting the idle suggestion list forfeits the spec's anticipatory destinations.** Focus/Pivot/Resume ("updated since you were last here," "working notes connected to this card") were destination-shaped magic before typing; this design keeps only recents when idle and demotes narrow/broaden intelligence to completion *ranking*, which only helps after the user types something. A user who doesn't know *what* to filter by gets less proactive help than the spec promised.
3. **The clutter may be conserved, not removed.** Per-token counts, pass marks, viewer-honesty snackbars, group borders, action strips, completion deltas — each is individually quiet, but the sentence now carries *every* job (display, editing, teaching, explaining), and surfaces that do everything tend to grow badges. The design's discipline (marks only with an active card, counts only on focus, one editor at a time) is a policy, and policies erode.

---

## Appendix: the eleven feedback points, mapped

| # | Owner's feedback (gist) | This design's answer |
|---|---|---|
| 1 | Not very discoverable | The entry point is the always-visible drawer-header sentence rendered by the same component — the composer is the sentence, awake. |
| 2 | Styling unlike anything else | One font, tokens are tag-chips with real tag colors, all buttons from ButtonSharedStyles, drawer-gray counts. |
| 3 | Same information in 4 places | The sentence is the *only* place a clause exists. Remove-rows, receipts, catalog rows deleted. Removal is the token's ×. |
| 4 | Configurable controls squashed | Argument editors anchor under their token at full sentence width, one at a time. |
| 5 | Suggestions seem random | No suggestion list. Idle: recents only. Typing: completions of *what you typed* with count deltas. |
| 6 | Don't see prior collections | Recents are the first thing under the caret on open, as mini-sentences with counts and times. |
| 7 | Not toggle confusing/ugly | No toggle. Negation is the word *not* inside the token. |
| 8 | Edit buttons that can't edit | Structurally impossible: no arguments → no editor region. |
| 9 | "Only for you" distracting | Deleted from the sentence; honesty fires once at copy-link. |
| 10 | Cluttered; complex at all times | Six concepts; resting surface is one sentence, one count, one button. |
| 11 | Type-to-filter best; exclude/combine common, want recursion | Typing is the spine, upgraded with synonyms/descriptions. Exclude/combine are first-class recursive structure — visible parentheses and the word *not*. |

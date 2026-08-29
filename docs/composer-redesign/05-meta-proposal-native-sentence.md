# The Native Sentence — the chosen meta-proposal

*Synthesized 2026-08-28 from four independent redesign proposals (01–04 in this directory), judged against the owner's acceptance feedback (00-context-and-owner-feedback.md). North star: ELEGANT — maximum power per concept, complexity revealed only when needed. Owner approved for implementation on the `composer-498-native-sentence` branch.*

## Where all four proposals independently converged (settled decisions)

1. **A clause exists in exactly one place: the sentence.** Delete the Remove-rows, receipt restatements, catalog echoes, and verb chips. The duplication is structural, not stylistic.
2. **Negation is language, not a toggle.** Flip `published` → the pill reads **unpublished** (via `INVERSE_FILTER_NAMES`); only inverse-less filters get a quiet "not" prefix. The Not toggle dies.
3. **OR is fusion inside a condition** — `(tag-3 or tag-7)` as one pill — compiling invisibly to `+`/`combine`; NOT on a pill or group compiles to inverse-names/`exclude`. Those words never appear outside source mode.
4. **Recents are the first content of the first gesture**, rendered as miniature sentences with counts.
5. **The catalog stops being a place** and becomes the searchable index behind typing (synonyms + descriptions via existing `searchValues`/description metadata).
6. **"Only for you" dies in composition**; viewer-dependence speaks once, at copy-link (and in source status), as a sentence about consequences.
7. **Set/sort/view are words in the sentence**, not a dropdown strip.
8. Shared net-new engineering: the spec's **boolean draft layer** — `FilterExpression` (`filter | or | not | manual`) with lossless round-trip to `+`/`exclude`/`combine` — spec-mandated regardless of UI.

## The divergence calls

- **Interactive sentence** (A/C/D) over B's read-only sentence + conditions list: B's purity kills the chip-✕, the most guessable gesture in software and the one the owner's feedback explicitly reached for.
- **Light palette now, in-page composition as the trajectory** (over D's immediate in-page bet): D is the most philosophically pure but most expensive, with a subtle draft/committed boundary and a phase-2 preview IOU. Down-payment taken immediately: the drawer sentence's pills go live (hover-✕ removes a clause and navigates with the existing receipt/Undo). The sentence renderer is ONE component with two hosts (drawer + palette) from day one, so the eventual migration is a rehosting, not a rewrite.
- **Nesting scope = the spec's user-facing model** (AND of conditions; OR within a condition; NOT on a condition or group — which covers every exclude/combine shape people actually reach for), with deeper source-authored shapes preserved as gray manual pills. A's group-is-the-same-component architecture underneath, so unlimited depth is a later unlock, not a rewrite.

## The design

**Spine: Proposal C ("Grow it native").** Clauses are the app's own tag-chips — real tag/section/person colors for value pills (meaningful color only), neutral pills for property clauses, operators as subordinate text. The palette is a light ~44em `DialogElement` (not a 90%-height workspace): sentence + input + one list + footer. All controls from `ButtonSharedStyles`. One sentence renderer serves the drawer header, the palette, and recents rows.

**Graft 1 (from B): consequence rows as the teaching engine.** When a typed token is family-compatible with an existing pill, the interpretation list offers valences with before→after counts: `+ tagged c · 41 → 12`, `…or tagged c — widens (tagged b) · 41 → 118`, `not tagged c · 41 → 29`. Idle suggestions capped at recents + **3** deterministic contextual rows. Two count roles only: sentence count = fact; row counts = predictions.

**Graft 2 (from A): the keyboard grammar and token discipline.** On a selected pill: `-` flips, `+` adds an or, Enter edits, Delete removes — footer-taught; `+`/`-` deliberately ARE the URL's own spellings, teaching source by osmosis (plus the quiet compiled-path line under the palette while composing). Completions render as the pill they would become. Editing happens in a one-line **pill row** under the sentence (the anchored editor slimmed to C's form) with the live "draft now matches N" count; card values via find-dialog picker; every pill has real contents (polarity/or/remove at minimum) so dead Edit affordances are structurally impossible.

**Graft 3 (from D): the honest endgame.** Phase 2, behind a draft-preview channel through the worker: composition migrates into the page with the drawer as live preview. Nothing in phase 1 blocks it.

**Why-here** lands in the Card Info panel (C's home): the sentence's pills rendered vertically with lit/dimmed verdicts per clause, the passing OR-segment lit; tap-through to the palette with that pill selected.

## Cost and sequencing

Phase 1 ≈ 3–4 weeks equivalent: (1) boolean draft layer + round-trip matrix (~2 weeks, owed under any design — build FIRST, it is the risk concentrate); (2) sentence renderer + pill extensions (outlined-not state, group container, pill row ~1 week); (3) palette rebuild (net-negative LOC: replaces ~2,000 lines of catalog/verb-chip/anchored-editor code with ~700); (4) ranking inputs (synonyms/descriptions, sibling-or rows) + drawer-pill liveness (~1 week); (5) why-here panel section. Engine untouched; ~80% of the branch machinery (suggestions, history, counts, source, receipts) survives as-is.

## Risks on record (from the losing stances)

- The spec warns against pill-rainbow → color only where it already means something (real tags); everything else neutral; retreat to quiet-text-with-value-chips if pills test noisy.
- Group tap-scoping on mobile is fiddly → segment-tap edits segment, edge-tap edits group, and the pill row always *names* its scope.
- Killing the catalog bets on search metadata quality → "Browse all" survives as a seeded expansion of the same list; metadata curation is real work.
- Clutter conservation (A's warning): pass-marks only with an active card, counts only where they answer a live question, one editor at a time — discipline stated here so regressions can cite it.

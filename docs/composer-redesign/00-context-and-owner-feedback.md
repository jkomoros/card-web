# Composer redesign context pack

## The owner's acceptance-test feedback (verbatim, 2026-08-28 — this SUPERSEDES spec and house-style where in tension)

1) it's not very discoverable. 2) the dialog uses styling unlike anything else in the app--different fonts, hard edges, buttons that look like nothing else. 3) the dialog seems to show basically the same information in like 4 different places, and that duplication is unclear. Like, on the default screen, there are natural language (and thus difficult to parse--no texture) actions for things that you could simply X out above. When you add a new configurable filter the controls are kind of squashed and don't look elegant. And the suggestions to add new items seem.. random? Also, I don't see how it shows prior collections you've navigated to, sorted by frequency/recency. The Not toggle on a filter is confusing and ugly. There are edit buttons on filters that you can't edit. The "only for you" is unnecessary and distracting. The whole thing feels super cluttered and like it requires me to understand a lot of complex stuff at all times. The type-to-filter is the best thing (especially if it works for synonyms / descriptions). Exclude/combine aren't edge cases, they're more common and should be handled in a more natural / recursive way.

**North star (owner's words): the main experience should feel ELEGANT, like it has tons of power-per-concept you need to understand, and gradually reveals extra complexity to you only when you need it.**

## What exists today (the thing being critiqued)

Branch `composer-498` in /Users/jkomoros/Code/card-web-composer-498 (READ-ONLY for you). One dialog (`src/components/configure-collection-dialog.ts`, ~2900 lines) with three modes:
- **Quick composer**: draft sentence as chips (`Main AND Tagged tag-3 ×`) + inline input; below it a suggestion list in sections (Continue = recents w/ counts+deltas+verbs; Refine = add/remove rows with natural-language labels + detail lines + counts); footer key-hints; round primary + count; Browse all filters / Edit source links.
- **Catalog** ("Browse all filters"): setup dropdown strip (Start From/Order By/Direction/Display As), then categorized filter list (Common/Dates/Tags/People/Relationships/Similarity/Text/Card properties/Advanced), each row = name + description + full example sentence + Add/Configure/Edit verb chip + "Not" polarity toggle. Anchored editor panel (recent addition): clause/configure editors render under the sentence with a live "Would match N cards" count.
- **Source mode**: textarea over the URL grammar with diagnostics, completions, "This means" chip chain, WILL OPEN AS, Copy link.
Supporting modules: collection-composer-suggestions.ts (candidate generation + display names), collection-filter-catalog.ts, collection-source.ts, collection-composer-history.ts (recents: localStorage, recency + frequency promotion, shown as Continue rows).

The engine underneath (KEEP — it is good and trusted): `CollectionDescription` — URL-canonical set/filters/sort/view; filters compose by AND across path segments, `a+b` unions (OR), `exclude/<sub>` negation, `combine/<a>/<b>` grouping, configurable filters with URL args (dates, key cards, ply, reference types). Counts are exact and were verified honest 10/10. Round-trips quick↔source verified lossless.

## What the four persona journeys established (relevant to design)

- Type-to-filter with Tab-materialize and count deltas is the loved core. "Count deltas taught intersection without the word AND" (naive user). 12 keystrokes beats source mode's 15 (power user).
- The suggestion list reads as an unaligned data dump; rows carry triple redundancy (verb label + verb chip + detail sentence restating the verb). Natural-language row labels have "no texture" — they don't scan.
- The catalog's 40+ rows each restate the full draft in their example line; the one differing word is at the end.
- Recents ARE implemented (Continue section, recency + frequency, relative descriptions) — but the owner couldn't see/find them: a discoverability + presentation failure, not a data failure.
- Duplication complaint is real: a clause appears in (1) the chip row, (2) "Remove X" suggestion rows, (3) receipt strips, (4) catalog "Already in this collection" rows.
- Squashed configurable controls: the anchored editor is capped at min(22em,40vh) with selects/radios/number fields in rows.
- OR/exclude/combine currently have NO UI authoring path (source-grammar only) — and the owner says these are COMMON, wants natural/recursive handling.
- "Only for you" badges (viewer-dependent clauses) — owner finds distracting; the underlying honesty matters most at the copy-link moment.
- Dead-looking Edit verbs on rows that open nothing meaningful.
- Visual: dialog is Raleway-titled but otherwise Source Sans; square corners per HOUSE-STYLE §4.4; owner reads the net effect as "unlike anything else in the app — different fonts, hard edges, buttons that look like nothing else." Judge conformance against what the APP actually looks like (soft translucent scrims, round icon buttons, tag-list pills, card aesthetics), not just the written guide.

## Constraints

- The engine/URL model is fixed and canonical. All UI compiles to `CollectionDescription`.
- docs/collection-composer-spec.md (the owner wrote it) and docs/HOUSE-STYLE.md are in the worktree — honor their doctrine ("inductively knowable power", the ladder, URL-is-a-feature), but the owner's new feedback supersedes any specific mechanism they prescribe.
- Keyboard-first must survive; the type-to-filter core must survive and get BETTER (synonyms/descriptions matching).
- Mobile must have a story.
- Feasibility matters: prefer designs that reuse the existing engine, suggestion machinery, count previews, history store, and control components — say what gets deleted vs reused.

# P2 Spec: Windowed Cards — the Memory Improvement

Status: SPEC (designed across the fast-corpus reviews; not yet built).
Prereq: corpus-worker='on' + corpus-sync='watermark' defaulted after soak —
MET since `bbfdd89c` (2026-07-11); both are the defaults now.
Flag: `corpus-memory`: 'full' (default) | 'windowed'.

## The problem (measured anatomy at 60k cards, ~3KB avg)

Today the corpus lives in memory 3+ times across two threads:

| Copy | Where | Est. at 60k |
|---|---|---|
| Raw cards map | Redux (main) | ~180 MB |
| Processed/enriched cards (nlp runs, memoized) | main | ~150-250 MB |
| Corpus Map (with nlp_search_tokens) | worker | ~220 MB |
| Engine mirror (stripped clones) | worker | ~170 MB |
| SearchIndex postings | worker | ~40 MB |
| cardMeta ×2 (worker pushedMetas + Redux) | both | ~25 MB |

**Total ≈ 0.8–1.0 GB heap.** Desktop tolerates it; mobile Safari kills the
tab. The UI thread only ever *renders* a few hundred cards.

## The improvement

Main thread keeps, for ALL cards, only **cardMeta** (~250 B/card: id, name,
title, type, section, tags, slugs, published, sort_order, author,
collaborators ≈ **15 MB at 60k**) plus **full cards for a window**: the
active collection's render window (renderOffset/renderLimit ≈ 250), the
active card, the editing card, preview/hover cards (≈ **1–3 MB**).

- Main-thread card heap: ~330-430 MB → **~20 MB (≈ 95% reduction)**.
- Whole-app heap: ~1 GB → **~450 MB** (worker copies remain; a later P2b
  can merge corpus+engine mirrors for another ~170 MB).

## Mechanism

1. **Protocol**: new `subscribeWindow {ids: CardID[]}` message (bridge) →
   worker pushes full wire cards for those ids now + deltas as they change;
   `unsubscribeWindow` on window change. Bridge derives the id set from
   UPDATE_WORKER_COLLECTION result slice(renderOffset, renderLimit) ∪
   activeCardID ∪ editingCard ∪ hover-preview id.
2. **Redux**: in 'windowed' mode, worker card batches route to cardMeta
   only (already delta-pushed); full cards land in a bounded
   `windowedCards` slice. `selectCards` serves windowedCards; a new
   `selectCardMetas` covers the rest (consumer survey 2026-07-03: card-link
   titles, tag-infos, slug lookups, permission maps already meta-capable).
3. **Off-window access** (link click to an unwindowed card): navigation
   already round-trips the worker for collections; card fetch rides the
   same push (<50ms measured push latency) behind the existing loading
   affordances.
4. **Off-path full-corpus consumers** (word cloud, suggestions,
   maintenance, reference fallback-text) move to worker RPCs — that is P3,
   sequenced with this; until then those features force 'full' mode.
5. **fastDedupe** moves worker-side (Redux no longer holds comparands);
   the worker already dedupes on updated-timestamps at ingestion.

## Rollout & acceptance

Staged exactly like corpus-sync: flag off → probe-validated → soak → default.
Acceptance gates (tools/perf/live-boot-probe + harness --assert):
- `performance.memory.usedJSHeapSize` (main) at 40k settled: **≤ 25%** of
  'full'-mode baseline, recorded in the log.
- No regression: NAV/typing zero long tasks, commit ≤ 800ms blocking,
  find-dialog worker-served (harness counter invariants green).
- Editor round-trip: open/edit/commit on a card OUTSIDE the window.

## Risks

- selectCards consumers not in the survey (new code since 07-03) — re-run
  the consumer audit first; the guard is a lint banning new selectCards
  imports outside an allowlist.
- Editing flows touching non-windowed cards (multi-edit over a big
  selection) need explicit window-expansion or chunked RPC.
- The interim state (meta + window + worker) is MORE complex than either
  end state — do not park here; P2b (merge worker copies) follows.

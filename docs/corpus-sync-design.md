# Corpus Sync Design (JUDGED FINAL) — watermark/delta with per-boot trust gate

This is the adjudicated synthesis of two competing designs
(corpus-sync-watermark-design.md, corpus-sync-bundle-design.md) against
verified Firestore billing semantics (corpus-sync-fact-check.md) and live
incident data. Produced 2026-07-05 by an adversarial judge agent; load-bearing
claims spot-checked. THE implementation plan is section 4 (Phased plan).

All load-bearing claims are now verified against the repo. I have what I need to rule.

---

# Final Adjudication & Synthesized Architecture

## 1. Decision summary

Adopt **Designer A's architecture as the chassis** — persistent worker cache as the durable corpus, one unpartitioned `(published==false, updated > W−5min)` delta listener with a derived watermark, tombstones + cache-laundering as the deletion channel, full listener kept on the ~1.2k published cards, and the budgeted resumable server sweep as the v1 cold path — **rejecting Designer B's trigger-fed GCS mirror / synthesized-bundle pipeline for v1** (700–900 lines of new server infrastructure resting on an internal SDK API, to optimize a ~yearly event). But both designs share a **boot-trust hole the live incident already demonstrated**: they bless a cache prime whose completeness is unknowable client-side. The synthesis therefore **promotes the count() check from a daily safety net to a per-boot, per-partition trust gate** that must pass before a primed corpus is declared trustworthy — this is the one structural change neither designer specified and the most important line in this ruling. The sync cursor is the existing `updated` field (the coordinator's sort-pollution concern is factually wrong for this codebase — verified below), with the `inboundLinksUpdates` fix landing as a two-step rules rollout.

## 2. Adjudications

**(a) Cold path: Designer A v1 (budgeted resumable sweep) wins. B's bundle pipeline is rejected for v1; A's v2 GCS snapshot is the named successor.**
B's design optimizes an event that happens ~once a year per device, at the price of a *standing* system: a proto serializer, a trigger-fed mirror whose consistency must itself be audited, a builder on `Firestore.snapshot_` (internal API) or a hand-rolled bundle format, Storage rules with cross-service `firestore.get`, and — per the fact-checker's claim 11 — a Storage-bucket dependency that new Spark projects may not even have, violating the "dev viable on Spark" constraint B itself acknowledged. A single maintainer carrying ~800 lines of bespoke server code to convert a 2-day, 65k-read, once-a-year degraded window into a 0-read window is a bad trade. A's sweep reuses existing machinery (partitions, budget counter, cursor in sync-meta), never exceeds daily quota, and makes the app usable within minutes via the priority phase.
**Escalation trigger**: build the fancier path if (i) measured cache eviction exceeds ~monthly on real devices despite `CACHE_SIZE_UNLIMITED` + `navigator.storage.persist()`, (ii) a real reader population appears, or (iii) multi-tab becomes routine. When triggered, build **A's v2 (incrementally-maintained GCS NDJSON snapshot, function keeps its own watermark, ~10–50 server reads/day)** — same read math as B's mirror with none of the bundle-format risk. B's `loadBundle` gains nothing over direct NDJSON ingestion into the worker's own corpus, because the worker already has its own serving layer; the Firestore cache is a persistence substrate, not the serving layer.
**Second tab**: B's "bundles fix it" is real but arrives with the whole pipeline. V1: Web Lock (`corpus-worker-owner`); the loser must never cold-sweep or delta-listen — it runs published-only degraded (≤1.2k reads) with a banner. The *correct* long-term fix is a SharedWorker (one corpus, one quota footprint), not bundles.

**(b) Published corpus: keep the full listener (A is right).**
Worst case is 1.2k reads per boot after a >30-min gap; 3 boots/day = 3.6k = 7.2% of quota — the price of getting deletions and unpublish-flips delivered natively to *all* audiences, including anonymous readers, with zero tombstone-leak machinery. Accept it, with a **tripwire at ~3k published cards** (9k/day at 3 boots ≈ 18%): the composite index `(published, updated)` added in Phase 0 serves `published==true` deltas too, so extending watermark treatment to published later is a small worker change, not a schema change.

**(c) Tombstones: A's shape wins because it composes with (b).**
With a full published listener, unpublish-flips reach readers as `removed` docChanges and reach the privileged editor as delta deliveries (the flip bumps `updated`). B's `scope:'published'` tombstones exist only because B watermarked the published plane — a need (b) eliminates. On laundering: **A is right and B is subtly wrong.** B's "rely on the corpus layer, keep tombstones forever" leaves the SDK cache permanently poisoned and couples correctness to never pruning tombstones and re-filtering on every prime forever. A's `getDocFromServer` per tombstone (1 read, rare) overwrites the cached ghost with the not-exists result, so the prime source itself heals and tombstones become prunable at ~90 days; `processedTombstoneIDs` in sync-meta covers the window before laundering succeeds. Delta-listener `removed` events are advisory only (a doc also leaves that result set on publish-flip) — A's `parseSnapshot` special-case stands.

**(d) One unpartitioned delta listener: fine. Composite index: confirmed required, and worth it.**
The historical failure was about *result-set size*, not query evaluation: the log (line ~119) shows the 5-way partitioning was a workaround for 60s `getDocs` timeouts streaming 38k docs, and the ~2-min-drop pain (log ~432) was the full-38k *redelivery* per re-attach. A delta listener's result set is 0–2,000 docs served off an index; both the initial poll and every drop-redelivery are tiny. No timeout class applies. Mid-session rotation at >2,000 (both designers, same idea): keep.
Index: **verified** — `firestore.indexes.json` has no `(published, updated)` composite; fieldOverrides only has single-field `updated`. Fact-check claim 10 confirms equality+range requires the composite. Note B's unfiltered privileged cursor (`updated > W` alone) is actually rules-admissible (the read rule's `userMayViewUnpublished()` disjunct is provable without `resource.data`) and would need no composite — but the filtered form keeps the published/unpublished planes disjoint, which the fetchType guards and the removed-event semantics reason about. One line in `firestore.indexes.json` is cheaper than blurred plane semantics. **Filtered query + composite.**

**(e) Partial-cache detection — the coordinator's analysis is correct and both designers under-specified this. Verdict: per-partition count() becomes a per-boot trust gate.**
The hole is real and the live incident is its proof, in the worst possible shape: the 5,001-card cache was master's PARTIAL mode residue (1,240 published + 5,000 *most-recent* unpublished), so `max(updated)` over the partial cache ≈ the true corpus max → the delta query delivers ~nothing → **34k docs permanently missing, forever**, while reconciliation (worker vs Redux, both fed by the same cache) reports "clean." Docs created after the cache snapshot do have `updated > W`; docs that existed before it and were never edited are in neither the cache nor the delta. A treated count() as a daily net (detects a day late, after serving 13% of the corpus as truth); B's manifest counts only guard the cold path while the warm path trusts `corpusSizeTrustworthy` — which the incident showed is structurally blind to same-source staleness.
Fix, by construction: at every boot, concurrently with the (still instant, free) cache prime, run **`getCountFromServer(published==false)` over the 10 existing documentId() partition ranges** (~39 reads at 39k, ~60 at 60k — the partitioned queries are exactly today's `buildPartitionQuery` shape, served by the single-field `published` index; no new index). Compare per-partition against the primed corpus. Per-partition comparison defeats the cross-range cancellation attack (a ghost in range X masking a missing doc in range Y under a single total). Within-partition ghost/missing cancellation is the residual blind spot — vanishingly unlikely and further shrunk by tombstone laundering.
- All partitions match (tolerance ~few docs for in-flight churn) → bless: `loadComplete`, trustworthy, reconciliation eligible.
- Small deficit → A's count-bisect repair (~200–500 reads).
- Large deficit (>~20%) → this *is* a cold device: budgeted sweep, partial-corpus degraded mode.
- Offline → serve the cache in a new `unverified` sync state (offline reads preserved); gate runs on reconnect before blessing. (Aggregations are server-only — fact-check claim 6 — so offline can never self-bless; that is correct behavior.)
`WARM_CACHE_THRESHOLD >= 1000` is **deleted as a trust signal** — it survives only as a "is priming worth doing at all" heuristic. Serving stays fast (prime serves immediately in the degraded/unverified state; the gate resolves in ~hundreds of ms and upgrades it) — trust slow, serve fast.

**(f) `updated` invariant + coordinator addendum: Option (1) — reuse `updated`. The addendum's premise is factually wrong for this codebase.**
Verified in `src/filters.ts`: the `'recent'` sort (line 1678) uses `updated_message`/`updated_substantive`; the `'updated'` sort (line 1650) uses `updated_substantive`; the `'updated'` date filter maps to `updated_substantive` (line 459). Plain `updated` appears in exactly one product surface: `card_finishers.ts:33`, where the working-notes title date is stamped during an active edit of that card — an inbound-link bump could shift that date only in the marginal case, and arguably toward *more* accurate. There is no sort pollution to accept. Meanwhile the codebase already has the three-tier timestamp design (`updated` = any doc change, `updated_substantive` = meaningful edit) — bumping `updated` on inbound-link writes is semantically *honest*, not a hack.
The decisive argument against `sync_ts`: **fastDedupe (`data.ts:1501`) compares `updated` via `timestampsEquivalent`** — today an inbound-link-only change is silently droppable on redelivery. Bumping `updated` fixes that live hazard as a side effect; a `sync_ts` field would require migrating fastDedupe too, plus a 60k-doc backfill (3 days of write quota — and unless backfilled as a *copy* of `updated` rather than `serverTimestamp()`, it would storm every device's delta query with 60k re-deliveries), plus rules changes on every write branch, plus interim coalesce-watermark complexity. All cost, no benefit at current product semantics. Counter drift (star/thread/tweet counts, `cardEditMinor`) stays accepted per A: single editor, readers rare, tweet feature vestigial, heals on next real edit. **Document the escape hatch**: if counters ever need cross-device freshness or a future surface sorts on plain `updated`, introduce `sync_ts` then, backfilled as `sync_ts := updated` (no redelivery storm, rules-enforceable on every branch).
Sequencing (A specced the rules change but not the deployment order): `cardEditInboundReferences` (rules line 161) currently `hasOnly(['references_inbound','references_info_inbound'])` — a client sending `updated` today is **rejected**. Two-step: (1) deploy rules allowing *optional* `updated` (`hasOnly([...keys, 'updated']) && (!affectedKeys().hasAny(['updated']) || requestData.updated == request.time)`); (2) ship the client that sends it (`shared/card_write.ts` grows a `timestampSentinel` param; `src/card_diff.ts:600` wrapper passes `serverTimestamp()`); (3) optionally tighten to *require* once old clients age out.

**(g) Migration order: the delta plane lands before any further live worker-mode boot. Non-negotiable.**
Every current-code worker-mode boot burns ~39k (yesterday's incident: quota exhausted mid-attach, today's ~0 remaining). Development and phase validation happen against the emulator; the **first** live worker-mode boot after this work is on the new code and costs <100 reads. The cold-path live validation (the only expensive one, ~65k/2 days) is deferred to last and run exactly once — or deferred entirely until a real cold device needs it, with emulator tests covering resumability. Also from A's audit, now policy: `functions/src/idf.ts:48` and `functions/src/common.ts:234` each burn a full corpus read per invocation — they must never be scheduled and get a loud comment.

## 3. The synthesized design

**Listener topology (privileged editor):**
1. Full listener `where('published','==',true)` — unchanged (readers get deletions/unpublish natively).
2. Delta listener `where('published','==',false).where('updated','>', W − 5min)` — one, unpartitioned; rotate if result set >2,000 mid-session. Requires composite `(published ASC, updated ASC)`.
3. Tombstone listener `collection('tombstones').where('deleted','>', W_t − 5min)` — privileged-read only.
Non-privileged signed-in users keep their existing small author/permissions listens; anonymous readers keep only (1).

**Boot algorithm (worker, privileged):**
1. **Prime** (free): `getDocsFromCache` → ingest, forward with fastDedupe, serve immediately in `unverified` state. Derive `W = max(card.updated)` over primed docs, `W_t` from sync-meta (floored at W).
2. **Trust gate** (concurrent, ~40–60 reads): per-partition `getCountFromServer(published==false, docId range)` ×10 vs primed per-partition counts. Match → bless (`loadComplete` semantics: "corpus in hand + delta channel = complete coverage"; trustworthy; reconciliation eligible; `syncState:'live'`). Small deficit → count-bisect repair. Large deficit or empty cache → cold path. Offline → stay `unverified`, gate on reconnect.
3. **Attach** listeners (published full, delta at W, tombstones at W_t). Delta initial snapshot = the catch-up (no separate getDocs). Advance in-memory watermark only to `max(updated)` over server-confirmed ingested docs — never from echo cards (client-clock sentinels), read-time, or wall clock (A's §6 no-gap proof depends on exactly this; enforce in one function with tests). Persist sync-meta debounced, strictly after ingest+forward.
4. **Tombstone processing**: remove from corpus/index/engine, forward `removedIDs`, launder cache via `getDocFromServer` (1 read), record in `processedTombstoneIDs` until laundered, advance `W_t` after ingest+launder. Re-suppress processed IDs at prime time.

**Deletion channel:** `deleteCard` writes `tombstones/{cardID} = {deleted: serverTimestamp(), by, published}` in the same MultiBatch (`data.ts:1299` block, alongside the existing updates-subcollection deletes and inbound cleanups). Rules: read `userMayViewUnpublished()`, create editor-class, mutate admin. Prune >90 days via maintenance task. Console deletes are caught by the boot gate + bisect.

**Cold path (v1):** published listener's natural 1.2k initial + top ~5k unpublished by `updated DESC` (usable in minutes) → systematic sweep `orderBy(updated ASC, documentId())` in ~500-doc pages, cursor persisted in sync-meta, budget counter pauses at ~42k/day (ascending order makes mid-load edits re-encountered, never missed). Partial-corpus degraded mode meanwhile. ~65k total, ≤36h, ~yearly.

**Second tab:** Web Lock `corpus-worker-owner`; loser never cold-sweeps or delta-listens — published-only degraded + banner. SharedWorker is the v2.

**Guards adaptation:** fetchType set for privileged = `{published, unpublished-delta, tombstones}`; `errorFallback` batches still count as nothing (67675d47 hardening verbatim); `corpusSizeTrustworthy` formula unchanged but now downstream of the count gate; new `syncState: 'live' | 'stale' | 'unverified'` on worker status; quota outage mid-anything = stale-serving, no removals (already live-validated).

**Sync-meta store** (`src/worker/sync-meta.ts`, worker-owned IndexedDB): tombstone cursor, cold-load cursor + daily read budget, processedTombstoneIDs, lastGateResult, schemaVersion.

## 4. Phased plan

**Phase 0 — Bug fixes + schema groundwork (deploy today; no live boots needed).**
Files: `src/worker/corpus-worker.ts` (add `cacheSizeBytes: CACHE_SIZE_UNLIMITED` to the persistent `initializeFirestore` at line 403 — fixes a live bug regardless of design); `firestore.indexes.json` (composite `published ASC, updated ASC` on cards); `firestore.rules` (`cardEditInboundReferences`: allow optional `updated == request.time`; new `tombstones` match block); `shared/card_write.ts` + `src/card_diff.ts:600` (timestampSentinel → `updated` on inbound updates — **deploy after rules**); `src/actions/data.ts` (`deleteCard`: tombstone `batch.set`). Note: this fixes the fastDedupe silent-drop hazard.
Validation: unit tests + rules emulator tests. Read budget: 0. Rollback: revert client; rules/index are permissive supersets, safe to leave.

**Phase 1 — Delta plane + trust gate (flag `corpus-sync:'watermark'`).**
Files: `src/worker/corpus-worker.ts` (replace `connectUnpublishedPrivileged` server prime + `attachUnpublishedListeners` with the boot algorithm; delta/tombstone listeners; per-partition count gate; laundering; `parseSnapshot` delta-removed advisory case; delete `WARM_CACHE_THRESHOLD` as trust signal); new `src/worker/sync-meta.ts`; `src/worker/worker-protocol.ts` (`syncState`); `src/corpus-bridge.ts` (stale/unverified surfacing); `src/corpus-mode.ts` (flag).
Validation: emulator suite (watermark derivation/advancement, gate pass/deficit/offline, tombstone flow, laundering, echo-doesn't-advance-W); then **one** live warm boot on dev: expect prime 0 + gate ~40 + delta ~1–10 + tombstone 1 ≈ **<100 reads** (if the 40MB LRU already partially evicted the cache, the gate fires and the repair path gets a free live test — budget ~500). Rollback: flag flip to `'listen'` (costs one 39k boot — flip only deliberately).

**Phase 2 — Cold path (same flag, new code path).**
Files: `corpus-worker.ts` (priority phase, budgeted sweep, cursor persistence, partial-corpus mode); `src/card-partitions.ts` (retained as bisect seeds/sweep fallback).
Validation: emulator (resumability, budget pause/resume, mid-sweep edit safety); live validation deferred — either one deliberate 2-day run (~65k) after Phases 1/3 soak, or on first genuine cold device, monitored. Rollback: flag flip.

**Phase 3 — Second-tab guard.**
Files: `corpus-worker.ts`/`src/corpus-bridge.ts` (Web Lock; loser → published-only + banner). Validation: two live tabs, expect ≤1.2k. Rollback: none needed (pure guard).

**Phase 4 — Cleanup + server hygiene.**
Remove partition listeners after ~2-week soak (keep `card-partitions.ts`); tombstone pruning maintenance task; loud comments on `functions/src/idf.ts:48` / `common.ts:234`; MEMORY/design-doc updates; document the `sync_ts` escape hatch and the published-listener 3k tripwire.

## 5. Read costs (final design, per device, 60k ceiling) & residual risks

| Scenario | Reads |
|---|---|
| Typical day (3 boots, 10 edits) | **~350–3,900**: per boot ≈ gate 60 + delta 1–10 + tombstone 1 + published 1–1,200 (the 1.2k full-published re-bill per >30-min-gap boot dominates; 7.2%/day worst case, accepted per (b)) + echoes ~10–30 |
| Monthly sweep day (300 cards) | +~300 editing device; +~300 per other device next boot |
| Cold device | ~65k over 2 days (usable after ~6k, minutes); ~yearly |
| Second tab | ≤1.2k (published-only degraded) |
| Quota-outage day | 0 extra (stale-serving; strictly better than today) |

**Top 3 residual risks:** (1) **`updated` as a forever-invariant** — any future writer that skips the bump silently forks devices; mitigate with a write-site lint/test and the documented `sync_ts` escape hatch. (2) **Cache durability** — eviction converts warm boots into 2-day sweeps; the boot gate now *detects* it reliably (the incident class is closed), but frequency risk remains — measure, and escalate to the GCS-snapshot v2 at >monthly. (3) **Gate blind spots** — count() cannot detect silently *mutated* content, and within-partition ghost/missing cancellation is theoretically possible; the no-gap proof discipline covers mutations, and an optional quarterly full re-read (60k, one budgeted day) is the honest paranoia backstop.

**Where the designers were wrong, plainly:** B built ~800 lines of internal-API-dependent infrastructure to optimize a yearly event and left the warm path exactly as blind as the live incident that motivated this review (manifest counts guard only the cold path). A had the right architecture but placed count() at the wrong cadence — a daily net catches the 34k-doc hole a day late; only a per-boot, per-partition gate closes it by construction. The coordinator's `sync_ts` addendum rested on a false premise — `'recent'` and `'updated'` sorts read `updated_substantive`, not `updated` (filters.ts:459, 1650, 1678) — and reusing `updated` is not merely acceptable but required to fix the fastDedupe silent-drop bug at data.ts:1501.
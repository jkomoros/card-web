# Design: Bundle-Centric Firestore Sync for card-web

**Status**: Proposed design, grounded in `implement/fast-corpus` at 67675d47. Read against `docs/fast-corpus-implementation-log.md`, `src/worker/corpus-worker.ts`, `src/corpus-bridge.ts`, `src/corpus-readiness.ts`, `functions/src/index.ts`.

---

## 0. The one-sentence shape

A Cloud Function maintains a **GCS mirror of the corpus fed by write-trigger payloads (zero Firestore reads)**, assembles published/unpublished **bundles from that mirror**, and clients cold-boot by `loadBundle()` into the worker's persistent cache (zero reads) followed by a **narrow `updated > watermark` cursor query** for deltas — deliberately *not* relying on full-corpus listener resumption, whose billing semantics are the least trustworthy part of the whole space.

A key reframing up front: the design's live-update plane is **cursor queries + a tombstone collection**, not the current five full-corpus partition listeners. This is what makes every read-cost line item provably proportional to *documents actually changed* rather than corpus size, and it makes the design robust to the worst-case interpretation of Firestore's listener billing rules (§3.3).

---

## 1. Grounding facts from the repo

- Every card write path in `src/actions/data.ts` sets `updated: serverTimestamp()` (lines 423, 515–568, 657, 797, 1122; creation at 829–837 via sentinel). So `updated > T` is a sound delta cursor — with a rules-level enforcement option (§4.6) to make it a guarantee rather than a convention.
- `functions/src/index.ts` already has `onDocumentWritten('cards/{cardID}', processCardEmbedding)` — a per-card-write trigger is established infrastructure, as is `onSchedule` (autoTweet) and nodemailer alerting. `firebase-functions@^7`, `firebase-admin@^11.8`, Node 20, gen-2 API surface. **Implication: the project is already on the Blaze plan** (Cloud Functions deployment requires it), so "free tier" here means *staying within Blaze's no-cost allotments* — overage bills money rather than hard-failing on prod. (The dev project's live `resource-exhausted` outages logged on 2026-07-04 suggest dev is Spark or budget-capped; the design keeps dev viable too.)
- `functions/src/common.ts` already uses `getStorage()` — a Cloud Storage bucket exists and is usable from functions.
- The worker (`src/worker/corpus-worker.ts`) already has: `persistentSingleTabManager({forceOwnership:true})` cache handoff, warm-boot cache prime (`WARM_CACHE_THRESHOLD`), `expectInitialLoad`/`loadComplete`, `corpusSizeTrustworthy` gating, `errorFallback` batches, resilient listener re-attach, corpus-ID reconciliation, and the 5-partition table in `src/card-partitions.ts`. **All of this survives; bundles slot in as a new prime source.**
- Security rules: `cards` readable iff `published == true || userMayViewUnpublished()`. Storage security rules can call `firestore.get()` (cross-service rules), so the existing `permissions/{uid}` doc can gate bundle downloads without new auth machinery.

---

## 2. Components

### 2.1 The mirror (server-side, zero-read corpus copy)

**New**: `functions/src/bundle.ts`, exporting:

1. **`mirrorCardWrite = onDocumentWritten('cards/{cardID}')`** — a *separate export* from `updateCardEmbedding` (small blast radius, independent retry). The trigger event **carries the full after-image of the document — no Firestore read is ever issued**. It:
   - Serializes `change.after` to Firestore REST-proto JSON (`{name, fields, updateTime}`) and writes it to `gs://<bucket>/corpus-mirror/cards/<id>.json` (delete → removes the object).
   - On delete, or on a `published: true → false` transition, writes a **tombstone** document to a new Firestore collection `tombstones/{cardID}`: `{cardID, scope: 'card' | 'published', time: serverTimestamp()}`. (The published-flip tombstone fixes a subtle reader-staleness hole — §4.5.)
   - Touches a tiny manifest-dirty marker object in GCS (`corpus-mirror/dirty`).

   Cost per card write: 0 Firestore reads, 0–1 Firestore writes (tombstone, deletions only), 1–2 GCS Class-A ops. A 300-card monthly sweep = 300 invocations, 0 reads. GCS op quotas (20k uploads/day) dwarf this.

2. **Serializer**: a ~150-line `functions/src/firestore-rest-proto.ts` converting `DocumentData` (Timestamps, strings, numbers, booleans, maps, arrays — cards use nothing more exotic; verify no `DocumentReference` fields in `shared/types.ts` Card) to/from REST proto `Value`s, with round-trip unit tests and an **emulator round-trip test** (write doc → trigger-serialize → build bundle → `loadBundle` in the JS SDK against the emulator → assert byte-equal `data()`). This test is the load-bearing safety net for risk #1.

### 2.2 The builder

**`buildCorpusBundle = onSchedule('every 24 hours')`** (plus an `onRequest` admin-token variant for manual/forced builds):

1. Check `corpus-mirror/dirty` vs the last build's manifest. **Unchanged corpus ⇒ exit. 0 Firestore reads, ~2 GCS ops.**
2. Stream-list `corpus-mirror/cards/` (or maintain a compacted NDJSON base + delta prefix if per-object listing of 60k objects proves slow — an internal optimization, same semantics), assemble two bundles with `firestore.bundle()`:
   - `published.bundle` — all docs with `fields.published = true` (~1.2k docs, ~4 MB raw / ~1 MB gz).
   - `unpublished.bundle` — the rest (~38k now / ~58k at ceiling; ~115–210 MB raw, **~30–55 MB gzipped** — bundle JSON compresses ~4×).
   Document snapshots are synthesized from the mirrored protos via `Firestore.snapshot_(proto, readTime, 'json')` (internal-but-stable API in `@google-cloud/firestore`; pinned version + the emulator round-trip test in CI; fallback: hand-roll the public length-prefixed bundle element format — it is documented and stable). **Zero Firestore reads.**
3. Choose `readTime = (build start) − 5 min`, and require `max(updateTime in mirror) ≤ build start` sanity. The 5-minute back-off plus client-side cursor catch-up (§2.4) makes trigger delivery lag harmless (duplicates dedupe; nothing can be missed).
4. **Integrity check** (the only Firestore reads in the whole server pipeline): `getCountFromServer` aggregations for `published==true` and `published==false` — aggregation billing is 1 read per 1,000 index entries ⇒ **~60 reads for a 60k corpus**. Mismatch beyond tolerance ⇒ abort build, email alert (existing nodemailer infra), keep prior bundle.
5. Write bundles gzip-encoded to `bundles/published.bundle`, `bundles/unpublished.bundle`, plus a small public `bundles/manifest.json`: `{builtAt, readTimeMicros, publishedCount, unpublishedCount, bundleBytes, generation}` (unpublished count is not sensitive; the IDs/content are). Keep the previous generation for rollback.

Memory: assemble streaming to GCS; configure 1 GiB / 540 s. Runs ≤1/day, usually exits at step 1 — compute cost ~nil.

### 2.3 Serving + auth

- `published.bundle` + `manifest.json`: **public**, cache-friendly (`Cache-Control: public, max-age=300` on manifest; bundles content-addressed by generation so immutable-cacheable). Served straight from the Storage bucket (or copied into Hosting — but Hosting redeploys are wrong for a nightly artifact; Storage is the right home).
- `unpublished.bundle`: Storage security rule
  ```
  match /bundles/unpublished.bundle {
    allow read: if firestore.get(/databases/(default)/documents/permissions/$(request.auth.uid)).data.viewUnpublished == true;
  }
  ```
  (exact field per the real `permissions` schema — mirror `userMayViewUnpublished()` from `firestore.rules`). The client downloads via the Firebase Storage SDK (`getBytes`/`getStream` — works in a dedicated worker; it's fetch-based). Each rule evaluation with `firestore.get()` bills 1 Firestore read — per *download*, i.e. ~1 read per cold boot. 
- **CDN note**: because the authed bundle is fetched via the Storage SDK with per-request OAuth, it is *not* CDN-cached — acceptable, since cold boots are rare and Storage free egress is 1 GB/day (≈18 unpublished-bundle downloads/day at 55 MB). No Hosting rewrite → function proxy is needed; keep that as fallback only if Storage rules prove awkward (an `onRequest` verifying the ID token and issuing a 5-minute signed URL — note gen-2 function egress free allotment 5 GB/mo if it streams, which is why the redirect/signed-URL form is preferred in that fallback).
- **Token expiry mid-download**: the download is a single HTTP request authorized at request start; expiry mid-stream doesn't abort it. On any failure the SDK retry re-authorizes with a fresh token. Partial/truncated download ⇒ `loadBundle` throws ⇒ retry once ⇒ fall back (§5).

### 2.4 Client boot algorithm (worker modes, privileged user)

All inside `connectUnpublishedPrivileged()` / a new sibling in `src/worker/corpus-worker.ts`; the bridge protocol (`loadComplete`, `corpusSize`, `errorFallback`, reconciliation) is unchanged in shape.

```
connect:
  A. Warm path (unchanged): getDocsFromCache(unpublished) ≥ WARM_CACHE_THRESHOLD
     → prime corpus from cache (0 reads)
  B. Cold path (NEW, replaces the 38k-read partitioned server prime):
     1. fetch manifest.json (public, 0 reads)
     2. download published.bundle + unpublished.bundle (0 reads; ~1 rules-read)
     3. loadBundle() both into the worker's persistent cache; verify
        loaded doc counts ≈ manifest counts
     4. prime corpus from cache (getDocsFromCache) — now warm
  C. Fallback (manifest missing / download or loadBundle failed twice):
     today's partitioned getDocsFromServer prime — degraded but correct
     (pre-migration behavior; ~38k reads; log loudly)

then, on every path:
  5. watermark W = max(card.updated) over the primed corpus
     (derived, not stored — no new persistence)
  6. tombstone prime: getDocsFromCache(tombstones) ∪
     onSnapshot(tombstones where time > W_t)  → apply removals to
     corpus/engine, forward removeCards  (tombstones are tiny, permanent,
     and themselves persistently cached: prime is 0 reads, listener bills
     only new tombstones)
  7. delta cursor listener: onSnapshot(cards where updated > W orderBy updated)
     [privileged: no published filter — rules allow; non-privileged readers:
     + where published == true]
     → initial delivery = docs changed since W (typically 0–20; sweep day
     ~300); each later live edit arrives as +1 doc. Delivered docs also
     refresh the persistent cache, so the next warm boot includes them.
     Re-cursor: when the result set grows large intra-session (say >2,000),
     tear down and re-attach with W' = max(updated seen) — keeps the
     standing result set tiny forever.
  8. loadComplete when: prime source succeeded AND tombstone + cursor
     listeners attached. corpusSizeTrustworthy: corpus.size vs manifest
     counts (cold) / vs Redux (warm, as today), max(50, 10%) tolerance.
     errorFallback batches still don't count as evidence — all the
     2026-07-04 hardening carries over verbatim.
```

**What this deletes eventually**: the five unpublished partition listeners (and their drop-costs-8k-redelivery problem, and the whole "does re-attach bill deltas?" anxiety in the log). `src/card-partitions.ts` stays for the fallback path only. **Staging**: the cursor plane ships behind the existing `corpus-worker` flag machinery (`src/corpus-mode.ts`) as a new mode value, with the partition listeners as the flip-back.

**Own-write echo**: unchanged — `ECHO_LOCAL_CARD_MODIFICATIONS` settles the UI at server-ack as of the strictly-superior pass; the cursor listener later delivers the same doc (1 read) and the existing `deepEqualIgnoringTimestamps` dedupe eats it.

**Second tab**: today the second tab's worker loses the persistence-ownership fight → memory cache → *full 38k-read server prime* (the "multi-tab quota multiplication" regret tracked in the log). Under this design it falls into path B: bundle download (0 reads) + delta D. **Bundles retire that regret.**

**Multi-device**: each device independently runs the same algorithm; watermarks are per-device and derived from server timestamps (no clock-skew exposure).

### 2.5 Deletions — explicit answers

- `loadBundle` does **not** remove cache docs absent from the bundle — confirmed by its contract: it *upserts* bundle documents, skipping any the cache holds at a newer version. Never assume otherwise.
- A card deleted between bundles: cold-booting device's bundle simply lacks it (correct); a device whose *persistent cache* predates the deletion resurrects it on warm prime — the **tombstone prime (step 6) filters it out every boot**. Client code cannot delete docs from the SDK cache, so the stale doc physically lingers in IndexedDB; the worker corpus (the actual serving layer) is what matters, and it applies tombstones. Deletions are rare ⇒ the permanent tombstone set stays tiny (hundreds ever).
- The existing bridge-side corpus-ID reconciliation (67675d47) remains the last-ditch net for Redux-vs-worker drift, unchanged, mass-removal guard and all.

---

## 3. Read-cost accounting (the crux)

Budget: 50,000 reads/day no-cost, shared client+server. Let *D* = docs changed since the relevant watermark.

### 3.1 Builds-per-week vs reads-per-build

| Build strategy | Firestore reads/build | Builds/wk | Server reads/wk | Verdict |
|---|---|---|---|---|
| Naive nightly full read | 60,000 | 7 | 420,000 | 8.4× the *weekly* budget; a single build exceeds a whole day. Dead. |
| Weekly full read | 60,000 | 1 | 60,000 | Still >1 day's budget in one day; fails/bills. Dead. |
| Delta read (`updated > lastBuild`) merged into stored base | ~D (0–300) | 7 | <2,100 | Viable steady-state, but the *first* build still needs a full read, and every build pays D reads for data the trigger already gave us for free. |
| **Trigger-payload mirror (chosen)** | **0** (+~60/wk integrity `count()`) | ≤7 (usually 0–2 after dirty-check) | **<100** | Server side is effectively free at any cadence. |

Because rebuilds cost ~nothing, cadence is set by *freshness* not cost: nightly with skip-if-clean. Bundle `readTime` is thus ≤ ~24 h stale, keeping every client's catch-up D small.

### 3.2 Client-day scenarios (60k corpus, privileged editor)

| Scenario | Reads | Notes |
|---|---|---|
| Typical day, warm device, 1 session | **< 100** | cache prime 0; cursor initial D≈0–20; tombstones ≈0; own edits echo ~1 ea |
| Monthly sweep day, 2 devices | **< 1,000** | ~300 changed × 2 devices' cursors + 300 trigger invocations (0 reads) |
| Cold new device | **< 200** | manifest 0 + bundles 0 + ~1 rules-read + tombstone 0–5 + cursor D (0–50) + optional `count()` verify 60 |
| Second tab, same device | **< 60** | bundle path, no persistence ownership needed |
| Builder, per day | **0–65** | 0 on clean days; ~60 `count()` on build days |
| FIRST boot ever (no bundle yet) | ~38,000 (fallback C) *or* **0** via client-seeded migration (§6) | this is exactly today's cost — the design's job is to make it the last such boot |
| Build-failed-for-a-week cold boot | bundle 0 + D ≈ a week's edits (tens–hundreds) | degrades in *delta size*, not corpus size |

Aggregate typical day: **well under 1k of 50k — ~50× headroom**, vs. today's memory-cache worker boots at ~40k each (the documented live quota outage).

### 3.3 SDK semantics: certain vs. verify-live

**Certain (documented contract):**
- `loadBundle()` bills **zero** reads — the bundle is a static file; billing happened conceptually at build time (and *our* build reads zero because it never touches Firestore).
- Bundle loading upserts into the local cache, skips stale versions, never deletes.
- `namedQuery()` materializes the bundled query, servable from cache at 0 reads.

**High-confidence mechanism, but we deliberately don't lean on it:** a bundle writes the named query's `readTime` into the SDK's target cache; a subsequent `onSnapshot` on a matching query resumes from that readTime and the server *transmits* only changes. The **billing** question is the trap: Firestore's pricing doc says a listener disconnected **>30 minutes** is "charged for reads as if you had issued a brand-new query." If that applies to day-old bundle readTimes (and to the current architecture's overnight listener re-attaches — the log's "resume tokens make re-attach bill ~deltas" comment is a *belief, not a verified fact*, and the observed quota burn is consistent with the pessimistic reading), then full-corpus listens over 38k docs bill ~38k/boot no matter how warm the cache is. **This design's cursor queries are the hedge: a brand-new `updated > W` query bills its result set (D docs), so even the worst-case interpretation costs D, not 38k.**
- **Verify-live P0 spikes** (dev project, usage dashboard before/after): (1) `loadBundle` of a synthesized bundle is accepted by the JS SDK and bills 0; (2) an `updated > W` `onSnapshot`'s initial delivery bills ≈ result-set size; (3) `loadBundle` works under `persistentSingleTabManager({forceOwnership:true})` inside a dedicated worker and the docs subsequently satisfy `getDocsFromCache`; (4) empirically settle the >30-min re-listen billing question for the record.

### 3.4 Storage/egress budget

| Resource | Free allotment | Design usage |
|---|---|---|
| Storage bytes | 5 GB | ~2 generations × ~60 MB gz ≈ 120 MB + 200 MB mirror |
| Storage download | 1 GB/day | cold boots only: ~55 MB each ⇒ 18/day headroom |
| Storage ops | 20k up / 50k down per day | sweep day ~300 Class-A; builder ~60k Class-B *listing* ops/build if per-object mirror — use the compacted NDJSON-base+delta layout to keep this ~10/build |
| Firestore writes (20k/day free) | tombstones only | rare |

Bundle size sanity: 38k unpublished × ~3 KB ≈ 115 MB raw + ~20% bundle envelope, gzip ~4× ⇒ ~35 MB today, ~55 MB at 60k. Within the prompt's 50–150 MB raw estimate; comfortably inside egress. Note `nlp_search_tokens` stay *in* the bundle (the worker index needs them, mirroring today's raw-Firestore-doc ingestion; A5 stripping still happens at the forward boundary).

---

## 4. Design decisions, stated

1. **Two bundles, not one.** Published (public, tiny, CDN-cacheable — also serves anonymous readers a 0-read boot) and unpublished (authed, big). One combined bundle would force auth onto the public corpus and make reader boots heavier.
2. **Build from a trigger-fed mirror, never from Firestore reads.** The only architecture where a full rebuild is affordable *at all* on this budget — a single full-corpus read exceeds a day's allotment, so any design containing "sometimes we re-read everything server-side" is disqualified from the start.
3. **Delta plane = cursor queries + tombstones, not resumed full-corpus listens.** Removes the single largest billing uncertainty; makes costs O(changes); kills the 8k-redelivery-per-listener-drop problem; simplifies the worker.
4. **Bundles populate the existing persistent worker cache** — they are a *prime source*, third in the decision tree (warm cache → bundle → server fallback). All the loadComplete/trustworthy/errorFallback/reconciliation machinery from 070d7659 keeps its exact meaning.
5. **Published-flip tombstones** (§2.1): a reader's `published==true, updated>W` cursor never sees an *unpublish* of a card whose cached copy predates W — the scope-`published` tombstone covers it. (The privileged editor's unfiltered cursor sees the edit directly.)
6. **Optional hardening**: firestore.rules gains `request.resource.data.updated == request.time` on card create/update — converting the "every write path sets `updated`" convention (currently true, §1) into an enforced invariant the entire delta plane rests on. Check `cardEditMinor`/inbound-reference write paths before enabling.

---

## 5. Failure modes

| Failure | Behavior | Why safe |
|---|---|---|
| Builder broken for a week | Cold boots load week-old bundle; cursor catch-up D grows to ~a week of edits (tens–hundreds of reads) | Degrades in delta size; manifest `builtAt` surfaced in status; build failures email via existing nodemailer path |
| No bundle yet / manifest 404 | Fallback C = today's exact server prime | Pre-migration behavior preserved bit-for-bit |
| Partial/corrupt bundle download | `loadBundle` throws mid-stream; cache holds whatever loaded (harmless upserts); retry once, then fallback; `loadComplete` never sent early | Existing trustworthy gating; bundle load is not "done" until counts match manifest |
| Auth token expiry mid-download | Single-request authorization; retry re-mints token | §2.3 |
| Build races a concurrent edit | `readTime = build start − 5 min` + cursor from `max(updated)` re-delivers anything near the boundary; dedupe eats duplicates | Overlap is safe; gaps are impossible |
| Missed trigger (at-least-once, but paranoia) | Mirror silently stale → builder's `count()` integrity check (60 reads) aborts + alerts; repair = `updated > lastKnownGood` delta read | Bounded, detected within a day |
| Quota outage mid-boot | Identical to the live-validated 2026-07-04 behavior: primed app stays usable, readiness stays false, no reconciliation mass-removal | Machinery unchanged |
| Second worker-mode tab | Loses persistence ownership → memory cache → bundle path, ~D reads | Improves on today's 38k |
| Stale card resurrected from old cache after deletion | Tombstone prime filters every boot; corpus-ID reconciliation as backstop | §2.5 |

---

## 6. Migration

- **M0 (spikes, ~1–2 days)**: the four verify-live items in §3.3 against dev. Any one failing reshapes the design (see disqualifiers).
- **M1 (server, silent)**: deploy `mirrorCardWrite` + tombstones + rules. It starts mirroring *new* writes immediately; no client change.
- **M2 (backfill, zero reads)**: the user's warm worker already holds all 60k raw docs. Add an admin maintenance task (`src/actions/maintenance.ts` pattern): worker serializes its corpus and uploads it as the mirror seed via the Storage SDK (admin-gated path). Alternative if `updateTime` fidelity matters: a 3-day server backfill at ≤20k reads/day with persisted partition cursors. Client-seeded is preferred — it's free and the `updated` field is an acceptable updateTime proxy given the 5-minute readTime margin.
- **M3**: deploy `buildCorpusBundle`; first bundle exists; integrity check green.
- **M4 (client, flagged)**: cold-path B + tombstone prime behind a new `corpus-worker` mode value; warm path untouched. Validate a cleared-site-data boot on dev: expect ~0 reads, loadComplete, reconciliation clean.
- **M5 (flagged)**: cursor listener replaces partition listeners; shadow-style soak (the log's divergence tooling applies directly).
- **M6**: default on; partitions remain as fallback-C code only.

Rollback at every stage is a flag flip; the server pieces are additive.

**Files touched** — client: `src/worker/corpus-worker.ts` (boot tree, bundle load, tombstone/cursor listeners), `src/worker/worker-protocol.ts` (status/manifest fields), `src/corpus-bridge.ts` + `src/corpus-readiness.ts` (manifest-count trustworthiness), `src/corpus-mode.ts` (mode value), `src/actions/maintenance.ts` (seed task), `src/card-partitions.ts` (comment: fallback-only). Server: new `functions/src/bundle.ts`, `functions/src/firestore-rest-proto.ts`, edits to `functions/src/index.ts`, `firestore.rules` (tombstones; optional `updated` enforcement), `storage.rules`, `firestore.indexes.json` (likely none — single-field `updated` and `time` indexes are automatic; the privileged cursor `updated>W` with no other filter is single-field; the reader variant `published==` + `updated>` needs one composite). **Scope estimate**: functions ~700–900 lines incl. serializer tests + emulator round-trip; client ~400 lines net; deploy = functions + two rules files + one composite index; ~1.5–2 weeks including the M0 spikes and soak.

---

## 7. Top 3 risks & disqualifiers

1. **Synthesized-bundle acceptance** (`Firestore.snapshot_` internal API / hand-rolled bundle format vs. JS SDK validation). *Mitigation*: pinned dependency + emulator round-trip test in CI catches drift before deploy. *Disqualifier*: if the SDK hard-rejects non-server-built bundles → Plan C: serve the mirror as a plain gzipped NDJSON corpus file, prime the worker corpus/engine from it directly, and move warm-boot persistence to a worker-owned IndexedDB store — same read math, but abandons the Firestore local cache as the persistence substrate (larger client change, still viable).
2. **Listener/query billing semantics** (the >30-min rule; whether `updated > W` initial deliveries bill result-set-only). *Mitigation*: the design already assumes the pessimistic reading everywhere it can; M0 spike (2) is the one place a nasty surprise (e.g., cursor listeners somehow billing more than their result set) would matter. *Disqualifier*: if even narrow cursor listens bill O(corpus) — no evidence for this anywhere — nothing client-side survives on this budget; the answer would be polling `getDocs(updated > W)` on an interval, which the same architecture supports with a 5-line change.
3. **Storage-on-this-project assumptions** (bucket availability under current Firebase policy, cross-service `firestore.get()` in storage rules, 1 GB/day egress vs. real bundle size). *Mitigation*: bucket already exists and is code-referenced; measure the real gz bundle in M3; function-proxy/signed-URL fallback specced. *Disqualifier*: bundle >~500 MB gz (would imply ~8 KB/card — 2–3× the estimate) squeezing egress *and* worker memory during `loadBundle` on mobile — at which point split the unpublished bundle into the 5 existing partitions as separate files (helpfully also enabling partial-retry), or drop to Plan C's NDJSON with streaming ingest.

The single deepest dependency to respect: **the entire delta plane rests on `updated` being written on every mutation and tombstones on every disappearance.** That's why §4.6's rules enforcement and the builder's 60-read nightly `count()` audit are in the design rather than left as habits.
# Watermark/Delta Sync — Full Design

**Repo grounding**: verified against `implement/fast-corpus` — `src/worker/corpus-worker.ts` (persistent-cache handoff in flight, `WARM_CACHE_THRESHOLD` prime, `attachResilientListener`, `loadComplete`/`expectInitialLoad`), `src/corpus-bridge.ts` (`corpusWorkerCanRunCollections`, `corpusSizeTrustworthy`, `maybeRequestReconciliation`/`handleCorpusIDs` with mass-removal guard), `src/actions/data.ts` (`modifyCardWithBatch` sets `cardUpdateObject.updated = serverTimestamp()` at line 423 — confirmed), `shared/card_write.ts:inboundLinksUpdates`, `firestore.rules`, `firestore.indexes.json`, `src/card-partitions.ts`, `functions/src/*`.

**Two load-bearing discoveries made while reading** (both are prerequisites, see §1):

- **`inboundLinksUpdates` does NOT bump `updated` on the other cards it touches** (`shared/card_write.ts:845-874`, applied at `data.ts:500-503` and in `deleteCard` at `data.ts:1335-1339`). When card A links to card B, B's `references_inbound` changes on the server with B's `updated` untouched. A watermark sync would *never deliver B's new inbound link to another device*. This must be fixed in the write path (and in `firestore.rules:cardEditInboundReferences`, which currently allows *only* `['references_inbound','references_info_inbound']` to change).
- **The in-flight persistent-cache handoff has a latent eviction bug**: `initializeFirestore` in `corpus-worker.ts:403` does not set `cacheSizeBytes`. The default is 40 MB with LRU GC; 60k cards at ~4–8 KB each is 240–480 MB. The SDK would silently evict most of the corpus, the warm prime would come back partial, and the cold path would re-run — under either sync design. Must set `cacheSizeBytes: CACHE_SIZE_UNLIMITED`.

---

## 0. Summary and why watermark beats "just trust resume tokens"

With the persistent-cache handoff, the partitioned listeners already bill ~deltas *when resume tokens work*. The problem is that resume tokens are an **opaque optimization, not a contract**: they are invalidated by partition reshapes (documented in `card-partitions.ts`), cache eviction, long absence (backend may reject old tokens and force a full re-listen), SDK/schema migrations, and the second-tab `forceOwnership` fight (loser falls to memory cache → **no tokens → full 60k listen = 1.2 days of quota, silently**). Each of those failure modes re-bills the *entire result set* of the query — and the query is "all 58.8k unpublished cards."

The watermark design changes the query itself so that its full result set *is* the delta: `where('published','==',false).where('updated','>',W)`. The worst case of every resume-token failure mode becomes "re-read the docs changed since last session" (≈0–50), not "re-read the corpus" (≈60,000). The persistent cache remains the durable corpus store (free `getDocsFromCache` boot); resume tokens become a bonus, not a dependency. Read-billing is bounded **architecturally**, by query shape, which is auditable and testable.

---

## 1. Prerequisite: write-path discipline (`updated` as a sync invariant)

`updated` becomes the sync cursor, so *every* semantically-meaningful card mutation must bump it via `serverTimestamp()`. Audit of writers:

| Writer | Bumps `updated`? | Action |
|---|---|---|
| `modifyCardWithBatch` (`data.ts:423`) | ✅ serverTimestamp | none |
| Publish/section/tag paths (`data.ts:515,530,548,565,1122,1266,1281`), card create (`:657,797,830`) | ✅ | none |
| **Inbound-link updates on other cards** (`data.ts:500-503`, `deleteCard:1335-1339`, via `shared/card_write.ts:845`) | ❌ | **FIX**: add `updated: serverTimestamp()` to each `DottedCardUpdate` in the wrapper `src/card_diff.ts:600` (client sentinel lives client-side; the shared function grows a `timestampSentinel` param alongside `deleteFieldSentinel`). Rules: `cardEditInboundReferences()` gets `'updated'` added to `allKeys` plus `requestData.updated == request.time`. |
| Minor edits by readers: `star_count`, `thread_count`, `updated_message` (rules `cardEditMinor`) | ❌ | **Accept drift.** Counters are cosmetic; readers are rare; the drift heals on the card's next real edit. Do NOT bump `updated` here — that would make every star by a reader redeliver the card to all devices, and the rules changes are invasive. Documented divergence. |
| Cloud Functions: `twitter.ts:208+` (`tweet_count`, `last_tweeted`, engagement star adjustments) | ❌ | Accept drift (same reasoning; feature is vestigial). If ever revived, add `updated: FieldValue.serverTimestamp()` to `markCardTweeted`'s card update. |
| Maintenance tasks (`rerunCardFinishers` etc. → `modifyCardWithBatch`) | ✅ | none, but note: a maintenance sweep over N cards costs N delta reads per *other* device on next boot (same as a tag sweep — see cost table). |

**Pre-migration audit gate**: grep for every `batch.update`/`batch.set`/`updateDoc` against `CARDS_COLLECTION` (client + functions + any import tooling) and classify into the table above. Any writer that sets `updated` from a **client clock** instead of `serverTimestamp()` is a correctness bug under this design and must be fixed first (none found in the audit above; all card writers use sentinels).

---

## 2. Mechanism

### 2.1 Listener topology (answers "do we still need published/unpublished separation?" — yes)

Keep the published/unpublished split; apply the watermark **only where the problem is** (the 58.8k unpublished corpus):

| Audience | Queries | Why |
|---|---|---|
| Everyone (incl. privileged) | `where('published','==',true)` — **unchanged full listen** | Only ~1.2k docs. Worst-case token-loss re-read = 1.2k reads (2.4% of quota), acceptable. Crucially, a full listen delivers `removed` docChanges natively — published-card **deletions and unpublish transitions reach readers with zero extra machinery** (anonymous users can't read a tombstone collection covering unpublished cards without leaking; this sidesteps that entirely). |
| Privileged (`mayViewUnpublished`) | **Delta listener**: `where('published','==',false).where('updated','>', W − MARGIN)` | The watermark core. Replaces the 10 partitioned unpublished listeners in `attachUnpublishedListeners`. |
| Privileged | **Tombstone listener**: `collection('tombstones').where('deleted','>', W_t)` | Deletion channel, §3. |
| Non-privileged signed-in | `author==uid` / `permissions.editCard array-contains uid` full listens — **unchanged** | These sets are inherently small (a non-privileged user authored a handful of cards); watermarking them buys nothing. |

**Rules compatibility**: the delta query constrains `published==false`, so the read rule (`firestore.rules:263`) requires `userMayViewUnpublished()`; for the privileged user this is provable from the permission-doc disjunct without touching `resource.data` — the query is admitted. **New composite index** required in `firestore.indexes.json`: `(published ASC, updated ASC)` on `cards`. (Single-field `updated ASC` already exists in fieldOverrides but doesn't serve the compound query.) Tombstones need only single-field `deleted` (automatic).

**No separate catch-up `getDocs`**: the delta *listener's initial snapshot is the catch-up*. Attaching `onSnapshot(published==false, updated > W−margin)` bills one read per doc in the initial result set — which is exactly the docs changed since last session (≈0–50; minimum 1 read per query). One query does both jobs, and it stays attached as the session's live listener.

### 2.2 Boot sequence (privileged; replaces `connectUnpublishedPrivileged`)

1. **Prime (free)**: `getDocsFromCache` over the cards collection (both published and unpublished, unfiltered — or two filtered reads mirroring today's shape). If cached count ≥ `WARM_CACHE_THRESHOLD` → ingest into corpus/index/engine, `forwardBatch(..., fastDedupe)` exactly as today's warm path.
2. **Derive the watermark**: `W = max(card.updated)` over the primed corpus. Also `W_t` (tombstone cursor) from the sync-meta store (§2.3), floored at `W` if absent.
3. **Attach** the published full listener (unchanged), the **delta listener** at `updated > W − MARGIN`, and the tombstone listener at `deleted > W_t − MARGIN`.
4. Delta initial snapshot arrives → ingest (idempotent overwrite), forward, advance in-memory watermark to max(`updated`) *seen from server-confirmed deliveries*, `markInitialDelivered`.
5. If cached count < threshold → **cold path** (§4). Cache-present-but-tiny and cache-absent are the same branch, exactly as today.

### 2.3 Watermark storage and update discipline (item 1)

**Primary watermark is DERIVED, not stored**: `W = max(updated)` over the corpus actually in hand at boot. This eliminates the entire "watermark ahead of data" corruption class by construction — the cursor cannot claim coverage of docs the corpus doesn't hold, and cache and cursor cannot diverge because the cursor *is a function of* the cache. A crash at any point re-derives a watermark ≤ the true coverage point → re-reads a few docs → idempotent ingestion absorbs them.

**A small sync-meta store is still needed** for state that is not derivable from card docs: new module `src/worker/sync-meta.ts`, a worker-owned IndexedDB database (`corpus-worker-meta`, object store `sync`), keyed by `${projectId}:${uid}:${privileged}`, holding:

```
{ tombstoneCursor: {seconds,nanos},      // max tombstone.deleted processed
  coldLoad: {cursor: {updated, docId}, readsToday: n, day: 'YYYY-MM-DD'} | null,
  lastCountCheck: epochMs,
  processedTombstoneIDs: string[],       // recent, for cache-laundering replay (§3)
  schemaVersion: 1 }
```

(localStorage doesn't exist in workers; Redux/main-thread storage would add cross-thread races; the Firestore cache's internals are opaque.) Writes are debounced (~5s) and **strictly after** the corresponding ingest+forward — persist-late is safe (re-read overlap), persist-early is not.

**Advancement discipline (in-memory, during the session)**:
- Advance only from **listener deliveries**, only to `max(updated)` over docs **actually ingested**, and only from docs without pending writes with real (non-`'estimate'`) server timestamps. (In practice the worker never sees pending writes — commits happen on the main thread's separate Firestore instance — but the guard is cheap and future-proof against in-worker writes.)
- **Never** advance from `ECHO_LOCAL_CARD_MODIFICATIONS` cards: their timestamps are client-materialized sentinels (`applyCardFirebaseUpdate` clientSentinels = local clock). See §7.
- Never advance from wall clock, snapshot read-time, or any non-card source.

**MARGIN = 5 minutes.** Server timestamps are authoritative (assigned at commit by TrueTime), so skew isn't the true threat; the margin is cheap insurance against boundary-equality subtleties (`>` excluding a doc whose `updated` exactly equals W), any estimate-timestamp leakage, and implementation drift. Cost: re-delivery of docs edited in the last 5 minutes of the previous session — typically 0–10 reads — and ingestion is idempotent (`updateLocalState` overwrites; Redux `receiveCards` dedupes on `timestampsEquivalent`, `data.ts:1489-1501`), so overlap is *safe*, merely re-billed.

### 2.4 Live listener growth and rotation (item 2)

The session listener is **fixed at `updated > W_boot − margin`** and its result set grows as cards are edited. This is fine: growth = docs changed this session (typical: single digits; sweep day: hundreds). Docs already in the result set are only re-billed when they change again; snapshot delivery is docChanges-based so per-event cost doesn't scale with set size; memory is trivial.

**Rotation** (detach, re-attach at the current watermark) is cheap by construction — the new query's initial result set is ~empty (≥1 min-charge read) — but pointless in normal use since next boot rotates anyway. Adopt one guard: **rotate if the result set exceeds ~2,000 docs mid-session** (a maintenance sweep in a long-lived tab), purely to bound SDK snapshot bookkeeping. Cost of a rotation: ~1–5 reads.

---

## 3. Deletion detection (item 3)

Options with math at 60k:

| Option | Mechanism | Cost | Verdict |
|---|---|---|---|
| (a) count() comparison | `getCountFromServer` over cards (optionally per ID-partition) vs local corpus size; mismatch ⇒ deeper reconciliation | ceil(60,000/1000) = **60 reads** per full check (partitioned into the 10 `card-partitions.ts` ranges: still 60 total — billing is per index entry scanned) | ✅ as the **safety net**, ≤1×/day |
| (b) Tombstone collection | `deleteCard` writes `tombstones/{cardID}` in the same `MultiBatch` as the delete; devices listen `deleted > cursor` | **~1 read per actual deletion** + 1 min-charge per boot | ✅ **primary channel** |
| (c) Periodic full-ID sweep | No projection queries in the client SDK ⇒ enumerating IDs = reading whole docs | **60,000 reads** — a full quota-day | ❌ never routinely; superseded by count-bisect below |
| (d) Stale-until-next-full-sync | Do nothing; deleted docs linger in cache/corpus indefinitely (nothing ever refreshes them under delta sync) | 0 | ❌ violates "deletions eventually reflected" — under watermark sync "next full sync" never comes |

**Recommendation: (b) tombstones as the primary channel, (a) count() as a bounded safety net, with a count-bisect repair path replacing (c).**

Rationale: the app is single-editor and deletes flow through `deleteCard` (`data.ts:1299`), so tombstones cover ~100% of real deletions atomically (batch = card delete + updates-subcollection deletes + inbound-link cleanups + tombstone set — all-or-nothing). Console/script deletes bypass tombstones; that's what the count net catches.

**Tombstone details**:
- Doc: `tombstones/{cardID}` = `{deleted: serverTimestamp(), by: uid, published: card.published}`.
- Rules: `allow read: if userMayViewUnpublished(); allow create: if userMayEditCard-class permission; allow update, delete: if userIsAdmin()`. Content is just an ID + timestamp; restricting reads to privileged users is fine because **readers don't need tombstones** — published deletions reach them natively as `removed` docChanges on their full published listen (§2.1).
- Worker processing: remove from corpus/index/engine, forward `removedIDs`, then **launder the persistent cache** with one `getDocFromServer(cardID)` (1 read; the "no such document" result overwrites the cached doc, so future boots' `getDocsFromCache` prime stops serving the ghost). Until laundering succeeds, replay protection comes from `processedTombstoneIDs` in sync-meta (re-suppress on prime). Advance `tombstoneCursor` only after ingest+launder.
- **Prune** tombstones older than ~90 days via a tiny scheduled function (or a maintenance task) so the cold "read all tombstones" path stays ≤ tens of docs.
- Deletions of *recently edited* cards additionally surface as `removed` docChanges on the delta listener (the doc was in its result set). Treat delta-listener `removed` events as advisory only — a doc also leaves that result set when `published` flips to `true`, which is NOT a deletion (the published listener re-adds it). Routing all deletion authority through tombstones + published-listener removals keeps the semantics unambiguous; `parseSnapshot`'s removed-handling gets this special case for the delta fetchType.

**Count safety net + count-bisect repair**: at most once per day (gated by `lastCountCheck`), after loadComplete: `getCountFromServer(published==false)` + `getCountFromServer(published==true)` ≈ 59+2 = **61 reads**; compare against corpus. On mismatch (console delete, or eviction-induced local loss): bisect using count() over `documentId()` ranges seeded from `UNPUBLISHED_CARD_PARTITIONS` — level 0 costs 60 reads total; descend only into mismatched ranges (a 6k range costs 6 reads/level, halving each level); at range ≤ ~100 docs, read the range (`getDocsFromServer`, ~100 reads) and diff IDs locally, then remove/launder. **Total to pinpoint a handful of console deletions: ~200–500 reads** — vs 60,000 for a sweep. Local excess (server > local, i.e. we're *missing* docs — eviction damage) repairs the same way with the same math.

---

## 4. Cold boot / new device / cleared cache (item 4)

There is no free lunch: the client SDK reads whole docs, so first fill = 60k reads *somewhere*. Cold boots are rare (~yearly per device), so optimize for "usable fast, complete soon, quota never exceeded" rather than for total cost.

**Recommendation (v1): resumable, budgeted, priority-ordered server load.**

1. **Priority phase** (~6k reads): published cards (1.2k, via the published listener's natural initial delivery) + top ~5k unpublished ordered `updated DESC` via one paginated `getDocsFromServer`. The app is *usable* within a minute or two — freshest cards first, matching actual usage of a knowledge garden.
2. **Systematic sweep**: paginate `where('published','==',false).orderBy('updated','ASC').orderBy(documentId())` with a persisted cursor `(updated, docId)` in sync-meta, batches of ~500. **Ascending `updated` order makes mid-load edits safe**: an edit moves a doc *forward past the cursor*, so it's re-encountered (duplicate, idempotent) rather than missed; the priority-phase docs get re-read at the tail (+5k, accepted). Descending order would be a correctness bug (edits teleport docs behind the cursor).
3. **Budget guard**: the worker counts billed reads per (Pacific-midnight) day in sync-meta; at ~42k it *pauses* the sweep — leaving ~8k headroom for routine use — persists the cursor, and resumes after quota reset (timer or next boot). The app runs in explicit **partial-corpus mode** meanwhile: readiness gating already handles this (`corpusSizeTrustworthy` fails against a full-Redux comparison; on a truly new device Redux is equally partial, so serving proceeds over the partial set with the existing `loadComplete`-withheld degraded behavior — same UX class as today's outage mode, which was validated live per the log).
4. On sweep completion: watermark derives from the corpus; deletions-during-load are caught by the post-load count check (§3).

**Math**: 60k + ~5k re-read ≈ 65k reads → **day 1: ~42k (usable after ~6k, within minutes), day 2: ~23k**. Complete in ≤ 36 hours, never exceeding quota, ~once/year/device.

**Alternative for later (v2): server-built snapshot.** A scheduled function cannot cheaply build a Firestore *bundle* (rebuilding one means re-reading 60k docs per build — 60k server-side reads count against the same quota; weekly builds average 8.6k/day, unacceptable). The viable variant is a **GCS-hosted JSON corpus snapshot maintained incrementally**: the function keeps its own watermark, reads only the daily delta (~10–50 reads/day server-side), patches the snapshot object, and the worker ingests it directly into corpus + its own store on cold boot (0 Firestore reads; ~10–20 MB gzipped download), then delta-listens from the snapshot's embedded watermark. This requires access-controlled storage for unpublished content (signed URL from a callable, or Storage rules) and moves corpus durability out of the Firestore cache — a bigger architectural step. **Not needed for v1** given yearly cold boots; it becomes attractive if cache eviction (§9) proves common in practice.

Also budget-relevant: `functions/src/idf.ts:48` and `functions/src/common.ts:234` do full `collection('cards').get()` — **one invocation of either burns 60k of the same daily quota**. Flag them; at minimum they must never run on a schedule.

---

## 5. Adapting the existing guards (item 5)

- **`loadComplete`** (worker, `expectInitialLoad`/`markInitialDelivered`): expected fetch-type set for privileged becomes `{published, unpublished-delta, tombstones}`. `unpublished-delta` is marked delivered when (prime ≥ threshold AND delta initial snapshot arrived) or (cold sweep finished) or terminal error. Semantics shift from "I have read the corpus from the network" to "**the corpus in hand + the delta channel = complete coverage**". `loadComplete` still carries `corpusSize`; error batches still carry `errorFallback` and still don't count (the 67675d47 hardening carries over unchanged).
- **`corpusSizeTrustworthy`** (`src/corpus-readiness.ts`): formula unchanged (worker corpusSize vs Redux count, max(50, 10%) tolerance). What changes is the dominant input: corpusSize is now prime-derived. One **new state**: `stale-serving` — prime succeeded (trustworthy corpus) but the delta listener is erroring (quota/outage). The bridge should serve collections (a complete-but-hours-stale corpus is strictly better than blanking — and strictly better than today, where a quota outage in memory-cache mode means *no* corpus) while surfacing staleness (new `syncState: 'live' | 'stale'` field on worker status messages; the existing `attachResilientListener` backoff keeps retrying).
- **Reconciliation** (`maybeRequestReconciliation` → `handleCorpusIDs` in the bridge): unchanged mechanism and mass-removal guard; still once per generation, still gated on loadComplete + trustworthy. It gains importance: it's what scrubs Redux of cards the *prime* served but tombstones have since removed. The **server-side** complement is the count check + count-bisect (§3), which scrubs the worker corpus/cache against server truth.
- **Quota exhaustion mid-X**: mid-prime — impossible (prime is local/free). Mid-delta-catch-up — listener errors, `errorFallback` batch clears loading indicators, backoff retries, app serves stale-but-complete (see above). Mid-cold-sweep — cursor persists, budget guard pauses, partial-corpus degraded mode, resume next day. Mid-count-bisect — abandon, retry next day (it's advisory). Nothing mass-removes on quota errors: reconciliation requires trustworthy, and the guard skips large stale sets — both already validated live under a real outage per the log.

---

## 6. Multi-device write skew — no-gap argument (item 6)

Claim: a device that (i) advances its watermark only to `max(updated)` over docs it actually ingested from server snapshots and (ii) keeps the delta listener attached for the whole session, **cannot permanently miss a write**.

- Firestore commit timestamps are externally consistent (Spanner/TrueTime): if write w2 begins after w1 commits, ts(w2) > ts(w1). `serverTimestamp()` resolves to the commit timestamp.
- Every Listen delivery is a **consistent snapshot** at some read time T: it contains *every* doc matching the query with commit time ≤ T.
- Suppose device B's persisted coverage is W_B = `updated` of some doc B ingested, delivered in a snapshot at read time T_B ≥ W_B. Consider a write from device A with commit time T_A producing `updated = T_A`.
  - **T_A ≤ T_B and T_A > B's query bound**: the doc was in B's snapshot (consistency) → B has it.
  - **T_A ≤ B's query bound (old value)**: covered inductively by the session that established that bound.
  - **T_A > T_B, B still running**: the live listener delivers it (it matches `updated > bound`).
  - **T_A > T_B, B already shut down**: could B's *next-boot* watermark W' exceed T_A without B having seen A's doc? W' = max(`updated`) over docs B ingested. For W' ≥ T_A, B must have ingested some doc C with ts(C) ≥ T_A, from a snapshot at T ≥ ts(C) ≥ T_A. That snapshot, being consistent and covering the same query, would have contained A's doc (committed at T_A ≤ T, matching `published==false, updated > bound`). Contradiction. **The "watermark advanced past an unseen write" scenario is impossible** as long as the watermark only advances to values *resident in the corpus*.
- **A offline-queues a write**: `serverTimestamp` resolves at *commit* (when A reconnects), so it lands *ahead* of every device's watermark, not behind. ✓
- Residual holes are exactly the write-discipline exceptions of §1 (non-bumping writers), not ordering: hence §1 is a prerequisite, and the 5-minute margin plus idempotent ingestion cover any implementation-level boundary sloppiness.

One caveat to encode in code review: the proof requires the watermark bound used at attach to be ≤ true coverage. Deriving W from corpus max (§2.3) guarantees this; any future "optimization" that advances W from clock or read-time breaks the proof.

## 7. Optimistic-echo interplay (item 7)

Flow today (d7ccf9d0/strictly-superior pass): commit → `ECHO_LOCAL_CARD_MODIFICATIONS` applies materialized cards to worker corpus + Redux instantly; server echo arrives later and dedupes. Under watermark sync:

- The committed doc has `updated = commit time > W_boot`, so the **delta listener delivers the echo'd card** — by design (that's also how *other* devices get it).
- Idempotence: worker `updateLocalState` overwrites by ID (the `nlp_search_tokens`-preservation special case in the `action` handler is unaffected); Redux `receiveCards` fastDedupe compares `timestampsEquivalent` — the optimistic card carries a client-materialized `updated`, the server doc the real one, so dedupe falls through to the normal apply path, exactly as today. Rollback-on-failure is untouched (a failed commit produces no server doc, so no listener delivery).
- **Watermark hygiene**: the echo must not advance the watermark (client-clock timestamps; a fast client clock could push W past genuinely-later server commits). Rule in §2.3 covers this: advance only from listener deliveries. The subsequent *server* delivery of the same card advances W legitimately.
- Billing: each committed write is re-delivered ≈ 1 read; an edit touching inbound links on k cards bills ~1+k (those cards now bump `updated` per §1). Ten edits/day ≈ 10–30 reads. Acceptable and unavoidable — it's the same read every other device pays.

## 8. Migration (item 8)

Staged behind a new localStorage flag `corpus-sync: 'listen' | 'watermark'` (orthogonal to `corpus-worker` mode; same rollout philosophy as shadow → on):

1. **Land prerequisites first, independently deployable and design-neutral**: inbound-link `updated` bumps + rules change; `deleteCard` tombstone write + tombstones rules; `(published, updated)` composite index; `cacheSizeBytes: CACHE_SIZE_UNLIMITED` (this one fixes a live bug in the current handoff regardless). Backfill: none needed — tombstones start empty (pre-existing deletions are already absent from server; the count net covers any cache ghosts), and old cards' `updated` values are already server timestamps.
2. **Worker changes** (`corpus-worker.ts`): replace `connectUnpublishedPrivileged`'s server-prime phase and `attachUnpublishedListeners`'s 10 partition listeners with the §2.2 sequence; add `src/worker/sync-meta.ts`; add tombstone listener + cache laundering; add count check + count-bisect; cold-path sweep with budget/cursor. `card-partitions.ts` survives as the count-bisect range seed and cold-sweep fallback partitioning. `attachResilientListener`, generation guards, `expectInitialLoad` all reused as-is with the new fetch-type set.
3. **Shadow validation**: in `corpus-sync:'watermark'` + `corpus-worker:'shadow'`, run the count check every boot and compare corpus size vs the old path's expectations; watch `[corpus-shadow]` divergence exactly as B2/B3 did. Also assert watermark-derived catch-up sizes look sane (log `delta initial: N docs`).
4. **Existing resume tokens**: simply stop being used — the old partition queries are never re-issued; their target metadata in IndexedDB is inert and eventually GC'd by the SDK. No migration cost. The cached *documents* are the same documents; the prime reads them regardless of which query originally fetched them.
5. **First boot after upgrade**: warm cache → prime (free) + delta ≈ **1–50 reads**. Cold/partial cache (e.g. the quota-outage-emptied cache noted in the log) → cold path (§4), same as a new device. Rollback: flip flag back; the partitioned listeners re-attach; their old resume tokens may or may not survive — worst case one full re-listen, which is exactly today's accepted behavior.

## 9. Failure modes (item 9)

| Failure | Detection | Behavior | Recovery | Worst-case reads |
|---|---|---|---|---|
| Quota exhausted mid-catch-up | listener error (`resource-exhausted`) | Serve stale-but-complete corpus (`stale-serving`); readiness for serving stays green if prime was trustworthy; no reconciliation, no removals | `attachResilientListener` backoff 5s→60s; heals at quota reset | 0 extra |
| Quota exhausted mid-cold-sweep | budget counter / errors | Partial-corpus degraded mode (readiness withheld, existing guards) | cursor persisted; resume after Pacific-midnight reset | bounded by budget (~42k/day) |
| Delta listener dies (backend blip) | error callback | empty `errorFallback` batch (doesn't count as evidence); retry/backoff — existing machinery | re-attach at in-memory watermark; initial result = missed delta only | ~missed delta (≈0–10) — vs ~8k/partition today |
| Clock skew (client) | n/a | none — all sync timestamps are server-assigned; client clock only feeds TTLs/debounce; echo excluded from watermark | n/a | 0 |
| Watermark "corruption" | can't happen ahead-of-data (derived); sync-meta cross-check warns if persisted > derived+margin | derived value wins (≤ coverage ⇒ safe) | over-old watermark just re-reads more | delta since actual coverage |
| Tombstone cursor lost (meta DB wiped) | missing key | re-read all tombstones from epoch | tombstones pruned at ~90 days ⇒ tens of docs | ~10–100 |
| IndexedDB eviction (cache lost, full or partial) | prime < threshold → cold path; partial loss → daily count check finds server > local | full: cold path §4; partial: count-bisect repairs missing ranges | `navigator.storage.persist()` requested from main thread reduces likelihood | full: 65k over 2 days; partial: ~200–500 + missing docs |
| Console/script delete (no tombstone) | daily count mismatch | ghost lingers ≤ ~1 day in corpus and cache | count-bisect → remove + `getDocFromServer` launder | ~200–500 |
| Second tab steals `forceOwnership` | first tab's cache ops fail / Web Lock lost | see §10 row; loser must **never** run the cold path | Web Lock `corpus-worker-owner` gates cold-load + delta ownership | see §10 |
| Firestore cache internally corrupt / SDK schema migration clears it | prime tiny → cold path | same as eviction | same | 65k over 2 days |

## 10. Read-cost table (item 10) — privileged owner, 60k corpus, per device

| Scenario | Reads | Breakdown |
|---|---|---|
| Typical day: open 3×, edit 10 cards | **~40–100** (≤160 with daily count check) | per boot: prime 0 + delta attach ~1–10 + tombstone query 1 (min-charge) + published listen ~0 (resume token; worst 1.2k on token loss); live echo deliveries ~10–30 (incl. inbound-link bumps); count check +61 once/day |
| Monthly sweep day (300 old cards tagged) | **~300–900 editing device; ~300 per other device** (next boot's delta) | one read per write per device; multi-edit-tag = few writes/card; mid-session listener grows to 300 docs (rotation not triggered) |
| Deletion day (~5 deletes) | **~15–40** | deleting device: writes only; others: 5 tombstone reads + 5 launder gets + inbound-link-bumped cards ~2–10 |
| Cold new device | **~65k total: day 1 ~42k (usable after ~6k ≈ minutes), day 2 ~23k** | §4; ~yearly; never exceeds daily quota; count check + reconciliation after completion |
| Second simultaneous tab | **v1: ≤1.2k** (published-only degraded, banner; unpublished served read-only from Redux-primed state if main-thread cache prime ran) | loser of the Web Lock must not delta-listen or cold-load; v2: SharedWorker (one corpus, one quota footprint, kills the log's "multi-tab quota multiplication" regret for good) |
| Quota-outage day | 0 extra | stale-serving mode; strictly better than today's memory-cache behavior |

Routine total ≈ **60–160 reads/day** vs the declared-unacceptable ~40k/boot: three orders of magnitude, comfortably inside "a few hundred."

## 11. Top 3 risks — and what would disqualify the design

1. **`updated` as a global write invariant.** Every current and *future* card writer must bump it or changes silently never propagate to other devices (found live: inbound links; accepted: star/thread/tweet counters). Mitigations: §1 fixes, a security-rules-level backstop is impossible for all paths, so add a lint/test that greps card-write sites, plus the daily count check (catches deletions/losses but **not** silent mutations). **Disqualifier**: if non-bumping mutation paths matter to the product (e.g., reader-driven counters must be fresh across devices) or an external tool writes cards with client timestamps — then only full listens or a server-authored change-log give correctness.
2. **Persistent-cache durability is now the corpus's cold-path insurance.** Eviction ⇒ a 2-day, 65k-read rebuild. Safari-style aggressive origin eviction, profile cleaners, or `CACHE_SIZE_UNLIMITED` being ignored would make cold paths frequent instead of yearly. Mitigations: `navigator.storage.persist()`, the partial-loss count-bisect repair, and the GCS-snapshot v2 escape hatch (drops cold cost to ~0 Firestore reads). **Disqualifier**: measured eviction more than ~monthly on the owner's real devices — at that point build the snapshot pipeline *first*, or accept Blaze (60k reads = **$0.036**; the free-tier ceiling is a chosen constraint, worth restating).
3. **Consistency-model dependence.** The no-gap proof (§6) leans on Firestore Listen snapshot consistency + externally-consistent commit timestamps — true today, documented behavior, but subtle: one wrong "optimization" (advancing W from read-time, trusting estimate timestamps, rotating to a bound not derived from ingested data) reintroduces silent gaps that no guard catches until the next count check... which doesn't detect mutations at all. Mitigations: derived-watermark rule enforced in one function with tests; margin overlap; a periodic (weekly) deep-audit option — count-bisect extended with a `updated`-range checksum is *not* possible client-side, so the honest backstop is a rare full re-read (accept 60k once a quarter if paranoia demands, or the v2 snapshot which gives a server-side truth set for free). **Disqualifier**: if silent divergence of any single card is intolerable and unverifiable-by-design — a product that needs provable convergence should pay for a server-maintained change-log/snapshot rather than client-inferred deltas.

## 12. Concrete change list

| File | Change |
|---|---|
| `shared/card_write.ts` (`inboundLinksUpdates`) + `src/card_diff.ts:600` wrapper | add `updated` server-timestamp sentinel to other-card updates |
| `firestore.rules` | `cardEditInboundReferences`: allow + require `updated == request.time`; new `match /tombstones/{card}` block |
| `firestore.indexes.json` | composite `(published ASC, updated ASC)` on `cards` |
| `src/actions/data.ts` (`deleteCard:1299`) | `batch.set(tombstoneRef, {deleted: serverTimestamp(), by, published})` |
| `src/worker/corpus-worker.ts` | `cacheSizeBytes: CACHE_SIZE_UNLIMITED`; replace `connectUnpublishedPrivileged` server-prime + `attachUnpublishedListeners` with delta boot (§2.2); tombstone listener + launder; count check + count-bisect; cold sweep w/ budget+cursor; delta-`removed` special-casing in `parseSnapshot`; watermark module |
| `src/worker/sync-meta.ts` (new) | worker IndexedDB meta store (§2.3) |
| `src/worker/worker-protocol.ts` | `syncState` on status; cold-progress message |
| `src/corpus-bridge.ts` | surface `stale-serving`; reconciliation trigger unchanged |
| `src/corpus-mode.ts` | `corpus-sync` flag helpers |
| `src/card-partitions.ts` | reused for count-bisect seeds + cold fallback |
| `functions/` (optional) | tombstone pruning schedule; flag `idf.ts:48`/`common.ts:234` full-corpus reads |
| tests | watermark derivation/advancement unit suite; tombstone flow; count-bisect math; cold-cursor resumability (mirroring `test:worker-retry` style) |
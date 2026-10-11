# 03 — Worker and main-thread update path (slices 3, 4, 7)

Status: DETAIL for `docs/lean-mutation-architecture.md` §4.4. Baseline
`master` 8f56ea89 (also the parked branch's merge base, so every branch
commit cited here is a diff against exactly this master).

Every claim is tagged **VERIFIED** (read in code, or executed) or
**UNVERIFIED**. Benchmarks ran in Node 20.20.0 on a 47,000-card corpus from
`test/perf-harness/gen-corpus.js --count 47000 --seed 1`, against compiled
`lib/` copied into scratch from master and the branch. Machine load average
was 16–19 throughout (ffmpeg). Read only ratios; absolute numbers are inflated.
Node is a proxy for the browser. Slice 0's journey is the gate.

## 0. Measurements behind this design

| Measurement (47k, median of 3–5 runs) | master | branch | ported set (§1) |
|---|---|---|---|
| Reducer prime, empty filters (worker) | 1538–1825 ms | 2691 ms (1.7×) | 1317–1507 ms (0.85×) |
| Prime when a listener batch raced ahead (100 cards already present) | 3713 ms | — | 4090 ms (1.10×) |
| `UPDATE_CARDS`, one new card (runs **twice**: main + worker) | 338–391 ms | 1.4 ms | 1.2–2.2 ms |
| Body save that flips `has-content` | 49–60 ms | 0.95 ms | 0.7–1.4 ms |
| 47k `membershipHas` on a 47k-member filter | 5–8 ms (`obj[id]`) | 16 ms | 17–25 ms |
| Main-thread import of the prime projection | 0 (plain maps installed) | 991 ms (`cardDerivedMembershipsFromFilterMaps`) | 105 ms (bitset handoff, §1.4) |
| Structured clone of the prime projection on the wire | 951 ms (78 plain maps) | same | 5 ms (ids + bitsets) |

Filter identity churn (master reducer, VERIFIED): a new working-notes card
changes 18 of 83 filter maps. The first body text changes 2. Later body edits
change 0.

Persistence proxy (Node `structuredClone`, VERIFIED as a proxy only): one
47k-card record took 4582/4676 ms; 47k per-card records took 4666/4699 ms
(1.0×). Rebuilding the id map from the array took 16–22 ms. Ten dirty cards
took 1 ms. Chromium's IndexedDB per-record overhead (LevelDB entries, key
encoding) is not modelled and is **UNVERIFIED**.

Corrections to the brief:

- The snapshot DB is IndexedDB **version 1**, store `snapshots`, and the record
  is already `schemaVersion: 2` (`corpus-snapshot.ts:31-34,56-58`). VERIFIED.
- The branch's prime regression has a second cause: the main thread converts
  the worker's 78 plain maps with `cardDerivedMembershipsFromFilterMaps`
  (`flatMap` over 1.5M ids, then an AVL path-copy insert per id). That costs
  ~1 s at 47k (VERIFIED, bench) and fits the 371→737 ms regression.
- `membershipHas` is ~8× slower than a plain lookup (9.5 vs 1.2 ms per 47k,
  unloaded micro-run). It is paid inside every `runCollection` filter test.
  The branch never measured this. §1.5 fixes it.

## 1. Slice 3 — membership bitsets + incremental selectors

### 1.1 Include set

| Branch commit | Files / hunks | Applies to master |
|---|---|---|
| `85b4297c` | `src/incremental-selectors.ts` (weak pair cache `sharedDiffCards`), `src/selectors.ts` (3 call sites) | clean (VERIFIED, `git apply`) |
| `2d5e20dc` | `src/incremental-selectors.ts` (`mergeCardsWithKnownDelta`, `removeCardsWithKnownDelta`), `src/reducers/data.ts` (UPDATE_CARDS merge, `removeCardIDs`) | clean |
| `2c86553a` | `src/reducers/data.ts` (slug ownership not copied on echo) | clean |
| `38fd5f99` | `shared/filter_membership.ts` (new), `shared/types.ts` (`FilterMembership`, `FilterMaps`), `src/types.ts`, `src/actions.ts` and `src/worker/worker-protocol.ts` (`cardFilters?: FilterMaps`), `src/actions/data.ts` + new `src/card-filter-domain.ts`, consumers in `src/collection_description.ts`, `src/filters.ts`, `src/selectors.ts:2816`, `src/components/card-badges.ts`, `src/worker/corpus-worker.ts` (`materializeCardFiltersForWire`), `tools/check-filter-membership.cjs`, `test/filter-membership/*`, `docs/FILTER-MEMBERSHIP.md`, the `test:filter-membership` script | two rejected hunks: `src/filters.ts` expand-filter one-liner (semantic-preparation context) and `src/reducers/collection.ts` (§1.4). `test/reducers/test.js` needs a hand merge. Everything else applies with offsets (VERIFIED) |
| `60a2429a` | `src/reducers/collection.ts` (own-key star/read), `src/util.ts` (`setUnion` defines `__proto__`) | clean |

**Completeness check (VERIFIED by execution).** I applied the five commits to a
scratch export of master and ran the branch's type-aware guard
`tools/check-filter-membership.cjs`. It flags exactly the two rejected-hunk
sites (`filters.ts:822`, `collection.ts` `makeFilterFromCards`) and nothing
else. Master has no further consumer that would silently read an opaque
membership as `{}`.

**Protocol-import grep (VERIFIED).** No added line in the included hunks
imports `mutations/`, `viewer_reference_graph`, `semantic-preparation`,
`working-notes-title`, `worker-collection-result` or `compact-semantic`.
`shared/filter_membership.ts` has no imports at all.

### 1.2 Exclude set

- `38fd5f99`'s `shared/mutations/*manifest*`, `test/incremental-selectors/viewer-graph.browser.js`
  and `test/query-engine/viewer-reference-consumers.test.js` (viewer graph).
- `src/reducers/collection.ts` hunks from `12828d24` (`admitWorkerCollectionResult`,
  `UPDATE_WORKER_COLLECTION_AVAILABILITY`) and from `6dfe25ef` (predicate-map
  freezing and dedupe, which memberships supersede). Also `6dfe25ef`'s
  `corpus-bridge.ts` freeze.
- Everything in `query-engine.ts`'s branch diff. The worker gets the membership
  win by replaying the same reducer (`query-engine.ts:288`), so `query-engine.ts`
  needs no port. Its 360-line branch diff is ViewerReferenceGraph,
  semantic-owner and working-notes-title code.
- `src/reducers/data.ts` `fcf3028a` (that is slice 1 admission), plus all
  semantic-preparation, `idf-transfer`, `recall-card` and
  `delta-listener-rotation`.

### 1.3 Reducer shape

The branch reducer is ported with the fast path restored:

```ts
// src/reducers/collection.ts
const makeFilterFromCards = (cards, prev) => {
  const vals = Object.values(cards);
  if (vals.length >= 1000 && cardFilterNames.every(n => membershipSize(prev[n] ?? {}) === 0)) {
    // master's card-major predicate pass, into bitsets over vals' index
    const words = filterFuncs.map(() => new Uint32Array(Math.ceil(vals.length / 32)));
    for (let c = 0; c < vals.length; c++) for (let f = 0; f < filterFuncs.length; f++)
      if (filterFuncs[f](vals[c])) words[f][c >>> 5] |= 1 << (c & 31);
    return zipNames(cardDerivedMembershipsFromPrime(vals.map(c => c.id), words));
  }
  // branch incremental path unchanged: one updateCardDerivedMembershipGroup
};
```

### 1.4 Keeping boot fast (both threads)

1. **Worker: a bulk builder in `filter_membership.ts`.** Add
   `cardDerivedMembershipsFromPrime(ids, words)`, about 45 lines. The ordinal is
   the index in `ids`, so the build does no index lookups. The AVL index is
   built balanced from the sorted `(id, ordinal)` pairs, with no path copying.
   Equal bitsets share one membership. I prototyped it in scratch; it produces
   the same membership fingerprint as master and the branch (VERIFIED).
2. **Main thread: bitset handoff in the prime batch.** The worker exports
   `primeBits = {ids, names, words}` instead of 78 plain maps. It does this
   only when every card-derived membership in the group is still exactly as the
   bulk builder made it (a module-private `WeakSet`). In that state, ordinal
   order equals insertion order, so `membershipKeys` order is preserved exactly.
   Otherwise, for example when a listener batch raced the prime, the worker
   falls back to today's `materializeCardFiltersForWire` plain maps and the
   generic import. The main thread installs the bits with the same bulk builder.
   This cost 5 ms on the wire plus 105 ms to build, versus ~951 ms just to clone
   the plain maps. That is a net boot **improvement** over master. It is
   UNVERIFIED in the browser.

   `cardFilterDomainMatches` (`src/card-filter-domain.ts`) still guards
   installation against `cardFilterCorpusIDs`. The extra protocol surface is
   one optional `CardBatch` field.
3. **Raced prime.** When `prev` is non-empty, the ported reducer is 1.10× master
   (VERIFIED, bench). That is inside the gate. If the journey shows it
   mattering, the fix is a bulk `extendDomain` for large additions. Not in scope.

### 1.5 Lookup cost: lineage-tip index (in scope)

Each domain lineage shares one `Map<string, ordinal>`. Lookup is
`o = map.get(id); o !== undefined && o < domain.size ? o : undefined`.

`extendDomain` appends to the shared map only when
`prior.size === map.size`, which means `prior` is the lineage tip. Otherwise it
copies the map, O(N), and only in the rare case where a held snapshot is
extended. Ordinals are append-only, so older domains never see later ids. The
map is reachable only through memberships, so the no-global-cache invariant
holds. Measured Map+bitset lookup is 1.32 vs 1.17 ms (plain object) vs 9.5 ms
(AVL) per 47k (VERIFIED). The AVL tree can then be deleted. The map replaces it
as the exact index, and order-compaction and domain-reclamation rebuild it.

### 1.6 Tests and gates (slice 3)

| Test | Vacuity proof |
|---|---|
| Port `test/filter-membership/*` (19 cases) and the guard script | Already source-negative on the branch; rerun the stash-revert on the port |
| New: `cardDerivedMembershipsFromPrime` vs `cardDerivedMembershipsFromFilterMaps` on a 6,500-card fixture with special ids (`__proto__`, numeric, long): same `membershipKeys` order, same `membershipHas` for every id | Swap the builder for one that drops numeric ordering → fails |
| New reducer test: a prime ≥1000 cards into empty filters takes the bulk path (assert `perfCount('makeFilterFromCards:primeBulk')`), and the result equals the incremental path over the same cards | Delete the fast-path branch → counter assertion fails |
| New: worker→main prime with `primeBits` installs memberships equal to a plain-map install. A raced prime falls back to plain maps | Force `primeBits` on a raced group → order assertion fails |
| `known-delta` / `shared-delta` tests from `2d5e20dc` / `85b4297c` (Node variants) | Already proven on the branch; reprove |
| **Perf gate (Node, CI-safe):** a ratio test in `test/perf-harness/` at 12k cards: new-card `UPDATE_CARDS` ≤ 0.1× master's algorithm (inlined copy), prime ≤ 1.1× | Revert the reducer → the new-card ratio fails |

Journey (slice 0) for slice 3: worker CPU per Save→New cycle falls by ≥2 ×
`makeFilterFromCards` (main + worker). Main-thread long tasks on the echo fall.
Warm boot (`watermark prime ... workerState=` and the main `receiveCards`
dispatch) ≤ 1.1× master. Subscription flush ms is not worse (this guards the
§1.5 lookup).

## 2. Slice 4 — incremental snapshot persistence

### 2.1 Schema (IndexedDB `corpus-worker-snapshot`, version 1 → 2)

`onupgradeneeded` deletes `snapshots` and creates two stores:

| Store | Key | Value |
|---|---|---|
| `cards` | `[scopeKey, cardID]` (out-of-line array key) | the `toWire(card)` record (carries `id`) |
| `meta` | `scopeKey` | `{schemaVersion: 3, cardCount, savedAt, clientClockCardIDs, processedTombstoneIDs, tombstoneCursor, watermarkClamp, sections, tags}` |
| `meta` | `` `${scopeKey}:owner` `` | `{ownerID, epoch}` (unchanged semantics) |

`scopeKey` is today's `corpusSnapshotKey(...)` string, so the privacy pairing
with `snapshotEligibleCard` is untouched.

I chose an **array key** over a prefix string:

- `IDBKeyRange.bound([scope], [scope, []])` is exactly one scope, because arrays
  sort after strings.
- No delimiter can collide with a card id, so there is no escaping rule to get
  wrong.
- Range delete (sign-out / `clear()`) is one call.

Meta and owner share a store so the save transaction spans only
`['cards', 'meta']`.

### 2.2 Dirty tracking

```ts
const dirtyCardIDs = new Set<CardID>(); let metaDirty = false;
// updateLocalState (corpus-worker.ts:898): for each changed or removed id → dirtyCardIDs.add(id)
// clientClockCardIDs / syncMetaState / latestSections / latestTags writers → metaDirty = true
```

Rules:

- `corpusMutationVersion` and its comment go away.
- After a v3 prime, add every snapshot id that did **not** enter the corpus.
  These are tombstoned ids, ids dropped by `authoritativePublishedIDs`, and ids
  the listener already superseded. This is one O(N) pass at boot.
- Reconnect or account switch resets the set along with the store.
- Disabled persistence stops tracking.

### 2.3 Save: one transaction, no walk, no abandon

```ts
const flush = async () => {
  // SYNCHRONOUS capture: one coherent instant, before any await
  const ids = [...dirtyCardIDs]; dirtyCardIDs.clear(); metaDirty = false;
  const puts = [], dels = [];
  for (const id of ids) {
    const card = corpus.get(id);
    if (card && snapshotEligibleCard(card, scope)) puts.push(toWire(card, isTimestamp, getTime));
    else dels.push(id);
  }
  const meta = captureMeta(corpusEligibleCount);   // cursors, clamp, clientClock∩corpus, sections, tags
  try { await store.writeDelta(puts, dels, meta); failures = 0; }   // one readwrite txn
  catch (e) { for (const id of ids) dirtyCardIDs.add(id); metaDirty = true; onFailure(e); }
};
// store.writeDelta: txn(['cards','meta']) → get owner → mismatch ? abort
//   : puts.forEach(v => cards.put(v, [scope, v.id])); dels.forEach(id => cards.delete([scope, id])); meta.put(meta, scope)
```

- **Coherence.** Card values and safety bounds come from one synchronous instant.
  IndexedDB commits all of them or none. This removes the mixed-record hazard
  that `MAX_SNAPSHOT_ABANDONS` and the branch's `:coherent-v1` key worked
  around. On disk, each stored card is either the image at some flush instant
  or a later one. The meta cursors are from the newest flush. A card that
  changed after that flush is in the next flush's dirty set, so the watermark
  derived on the next boot can never be newer than a stored card's missing
  update (VERIFIED by reasoning; covered by a test below).
- **Deletes and tombstones.** A removed id, or one no longer eligible (an
  unpublished card in the shared published scope), becomes `delete`.
  `processedTombstoneIDs` lives in meta.
- **Debounce kept.** `SNAPSHOT_SAVE_DELAY_MS` 15 s and the 90 s max wait stay.
  In-flight plus pending stays, without the abandon branch.
- **Failure.** Captured ids go back into the set (a union, so a newer mutation
  is never lost). `MAX_SNAPSHOT_SAVE_FAILURES` stays 3. On the third,
  `disableCorpusSnapshotPersistence()` runs with today's non-blocking
  `degraded(...)` copy. An owner-mismatch abort counts as a failure, and the
  1 s epoch guard stops the worker anyway.

### 2.4 Full rewrite (cold boot, invalid store)

`storeBaseline` is `'v3'` after a validated v3 prime, else `'none'`. The first
flush after persistence is enabled (`corpus-worker.ts:1386, 2017`), when the
baseline is `'none'`:

1. Clear `dirtyCardIDs`.
2. Walk `corpus` in 12 ms slices and `toWire` each eligible card into an array.
   This is today's walk, once per cold boot.
3. Synchronously re-`toWire` every id that entered `dirtyCardIDs` during the
   walk, then capture meta.
4. Write one transaction: range `delete`, then all `put`s, then meta.

Step 3 makes the record coherent without abandoning. A full rewrite never
recurs in steady state.

### 2.5 Boot

One `readonly` transaction over `['cards','meta']` issues
`cards.getAll(range)` and `meta.get(scopeKey)`. One transaction gives a
consistent read. `validCorpusSnapshot` becomes `validCorpusSnapshotV3(meta,
records)`:

- meta has `schemaVersion === 3` and today's field checks;
- every record is a non-array object with a string `id`;
- the ids are unique;
- `records.length === meta.cardCount`.

Any failure means "no snapshot" plus a scheduled range clear. Today's
all-or-nothing behaviour is kept. Then the cards map is built (16–22 ms proxy),
followed by today's `fromWire` and `updateLocalState(primed, [], true)`. The
ownership revalidate-then-poll ordering (`corpus-worker.ts:2878-2899`) is kept.
Its reason, not polling during the big read, still applies.

**Cost vs today's single `get`.** The Node proxy is 1.0× for deserialization
plus about 20 ms of map build. Chromium per-record overhead is **UNVERIFIED**.
The slice-4 gate is the journey's `snapshotRead` checkpoint at ≤ 1.15× master.
If that fails, the fallback that stays within this design is `getAll` in
5,000-record pages within the same transaction.

### 2.6 Migration

There is none, because the cutover wipes site data. An un-wiped client opens
v2, and `onupgradeneeded` drops `snapshots`. `load()` then finds no meta, so the
prime falls to Firestore's persistent cache or the server (today's first-run
path). When the client reaches `live`, the §2.4 full rewrite runs once.

An old-build tab is closed by `onversionchange`. Its next `open(…, 1)` throws a
VersionError, so its persistence disables itself: slow boot, never wrong data.

### 2.7 Tests and gates (slice 4)

These need an IndexedDB in Node. `fake-indexeddb` is not a dependency today
(VERIFIED), which raises open question Q2. Alternatively a Playwright page test
can use the perf harness's Chromium.

| Test | Vacuity proof |
|---|---|
| A flush after one change writes exactly 1 put + meta (count requests via a wrapped store) | With the old whole-corpus `save` restored, the count is N |
| A deletion and a published→unpublished flip in the published scope produce `delete`, and no unpublished record is stored under the shared key | Drop the eligibility branch → the unpublished card is found in the store |
| Coherence: mutate card A during a full-rewrite walk (yield hook), then reload. A is at its newer image, and meta's watermark is not newer than any stored image | Remove step 3 → A is stale while meta is newer |
| A failure re-adds ids; 3 failures disable and fire `degraded` once | Remove the re-add → the next flush misses A |
| An owner mismatch aborts with nothing written | Skip the owner check → a write lands |
| Boot rejects a `cardCount` mismatch and an invalid record, and clears the range | — (validation unit) |
| Upgrade: a v1 DB with a `snapshots` record opens as v2 with no snapshot | — |

Journey (slice 0) for slice 4: worker CPU in the 15–30 s window after each save
falls from O(corpus) to near zero, with no `compact snapshot save restarted`
status lines. Warm boot `snapshotRead` ≤ 1.15×. A reload after 5 Save→New
cycles serves all 5 cards from the snapshot.

## 3. Slice 7 — subscription dependency scoping and drawer cost

### 3.1 Engine delta (the dirt)

`QueryEngine.applyAction` and `updateCards` return an `EngineDelta`:

```ts
type EngineDelta = {
  all?: true;                       // UPDATE_SECTIONS, UPDATE_TAGS, hydrate, configureCollections
  filterNames: Set<string>;         // names whose filters[name] identity changed (≤ ~100 identity compares)
  cardIDs: Set<CardID>;             // changed/added/removed card ids
  setsChanged: boolean;             // _setsVersion advanced
  editing?: true;                   // setEditingCard
};
```

Identity is a sound change signal after slice 3. Unchanged memberships keep
identity (`updateOnDomain` returns `previous` when no bits changed), and
`updateFilterMap` returns `previous` on a no-op (VERIFIED in code). Before
slice 3 it is also sound, because master's reducer omits unchanged maps.
`SubscriptionManager.markDirty(delta)` unions deltas until the flush. The
existing `'selection'` scope becomes `filterNames: {selected}`, which removes
the `DirtyScope` special case.

### 3.2 Dependency analysis (at `subscribe`, once)

From `CollectionDescription.deserialize(description)`:

- `filterNames`: each `description.filters` entry split on
  `UNION_FILTER_DELIMITER`. Inverse names are mapped to their base via
  `INVERSE_FILTER_NAMES` (`unread`→`read`, `unstarred`→`starred`, …). The
  set's `SET_INFOS[set].filterEquivalent` is added.
- **Viewer-state names by substring:** `read`, `starred`, `in-reading-list`
  and `selected` are added whenever they occur anywhere in the string,
  including inside configurable sub-expressions such as `exclude/`,
  `combine/` and `expand/`. This is the same conservative rule as
  `dependsOnSelection` today. A false positive only recomputes.
- `global = true` if any filter is configurable (references, similar,
  children, relative dates, query, …), if `limit` or `offset` is non-zero, or if
  the sort is `card-rank` or `tweet-order` (they read other cards) — VERIFIED
  that the other sort extractors read only the card itself
  (`filters.ts:1750-1925`).

### 3.3 Re-run rule

A subscription is recomputed iff any of these holds:

- it has never been pushed, it has errored, or `delta.all` is set;
- `global` is set and `cardIDs`, `setsChanged` or `editing` is set;
- `deps.filterNames ∩ delta.filterNames ≠ ∅`;
- `delta.cardIDs ∩ lastIDSet ≠ ∅` (sort or label of a shown card may change);
- an **entrant** check passes for some `id ∈ delta.cardIDs`: the id is in the
  set's filter-equivalent and passes the concrete include/exclude memberships
  (`membershipHas` per dependency, O(changed × deps)).

`lastIDSet` is built when a result is pushed. Its cost is O(result), and the
push already costs that much.

Two consequences:

- A new card that cannot appear in a non-global collection no longer recomputes
  it.
- An ordinary save, which changes 0 filters (§0), recomputes only global
  subscriptions and those showing the card.

**Reads.** `UPDATE_READS` yields `filterNames: {read}`. Only subscriptions whose
description mentions `read` or `unread` recompute. The `'all'` dirt at
`corpus-worker.ts:3379` is removed. The auto-read ~5 s after navigation stops
re-running every subscription.

### 3.4 Drawer reference blocks: worker-side result cache

The cause is VERIFIED. `card-view.stateChanged` reschedules
`_scheduleReferenceBlocksUpdate` on every store change. The main-thread memo
(`reference_blocks.ts:340-367`) is keyed on the
`selectCollectionConstructorArguments` identity, and that includes `filters`
(`selectors.ts:2057-2071`). So the auto-read changes `filters.read`, every
block misses, and each block re-runs one worker `runCollection`
(`corpus-bridge.ts:687`). Navigating back (Up) also misses once the reads have
changed.

The smallest change is a bounded LRU in the worker's `'runCollection'` handler
(`corpus-worker.ts:3417`), keyed by
`description|keyCardID|uid|randomSalt|similarityVersion`:

- Each entry carries the §3.2 deps and its result's id set.
- Every `EngineDelta` evicts the entries that the §3.3 rule would recompute.
  The cache is a set of passive subscriptions that are evicted instead of
  recomputed.
- The main thread adds `similarityVersion` to the `runCollection` message: a
  counter bumped when `selectCardSimilarity` identity changes. That is the one
  field needed, because cloning loses identity.
- 64 entries, about 8 cards × 8 blocks.

Reference blocks are configurable (`references`/`similar`), so they are
`global`: any card save evicts them, which is correct. Reads, stars, selection
and Up/Down revisits hit. No main-thread change is needed beyond the field.

### 3.5 Tests and gates (slice 7)

| Test | Vacuity proof |
|---|---|
| Extend `test/subscription-manager`: 4 subscriptions (everything+has-content, unread, references/X, main). `UPDATE_READS` recomputes only `unread`. Count `runCollection` calls with a spy engine | Restore `markDirty('all')` → the count is 4 |
| A body edit to a card not shown in a non-global subscription → 0 recomputes. The same edit to a shown card → 1 | Drop the `lastIDSet` check → the shown-card label is stale (assert the labels change) |
| Entrant: a new card matching `everything+has-content` recomputes it. A new card failing it does not | Drop the entrant check → the matching card is missing from the push |
| Equivalence battery: 200 random deltas over a 2k corpus. Scoped flush results == unscoped flush results for every subscription | The guard against the rule being wrong. Inject a bug (ignore `setsChanged` for `global`) → diff fails |
| Worker cache: a read toggle → hit. A save of any card → miss for references blocks. A `similarityVersion` bump → miss | Remove eviction → the save test returns stale ids |

Journey (slice 0) for slice 7:

- At most 1 subscription recompute per auto-read, instead of all of them.
- Per ordinary save, only global subscriptions plus those showing the card
  recompute.
- 20 Down/20 Up: worker `runCollection` count per navigation is at most the
  number of blocks for first visits, and 0 on Up revisits and after auto-read.
- Worker tasks per navigation are reported as a count.

## 4. What the matched journey must show, per stage

| After | Save→New (×5, 20 s gaps) | Idle 15–30 s after save | Drawer 20 Down / 20 Up | Boot |
|---|---|---|---|---|
| slice 3 | main+worker `makeFilterFromCards` ms per new card ≪ master (Node: ~1 ms vs ~340 ms, twice) | unchanged | unchanged | prime ≤ 1.1× master |
| slice 4 | unchanged | snapshot CPU ≈ 0, no restarts | unchanged | `snapshotRead` ≤ 1.15× |
| slice 7 | subscription recomputes per save = global ∪ showing | — | 0 worker runs on revisit/auto-read | unchanged |

In every stage, cycle N/cycle 1 worker CPU is ≤ 1.1 and after a reload it is
unchanged (no accumulation). The machine load is recorded.

## 5. Line estimates (product / tests)

| Slice | Added | Removed | Tests |
|---|---|---|---|
| 3 | ~700: membership 414 + bulk 45 + lineage index 25 − AVL ~60; consumers ~90; reducer ~90; selectors/data ~90; guard 109 | ~150 | ~600 (ported 387 + new ~200) |
| 4 | ~260 (store ~140, worker flush/full rewrite ~120) | ~230 (walk, abandon, single-record save/load/validate) | ~350 |
| 7 | ~280 (analysis ~80, delta plumbing ~70, rule ~60, worker cache ~60, bridge field ~10) | ~40 (`DirtyScope`) | ~400 |

## 6. Open questions for the lead

1. **Q1, bitset prime handoff (§1.4.2).** It adds one optional `CardBatch` field
   but turns a branch regression into a boot win. Accept it in slice 3, or keep
   plain maps and accept ~+318 ms main-thread prime (generic import done via an
   index, measured)?
2. **Q2, IndexedDB tests.** Add `fake-indexeddb` as a devDependency, or run the
   store tests as Playwright pages?
3. **Q3, lineage-tip index (§1.5).** It changes the branch's reviewed index (AVL
   → Map). Land it in slice 3 (my recommendation, since lookups are on the
   subscription hot path), or only if the journey shows subscription
   regression?
4. **Q4, relative-date collections** (`created/after/7-days-ago`) are `global`,
   but they refresh at day rollover only on the next card delta. Today they
   also refresh on reads and stars. Is that acceptable, or should a midnight
   timer emit `{all}`?
5. **Q5, gate thresholds.** Prime ≤ 1.1× and `snapshotRead` ≤ 1.15×. Pick the
   numbers, since §1 refuses invented SLAs.

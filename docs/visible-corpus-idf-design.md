# Design: Visible-Corpus IDF (fingerprints from the cards you can see)

**2026-08-15 · Synthesized from two independent design passes (consumer-first
and infrastructure-first) · Status: ready to implement**

## Owner's decisions (pinned)

1. Fingerprint rarity (IDF) is computed over **the cards the viewer can see**.
   Two tiers only — `mayViewUnpublished` or not; per-card grants ignored.
2. **The path that deletes the server-IDF machinery wins**, even at some perf
   cost — provided the key journeys do not regress: rapid card navigation
   (zero long tasks), editor typing (~18ms/keystroke), commit/save settle
   (~1-2s, p95 <1s), boot-to-usable (priority cards in seconds; warm ~8-13s).

## Where both independent designs agreed (adopt without further debate)

- **The corpus worker owns IDF**, computed over its own corpus — which is the
  visible set *by construction* (published listeners for readers; everything
  for privileged). No scope logic is written; it is inherited.
- **Delete the entire server subsystem**: `functions/src/idf.ts` + its export
  (plus `firebase functions:delete calculateIDF` on BOTH projects — omission
  does not undeploy; the file's own deploy note says so), the `idf-maps`
  public-read rule in storage.rules, the bucket objects, `src/idf-cache.ts`,
  the 1.6MB `server_idf_cache` localStorage entry (one-time removal at boot —
  it competes with the aux-write queue's quota), `UPDATE_SERVER_IDF` and all
  Redux/protocol/hydration plumbing.
- **Compute IDF from the same `processCard` output the TF side uses** (stored
  `nlp_tokens` fast path; un-enriched, body cards only, same
  `log10(N/(df+1))`). This automatically INCLUDES the `overrideExtractor`
  fields the server skipped (concept/non-link references) — fixing the
  maxIDF skew where heavily-linked concept phrases scored as the corpus's
  rarest terms. Alignment is structural: one tokenization feeds both TF and
  IDF, so there is no second pipeline to drift.
- **Freeze the map per session** (epoch policy). New epoch only on:
  (re)connect/scope change; corpus drift >10% vs the map's cardCount (the
  heuristic the old memo already asserted); explicit console refresh.
  Rationale: IDF is a slow statistic — mid-session reshuffles of word clouds
  are churn with no user value, and every new map identity cold-starts the
  IDFMap-keyed shared fingerprint cache. Freezing makes that cache
  session-lived and keeps rebuilds off every key journey by construction.
- **Kill the recompute-on-delete flaw** rather than patch it: worker-side,
  maintain `docFreq` incrementally (see below); main-thread fallback (off
  mode / small corpora only), replace the count-based global memo in
  `src/nlp.ts:1497-1512` with a WeakMap keyed on the ProcessedCards identity
  + ngramSize, which also stops `possibleMissingConcepts` (ngram 7) evicting
  the size-2 map.
- **Incremental maintenance is O(changed card)** (infrastructure design's
  detail, adopt as-is): hook `updateLocalState`, which still holds the
  previous card object — decrement its distinct-term set, increment the new
  one's (~1-3ms/card; memo hits make the old set nearly free). Deletes
  decrement; terms at zero are removed. `idf` values materialize from
  `docFreq` only at epoch publication (<10ms). Initial build: 12ms-sliced
  after `loadComplete`, same pattern and abort-guards as the search-recall
  build; budget 2-5s worker time at 40k, ~200ms at reader scale. Bounded
  drift from cross-card reference vocabulary (±1 df) heals at every epoch
  rebuild.
- **Reader tier: same mechanism, no special case.** The reader worker's
  ~1.2k-card corpus is exactly what the server map approximated, computed
  fresher (never stale), more correctly (reference fields included), for
  zero reads. The only window where a server map would win is before any
  cards exist to fingerprint — i.e., when it has no consumer.
- **Scope changes ride existing machinery**: generation bump → worker index
  reset beside `resetSearchRecall()`, Redux purge of the map with the same
  rigor as the cards, stale deliveries dropped by the existing generation
  filter. Two tabs: lease/lock semantics unchanged; N reader tabs each
  compute ~200ms maps.
- **A pleasant wrinkle both flagged**: a signed-in non-privileged author's
  corpus includes their own unpublished cards, so their rarity view includes
  their own vocabulary — slightly *richer* than two tiers, at zero cost, and
  kept out of any shared artifact by the rules below. Accepted.
- Suggested Concepts uses NO IDF (TF-only) — document as a non-consumer so
  nobody "migrates" it. `possibleMissingConcepts` (ngram 7) must never share
  the size-2 map.

## The two divergences, decided

### D1 — Ship the map to the main thread, or ship per-card slices?

*Consumer-first* said: never ship the map; add `fingerprintCard` /
`fingerprintCollection` RPCs plus a pushed editing-card slice (main thread
needs ≤50 terms at a time; keeps the map out of Redux entirely).
*Infrastructure-first* said: ship the whole map once per epoch into the
existing (renamed) Redux slot; every main-thread consumer then works
unchanged, synchronously.

**Decision: ship the map (infrastructure topology), with a trim, a
measurement gate, and the slice design held as the contingency.**
Reasons: (a) it is the minimal diff — the map lands where `serverIDF` lived
(rename to `workerIDF`), selectors/components/finisher stay synchronous and
untouched, and this codebase's history says new async plumbing is where new
bugs live; (b) the one clone per session happens post-boot, off all key
journeys; (c) the kill-switch (`off`) path keeps identical semantics.

The honest open question is SIZE: the 1.6MB/50k-term figure is the
*published* map. The privileged 40k-card term space is plausibly 400k-1.5M
terms (tens of MB) — the consumer-first design rejected whole-map shipping
on exactly this estimate. Two mitigations before falling back:
- **Trim df==1 terms from the shipped map.** A singleton's idf ≈ maxIDF, and
  absent terms already score maxIDF — so dropping them is semantically
  near-lossless and typically halves-or-better the vocabulary.
- **Measurement gate in step 1 of rollout**: build the privileged map in the
  worker on real DEV, log term count + serialized size (trimmed). If ≤ ~8MB,
  ship-the-map stands. If larger, adopt the consumer-first slice/RPC design
  (its full spec is in the review transcript: `fingerprintCard`,
  `fingerprintCollection`, pushed editing slice with maxIDF for
  since-mirror terms) — it is the better architecture at that size, at the
  cost of converting the info panel + finisher to async.

Optional later optimization either way: `{terms: string[], values:
Float64Array}` with a transferred buffer if the clone measures badly.

### D2 — Persist the counts across boots?

*Infrastructure-first* said: persist `docFreq` as an optional v3 snapshot
field (atomic with the cards; warm boots skip the rebuild; cold-boot UX gap
erased) with a structural eligibility guard for the shared record.
*Consumer-first* said: persist nothing — the privacy story becomes one
sentence, and the rebuild is invisible off-thread work.

**Decision: persist nothing in v1.** The rebuild is 2-5s of sliced worker
time nobody waits on; the cost is word clouds staying empty for a few
seconds after a cold boot, which matches every other late-arriving
decoration on a cold boot and touches no key journey. Zero new privacy
surface beats warm-boot seconds. Revisit with the infrastructure design's
v3-field spec (including its every-card-snapshot-eligible write guard) only
if the post-boot gap proves annoying in real use.

## Consumer behavior before the map exists (cold boot, few seconds)

Word clouds: existing empty state. Suggested tags: existing
'calculating…'/'unavailable' states. Similar-cards fallback / see-also:
existing empty/preview contract (Qdrant remains primary). Working-notes
title finisher: TF-only ranking via the pending-map convention (explicit
empty map marked pending — cardTFIDF yields maxIDF-for-all, i.e. frequency
ranking) — an honest degradation, identical in kind to today's novel-term
handling. NEVER fall back to a synchronous main-thread 40k build in worker
modes.

## Rollout order (each step shippable; `corpus-worker=off` is full rollback throughout)

1. Worker `idf-index` module + sliced build + incremental maintenance +
   epoch policy; `suggestTags` and the in-worker similar fallback consume it
   (via a provider install, patterned on `similarity-request.ts`);
   **measurement gate for D1 runs here.**
2. Protocol v6: `idfMap` delivery (or the slice RPCs if the gate flipped);
   Redux rename `serverIDF → workerIDF` preserving the identity-stability
   wrapper (the shared fingerprint cache silently dies without it); main
   thread prefers worker map, still reads a delivered server map as
   transitional fallback. **The visible ranking change for privileged
   viewers lands here — bisectable on its own.**
3. Main-thread memo → WeakMap fix (also fixes off-mode).
4. Deletion sweep: client server-IDF path, then the function
   (`functions:delete` both projects), storage rule, bucket objects,
   localStorage removal. AST-style structural test pins the deletion (no
   source reference to `server_idf_cache`/`idf-maps` outside cleanup).
5. Docs: corpus-sync-design note (IDF is a worker-derived index, like search
   recall); Suggested-Concepts-is-IDF-free note.

## Test plan (union of both designs)

- Incremental-equivalence property test: scripted add/edit/delete sequences
  → `docFreq` equals `calcIDFMapForCards` ground truth on the final corpus;
  spy asserts delete never triggers a full rebuild.
- Reference-field vocabulary present in the map (the fix, pinned).
- **Privacy structural test**: corpus with a distinctive unpublished-only
  term; non-privileged session → term absent from every delivered
  map/fingerprint surface, absent from localStorage and IndexedDB; sign-out
  mid-session → generation flush leaves no trace.
- Epoch-freeze: map identity stable across `updateCards` under threshold;
  rolls at >10%; suggestTags (worker) and word cloud (main) agree per epoch.
- Protocol-version pin bump; perf-harness: no `idfBuild` slice >12ms, boot
  checkpoints unregressed, and the D1 size measurement recorded.
- Off-mode: small-corpus sync path still renders (WeakMap memo), ngram-7
  isolation test.

## What this deletes (the point)

One Cloud Function with a 40k-read cost profile and an IAM/staleness saga,
one public storage surface, one localStorage cache in the write queue's
quota budget, one cross-thread config channel, one known perf flaw, and the
entire "regenerate the map manually and remember why" operational burden.
Added: one worker index module that mirrors an existing pattern, one message
type, one provider hook.

# Adversarial Verification Plan: `updated`-invariant, corpus-sync robustness, and the 40k performance gates

**Date:** 2026-07-07
**Scope:** Convince ourselves — adversarially — of two independent claims about the sync work (the client `updated`-write guard + hardening + security rules of `06cba17c`..`ebe85506`) and the corpus-sync machinery it protects:

- **Claim P (Performance):** every Appendix-A interaction budget holds at 40–65k cards under worst-case corpus and worst-case interaction — **and** the `updated`-invariant guard + rules add no meaningful cost to the two budgets they touch (commit→interactive ≤200ms, remote echo ≤50ms).
- **Claim R (Robustness):** it is structurally impossible for a card mutation to silently fail to sync; and if the invariant were *ever* violated, the boot-trust gate detects it rather than serving a forked corpus as truth.

**Related:** `docs/fast-corpus-design-doc.md` (Appendix A budgets, decision gates G0/G1), `docs/corpus-sync-design.md` (boot-trust gate, no-gap proof, `fastDedupe`, residual risks — our work is the mitigation for residual risk #1), `docs/superpowers/specs/2026-07-06-updated-invariant-security-rules-design.md`.

---

## 0. What "adversarially convince ourselves" means here

The design doc's own confession is the reason this plan exists: *"No browser profile of the app with a realistic 40k corpus has ever been captured. Every optimization round was driven by code reading and inference."* **Inference is therefore inadmissible as evidence in this plan.** For each claim we write the experiment that would *expose it false*, and we verify with an **independent oracle** — never the code's own assumptions:

- Rules are judged by the **Firestore emulator's rule engine**, not by the client guard's logic (they are two independent implementations of the same policy; make them a differential test).
- Worker sync results are judged by an **independent recomputation** over the same inputs, not by the worker's own reconciliation (which the live incident showed is blind to same-source staleness).
- Performance is judged by **wall-clock at scale with distributions**, not by micro-reasoning about Big-O.

**Evidence bar:** distributions (p50/p95/p99, not means), on target hardware, cold **and** warm; falsification attempts that *failed* to break it; and **honest logging of what remains uncovered** — including the design doc's two admitted blind spots (within-partition ghost/missing cancellation; a silently-*mutated* card the count gate cannot see).

**Scope note.** The performance budgets are app-wide (the fast-corpus effort). Our `updated`-invariant changes have a *specific* perf blast radius — the commit path and the remote-echo path — so Claim P both (a) re-establishes the app-wide budgets at scale and (b) isolates our changes' contribution via A/B. Claim R centers on our write-side invariant and the read-side sync it feeds.

---

## 1. Precondition: build the two missing instruments

Per the coverage inventory, two gaps block everything else. Neither claim can be adversarially tested until they exist, and both must be **committed** (the last 40k measurements were lost to session scratchpads — never again).

- **1a — Rerunnable perf harness** (`tools/perf/`, `test/perf/`). Playwright + pinned headless Chromium, driving the *exact* Appendix-A interaction script: arrow-down ×20 (with auto-mark-read), editor open, 30 keystrokes, commit + echo, remote echo from a second tab, cold/warm boot, find-dialog query. It reads the **already-present** `src/perf.ts` counters (`makeFilterFromCards:calls`/`:changedMaps`, `diffSelector:*:skipped`, `processCard:miss`, `collection:handoff`) and new `performance.mark`/`measure` spans placed around (i) the four hot components' `stateChanged`, (ii) commit-to-interactive, (iii) echo-to-paint. Output: per-interaction p50/p95/p99 + counter deltas, as JSON, diffable across runs.
- **1b — Synthetic corpus generator** (`tools/gen-corpus.ts`), deterministic seed, sizes 10k/40k/65k, **worst-case shaped**: largest legal bodies, deepest reference/inbound-reference graphs, cards that are members of *many* of the ~125 `CARD_FILTER_FUNCS`, many tags, published/unpublished mix, concept cards + synonyms. Loadable into (i) the Firestore emulator and (ii) a local persistent-cache worker boot. Seed it from the existing 40k generator inside `test/search-index/test.js` (today the only at-scale fixture). **This removes the dependency on `reset-dev`-from-prod and makes scale testing emulator-safe.**
- **1c — A/B toggle.** Run the whole harness with the `updated`-invariant changes present vs. reverted (or behind a flag), so any commit/echo delta is *attributable* to our work, not the corpus size.
- **1d — CI gate** (`.github/workflows/` — none exists today; `.travis.yml` runs functional tests only). Fast layers (§3 A/B/C + micro-bench + harness-against-emulator) on every PR, **failing the build** on a budget breach or a robustness-property failure. Scale/E2E/chaos layers (§3 D/E) on a schedule + a required pre-prod job.

---

## 2. Performance battery — falsify Claim P, gate by gate

For each Appendix-A budget: the worst-case scenario, the measurement, the pass criterion, and the adversarial stress. All at 65k on the 1b corpus, p95 unless noted.

| Gate | Worst-case scenario | Adversarial stress | Pass criterion |
|---|---|---|---|
| **Arrow-nav ≤16ms** | Held arrow auto-repeat firing `UPDATE_READS`→auto-mark-read→`makeFilterFromCards` (the doc's prime suspect) | 65k corpus, nav across a collection that touches many filters | p95 ≤16ms main-thread **AND** the counter invariant `active-collection refilters when membership unchanged == 0` **AND** the write-guard runs **0 times** during nav (prove our guard is off this path) |
| **Keystroke ≤16ms** | 30 keystrokes in the largest card with suggestions + concept highlighting live | Rapid typing while a background echo lands | p95 ≤16ms |
| **Editor open ≤100ms** | Open the worst card (largest body, most refs, most images) | Open while a commit echo is in flight | p95 ≤100ms |
| **Commit→interactive ≤200ms** ← *our guard* | Commit the worst card; measure to-interactive | **Commit-storm** (rapid commits); **bulk** (`bulkCreateWorkingNotes` of N); **mount import of 65k** through the guard | p95 ≤200ms; guard's contribution (from A/B) is a rounding error |
| **Remote echo ≤50ms** ← *depends on the invariant* | Second tab commits; measure first tab's echo-to-paint | Echo of an **inbound-reference-only** change (the exact case the invariant fixes); echo storm; echo during nav | p95 ≤50ms; the inbound-only echo both **propagates** and is correctly **deduped** by `fastDedupe` |
| **Find-dialog ≤100ms** | Rare-token whole-corpus query at 65k | Query while nav/commit active | p95 ≤100ms to first results |

**Guard-cost micro-bench (bounds the commit blast radius):** benchmark `isServerTimestampSentinel` + `cardWriteViolation` + `nonBumpCardWriteViolation` over 1e6 iterations, including the `JSON.stringify`-on-FieldValue WeakMap-miss path; multiply by the 500-op MultiBatch cap and by a 65k mount to bound worst-case added latency. Confirm structurally that in worker `shadow`/`on` modes the guard is *off the perceived-latency path* (optimistic echo lands **before** `await batch.commit()`), so rules rejection surfaces only post-commit (async) — and verify the rollback path when it does.

**Cross-cutting:** capture heap snapshots + long-task/GC-pause traces at 65k (the doc flags GC as a jank source only profiling reveals); record tab RSS against the ~400–600MB Plan-A end-state expectation. **These feed the G0/G1 decision gates**: G0 (does the profile confirm reducer/selector churn dominates?) and G1 (are budgets met on the real corpus after Stage 3?) become empirical, not speculative — which is the whole point of the fast-corpus doc.

---

## 3. Robustness battery — falsify Claim R, in layers, each with an independent oracle

Three nested sub-claims: **R1** no un-bumped card write reaches Firestore; **R2** given the invariant, every edit propagates; **R3** if the invariant is ever violated, the boot-trust gate detects it.

### Layer A — pure-core + property-based (Node, fast, every PR)
Uses `fast-check` (new dev dep) against the zero-import `card-write-guard.ts` and the wire helpers.
- **R1 completeness (fuzz):** generate arbitrary card write shapes — field sets, sentinel vs non-sentinel `updated`, dotted-path keys, `{merge}`, `arrayUnion`/`increment`/`deleteField` mistakenly on `updated` — and assert `cardWriteViolation`/`nonBumpCardWriteViolation` verdicts match the spec. **Try to construct a top-level card write the guard accepts without a real bump — it must be impossible.**
- **Sentinel-detection robustness:** `isServerTimestampSentinel` across every shape (vended `Timestamp`, literal FieldValue, plain `Timestamp`, `arrayUnion`, `increment`, `deleteField`, nested, `null`/`undefined`, and a synthetic "SDK-shape-drift" object). Extend the existing `SENTINEL_DEFINITION_VALID` check into a test that **fails loudly if the Firebase SDK changes `serverTimestamp()`'s shape** (both the final review and the sync doc flagged this fragility).
- **`fastDedupe` equivalence:** `timestampsEquivalent` — equal-`updated` ⇒ deduped, different ⇒ delivered; adversarial near-equal timestamps, clock granularity, and `toWire`/`fromWire` round-trip stability.

### Layer B — differential guard ↔ rules (the cross-layer oracle)
The machine-checked version of the final review's manual cross-layer analysis. Generate a battery of write shapes; run **each against both** the pure-core guard **and** the emulator rule engine; assert agreement:
- No write the guard permits (bump or escape-hatch) is rejected by rules → would be **broken editing**.
- No write the guard blocks is silently accepted by rules → **false confidence**.
Covers: create, content edit, each `cardEditMinor` branch (stars, messages), `cardEditLegalTweets`, inbound-refs. This is exactly where the `tweet_favorite_count`/`tweet_retweet_count` latent mismatch lived — the differential test makes any future drift fail CI.

### Layer C — emulator rules, adversarial (extend `test/security`)
- **Old-client replay:** enumerate pre-guard client write shapes (from the write branches / git history) and replay against the new rules → confirm *exactly* which are rejected. The inbound-refs tighten-to-required is the sharp one (the deploy's stale-service-worker risk); this quantifies it.
- **Escape-hatch abuse:** `updateWithoutTimestampBump({body, star_count})` → rejected by both guard and rules.
- **Every maintenance-task write shape → accepted** (no runtime throw, no rules rejection): the 4 we fixed + admin `resetTweets` + the rest.
- **Admin/tools bypass:** the `mount.ts` import shape — main card bumps **and** inbound updates bump via the sentinel (the bug we fixed) — verified against the emulator.
- **Query-shape / permission attacks (inventory gap #6):** attempt to page unpublished cards via crafted `where` clauses; writes as anon / other-user; tombstone read/create/mutate permission boundaries.

### Layer D — worker + emulator integration at scale (biggest gap: `corpus-worker.ts` has **zero** tests today; needs 1b + a new `test/corpus-worker/` harness)
- **Watermark no-gap (R2):** advance **only** from server-confirmed ingested docs — **never** from echo (client-clock), read-time, or wall clock. Adversarial: feed an echo card stamped with a *future client clock* → assert the watermark does **not** advance past it (the doc: "enforce in one function with tests" — verify/author that test).
- **`fastDedupe` silent-drop hazard (the invariant's raison d'être), as a metamorphic proof:** take an inbound-reference-only change; **without** the bump (simulate old behavior) → reproduce that it *is* silently droppable on redelivery; **with** the bump (current) → it propagates. This demonstrates our work closes the exact `data.ts:1511` hazard the sync doc names.
- **Boot-trust-gate incident replay (R3) — the centerpiece:** reproduce the live incident *exactly* — a 5,001-card partial cache (1,240 published + 5,000 most-recent unpublished) over a 40k corpus, so `max(updated)` ≈ true max and the delta delivers nothing. Assert the **per-partition** `count()` gate **detects the deficit** (does *not* bless as trustworthy) where a single-total check is fooled. Then:
  - **cross-range cancellation** (ghost in partition X, missing in Y) → per-partition gate still catches;
  - **within-partition ghost/missing cancellation** → the design doc's *admitted* blind spot: assert it is **not** caught, and **log it as a known limit** (do not pretend coverage);
  - offline → stays `unverified`; small deficit → bisect repair; large deficit (>20%) → cold path.
- **Mutation-without-bump blind spot:** the gate counts docs; it cannot see a silently-mutated card whose `updated` didn't bump. Assert this — it proves **R1 is the *only* defense** against mutation-without-bump and the gate does not back it up. Document that coverage boundary explicitly.
- **Tombstone flow + laundering:** delete → tombstone → other device removes; `getDocFromServer` launders the cached ghost; `processedTombstoneIDs`; `W_t` advances after ingest+launder; recreated-ID-after-tombstone suppression/un-suppression.
- **Second-tab Web Lock:** loser runs published-only degraded and **never** cold-sweeps or delta-listens.

### Layer E — metamorphic + chaos / fault injection (scheduled / pre-prod)
- **Metamorphic across entry points:** the *same* logical edit via `modifyCard`, fork, `bulkCreateWorkingNotes`, a maintenance task, and `mount` import must produce the *same* synced end-state on a second device. Any divergence = a bypass that escaped R1.
- **Two-device concurrency:** concurrent edits to one card; same-millisecond edits; clock skew; echo-ordering permutations. No lost update given the invariant; `fastDedupe`'s timestamp-equality never drops a genuinely-different version.
- **Fault injection:** kill the worker mid-sync; evict the persistent cache (force the 2-day sweep path); drop network mid-commit → assert optimistic-echo **rollback** at scale (inventory gap #7); quota-exhaustion mid-attach → `syncState:'stale'`, **no removals**.
- **Commit partial-batch failure at scale:** MultiBatch 500-op split with a mid-batch failure → rollback correctness across many cards (gap #7).

---

## 4. The adversarial discipline (how we avoid fooling ourselves)

- **Falsification per claim**, independent oracle every time (emulator engine ≠ guard logic; worker ≠ its own reconciliation; wall-clock ≠ inference).
- **Statistical rigor:** N runs, p50/p95/p99, target hardware (which machines represent the target experience? — the doc asks this too), cold + warm, GC/long-task traces. Mean-only or single-run numbers are inadmissible.
- **No silent caps:** every test that bounds coverage (sampling, top-N, a skipped blind spot) **logs what it dropped**. The two admitted blind spots are asserted-and-logged, not hidden.
- **Committed provenance:** harness + generator live in the repo; results are diffable artifacts, not console eyeballing.
- **Regression gates:** a future change that breaks a budget or a property fails CI — the point of §1d.

---

## 5. Coverage matrix (the "comprehensively convince ourselves" artifact)

| Budget / invariant | Layer | Exists today? | Adversarial technique | Oracle |
|---|---|---|---|---|
| Arrow-nav ≤16ms | Perf §2 | perf.ts counters yes; harness **no** | held auto-repeat @65k + refilter-count==0 | wall-clock + counters |
| Keystroke/editor/find | Perf §2 | **no** harness | worst card / rare token @65k | wall-clock |
| Commit ≤200ms (our guard) | Perf §2 + micro-bench | **no** | commit-storm, bulk, 65k mount, A/B | wall-clock + isolated bench |
| Remote echo ≤50ms (invariant) | Perf §2 + D | **no** | inbound-only echo, echo storm | wall-clock + dedupe assert |
| R1 no un-bumped write | A, B, C | pure-core + audits **yes**; fuzz/differential **no** | fast-check + guard↔rules differential | emulator rule engine |
| Sentinel detection | A | 15 tests yes; SDK-drift guard partial | property + shape-drift tripwire | pure logic |
| R2 edit propagates | D | watermark math yes; e2e **no** | no-gap + fastDedupe metamorphic | independent recompute |
| R3 gate detects forked corpus | D | trust-gate *math* yes; incident replay **no** | 5,001-card incident + partition cancellation | per-partition count |
| Mutation-without-bump | D (blind spot) | n/a | assert **not** caught; log limit | — (R1 is the only defense) |
| Tombstones / laundering / 2nd-tab | D | pure bits yes; e2e **no** | delete→launder→recreate; Web Lock loser | independent recompute |
| Concurrency / chaos | E | **no** | 2-device, kill-worker, evict, quota-out | second-device end-state |

**Headline gaps (from the inventory) this plan closes:** no rerunnable perf harness; no synthetic corpus generator; sync suites are logic-only/tiny-fixture; `corpus-worker.ts` untested; no CI perf/robustness gate.

---

## 6. Sequencing & cost discipline (respect the Firestore read quota)

The sync doc is explicit that live worker-mode boots are expensive (~39k reads each) and must be rationed. Therefore:

1. **Build 1a + 1b first** — unblocks everything, entirely emulator/local, free.
2. **Layers A, B, C + guard micro-bench + perf harness against the emulator/synthetic corpus** — every PR, free, CI-gated (1d).
3. **Layer D at scale on the synthetic corpus in the emulator** — free, scheduled.
4. **One live dev warm boot** (the doc's `<100`-read validation) for the real-Firestore delta path; **cold path (~65k / 2 days) deferred and run once**, per the doc's quota discipline (emulator tests cover resumability meanwhile).
5. **Perf on the *real* production corpus as admin on the target machine(s)** — the G1 acceptance gate, user-run with the committed harness. This is the only measurement that ends the "never profiled at 40k" era for good.

**Definition of done:** every row of §5 has a committed, rerunnable test with a passing (or explicitly-logged-as-known-limit) verdict; the CI gate is live; and one clean G1 run on the real corpus confirms the budgets on the target hardware.

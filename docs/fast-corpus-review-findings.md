# Independent review: `implement/fast-corpus` — findings for remediation

---

# ROUND 3 — find performance: search-recall narrowing (2026-07-25)

The one criterion still failing after round 2.5 was find latency: every keystroke ran `PreparedQuery.cardScore` over the whole 40k corpus (multi-second steady state; the first query also paid full lazy processing). A design critique established that prewarming caches would only shrink the first query while charging ~200MB to every session, and that the codebase already contained the intended fix, designed but unwired: `SearchIndex` recall pre-narrowing.

**Implemented (commits `89fa8e56`, `aff6e660`, + fingerprint-predicate fix):**
- Query collections over the `everything` set narrow their universe to `candidatesUnion(query tokens) ∪ always-scan cards ∪ description fallbacks/start cards`; precision and ranking stay with `cardScore`, so results are **bit-identical** (behaviorally tested, including a canary that proves the narrowing actually engages).
- The index builds **chunked in the worker** (MessageChannel-yield slices, low duty until initial load completes), kicked at the prime handoff, initial-load completion, and find-dialog subscriptions; mid-build updates drain through a dirty set before ready; reconnect resets. Memory stays candidates-only — no 40k processed-card materialization.
- Indexed tokens = save-time `nlp_search_tokens` **plus** the three locally-derived reference fields (their text is outside the fingerprint); token-currency predicate: `nlp_version` must be current; a *present-but-mismatched* `nlp_source_fingerprint` → always-scan; a *missing* fingerprint is trusted (the real corpus was migrated before the field existed — first deploy observed "5 indexed, 40,220 always-scan" until this was corrected).
- UX: worker reports build progress; the find dialog shows "Preparing search (N of M cards indexed)…" only while a query result is pending AND the build is incomplete.
- `lazyProcessCards` gained an `allCards` backport source so narrowed views share (and cannot poison) the per-card processing cache. The perf-harness generator now stamps token currency so the harness exercises narrowing.

**Known residuals (accepted):** synonym-map/importantNgram drift after a concept-card change can recall-miss until the affected card's next save (same class as other accepted staleness); the debug `CORPUS_WORKER.query()` API answers full-scan-fallback until the build completes.

---

# FINAL ACCEPTANCE CHECKLIST (owner, real Chrome, DEV)

Everything below the fold is machine-verified. These are the four things only a human in a foreground tab can certify:

1. **Warm boot stopwatch:** open dev-complexity-compendium.web.app signed-in (second+ visit), time until the app is usable. Target ~10s; prior real-Chrome median was 10.3s.
2. **Find feel:** open find (`/` or the search icon), type a few queries. First-ever search may show "Preparing search (N of M)…" briefly; subsequent searches should feel near-instant. This is the round-3 fix — judge it harshly.
3. **Takeover CTA, human click:** open a second tab, click "Use this tab", confirm handoff + old tab inert (machine-verified end-to-end already; this closes the last input-path caveat).
4. **Editor feel:** open a card, edit, save; watch the save status pill. (Machine-measured 0.2ms/keystroke and 625ms durable save.)

**Landing:** merge `implement/fast-corpus` → `master` after acceptance. The PROD cutover items in docs/prod-cutover-runbook.md remain post-land gates — notably the rules TIGHTEN flip (inbound-ref `updated` + both staged tests → assertFails) and the once-per-device cold-sweep read budget.

---

# ROUND 2 — verification of the fix commits (2026-07-24)

**Scope:** commits `9ae3a8ce..0e11ecbd` ("Harden fast corpus acceptance paths", "Close fast corpus review blockers", "Avoid ownership polling during corpus prime", "Restore fast warm corpus handoff") verified adversarially by four independent audits (ownership, worker/watermark, durable-edit, SW/rules/similarity), plus: full `npm test` green (Node 20), production build green, and the 12k emulator harness fully green (all takeover/crash/frozen correctness gates OK; emulator warm boot improved 19.2s → 15.7s).

**Verdict: markedly better — the original P0s are structurally fixed and most P1s closed — but NOT READY yet.** Two P1-class defects remain (one *introduced by* a fix, one a residual of the same class a P0 fixed), one P2 regression, and two small wiring bugs. All are well-localized; this should be a short round.

> **ROUND 2.5 (2026-07-24, reviewer-applied):** R2-1 through R2-4 below are now **FIXED directly by the reviewer** in the working tree:
> - **R2-1**: after staging the inline marker at `candidateSize === 1`, the executor re-checks `pendingUnderlyingBatchCount`; on overflow it rebuilds with `forceMarkerAfterCommit` so the marker commits strictly after the fanout (src/actions/data.ts).
> - **R2-2**: `parseSnapshot` now surfaces per-doc `pendingWriteIDs`; `contaminatePendingWriteIDs` is applied in `repairPartitions`, both cold-sweep phases (and the sweep `startBound` skips pending docs), the listen-mode cache/server primes, and `ingestSnapshot` no longer un-contaminates docs still overlaid by a pending write; `catchUpTombstones` skips pending tombstone docs; the launder re-ingest contaminates pending overlays (src/worker/corpus-worker.ts).
> - **R2-3**: the durable-save gate is now `durableSaveEligible` — `'live'` when the worker owns ingestion, `selectDataIsFullyLoaded` in the main-thread listener modes (`off`/`fallback`/`shadow`/`spike`) — applied at both operation starts and the per-chunk re-check (src/actions/data.ts).
> - **R2-4a**: `ensureSubscription`'s unsubscribe path clears `descriptionSerialized` (src/corpus-bridge.ts). **R2-4b**: a superseded sync-meta claim now calls `stopSupersededWorker` instead of throwing into a swallowed/unhandled path (src/worker/corpus-worker.ts).
> - Pinning tests added to `test/worker-listener-trust`, `test/perf-harness/multiedit-coverage.test.js`, and `test/ownership-lease` (source-pinning style, consistent with the suite; the behavioral-coverage debt below still stands). Full `npm test` + `tsc --noEmit` + production build green after the fixes.
>
> Not addressed in this pass (tracked below, non-blocking): the #17 contended-at-boot listener disconnect, the null-lease resurrection path, the bulk-tag sibling of #6, the Firestore-SDK dual-`forceOwnership` overlap window, and the first-filtered-query index-build stall.
>
> **Post-fix validation (2026-07-24):** full `npm test` (35 suites incl. the new pins) + `tsc --noEmit` + production build green; 12k emulator harness fully green over the committed fixes (all takeover/crash/boot correctness gates, counter invariants; only emulator-typical warm-boot advisory breaches). **Deployed to DEV** via the fixed deploy ordering and re-verified live signed-in against the real 40,225-card corpus: warm boot went `live` with trust gate 0-mismatch and the delta plane delivered exactly the 100 cards changed by earlier testing; the SW "Update ready" banner appeared (no auto-reload), activated cleanly, and the reload landed the new build; **`bulkTagRoundTrip(100)` now passes its full field-fidelity audit** (previously deterministically false-failed — finding #19's re-run requirement met). Find-dialog steady-state latency measured 3.8-8.9s in the review pane, but that environment background-throttles tabs; a human foreground check of find feel (and one human click of the takeover CTA) are the remaining manual sign-offs.

## Remaining blockers — all FIXED in round 2.5, kept for the record

### R2-1. NEW P1 — silent edit loss at the batch-limit boundary in the oversized-edit fanout (introduced by the #7 fix)
`src/actions/data.ts:819` computes `markerAfterCommit` **before** the marker group is staged at `:829-839`, and the `candidateSize === 1` break at `:841` ignores the resulting underlying-batch count. If the card+author groups fill the batch to within ~2 effective ops of the limit (marker's `serverTimestamp` counts 2; limit 500, or 249 if the sentinel detector fails), the marker overflows into a second underlying batch **inside the same MultiBatch**, and `commit()` runs both **concurrently** (`shared/multi_batch.ts:252-271`, no ordering). Marker succeeds + card batch fails → resume trusts the marker (`data.ts:763-777`), skips the chunk, reports success → **edit silently dropped**. Fix: after staging the marker group, re-check `pendingUnderlyingBatchCount`; if >1, route through `commitFanoutThenMarker` (marker strictly after fanout) exactly as the >limit path already does. Invisible to the current test suite (fanout tests cover only the 5-line helper).

### R2-2. P1 — watermark contamination fixed at the listeners but NOT in the one-shot paths (residual of P0 #3)
`listenerDocumentTrusted` is correctly applied in the delta/tombstone/published listeners (verified sound, including contaminate-not-just-skip). But `getDocsFromServer`/`getDocFromServer` results still carry pending-write overlays with `serverTimestamps:'estimate'`, and these paths neither exclude nor contaminate them:
- `repairPartitions` (`src/worker/corpus-worker.ts:1022-1028`) and `coldSweep` priority/pages (`:1341-1355`, `:1422-1426`) → polluted `deriveSessionWatermark` (`:1048-1056`) persisted as trusted. Partition repair runs on ordinary warm boots, so this is not cold-device-only.
- `catchUpTombstones` (`:1145-1157`) → advances the durable `tombstoneCursor` from a client-clock estimate (`:1112`); server tombstones older than the estimate are then permanently skipped.
- `processTombstones` launder re-ingest (`:1123-1127`) — same pattern, narrower.
Fix: apply the same per-doc `hasPendingWrites` → `clientClockCardIDs.add` / skip-cursor-advance treatment in all four sites (the prime fallback at `:1562` is the model). Also consider the latent trap: `ingestSnapshot:492` checks snapshot-level `fromCache` only, not per-doc `hasPendingWrites`.

### R2-3. P2 REGRESSION — durable saves permanently blocked in `off`/`fallback`/`spike` corpus modes (introduced by the #8 fix)
The new gate requires `selectCorpusStatus === 'live'` (`data.ts:711-714`, `:396-399`), but nothing ever dispatches `'live'` outside the worker bridge: mode `'off'` stays `'off'` (`reducers/data.ts:90`), worker-failure fallback stays `'fallback'` (`corpus-bridge.ts:967-968`) — while cards load fully and `editingStart` works. Every durable save is then blocked with a misleading "Wait for sync to finish" alert, re-fired by every resume trigger (alert loop, `data.ts:934-951`). Production `'on'` is unaffected; the diagnostic escape hatches become read-only. Fix: treat `'off'`/`'fallback'` (main-thread listener modes with `dataIsFullyLoaded`) as save-eligible, or set status appropriately in those modes; and rate-limit the resume alert.

### R2-4. Small wiring bugs (each ~1 line)
- `src/corpus-bridge.ts:459-469`: `ensureSubscription`'s unsubscribe path resets `id`/`key`/`latest` but not `descriptionSerialized`. Consequences: per-dispatch hot-path work runs forever after the find dialog closes (`queryChanged` permanently true at `:663`), and reopening the dialog with an identical/seeded query skips the fast path → the exact #12 latency recurs. Clear it in the null branch.
- `src/worker/corpus-worker.ts:1552/:1622`: a failed (superseded) sync-meta ownership claim is swallowed by the prime `catch` at `:1566`, then rethrown from the memoized `loadSyncMeta` at `:1622` **outside any try** → unhandled rejection; the superseded worker keeps its published listener + SDK cache until the 1s epoch guard fires. Handle it like the snapshot-store claim paths (`:1502`, `:1574`) → `stopSupersededWorker`.

## Closed / accepted (verified, with residuals documented)

| Original finding | Round-2 status |
|---|---|
| #1 heartbeat clobbers fencing token (P0) | **CLOSED** for the deterministic race (heartbeatDecision + synchronous lease claim + revalidation on storage/pageshow/focus/visibility; all thaw orderings converge on deactivate). Residuals (P3, document): sub-ms cross-process read-decide-write TOCTOU (localStorage has no CAS; contained by the worker IDB CAS + 1s self-heal); null-lease resurrection if site data is cleared between steal and thaw (`heartbeatDecision(null)`→'write'); design note — symmetric "any foreign token → yield" means the higher-epoch owner yields in residual races; strictly-lower-epoch tokens could be overwritten instead. |
| #2 draft cleared by unrelated save (P0) | **CLOSED**. operationID = durable op id, unique + persisted (resume still matches). Unstamped drafts now *survive* (fail-safe; restore path re-confirms via baseUpdated). Residual (P3): single global slot means tab A saving card X can stamp+clear tab B's idle draft for the same X — per-card slots still worth doing eventually. |
| #3 watermark contamination (P0) | **CLOSED at the listener sites** (delta/tombstone/published all gate on fromCache + per-doc hasPendingWrites, and contaminate rather than merely skip). **Residual is R2-2 above.** |
| #4 unpublish-flip deletion | **Substantially closed** (`published-removals.ts` drops removals when the corpus copy is already unpublished — the data-loss ordering is dead; anonymous unaffected). Residuals: (P3) sub-second crash window (removal persisted to snapshot + watermark advanced past the flip by another card + worker dies pre-delta) still un-healable behind gate tolerance; (P2, session-only) mirror direction unguarded — unpub→pub flip removals on author/editor listeners can transiently delete the newer published version until reload. |
| #5 corrupt-record lockout | **CLOSED** (confirm-and-discard on both record kinds; throw-before-clear gone). Corner (P3): if data never fully loads, resume never errors → no Stop button → still no UI escape. |
| #6 resume lies / deleted targets wedge | **CLOSED for multi-edit** (resume from stored targetIDs; removed docs skipped + honestly counted). Residuals: permission-denied reads still wedge (retryable/abandonable, honest message); the **bulk-tag** sibling still validates via Redux and wedges on deleted targets (`data.ts:484-485`). |
| #7 oversized single-card edit unsavable | **PARTIALLY-CLOSED**: split+replay design is recovery-safe on the designed path (pre-op card persisted before any prefix commit; idempotent replay; marker strictly after fanout via `commitFanoutThenMarker`) — but see **R2-1** for the boundary case that violates it. Minor: replay-from-stale-base has no `updated` precondition (inherent last-write-wins, undocumented); unguarded localStorage quota write at `data.ts:826`. |
| #8 editing unfenced while unverified/stale | **PARTIALLY-CLOSED** (durable commits gated on live at start + per-chunk; editor stays open, draft intact). `editingStart` still ungated; no `updated`-precondition. **See R2-3 for the regression.** |
| #9 SW reload gate | **CLOSED** (inFlightMutationCount in gate + beforeunload + controllerchange re-check; `_updateReloading` reactive with 15s timeout; cross-tab BroadcastChannel implemented — safe tabs auto-reload, unsafe tabs get a banner; uncontrolled-session announce fixed in index.TEMPLATE.html). Residual (P3): an unsafe tab keeps the old shell after activation purged old-hash chunks → lazy-import white-screen window until the user reloads; grep-based tests only. |
| #10 rules admin carve-out | **CLOSED**, no widening (hasOnly + request.time preserved; shared function so the TIGHTEN closes both branches; admin-context staged test added). Bonus: card delete now **requires** an atomic tombstone (closes the P3), consciously breaking stale-client deletes post-deploy. New minor: `tombstones` update allowance lets privileged editors refresh existing tombstones standalone (spurious re-delivery; benign). TIGHTEN still runbook-enforced only. |
| #11 stale SEO deploy | **CLOSED in code** (SEO regenerated before build in both deploy paths; order-pinning test added). |
| #12 find-dialog latency | **PARTIALLY-CLOSED**: query slot now fast-resubscribes (throttle removed); editing/link-picker path never used the worker (no regression). Remaining: first filtered query still pays full-corpus normalization synchronously on the worker loop (multi-second first-find stall) — arguably now *more* likely to be the first payer since the stars landing collection got a bypass; and the R2-4 `descriptionSerialized` bug re-introduces the latency on reopen-same-query. Re-measure on DEV after the next deploy. |
| #13 similarity hang | **CLOSED** (terminal sentinel version-gated; online-retry; store.ts catch + root cause removed; jitter added). Accepted residual: server outage while `navigator.onLine` stays true → permanent fingerprint fallback for that card version (was: hang). |
| #14/#18 worker fencing | **PARTIALLY-CLOSED, well-built core**: snapshot + sync-meta writes are true IDB-transaction compare-and-sets against an owner token claimed with `epoch <= mine` semantics — snapshot **reused** (not discarded) across takeovers, warm boot preserved. Remaining: Firestore SDK persistent cache itself is unfenced (~1-2s dual-`forceOwnership` overlap after thaw; unbounded on the published/author/editor connection which has no epoch guard at all); 868ad119 widened superseded-listener detection to ≤1s+load-duration but did not weaken write fencing. |
| #16 ghost reconciliation vs slow prime | **CLOSED** (published listener deferred until the compact prime is merged; fallback prime can't introduce published ghosts; re-attach re-runs reconciliation). |
| #17 blocked tabs network-active | **PARTIALLY-CLOSED**: supersession + worker-failure paths now disconnect everything enumerated (incl. keepSlugLegalWarm and the fire-and-forget published listener). **Still open:** a contended-at-boot second tab and a reloaded-superseded tab never call the disconnect (listeners attach via main-view/signInSuccess with no ownership gating); cross-tab sign-in re-attaches in inactive tabs with nothing to tear down again. |
| #19 order-sensitive audits | **PARTIALLY-CLOSED** (references compare now deepEqual; run.js uses isDeepStrictEqual + sorted tags). `perf-harness-api.ts:133` still JSON-stringifies tag arrays; the on-DEV re-run of the 100-card audit hasn't happened (do it after the next dev deploy). |
| #20 background-tab crawl | **Acknowledged** via a "Keep this tab visible…" hint in the multi-edit dialog progress UI. Executor still main-thread; acceptable. |
| Mass-reconciliation guard (P3) | **CLOSED** (double-confirmation with signature reset; partial-corpus mass purge shown unreachable via `corpusSizeTrustworthy` symmetry). Nits: 1s confirm re-request skips the canRunCollections check; worker answers corpus-IDs ungated. |
| F8/F9/F10 minors | F10 closed (projectID-keyed sync-meta; emulator override). F8/F9 partial: sign-out clears only live-transition (closed-page revocation and uid-switch leave records at rest); snapshot card validation still shallow. |
| corpus-mode escape hatch (P3) | **CLOSED for prod** (`diagnosticModesAllowed` forces on+watermark off the allowlisted hosts). Nit: config-specific hostname hardcoded in generic source; `*.firebaseapp.com` dev alias excluded. |

## Test-quality (round 2)
The pattern persists: every new mechanism ships with pure-helper unit tests plus source-text greps (`ownership-lease` decision table, `listener-trust` truth table, `durable-operation-recovery` helper, fanout-ordering helper, SW grep-asserts, SEO order grep). The three genuinely hard zones — bridge ownership state machine end-to-end, corpus-worker listener/prime orchestration, durable executor loop — still have **zero behavioral coverage**, and both R2-1 and the original #1 lived exactly there. At minimum, add: a jsdom/behavioral test that `writeOwnershipHeartbeat` consults the decision before `setItem`; an executor test that drives a chunk to the batch boundary and asserts marker-vs-fanout ordering; a worker test harness for listener trust semantics (fake snapshots with fromCache/hasPendingWrites).

---

# ROUND 1 (2026-07-22) — original findings

**Date:** 2026-07-22. **Reviewer:** independent adversarial review (5 parallel deep code audits + test/build reruns + live DEV browser verification + emulator harness rerun). **Scope:** the whole branch vs `master`, with emphasis on commits `acc19b8c` (durability/single-tab hardening) and `a0009ce1` (warm-boot/navigation/similarity performance).

**Verdict: NOT READY to land.** One confirmed ownership-fencing blocker, one confirmed data-loss edge, one confirmed watermark-soundness hole, plus several correctness majors. The core architecture held up well under adversarial reading (see "Verified sound" at bottom) — the defects are concentrated at the edges and in exactly the zones with no behavioral test coverage.

Every finding below was either verified directly in source by the coordinating reviewer (marked **[verified]**) or reported by a focused audit agent with file/line evidence. Line numbers are as of `a0009ce1`.

---

## P0 — Blockers (fix before landing)

### 1. [verified] Heartbeat writer clobbers the fencing token after a forced takeover
- **Where:** `src/corpus-bridge.ts:232-243` (`writeOwnershipHeartbeat`), interval at `:250-254`, storage-event fence at `:1331-1337`, forced steal at `:1124-1157`.
- **Defect:** `writeOwnershipHeartbeat` writes the lease keyed only on local `ownershipState === 'active' && ownershipEpoch` — it never calls `ownsCurrentEpoch()` first. A force-superseded frozen/throttled tab is fenced only by (a) the queued `storage` event and (b) per-write lease validation. On thaw, the tab's own heartbeat `setInterval` callback and the `storage` event race with **no guaranteed ordering** (different task sources).
- **Failure:** old tab frozen → new tab does "Use this tab" → 12s timeout → `forceStaleTakeover` steals lock, writes epoch E+1. Old tab thaws; if its heartbeat interval runs before its storage event, it rewrites the lease as `{tabID: old, epoch: E}`. Then: (1) old tab's `ownsCurrentEpoch()` passes → `beginMutation` admits Firestore writes from a tab that no longer holds the Web Lock; (2) the storage handler subsequently early-returns (`ownsCurrentEpoch()` is now true) — the fence **never** engages; (3) the legitimate new owner's storage handler sees a foreign lease → it purges and deactivates itself, releasing the stolen lock; (4) any third tab acquires the free lock → two concurrently active tabs, plus the stale tab's never-terminated worker.
- **Fix direction:** heartbeat (and the `store.subscribe` safety writer at `:1339-1344`) must validate `ownsCurrentEpoch()` before writing and self-deactivate on mismatch. Also add revalidation on `visibilitychange`/`pageshow`/`resume` — no such handler exists in the bridge today. The comment at `:1329-1330` ("the synchronous validator in beginMutation already blocks writes even before this event") is false once the tab's own heartbeat destroys the token that validator checks.
- **Tests:** zero coverage of lease/heartbeat/steal/storage-event fencing. The perf harness's one-shot `FROZEN OWNER TAKEOVER OK` pass just means the storage event won that particular race — it does not exercise the interval-first ordering. Add a unit-level test for the ordering (heartbeat fires while lease shows a foreign higher epoch).

### 2. [verified] Unrelated durable save silently deletes the crash-recovery draft
- **Where:** `src/edit-draft.ts:131-136` (`card-web-single-save-confirmed` handler), `src/actions/data.ts:746` (event fired for every `kind:'single'` durable op), `src/actions/permissions.ts:95,112` (permissions edits route through `modifyCard` → durable single path).
- **Defect:** the confirmation event carries no cardID/operation identity; the handler clears the single global draft slot whenever the user isn't currently editing.
- **Failure:** crash leaves a recoverable draft for card A (banner shows). User, not editing, removes an editor from card B on the permissions screen. That save confirms → `clearEditDraft()` runs → draft A silently destroyed. Cross-tab variant: tab A's save confirmation clears tab B's live draft (single global localStorage key).
- **Fix direction:** stamp the event (and the persisted draft) with cardID + a per-operation id; clear only on match. Consider per-card draft slots.
- **Tests:** `test/edit-draft/test.js` greps for the source text of the buggy line — it asserts the bug's *presence*. Replace with behavioral tests (draft for A + confirm for B → draft survives).

### 3. [verified] Delta listener contaminates the watermark from cache/pending-write deliveries
- **Where:** `src/worker/corpus-worker.ts:1193-1204` (delta handler) vs the prime path's defense at `:1477`; tombstone processing called from listener regardless of `fromCache` (`:1149-1158`, `:1068`).
- **Defect:** the delta handler runs for `fromCache` snapshots too; cards parse with `serverTimestamps: 'estimate'` (local clock for pending writes), yet the handler unconditionally does `clientClockCardIDs.delete(id)` (**un**-contaminating) and advances `sessionWatermark` from `card.updated`. This violates the invariant documented in `src/worker/watermark.ts:5-10` and at `corpus-worker.ts:991-1003`.
- **Failure:** worker inherits a pre-branch persistence DB holding an unacknowledged offline write; delta's initial cached snapshot includes it with `updated ≈ local now`. Local clock fast by > the 5-min margin → (a) listener re-attach bound skips server commits older than the polluted watermark, permanently and silently; (b) the id is gone from `clientClockCardIDs`, so `saveCorpusSnapshot` persists the fake timestamp as trusted → next boot's derived watermark is polluted too. Count-based trust gate cannot detect stale *content*. Same pattern can contaminate `meta.tombstoneCursor` from cache-estimate `deleted` values.
- **Fix direction:** in the delta handler (and `processTombstones` when invoked from a listener delivery), skip `clientClockCardIDs.delete` / `advanceWatermark` / cursor advance for docs with `metadata.hasPendingWrites` or snapshots with `metadata.fromCache` — i.e., mirror the prime path. Add the missing listener-semantics tests (none exist).

---

## P1 — Correctness / data-integrity majors

### 4. Unpublish-flip can permanently delete a card from the worker corpus
- **Where:** `src/worker/corpus-worker.ts:328-341` (`parseSnapshot` collects `removed`), `:358-361` (unconditional corpus delete). Compare the legacy main-thread guard at `src/actions/data.ts:2381-2394` which defends Redux against exactly this race.
- **Failure:** published→unpublished flip emits `removed` on the published listener while the delta listener delivers the newer unpublished version. Ordering is safe only by accident of SDK target-creation order; after a published-listener error/re-attach the order flips, and the removal deletes the **newer unpublished version already ingested**. Nothing heals it (its `updated` ≤ watermark; gate tolerates ±5/partition; loss persisted into the snapshot). Device-local permanent card loss.
- **Fix direction:** guard worker-side removals: never remove a corpus entry whose current `updated` is newer than the removing snapshot's view, or route published-removals through the flip-aware logic the delta side already has (comment at `:1186-1188`).

### 5. Corrupt bulk-tag record permanently locks out all editing; the escape hatch throws
- **Where:** `src/actions/data.ts:356-358` (`readBulkTagOperation` throws on corrupt), `:310-320`, `:571-573` (`abandonPendingBulkTagOperation` calls it unguarded — throws before `clearBulkTagOperation()`), `src/actions/editor.ts:307` (`editingStart` refuses while "pending").
- **Failure:** corrupt localStorage record → every `editingStart` refused forever; "Stop retrying" throws. Only manual site-data clearing recovers. Same unguarded `readDurableMultiEdit()` at `:574`.
- **Fix direction:** try/catch in the abandon path → treat corrupt as discardable; offer explicit confirm-and-discard like the multi-edit path (`:777-780`).

### 6. Durable multi-edit resume can wedge permanently with a lying error
- **Where:** `src/actions/data.ts:663-666` (resume maps targets through `selectRawCards` and filters missing), `:696` (`Could not load N target cards`), `:769-773` (JSON-equality check → `'A different multi-edit is already pending…'`).
- **Failure:** (a) Retry before data loads → filtered list ≠ stored list → misleading "different multi-edit pending" error; (b) a target deleted mid-operation → every resume fails forever with the wrong message; no skip-deleted path. The executor reads authoritative server docs anyway — the Redux filter+equality check is the only thing failing.
- **Fix direction:** resume from the stored `targetIDs` directly; tolerate/skip deleted targets with an honest completion note.

### 7. Single-card edit with large reference fanout is permanently unsavable via the durable path
- **Where:** `src/actions/data.ts:733-735` (throws when `candidateSize === 1` chunk still exceeds one Firestore batch) vs `shared/multi_batch.ts:148-167` (oversized-group splitting exists precisely because an earlier revision's throw "made such cards PERMANENTLY unsavable").
- **Failure:** ~240+ changed inbound-reference mirrors → intent already persisted, editor closed → unwinnable retry loop; user must abandon; the edit can never be saved. (Halves to ~120 if the sentinel-shape detector fails, `src/multi_batch.ts:73`.)
- **Fix direction:** for `candidateSize === 1`, fall through to the shared MultiBatch oversized-group split with its ambiguity-based recovery, rather than throwing.

### 8. Editing is not fenced while the corpus is `unverified`/`stale` (stale-base lost updates)
- **Where:** `src/mutation-barrier.ts` fences only tab ownership; `src/actions/data.ts:840+` commits blind field diffs with no `updated` precondition. Warm boot serves the snapshot into Redux before the trust gate.
- **Failure:** user opens a days-old snapshot card during `unverified` (or a `stale` outage) and saves → clobbers newer server field values. The serve-stale-first architecture materially widens a pre-existing window.
- **Fix direction:** minimum: fence card saves on `syncState !== 'live'` (with clear UI); better: `updated`-precondition (transaction) on single-card commit.

### 9. SW reload gate is blind to in-flight tracked mutations; cross-tab activation breaks other tabs
- **Where:** `src/components/card-web-app.ts:262-272` (`_activateUpdate`), `:382-386` (`_unsafeExitReason` — omits `inFlightMutationCount()` from `src/mutation-barrier.ts`, even though the ownership handoff's own "pending" definition includes it, `src/corpus-bridge.ts:226`).
- **Failure A:** post a comment (fire-and-forget `trackMutation(runTransaction(...))`, e.g. `src/actions/comments.ts:102`) → click Reload → transaction killed, comment lost; no beforeunload backstop.
- **Failure B:** accepting the update in tab A activates for every tab (`clientsClaim: true`); other tabs keep the old shell, old-hash lazy chunks get purged from precache → later lazy import 404s → Firebase rewrite returns index.html as module body → broken navigation, possibly over a dirty edit. Cancel-path: `_updateReloading` latches true (plain field, not `@state`) → dead Reload button.
- **Fix direction:** include `inFlightMutationCount()` in the gate + beforeunload; re-check at `controllerchange` before reloading; broadcast activation so other tabs offer reload; make `_updateReloading` reactive and resettable.

### 10. Rules: staged inbound-reference `updated` carve-out doesn't cover admin clients
- **Where:** `firestore.TEMPLATE.rules:169-187` — `cardEditInboundReferences()` (where `updated` is optional during the staging window) sits only in the **non-admin** branch; admins get `bumpsUpdated() || cardEditMinor()` only.
- **Failure:** a stale pre-branch **admin** bundle (the primary editor of this corpus) doing a link-affecting edit writes `references_inbound` on other cards without `updated` → denied. The transition protection protects everyone except the account it matters for; `skipWaiting: false` makes stale bundles live longer.
- **Fix direction:** either include the carve-out for admins during the staging window (with the same TIGHTEN note) or deploy rules+hosting simultaneously and accept loud failures. Add an admin-context staged test (the existing staged test uses `genericAuth` only). **And:** the cutover to `assertFails` (closing the watermark-unsoundness window, `rules:176-179`) must be an enforced checklist item — nothing currently guarantees it happens.

### 11. Deploy ordering ships the previous cycle's SEO pages
- **Where:** `tools/cli.ts:289-312` — `build()` copies `seo/` → `build/seo` **before** `generateSeoPagesOptionally()` regenerates it.
- **Failure:** first post-branch deploy from a machine with pre-branch `seo/` publishes ~1240 `/c/**` pages still containing the old `location.reload()`-on-updatefound bootstrap — resurrecting auto-reload-over-edits exactly on card URLs until a second deploy. (Verified the **currently deployed** DEV index + SEO pages already carry the new bootstrap, so DEV is fine today; this is a live process trap for the PROD cutover.)
- **Fix direction:** regenerate SEO before the copy, or add a build-time guard that deployed SEO pages embed the current bootstrap. `test/service-worker-update/test.js` checks only `index.TEMPLATE.html`.

---

## P2 — Majors (performance/UX/robustness, not data loss)

### 12. Find dialog renders honest-empty then takes seconds to show results (worker mode) — **measured on real DEV**
- **Where:** `src/corpus-bridge.ts:646-660` (`fastResubscribeOnDescriptionChange` covers only the 'active' slot); the find 'query' slot subscribes only inside `runShadowCompare` (`:584-585`) behind the 1s throttle (`:547-553`); `src/selectors.ts:1954-1958` fabricates an empty result until the worker push lands.
- **Measured (signed-in real DEV, 40,225-card corpus, background-throttled tab so treat as upper bounds):** two queries against a warm live corpus — list visibly *emptied at 7-10ms* after the query dispatch, first real results rendered at **5.7s and 6.1s**. Even discounting throttling this is seconds, not the sub-second feel the product wants, and the structure (honest-empty + 1s throttle + worker round trip) repeats on *every* keystroke, not just the first search.
- **Effect:** every keystroke's new description → empty list for throttle + worker compute + push. This structurally explains (and broadens) the known "first find search" caveat. The harness's "find 350ms" measures only `find.activeQuery` landing in state (`test/perf-harness/interactions.js:120-123`) — result latency is never certified.
- **Fix direction:** extend fast-resubscribe to the query slot (or exempt query-slot subscription from the shadow-compare throttle); consider serving find from the previous result set while the new query computes instead of honest-empty.

### 13. Similarity transport give-up leaves `preview` collections stuck; `waitForFinalCollection` hangs forever
- **Where:** `src/actions/similarity.ts:142-146` (after 3 transport failures returns 'done' with **no** `UPDATE_CARD_SIMILARITY` sentinel), `src/filters.ts:895` (memoized generator never re-requests), `src/actions/collection.ts:499-527` (`waitForFinalCollection` loops on `collection.preview`).
- **Effect:** after a transient offline blip, programmatic consumers (AI/suggestion flows) await forever. UI itself degrades gracefully to fingerprint fallback.
- **Fix direction:** dispatch a terminal sentinel on give-up; add a retry trigger on connectivity restore. Zero tests exist for the `actions/similarity.ts` policy layer.
- Related **unhandled rejection**: `src/store.ts:68-73` calls `fetchSimilarCardsIfEnabled` with no catch; it throws when the card is missing from `selectRawCards` (`similarity.ts:186`).

### 14. Worker has zero fencing on shared IndexedDB; a superseded frozen tab's worker survives takeover
- **Where:** `src/worker/corpus-worker.ts:614-626` (two `persistentSingleTabManager({forceOwnership: true})` clients on one DB after a forced steal = SDK-undefined behavior), `src/worker/corpus-snapshot.ts:113-131` (no epoch token in the record/put), sync-meta saves at `corpus-worker.ts:1365/1377`.
- **Effect:** in the forced path the frozen tab's worker is terminated only after the old main thread processes the storage event post-thaw; meanwhile the worker thread resumes independently, draining queued watch changes and scheduling IDB writes concurrently with the new owner's worker. Snapshot degrades to stale-but-coherent (single atomic put); the Firestore SDK cache itself is the real corruption exposure. Compounded by finding #1 (worker may never be terminated).
- **Fix direction:** include the ownership epoch in snapshot/sync-meta records and have the worker validate epoch (supplied at spawn/handoff) before persisting; terminate the worker from the storage-event fence *before* any other work.

### 15. Trust-gate blind spots for rule-bypassing writers
- **Where:** `src/worker/corpus-worker.ts:933-959`. Count-based per-partition gate: a console delete (ghost) plus an admin-SDK doc with stale `updated` in the same partition cancel arithmetically; directional tolerance accepts up to 5 stale-missing docs per partition forever. `tools/migrate-nlp-tokens.mjs:208-211` deliberately backfills without a bump → warm devices keep stale search tokens until each card's next edit.
- **Fix direction:** document the discipline requirement for all admin scripts loudly (or add a periodic id-sample cross-check); consider a maintenance "resync partition" affordance.

### 16. Published-ghost reconciliation races a slow snapshot prime
- **Where:** `src/worker/corpus-worker.ts:673-685` — one-shot ghost reconciliation at first server published delivery; the compact-snapshot prime is an independent IDB load observed taking ~16s when queued (`:1420-1423`). If the server snapshot wins, snapshot ghosts are primed after reconciliation and persist indefinitely (published partitions have no count gate, no tombstone for console deletes).
- **Fix direction:** re-run ghost reconciliation after the prime lands (or gate prime-merge on the reconciled server id-set).

### 17. Blocked/superseded tabs are UI-inert but network-active
- **Where:** `src/actions/database.ts:180-336, 626-666` (messages/threads/authors/sections/tags listeners attach in every tab), `:169-176` (`keepSlugLegalWarm` cloud-function call every 2 min from a blocked tab), fire-and-forget card `onSnapshot` at `:402` never unsubscribed in a superseded shadow-fallback tab (silently repopulates purged Redux behind the gate).
- **Effect:** billing/traffic deviation from "fully blocked/inert"; no write-safety hole (writes fenced; main thread on memory cache).
- **Fix direction:** tear down non-card listeners and the slug-warm interval on deactivate.

### 18. Multi-edit status can lie across tabs; concurrent-op Save is a silent no-op
- **Where:** `src/components/card-web-app.ts:387-391` ('Save paused' + Retry only render from *this tab's* Redux error; other tabs show 'Saving card…' indefinitely; resume triggers are only readiness transitions + `online`, `data.ts:790-807`); `src/actions/data.ts:641,380` (Save while another durable op runs returns silently).
- **Fix direction:** storage listener for cross-tab durable-intent state; explicit feedback on the guard return.

---

## P3 — Minors / polish (grouped)

- **Chunked optimistic echo** can briefly mask a concurrent foreign edit in the enqueue buffer (`src/actions/data.ts:1038-1055`, `src/reducers/data.ts:150-160`); self-heals on the server echo. Note only.
- **Rules: card delete does not require a tombstone** (`existsAfter` demand absent) — an old/hostile editor client can delete an unpublished card tombstone-free → ghost until the count gate catches it. Add to the cutover checklist alongside the `updated` tightening.
- **Snapshot-at-rest after sign-out:** `disableCorpusSnapshotPersistence` (`corpus-worker.ts:320-326`) drops the handle but never deletes the `corpus-worker-snapshot` record — full unpublished corpus stays readable at rest for a signed-out uid. Delete the record on auth-revocation.
- **`validCorpusSnapshot` doesn't validate card values** (`corpus-snapshot.ts:65-80`) — corrupted record round-trips junk into Redux.
- **sync-meta key mismatch:** `dev|prod:uid` (`corpus-worker.ts:1418`) vs snapshot's `projectId:uid` (`:1427`) — the `demo-perf` emulator shares the real dev sync-meta record (tombstone cursors/sweep state).
- **Mass-removal guard** (`corpus-bridge.ts:774`): a legitimate >max(50, 10%) bulk deletion while away is never reconciled (console-warn only) — stale cards linger in Redux until reload.
- **`uploadBytes` outside the mutation barrier** (`src/actions/editor.ts:763`) and outside the AST enforcement test's covered call set.
- **`ensureUserInfo` writes before the fence engages** (`src/actions/user.ts:120-131`) — idempotent, low risk.
- **`off`/`spike` localStorage escape hatch** (`src/corpus-mode.ts:30-61`) bypasses locks/fence entirely and can coexist with a live `'on'` owner in another tab. Console-only surface; consider making mode changes ownership-aware.
- **No retry jitter** in similarity backoff (`similarity-retry.ts:169`); lockstep herd after shared outage (n≤8).
- **Reference-block worker recompute lost its memoization** (`src/reference_blocks.ts:328-366` + unconditional `stateChanged` scheduling in `card-view.ts`/`card-info-panel.ts`): ~10 whole-corpus `runCollection` calls re-run on any store churn with identical inputs. Off-thread but standing waste.
- **Update announce misses uncontrolled sessions:** `announceWaitingUpdate` requires `navigator.serviceWorker.controller` (`index.TEMPLATE.html:61`) — hard-reloaded sessions never see a waiting update (heals next load).
- **Doc drift:** `corpus-bridge.ts:731-733` describes a Web-Locks path that now lives in the page, not the worker.

### 19. Harness field-fidelity audits are key-order-sensitive and false-fail on real data
- **Where:** `src/perf-harness-api.ts` `bulkTagRoundTrip` (`JSON.stringify(current?.references || {}) !== JSON.stringify(originals[card.id].references)` and siblings); the outer emulator runner's audits share the pattern.
- **Observed on real DEV:** `bulkTagRoundTrip(100)` failed **deterministically twice** (same card `59446f`, including after a full page reload) with `non-tag field changed`. Full diagnosis: the card's Firestore doc was never touched beyond tags (audit subcollection shows only `add_tags`/`remove_tags` writes; body byte-identical local vs server; restore complete) — the local `references` map simply re-materialized with a **different key enumeration order** after the round trip's echo than the pre-op snapshot had. The emulator's synthetic corpus happens to have stable ordering, which is why the prior runs passed.
- **Why it matters:** (a) the branch's headline "exact fields audited" guarantee is weaker than claimed — the audit can both false-fail (seen) and, more importantly, its ordering-fragility means nobody has proven order-*insensitive* equality; (b) it reveals that optimistic-echo/rebuild paths do not preserve reference-map key order (benign for Firestore semantics, but any other order-sensitive consumer would break).
- **Fix direction:** replace JSON-stringify comparisons with key-insensitive deep equality in the harness; re-run the 100-card audit on real DEV afterward.

### 20. Background-tab throttling makes durable bulk operations crawl (correct but extremely slow)
- **Observed on real DEV (hidden tab):** the full 100-card durable multi-edit **apply took 51.8s** and the **restore 701s (11.7 minutes)** wall-clock — versus ~5.3s/5.6s in the foreground emulator harness. No timers exist in the chunk loop itself (`src/actions/data.ts:689+` is sequential authoritative reads + commits per ≤10-card chunk), so the inflation is Chrome background throttling of the tab's event loop/network scheduling. Correctness held: every field, tag mirror, TODO override, reference, published flip, and the target card's `references_inbound` mirror verified restored directly from Firestore afterward.
- **Why it matters:** users background a tab mid-bulk-edit as a matter of course. The operation is durable/resumable, so nothing is lost — but a "20 seconds for 100 cards" budget silently becomes 10+ minutes with no explanation, and the durable-intent banner is the only telltale.
- **Fix direction:** surface progress + an explicit "keep this tab visible to finish faster" hint while a durable op runs hidden; longer-term consider moving the executor off the main thread (the corpus worker already owns Firestore access patterns that would fit).

---

## Test-quality findings (systemic)

The pure-helper suites are genuinely good (watermark, dedupe, snapshot validation, readiness, retry, wire-format; `test/updated-invariant`'s 717 lines incl. guard↔rules drift gate; `test/mutation-barrier`'s AST sweep). But the three hardest components have **zero behavioral coverage** exactly where the P0/P1 findings live:

1. `src/corpus-worker.ts` (1,870 lines of listener orchestration, cache-vs-server semantics, prime/reconciliation ordering) — no direct tests. Findings #3, #4, #16 live here.
2. `src/corpus-bridge.ts` ownership state machine (lease, heartbeat, steal, storage fencing, handshake) — no tests. Finding #1 lives here.
3. The durable mutation executor (`data.ts`) — no behavioral tests; `test/edit-draft/test.js` and parts of `test/perf-harness/multiedit-coverage.test.js` are **source-text greps**, one of which asserts the buggy line of finding #2 exists.

`test/service-worker-update/test.js` is also grep-based (26 lines) and checks only the template, not generated SEO output (finding #11).

---

## Claims audit (reproduced vs challenged)

| Claim | Status |
|---|---|
| Full `npm test` + production build pass | **Reproduced** (Node 20; suite green, build clean). Note: suite fails immediately under Node 18 (firebase-tools requires ≥20) — `.nvmrc` exists; consider an `engines` guard. |
| `perf:local` 12k harness passes | **Reproduced only with `--load-timeout 600000`** and the repo-local firebase-tools. At the shipped 300s it timed out on this machine (cold sweep ≈290s); all correctness gates then passed (two-tab takeover w/ dirty-edit preservation, superseded reload, frozen-owner steal, simultaneous takeover single-winner, crash recovery). Advisory budgets breached: nav p95 27ms (>16), warm usable/live ≈19.2s (>10s/15s) — emulator-slow, matches prior caveat. |
| 60 ArrowRight: 33ms med / 43 p95 / 47 max, no storm | **Not reproducible from the repo** (committed harness drives 20 navs; numbers nowhere in-tree; similarity request count never instrumented). Independently on real DEV (anonymous, 40-card sections): 60 navigations, per-dispatch 0.1ms median / 0.9 p95 / 1.6 max, `SHOW_CARD` max 44.9ms across the session, zero similarity network calls. Signed-in similarity-under-navigation not independently measured. |
| Warm boot 10.30s median (real DEV, signed-in) | **Partially corroborated.** Worker-side warm prime independently measured on real DEV signed-in: **40,225 cards from the compact snapshot in 5.79s** (load 2.53s / workerState 1.23s / forward 2.03s), trust gate 0 mismatches, then live. End-to-end wall clock was not fairly measurable in the review environment (Claude browser pane tabs are permanently `visibilityState: "hidden"` → timer/render throttling; observed 50s+ is an artifact). 10s target remains plausible and slightly-exceeded per the prior 10.30s figure; re-verify by hand once fixes land. |
| Takeover CTA end-to-end in real Chrome | **Verified on real DEV signed-in** with one caveat: the gate appears, is clear, "Use this tab" completes a cooperative handoff in <5s (lease epoch 4→5), old tab shows "Compendium moved to another tab", `main-view` is `inert`, reclaim CTA offered. The click was delivered programmatically (`button.click()` in the gate's shadow root) because the review pane's coordinate-synthesized clicks do not activate the shadow-DOM button — same limitation the implementing agent hit; not evidence of an app bug. One human click remains the final confirmation. **UX gap observed:** after clicking, the dialog gives zero pending/failure feedback while the (up to 12s) handshake runs — it just sits there. Add a "Moving card sync…" progress state and surface `fresh`/`unsafe`/`lost` outcomes. |
| Typing 3.28ms/char | **Corroborated and beaten**: 40 keystrokes against the live 40k corpus, per-keystroke `textFieldUpdated` dispatch **0.2ms median / 0.8ms max**; editor cancel left the body byte-identical. (Dispatch-level; paint excluded by the hidden-tab environment, but nothing heavy sits on the keystroke path — see verified-sound list.) |
| Save 418ms perceived + authoritative readback | **Corroborated via the durable single-op path on real DEV**: 1-card durable tag op server-confirmed in **625ms** (add) / **561ms** (remove) in a background-throttled tab, including the executor's authoritative `getDocFromServer` preflight and the tag-mirror server verification. Sub-1s criterion met with margin; the body-edit variant of the same executor was not separately timed. |
| 100-card multi-edit ≈3-5.6s with exact restore | **Correctness fully verified on real DEV; timing environment-confounded.** The complete dialog matrix (remove 1 tag + add 2 tags + TODO enable + TODO disable + add reference + publish flip; then full inverse) ran against 100 real cards; afterwards a direct-from-Firestore audit confirmed exact tags (no leakage), `published:false`, overrides removed, reference gone, both tag mirror docs clean, and the target card's `references_inbound` mirror empty. Wall-clock in the hidden tab was 51.8s apply / 701s restore (finding #20); the emulator harness's foreground ~5s figures and its 20s-ceiling test remain the timing evidence. Also surfaced finding #19 (the harness's own 100-card audit false-fails deterministically on real data). |
| First-find-after-deferred-index caveat | **Explained structurally and confirmed empirically** by finding #12 — not first-search-only; measured 5.7-6.1s to first result on the real 40k corpus (throttled upper bound), with the honest-empty state visible within ~10ms. |
| Cancelled similarity requests retain slots until the non-abortable call settles | **Verified correct in code and by test** (`similarity-retry.ts` acquire/release exactly paired; `_cancelEntry` never touches `_activeRuns`; LRU-8 pending + latest-wins drain bounds rapid-nav work). |
| Compact-snapshot timestamps can't skip newer updates / resurrect tombstones | **Refuted in one path** (finding #3); tombstone/deletion catch-up machinery otherwise verified sound (atomic tombstone+delete, cursor-margin overlap, cache laundering, recreated-card suppression). |

---

## What remains unproven even absent a bug

- End-to-end warm-boot wall clock on real foreground hardware (environment-limited here; worker-side prime independently measured at 5.79s for 40,225 cards on real DEV, trust gate clean — the 10s end-to-end target is plausible but should be re-timed by a human after fixes land).
- Foreground timing of the 100-card multi-edit on real DEV (correctness proven; wall clock confounded by background throttling — see finding #20).
- The perceived-latency path of a *body* edit save specifically (same executor as the verified 625ms durable single op, but not separately timed end-to-end).
- Similarity behavior under rapid signed-in navigation on real DEV (Qdrant path).
- The human-click activation of the takeover CTA (programmatic click verified end-to-end on real DEV signed-in; coordinate-click unverifiable from this tooling).
- Service-worker update banner flow in a real dirty-edit session (code-reviewed only; grep-tests).

## DEV-project side effects from this review

- Sign-in-driven cold sweep (~80k billed document reads across two tabs' cold boot + partition repairs — the documented once-per-device Blaze cost) and one ownership handoff.
- **Mutations (all verified restored from Firestore directly):** three `bulkTagRoundTrip` runs (1 + 100 + 100 cards; tag `bits-and-bobs` added then removed; the two 100-card runs completed their server work then threw only in the client-side comparison — finding #19); one `durableMultiEditRoundTrip(100)` (tags `bits-and-bobs`/`cambrian-garden`/`chaotic`, TODO overrides, reference to `02af83`, temporary publish flip — full inverse applied and server-audited). Residue: `updated` bumps on the touched cards, audit docs in their `updates` subcollections and tag update mirrors, marker docs in `users/<uid>/multi_edit_chunks`, and a ~1-minute window during which 100 normally-unpublished cards were briefly `published:true` on DEV. No content fields (body/title/notes/references beyond the round trip) were altered anywhere; card `59446f` and sample cards spot-checked byte-identical.

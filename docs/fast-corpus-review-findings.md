# Independent review: `implement/fast-corpus` — findings for remediation

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

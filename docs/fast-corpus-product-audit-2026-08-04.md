# Product audit: should `implement/fast-corpus` land?

**Date:** 2026-08-04 · **HEAD:** `cc952726` · **Perspective:** product / end-user,
not code review. The engineering-level findings live in
`docs/fast-corpus-landing-review-2026-08-02.md` (Rounds 13–17); this document
answers the question those rounds don't: *is this ready, what will users
notice, and what will we regret in three months?*

Evidence base: five adversarial review rounds (~20 reviewer-agent passes),
live measurement on real DEV at 40,225 cards across four sessions, side-by-side
screenshots of **prod (master) vs dev (this branch)** as an anonymous visitor,
and 781 green tests. (Methodology note: two supporting analyses planned as
independent agent passes — the regret pre-mortem and the persona journeys —
were lost to repeated API outages; those sections are the coordinating
reviewer's synthesis of the five prior rounds rather than independently
re-derived. The measurements and screenshots are first-hand either way.)

---

## The answer

**Yes to merging. Yes to the dev-only deploy it already has. Not yet to prod —
but the blockers are now a short, concrete list, not a cloud of doubt.**

The honest framing: this branch stopped being a performance patch a long time
ago. It is a re-founding of the app's data layer — the kind of change that is
either finished and shipped, or abandoned; there is no cheap way to hold it
half-merged for months. After five review rounds, every data-loss, privacy, and
correctness P0/P1 found has been fixed and re-verified, the fixes have stopped
regressing each other (Round 17 was the first clean round), and the remaining
risk is concentrated in exactly three places: an unexplained renderer crash, a
prod cutover with no kill switch, and the sheer size of the new machinery that
one person now has to maintain.

---

## What users actually get (the case FOR landing)

These are measured, not aspirational:

1. **The app works offline now.** An anonymous visitor with no network gets the
   full published site — 1,239 cards, sections, tags, navigation, search — in
   ~1.5 seconds. On master, offline was a blank page. For the owner, a
   backend blip no longer means a frozen app; writes queue durably and replay.
2. **Writes don't get lost anymore.** Master silently ate work: a save during a
   network blip was gone, an offline delete lied, a crash mid-edit lost the
   draft. The branch write-ahead-logs every card create/edit/delete/comment/
   star, survives reloads, replays on reconnect, reverts the UI honestly when
   a write is truly dead, and tells the user which of those happened. This is
   the single biggest user-facing quality change and it is essentially
   invisible until the day it saves you.
3. **The editor is fast at full scale.** Commit-settle was measured at 16s+ on
   master at 40k cards; it is ~1–2s now, with save p95 at 779ms. Typing and
   navigation are long-task-clean. The daily editing loop — the owner's actual
   job — is dramatically better.
4. **Boot no longer costs 40k reads.** Warm boots serve from a local snapshot
   and reconcile with ~dozens of reads; master re-billed the whole corpus far
   too often (two real quota outages during development). Anonymous readers
   went from cache-instant-*sometimes* to snapshot-instant-*reliably*.
5. **Updates stopped yanking the page.** Master force-reloaded the app the
   moment a service worker updated — including mid-edit. The branch waits for
   a safe moment and shows a banner. Small, but it removes the single rudest
   behavior in the product.

## What users will notice changed or broke

Ordered by how likely a real user is to hit it:

1. **One tab at a time (signed-in).** The most visible behavioral change in the
   product. A second signed-in tab shows a blocking "Compendium is open in
   another tab" gate with a Use-this-tab button. The takeover round-trip works
   well (measured: new tab usable in ~2.4s) — but a user with a
   two-window workflow will feel this every day. Anonymous tabs are exempt.
   *This is a deliberate design trade for cache correctness, not a bug — but it
   is the change most likely to generate a "why does it do this now?" reaction.*
2. **First boot on a new device is a multi-minute download (owner only).**
   Priority cards arrive in seconds; the full 40k-card sweep takes ~2–3
   minutes. Master's partial mode (a capped subset) was deleted, so there is no
   way to opt down on a slow connection. Steady-state boots are fine
   (loadComplete ~5–9s, live ~13s), but boot-to-live variance was measured as
   wide as 31s under backend pressure, and there is a ~2.5s main-thread freeze
   mid-boot that makes the app usable-then-stuck-then-fine.
3. **Muscle memory: `E` no longer opens the editor.** It's Cmd/Ctrl-E now
   (bare-E was a genuine data-corruption hazard — typing with the card focused
   inserted text into the card). Correct change; will still surprise the owner
   for a week.
4. **More dialogs and status chrome.** The branch tells the truth about a lot
   of things master was silent about (queued writes, discarded writes, sync
   state, blocked controls, update waiting, takeover). The copy is generally
   accurate and actionable — a deliberate improvement over silent failure —
   but the owner will see more `alert()`s in a week than master showed in a
   month, and several flows (bulk import cap, wedged writes, takeover) speak
   in system language ("intent", "sync") rather than product language.
5. **Old browsers are locked out.** Safari <15 / Firefox <114 get a clean
   "your browser can't run this" message instead of a working app. Master
   worked everywhere. Population likely tiny in 2026; nonzero.
6. **Mobile card sizing regressed (probable).** At a 375px viewport both
   builds show the same rotate-your-device presentation layout, but the
   branch renders the card ~30% smaller than master in a side-by-side
   screenshot. Single observation, unconfirmed cause — worth a look before
   prod, cheap to check.

## Visual audit (prod=master vs dev=branch, anonymous, same routes)

- **Full-page parity is excellent.** Card view, drawer, info panel with
  concepts/links/similar, comments with avatars, word cloud, find dialog —
  pixel-comparable layouts, identical result ranking in search (199 vs 197
  hits is corpus drift between the two databases, not behavior).
- **The transitional states are where the branch looks different.** On a cold
  anonymous visit, the branch shows a "Loading…" card and a drawer reading
  "0 cards *updating…*" for the first seconds where master tends to paint
  content directly. It recovers fully (and *return* visits beat master
  soundly via the snapshot). Verdict: the branch traded a slightly rougher
  first-ever visit for dramatically better every-subsequent visit. Reasonable
  trade; the "0 cards updating…" copy in the drawer is the one piece worth
  polishing — an empty-but-loading list reading "0" invites "the site is
  broken" on slow connections.
- **Mobile:** same layout; the card-size delta above.
- *Methodology honesty:* late in the audit session both prod and dev began
  refusing to render for fresh profiles — almost certainly Firebase Auth
  anonymous sign-in throttling of this machine's IP after dozens of fresh-
  profile boots in one day, i.e. an artifact of the audit itself. Timeline
  comparisons after that point were discarded. The parity findings above come
  from the earlier, clean captures.

## Performance, honestly stated

| Metric | Master (measured/known) | Branch (measured) | Verdict |
|---|---|---|---|
| Anonymous first visit | content ~2–6s | comparable; rougher intermediate states | wash |
| Anonymous return visit | cache-dependent, often network-bound | **~1.5s, works offline** | branch, big |
| Owner warm boot → usable | (not directly comparable; partial mode) | ~5–9s to full corpus, ~13s to live | acceptable; watch variance (one 31s outlier) |
| Owner cold boot (new device) | partial mode capped (~minutes for subset) | ~2–3 min for all 40k, usable in seconds | different trade, net fine |
| Save (server-confirmed) | seconds; 16s+ commit stalls at 40k | p50 ~530ms, **p95 779ms** | branch, big |
| Card create → visible | n/a comparable | ~2.5s | fine |
| Find/search | main-thread, jank at scale | worker-served, results ~1.2s | branch |
| Star/read toggle | round-trip latency | optimistic ~115ms, settle ~650ms | branch |
| Boot main-thread freeze | — | **~2.5s long task mid-boot** | debt, known |
| Memory (main thread) | smaller (partial corpus) | ~580MB settled fresh; the full-corpus Redux mirror is deferred debt | debt, known |

## What we will regret in three months

Ranked by (likelihood × pain), with the leading indicator to watch:

1. **The renderer crash we shipped without understanding.** Three occurrences
   on the dev daily-driver, all under heavy long-session use; every aggregate
   lead (boot peak, nav leak, reload/takeover loops) was eliminated by
   measurement, and the strongest structural suspect (per-instance hidden-class
   explosion in the NLP fast path) was fixed — but nobody has yet proven the
   crash gone. If it ships and recurs, it hits the owner's main work tool as a
   lost tab, possibly with an open editor. *Indicator:* any `Page crashed` on
   the dev instance between now and cutover. *Mitigation:* keep the capture
   tooling (`tools/capture-heap-snapshot.mjs`) handy; treat one more
   occurrence post-shape-fix as a cutover blocker.
2. **No kill switch at prod cutover.** Prod hosting force-enables the worker
   path; localStorage overrides are ignored there. If anything is wrong at
   scale, the remedy is a redeploy of master — which strands the durable write
   queue and drops drafts (Round 15, U3). The team knows this; it is still the
   single most regrettable *operational* posture on the list because it turns
   any medium bug into a fire drill. *Mitigation:* a remotely-flippable flag,
   or at minimum un-force localStorage on prod for one release.
3. **A one-person data layer.** The sync engine + queue + lease + snapshot +
   optimistic machinery is on the order of 8–10k lines of intricate,
   invariant-driven code. It is unusually well-commented, and the Round-15/17
   test harness genuinely executes the write path now — but the sync engine's
   core (watermarks, trust gates, laundering) still has no executable tests,
   several load-bearing invariants live in comments, and the fix history shows
   17+ rounds of fix-introduces-bug on exactly these paths. The regret
   arrives with the first post-landing feature that touches writes.
   *Indicator:* the first "quick" write-path PR. *Mitigation:* the planned
   worker-body harness; require the executor-harness pattern for any new kind.
4. **Deferred memory work meets corpus growth.** Redux still mirrors all 40k
   full cards plus cardMeta; the worker holds two more copies. ~580MB settled
   today, growing linearly toward the 60k ceiling, on the same tool that has
   the unexplained crash. The windowed-memory spec exists and was deferred.
   *Indicator:* settled heap after boot crossing ~800MB. *Mitigation:* none
   needed pre-landing; schedule the mirror removal before 50k cards.
5. **Process debt: the septemberfifteen bomb and the missing CI.** `npm test`
   hard-fails on 2026-09-15 by design (a rules-tightening tripwire) — whoever
   merges after that date hits a red suite unrelated to their change. There is
   still no CI and no `engines` field, so "the suite is green" remains a
   statement about one laptop. *Mitigation:* both are sub-hour fixes; do them
   at merge time.
6. **Grown-in dev-instance coupling.** The branch hardcodes the dev hostname
   into diagnostic-mode gates, ships probe tooling, DEVMODE chrome, and a
   fix-queue culture built around one reviewer and one author. None of this
   hurts users; all of it is the kind of thing that reads strangely in a year.
   *Mitigation:* one cleanup pass post-landing.

## What we will NOT regret

- Killing the silent-data-loss class. Ten distinct loss scenarios found and
  closed during review would each have eventually cost real writing.
- The read-cost work. Two quota outages happened *during development* under
  master's model; at 60k cards master's boot economics were untenable.
- The offline story — it converts the public site from "web page" to "works
  on the subway", free.
- Deleting master's force-reload updater.
- The executor test harness — the first tests in this repo that would have
  caught the bugs this branch actually produced.

## Landing recommendation

**Merge now** (after the two sub-hour process fixes: move the dated tripwire
out of `npm test`, add `engines` + a minimal CI workflow). The branch is at its
lowest-risk point since Round 13: all known P0/P1s closed and re-verified, the
last response round introduced zero regressions, and every week it stays
unmerged is a week of 370-commit drift risk against master.

**Deploy to prod only after, in order:**
1. One more week of daily-driver soak on dev with zero renderer crashes
   post-shape-fix (or a root cause if one occurs).
2. A kill-switch decision — even a one-release localStorage un-force.
3. The runbook executed literally (rules+ALL indexes before hosting; nlp
   migration verified; the SW-upgrade one-release note).
4. A 30-minute pass on the polish shortlist: mobile card sizing, the
   "0 cards updating…" drawer copy, and the `innerTextForHTML` queue entry.

The product is better than master for every persona measured. The remaining
risk is operational, not experiential — which is exactly where a personal tool
with one operator can afford to carry it, provided the operator is the one
choosing to.

---

# Decision log (single-admin calibration)

Decisions, not options. Calibrated to the operating reality: **one
editor/admin (the owner), anonymous readers otherwise.** That reality changes
several answers — concurrent-editor hazards mostly vanish, "notify the user"
means "notify yourself," and the cheapest robust mitigation is often a
documented habit rather than new code. Format: **Decision → rationale → action.**

## Do at merge time (all sub-hour, none risky)

1. **Merge the branch.** Five rounds deep, last round clean, drift risk now
   exceeds review value. → Merge after items 2–3 below.
2. **Move the 2026-09-15 rules tripwire out of `npm test`** into its own
   script named in the runbook's Phase-6 step. A time bomb in the default
   suite punishes whoever runs tests that day for someone else's checklist.
   → `test:rules-deadline`, referenced from the runbook; not in the chain.
3. **Add `"engines": {"node": ">=20"}` and a minimal GitHub Actions workflow**
   (Node 20, `npm run build && npm test`). Yes, even for one person: half the
   commits on this branch were made by agents on machines whose Node version
   silently changed results. CI is cheaper than one more "green on the wrong
   build" incident. → ~20-line workflow, done once.
4. **Fix the drawer copy**: when the worker collection is pending, show
   "loading…" not "0 cards updating…". One-line, user-facing, zero risk.
5. **Add the `innerTextForHTML` entry to the fix queue.** Doc-only. The last
   untracked finding.

## The kill switch: decided

6. **Un-force localStorage overrides on prod; keep defaults `on`. Do NOT
   build remote config.** For a single-admin tool, the only person who would
   ever need a kill switch is you, and you can open devtools. This gives you a
   personal, instant, no-deploy rollback (`corpus-worker=off`) if the worker
   path misbehaves on your machine, while anonymous readers — who can't flip
   flags — stay on the new path where their blast radius is read-only.
   Catastrophic reader breakage still has the redeploy path. Remote-config
   infrastructure for a one-operator product is complexity with no second
   beneficiary. → Delete the `diagnosticModesAllowed()` host restriction (or
   add prod to the list); one-line change, revisit only if the product ever
   grows a second admin.

## The crash: decided

7. **Merge without resolving it; gate prod on a one-week crash-free soak.**
   Three occurrences, all under adversarial long-session load, strongest
   structural cause fixed, capture tooling in place. For a single user the
   worst case is *your own* lost tab with a durable draft behind it — annoying,
   recoverable, and diagnosable when it happens to the one person with the
   tooling. → If any renderer crash occurs on dev post-shape-fix: capture the
   snapshot before reloading, and prod waits for the root cause. Zero crashes
   in a week of real use: ship.

## Rollback and upgrade-window hazards: decided by habit, not code

8. **Rollback stranding the durable queue: accept, with a 10-second habit.**
   You are the only writer. Before any prod rollback, check your own queue is
   empty (the wedge surfacing already tells you; an empty
   `card-web-aux-writes-v2-index` is the all-clear). A master-side drain shim
   protects nobody but you, and you can protect yourself for free. → One
   sentence in the runbook's rollback section.
9. **Master-clients-can't-delete during the rules→hosting window: accept.**
   The only deleter is you. Don't delete cards between deploying rules and
   deploying hosting; the window is minutes if the runbook is followed. → One
   sentence in the runbook. No code.
10. **`hasPreviousRealSignIn` cold-seed (one throwaway reader spawn per
    existing device): accept, no change.** It costs each of your devices one
    slightly-slower boot, once, ever. A code fix would be reviewed harder than
    the cost it saves. → Nothing.

## Prod cutover sequence: decided

11. **Order:** (a) soak week per #7 → (b) nlp-tokens migration verified on
    prod per runbook Phase 0 → (c) rules + ALL indexes deployed and Enabled →
    (d) hosting deploy in the same sitting (honoring #9's delete-freeze) →
    (e) the runbook's next-day verification, plus one anonymous-profile
    offline check. The SW-upgrade deadlock is already defused by the entry
    rename; your own long-lived tabs still need one full close-and-reopen
    after cutover — do it deliberately rather than being confused later.

## Explicitly accepted risks (so nobody re-litigates them silently)

12. **Single-tab gate:** keep exactly as is. It's your workflow; the takeover
    round-trip is fast and honest, and it buys cache correctness.
13. **Old browsers fail closed:** accept. You run modern Chrome; the
    anonymous Safari-14 population is ~nil and the error copy now tells the
    truth.
14. **No partial mode on cold boot:** accept (it was your directive). 2–3
    minutes once per device, usable in seconds.
15. **Sync-engine P2 residuals** (early-live race, unlaundered repair ghosts,
    future-`updated` poison, tombstone-cursor guard): accept — all narrow,
    self-healing, or requiring out-of-band writers that only you could run.
    They're tracked; fix opportunistically when next in that file.
16. **Tombstone pruning unimplemented:** accept indefinitely. A single author
    deletes rarely; accrual is trivial at this rate. Revisit if a bulk-delete
    ever happens.
17. **Overwrite-guard residual false positives** (non-empty-default image
    keys, `toJSON`): accept. With one editor, every "changed elsewhere" is
    either your other device or a false alarm — the guard errs toward asking,
    the stamped draft makes Stop safe, and the missed-conflict direction
    requires a second editor who doesn't exist. → Comment only.
18. **Late-discard revert transiently undoing a re-done star:** accept (P3,
    self-heals via authoritative re-delivery).

## Deferred with explicit triggers (not drift — tripwires)

19. **Windowed memory / stop mirroring 40k cards into Redux:** defer.
    **Trigger:** settled post-boot heap >800MB, or corpus >50k cards,
    or one more unexplained crash. Then it becomes the next major work item.
20. **Round-13 perf findings** (dead handoff, `selectDefaultSet`, IDF trim,
    client-IDF recompute, sweep cascades): defer, all tracked. The dead
    handoff only affects diagnostic modes now — if it's still dead in six
    months, delete it rather than fix it.
21. **Boot's ~2.5s main-thread freeze:** defer. **Trigger:** it grows past ~4s
    or moves later into the boot where you'd feel it mid-interaction.
22. **Worker-body (sync engine) executable harness:** defer the harness;
    adopt the *rule* now — any new aux-write kind or sync-engine change ships
    with an executor-harness test, per the pattern that already exists.
23. **Pre-branch public endpoints** (`reindexCardEmbeddings`,
    `cleanupOldEmbeddings`): lock down with `invoker:'private'` in the first
    post-merge week, coordinating their gulp callers. Not a landing gate —
    they predate the branch — but the IDF incident showed the shape is real.
24. **Mobile card sizing (~30% small):** timebox 30 minutes post-merge. The
    mobile experience is a presentation-mode fallback; if the fix isn't
    obvious in 30 minutes, file and move on.
25. **Dev-coupling cleanup** (hardcoded dev hostname, probe tooling, DEVMODE
    chrome): one tidying pass after the prod cutover settles. Cosmetic.

## The one-sentence version

Merge this week after the two process fixes and the copy tweak; give yourself
the localStorage kill switch instead of building one; let the crash soak
decide the prod date; convert every remaining single-user hazard into a
runbook sentence instead of code; and put explicit numeric triggers on the
deferred performance work so "deferred" cannot quietly become "forgotten."

---

# Decision-log amendment (2026-08-13): kill the staged rules carve-out

**Owner's call, superseding the tripwire machinery:** the staged
inbound-reference carve-out (rules keeping `updated` optional on inbound-link
writes until old clients age out, enforced by the 2026-09-15 deadline) exists
solely to protect old *editor* clients — and there is exactly one editor, with
a couple of logged-in instances, who prefers tight rules always and is happy to
refresh.

**Decision: tighten now; replace the transition window with a checklist step.**

1. Flip both `STAGED` tests in `test/security/test.js` to `assertFails` and
   tighten `cardEditInboundReferences` in `firestore.TEMPLATE.rules` to
   REQUIRE the `updated` bump — now, on this branch, before cutover.
2. Delete the 2026-09-15 deadline machinery for this item: the warning-ramp
   test, and this entry in `tools/check-deadlines.cjs` / `check:deadlines`
   (keep the harness if other deadlines ever want it). Phase 6 of the runbook
   collapses into the cutover itself.
3. Add the checklist step to the runbook's cutover sequence: **after deploying
   hosting, CLOSE AND REOPEN every logged-in instance of the app on every
   device** — close-and-reopen, not F5, because the waiting service worker
   only activates when all tabs of the origin close (or accept the in-app
   update banner). Until that's done on a device, treat it as under the
   existing freeze: **no link-affecting edits or deletes from stale tabs.**
4. Worst case if the freeze is forgotten: a stale tab's link-affecting save is
   permission-denied — visible, durable-queued, and replayed successfully
   after the refresh. Annoying, not loss.

Rationale: a weeks-long security-rule staging window whose only beneficiary is
the owner's own browser tabs is complexity with no second beneficiary — the
same logic as the kill-switch decision (#6). Tight rules from the first minute
of prod; the invariant never rests on client good behavior at all.

---

# Appendix (2026-08-14): your first week on the branch — predicted surprises

You haven't personally daily-driven the new dev deploy yet. From first
principles — your actual habits against 21 rounds of accumulated findings plus
one fresh experiment today — here is what will surprise you, ranked by
(probability you hit it) × (how much it will annoy you). Each: what you'll
see, why, and what to do.

## You will hit these on day one

1. **"Why can't I edit yet?"** First sign-in on any browser profile triggers
   the full 40k cold sweep: readable in seconds (priority cards), complete in
   ~2-3 minutes — and **saving/creating is gated until sync reaches `live`**.
   The buttons are disabled-with-tooltip, not broken. Do the first boot, get
   coffee. Every later boot on that profile is 8-13s.
2. **The away-time tax.** Boot-to-`live` scales with how long you've been
   gone (measured: 49s after 9 idle days). Back from a trip = about a minute
   before the first save. Daily use won't show this.
3. **The one-tab rule.** Your second signed-in tab shows "Compendium is open
   in another tab" with a Use-this-tab button. Middle-clicking cards into
   background tabs stops working the way it did. The takeover itself is fast
   (~2.4s) and safe — but this is the single biggest workflow change, and it
   is by design, not a bug to report.
4. **Bare `E` no longer opens the editor** — it's Cmd/Ctrl-E now (bare-E was
   silently typing into your cards). Your fingers will disagree for a few
   days. (Labels currently say "Cmd-E" even for Ctrl users.)
5. **A mid-boot hitch.** The app paints, then freezes ~2.5s at around 5-8s
   into every boot (snapshot apply on the main thread — known, tracked). It
   feels like a hang; it always recovers.

## You will hit these during the first week

6. **The app talks more than master did.** Sync chip states, disabled-button
   explanations, "saved — will apply when the connection recovers" alerts on
   flaky wifi, wedge warnings after repeated failures, an update banner after
   deploys instead of the old mid-edit force-reload. All of it is reporting
   things master did silently or lost silently — but the *volume* will be
   noticeable at first, and some copy is still system-flavored.
7. **Two-device editing now asks instead of clobbering.** Edit the same card
   from laptop and desktop and you'll get a "Changed elsewhere" pause with
   Retry/Stop, where master silently last-write-won. One known residual false
   positive on image-bearing cards. When in doubt: Retry replaces with yours;
   Stop keeps a recoverable draft — nothing is lost either way.
8. **"Similar cards" and the word cloud rank differently than prod.** The
   fingerprint model changed (server IDF; it also omits concept-reference
   vocabulary). Different ≠ broken — but if a beloved similar-cards pairing
   vanishes, that's the mechanism, and it's tracked.
9. **Memory.** Expect the tab to sit around 0.6-1GB. And the standing item:
   three unexplained renderer crashes occurred during heavy review sessions.
   If your tab ever dies, that IS the known open bug — if you can, run
   `tools/capture-heap-snapshot.mjs` before reloading; that capture is the
   missing evidence.

## Testing-specific traps (dev, not the branch)

10. **Dev's data is a mirror from early August** — your recent prod edits
    aren't there. Don't debug "missing cards" that are just mirror lag.
11. **Mobile renders the card ~30% smaller than prod** (real, unfixed,
    timeboxed item) — don't spend time re-discovering it.
12. **Check `/deploy-stamp.json` before judging anything** — twice during
    review, a verification ran against a build minutes older than HEAD. The
    stamp exists now; use it (note it can be cached up to an hour until the
    no-cache header lands).

## What you will NOT be surprised by (verified today)

- **Stale dev state self-heals.** I booted a 10-day-old profile — old service
  worker, protocol-4-era snapshot — against today's deploy: the worker
  dropped the stale state, re-synced clean in ~4 seconds, and the page
  rendered perfectly. Your months-old dev tabs will not wedge.
- **Offline genuinely works** (reader path: full site in ~1.5s with no
  network), **saves survive reloads and blips**, and **updates wait for you**
  instead of yanking the page mid-edit.

## The one-sentence version

The nasty surprises are all *time-shaped* — first boot, back-from-vacation,
the boot hitch — plus one workflow rule (one tab) and chattier dialogs; the
data-integrity surprises master used to spring on you are the thing this
branch deleted.

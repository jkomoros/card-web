# PROD LANDING RUNSHEET — fast-corpus cutover

Generated 2026-08-15 by an Opus verification pass: every precondition checked
against the repo/prod (not assumed). Execute top to bottom, live, with the
owner. `[OWNER]` = needs the owner personally. `[AGENT]` = coordinator runs it.
**Deliberately left untracked until after the merge — the gates below pin
HEAD = `078505e6`; commit this file in post-landing hygiene (step 16).**

## ⚠️ FLAGS — read before step 1

**Blockers (clear in order before Phase 0):**

| # | Finding | Evidence |
|---|---|---|
| B1 | `gcloud` not on zsh PATH (SDK at `/Users/jkomoros/Code/sdk/google-cloud-sdk/bin`, sourced only in `~/.bash_profile`). Phase 0 migration and Phase 1 backup shell out to it. | `which gcloud` → not found |
| B2 | No Application Default Credentials (`~/.config/gcloud/application_default_credentials.json` absent). `migrate-nlp-tokens.mjs` uses `applicationDefault()`. | file absent |
| B3 | Local `master` is 5 commits BEHIND `origin/master` (`ef9e9cd4` vs `3fa9f3a1`). Merge into freshly-fetched origin/master, not local. | `git rev-parse` both |
| B4 | CI has never run on HEAD — 158 commits unpushed; `origin/implement/fast-corpus` at `0e11ecbd` (07-23). | `git branch -r --contains` empty |
| B5 | `tools/verify-nlp-quick.mjs` is HARDCODED to dev — useless for the Phase 0 prod gate. Use the inline one-liner in step 6. | line 5 |

**Doc contradictions (runbook wins; scheduled as step 18.9 cleanup):**
HANDOFF-BRIEF still says the rules carve-out is staged (false — tightened at
`078505e6`); several docs still say `functions:delete calculateIDF` must be
run (false for prod — **verified absent via `functions:list`**; the
deploy-firebase.ts comment is the accurate record); HANDOFF still describes
"next-day rule tightening" (retired); fix-queue §925-984 duplicates
already-FIXED blockers; runbook Phase 2's "29 indexes" is the FILE count —
prod has 8 composites and 0 overrides today, so **21 new composites + 19
field overrides will build**. Budget the wait.

**Missing precondition — [OWNER] judgment call:** audit decision #11(a) gates
prod on a crash-free dev soak week. Last recorded crash 2026-08-03; nothing
records a sign-off. **The owner must consciously call this served or not.**

**Environment prelude — paste into EVERY shell used below:**

```bash
export PATH="$HOME/.nvm/versions/node/v20.20.0/bin:/Users/jkomoros/Code/sdk/google-cloud-sdk/bin:$PATH"
cd /Users/jkomoros/Code/card-web
node --version   # MUST print v20.20.0 (login default v18 breaks firebase-tools 15.x)
```

Git hooks hang: always `git -c core.hooksPath=/dev/null …` / `commit --no-verify`.

---

## STAGE A — Pre-merge

### 1. [AGENT] Confirm branch state
```bash
git status --short && echo "CLEAN" ; git rev-parse HEAD
```
GATE: `CLEAN` and `078505e627f8b27153e1302748cf68e14474433d`. (Verified at
writing.) Failure: dirty tree → stamp goes dirty, build matches no commit.

### 2. [OWNER] Fix environment blockers (B1, B2)
```bash
which gcloud && gcloud --version
gcloud auth list
gcloud auth application-default login    # browser sign-in
gcloud config get-value project          # expect: complexity-compendium
```
Trap: gcloud's active config is ALREADY prod — stray gcloud commands hit
production. Failure: no gcloud → no migration, no backup. **No deploy without
a backup.** Escape: console Import/Export.

### 3. [AGENT] Push branch; let CI run (closes B4)
```bash
git push origin implement/fast-corpus
gh run list --branch implement/fast-corpus --limit 3
```
GATE: the `test` workflow green on `078505e6` (~30 min cap; runs test:ci —
everything but test:security, which needs gitignored secrets; ci-coverage
asserts that's the only exemption). Failure: red CI on locally-green code is
the exact case CI exists for — stop and read. Escape (CI infra broken, not
code): step 4's local suite substitutes — said out loud.

### 4. [AGENT] Full local suite ON THE MERGE RESULT (after step 5's merge)
```bash
npm run build:shared && npm run build:typescript && npm run generate:config
npm test
```
GATE: exit 0 (~10 min; includes 176 emulator security tests incl. the two
flipped inbound-reference tests). No escape hatch — never deploy red.

## STAGE B — Merge

### 5. [AGENT] Merge into freshly-fetched master (closes B3)
```bash
git fetch origin
git -c core.hooksPath=/dev/null checkout master
git reset --hard origin/master
git merge --no-ff implement/fast-corpus -m "Merge fast-corpus: worker-owned corpus with watermark delta sync"
```
Pre-verified: `git merge-tree` exit 0, tree `46e8e5c4`, **no conflicts**;
origin/master touched 14 files since merge-base, all suite-covered. Then run
step 4 on the merged tree, then:
```bash
git push origin master
```
GATE: `git rev-parse HEAD` == `git rev-parse origin/master`. Deploys from
master from here on.

## STAGE C — Phase 0: NLP migration on PROD

> Must complete BEFORE any device cold-sweeps prod: the migration deliberately
> doesn't bump `updated`, so a device that sweeps first never gets tokens by
> delta — its find stays on the slow path permanently.

### 6. [OWNER] Dry-run, then run, against PROD
```bash
npm run build:shared && npm run build:typescript
node tools/migrate-nlp-tokens.mjs --dry-run --limit=100
```
⚠️ NO FLAG = PROD (`--dev` is the dev opt-in; there is no `--prod`). The
banner prints `Mode: PROD`; the script blocks on Enter — that's why [OWNER].
```bash
node tools/migrate-nlp-tokens.mjs      # press Enter at the prompt
```
Batches of 250 with backoff; skips already-migrated; ~40k reads + ≤40k writes
≈ 10¢. GATE — do NOT use verify-nlp-quick.mjs (B5); use:
```bash
node -e "
import('firebase-admin/app').then(async a=>{
 const f=await import('firebase-admin/firestore');
 a.initializeApp({credential:a.applicationDefault(),projectId:'complexity-compendium'});
 const db=f.getFirestore();
 const s=await db.collection('cards').limit(25).get();
 let ok=0,bad=[];
 s.forEach(d=>{const c=d.data();
   (c.nlp_search_tokens&&c.nlp_version&&c.nlp_source_fingerprint)?ok++:bad.push(d.id);});
 console.log('sampled',s.size,'complete',ok,'incomplete',bad.join(','));
});"
```
Every sampled card must have all three fields. Hard gate; no escape.

## STAGE D — Phase 1: Backup

### 7. [OWNER] Prod Firestore export
```bash
npm run backup
```
GATE: exits 0 and the export appears in the bucket (config verified:
`backup_bucket_name` IS set on prod). Watch for the silent-skip line
`Skipping backup since no backup_bucket_name set`. Escape: console export.

## STAGE E — Phase 2: Rules + indexes ⚠️ FREEZE STARTS

> From here until step 12 completes on every device: NO CARD DELETES, NO
> LINK-AFFECTING EDITS from any unrefreshed tab. Master-era deletes fail
> SILENTLY; link edits fail visibly and queue.

### 8. [AGENT] Regenerate rules, deploy firestore
```bash
npm run generate:config
grep -c "affectedKeys.hasAny(\['updated'\]) && request.resource.data.updated == request.time" firestore.rules
```
GATE: grep prints `1` (verified: firestore.rules:202). Then:
```bash
npx firebase deploy --only firestore --project complexity-compendium
```
(`firestore.predeploy` runs check-deadlines automatically — verified passing,
DEADLINES empty.)

### 9. [AGENT/OWNER] ⏳ WAIT FOR ALL INDEXES — the long gate
21 new composites + 19 field overrides will build (minutes to tens of
minutes). Machine gate:
```bash
npx firebase firestore:indexes --project complexity-compendium > /tmp/prodidx.json
node -e "
const fs=require('fs');let t=fs.readFileSync('/tmp/prodidx.json','utf8');t=t.slice(t.indexOf('{'));
const prod=JSON.parse(t), local=require('/Users/jkomoros/Code/card-web/firestore.indexes.json');
console.log('prod composites:',prod.indexes.length,'(expect 29)');
console.log('prod fieldOverrides:',(prod.fieldOverrides||[]).length,'(expect 19)');
console.log(prod.indexes.length===local.indexes.length && (prod.fieldOverrides||[]).length===(local.fieldOverrides||[]).length ? 'PASS':'STILL BUILDING');"
```
PLUS [OWNER] console check: every index `Enabled`, no override building.
Critical four if rushing: `(published ASC, updated DESC)`, `(published ASC,
updated ASC)`, `(nlp_search_tokens CONTAINS, published ASC, sort_order ASC)`,
`(published ASC, slugs CONTAINS)`. Do not start step 11 early.

## STAGE F — Phase 3: One-time plumbing

### 10. [AGENT] Artifact Registry cleanup policy
```bash
npx firebase functions:artifacts:setpolicy --project complexity-compendium --location us-central1 --force
```
GATE: exit 0. Without it the functions deploy fails AT THE END (annoying, not
dangerous). [OWNER] optional: set a Cloud Billing budget alert.

## STAGE G — Phase 4: The deploy

### 11. [OWNER] Deploy
```bash
git rev-parse HEAD    # record; verified in step 13
npm run deploy
```
What deploys (verified against prod, not assumed): 11 functions, ALL already
existing on prod — zero first-time creations. ✅ calculateIDF NOT in list and
NOT live on prod (functions:list verified). ⚠️ reindexCardEmbeddings +
cleanupOldEmbeddings remain the two known-public endpoints (predate branch;
step 18.6 locks them). ✅ disable_twitter=true → `--only` path, no bare
deploy. Qdrant enabled → background reindex fires at the end.
GATE: prints `DEPLOYING <merge-commit>` and NOT the dirty warning. Failure
before hosting flips = prod still on master (safe); after = step 15.

### 12. [OWNER] ⚠️ CLOSE AND REOPEN — every logged-in instance, every device
Close and reopen, NOT F5 (waiting SW activates only when every tab of the
origin closes). GATE per device: DevTools → Network shows
`card-web-app-entry.js` from NETWORK, not "from ServiceWorker". (Verified:
entry rename defuses master's cache-first precache.) Still "from
ServiceWorker" → a tab/window of the origin is still open somewhere.

## STAGE H — Phase 5: Verification (same hour)

### 13. [AGENT] FIRST — the stamp
```bash
curl -s https://thecompendium.cards/deploy-stamp.json; echo; git rev-parse HEAD
```
GATE: commit matches, dirty false. (Served no-store — always live. Skipping
this produced false failure reports twice during review.)

### 14. [OWNER] Enumerated checks, in order
14a anonymous private window: cards render, `load complete`, zero console
errors. 14b anonymous SECOND visit: materially faster (reader snapshot).
14c signed-in existing profile: the one-time full sweep — priority cards in
seconds, `cold sweep complete` → `live` in ~2-3 min; saving gated till live;
~40k reads ≈ 2.4¢ once per device. 14d reload: near-instant, <100 reads (a
second 40k sweep = cache not persisting — STOP). 14e edit round-trip:
commits, `delta: 1 changed cards`, survives reload. 14f LINK-AFFECTING edit:
commits cleanly on the refreshed client — this releases the step-8 freeze.
14g second tab: gate shows, no second worker; takeover works; unsaved-edit
takeover is refused without losing the draft. 14h offline (anon profile,
DevTools offline, reload): full site in ~1.5s.
GATE: all eight. 14a/14c fail → step 15. 14f-only fail → rules issue; write
is queued not lost; investigate before rolling back.

## STAGE I — Rollback posture (only if needed)

### 15. Escalation order
15a [OWNER] personal kill switch, FIRST RESPONSE (verified working on prod
hosts):
```js
localStorage.setItem('corpus-worker','off'); location.reload();
```
Backs THIS browser onto the legacy path; strands nothing. First-response
tool, not a steady state.
15b [OWNER] THE TEN-SECOND HABIT before any hosting rollback:
```js
Object.keys(localStorage).filter(k => k.includes('aux-writes-v2-i-'))
```
Must be `[]`; save indicator not paused/queued; save or discard any open
draft (drafts are unrecoverable on master).
15c [OWNER] nuclear: console → Hosting → Release history → roll back
(instant; master's SW skipWaiting()s, so rollback is fast even though
upgrade wasn't).
NOT covered by rollback: queued aux-writes stop replaying (invisible until
you return to the new client; no age bound — late star increments can drift
counts); drafts and paused multi-edits stranded; DELETION STAYS BROKEN for
rolled-back clients (the Phase 2 rules don't roll back).

## STAGE J — Post-landing hygiene

### 16. [AGENT] After a successful cutover
```bash
git push origin master
git tag -a cutover-fast-corpus -m "fast-corpus prod cutover" && git push origin cutover-fast-corpus
```
KEEP `implement/fast-corpus` (pushed) until after the soak. Commit this
runsheet. Scratchpad probes/debug Chrome: nothing required (all dev-pointed).

### 17. [OWNER] First-24h monitoring
Firestore usage graph (one 40k spike per device once, then trickle — a
SECOND spike on the same device is the alarm); stamp re-check next morning;
Sunday ~2am no calculateIDF reads (structurally guaranteed; confirm anyway);
billing alert if skipped.

### 18. Scheduled, not forgotten (post-soak, separate PRs)
1 remove legacy listen path after watermark soaks; 2 tombstone pruning task;
3 keep tombstone-delete emulator coverage permanent; 4 UX polish queue;
5 P2 windowed memory + P3 worker RPCs; 6 lock reindexCardEmbeddings +
cleanupOldEmbeddings with invoker:'private' (deletes data on unauth POST —
first post-merge week); 7 mobile card sizing 30-min timebox; 8 dev-coupling
cleanup; 9 fix the doc contradictions listed in FLAGS + point
verify-nlp-quick.mjs at a flag instead of hardcoded dev.

### 19. [OWNER] Accepted risks — re-acknowledge at the moment of landing
CRASH (3 occurrences, unexplained, last 08-03 — if it recurs: run
tools/capture-heap-snapshot.mjs BEFORE reloading); #19 windowed memory
(triggers: >800MB settled heap, >50k cards, or one more crash); #12
single-tab gate; #13 old browsers fail closed; #14 no partial mode (2-3 min
per device, once); #15 sync-engine P2 residuals; #16 no tombstone pruning;
#17 overwrite-guard false positives; #18 late-discard star revert; #21 boot
~2.5s freeze (trigger: >4s); #24 mobile card small; fingerprint rankings
differ from prod by design; bare E → Cmd/Ctrl-E; away-time tax (live gating
scales with idle days, ~49s after 9).

**One-line summary:** code ready, merge clean — between you and step 1 stand
gcloud-on-PATH, ADC login, CI's first-ever run on this code, and your own
call on whether the crash-soak week counts as served.

---

# AS EXECUTED — 2026-08-16

Cutover completed. Prod is `ec1fdf08` (merge commit), deployed 14:03:26Z,
verified live via `deploy-stamp.json`. Tag: `cutover-fast-corpus`.

## Corrections to the plan above, for whoever runs the next one

- **The merge was a fast-forward.** `origin/master` WAS the merge-base — the
  branch already contained all five commits local master was behind on. The
  "origin/master touched 14 files since merge-base" note was wrong; it touched
  zero. The merge-result tree was byte-identical to the tested tree, which is
  why the full suite could run BEFORE the merge and still be a valid gate.
- **CI was red for a reason the runsheet could not have predicted**, and it was
  not the code: the `Install shared/ dependencies` step ran `npm ci --prefix
  shared` against a lockfile that has never existed in this repo's history, so
  it had failed on every push since it landed. B4 (CI never having run) was
  what hid it. Fixed by deleting the step (`067dfa13`) — NOT by generating the
  lockfile, which would have pinned CI's shared/ build to typescript ^4.9.0
  while every shipped build uses the root's 5.8.2.
- **Prod has 44,746 cards, not ~40k.** Every read-cost figure above is ~12%
  low. Per-device cold sweep is ~44.7k reads ≈ 2.7¢; step 17's monitoring
  signal is one ~45k spike per device, not 40k.
- **`--limit=N` does not limit the READ.** `migrate-nlp-tokens.mjs:133` fetches
  the entire collection and slices at :139, so the dry-run costs a full ~40k+
  read and takes as long as the real fetch (76.8s observed).
- **The migration took ~1–2 hours, not minutes** — 44,746 writes in ~179
  batches of 250 with backoff. `Skipped: 0` on the dry run correctly predicted
  a full write of every card.
- **Back up BEFORE the migration, not after** (this runsheet had it at step 7,
  after step 6). The migration is the first thing that mutates prod; a backup
  taken afterwards is not a clean restore point. Done first here: export
  `deploy-2026-08-16-05-59-before-fast-corpus`, 329,462 docs, 2m16s.
- **Close every prod tab before migrating.** Not in the plan above. The
  migration writes all 44,746 card docs, and Firestore bills a read for every
  document a live listener sees change — an open master-era tab would have
  taken ~45k reads and the whole delta through the main thread.
- **Step 6's verification is stronger as an exact count than as a sample.**
  `.limit(25)` returns the first 25 by document ID — one contiguous slice of
  the keyspace, not a sample. `orderBy(field).count()` excludes docs lacking
  the field, giving an exact population count. Result: 44,746/44,746 on all
  three fields, plus a 300-card spread sample for co-occurrence.
- **Step 13 needs more than "did I get a 200".** Hosting's SPA rewrite serves
  `index.html` for unmatched paths, so `/deploy-stamp.json` returned HTTP 200
  with `content-type: text/html` BEFORE the deploy. Gate on content-type
  `application/json` and `cache-control: no-store` as well as the commit.
- **Index states are machine-checkable**; the console eyeball in step 9 is not
  required. `gcloud firestore indexes composite list --format="value(state)"`
  reports CREATING vs READY. Observed: 8 READY / 21 CREATING at t=0, all 29
  READY at ~13.5 min (one landed early, the other 20 completed together).
- Step 10's `--force` needs no confirmation, but note `${PIPESTATUS[0]}` is
  empty in zsh — the array is `$pipestatus`, 1-indexed.

## Verification outcome

14a, 14b, 14d, 14e, 14f, 14g PASS. 14f passing released the freeze.

**14h FAILED — pre-existing, not a regression.** Offline boot shows the
browser's error page: the service worker has no `navigateFallback` and
`index.html` is not precached, so an offline navigation has nothing to serve
it. Neither has ever existed in this repo's history, and pre-merge master
(`3fa9f3a1`) is identical in this respect — offline boot has never worked on
prod. Filed as #728. Not a rollback trigger (only 14a/14c are), and rolling
back would restore a build with the identical defect.

Also filed: #732, every find-to-link result rendering ghosted.

## Behaviour that looks wrong but is not

- **Reload within ~15s of a save shows the pre-edit card until verification
  completes.** The compact snapshot is written on a 15s debounce
  (`corpus-worker.ts:609`), so a faster reload primes from the pre-edit
  snapshot and serves it `unverified` ("trust slow, serve fast"). The delta
  listener's 5-minute clawback (`watermark.ts:22`) then re-delivers the edit
  and the display converges. Guaranteed, not lucky.
- **Links to unpublished cards render red.** That is
  `a.card.exists.unpublished` (the warning colour), and the selector requires
  `.exists` — a genuinely missing target renders as plain inherited text.

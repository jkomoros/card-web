# PROD Cutover Runbook — fast-corpus / worker-on-by-default

The one document to follow when taking the fast-corpus work to production.
Written 2026-07-11, when `implement/fast-corpus` flipped the defaults
(`corpus-worker='on'`, `corpus-sync='watermark'`) and deployed them to dev.

**Why this is a deliberate cutover, not a routine deploy:** the client now
defaults to the worker-owned corpus with watermark delta sync, which
depends on server-side artifacts prod does not have yet (a composite
index, tombstone + `bumpsUpdated()` security rules). Deploying hosting to
prod before those exist breaks boot for signed-in users. Order matters;
follow the phases in order.

Prod project: `complexity-compendium` (127.0.0.1:8081 in local dev — do
NOT load the full corpus against prod from a dev server). Dev project:
`dev-complexity-compendium`.

---

## Phase 0 — Gate: are we ready?

Do not start until ALL of these are true:

- [ ] Owner acceptance on dev (deployed site, signed in, fresh profile /
      cleared site data):
      - Cold boot: usable in seconds (priority 5k), full corpus complete
        in ~1–3 min. `cold sweep … throttled; concurrency now N` console
        lines are the adaptive pacing working — fine. Stalls or permanent
        `unverified` are NOT fine.
      - Editing: typing in a card refreshes sidebar related-cards within
        a few seconds, no typing jank.
      - Warm boot (reload after sweep): roughly 10 seconds or better,
        syncState `live`,
        and low billed reads (spot-check Firestore usage console: a warm
        boot should be <100 reads, not ~40k).
- [ ] Several days of normal dev usage without: stuck `unverified`/`stale`
      syncState, missing cards, ghost (deleted-but-visible) cards, or
      commit failures. (`localStorage` on your dev profile: remember
      explicit `corpus-worker`/`corpus-sync` keys now act as OPT-OUT
      overrides — clear them to soak the real defaults.)
- [ ] Branch merged to master; you are deploying from master.
- [ ] Full `npm test` green on the merge result.
- [ ] Audit every admin/maintenance script that writes `cards/*`: all
      content/metadata mutations must stamp `updated` with a server timestamp;
      every delete must atomically create its tombstone. Rule-bypassing Admin
      SDK scripts are part of the watermark correctness boundary.
- [ ] **Search-recall NLP ordering (BEFORE any user's device cold-sweeps prod):**
      run `tools/migrate-nlp-tokens.mjs` against prod so every card carries
      `nlp_search_tokens` + `nlp_version` + `nlp_source_fingerprint`. Two
      reasons this is a hard gate: (1) the migration deliberately does not
      bump `updated`, so a device whose compact snapshot predates it never
      receives tokens via delta — its find stays on the slow full-scan path
      forever (the recall index bails at the 75% always-scan fraction);
      (2) fingerprints make future admin content writes (e.g. `mount.ts`,
      which now clears `nlp_version`/`nlp_source_fingerprint` on substantive
      writes) demote cleanly instead of being silently indexed under stale
      tokens. Spot-check afterward with `tools/verify-nlp-quick.mjs`.

## Phase 1 — Prod backup

```bash
npm run backup
```

(gcloud export of prod Firestore; prompts for a message. Verify it
completes.)

## Phase 2 — Server-side artifacts FIRST (rules + indexes)

Deploy Firestore rules + composite indexes to prod BEFORE any hosting
deploy, so they exist when the first new client boots:

```bash
npx firebase deploy --only firestore --project complexity-compendium
```

Notes:
- `firestore.rules` is GENERATED from `firestore.TEMPLATE.rules` (via
  `npm run generate:config`); never hand-edit the generated file.
- Do NOT tighten `cardEditInboundReferences` yet — the template
  deliberately ships `updated` as optional-but-validated
  (firestore.TEMPLATE.rules ~line 163). Tightening now would
  permission-deny link edits from the still-deployed OLD prod client.
  That happens in Phase 6.
- **Wait for EVERY index, not one.** This deploy ships 29 composite indexes
  and 19 field overrides (count them yourself: `firestore.indexes.json`).
  The earlier instruction named only `(published ASC, updated ASC)`, which
  is not sufficient — the cold-boot priority phase needs
  `(published ASC, updated DESC)`, and find/slug and suggestion queries need
  others again. A query whose index is still building FAILS; with the flags
  now default-on there is no client-side way to back out of it.
  **Gate**: Firebase console → Firestore → Indexes, every entry showing
  `Enabled` and no field override still building (minutes to tens of minutes
  at prod scale). Do not start Phase 4 until that is true.
- These rules are already exactly what dev runs (deployed + 176 security
  tests green); this phase is replication, not new surface.
- The rules are compatible with the currently-deployed old prod client for
  every write EXCEPT DELETION. Card delete now requires an atomic tombstone
  alongside it; master's client writes a bare `batch.delete(ref)`, so every
  delete from an un-upgraded client is permission-denied from the moment these
  rules land. That is deliberate — the tombstone is what makes deletions
  propagate — but be clear about the consequence:
  - It fails SILENTLY and the UI has already committed. Master runs
    editingFinish() and navigateToNextCard() before awaiting the commit, with
    no catch, so the user confirms, the editor closes, the view moves on, and
    the card is still there after a reload.
  - The window is Phase 2 until every client is on the new bundle — see the
    service-worker note below, which is what makes that window open-ended
    rather than a deploy-day gap.
  If any un-upgraded client is still in use, tell its user not to delete cards
  until they have reloaded onto the new bundle.

## Phase 3 — One-time project plumbing

```bash
npx firebase functions:artifacts:setpolicy --project complexity-compendium --location us-central1 --force
```

(Artifact Registry cleanup policy: deletes BUILD container images older
than 1 day; deployed functions unaffected. Without it the functions
deploy exits non-zero at the very end. Already done on dev 2026-07-11.)

Optional but recommended while in the console: set a Cloud Billing budget
alert on the prod project (a runaway-client bug at 60k cards costs real
cents; an alert is the tripwire).

## Phase 4 — The deploy

```bash
npm run deploy
```

(Full prod deploy: build, hosting, storage, firestore, functions with
dotenv config — `functions/.env.complexity-compendium` is regenerated
automatically — plus embedding reindex. `functions:config:set` is gone;
see README "Firebase Functions Configuration".)

## Phase 5 — Immediate verification (same hour)

**FIRST, confirm you are verifying the build you think you are.** Every step
below is worthless against a stale deploy, and that has actually happened —
a post-deploy check once tested the previous build and reported a working fix
as broken.

```bash
curl -s https://thecompendium.cards/deploy-stamp.json
git rev-parse HEAD
```

The `commit` field must equal HEAD, and `dirty` must be `false`. If `dirty` is
true the build contains uncommitted work and corresponds to no commit at all —
nobody can reproduce later what is running. The stamp is served `no-store`, so
what you get back is always the live one.


- [ ] Anonymous: load the prod site in a private window. Published cards
      render; console shows `[corpus-worker] ingested … (published)` and
      `load complete`; zero errors.
- [ ] Signed-in (your account, existing browser): first boot after
      cutover does a one-time full corpus read (~40k reads ≈ 2–3¢ on
      Blaze — expected, budgeted, once per device). Watch console:
      priority phase → parallel sweep (throttle+downshift messages are
      OK) → `cold sweep complete` → `sync state: live`.
- [ ] Reload: warm boot near-instant; Firestore usage console shows a
      trickle (<100 reads), not another full read.
- [ ] Edit a card: commit lands, `delta: 1 changed cards` appears, the
      edit survives a reload.
- [ ] Second tab: shows the blocking single-tab gate and starts no corpus
      worker. Choose **Use this tab**; the new tab reaches live/exact corpus
      state and the old tab becomes inactive. Reload the old tab and verify it
      stays inactive. Repeat while the old tab has an unsaved edit and verify
      the transfer is refused without losing the draft.

**BEFORE ANY ROLLBACK — the ten-second habit.** You are the only writer, so
you can protect the one thing rollback cannot: check your own queue is empty
first. In devtools, `Object.keys(localStorage).filter(k => k.includes('aux-writes-v2-i-'))`
must be `[]`, and the save indicator must not be showing a paused or queued
state. If it is not empty, let it drain (or reconnect until it does) before
rolling back. A master-side drain shim would protect nobody but you, and this
costs nothing.

Also: if you are mid-edit, save or discard the draft first.
`card-web-edit-draft-v1` is unrecoverable on master.

**Rollback if broken:** Firebase console → Hosting → Release history →
roll back to the previous release. The hosting flip itself is instant, and
master's own service worker calls skipWaiting() unconditionally, so the
rollback direction is fast even though the upgrade direction is not.

It is NOT "client-only", and the difference matters to users:

- Master reads none of the new client's localStorage keys. Anything queued in
  `card-web-aux-writes-v2-*` — stars, comments, card creations, a bulk import —
  simply stops being replayed. Nothing is corrupted, and returning to the new
  client replays it, but until then that work is invisible and unsent.
- `card-web-edit-draft-v1` is unrecoverable on master, which has no draft
  recovery: an unsaved draft is stranded.
- `card-web-pending-multi-edit-v1` strands a paused multi-edit the same way.
- The queue has no age bound, so a star intent that replays days later applies
  increment(+/-1) against a count the user may have changed since.

So: if you roll back with work queued, either return to the new client
promptly, or accept that those writes are deferred indefinitely. Deletion also
stays broken for rolled-back clients while the Phase 2 rules are live (see
Phase 2).

Do not use the diagnostic localStorage modes as a production fallback; the
supported client requires the worker and its single-tab ownership fence.

**Service worker: why the entry chunk is renamed.** master's service worker
precaches the app entry at the stable URL `lib/src/components/card-web-app.js`
and answers it CACHE-FIRST. With the same filename, the first post-deploy load
would fetch the new index.html and then run MASTER's bundle, while the new
service worker installed and waited (skipWaiting is false by design, and
master's bundle has no update listener to release it) — so the upgrade would
not complete until every tab in scope closed, and reloading would not help.
The entry is therefore emitted as `card-web-app-entry.js`, which master never
precached, forcing a network fetch.

Verification consequence: before this change, Phase 5's anonymous
private-window check passed (no service worker) while the signed-in
existing-profile check silently exercised MASTER and also looked fine — the two
checks meant to confirm the cutover could not disagree. When verifying, confirm
in DevTools → Network that `card-web-app-entry.js` was fetched from the network
(not "from ServiceWorker"), which is the positive signal that the new bundle is
the one running.

### Delete freeze during the rules → hosting window

Between deploying the tightened rules (Phase 2) and deploying hosting
(Phase 4), **do not delete any cards.** A master-era client cannot satisfy the
new atomic-tombstone delete rule, so the delete would be refused. You are the
only deleter and the window is minutes if this runbook is followed in order —
so this is a sentence here rather than code anywhere.

## Phase 6 — Next day: tighten the inbound-reference rule

After the new client has been live ~a day (service-worker bundles of the
old client have aged out):

1. In `firestore.TEMPLATE.rules`, `cardEditInboundReferences()` (~line
   163): make `updated` REQUIRED — follow the TIGHTEN comment in place
   (`affectedKeys.hasAny(['updated']) && …` form), and update the
   security tests that cover the staged form for both generic and admin users
   (test/security). Both staged success tests must flip to `assertFails`.
2. `npm test` (the security tests run against the emulator).
3. `npm run test:rules-deadline` — this is the dated forcing function for THIS
   phase. It is deliberately NOT part of `npm test`: a deadline that hard-fails
   the default suite punishes whoever happens to run tests that day for
   somebody else's checklist. It runs automatically before any deploy, and
   `npm test` warns for the 21 days beforehand. Once this phase is done, the
   deadline entry in `tools/check-deadlines.cjs` can be removed; if the phase
   slips, move its date in the commit that records why.
3. Deploy rules to BOTH projects:
   ```bash
   npx firebase deploy --only firestore:rules --project dev-complexity-compendium
   npx firebase deploy --only firestore:rules --project complexity-compendium
   ```
4. Verify a link-affecting edit still commits on prod.

## Phase 7 — Post-soak cleanup (days-to-weeks later, separate PR)

Not part of cutover day; tracked so it isn't forgotten:

- Remove the legacy partitioned unpublished LISTENERS path
  (corpus-sync='listen') once watermark has soaked on prod.
- Tombstone pruning maintenance task (tombstones currently accumulate).
- Card-delete rules already require a matching server-timestamped tombstone
  in the same atomic write. Keep the emulator coverage as a permanent
  regression gate; do not relax this for legacy clients.
- UX polish queue (implementation log 2026-07-11): sync/staleness pill,
  second-tab snack-bar, sidebar skeleton, find-drawer dimming.
- P2 windowed memory (docs/p2-windowed-memory-spec.md) and remaining P3
  worker RPCs.

---

## Quick reference: what each phase deploys

| Phase | Command | Touches | Safe with old client? |
|---|---|---|---|
| 2 | `firebase deploy --only firestore` | rules + indexes | yes (staged rules) |
| 3 | `functions:artifacts:setpolicy` | registry policy | yes |
| 4 | `npm run deploy` | hosting/storage/functions/firestore | replaces the client |
| 6 | `firebase deploy --only firestore:rules` | rules only | NO — requires new client live |

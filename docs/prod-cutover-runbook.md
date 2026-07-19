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
      - Warm boot (reload after sweep): near-instant, syncState `live`,
        and low billed reads (spot-check Firestore usage console: a warm
        boot should be <100 reads, not ~40k).
- [ ] Several days of normal dev usage without: stuck `unverified`/`stale`
      syncState, missing cards, ghost (deleted-but-visible) cards, or
      commit failures. (`localStorage` on your dev profile: remember
      explicit `corpus-worker`/`corpus-sync` keys now act as OPT-OUT
      overrides — clear them to soak the real defaults.)
- [ ] Branch merged to master; you are deploying from master.
- [ ] Full `npm test` green on the merge result.

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
- The composite index `(published ASC, updated ASC)` starts BUILDING on
  deploy. **Wait for it**: Firebase console → Firestore → Indexes must
  show it `Enabled` (minutes at prod scale). The watermark delta query
  fails while it is building.
- These rules are already exactly what dev runs (deployed + 176 security
  tests green); this phase is replication, not new surface.
- The rules remain COMPATIBLE with the currently-deployed old prod
  client — nothing breaks between Phase 2 and Phase 4.

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

**Rollback if broken:** Firebase console → Hosting → Release history →
roll back to the previous release (instant, client-only). The Phase 2
rules/indexes are backward-compatible with the old client, so they can
stay. Users can also self-serve opt out: `localStorage.setItem('corpus-worker','off')`
+ `localStorage.setItem('corpus-sync','listen')` and reload.

## Phase 6 — Next day: tighten the inbound-reference rule

After the new client has been live ~a day (service-worker bundles of the
old client have aged out):

1. In `firestore.TEMPLATE.rules`, `cardEditInboundReferences()` (~line
   163): make `updated` REQUIRED — follow the TIGHTEN comment in place
   (`affectedKeys.hasAny(['updated']) && …` form), and update the
   security tests that cover the staged form (test/security).
2. `npm test` (the 176 security tests run against the emulator).
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

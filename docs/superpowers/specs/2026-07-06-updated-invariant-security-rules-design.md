# Design: enforce the `updated` write-invariant in Firestore Security Rules

**Date:** 2026-07-06
**Status:** Proposed
**Related:** `docs/corpus-sync-design.md` (residual risk #1), commits `06cba17c` and `0a6f0612` (client-code guard + bypass audit)

## Goal

Add an **independent, database-boundary** enforcement of the `updated`
write-invariant, so that a card content write which forgets to bump
`updated` is rejected by Firestore itself — not merely by client
TypeScript that a new code path could bypass.

The watermark delta sync fetches only cards with `updated > watermark`, and
`fastDedupe` treats equal `updated` as proof of equivalence. A card content
write that does not bump `updated` silently never reaches other devices
(`docs/corpus-sync-design.md`, residual risk #1). Today the invariant is
enforced only in one trust domain — client TypeScript (the `MultiBatch`
runtime guard, the escape-hatch allowlist, the static bypass audit). Security
rules add a second, independent domain that applies to **every client SDK
write regardless of code path** (MultiBatch, raw `updateDoc`, `runTransaction`).

## Scope

**In scope:** the `cards/{card}` `allow create` and `allow update` rules in
`firestore.rules`, plus emulator-based rules tests, plus a staged rollout.

**Explicitly out of scope (rules cannot cover it):** admin-SDK writes in
`functions/` and `tools/` (`mount.ts`, `migrate-nlp-tokens.mjs`, the Twitter
functions) bypass security rules entirely. Those remain covered only by the
existing static bypass audit and by review; hardening them further (moving the
guard into the shared `MultiBatchBase`, or a type-aware ESLint rule) is a
separate effort and NOT part of this design.

## Current state

`firestore.rules:271`:

```
allow update: if cardEditMinor() || cardEditInboundReferences() || userMayEditCard(card);
```

- `cardEditMinor()` (rules:178) — reader-driven counters. Two independent
  disjuncts: `cardEditLegalMessages` (thread counters + `updated_message`,
  gated by `userMayComment()`) and `cardEditLegalStars` (`star_count`,
  `star_count_manual`, gated by `userMayStar()`). Correctly does **not** touch
  `updated`.
- `cardEditInboundReferences()` (rules:161) — inbound-reference writes.
  `updated` is currently **optional** but, if present, must `== request.time`.
- `userMayEditCard(card)` — the **main content-edit branch, with no constraint
  on `updated`.** This is the hole: the database accepts a content edit that
  forgets the bump.
- `allow create` (rules:270): `userMayCreateCard() && createIsAuthor()` — no
  `updated` requirement.

### Which client card writes hit which branch (verified)

Every non-bumping client card write must keep working after the change:

| Client write | Fields | Branch today | After change |
|---|---|---|---|
| Content edit (`modifyCardWithBatch`) | many, + `updated` | `userMayEditCard` | `userMayEditCard` + `updated==request.time` ✓ (always bumps) |
| Card create (`defaultCardObject`) | full card, `updated` sentinel | `allow create` | create + `updated==request.time` ✓ (sentinel → request.time) |
| Stars (`addStar`/`removeStar`) | `star_count`, `star_count_manual` | `cardEditLegalStars` | unchanged ✓ |
| Thread/message counters | `thread_count*`, `updated_message` | `cardEditLegalMessages` | unchanged ✓ |
| Inbound-ref side effects | `references_*_inbound`, `updated` | `cardEditInboundReferences` | tightened to **require** `updated` ✓ (client always sends it, `card_diff.ts:607`) |
| **`resetTweets`** (maintenance) | `tweet_count`, `last_tweeted` | **`userMayEditCard`** | **would break** — needs a new branch |

`resetTweets` is the only wrinkle: `tweet_count`/`last_tweeted` are not in any
counter branch, so today they ride `userMayEditCard`. Requiring `updated`
there would reject them. (The Twitter *functions* write the same fields via
admin SDK, which bypasses rules and is unaffected.)

## Design

### 1. Require `updated` on create and on the main edit branch

```
allow create: if userMayCreateCard() && createIsAuthor()
    && request.resource.data.updated == request.time;

allow update: if cardEditMinor()
    || cardEditInboundReferences()
    || (userMayEditCard(card) && request.resource.data.updated == request.time);
```

`request.resource.data` is the full post-write document, so `.updated ==
request.time` holds exactly when the write bumped `updated` via
`serverTimestamp()` (which resolves to `request.time` during rule
evaluation) — matching the existing `editOnlyUpdatesTimestamp` pattern.

### 2. Fold tweet counters into `cardEditMinor` (decision: fold, not a separate top-level branch)

Add a `cardEditLegalTweets` disjunct parallel to `cardEditLegalStars` (a plain
key extension does not work: `cardEditMinor` gates the message path on
`hasOnly(allKeys) && cardEditLegalMessages`, and the star/tweet paths are
independent disjuncts with their own `hasOnly`):

```
function cardEditMinor() {
  let affectedKeys = request.resource.data.diff(resource.data).affectedKeys();
  let allKeys = ['star_count', 'star_count_manual', 'thread_count', 'thread_resolved_count', 'updated_message'];
  return affectedKeys.hasOnly(allKeys) && affectedKeys.hasAny(allKeys) && cardEditLegalMessages(affectedKeys)
    || cardEditLegalStars(affectedKeys)
    || cardEditLegalTweets(affectedKeys);
}

function cardEditLegalTweets(affectedKeys) {
  //resetTweets zeroes vestigial tweet counters. Admin-gated: the only client
  //writer is the admin-run resetTweets maintenance task (the Twitter Cloud
  //Functions use the admin SDK and bypass rules). These fields are accepted
  //drift and must NOT bump `updated` (a whole-corpus redelivery).
  return userIsAdmin() && affectedKeys.hasOnly(['tweet_count', 'last_tweeted']);
}
```

**Open point for review:** the "fold into `cardEditMinor`" decision noted the
option loosens *who* may write tweet counters. This spec gates
`cardEditLegalTweets` on `userIsAdmin()` rather than a reader permission,
because the only legitimate client writer is admin maintenance and letting a
reader zero out tweet counts has no product justification. If you'd prefer the
looser `loggedIn()`/`userMayStar()` gate, adjust here.

### 3. Tighten `cardEditInboundReferences` to require `updated` (decision: require)

```
return (resource.data.published || userMayViewUnpublished())
  && affectedKeys.hasOnly(allKeys) && affectedKeys.hasAny(referenceKeys)
  && affectedKeys.hasAny(['updated']) && request.resource.data.updated == request.time;
```

Changed from `(!affectedKeys.hasAny(['updated']) || updated==request.time)` to
requiring `updated`. The client always sends it (`card_diff.ts:607`;
`tools/mount.ts` now does too via `06cba17c`'s follow-up).

## Testing

Extend the emulator-backed `test:security` suite (`test/security`, run under
the Firestore emulator) with card-write cases:

1. Content edit **without** bumping `updated` → **denied**.
2. Content edit **with** `updated == request.time` → allowed (as authorized editor).
3. Content edit setting `updated` to a non-`request.time` value → denied.
4. `create` without `updated` → denied; `create` with `updated == request.time` → allowed.
5. Star increment (no `updated`) → still allowed (`cardEditLegalStars`).
6. Thread-counter / `updated_message` write (no `updated`) → still allowed.
7. `resetTweets`-shape write (`{tweet_count, last_tweeted}`, no `updated`) → allowed **as admin**, denied as non-admin.
8. Inbound-reference write **without** `updated` → **denied** (newly required); **with** `updated == request.time` → allowed.

## Rollout

Rules take effect for all client writes immediately on deploy, so a missed
non-bumping client path would break editing. Mitigations:

1. **Enumeration is done** (table above): `resetTweets` is the only
   non-bumping client card write outside a counter branch, and it is handled.
2. **Dev first.** Deploy to the dev project, run `test:security`, and exercise
   the core flows (create, edit, publish/unpublish, star, comment, add tag,
   fork, delete, and `resetTweets`) before prod.
3. **Reversible.** The change is a few rule lines; keep the prior form in git
   for a fast rollback.

**Residual risk — old cached clients.** Tightening inbound-refs to *require*
`updated` (§3) can reject an inbound-ref write from a stale service-worker
bundle running pre-guard code, which would fail the enclosing edit batch. The
client-code guard has shipped, so freshly loaded clients always send it;
verify no materially old bundles remain (or force a cache bust) before the prod
deploy. This is the "tighten once old clients age out" caveat from the design
doc, accepted here in exchange for closing the branch.

## Acceptance criteria

- `firestore.rules` enforces `updated == request.time` on card create and on
  the `userMayEditCard` update branch; `cardEditInboundReferences` requires it.
- `resetTweets`, stars, and comment counters still succeed; content edits and
  creates that skip the bump are denied.
- New `test:security` cases (1–8) pass under the emulator.
- Dev deploy verified against the core-flow checklist before prod.

## Interaction with the existing client guard

This is additive belt-and-suspenders, not a replacement. The client
`MultiBatch` guard stays (fails fast at write-build time with a clear
developer error, and covers the shape before a network round-trip); the rules
are the independent backstop that also covers raw `updateDoc`/`runTransaction`
client writes and cannot be bypassed by any client code path. Admin-SDK writes
remain outside both rules and (for raw admin writes) the runtime guard — see
Scope.

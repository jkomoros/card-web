# `updated`-Invariant Security Rules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Firestore Security Rules reject any card content write that does not bump `updated`, so the sync invariant is enforced at the database boundary independent of client code.

**Architecture:** Edit the `cards/{card}` rules in `firestore.rules` to require `updated == request.time` on create and on the `userMayEditCard` edit branch, add an admin-gated `cardEditLegalTweets` disjunct so `resetTweets` still works, and tighten `cardEditInboundReferences` to require `updated`. Prove every branch with the emulator-backed `test:security` suite.

**Tech Stack:** Firestore Security Rules; `@firebase/testing` + mocha under the Firestore emulator (`test/security/test.js`); the design doc is `docs/superpowers/specs/2026-07-06-updated-invariant-security-rules-design.md`.

## Global Constraints

- Tests run under **Node 20.20.0** (`.nvmrc`); the system Node 26 breaks the mocha/yargs toolchain. Prefix test commands with `bash -lc 'export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 20.20.0 >/dev/null; <cmd>'`.
- `test:security` requires the **Firestore emulator** (Java). Full run: `npm run test:security`. Targeted run: `firebase emulators:exec --only firestore "npx mocha -r esm test/security --timeout=10000 --grep '<pattern>'"`.
- In rules, `serverTimestamp()` resolves to `request.time` during evaluation (proven by the existing passing test at `test/security/test.js:462`). Access possibly-absent fields with `request.resource.data.get('updated', null)`, matching the existing `resource.data.get('section', '')` idiom (firestore.rules:273) — never bare `.updated`, which errors when the key is absent.
- Rules changes take effect for ALL client writes on deploy; admin-SDK writes (`functions/`, `tools/`) bypass rules and are out of scope.
- The card used by most tests is `cardId` (`'card'`), published, authored by `bobUid`, with `sallyUid` as editCard grantee; `jerryUid` has blanket `edit`; `adminUid` is admin; `genericUid` is a plain user. It has NO `updated` field in setup.

---

### Task 1: Make existing success tests bump `updated` (forward-compat prep)

Purely updates existing passing tests so they stay green after the rule change. No rule change yet — under current rules these writes are still allowed, so the suite stays green. Isolating this de-risks the enforcement tasks.

**Files:**
- Modify: `test/security/test.js` (three groups of `it(...)` blocks, identified by description string)

**Interfaces:**
- Consumes: nothing.
- Produces: existing edit/create/inbound success tests now include `updated: firebase.firestore.FieldValue.serverTimestamp()`.

- [ ] **Step 1: Add `updated` to the three create-success tests**

In `test/security/test.js`, in these three `it` blocks, add `updated: firebase.firestore.FieldValue.serverTimestamp()` to the `card.set({...})` object:
- `'allows admins to create a card'` → `card.set({tile:'foo', body:'foo', author:adminUid, updated: firebase.firestore.FieldValue.serverTimestamp()})`
- `'allows users with edit permission to create a card'` → add `updated:` the same way (author stays `jerryUid`)
- `'allows users with createCard permission to create a card'` → add `updated:` the same way (author stays `genericUid`)

Leave the `assertFails` create tests (`'disallows admins to create a card they aren\'t author of'`, `'does not allow normal users to create a card'`, `'does not allow unauthenticated users to create a card'`) unchanged — they still fail for the author/permission reason.

- [ ] **Step 2: Add `updated` to the five arbitrary-edit success tests**

In each of these `it` blocks change `card.update({foo:5})` to `card.update({foo:5, updated: firebase.firestore.FieldValue.serverTimestamp()})`:
- `'allows users with edit permission to arbitrarily edit a card'`
- `'allows users with editCard permission to arbitrarily edit a card'`
- `'allows users explicitly marked as author for that card to arbitrarily edit a card'`
- `'allows users explicitly marked as editors for that card to arbitrarily edit a card'`
- `'allows users explicitly marked as editors to arbitrarily edit a card'`

Leave `'disallows any non-admin user to set arbitrary field on card'` (assertFails `card.update({foo:5})`) unchanged.

- [ ] **Step 3: Add `updated` to the two inbound-link success tests**

In `'allows users to update inbound links on a card they can see but cant edit'` and `'allows users to update inbound links on an unpublished card they can see but cant edit'`, add `updated: firebase.firestore.FieldValue.serverTimestamp()` to the `card.update({...})` object (alongside the `references_inbound.*` / `references_info_inbound.*` keys).

Leave the two `assertFails` inbound tests unchanged.

- [ ] **Step 4: Run the security suite — expect still green**

Run: `bash -lc 'export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 20.20.0 >/dev/null; npm run test:security'`
Expected: PASS (all existing tests, now with `updated` added, still allowed under current rules).

- [ ] **Step 5: Commit**

```bash
git add test/security/test.js
git commit -m "test(security): bump updated in existing card write success tests (prep)"
```

---

### Task 2: Require `updated` on card create

**Files:**
- Modify: `firestore.rules` (add `bumpsUpdated()` helper; `cards` `allow create`)
- Modify: `test/security/test.js` (add one deny test)

**Interfaces:**
- Consumes: nothing.
- Produces: `function bumpsUpdated()` in firestore.rules, reused by Task 3.

- [ ] **Step 1: Write the failing test**

Add near the other create tests in `test/security/test.js`:

```javascript
it('disallows creating a card without bumping updated', async() => {
	const db = authedApp(adminAuth);
	const card = db.collection(CARDS_COLLECTION).doc(cardId + 'new');
	await firebase.assertFails(card.set({tile:'foo', body:'foo', author:adminUid}));
});
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `firebase emulators:exec --only firestore "npx mocha -r esm test/security --timeout=10000 --grep 'without bumping updated'"` (wrapped in the Node-20 prefix)
Expected: FAIL — currently create has no `updated` requirement, so the write SUCCEEDS and `assertFails` rejects.

- [ ] **Step 3: Add the `bumpsUpdated()` helper**

In `firestore.rules`, immediately before `function cardEditInboundReferences()`, add:

```
    //True when the write stamps `updated` with the request server-time, i.e.
    //it bumped `updated: serverTimestamp()`. Works for create (no resource)
    //and update (merged post-state). .get avoids erroring on an absent key.
    function bumpsUpdated() {
      return request.resource.data.get('updated', null) == request.time;
    }
```

- [ ] **Step 4: Require it on create**

Change the `cards` `allow create` line:

```
allow create: if userMayCreateCard() && createIsAuthor() && bumpsUpdated();
```

- [ ] **Step 5: Run the full suite — expect green**

Run: `bash -lc 'export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 20.20.0 >/dev/null; npm run test:security'`
Expected: PASS — the new deny test passes; the Task-1-updated create-success tests (which now send `updated`) pass.

- [ ] **Step 6: Commit**

```bash
git add firestore.rules test/security/test.js
git commit -m "rules: require updated == request.time on card create"
```

---

### Task 3: Require `updated` on the main edit branch + fold tweet counters into cardEditMinor

These two changes ship together: tightening `userMayEditCard` removes the fallback that `resetTweets`'s tweet-counter write currently rides, so the `cardEditLegalTweets` branch must land in the same commit to keep `resetTweets` working.

**Files:**
- Modify: `firestore.rules` (`cardEditMinor`, new `cardEditLegalTweets`, `cards` `allow update`)
- Modify: `test/security/test.js` (add four tests)

**Interfaces:**
- Consumes: `bumpsUpdated()` (Task 2).
- Produces: `function cardEditLegalTweets(affectedKeys)`.

- [ ] **Step 1: Write the failing tests**

Add near the arbitrary-edit tests in `test/security/test.js`:

```javascript
it('disallows an editor from editing card content without bumping updated', async() => {
	const db = authedApp(jerryAuth);
	const card = db.collection(CARDS_COLLECTION).doc(cardId);
	await firebase.assertFails(card.update({foo:5}));
});

it('disallows an editor from editing card content with a non-request-time updated', async() => {
	const db = authedApp(jerryAuth);
	const card = db.collection(CARDS_COLLECTION).doc(cardId);
	await firebase.assertFails(card.update({foo:5, updated: new Date(2015,10,10)}));
});

it('allows an admin to reset vestigial tweet counters without bumping updated', async() => {
	const db = authedApp(adminAuth);
	const card = db.collection(CARDS_COLLECTION).doc(cardId);
	await firebase.assertSucceeds(card.update({tweet_count: 0, last_tweeted: new Date(0)}));
});

it('disallows a non-admin editor from writing tweet counters', async() => {
	const db = authedApp(jerryAuth);
	const card = db.collection(CARDS_COLLECTION).doc(cardId);
	await firebase.assertFails(card.update({tweet_count: 0, last_tweeted: new Date(0)}));
});
```

- [ ] **Step 2: Run them — expect FAIL**

Run: targeted grep for `'without bumping updated'` and `'tweet counters'` (Node-20 prefix + `firebase emulators:exec`).
Expected: FAIL — currently an editor can set arbitrary fields (both deny tests wrongly SUCCEED) and a non-admin editor can write tweet counters (deny wrongly SUCCEEDS). The admin-tweet test currently passes (rides `userMayEditCard`), so it stays green through this task.

- [ ] **Step 3: Add the `cardEditLegalTweets` disjunct**

In `firestore.rules`, replace `function cardEditMinor()` with:

```
    function cardEditMinor() {
      let affectedKeys = request.resource.data.diff(resource.data).affectedKeys();
      //we can bail only if there are any keys not in this set, or if they aren't any keys in this set, without doing the more expensive calculations.
      let allKeys = ['star_count', 'star_count_manual', 'thread_count', 'thread_resolved_count', 'thread_count', 'updated_message'];
      return affectedKeys.hasOnly(allKeys) && affectedKeys.hasAny(allKeys) && cardEditLegalMessages(affectedKeys)
        || cardEditLegalStars(affectedKeys)
        || cardEditLegalTweets(affectedKeys);
    }
```

and add, next to `cardEditLegalStars`:

```
    function cardEditLegalTweets(affectedKeys) {
      //resetTweets zeroes vestigial tweet counters. Admin-gated: the only
      //client writer is the admin-run resetTweets maintenance task (the Twitter
      //Cloud Functions use the admin SDK and bypass rules). Accepted-drift
      //counters that must NOT bump `updated` (a whole-corpus redelivery).
      return userIsAdmin() && affectedKeys.hasOnly(['tweet_count', 'last_tweeted']);
    }
```

- [ ] **Step 4: Require `updated` on the `userMayEditCard` branch**

Change the `cards` `allow update` line:

```
allow update: if cardEditMinor() || cardEditInboundReferences() || (userMayEditCard(card) && bumpsUpdated());
```

- [ ] **Step 5: Run the full suite — expect green**

Run: `bash -lc 'export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 20.20.0 >/dev/null; npm run test:security'`
Expected: PASS — the two content-edit deny tests pass; admin tweet reset allowed (via `cardEditLegalTweets`); non-admin tweet write denied; the Task-1-updated arbitrary-edit tests (now sending `updated`) pass; stars/threads unchanged.

- [ ] **Step 6: Commit**

```bash
git add firestore.rules test/security/test.js
git commit -m "rules: require updated on card content edits; admin-gated tweet-counter exemption"
```

---

### Task 4: Require `updated` on inbound-reference writes

**Files:**
- Modify: `firestore.rules` (`cardEditInboundReferences`)
- Modify: `test/security/test.js` (add one deny test)

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing consumed downstream.

- [ ] **Step 1: Write the failing test**

Add near the inbound-link tests in `test/security/test.js`:

```javascript
it('disallows updating inbound links without bumping updated', async() => {
	const db = authedApp(genericAuth);
	const card = db.collection(CARDS_COLLECTION).doc(cardId);
	await firebase.assertFails(card.update({
		['references_inbound.' + unpublishedCardId]: true,
		['references_info_inbound.' + unpublishedCardId + '.link']: '',
	}));
});
```

- [ ] **Step 2: Run it — expect FAIL**

Run: targeted grep for `'inbound links without bumping updated'` (Node-20 prefix + emulator).
Expected: FAIL — `updated` is currently optional on inbound writes, so this SUCCEEDS and `assertFails` rejects.

- [ ] **Step 3: Tighten the rule**

In `firestore.rules` `cardEditInboundReferences()`, change the final `return` from the optional form to require `updated`:

```
      return (resource.data.published || userMayViewUnpublished()) && affectedKeys.hasOnly(allKeys) && affectedKeys.hasAny(referenceKeys) && affectedKeys.hasAny(['updated']) && request.resource.data.updated == request.time;
```

Update the comment above `allKeys` to say `updated` is now REQUIRED (drop the "Tighten to REQUIRED once clients that send it have fully shipped" note).

- [ ] **Step 4: Run the full suite — expect green**

Run: `bash -lc 'export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 20.20.0 >/dev/null; npm run test:security'`
Expected: PASS — the new deny test passes; the Task-1-updated inbound-success tests (now sending `updated`) pass.

- [ ] **Step 5: Commit**

```bash
git add firestore.rules test/security/test.js
git commit -m "rules: require updated on inbound-reference card writes"
```

---

### Task 5: Staged rollout to dev, then prod

No code. Operational verification that the tightened rules don't reject a legitimate client write in the running app.

**Files:** none.

- [ ] **Step 1: Deploy rules to the dev project**

Run: `npm run deploy:dev` (or the rules-only deploy the team uses). Confirm the deploy targets the dev Firebase project, not prod.

- [ ] **Step 2: Exercise the core flows in the dev app**

As an editor/admin, verify each still succeeds (no permission-denied in console): create a card; edit body/title; toggle published/unpublished; add a tag; star/unstar; add a comment; fork a card; delete an orphaned card; and (as admin) run the `reset-tweets` maintenance task. Any deny indicates a non-bumping client path the enumeration missed — stop and fix the client to bump before proceeding.

- [ ] **Step 3: Confirm no stale-client risk for inbound writes**

Confirm freshly-loaded clients run the post-guard bundle (inbound writes send `updated`, per `src/card_diff.ts:607`). If materially old service-worker bundles may still be live, force a cache bust / version bump before prod, since Task 4 now rejects inbound writes lacking `updated`.

- [ ] **Step 4: Deploy to prod**

After dev verification passes, deploy the rules to prod. Keep the prior `firestore.rules` revision handy (git) for fast rollback if a real write path is rejected.

---

## Notes for the executor

- Each rule task's RED step relies on running only the new test(s) via `--grep` so you observe the intended failure before the fix; the GREEN step runs the whole `test:security` file so you also catch regressions in neighboring branches.
- If `npm run test:security` cannot start the emulator in your environment (missing Java/firebase-tools), report that rather than skipping — the rules changes are not verified without it.

# 02 — Editor session, intent-first save, one queue

Status: DETAIL for `docs/lean-mutation-architecture.md` §4.1, §4.3 (slice 2) and
§4.5/§4.6 (slice 6). Baseline `master` 8f56ea89. Nothing here is built.

**VERIFIED** = read at the cited line, or measured (method stated).
**UNVERIFIED** = inferred; a test must confirm it before anything relies on it.

## 0. Findings that change the plan

| # | Finding (all VERIFIED unless marked) | Consequence |
|---|---|---|
| F1 | The legacy record `card-web-pending-multi-edit-v1` (`data.ts:410`) is **one slot**. Creating it asserts that no record exists (`:1033-1036` → `:558-562`). A save that arrives while another runs has nowhere to write, which is *why* it parks first. | **`card-modify` must become a queue kind in slice 2**, not slice 6. |
| F2 | There is a third intent store: `card-web-pending-bulk-tag-operation-v1` (`data.ts:409`; own chunk loop and markers, `:620-800`). | Add a `bulk-tag` kind. |
| F3 | `editingFinish(true)` runs for **every** single save while any editor is open (`data.ts:1162`), including the collaborator changes in `permissions.ts:95,112`. Reachability while editing is UNVERIFIED. | Only an editor-originated save with a matching session may close the editor. |
| F4 | `pendingSaveCard` is one slot. Save A, then save B before A acks, and A's face falls back to the stale corpus copy (`editor.ts:174`). | Change it to `pendingSaves` keyed by card. |
| F5 | Counts already reach the user, but only on full success: a `committed` snackbar (`data.ts:1414-1418`). A pause says only "N of M processed safely" (`:1428-1431`), and skipped targets are never named. | §4 is a small change. |
| F6 | `editingCommit` holds three `confirm()`s (`editor.ts:415,421,426`). HOUSE-STYLE §3.4: whoever edits the function replaces them. | Slice 2a (§6). |
| F7 | Every discard banner says "You can try it again." (`user.ts:908`), even when retrying cannot work. | Discard copy per kind and per reason. |
| F8 | Each multi-edit chunk re-parses and re-stringifies the whole record (`data.ts:1007-1036`). Synthetic, Node, no storage I/O: 60k targets is a 1.33 MB record, ~4.9 ms per persist, ~30 s over 6000 chunks. | Separate mutable progress key (§3.2). This also deletes `durableTargetsCache` (`:442-490`). |
| F9 | A record pending for account X refuses every save by account Y (`data.ts:1140`). | Per-uid queue replay fixes it. |
| F10 | AGENTS.md pins the native-modal count at 51. HOUSE-STYLE §6 says 41, and the grep agrees (42 lines minus 1 known false positive). | Docs-only fix. |
| F11 | Resolve-thread's transaction never checks `resolved` (`comments.ts:121-136`), so a replay decrements `thread_count` twice. | The executor checks it first. |

## 1. Editor session (slice 2)

### 1.1 State

```ts
export type EditorSession = {cardID : CardID, generation : number};
//EditorState gains / changes:
session: EditorSession | null,
nextGeneration: number,                 //monotonic, never reset
awaitingOperationID: string | null,     //base is a committed-but-unacked save
deferredUnderlying: Card | null,        //newest image seen while awaiting
pendingSaves: {[id : CardID] : {card : Card, operationID : string}},  //replaces pendingSaveCard
```

`underlyingCardSnapshot` stays the **editor base** (`types.ts:1148-1155`).

### 1.2 Actions and reducer rules

**Anything that resumes after an await, a modal, a timer or a round trip
carries `session` or `operationID`. On a mismatch the reducer leaves editor
fields alone.** Synchronous teardowns pass nothing and stay unconditional. These
are the ownership purge (`corpus-bridge.ts:1732,1793`) and delete
(`data.ts:3530`).

| Action | Carries | Rule |
|---|---|---|
| `EDITING_START` | `card`, `pending?` (the thunk reads it) | Bumps generation. Base = `pending?.card ?? card`. `awaitingOperationID = pending?.operationID`. Never touches `pendingSaves`. |
| `EDITING_COMMITTED` (new; replaces `EDITING_FINISH{pendingSave}`) | `session, operationID, committedCard` | **Always** writes `pendingSaves[cardID]`. If the session is live, tear down when `card` deep-equals `committedCard`. Otherwise stay open with `base = committedCard` and await. |
| `EDITING_FINISH` | `session?` | Ignored when the session is stale. **Never clears `pendingSaves`** (this was the `:174` defect). |
| `EDITING_UPDATE_UNDERLYING_CARD` | `cardID, generation?` | Ignored for another card or a stale generation (the async `getDoc`, `editor.ts:380-388`). While awaiting, stash the image in `deferredUnderlying`. Otherwise rebase (`:456-469`) and apply slice 1 admission. |
| `MODIFY_CARD_SUCCESS` | `operationID, cardIDs, confirmed` | Drops that operation's `pendingSaves`. If the session awaits it, rebase onto the newer of `confirmed[id]` and `deferredUnderlying` by revision. |
| `MODIFY_CARD_FAILURE` | `operationID, cardIDs, terminal, serverCards?` | **Paused (`terminal:false`): keep the face**; the save is still queued (§3.6.1). **Terminal** (discarded or Stopped): drop it. If the session awaits it, set `base := deferredUnderlying ?? serverCards[id]` and leave `card` alone, so the committed edits show as unsaved again. |
| Refusals | — | **Stop dispatching `MODIFY_CARD_FAILURE`; use a `refused` snackbar.** Today the refusal at `editor.ts:408` clears another card's face and zeroes `pendingModificationCardIDs` (`data.ts:359-367`). |
| `EDITING_RESTORE_DRAFT` | `session` | Must match. `recoverEditDraft` awaits a modal and the card (`edit-draft.ts:342-366`). |

`data` reducer: key pending card IDs by operation. UNVERIFIED: the
`pendingModificationCount` listener gate (`data.ts:343-357`) must remain a sum
over live operations. Test it.

### 1.3 `editingCommit` diffs against the base

```ts
export const editingCommit = () : ThunkSomeAction => async (dispatch, getState) => {
	const session = selectEditingSession(getState());
	if (!session) return;
	const gate = selectCardSaveEligible(getState());
	if (!gate.eligible) { dispatch(showSnackbar(gate.reason, {kind: 'refused', dedupeKey: 'save-card'})); return; }
	const review = await dispatch(preSaveReview(session));          //slice 2a: replaces the confirm()s
	if (!review.proceed || !sessionIsLive(getState(), session)) return;
	const state = getState();
	const base = selectEditingUnderlyingCardSnapshot(state)!;         //was selectActiveCard (editor.ts:432)
	const committedCard = selectEditingCard(state)!;
	const update = generateCardDiff(base, committedCard);
	if (!cardDiffHasChanges(update)) return;
	//What the user composed against; for fields they agreed to overwrite in the
	//review, the corpus image they were shown. Was selectRawCards (data.ts:1147).
	const baseFields = baseFieldsFor(update, base, review.acknowledgedOverwrite ? selectEditingUnderlyingCard(state) : null);
	dispatch(commitEditorSave(session, update, committedCard, baseFields, Boolean(state.editor.substantive)));
};
```

`diff(corpus, draft)` includes every field where the corpus differs: it
reverts a remote change not yet auto-merged (`card-editor.ts:1101`) and
re-writes committed edits on a reopen-while-pending. VERIFIED in code;
reachability UNVERIFIED (test 6).

### 1.4 Intent first

```ts
export const commitEditorSave = (session, update, committedCard, baseFields, substantive) : ThunkSomeAction => (dispatch, getState) => {
	const state = getState();
	if (!sessionIsLive(state, session)) return;
	const intent = makeAuxWriteIntent(selectUid(state), 'card-modify', session.cardID, '', {
		kind: 'card-modify', update, substantive, baseFields,
		baseRevision: selectEditingUnderlyingCardSnapshot(state)?.revision ?? 0,     //slice 1 field
	});
	const queued = enqueueAuxWrite(intent);    //SYNC budget check + body + index (split from runDurableAuxWrite)
	if (!queued.ok) { dispatch(showSnackbar(`Your edit wasn’t saved: ${queued.message} It is still open here.`, {kind: 'refused'})); return; }
	dispatch({type: EDITING_COMMITTED, session, operationID: intent.id, committedCard});   //same tick
	void attemptAuxWrite(intent.id);           //waits on cardLane: that wait IS the old park
};

//data.ts: modifyCardsWithDurableMultiEdit loses kind:'single', the park block
//(:1083-1127), the editingFinish block (:1160-1173), and the draft events (:1163,1410).
export const modifyCardsWithDurableMultiEdit = (cards, update, substantive = false, resumeTargetIDs?) : ThunkSomeAction => async (dispatch, getState) => {
	if (!durableSaveEligible(getState())) { /* refusal snackbar */ return; }
	const release = await cardLane.acquire();  //replaces durableMultiEditRunning / RunSettled / ParkedKey
	try { await runCardEditPlan(/* today's chunk loop, extracted */); } finally { release(); }
};   //slice 6: the body becomes enqueue('multi-edit'); runCardEditPlan becomes its executor
```

`modifyCard` from the permissions code enqueues `card-modify` with no session,
so it never closes an editor (F3). The `card-modify` executor is
`runCardEditPlan` with one target: today's marker and overwrite guard.

### 1.5 What the user sees

- **Save:** the editor closes in the same tick. The face shows `pendingSaves[A]`
  with the existing unconfirmed marker (`card-view.ts:1290-1292`). The pill reads
  *pending* in amber (§3.6.2), even while the save waits behind another. There
  is no scrim, because the save is already durable.
- **Reopening A while it is pending** is now allowed (today it is refused at
  `editor.ts:348`). A late ack cannot be mistaken for a newer edit, because only
  `awaitingOperationID` matches it. The editor opens with
  `base = committedCard`. The blocking scrim (`card-editor.ts:586-588`) becomes a
  non-blocking `role=status` line: *"Your last save of this card hasn't reached
  the server yet. Keep editing; Save turns back on when it lands."* The disabled
  Save shows the same text in its `span.reason`.
- **Keystrokes typed after the commit** form a diff against `committedCard`.
  This covers the reopen case, and an editor kept open by `EDITING_COMMITTED`
  once the 2a review is async. On ack, `confirmed[A]` arrives at revision r+1
  (the committed content plus finisher and timestamp fields), and
  `card := cardFromDiff(confirmed, diff(committedCard, card))`. Only the new
  keystrokes stay dirty. Revision-r listener images wait in `deferredUnderlying`,
  and slice 1 admission drops them anyway.

### 1.6 One eligibility selector

```ts
export const selectCardSaveEligible = createSelector(
	selectEditingSession, selectEditingCardHasUnsavedChanges, selectCardSavesEligible,
	selectCorpusStatus, selectPendingCardIntents,
	(session, dirty, corpusOK, status, pending) : {eligible : true} | {eligible : false, reason : string} => {
		if (!session) return {eligible: false, reason: 'Not editing a card.'};
		if (!corpusOK) return {eligible: false, reason: blockedReason(status, SAVE_VERB)};
		const p = pending[session.cardID];
		if (p === 'paused') return {eligible: false, reason: 'An earlier save of this card is paused. Use Retry or Stop on the save indicator.'};
		if (p) return {eligible: false, reason: 'Your last save of this card hasn’t reached the server yet.'};
		if (!dirty) return {eligible: false, reason: 'No changes to save.'};
		return {eligible: true};
	});
```

Callers, all grepped (VERIFIED):

- `card-editor.ts:971` (the button, plus a `span.reason`) and `:1032`.
- `editor.ts:402`, the one choke point for `app.ts:506 doCommit` ←
  `main-view.ts:565-579` (Cmd/Ctrl-Enter) and for `perf-harness-api.ts:61`.
- `commitEditorSave`, which re-checks after the await.

These are **not** callers and keep `selectCardSavesEligible`, because they gate
non-editor writes: `suggestions-viewer.ts:420`, `find-dialog.ts:602`,
`bulk-import-dialog.ts:326`, `multi-edit-dialog.ts:570`.

The new name sits one letter from that existing selector, so I suggest
`selectEditorSaveEligibility`. `selectPendingCardIntents` is pushed by the
queue's depth-listener seam. It replaces `durableCardMutationPendingForCard`,
which reads localStorage on every `card-view` stateChanged (`card-view.ts:1303`).

### 1.7 Drafts

**The queue holds committed edits; the draft slot holds uncommitted ones**
(principle 3). Delete:

- `stampDraftForSave`, the preserve and confirmed events, and
  `draftMatchesConfirmedSave` (`edit-draft.ts:217-224,302-313`;
  `edit-draft-confirmation.ts`).
- The draft `operationID` and its filter (`card-web-app.ts:707-709`).

Otherwise a reopen while pending would overwrite A's stamped slot with only the
new keystrokes. On a **terminal** discard or Stop of a `card-modify`, the
handler writes the intent's `update` into A's draft slot (`cardFromDiff` under
any newer dirty draft), and the existing recovery banner offers it.

## 2. Sequencing

- **Slice 2:** §1, the `card-modify` kind, and `cardLane`. `cardLane` is an
  in-tab promise chain plus the Web Lock `card-web-card-lane`. `card-modify` and
  the still-legacy multi-edit and bulk-tag runners all acquire it.
- **Slice 6:** the remaining seven kinds, deletion of both legacy keys
  (most of `data.ts:404-1040`), and per-target surfacing.

## 3. One queue

### 3.1 Kind policy

```ts
type KindPolicy = {highValue : boolean, lane : 'card' | 'none', gate : 'auth' | 'save-eligible', longRunning : boolean, payloadRef : boolean};
const POLICY : Record<AuxWriteKind, KindPolicy> = {
	'card-modify':       {highValue: true,  lane: 'card', gate: 'save-eligible', longRunning: false, payloadRef: false},
	'suggestion-modify': {highValue: true,  lane: 'card', gate: 'save-eligible', longRunning: false, payloadRef: false},
	'multi-edit':        {highValue: true,  lane: 'card', gate: 'save-eligible', longRunning: true,  payloadRef: true},
	'bulk-tag':          {highValue: true,  lane: 'card', gate: 'save-eligible', longRunning: true,  payloadRef: true},
	'reorder':           {highValue: true,  lane: 'card', gate: 'auth',          longRunning: false, payloadRef: false},
	'add-slug':          {highValue: true,  lane: 'card', gate: 'auth',          longRunning: false, payloadRef: false},
	'create-tag':        {highValue: true,  lane: 'card', gate: 'auth',          longRunning: false, payloadRef: false},
	'resolve-thread':    {highValue: false, lane: 'none', gate: 'auth',          longRunning: false, payloadRef: false},
	//existing kinds: lane 'none', gate 'auth'. HIGH_VALUE_KINDS (aux:587) folds in here.
};
```

`card-create` and `card-delete` stay on lane `none`, because bulk import's
concurrency of 8 (`aux:992-1006`) is deliberate. A later save of the same card
waits through eligibility: there is an unacked intent for it.

### 3.2 Multi-edit mapped onto claim, replay and deadline

| Today | In the queue |
|---|---|
| One slot; park one save; refuse a third (`data.ts:1081-1112`) | Gone. The lane serializes execution. One product rule stays: at most one outstanding `multi-edit`/`bulk-tag` per uid, refused *before* it is persisted. |
| `durableMultiEditRunning` (per tab) | `cardLane`. Its Web Lock is the cross-tab mutex the localStorage claim is not (`aux:1086-1092`). There is no cycle with `AUX_REPLAY_LOCK`, because first attempts never take it. |
| A mutable record holding `nextIndex`, the counts, `oversizedBaseCards`, `lastError` and `overwriteAcknowledged` | An immutable payload key `card-web-aux-writes-v2-p-{id}` (`targetIDs, update, substantive, baseFields`, plus `tag, adding` for bulk-tag) and a **mutable progress key** `-s-{id}` beside `-c-`/`-f-`. A chunk rewrites only the progress key. `assertSavedOperationCurrent` becomes a compare-and-set on `progress.nextIndex`. |
| Resume on the readiness edge or `online` (`data.ts:1497-1525`) | Replay, plus a trigger on the save-gate edge. `save-eligible` kinds throw `DeferIntent` while the gate is closed. Replay then stops in order and does not count a failure. |
| Marker probing (`data.ts:1197-1223`) | Unchanged; it is the replay preflight. |
| An 8 s deadline with ≤4 extensions (`aux:873-990`) | `longRunning` kinds re-arm on each progress advance. Otherwise any run over ~40 s raises a false stuck banner (`aux:984`). |
| Paused overwrite conflict that only Retry clears (`data.ts:1458-1474`) | `progress.status = 'needs-user'`. The lane skips it but holds back later intents that touch its targets. Today it refuses every single save (`data.ts:1173-1178`). |
| uid check per chunk (`:1339`) | Kept; it throws `DeferIntent`. |

**Budget** (`aux:431-435`: 1.5 MB, 250 intents; VERIFIED). A 60k-target payload
alone is 1.33 MB (F8), so with `payloadRef` the queue body is about 150 B and
counts only against the 250-intent cap. The payload is budgeted on its own: it
is refused at enqueue above 2 MB, using the existing over-budget copy.
`card-modify` bodies stay inside the queue.

### 3.3 Per kind

The classifier at `aux:805-812` treats `permission-denied`, `not-found`,
`invalid-argument` and `failed-precondition` as permanent. That is wrong for
card writes. `permission-denied` also comes from an expired token, a sign-in
race, or (after slice 1) a non-transactional write with a stale `revision`.
Whether slice 1 has any such write is UNVERIFIED; the additive path uses none
(`lifecycle.test.js:198`).

Card-lane executors therefore throw `PermanentIntentError(reason)`,
`PausedIntentError` or `DeferIntent`; anything else is transient. On
`permission-denied` they re-read the card and permission: permanent only if
access is really gone, else retry once, then transient.

| Kind | Payload | Replay preflight / idempotency | Permanent iff | Permanent copy (never "try again" unless it can work) |
|---|---|---|---|---|
| `card-modify` | `update, substantive, baseFields, baseRevision` | Marker `users/{uid}/multi_edit_chunks/{id}-0`, written with the card; value guard | Card absent; may not edit (fresh check); malformed | "Your edit to “T” wasn't saved because the card was deleted / you can no longer edit it. Your text is kept as a draft on this device." Action **Open draft** (§1.7). |
| `multi-edit`, `bulk-tag` | `payloadRef` | Existing chunk markers plus probing | Never the whole operation. Absent targets count as skipped. *Proposed:* at chunk size 1, a denied target goes to `deniedIDs` and the run continues. | §4 summary |
| `reorder` | `cardID, sortOrder` (computed when the user acted, `data.ts:2169`) | Server `sort_order` already equals it | Card absent; may not reorder | "Moving “T” didn't go through because it was deleted / you can no longer reorder this collection." |
| `add-slug` | `cardID, slug, setName` | Slug present means done; else call `legal` again (the §4.5 server check) | Slug illegal or taken; card absent | "“s” was taken before it could be added. Choose a different slug." Revert the editor's `slugAdded` only when its session is live. |
| `create-tag` | `tagID, displayName, color, startCard, sortOrder` | One atomic batch, as today (`data.ts:2428-2457`). Done when the tag exists, its `start_cards` holds `tag-{id}`, and that card's `author === uid`. | Exists and isn't ours; not admin | "A tag called “x” was created elsewhere first, so yours wasn't." |
| `resolve-thread` | `threadID, cardID` | **In the transaction, an already-resolved thread is a no-op** (F11) | May not resolve. A missing thread or card counts as `committed`. | "Resolving that thread didn't go through because you can no longer resolve it." |
| `suggestion-modify` | `updates: {[id]: CardDiff}`, `substantive`, per-id `baseFields`, `suggestionKey` | Markers; `runCardEditPlan` with `updateFor(id)` | As `card-modify`, per target | "The suggestion was applied to 2 of 3 cards. “T” was deleted." Dismiss only on `committed`; today a refusal reads as success (`data.ts:1572-1577`). |

The stuck banner (`user.ts:913-923`) is already right for every kind. Only the
discard copy changes, to `DISCARD_COPY[kind](reason)` beside `DISCARD_LABELS`
(`aux:737-749`).

**Sign-out / account switch:** replay is per uid with a live-uid check
(`aux:1140,1156`). Other accounts' intents are kept, never run under the wrong
auth, no longer block the new account (F9), and age out after 30 days via the
existing report (`aux:613-625`).

## 4. Per-target result surfacing

Progress already holds `modifiedCount`, `skippedCount` and, by derivation,
"already matched". Add `skippedIDs` and `deniedIDs`, keeping IDs up to ~200
targets and counts beyond that.

- **Everything accounted for:** the existing `committed` snackbar
  (`data.ts:1417`), HS §5's *transient outcome*.
- **Any target skipped or denied:** `reportPersistentError`, HS §5's
  *persistent failure*. Example text: "12 of 15 cards were edited. 2 were
  deleted first; you can't edit 1." Reassurance: "The other cards kept their
  changes." Action **Show cards** (`registerPersistentErrorAction` →
  `find-dialog`). Dedupe on the operation id.
- **While running or paused:** the existing `progress-panel`
  (`multi-edit-dialog.ts:297-310`).

No new native modals.

## 5. Tests

Emulator, `bootstrapApp`, real thunks, `card-view`/`card-editor` mounted as in
`test/unload-guard`; raw dispatch only where thunk guards are not under test.
Delay = deferred `MultiBatch.prototype.commit` stub (`lifecycle.test.js:52`).
Reload = `resetAuxWriteQueueForTesting()` (`aux:1278`) + a new
`registerCardWriteExecutors()` (the reset wipes executors and reporters).
Vacuity: revert the hunk under "master fails", rebuild, confirm failure.

| # | Scenario and assertion | Master fails because |
|---|---|---|
| 1 | **Park + type.** Hold save X. Commit A and type immediately. The intent is persisted and `editing === false` in the same tick. Reopen A and type "extra", then release both. The editor holds "extra", the base is at revision r+1, the diff is only "extra", and the draft holds it. | Nothing is persisted during the park (`data.ts:1100-1123`). The face shows "extra" (`pendingSaveCard = state.card`) and the confirm clears the draft, so "extra" is lost. |
| 2 | **Park + cancel + open B.** Hold X. Commit A, cancel, open B, type, release. B is still open and intact; the server holds A's committed diff only. | The post-park `editingFinish(true)` closes B (`data.ts:1162-1172`). |
| 3 | **Save A → create B → cancel B → back to A**, with A's commit held. The `card-view` title is A's committed one. | `editor.ts:174` |
| 4 | **Unrelated failure during A's save.** An `editingCommit` refusal on B, a `createTag` failure, and a refused reorder each leave A's face, `pendingCardIntents[A]` and A's gating intact. | `editor.ts:183`, `data.ts:359-367` |
| 5 | **Eligibility parity.** With A pending, the button is disabled and shows the reason. Cmd-Enter creates no intent and shows a refused snackbar with the same text. | No pending-intent clause exists. |
| 6 | **Diff base.** Base title T0; corpus title T1 (raw `UPDATE_CARDS`, no rebase). Edit the body only. The update has no `title`. | `editor.ts:432-447` |
| 7 | **Reload mid-queue, per new kind.** Hang the commit, reload, replay. Each effect happens exactly once: sort order, slug, tag plus start card, `thread_count`, every suggestion target, no duplicate markers or `card_updates`. Variant: the commit lands but the ack is lost. | Five kinds persist nothing; resolve double-decrements in the lost-ack variant (F11). |
| 8 | **Long-running deadline.** A 200-target multi-edit at 3 s per chunk raises no stuck banner. | n/a: a guard on a new path. |
| 9 | **Sign-out with queued intents.** Queue `card-modify` and `multi-edit` for X offline, then switch to Y. X's intents are kept, not executed, and not discarded. Y's save succeeds. X's face is cleared. Back as X, each replays once. | Y's save throws "another account" (`data.ts:1140`). |
| 10 | **Permanent copy.** Delete A on the server, then replay. The banner has no "try again", and **Open draft** restores the committed text. | `user.ts:908` |

## 6. Slices and lines (product + / − ; tests)

| Slice | Contents | + | − | Tests |
|---|---|---|---|---|
| 2a | Pre-save review dialog replaces the confirms in `editingCommit` and `confirmationsForCardDiff` (`card_diff.ts:335-371,592`); the pin falls by at least 11 | ~220 | ~70 | ~200 |
| 2 | §1 + `card-modify` + `cardLane` + draft simplification | ~480 | ~230 | ~650 |
| 6 | Seven kinds, side keys, policy, typed classification, surfacing; legacy keys deleted | ~620 | ~520 | ~800 |

Versus the architecture doc's 400/150 and 500/200: `card-modify` moved forward
(F1); slice 6 deletes most of `data.ts:404-1040`.

## 7. Open questions

1. Does 2a land before 2, or do you waive §3.4 for this one diff?
2. Should a paused, retryable save **keep** its optimistic face? I propose yes,
   per §3.6.1; today any failure reverts it (`editor.ts:176-181`).
3. Multi-edit denied targets: skip and name them, or pause the whole operation
   as today?
4. Multi-edit payload: a side localStorage key (proposed, the same capacity as
   today) or IndexedDB now? The 5 MB origin quota is shared with drafts.
5. In-flight legacy records at deploy: adopt them into the queue (~25 lines), or
   "drain before deploy"? Slice 6 lands before the slice 8 wipe.
6. One global card lane (proposed; equal to today's serialization) or exclusion
   per card set? Decide after slice 0.
7. Is lifting the same-card refusal in `editingStart` (`editor.ts:348`)
   acceptable?

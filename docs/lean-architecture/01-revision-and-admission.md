# 01 — Card revision, Rules, admission

Status: DETAIL for `docs/lean-mutation-architecture.md` §4.2 (slice 1). Baseline
`master` 8f56ea89. Nothing here is built in the repo. It was prototyped in a
scratch export of 8f56ea89, against the emulator under `demo-*` projects.

**VERIFIED** = read at the cited line, or run. **UNVERIFIED** = inferred; a test
must confirm it first.

## 0. Findings that change the plan

| # | Finding | Consequence |
|---|---|---|
| F1 | Rules judge each document's **final** batch state against its pre-batch `resource`. Two `increment(1)` on one card in one batch are +2 → **denied**. Increment + plain-`updated` update, or increment + inbound-only update, on one card → allowed. VERIFIED. | The mixed-tag shape writes one card three times (`data.ts:2038-2040`). Inject **once per card per underlying Firestore batch**. |
| F2 | `increment(1)` satisfies `== get('revision',0)+1` with no read: on legacy cards, on a `set` of a new doc, and inside `runTransaction` (stored = read+1). VERIFIED. | No preflight reads. "server.revision+1" = `increment(1)` replayed in the existing transaction. |
| F3 | `protectCardContent`'s transaction runs only for `NON_AUTOMATIC_MERGE_FIELDS` writes (`multi_batch.ts:136-140`); tags, references and similar fields use a plain batch. VERIFIED. | Harmless given F2. |
| F4 | Every card write goes through `MultiBatchBase` (`shared/multi_batch.ts`), including admin `tools/mount.ts:531-567`. The only raw card-content writer is `maintenance.ts:169`. VERIFIED by grep (`src/`, `tools/`, `functions/src`). | One injection point. |
| F5 | Widening `cardEditInboundReferences`' floor to per-card authors, needed by one existing test, exceeds the **1000-expression** limit on a per-card author's content write. VERIFIED. | Rejected. The inbound exception goes inside the content clause instead, which is within budget. VERIFIED. |
| F6 | Master blanks a saved card through the real executors (emulator, `bootstrapApp`, `shadow`). Create → `modifyCard(body)` → the echo shows the body → `receiveCards(create image)` → body `""`. With §2 + §3.3 the same test passes (rev 1 → echo rev 2 → late image refused). Disabling only the admission makes it fail again. VERIFIED. | Slice 1's behavioral test. |
| F7 | Batches are latency-compensated; transactions are not. A `hasPendingWrites` image carries the local increment. If the write is rejected, the SDK's revert has a **lower** revision. Code-read, not run. | Pending images must not raise the floor (§3.5). |

## 1. Rules (TEMPLATE)

After `bumpsUpdated()` (~line 160):

```
    //Card revision: the ordering token every client-side holder of a card
    //image admits by (docs/lean-architecture/01-revision-and-admission.md).
    //A content write advances it by exactly one; missing reads as 0 (legacy
    //cards need no backfill). Clients write increment(1); request.resource
    //sees the post-transform value. The inbound-reference mirror (the key set
    //cardEditInboundReferences admits) leaves it unchanged: that keeps the
    //path an author/editor of THIS card had before revisions. Widening
    //cardEditInboundReferences' floor instead exceeded the expression budget.
    function cardContentUpdate() {
      return bumpsUpdated() && (
        request.resource.data.get('revision', -1) == resource.data.get('revision', 0) + 1
        || request.resource.data.diff(resource.data).affectedKeys().hasOnly(['references_inbound', 'references_info_inbound', 'updated']));
    }
```

```
      allow create: if userMayCreateCard() && createIsAuthor() && bumpsUpdated()
        && request.resource.data.get('revision', -1) == 1;
      //Keep the common admin path first (expression budget).
      allow update: if userIsAdmin()
        ? (cardContentUpdate() || cardEditMinor(card) || cardEditInboundReferences())
        : (cardEditMinor(card) || cardEditInboundReferences() || (userMayEditCard(card) && cardContentUpdate()));
      //delete: unchanged.
```

`cardEditMinor` and `cardEditInboundReferences` need no textual change. Every
branch already ends in `affectedKeys().hasOnly([...])` without `revision`. A
write that touches `revision` therefore falls through to `cardContentUpdate`,
which also demands `updated == request.time`, and counter paths never set that.
Add a comment there saying `revision` is deliberately absent.

Budget: `cardContentUpdate` adds roughly 8 expressions, on the content branch
only. These all pass (VERIFIED):

- admin and non-admin batches of 1 content update + the mixed-tag triple + 40 inbound fan-outs;
- a per-card author on an unpublished card.

### 1.1 Emulator results (both jerry/edit and admin unless noted)

| Case | Result |
|---|---|
| content +1 (literal, or `increment`) | ok |
| +2 · same · −1 · omitted · `'6'` string | denied |
| legacy (no field): `1` / `increment` ok · `2` / omitted | ok / denied |
| create `1` / `increment` on new doc · `0` / absent | ok / denied |
| inbound-only, unchanged | ok |
| batch: two increments on one card · increment + plain / inbound update on same card | denied · ok |
| transaction read → `increment` → stored = read+1 | ok |
| `thread_count`, `thread_count`+`updated_message`, tweet counters, star add (with star doc) — unchanged / bumped | ok / denied |
| createCard-only user inbound — unchanged / bumped | ok / denied |
| per-card author (no global perms): inbound unchanged · content without rev · with `increment` | ok · denied · ok |
| delete + tombstone | ok |

On the current TEMPLATE, 19 of 59 cases fail (every revision denial plus
per-card-author); the counter cases are regression guards. Existing
`test/security`: 12 of 200 fail on the new rules. All are fixtures without
`revision` (3 create, 5 edit, 4 delete setups); patched, the suite is 200/200
on both the new and old rules. VERIFIED.

## 2. Client write side

### 2.1 `MultiBatchBase` injects

```ts
// MultiBatchConfig.cardWriteGuard gains:
		revisionIncrement: () => unknown;  // client increment(1); admin FieldValue.increment(1)

	protected _revisionBumped = new WeakMap<object, Set<string>>();
	//Applied when the op meets its REAL batch (atomic groups materialize at
	//commit; split fanout can put a card in two batches) → one increment per
	//card per Firestore commit (F1).
	protected _withRevision(batch: TBatch, ref: TRef, data: object): object {
		const guard = this._config.cardWriteGuard;
		if (!guard) return data;
		const path = guard.refPath(ref);
		if (!isTopLevelDocPath(path, guard.cardsCollection) || !cardUpdateAdvancesRevision(Object.keys(data))) return data;
		let bumped = this._revisionBumped.get(batch as object);
		if (!bumped) this._revisionBumped.set(batch as object, bumped = new Set());
		if (bumped.has(path)) return data;
		bumped.add(path);
		return {...data, revision: guard.revisionIncrement()};
	}
	update(ref, data) { … this._queueOperation(count, batch => this._config.batchUpdate(batch, ref, this._withRevision(batch, ref, data))); }
	set(ref, data, options?) {
		…
		if (isCard(ref)) {
			if (options) throw new Error('A merge set on a card is not supported; use update().');
			data = {...data, revision: 1};
		}
	}
```

The diff in `src/multi_batch.ts` is one line: `revisionIncrement: () => increment(1)`.
The `protectCardContent` replay records data *as passed to* `batchUpdate`
(`:122-126`), so the transaction replays the sentinel unchanged.

`tools/mount.ts:552` gains the same line. The type makes it mandatory: tsc
failed until it was added. VERIFIED.

### 2.2 `shared/card-write-guard.ts` mirror

```ts
export const INBOUND_REFERENCE_WRITE_FIELDS = ['references_inbound', 'references_info_inbound', 'updated'] as const;
//Keys may be dotted paths ('references_inbound.<id>').
export const cardUpdateAdvancesRevision = (keys : readonly string[]) : boolean =>
	!keys.every(key => (INBOUND_REFERENCE_WRITE_FIELDS as readonly string[]).includes(key.split('.')[0]));
//MultiBatch owns revision; a caller-supplied one would double-bump or forge.
export const callerRevisionViolation = (path : string, cardsCollection : string, keys : string[]) : string | null => …;
```

`revision` stays out of `COUNTER_FIELDS_EXEMPT_FROM_UPDATED`, so
`updateWithoutTimestampBump` already throws on it.

### 2.3 Every card writer

| Writer | How it gets its revision |
|---|---|
| Single save / durable multi-edit (`data.ts:1263-1383` → `modifyCardWithBatch:2028-2045`), suggestions `:1559`, reorder `:2178`, pure-tag op `:731`, slug `:2222` | injected (mixed-tag triple → one) |
| Create executor `:2922`, fork `:3357`, bulk import, tag start card `:2443`, maintenance setup `maintenance.ts:277-302` | base `set` forces 1 (also covers queue payloads persisted pre-cutover) |
| Inbound fan-out (edit, create, delete) | not bumped (inbound-only keys) |
| Delete `:3474` | none |
| Maintenance via MultiBatch (`maintenance.ts:205,263,317,343,455,479,524,602`) | injected (`:205` carries `updated_references_inbound` → content) |
| `maintenance.ts:169` raw `updateDoc` | **change:** a one-op MultiBatch |
| `tools/mount.ts` | injected via config (no Rules: this is its only net) |
| Thread/star/read counters (`comments.ts:129,273`, `user.ts:36,53`), twitter functions | none; Rules deny a bump |

Echo materialization never sees the sentinel (`test/card-echo` holds). The
**pre-commit** echo (`:1662`) keeps the held revision on purpose, so its
rollback (`:1699`, equal revision) is admitted. Committed echoes re-read the
server (`:1780`) and carry the exact revision (F6).

## 3. Admission

### 3.1 `shared/card-revision.ts` (zero imports)

```ts
export const cardRevision = (card : {revision?: unknown} | null | undefined) : number => {
	const v = card?.revision;
	return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : 0;   // missing/junk = 0
};
//Equal admitted: counters and the inbound mirror don't bump; the listener
//refresh of an echo carries the echo's revision.
export const cardImageMayAdvance = (held, incoming) : boolean =>
	!held || cardRevision(incoming) >= cardRevision(held);
//Same object back when nothing is refused.
export const admitCardImages = <C>(incoming : {[id : string] : C}, held : (id : string) => C | undefined)
	: {admitted : {[id : string] : C}, refusedIDs : string[]};
```

Plus `revision?: number` on `Card` (`shared/types.ts`).

- **Removals and tombstones** are not judged; a deletion always applies. A
  recreate under the same id starts at 1 against nothing held.
- **Late pre-deletion image.** It is also admitted, which is pre-existing (Q3).
- **Partial images.** Every strip is a denylist (`util.ts:622`,
  `corpus-worker.ts:620`), so `revision` survives the wire and the worker's
  token-merge echo (`:3358`). VERIFIED by reading.
- **Revision-less pre-cutover snapshot.** It only primes an empty corpus.

Prior art (parked `src/card-image-admission.ts`): borrow its placements; drop
its protocol-bound identity stamps; unlike it, admit equal revisions whose
bytes differ.

### 3.2 Worker — `updateLocalState` (`corpus-worker.ts:898`)

- Admit against `corpus.get(id)` first and **return** the admitted map.
- Each caller forwards that return value instead of its input:
  - `forwardBatch` at `:1075, 1503, 1825, 1850, 2130, 2294, 2369, 2472, 2571, 2656, 2912`;
  - echo `:3367`;
  - reconcile `:3348`.

  This answers both objections in the "KNOWN LATENT" comment (`:877-897`): the
  corpus and the forward agree, and the revision is server-issued, so there is
  no clock skew. Replace the comment.
- `clientClockCardIDs` edits (`:1062-1064, 2291, 2367, 2468-2470, 3346, 3366`) and
  `contaminatePendingWriteIDs` move **after** the call, over admitted ids only.
  Otherwise a refused server image clears a held echo's exemption and poisons
  `deriveSessionWatermark`.

### 3.3 Main — `receiveCards` (`data.ts:3817`) + reducer backstop

- `receiveCards` admits first, against the newest held copy: any
  `enqueuedCards` bucket, else `existingCards`. In `ownsInput` mode, delete the
  refused ids from `cards`.
  - Admission must come **before** the `awaitingServerTimestampIDs` check
    (`:3840`). Otherwise a refused image consumes the mark, the real
    timestamp-only refresh is deduped away, and the client-clock `updated` sticks.
  - It must also come before the enqueue gate.
- `UPDATE_CARDS` (`reducers/data.ts:210`) filters `action.cards` against
  `state.cards`. This catches `updateEnqueuedCards` (`:3950`): it flushes
  buckets per fetchType, and two buckets can hold different revisions of one id.

### 3.4 Editor — `EDITING_UPDATE_UNDERLYING_CARD` (`reducers/editor.ts:456`)

`if (!cardImageMayAdvance(state.underlyingCardSnapshot, action.updatedUnderlyingCard)) return state;`

This covers both dispatchers (`actions/editor.ts:202, 1038`). `generateCardDiff`
iterates an explicit schema (`card_diff.ts:393`), so `revision` is never in a
diff. VERIFIED.

### 3.5 Pending-write images (F7) — UNVERIFIED

- **Editor listener** (`editor.ts:366`) and post-open `getDoc` (`:381`): skip
  `metadata.hasPendingWrites`. The base moves only on confirmed images.
- **Off-mode listeners** (`database.ts:447,650-668`): pass pending ids to
  `receiveCards`, which admits them but stores `revision = cardRevision(held)`.
  The SDK's revert is then still admitted.
- **Worker:** never sees the main thread's pending writes. No change.

### 3.6 Not judged

Removals (deletion always applies) and `EDITING_START` (a fresh base) are not
judged. Compact-snapshot primes (`:1503, 2912`) pass through admission, but the
corpus is empty then. `cardsSnapshot` copies `state.cards`, which is already
admitted.

## 4. Echo: re-read or local?

The re-read costs one billed read per card (concurrency 20) plus a round trip.
It exists because transforms materialized onto the **planning** snapshot can
revert another tab's edit.

Given a known revision, a guarded card can be echoed immediately:

- build it as `applyCardFirebaseUpdate(txnSnapshot, writtenData)`;
- set `revision = txnSnapshot.revision + 1` explicitly (strip the sentinel);
- leave `updated` as an estimate, with the awaiting mark set.

| Option | Exact | Cost | Risk |
|---|---|---|---|
| Re-read (today) | yes | read + RTT/card | none new |
| From the transaction snapshot | yes (guarded cards) | 0 | `runTransaction` must return the last attempt's snapshots; pure-tag and fan-out cards still need the re-read |
| From the planning snapshot, stamped with the exact revision | no | 0 | The value-merge policy merges non-overlapping edits server-side; the echo drops them until the equal-revision refresh arrives (2–13 s revert) |

**Recommend:** slice 1 keeps the re-read. Admission doesn't need it to change,
and the re-read already carries the exact revision (F6). Add the
transaction-snapshot echo after slice 0 attributes echo latency. Never use the
planning snapshot.

## 5. Tests

1. **`test/security/test.js`**: a `describe('card revision')` block porting §1.1,
   in the existing `authedApp`/`seedFixtures` style, with `revision: 5` and
   legacy fixtures. It includes the two batch shapes and the 40-fan-out budget
   case (admin and editor). Also fix the 12 existing fixtures.
2. **`test/card-revision/test.js`** (new, `mocha -r esm`; add to `test` and
   `test:ci`, which `ci-coverage` enforces):
   - `cardRevision`, `cardImageMayAdvance` (older / equal / newer / none held),
     `admitCardImages` identity, `cardUpdateAdvancesRevision` on dotted keys;
   - `MultiBatchBase` with a fake config: one increment per card per batch for
     the triple, for split groups and for commit-time materialization; none on
     inbound-only; `set` → 1; merge-set throws; a caller `revision` throws;
   - fix `test/updated-invariant`'s fake config, the prototype's only unit
     failure (VERIFIED).
3. **`test/card-create-executor/revision-admission.test.js`** (emulator harness,
   real executors):
   - **(a)** the F6 repro;
   - **(b)** after the refusal, a timestamp-only refresh still applies;
   - **(c)** a direct `UPDATE_CARDS` with the older image is refused;
   - **(d)** the editor rebase refuses an older base;
   - **(e)** a pure-tag op echo is +1 and a stale pre-tag image is refused.
4. **`test/card-revision/worker-fence.test.js`**: a source pin (the #770
   pattern; the worker does not load in Node). It asserts that admission comes
   before `corpus.set(`, that no `forwardBatch(cards,` remains, and that the
   `clientClockCardIDs` edits come after admission.

**Vacuity** (AGENTS.md; stash by tag and apply by SHA, since the stack is
shared). Revert each hunk alone, rebuild, and expect red:

| Reverted | Must fail |
|---|---|
| `receiveCards` | 3(b) |
| reducer | 3(c) |
| injection | 3(a), 3(e) (both images rev 0, so they are admitted) and the MultiBatch units |
| TEMPLATE | the 19 cases above |
| editor | 3(d) |
| worker | the pin |

3(a) red/green was already shown in scratch. VERIFIED.

**Caveat:** `firestore.harness.rules` is permissive. The write-plan suites
passed on the prototype (42 + 106, VERIFIED), but that does not prove the
plans pass product rules (Q5).

## 6. Size

| Area | Product lines |
|---|---|
| TEMPLATE | +12 |
| `shared/card-revision.ts` | +40 |
| `shared/card-write-guard.ts` | +15 |
| `shared/multi_batch.ts` | +30 |
| config / types one-liners | +4 |
| `receiveCards`, reducer, editor | +30 |
| worker | +45 / −20 |
| `maintenance.ts:169` | ±6 |
| off-mode §3.5 | +15 |
| **Total** | **≈ +200 / −25** |

Tests ≈ +450. Within the parent doc's "~300 + rules".

## 7. Open questions

1. Inbound writes stay revision-neutral. That is also forced: createCard-only
   users may not bump (VERIFIED). Equal-revision images can still reorder
   `references_inbound` and the counters, as they can today. Accept?
2. Off mode (§3.5): fix in slice 1, or declare it out of scope?
3. A late pre-deletion image resurrects a deleted card (pre-existing). Out of scope?
4. The transaction-snapshot echo (§4): slice 1, or after slice 0?
5. A product-rules write-plan harness (auth emulator), or only §5.1's shape tests?
6. Forbid a merge `set` on cards? None exist today (grep).
7. Deploying the rules first (§4.8.1) denies every un-reloaded client's content
   saves until reload. The denial is visible and the queue holds the save — the
   same shape as the 2026-08-15 inbound tightening. Acceptable, or deploy
   hosting and rules together?

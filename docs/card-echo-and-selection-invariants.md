# Card echoes, selections, and worker deliveries

Four invariants that a single daily workflow — bulk import ~100 cards, then
Edit All Cards, add a TODO and two tags, Save — violated in three different
places at once. Each is cheap to hold and expensive to notice when broken,
because in every case the *server* ended up correct and only the tab was wrong.

Written 2026-08-17, after probing that workflow end to end against the shipping
configuration (`corpus-worker=on`, `corpus-sync=watermark`).

---

## 1. A card object never holds a write instruction

A Firestore update legally contains values *and* write instructions:
`deleteField()`, `serverTimestamp()`, `arrayUnion(...)`, `arrayRemove(...)`.
The instructions exist because a write must not clobber what it did not intend
to change — sending a whole `tags` array would delete a tag another device added
between our read and our write.

The same update object is also used to build the **local echo**: the card the
user sees the instant they hit Save, and the copy handed to the corpus worker.
That is latency compensation, and it needs the opposite thing — a real value.

> **Rule.** A card object built through a sentinel-aware `SentinelConfig` never
> contains a `FieldValue`: `setFirebaseValueOnObj` resolves every sentinel it
> can and *refuses to write* any it cannot.

Two layers, and it is worth being precise about which one is load-bearing:

- **The call site is what the shipping product relies on.** `modifyCardWithBatch`
  (`src/actions/data.ts`) keeps `cardUpdateObject.tags` as the materialized array
  `applyCardDiff` produced, and substitutes the transform into a copy at write
  time. After this, nothing in the product hands a transform to
  `applyCardFirebaseUpdate` — instrumenting the real thunk shows the transform
  branch below is consulted and never hits.

  Be precise about what the tests prove here, because it is easy to overstate:
  they fail when this call site is reverted to the ORIGINAL behaviour (a raw
  `arrayUnion` in `cardUpdateObject.tags`). They do NOT fail if it is reverted to
  a *vended* sentinel, because the guard below then resolves it and the outcome
  is correct anyway. Two correct designs; the suite pins the outcome, not which
  of them is in force.
- **The sentinel layer is a guard**, for call sites that do not exist yet and for
  the ones that bypass the vending wrappers. It lives in `shared/card_write.ts`
  (`setFirebaseValueOnObj`) and is reached through a `SentinelConfig`. The
  client's config is `clientSentinels` in `src/card_diff.ts`; the transforms it
  can resolve are those vended through `arrayUnionSentinel` /
  `arrayRemoveSentinel` in `src/firebase.ts`, which record their elements in a
  `WeakMap` the way `serverTimestampSentinel` already did. Anything else that is
  `instanceof FieldValue` is left out of the card, leaving the field stale until
  the server echo arrives. Stale is recoverable; a `FieldValue` in the field is
  not, because the next reader that iterates it throws.

The guard is not universal, and the boundary is the `SentinelConfig`: a caller
that omits one gets `NO_OP_SENTINELS`, which detects nothing and will happily
store a transform. `cardFromDiff` and the admin-SDK path in `tools/mount.ts` are
in that category today; neither is fed array transforms, which is why they are
safe rather than lucky.

**Why it matters, concretely.** A pure tag addition put an
`ArrayUnionFieldValueImpl` in `card.tags`. Nothing failed at the time. The
damage landed on the next code that iterated tags — in production, the multi-edit
dialog's own `selectSelectedCardsTagsUnion`, running inside `stateChanged`,
inside `store.dispatch`, inside the save loop that had just dispatched the echo.
The exception came out of `dispatch`, aborted the operation with a chunk still
to go, left ten cards visibly wrong, and left a pending durable record that
disables the Edit button until reload. The server had all 100 cards correct.

Note the branch structure, because it is why this survived review and testing:
a diff carrying **both** adds and removes always materialized correctly (that
branch built the write separately and said so in a comment). Only the **pure**
add or remove case overwrote the shared object. Any test whose diff mixes both —
including the perf gate's — cannot see the bug.

Pinned at three levels, deliberately, because each is blind to something:

- `test/card-echo` — the shared rule, with a stand-in `SentinelConfig`. It pins
  the contract, not the wiring: its fake resolves transforms by *shape*, where
  the real one resolves by WeakMap *identity*.
- `test/durable-multi-edit-loop` — the real client config, real thunk, real SDK,
  real emulator. Two cases catch the original bug; two are labelled regression
  guards that pass against the broken code and exist to stop the fix being
  "simplified"; two call `applyCardFirebaseUpdate` directly with real vended and
  real raw transforms, which is the only coverage the guard branch has.
- the perf gate's `--test-multiedit` arm — the whole stack including the dialog.
  Its **pure add and pure remove phases** are the ones that matter; the mixed
  round trip cannot see the defect.

---

## 2. A selection may name cards this tab does not hold

Selections are sets of card IDs. An ID can name a card that is not in the
corpus: it is still arriving (bulk import selects its cards as soon as they are
written), or it was deleted on another device.

> **Rule.** `selectSelectedCards` never returns holes, and the number of cards it
> dropped is published as `selectSelectedCardsMissingCount`.

Dropping alone would be wrong on its own — a multi-edit that silently covers 53
of 100 selected cards is worse than one that refuses — so the multi-edit dialog
renders the count and disables Save while it is non-zero. Deletions cannot wedge
that gate: the collection reducer already removes deleted IDs from
`selectedCards` on `REMOVE_CARDS`.

Before this, the selector mapped IDs straight through the corpus and produced an
array with `undefined` holes, which every consumer dereferences. Opening Edit
All Cards during the gap threw on open, threw again on every subsequent dispatch
(so the tags and TODO the user typed never appeared in the readout), and Save
reported *"0 of 0 cards were processed safely"* having written nothing.

Pinned by `test/selected-cards`.

---

## 3. Bulk import hands back only what this tab actually has

> **Rule.** `bulkCreateWorkingNotes` waits for every card it created to arrive
> before it selects anything, and selects only the ones that did.

It used to await `waitForCardToExist(ids[0])`, justified by "they'll all come
back in one batch anyway". They do not: the cards are committed with bounded
concurrency and return through the worker's delta listener, so card 1 is
typically already back before card 100 has been written — and that await then
returns instantly. In one emulator measurement of a 100-card import, ~50 of the
100 selected cards were absent from Redux at hand-back and arrived ~1.8s later.
(Indicative of the shape. The committed test asserts the invariant, not the
number.)

The wait is `Promise.allSettled`, not `all` — a card that never arrives must not
discard the ones that did — and it is bounded by
`BULK_IMPORT_ARRIVAL_TIMEOUT_MS` (15s), which is much shorter than the 60s a
single `waitForCardToExist` allows. That is deliberate and it is a **UX** bound,
not a sync bound: the import dialog is scrimmed, inert and cancel-less for the
whole wait, so an unbounded version traded a two-second race for a measured
60.5s freeze whenever one card was slow. A card that lands after the deadline is
not lost — it is in the corpus, just not in this selection — and the user is
told which ones those are.

Pinned by two cases in `test/card-create-executor`: one captures the selection
at the instant the import declares success (after the fact, the stragglers have
arrived and the bug is invisible), the other withholds a card forever and fails
if the dialog is held past the bound.

---

## 4. A worker delivery is one-shot, so ingestion must not be abortable

`store.dispatch` runs every connected component's `stateChanged` synchronously.
Any of them — or any selector they call — can therefore throw back into whoever
dispatched. For a click handler that is survivable. For the corpus bridge it is
not: the worker's delta listener sends each change exactly once, so anything
lost to a rendering bug is lost until the tab reloads.

> **Rule.** In `handleCardBatch`, the cards go into the store *first*. Reducers
> run before subscribers, so a throw after that point leaves the cards applied.
> Derived state that later messages republish (corpus size/detail) goes last.
> Each irreplaceable step is wrapped in `isolateDelivery`, and `handleMessage`
> has a catch-all backstop. All of them report with `console.error`.

Be precise about what that buys. Redux abandons the *rest* of an action's
subscriber list when one subscriber throws, and catching at the dispatch call
site cannot bring those back — components registered after the thrower still
miss that notification. So this protects **data**, not renders. That is the
right trade only because the data cannot be re-requested; a render can be.

`publishCorpusDetail()` used to run at the top of `handleCardBatch`, before the
batch was even decoded. With the multi-edit dialog throwing on every dispatch,
that one line converted a transient two-second race into permanent loss: in the
run that found it, the worker held 500 cards while Redux stayed at 453 for the
30 seconds observed, with the missing cards' `cardMeta` present — proving the
channel was alive and only the `cards` handling was dying.

**The ORDERING is pinned structurally** by `test/corpus-bridge-ordering`, which
reads the source the way `test/ownership-lease` already pins
`purgeAndDeactivate`. That catches the regression that actually happened —
someone moving `publishCorpusDetail` back above the card apply, or unwrapping a
step.

**The BEHAVIOUR has no automated test.** Reproducing it needs a real worker plus
a component that throws, which no committed layer has together; the evidence for
it is a one-off probe that is not in the repo. Note also that the ordering and
`isolateDelivery` are partly redundant for the data-loss mode described here:
with the isolation in place, a throwing `publishCorpusDetail` no longer prevents
the cards from landing. Reverting BOTH is what loses data.

---

## Reproducing the original workflow

`test/perf-harness/run.js` is the vehicle: production Rollup build, Firestore
emulator, admin auth, worker on, watermark sync. The probe that found all of
this drove `bulkCreateWorkingNotes` through the bulk-import dialog's own actions
and then `openMultiEditDialog` → `addTag` ×2 → `addTODOEnablement` →
`commitMultiEditDialog`, with no settle delay, and measured how many selected
cards were absent from Redux at each step. **It is not committed** — rebuild it
from this description if you need it. The committed coverage is the suites named
above plus the perf gate.

## What each layer can and cannot see

| Layer | Sees | Blind to |
|---|---|---|
| `test/security` | rules | write plans, local state |
| `test/card-echo` | the materialization rule | whether the app wires it up |
| `test/durable-multi-edit-loop` | real thunk + SDK + emulator, local state | anything needing a worker or a component |
| `test/card-create-executor` | write plans, import hand-back | rendering |
| perf gate (`--test-multiedit`) | the whole stack incl. the dialog | only what it is asked to assert |

`--test-multiedit` is opt-in, so `perf:local` passes it explicitly and
`test/perf-harness/multiedit-coverage.test.js` asserts that it still does —
a gate that stops running is indistinguishable from a gate that passes.

The gate is the only layer that sees components at all, which is why the
multi-edit arm now **selects the cards and opens the dialog** rather than calling
the thunk directly. Anything that runs only when the dialog is open — including
the selectors that threw here — is invisible to every other layer.

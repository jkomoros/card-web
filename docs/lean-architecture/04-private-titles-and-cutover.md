# 04 — Private working-notes titles (slice 5) and cutover (slice 8)

Status: DETAIL for `docs/lean-mutation-architecture.md` §4.7, §4.8 and slices 5 and 8.
Baseline `master` 8f56ea89. Read-only investigation; nothing is built.

Measurements are Node proxies against master's `lib/`/`shared/dist/` (M1 Ultra, load ~18;
scratch `detail-titles/{bench,fp,tok}.mjs`).

**VERIFIED** = read at the cited line, or executed.
**UNVERIFIED** = inferred; a test must confirm it before anyone relies on it.

## 0. Findings that change the plan

| # | Finding | Status |
|---|---|---|
| T1 | Making `title` non-derived changes `nlpSourceFingerprintForCard` for **every** working-notes card, even when the title is empty. `shared/nlp.ts:256-266` skips only derived fields. Executed: empty title `f6ga59` → `11xv8yx`. Any stored fingerprint then mismatches, which forces the slow processing path (`card-processing.ts:175`) and makes recall always scan the card (`corpus-worker.ts:352`). `nlp_tokens.title` stays `[]` before and after (executed). **The script must rewrite `nlp_source_fingerprint`.** | VERIFIED |
| T2 | The display date cannot come from `updated`. The script must bump `updated` (updated-invariant), and inbound-link writes bump it too (rules `:197`). Every legacy note would show the cutover date. **Use `updated_substantive ?? created`.** That is the drawer's "Last Activity" value (`filters.ts:1848-1856`). | VERIFIED |
| T3 | The drawer window is **250 rows** (`card-thumbnail-list.ts:84`). One cold title costs a mean of ~1.3–1.5 ms, p95 ~4 ms, at 47k. A cold working-notes tab is therefore **~310–370 ms**. **The work needs a budget** (§2.3). | VERIFIED (proxy) |
| T4 | Generated titles contain only the card's own words (`prettyItems(true, …)`, `nlp.ts:1355-1364,1423-1426`). The viewer's corpus decides ranking. Another card's terms enter only via backport text (`util.ts:287-310`). | VERIFIED |
| T5 | The content path in master's rules has no field allowlist (`firestore.TEMPLATE.rules:333,338`). **Old rules accept a client that writes `revision`.** Rules-first would deny every old-client save. | VERIFIED |
| T6 | Generator construction with injected IDF: **0.2 µs**; finisher per save ~1.3 ms mean. Worker-**off** rebuilds IDF over the corpus per save (`nlp.ts:1629-1635`): **17 s** at 47k synthetic. Slice 5 saves ~1–5 ms/save in worker mode, not a journey win. | VERIFIED (proxy) |
| T7 | The branch kernel (`working_notes_title_algorithm.ts`, 480 lines) **is not standalone**: it imports four modules absent from master (`bounded_wire`, `authored_source_html`, `authored_html`, `important_ngram_matcher`) plus `parse5`, and re-implements master's fingerprint for a wire format. **Don't port it**; make master's extractor pure. | VERIFIED |
| T8 | Working-notes titles are not searchable today (derived fields are skipped at `nlp.ts:429` and `shared/nlp.ts:284`). Embeddings already exclude them (`embeddings.ts:158-160`). Clearing them loses no recall. | VERIFIED |

## 1. Finisher removal, authorable title

```ts
// src/card_finishers.ts: delete workingNotesExtractor, NUM_TERMS_OF_FINGERPRINT and
// the imports only it used. Its body moves to §2.1.
export const CARD_TYPE_EDITING_FINISHERS = {
	'concept': conceptValidator,
	'quote': (card : Card) => { card.title = clipTitle(innerTextForHTML(card.body)); },
};
// shared/card_fields.ts:408-426, title config
legalCardTypes: {content, 'section-head', concept, work, person, 'working-notes': true},
derivedForCardTypes: {'quote': true},
optionalForCardTypes: {'working-notes': true},   // NEW; also add to shared/types.ts:688
```

**Where `optionalForCardTypes` is read.** Three places assume that a legal title is required:

- `card-renderer.ts:761`: don't move focus to an empty optional title. Otherwise new notes open with the cursor in the title instead of the body.
- `find-dialog.ts:459`: `needTitle = title && !optional`. Without this, find would gain a new `prompt()`, which HOUSE-STYLE §6 forbids.
- `data.ts:3057` is unaffected, because the type is not `publishedByDefault`.

**Editor.** `card-editor.ts:603` and the renderer's contenteditable `h1` (`card-renderer.ts:439`) now show the title for working-notes.

- Placeholder: `Optional title` (sentence case, no period, HOUSE-STYLE §2.1). Render it via `:empty::before{content:attr(data-placeholder)}` with token colors.
- **The editor shows the raw title and must never prefill the display title.** A prefill would turn private output into an authored title on the next save.
- In view mode an empty title renders nothing, as on master (Q2).

**Bulk import.** Delete `data.ts:2545-2546` (the lookup and the throw) and `:2625` (`cardFinisher(obj, state)`). `defaultCardObject` already sets `title: ''` (`:2494`).

**No change needed:**

- `createCard` (`:3099`)
- `generateFinalCardDiff` (`card_diff.ts:496`)
- `rerun-card-finishers` (`maintenance.ts:533`), which simply stops touching working-notes.

**Stale comments.** Fix `data.ts:1851-1853` and `:1868-1871`.

**Per-save cost after removal:** `fontSizeBoosts` + `generateCardDiff` remain; delta <5 ms (T6). "Fingerprint cost gone" is proven by §5.1, not by the journey.

## 2. Display projection

### 2.1 Kernel and memo

```ts
// src/working-notes-display-title.ts (new)
export type DisplayTitleInputs = Readonly<{idfMap : IDFMap; concepts : StringCardMap; synonyms : SynonymMap}>;
// selectDisplayTitleInputs = createSelector(selectWorkerIDFMap, selectConcepts, selectSynonymMap, ...)
// beside selectors.ts:1056. Its identity changes only on an IDF epoch (>10% drift,
// corpus-worker.ts:942-945), the first epoch, or a concept/synonym change.
// NOT on every save; keying on selectFingerprintGenerator (built over selectCards) would be.

const dateOf = (c : Card) => timestampDate(c.updated_substantive) ?? timestampDate(c.created) ?? new Date(); // sentinel → undefined

export const generatedWorkingNotesTitle = (card : Card, rawCards : Cards, i : DisplayTitleInputs) : string => {
	const processed = cardWithNormalizedTextProperties(card, backportFallbackTextMapForCard(card, rawCards) || {}, i.concepts, i.synonyms);
	const pretty = new FingerprintGenerator(undefined, undefined, undefined, i.idfMap, i.concepts, i.synonyms)
		.fingerprintForCardObj(processed, ['body']).dedupedPrettyItemsFromCard();
	return dateOf(card).toLocaleDateString('en-US', {month:'numeric', day:'numeric', year:'2-digit'})
		+ ' ' + pretty.split(' ').slice(0, 8).join(' ');
};

// Keyed on the Card OBJECT: incremental reducers keep the identity of unchanged cards,
// and every new image (any new revision) is a new object. This is strictly finer than
// (cardID, revision, idfVersion) and does not wait for slice 1. A hit costs 6.5 ns.
const memo = new WeakMap<Card, {inputs : DisplayTitleInputs; title : string}>();
export const displayTitle = (card : Card, rawCards : Cards, inputs : DisplayTitleInputs) : string => {
	if (card.title) return card.title;
	if (card.card_type !== 'working-notes') return '';
	const hit = memo.get(card);
	if (hit?.inputs === inputs) return hit.title;
	const title = generatedWorkingNotesTitle(card, rawCards, inputs);
	memo.set(card, {inputs, title});
	return title;
};
```

**Why `rawCards` is not in the memo key.** It feeds only backport, and backport only targets concept, work and person cards. Every backporting reference type has a `toCardTypeAllowList` (`card_fields.ts:254-383`). A concept rename changes the identity of `selectConcepts`, so it invalidates the memo anyway.

### 2.2 Call sites (rendered things only)

| Surface | Change |
|---|---|
| Drawer `_titleForCard` (`card-thumbnail-list.ts:473`) over `finalSortedCards.slice(offset, offset+250)` (`:414`) | `displayTitleBudgeted`. Navigating Up/Down re-renders the same rows as memo hits, so it adds no new work (target 5). |
| Page title (`card-web-app.ts:854`), card-view's only title consumer | `displayTitle`, synchronous. |
| Chips: `selectTagInfosForCards` (`selectors.ts:1316-1320`) → `tag-chip._displayName` (`:398`) | The selector keeps the raw title and does **not** fall back to the slug for working-notes (HS-1.4). The chip computes the title for its one `previewCard`. |
| `card-link auto='title'` (`card-link.ts:186`) | If the meta's title is empty and the card is working-notes, call `displayTitle(selectRawCards(state)[id])` at render time. With no body, show the date only. |
| `card-info-panel`, full `card-renderer` | No title rendered today (grep). No change. |

### 2.3 Main thread with a budget, and when to move it to the worker

`displayTitleBudgeted` handles a cold window in three steps:

1. Within one render, compute misses synchronously for up to 8 ms.
2. Past the budget, return the date only (the HOUSE-STYLE §3.6 loading placeholder) and queue the card.
3. A ~40-line scheduler drains the queue in 8 ms `setTimeout` slices, then calls `requestUpdate()` on subscribed lists.

**Worker move:** slice 0 adds "working-notes tab cold, then force an IDF epoch". Move to a worker `displayTitles(ids)` only if browser per-card p95 > 3 ms or a 250-row fill > 1.5 s wall. Privacy is unchanged (worker corpus = viewer's corpus).

### 2.4 Privacy

**Inputs.** The only inputs are the card, the viewer's `rawCards`, and the viewer's IDF, concepts and synonyms. The worker corpus is "the VISIBLE corpus by construction" (`idf-index.ts:1-5`).

**Today's title writers** (none can reach the module): `card_finishers.ts:44` (deleted here), `:74` (quote), `data.ts:2439` (tag start card), `:3094` (`createCard` param), and editor diffs (raw value).

**Enforcement:** a source pin forbids importing the module from `src/actions/`, `card_diff.ts`, `multi_batch.ts`, `aux-write-queue.ts`, `src/worker/`, `functions/`; a frozen-card test proves no mutation.

## 3. Consumers of working-notes `title`

| Consumer | Decision |
|---|---|
| NLP and search tokens, `nlp_source_fingerprint` (`data.ts:1985-2004`) | Authored or empty. Authored titles become indexed (T8). |
| `title_alternates` | Not applicable: concept-only (`card_fields.ts:428-431`). |
| Auto-slug (`data.ts:3122`), editor "add slug" (`card-editor.ts:1519`) | Authored or empty. Never seed a shared slug from private output. |
| Backport (`card_methods.ts:146`) | Not applicable: never targets working-notes. |
| Thumbnails, page title, chips, card-link | Display title (§2.2). |
| `cardHasContent`, `CardMeta.title` (`worker-protocol.ts:73`), `card_diff.ts:261`, AI (`ai.ts:347` content-only; `cardPlainContent`) | Authored or empty. |
| Graph labels (`collection_description.ts:1680`) | Authored, else display (Q3). |
| `functions/embeddings.ts:160` | Becomes `card.title \|\| ''` for every type. Text is unchanged for every existing card once titles are cleared, so `updateCard` takes the `setPayload`-only branch (`:397-414`). No re-embed and no version bump. |
| `functions/` twitter (content only), screenshot (cache key), email (`getCardName` → `name`, `common.ts:153`) | No change. |

**Server side.** Nothing in `functions/` breaks when the title is empty (VERIFIED by grep).

## 4. Cutover (slice 8)

### 4.1 Decision 2: clear the titles, or keep them behind a marker

**Recommend A.**

**A: clear.** Clear only titles that match the extractor's own date prefix, `/^\d{1,2}\/\d{1,2}\/\d{2}( |$)/`. A title that does not match is reported as **ambiguous**. It keeps its title, and its full NLP fields are regenerated so that it is consistently "authored". The dry run should report zero of these (UNVERIFIED).

**B: marker** (`title_generated: true`). Every §3 consumer must check it, it enters `nlpSourceFingerprintForCard`, the editor must clear it, and the script is still needed (T1). A permanent compatibility layer (principle 6) that buys only the old title, which by T4 the display title nearly reproduces.

### 4.2 Script `tools/cutover-working-notes-titles.mjs`

```js
// Defaults to DEV and dry-run. Prod needs --prod --write --confirm-project=complexity-compendium.
// projectId comes from devProdConfig(), never from the gcloud active project.
// Imports ../shared/dist (run `npm run build:shared` first). REFUSES unless
// DERIVED_FIELDS_FOR_CARD_TYPE['working-notes'].title is falsy (proves slice-5 config).
for await (const page of paginate(db.collection('cards').where('card_type', '==', 'working-notes'), 400)) {
	for (const doc of page) {
		const card = {...doc.data(), id: doc.id};
		const generated = GENERATED.test(card.title || '');
		const next = generated ? {...card, title: ''} : card;
		const update = {};
		if (generated) update.title = '';
		else if (card.title) Object.assign(update, fullNLPFields(next)); // ambiguous; reuse migrate-nlp-tokens logic
		if (card.nlp_source_fingerprint !== undefined) {
			const fp = nlpSourceFingerprintForCard(next);
			if (fp !== card.nlp_source_fingerprint) update.nlp_source_fingerprint = fp;
		}
		if (!Object.keys(update).length) { counts.clean++; continue; }  // idempotent
		update.updated = FieldValue.serverTimestamp();                   // updated-invariant
		update.revision = FieldValue.increment(1);                       // == get('revision',0)+1
		if (write) batch.update(doc.ref, update, {lastUpdateTime: doc.updateTime}); // raced doc fails; re-run
	}
}
// Prints total / cleared / fingerprint-only / ambiguous(ids) / clean / precondition-failed.
```

Each write fires `updateCardEmbedding` once, as a cheap `setPayload`. The number of working-notes cards on prod is unknown, so the DEV rehearsal must count them and time the script.

### 4.3 Runbook

Conventions follow `prod-landing-runsheet.md`. All prod steps are **[OWNER] only**.

The Rules' content gate is `revision == get('revision',0)+1` (`01-revision-and-admission.md`, landed).

**Quiesce instead of ordering** (Q4): rules-first is unnecessary (T5) and denies saves from unrefreshed clients.

0. **[AGENT]** Gate:
   - `npm test` is green on the slice-8 commit;
   - the DEV rehearsal is signed off;
   - the DEV `deploy-stamp.json` equals HEAD.
1. **[OWNER] Close every app instance on every device.** An old client's finisher would rewrite titles, and an old client does not write `revision` — after the deploy its content writes are DENIED: its queued creates/forks/imports are discarded as permanent failures, and its single saves pause with their durable record. **Before closing, check each client's save pill is idle and no recovery banner is up**; a paused save left behind is recoverable by the new build (same record key), but only if site data is NOT cleared (step 5).
2. **[OWNER]** `npm run backup`. It calls `gcloudEnsureProd()` itself. Verify that the export completes.
3. **[OWNER]** Run the script FIRST, with the clients closed (build the branch locally first: `npm run build:shared`; the script refuses to run against a build that still derives the title):
   1. `--prod` dry run. Review the counts; `ambiguous` should be 0.
   2. `--prod --write --confirm-project=complexity-compendium`.
   3. Dry run again. Expect `unchanged == total` (`clean` excludes ambiguous cards, which stay reported on every run).

   Script before deploy, not after: `npm run deploy` ends by calling the
   newly deployed `reindexCardEmbeddings`, and the new function embeds the
   title for every card type. With the generated titles still stored, that
   reindex would re-embed all ~38k notes (every one differs), and the
   script clearing titles underneath its snapshot could leave title-bearing
   vectors for cards whose title is now empty until their next edit. With
   the titles already cleared, the reindex finds nothing to change. The
   script's own writes fire the OLD functions' triggers; their embedding
   text for a note excludes the title, so those are payload-only updates.
   This order is safe only because the clients are closed (step 1): an open
   old client would rewrite titles on its next save.
4. **[OWNER]** Run `npm test`, then `npm run deploy`. The deploy runs no tests, which is why the suite runs first. It ships rules, indexes, hosting and functions in one sequential CLI call; with no clients open, the order within it doesn't matter. Then check that `deploy-stamp.json` equals HEAD (a manual check; nothing compares it) and that `dirty` is false.
5. **[OWNER]** On each of the ~3 clients:
   1. **Do not clear site data**: localStorage holds stamped edit drafts and any paused durable record, and the new build replays them. If the worker's persisted snapshot must go (a restore, not this cutover), clear only IndexedDB. **After any backup RESTORE, clearing IndexedDB on every client is a required step, not an aside**: a client whose persisted snapshot holds a card at a higher `revision` than the restored server copy refuses every server image of that card indefinitely (the admission rule working as designed against a server that went backwards).
   2. Close all tabs and reopen (the service worker updates on reload).
   3. Sign in and wait for syncState `live`; resolve any recovery banner or paused save it shows.
6. **[OWNER]** Verify:
   - the Working notes tab shows dated titles;
   - a newly created note has `title == ''` in Firestore;
   - the console shows no `ignoring unusable stored nlp_tokens`.
7. **[OWNER]** Run the script once more (dry run; `--write` if it reports anything; dry run). The old build ran the working-notes finisher BEFORE persisting a create intent, so a creation it left queued is replayed by the new build with its generated title, which then reads as authored; this pass clears it (the title matches the generator's prefix). Verified in the final review by replaying a master-shaped intent under the real Rules.

If quiescing is impossible, run hosting → close-and-reopen everywhere → script → rules + functions, as separate `firebase deploy --only` calls, so the functions' deploy-end reindex sees cleared titles. That order is safe by T5.

**DEV rehearsal:**

1. **[OWNER]** Delete the parked branch's DEV functions (§4.4).
2. **[OWNER]** `npm run backup`, then `npm run reset-dev`. This wipes DEV Firestore and imports the latest backup, giving DEV a prod-shaped corpus (`cli.ts:387-393`). **Afterwards gcloud is left pointing at DEV.**
3. **[AGENT]** The script against DEV (dry run, write, dry run), THEN `npm run deploy:dev`. The deploy also replaces any rules the branch left on DEV; which rules DEV runs now is UNVERIFIED.
4. **[AGENT]** Run steps 3–7 against DEV in the same order (script, then `deploy:dev`, then verify, then the second pass). Automation (`tools/rehearsal/`):
   - `node tools/rehearsal/dev-probe.mjs --out <file>` — anonymous Playwright boot of the deployed build, cold then warm: time-to-live, counts, console errors, the deploy stamp, and the persisted snapshot records (the shared `:published` record must carry no `displayTitles`). Exit code 2 when a verdict fails. Run before and after the deploy.
   - `node tools/cutover-working-notes-titles.mjs` (DEV, dry run by default; `--write`) — the script itself reports the counts; the final dry run must say `unchanged == total`.
   - `tools/rehearsal/owner-probe.mjs` — in the OWNER's signed-in session run `DEBUG_PERF.enable()`, reload, then paste it into the console; it observes the store and the DOM (writes nothing) and `await REHEARSAL.report()` prints a JSON block to paste back: Save→new-editor cycle times, Working notes rows that still show a bare date, the privileged snapshot's title count, every snackbar and banner seen, and any paused record or queued intent.
   - `npm run reset-dev` restores the newest `deploy-*` backup (it used to take the alphabetically last object in the bucket, which was a stale manual export).
   Record:
   - the card counts;
   - the script's wall time and its function invocation count;
   - cold and warm boot times before and after.

### 4.4 Parked branch DEV functions (decision 5: delete now)

The branch's `functions/src/index.ts` adds no exports. The functions were deployed as three separate codebases (`tools/stage-isolated-mutation-functions.cjs:146-150`), and the branch's handoff confirms all three are live on DEV in us-central1 (`CONTINUATION-HANDOFF.md:846-848`):

- `mutationMetadataHost`: HTTPS
- `mutationRecoveryOwner`: HTTPS
- `mutationRecoveryDispatch`: scheduled **every minute**. If it is left in place, it runs against the rehearsal corpus.

**For the owner to run. I have not run these:**

```bash
npx firebase functions:list --project dev-complexity-compendium
npx firebase functions:delete mutationMetadataHost mutationRecoveryOwner mutationRecoveryDispatch \
  --region us-central1 --project dev-complexity-compendium
```

A master deploy never prunes other codebases. Whether `functions:delete` needs a `codebase:` qualifier is UNVERIFIED. Optional: delete service accounts `mutation-{admission,storage,dispatch}@`.

## 5. Tests

### 5.1 No write path yields a generated title

**Setup.** `bootstrapApp` against the 8093 emulator, in the style of `test/card-create-executor`.

**Actions.** Each of these must leave a Firestore doc whose title is `''` or the authored string:

- `createCard({cardType:'working-notes', body})`
- `bulkCreateWorkingNotes` with 3 bodies
- a `modifyCard` body edit
- an editor save with an authored title

**Static checks:**

- `CARD_TYPE_EDITING_FINISHERS['working-notes'] === undefined`
- the import-boundary source pin (§2.4)

**Vacuity check.** Restoring the finisher must make the emulator tests fail.

### 5.2 Display projection (unit, `lib/` + jsdom like `test/fingerprint`)

Authored wins; parity with the old extractor for the same date; date fallback; memo hit skips `fingerprintForCardObj` (spy); invalidates on new card object or inputs, not on new `rawCards`; frozen card accepted; budgeted variant returns the date placeholder then fills.

### 5.3 Privacy

**Fixture:**

- C: an **unpublished** concept card titled `Zorblax theory`.
- W: a **published** working-notes card with a `concept` reference to C that has empty text. W's body does not mention Zorblax.

**Assertions:**

1. Viewer A's display title for W contains `Zorblax`. This is the non-vacuity check, and it is exactly what master writes into the shared doc today.
2. Viewer B's inputs come from published cards only, and B's title does not contain `Zorblax`.
3. Computing B, then A, then B gives the same B result both times, so no module cache crosses viewers.

### 5.4 Script

Seed six cards (generated with/without stored fingerprint, ambiguous, empty, non-working-notes, stale fingerprint only). Two `--write` runs: the second writes nothing; `revision` +1 exactly once; `updated` bumped; refuses a pre-slice-5 `shared/dist`.

## 6. Line estimates

| Item | + | − |
|---|---|---|
| Finisher, bulk-import calls, comments | 5 | 35 |
| `card_fields.ts`, `types.ts` | 8 | 2 |
| Display-title module, selector, scheduler | 130 | 0 |
| Consumers (§2.2, renderer, find, embeddings) | 60 | 10 |
| **Product subtotal** | **~205** | **~47** |
| Cutover tool | 150 | 0 |
| Tests | 450 | 0 |

Fits the ~250 budget; removals are half the estimate (the bulk "title loop" is one call).

## 7. Open questions

- **Q1.** Date source: `updated_substantive ?? created` (recommended, T2) or `created`? Master's "date of last save" has no field that survives the `updated` bumps.
- **Q2.** Should the full card's h1 show the private title when the authored title is empty? Master shows nothing.
- **Q3.** Graph labels: display title (possibly hundreds of cards) or authored-or-id?
- **Q4.** Accept a quiesced deploy-everything in place of §4.8's rules → script → hosting order (T5)?
- **Q5.** A maintenance task through `modifyCardWithBatch` would get revision/`updated`/NLP/fingerprint right by construction (`data.ts:1985-2004`), but runs in a browser. Script specified as asked.
- **Q6.** `tools/migrate-nlp-tokens.mjs` defaults to **PROD** with no flags. Fix it in slice 8?
- **Q7.** Display titles can shift when the IDF epoch rolls (10% drift), whereas master's were frozen at save. Is that acceptable?

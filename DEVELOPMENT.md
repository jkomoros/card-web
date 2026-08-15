# Development

This readme has information on patterns for developing.

## Running Cloud Functions locally

Ensure you're using dev not prod:

```
firebase use <DEV_PROJECT_ID>
```

Make sure you have admin credentials (https://firebase.google.com/docs/functions/local-shell):

Generate a key and downlaod it to e.g. `~/.firebase-keys/KEY.json`

```
#the path has to be fully specified
export GOOGLE_APPLICATION_CREDENTIALS="/Users/<USERNAME>/.firebase-keys/KEY.json"
```

Download your server-side config:

```
firebase functions:config:get > .runtimeconfig.json
```

Run the shell:

```
firebase functions:shell
```

Within the shell, call the cloudfunction:

```
screenshot.get('CARD-ID')
```

Note that there screenshot.js's DISABLE_SCREENSHOT_CACHE can be set to true
during development. Also note that puppeteer can be launched with headless:false
and slowMo:100 to view what's going on.

## NLP Features: First-Time Deployment

The NLP pipeline stores pre-computed tokens on card documents in Firestore to
avoid expensive client-side NLP recomputation.

Fingerprint rarity (IDF) needs no deployment step at all: the corpus worker
computes an inverse-document-frequency map over its own corpus — which is the
set of cards the viewer can see, by construction — and republishes it per
epoch (`src/worker/idf-index.ts`; see docs/visible-corpus-idf-design.md).

### 1. Deploy normally

```
npm run deploy
```

### 2. Backfill existing cards

Existing cards won't have `nlp_tokens` until they're re-saved. Run the migration
script to backfill all cards at once:

```
# Authenticate (one-time):
gcloud auth application-default login

# Preview what would happen:
node tools/migrate-nlp-tokens.mjs --dry-run

# Test on a small batch first:
node tools/migrate-nlp-tokens.mjs --limit=50

# Run on production:
node tools/migrate-nlp-tokens.mjs

# Or on dev:
node tools/migrate-nlp-tokens.mjs --dev
```

The script is idempotent — it skips cards that already carry `nlp_tokens`, a
matching `nlp_source_fingerprint`, and the current `nlp_version`.

### 3. Verify

```
node tools/verify-nlp-quick.mjs
```

This checks a few random cards for the presence of `nlp_tokens` and related fields.

### What gets stored per card

- `nlp_tokens`: Map of field → `{normalized, uppercaseRanges?}[]`. Stemmed and
  stop-word-filtered forms are derived at load time (the stemmer is deterministic).
- `nlp_search_tokens`: Flat `string[]` of stemmed unigrams + bigrams for
  Firestore `array-contains` queries.
- `nlp_version`: Algorithm version number (increment to trigger re-migration).
- `nlp_source_fingerprint`: Hash of the RAW fields the tokens were derived from.
  Together with `nlp_version` it gates the stored-token fast path
  (`src/card-processing.ts`): a card whose fingerprint no longer matches its
  content is re-tokenized at load instead of being served stale tokens.

Note: an earlier `nlp_fingerprint` field was planned for change detection, no
consumer was ever built, and it was removed (`nlp_source_fingerprint` is the
later, load-bearing replacement — different field, different purpose). Old
cards may still have `nlp_fingerprint` in Firestore; it is harmlessly ignored.
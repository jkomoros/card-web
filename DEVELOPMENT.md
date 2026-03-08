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
avoid expensive client-side NLP recomputation. A scheduled Cloud Function
generates an IDF (inverse document frequency) map for fingerprinting.

### 1. Deploy normally

```
npm run deploy
```

This deploys everything including the `calculateIDF` Cloud Function.

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

The script is idempotent — it skips cards that already have `nlp_tokens`.

### 3. Bootstrap the IDF map

The `calculateIDF` Cloud Function runs weekly (Sunday 2 AM PST) and uploads
an IDF map to Cloud Storage at `idf-maps/latest.json`. For the first time,
trigger it manually:

```
# Via gcloud:
gcloud scheduler jobs run firebase-schedule-calculateIDF --location=us-central1

# Or trigger from the Firebase Console: Functions → calculateIDF → Test
```

### 4. Verify

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

Note: `nlp_fingerprint` was originally planned for change detection but no
consumer was ever built. It has been removed. Old cards may still have it in
Firestore; it is harmlessly ignored.
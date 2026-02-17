# NLP Token Migration Script

One-time migration script to backfill NLP tokens for existing cards.

## What It Does

The Enterprise migration branch added NLP token storage to cards (`nlp_tokens`, `nlp_fingerprint`, `nlp_version` fields). These tokens are generated automatically when cards are saved, but **existing cards in the database don't have these fields yet**.

This script:
- Fetches all cards from Firestore
- For each card without `nlp_tokens`:
  - Generates NLP tokens from title, body, and commentary
  - Creates a fingerprint from stemmed tokens
  - Writes the fields back to Firestore
- Skips cards that already have tokens (safe to re-run)
- Processes in batches of 250 for efficiency
- Provides progress updates and generates a summary report

## Prerequisites

**One-time authentication setup:**

```bash
gcloud auth application-default login
```

This authenticates using your Google Cloud credentials (same as `firebase login`). The credentials are stored in `~/.config/gcloud/` and work for all projects.

**Build the project** (to generate compiled config and shared modules):

```bash
npm run build:typescript
cd shared && npm run build
```

## Usage

### Test on Development Database First

**Dry run** (preview without writing):
```bash
node tools/migrate-nlp-tokens.mjs --dev --dry-run
```

**Test on first 100 cards**:
```bash
node tools/migrate-nlp-tokens.mjs --dev --limit=100
```

**Run full migration on dev**:
```bash
node tools/migrate-nlp-tokens.mjs --dev
```

### Run on Production

```bash
node tools/migrate-nlp-tokens.mjs
```

The script will:
1. Show you the project and database it will modify
2. Ask for confirmation before proceeding
3. Process all cards and show progress
4. Generate a report: `migration-nlp-tokens-report.json`

## Options

- `--dev` - Use development database
- `--dry-run` - Preview changes without writing to Firestore
- `--limit=N` - Only process first N cards (for testing)
- `--help` - Show help message

## Safety Features

✅ **Idempotent** - Safe to re-run multiple times (skips cards that already have tokens)

✅ **Confirmation prompt** - Shows project/database before starting

✅ **Dry-run mode** - Test without making changes

✅ **Batch retry logic** - Automatically retries failed batches with exponential backoff

✅ **Error handling** - Continues on individual card errors, stops after 100 errors

✅ **Progress tracking** - Real-time progress updates in terminal

✅ **Summary report** - JSON report saved to `migration-nlp-tokens-report.json`

## Expected Results

For ~30,000 cards:
- Runtime: ~4-5 minutes
- Most cards will be updated
- Some cards will be skipped (already have tokens or no content)
- Report file will contain detailed statistics

## Verification

After running, verify in Firestore Console:

1. Open a few random cards
2. Check they have:
   - `nlp_tokens` (object with title/body/commentary arrays)
   - `nlp_fingerprint` (string with pipe-separated stemmed tokens)
   - `nlp_version` (number = 1)

Example card structure:
```json
{
  "title": "Example Card",
  "nlp_tokens": {
    "title": [
      {
        "normalized": "example card",
        "stemmed": "exampl card",
        "withoutStopWords": "exampl card"
      }
    ],
    "body": [...],
    "commentary": [...]
  },
  "nlp_fingerprint": "exampl card|body stemmed tokens|commentary stemmed tokens",
  "nlp_version": 1
}
```

## Troubleshooting

### "Authentication failed"

Run: `gcloud auth application-default login`

### "Cannot find module"

Run: `npm install` to ensure `firebase-admin` is installed

### "Cannot find config.GENERATED.SECRET.js"

Run: `npm run generate:config` to generate the config file

Then build TypeScript: `npm run build:typescript`

### "Cannot find shared/dist/nlp.js"

Build shared modules: `cd shared && npm run build`

## After Migration

Once the migration completes successfully:

1. ✅ Verify a few cards in Firestore Console
2. ✅ Monitor app performance (fast path selector should be faster)
3. ✅ Keep or delete the script (it's a one-time migration)
4. 📄 The report file (`migration-nlp-tokens-report.json`) contains detailed stats

The script has no ongoing purpose after running successfully.

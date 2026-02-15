# Firestore Enterprise Migration Guide

## ⚠️ RECOMMENDED: Migrate to Enterprise Edition

**The Standard (default) Firestore database is deprecated.** You should migrate to Enterprise Edition for:
- **Better performance**: 30-40MB memory usage vs 835MB on Standard
- **Advanced features**: Server-side regex search (regex_match), pipeline operations
- **Scalability**: Handles 30k+ cards efficiently
- **Lower costs**: Optional indexing reduces storage costs

This guide documents the implementation of Firestore Enterprise Edition support and migration tooling.

## Configuration Structure

### Config File Updates

**tools/types.ts**
- Added `use_legacy_firestore?: boolean` to ModeConfig interface
- When `true`, uses Standard "(default)" database (deprecated)
- When `false` or omitted, uses Enterprise with database name "firestore"
- Database names are auto-generated intelligently

**tools/config.ts**
- Exports `FIRESTORE_DATABASE_ID_DEV` and `FIRESTORE_DATABASE_ID_PROD` constants
- These are generated into `src/config.GENERATED.SECRET.ts` on `npm run generate:config`
- Auto-generates database name "firestore" for Enterprise (default behavior)
- Validates config and errors if old fields (`firestore_database_id`, `firestore_edition`) are present

#### 2. Firebase Initialization Updates

**src/firebase.ts**
- Imported `getFirestore` from firebase/firestore
- Imported database ID constants from config
- Updated `db` initialization to support named databases:
  - Uses `initializeFirestore` for default database "(default)" (maintains existing settings)
  - Uses `getFirestore` for named databases (Enterprise databases)

#### 3. README.md Updates

Added section explaining:
- Firestore Enterprise Edition benefits (regex_match, pipeline operations, performance)
- Importance of selecting Enterprise during initial database creation
- Warning that Standard cannot be upgraded to Enterprise

### Phase 2: Migration Tooling (Completed)

#### 1. Backup Task Enhancement

**gulpfile.mjs - GCLOUD_BACKUP_TASK**
- Now supports named databases via `--database=` parameter
- Automatically detects dev vs prod and uses correct database ID
- Adds database suffix to backup path for clarity (e.g., `-cards-enterprise`)
- Maintains backward compatibility with default database

#### 2. Migration Task

**gulpfile.mjs - migrate-to-enterprise task**

New task: `gulp migrate-to-enterprise`

Features:
1. **Database Verification**: Checks that Enterprise database exists before migration
2. **Automatic Export**: Exports Standard database to Cloud Storage
3. **Progress Monitoring**: Polls gcloud operations to wait for completion
4. **Automatic Import**: Imports data to Enterprise database
5. **Clear Instructions**: Provides next steps after migration completes

Helper Functions:
- `checkDatabaseExists(projectId, databaseId)` - Verifies database exists
- `waitForOperation(projectId, operationName)` - Polls for operation completion

Usage:
```bash
# Make sure you're on the right project (dev or prod)
gulp migrate-to-enterprise
```

The task will:
1. Verify Enterprise database exists (provide instructions if not)
2. Export Standard database to gs://[bucket]/migration-[timestamp]
3. Wait for export to complete (polls every 5 seconds)
4. Import to Enterprise database
5. Wait for import to complete
6. Display next steps

#### 3. Verification Script

**tools/verify-migration.mjs**

New script: `node tools/verify-migration.mjs [--dev]`

Features:
1. **Collection Count Verification**: Compares document counts across all collections
2. **Sample Document Verification**: Checks 5 random cards for field-level consistency
3. **Detailed Output**: Shows which collections/documents match or have issues
4. **Exit Codes**: Returns 0 on success, 1 on failure

Requirements:
- Service account key at `./service-account-key.json`
- Instructions provided if key is missing

Collections Verified:
- cards, sections, tags, authors, reading_lists
- permissions, updates, messages, stars, reads, tweets
- maintenance_tasks

Usage:
```bash
# Verify prod migration
node tools/verify-migration.mjs

# Verify dev migration
node tools/verify-migration.mjs --dev
```

## Why Migrate?

### Standard Database Issues
- High memory usage (835MB for 30k cards)
- Limited query capabilities (no regex_match)
- No pipeline operations
- Less efficient at scale

### Enterprise Benefits
- Low memory usage (30-40MB for same dataset)
- Server-side regex search on card content
- Complex filter pipelines
- Better performance with large datasets
- Optional indexing reduces storage costs

### Deprecation Timeline
- **Now**: Standard database deprecated, warnings added
- **6-12 months**: After all users migrate, Standard support will be removed from codebase

## How to Use

### For New Projects

1. During Firebase setup, select **Firestore Enterprise** edition with database name **"firestore"**
2. In `config.SECRET.json`, you don't need any firestore config fields! Everything auto-generates:
   ```json
   {
     "base": {
       "app_title": "My Cards",
       "firebase": { /* ... */ }
       // No firestore fields needed - defaults to Enterprise!
     }
   }
   ```
3. Run `npm run generate:config` and everything works automatically!

### For Existing Projects (Migration)

#### Step 1: Create Enterprise Database

1. Go to Firebase Console → Firestore Database
2. Click "Create database" (upper right)
3. Enter Database ID: **`firestore`** (use this exact name for auto-config)
4. Select **"Firestore Enterprise"** edition
5. Choose location: `us-central1` (should match your existing database)
6. Click "Create"

#### Step 2: Run Migration

Use the automated migration task:
```bash
gulp migrate-to-enterprise
```

This will:
1. Verify Enterprise database exists
2. Export Standard database to Cloud Storage
3. Import to Enterprise database
4. Provide next steps

#### Step 3: Update Configuration

If you're currently using Standard database, you have `use_legacy_firestore: true` in your config. After migration:

1. Edit `config.SECRET.json` and **remove** the `use_legacy_firestore` field:
   ```json
   {
     "base": {
       // Remove this line:
       // "use_legacy_firestore": true
     }
   }
   ```

     // Remove use_legacy_firestore from all sections
   }
   ```

3. Regenerate config:
   ```bash
   npm run generate:config
   ```

The config will now auto-use Enterprise database named "firestore"!

#### Step 3.5: Configure Cloud Functions

Cloud Functions read database configuration separately from the frontend:

```bash
# Automatically set function config (includes database ID)
gulp configure-api-keys
```

Or manually:
```bash
firebase functions:config:set firestore.database_id="firestore"
```

Verify configuration:
```bash
firebase functions:config:get
```

Expected output:
```json
{
  "firestore": {
    "database_id": "firestore"
  }
}
```

⚠️ **CRITICAL:** Functions config is per-project. If frontend uses Enterprise but functions config says `(default)`, you'll have silent data inconsistency!

#### Step 4: Verify Migration

```bash
node tools/verify-migration.mjs
```

Expected output:
```
✅ cards: 16,700 documents match
✅ sections: 45 documents match
✅ tags: 320 documents match
...
✅ VERIFICATION PASSED
```

#### Step 5: Deploy Security Rules

Deploy security rules to the Enterprise database:

```bash
firebase deploy --only firestore:rules --database=firestore
```

⚠️ **CRITICAL:** The `--database=firestore` flag is required! Without it, rules deploy to `(default)` Standard database, leaving Enterprise database with NO security rules (public read/write).

Verify rules deployed:
```bash
firebase firestore:rules --database=firestore
```

Security Rules are backward compatible between Standard and Enterprise.

#### Step 6: Build and Test Locally

```bash
# Build and test locally
npm run build
npm run start
# Visit http://localhost:8081 and test
```

#### Step 7: Deploy to Production

```bash
gulp release
```

This will:
- Backup the Enterprise database (new behavior!)
- Deploy the app with Enterprise database configuration
- Create a git tag

#### Step 8: Monitor & Verify

1. Check Firebase Console → Firestore → Usage for query metrics
2. Verify search works (regex_match queries)
3. Check memory usage (should be ~30-40MB instead of 835MB)
4. Monitor error logs for any Firestore errors

#### Step 9: Cleanup (After 1-2 Weeks)

Once Enterprise is stable:

1. Go to Firebase Console → Firestore Database
2. Select the Standard "(default)" database
3. Click "Delete database"
4. Confirm deletion

**Important**: Keep Standard database for at least 1-2 weeks as a rollback option.

## Rollback Plan

If issues occur after migration:

### Quick Rollback (Within 1-2 weeks)

If you need to rollback immediately:

1. Edit `config.SECRET.json`:
   ```json
   {
     "base": {
       "use_legacy_firestore": true
     }
   }
   ```

2. Regenerate config: `npm run generate:config`
3. Deploy: `gulp release`
4. Standard database is unchanged - data is safe

### Full Rollback with Data Restore

If Enterprise database has issues:

1. Delete Enterprise database (Firebase Console)
2. Restore Standard database from backup:
   ```bash
   # Find latest backup
   gsutil ls gs://[your-backup-bucket]/

   # Restore to Standard database
   gcloud beta firestore import gs://[backup-path] --database=(default)
   ```

## Files Modified

### Configuration & Types
- `config.SAMPLE.json` - Added database ID and edition fields
- `tools/types.ts` - Added ModeConfig fields
- `tools/config.ts` - Export database ID constants

### Application Code
- `src/firebase.ts` - Support named database initialization

### Build & Deployment
- `gulpfile.mjs` - Added migration task, updated backup task
- `README.md` - Added Enterprise setup documentation

### New Files
- `tools/verify-migration.mjs` - Migration verification script
- `ENTERPRISE_MIGRATION.md` - This documentation

## Technical Details

### Database ID Behavior

**Default Database: "(default)"**
- Uses `initializeFirestore()` with custom settings
- Maintains long polling to prevent OOM
- Maintains persistent local cache
- Backward compatible with all existing code

**Named Database: "cards-enterprise"**
- Uses `getFirestore(app, databaseId)`
- Enterprise Edition features available
- regex_match() for search queries
- Pipeline operations for complex filters

### Backup Format

**Standard Database Backup**:
```
gs://[bucket]/deploy-2024-01-15-10-30/
```

**Enterprise Database Backup**:
```
gs://[bucket]/deploy-2024-01-15-10-30-cards-enterprise/
```

The database suffix makes it clear which database was backed up.

### Migration Data Format

Export/import uses gcloud's native format, which is fully compatible between Standard and Enterprise:
- All document data preserved
- Collection hierarchy maintained
- Subcollections included
- Metadata preserved

**Not Transferred** (must recreate):
- Index definitions (Enterprise uses optional indexing)
- Security Rules (deploy separately with `firebase deploy --only firestore:rules`)

## Troubleshooting

### "Enterprise database not found"

**Solution**: Create Enterprise database first via Firebase Console before running migration.

### "Service account key not found"

**Solution**: Download service account key from Firebase Console → Project Settings → Service Accounts.

### Export/Import Timeout

**Symptom**: Operation takes longer than 10 minutes.

**Solution**:
- Check gcloud operations: `gcloud firestore operations list`
- Increase timeout in `waitForOperation()` function if needed
- Large databases (>100k docs) may take 15-30 minutes

### Verification Fails

**Symptom**: `verify-migration.mjs` shows count mismatches.

**Solution**:
1. Wait a few minutes for eventual consistency
2. Re-run verification
3. Check Firebase Console for operation status
4. If persistent, re-run import

### App Errors After Migration

**Symptom**: Firestore permission denied errors.

**Solution**:
1. Verify Security Rules deployed: `firebase deploy --only firestore:rules`
2. Check rules deployed to correct database
3. Test rules in Firebase Console

### Memory Still High After Migration

**Symptom**: Memory usage still ~800MB instead of 30-40MB.

**Possible Causes**:
1. Still using Standard database (check config)
2. Not using SIMPLE pagination yet (requires regex_match in filters)
3. Browser cache (hard refresh with Cmd+Shift+R)

## Next Steps

After successful migration:

1. **Enable regex_match Search**: Update filter-classification.ts to use Enterprise features
2. **Optimize Collections**: Convert more collections from COMPLEX to SIMPLE
3. **Performance Monitoring**: Track query times and memory usage
4. **Cost Monitoring**: Enterprise has different pricing (unit-based vs document-based)

## Support

For issues or questions:
- Check this guide first
- Review implementation in git history
- File an issue in project repo

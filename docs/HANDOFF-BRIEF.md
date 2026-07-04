# Handoff brief: card-web fast-corpus work

Repo: /Users/jkomoros/Code/card-web — branch `implement/fast-corpus` (33+ commits, all green). Continue the autonomous loop: implement, test, verify live, commit early and often.

## Read these FIRST
1. docs/fast-corpus-implementation-log.md — complete state, environment traps, measurements, next steps. THE source of truth.
2. docs/fast-corpus-design-doc.md — the overall Plan A (done) / Plan B (mostly done) architecture.

## Environment traps (also in the log)
- Node 20.20.0 required: `export PATH="$HOME/.nvm/versions/node/v20.20.0/bin:$PATH"`
- Git hooks are broken (hang + stash unstaged changes): ALWAYS `git -c core.hooksPath=/dev/null` and `commit --no-verify`.
- Tests import compiled lib/: run `npm run build:typescript` (and `build:shared` if shared/ changed) before mocha suites.
- Port 8080 busy (user's other project); dev server: `npx wds --node-resolve --port=8081` (run in background).
- localhost:8081 = dev Firebase project (safe); 127.0.0.1:8081 = PROD (do NOT load the corpus there — it hit read quota).
- User permission: may edit working-notes cards on dev only.

## State
- Plan A (UI-thread perf fixes) complete; Plan B corpus worker: ingestion, query engine, shadow-compare, 'on'-mode active-collection + find-dialog serving, cardMeta table — all committed + browser-validated at 40,225 cards (dev, admin account).
- Root cause of the user's reported slowness, found at 40k: ~10 reference-block collections re-running per navigation/commit/typing-pause. Fixed so far: keystroke debounce (dba98e20), typing freeze (fafe64da — info-panel blocks pinned to active card while editing), direct-references enumerate fast path (84087fe5), and worker-served reference blocks (099fd6bd) — the last is code-complete + suites-green but its LIVE measurement is still pending (an Anthropic-side Bash-classifier outage blocked the launch at session end).

## Immediate next steps
1. Commit any uncommitted docs/fast-corpus-implementation-log.md edit.
2. Ensure wds is up on 8081, then run in background:
   `cd /private/tmp/claude-501/-Users-jkomoros-Code-card-web/5580af71-bc1a-4828-a369-4fca04fef69c/scratchpad && node measure.mjs`
   (Playwright harness: pinned chromium-1223 executablePath, copied browser profile ./perf-profile whose Firebase session is still valid, sets corpus-worker=shadow via addInitScript, 600s readiness deadline because the worker cold-loads its memory-cache corpus ~2.5min. If the scratchpad is gone, recreate per the log's harness notes.)
3. Compare NAV/TYPING/COMMIT long tasks vs the log's POST-FAST-PATH MEASUREMENT section — expect similar/-block scoring to leave the UI thread. Update the log, commit.
4. Then the remaining B3 items listed in the log: user shadow sign-off → default 'on'; stop mirroring full cards into Redux ('on' mode memory win — windowed cards + cardMeta serve consumers; the consumer survey + flip order are in the log); off-path worker RPCs (missing-concepts word cloud, maintenance, suggestions); delete legacy paths.

## Rollout flags
localStorage `corpus-worker`: off (default) | spike | shadow (worker owns ingestion + divergence logging) | on (worker also serves active collection, find-dialog search, reference blocks). Console APIs: `CORPUS_WORKER.setMode(...)`, `DEBUG_PERF.enable()`/`dump()`.

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
- All three user-reported slowness targets now measured CLEAN at 40k in shadow mode: NAV zero long tasks across rapid presses (worker-served reference blocks, 099fd6bd); TYPING clean; COMMIT settles in ~2s (was 16s+/timeout).
- Commit-settle investigation found + fixed three real bugs (see the log's COMMIT-ECHO section): stuck pendingModificationCount after no-op/failed commits (8fb46bd1); worker corpus one backend blip away from silent permanent incompleteness — getDocsFromServer+retry, self-re-attaching listeners (c79541c2); no latency compensation in worker modes — commits now self-echo locally + feed the worker corpus via ECHO_LOCAL_CARD_MODIFICATIONS (d7ccf9d0, which also fixes latent un-awaited modifyCardWithBatch races in reorderCard/rerunCardFinishers).
- Known 'on'-mode quality item: the worker's 38,985-doc Listen stream drops every ~2min on the strained dev backend (re-attach recovers; options in the log: partitioned Listens, or the planned persistent-cache handoff).

## Immediate next steps
1. Remaining B3 items from the log: user shadow sign-off → default 'on'; stop mirroring full cards into Redux ('on' mode memory win — windowed cards + cardMeta serve consumers; the consumer survey + flip order are in the log); off-path worker RPCs (missing-concepts word cloud, maintenance, suggestions); delete legacy paths.
2. Probe harnesses live in the session scratchpads (measure.mjs in the 5580af71 scratchpad; probe-commit2/probe-echo3/probe-cleanup.mjs in the c4ce6470 one); pinned chromium-1223 executablePath, copied browser profile ./perf-profile (Firebase session valid), corpus-worker=shadow via addInitScript, 600s readiness deadline (worker memory-cache cold load; ~2.5min when dev backend is healthy). Accept dialogs via page.on('dialog') or commits abort.

## Rollout flags
localStorage `corpus-worker`: off (default) | spike | shadow (worker owns ingestion + divergence logging) | on (worker also serves active collection, find-dialog search, reference blocks). Console APIs: `CORPUS_WORKER.setMode(...)`, `DEBUG_PERF.enable()`/`dump()`.

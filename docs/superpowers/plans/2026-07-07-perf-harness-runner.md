# Perf-Harness Browser Runner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A committed, rerunnable Playwright harness that boots the real card-web app against the Firestore/Auth emulators with a synthetic worst-case corpus, drives the Appendix-A interactions at 40k cards, and emits a diffable baseline — turning the never-measured perf gates (and the ~2s commit-settle) into reproducible numbers.

**Architecture:** The foundation already exists (`test/perf-harness/`: `gen-corpus.js`, `load-emulator.js`, `firebase.perf.json`; `src/firebase.ts` has flag-gated emulator wiring; `src/perf.ts` has `DEBUG_PERF.data()`; `window.DEBUG_STORE` is already exposed at `src/store.ts:58`). This plan adds the **browser runner** (`run.js`): it seeds the emulator, starts the `wds` dev server, launches headless chromium with `localStorage` flags set pre-boot (`addInitScript`), reads readiness/metrics from the app's own served modules + `window.DEBUG_STORE`/`window.DEBUG_PERF`, drives nav/editor/commit/find, and writes a baseline JSON. Built in milestones: anonymous published-only boot (verifies the whole pipeline) → admin sign-in → full interaction script + attribution.

**Tech Stack:** Playwright (`^1.61.1`, installed) + its bundled chromium; `firebase-tools` emulators (firestore + auth); `@web/dev-server` (`wds`); Node 20.20.0.

**Revision note:** this plan was revised after an adversarial review. Key corrections baked in: page-context code imports ONLY the app's own served `/lib/src/*.js` modules (a runtime `import('firebase/auth')` bare specifier does NOT resolve under wds); the nav metric drives the REAL auto-mark-read echo (the 5000ms timer never fires during a fast run); commit/find wall-clock is labeled emulator-optimistic; readiness uses the REAL `selectDataIsFullyLoaded` selector; the anon-suppression localStorage key is the real `hasPreviousSignIn`.

## Global Constraints

- **Node 20.20.0** (`.nvmrc`); prefix every command: `bash -lc 'export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 20.20.0 >/dev/null; <cmd>'`. System Node 26 breaks the toolchain.
- **`localhost:8081` is DEV (safe); `127.0.0.1:8081` is PROD** (`src/firebase.ts:49-50`). The runner MUST use `http://localhost:8081`.
- **Emulator ports:** Firestore `8089`, Auth `9099` (hardcoded client-side at `src/firebase.ts:102`). Never port 8080 (the user's other project).
- **Emulator flag is default-off:** `src/firebase.ts:96-107` reads `localStorage['firebase-emulator']` (`host:firestorePort`, e.g. `localhost:8089`); absent = no-op. Set it pre-boot via Playwright `addInitScript`.
- **Corpus-worker mode:** the runner runs `corpus-worker` **off** — the worker has no `localStorage`; worker modes are out of scope (Task 5).
- **PAGE-CONTEXT IMPORTS: only the app's own served modules.** Any code passed to `page.evaluate` may `import('/lib/src/...js')` (absolute URL — wds serves it and rewrites its internal bare specifiers) but must NEVER `import('firebase/auth')`/`import('firebase/firestore')` or any other bare specifier at runtime — the browser has no import map and wds does not rewrite a bare specifier from injected code, so it throws "Failed to resolve module specifier". Anything the harness needs from firebase must be re-exported from `src/firebase.ts` (Task 3 Step 1).
- **Auto-mark-read is a 5000ms timer** (`scheduleAutoMarkRead`, `src/actions/user.ts:535-556`; `AUTO_MARK_READ_DELAY=5000`) that cancels the prior pending timer on every nav. Back-to-back nav therefore NEVER fires `UPDATE_READS` during a run — so the harness must drive the read echo explicitly (Task 4).
- **Serving prerequisites (run once before `wds`; they don't need the emulator):** `npm run generate:config` (writes `src/config.GENERATED.SECRET.ts` — required or `tsc` won't compile; `index.html` — references `lib/src/...` paths; `firestore.rules`), then `npm run build:shared` (writes `shared/dist/`), then `npx tsc` (writes `lib/`). Bundled as `npm run perf:build`.
- **Reporting policy** (`docs/superpowers/plans/2026-07-07-adversarial-verification-plan.md`): **assert deterministic counter invariants; report main-thread dispatch avg/max**; wall-clock is coarse (incl. Playwright IPC) and commit/find wall-clock is emulator-optimistic (near-zero local write-echo) — NOT budget-authoritative. The real acceptance run is `perf:dev` (dev project, real corpus, operator session), out of scope here.
- **Appendix-A budgets** (`docs/fast-corpus-design-doc.md`): arrow-nav (incl. auto-mark-read echo) ≤16ms, keystroke ≤16ms, editor-open ≤100ms, commit→interactive ≤200ms, remote-echo ≤50ms, find ≤100ms.

---

## File structure

- **Modify** `firebase.perf.json` — add the auth emulator (port 9099).
- **Modify** `src/firebase.ts` — re-export `GoogleAuthProvider`, `signInWithCredential` (for page-context sign-in through the served module).
- **Create** `test/perf-harness/page-agent.js` — functions executed IN THE PAGE (readiness via the real selector, admin sign-in, state reads). Imports only served `/lib/src/*.js`.
- **Create** `test/perf-harness/interactions.js` — the Appendix-A interaction drivers + metric extraction (authoritative from `DEBUG_PERF.actionStats`).
- **Create** `test/perf-harness/run.js` — the runner CLI + orchestration (seed emulator, spawn wds, launch Playwright, drive, capture, teardown).
- **Modify** `package.json` — add `perf:build` + `perf:local` scripts.
- **Modify** `.gitignore` — ignore `test/perf-harness/baselines/`.
- **Create** `test/perf-harness/baselines/.gitkeep`.

---

## Task 1: Auth emulator config + smoke the two-emulator stack

**Files:** Modify `firebase.perf.json`.

**Interfaces:** Produces a `firebase.perf.json` that starts firestore + auth; the loader still seeds under it.

- [ ] **Step 1: Add the auth emulator to the config**

Set `firebase.perf.json` to:
```json
{
  "firestore": { "rules": "firestore.rules", "indexes": "firestore.indexes.json" },
  "emulators": {
    "firestore": { "port": 8089 },
    "auth": { "port": 9099 },
    "ui": { "enabled": false }
  }
}
```

- [ ] **Step 2: Regenerate rules + smoke both emulators + the loader**

```bash
bash -lc 'export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 20.20.0 >/dev/null;
  npm run generate:config >/dev/null 2>&1;
  firebase emulators:exec --only firestore,auth --config firebase.perf.json --project demo-perf \
    "node test/perf-harness/load-emulator.js --count 2000 --project demo-perf"' 2>&1 | grep -iE "auth|firestore|count =|done|error" | tail -8
```
Expected: BOTH `firestore` (8089) and `auth` (9099) start, then `[load-emulator] cards collection count = 2000` and `[load-emulator] done.`

- [ ] **Step 3: Commit**
```bash
git add firebase.perf.json
git commit -m "perf-harness: add auth emulator (9099) to firebase.perf.json"
```

---

## Task 2: Runner + anonymous published-only boot (Milestone 1 — verifies the whole pipeline)

Proves emulator + `firebase.ts` wiring + `wds` + Playwright + `DEBUG_STORE` work together, WITHOUT auth. The app shows PUBLISHED cards to a signed-out reader (the `all` tier grants `viewApp`, `src/selectors.ts:528-539`; `connectLivePublishedCards` has no auth requirement, `src/actions/database.ts:384-398`).

**Files:** Create `test/perf-harness/page-agent.js`, `test/perf-harness/run.js`; Modify `package.json`, `.gitignore`; Create `test/perf-harness/baselines/.gitkeep`.

**Interfaces:**
- Consumes: `load-emulator.js`, `firebase.perf.json`, `src/firebase.ts` emulator flag, `window.DEBUG_STORE`, served `/lib/src/selectors.js`.
- Produces: `run.js` CLI (`node test/perf-harness/run.js --count N [--auth admin|anon] [--seed S] [--out file]`); `page-agent.js` exporting `readStateInPage()` and `waitForCorpus(page, opts)`.

- [ ] **Step 1: Write the page-agent (readiness via the REAL selector)**

Create `test/perf-harness/page-agent.js`. `readStateInPage` runs in the page and imports the app's own served `/lib/src/selectors.js` — using `selectDataIsFullyLoaded` (which correctly gates on `permissionsFinal` + `userDataLoaded`, `src/selectors.ts:1195-1215`) rather than a hand-reconstruction that could report ready before permissions resolve.

```javascript
/*eslint-env browser*/
/* global window */

//Runs IN THE PAGE (serialized into page.evaluate). Imports ONLY served
///lib/src modules (absolute URL — wds resolves; a bare `firebase/...` import
//would throw). Uses the REAL selectDataIsFullyLoaded, not a reconstruction.
export const readStateInPage = async () => {
	const store = window.DEBUG_STORE;
	if (!store) return {ready: false, reason: 'no DEBUG_STORE'};
	const selectors = await import('/lib/src/selectors.js');
	const s = store.getState();
	const data = s.data || {};
	return {
		ready: true,
		cardCount: Object.keys(data.cards || {}).length,
		dataFullyLoaded: !!selectors.selectDataIsFullyLoaded(s),
		user: s.user && s.user.user ? {uid: s.user.user.uid, isAnonymous: s.user.user.isAnonymous} : null,
	};
};

//Runs IN NODE; polls readStateInPage() until fully loaded (or minCards) or timeout.
export const waitForCorpus = async (page, {minCards = 1, timeoutMs = 180000, pollMs = 500} = {}) => {
	const start = Date.now();
	let last = null;
	while (Date.now() - start < timeoutMs) {
		last = await page.evaluate(readStateInPage);
		if (last.ready && last.dataFullyLoaded && last.cardCount >= minCards) return last;
		await page.waitForTimeout(pollMs);
	}
	throw new Error('waitForCorpus timed out after ' + timeoutMs + 'ms; last=' + JSON.stringify(last));
};
```

- [ ] **Step 2: Write the runner (robust wds teardown; correct localStorage keys)**

Create `test/perf-harness/run.js`. Assumes it runs INSIDE `firebase emulators:exec` and that `perf:build` already ran.

```javascript
/*eslint-env node*/
import {spawn} from 'child_process';
import {chromium} from 'playwright';
import {waitForCorpus} from './page-agent.js';

const args = process.argv.slice(2);
const getArg = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const count = parseInt(getArg('count', '40000'), 10);
const seed = parseInt(getArg('seed', '1'), 10);
const authMode = getArg('auth', 'anon'); //'anon' | 'admin'
const projectId = getArg('project', 'demo-perf');
const PORT = 8081;
const URL = `http://localhost:${PORT}`;

if (!process.env.FIRESTORE_EMULATOR_HOST) {
	console.error('run.js must run inside `firebase emulators:exec` (FIRESTORE_EMULATOR_HOST unset).');
	process.exit(1);
}

const sh = (cmd, cmdArgs) => new Promise((res, rej) => {
	const p = spawn(cmd, cmdArgs, {stdio: 'inherit'});
	p.on('exit', code => code === 0 ? res() : rej(new Error(cmd + ' exited ' + code)));
});

const waitForServer = async (url, timeoutMs = 60000) => {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		try { const r = await fetch(url); if (r.ok) return; } catch { /* not up yet */ }
		await new Promise(r => setTimeout(r, 500));
	}
	throw new Error('wds did not come up at ' + url);
};

const main = async () => {
	//1. Seed the emulator (inherits the emulator env from emulators:exec).
	await sh('node', ['test/perf-harness/load-emulator.js', '--count', String(count), '--seed', String(seed), '--project', projectId]);

	//2. Start wds. `detached` + kill(-pid) so we reap the WHOLE tree — `npx`
	//spawns a child node; killing only the npx wrapper orphans the real server
	//on 8081 and wedges the next run.
	const wdsErr = [];
	const wds = spawn('npx', ['wds', '--node-resolve', '--port', String(PORT)], {detached: true, stdio: ['ignore', 'ignore', 'pipe']});
	wds.stderr.on('data', d => wdsErr.push(d.toString()));
	let killed = false;
	const cleanup = () => { if (killed) return; killed = true; try { process.kill(-wds.pid, 'SIGTERM'); } catch { /* noop */ } };
	process.on('exit', cleanup);
	process.on('SIGINT', () => { cleanup(); process.exit(130); });
	process.on('SIGTERM', () => { cleanup(); process.exit(143); });

	try {
		await waitForServer(URL).catch(e => { throw new Error(e.message + '\nwds stderr:\n' + wdsErr.join('')); });

		const browser = await chromium.launch();
		const context = await browser.newContext({serviceWorkers: 'block'}); //stops service-worker.js registering/caching across runs
		await context.addInitScript(() => {
			try {
				window.localStorage.setItem('firebase-emulator', 'localhost:8089');
				window.localStorage.setItem('debug-perf', '1');
				//Suppress the auto-anonymous-signin race (src/actions/user.ts:213-217).
				//KEY is 'hasPreviousSignIn' (LOCAL_STORAGE_HAS_PREVIOUS_SIGN_IN_KEY, src/constants.ts:4).
				window.localStorage.setItem('hasPreviousSignIn', '1');
			} catch { /* noop */ }
		});

		const page = await context.newPage();
		page.on('dialog', d => d.accept().catch(() => {})); //editingCommit() confirm()/alert() (src/actions/editor.ts:352-389)
		const consoleErrors = [];
		page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });

		await page.goto(URL, {waitUntil: 'domcontentloaded'});

		const minCards = authMode === 'admin' ? Math.floor(count * 0.9) : Math.floor(count * 0.15);
		const state = await waitForCorpus(page, {minCards});
		console.log('[run] BOOT OK: cardCount=' + state.cardCount + ' dataFullyLoaded=' + state.dataFullyLoaded + ' user=' + JSON.stringify(state.user));
		if (consoleErrors.length) console.log('[run] console errors (' + consoleErrors.length + '): ' + consoleErrors.slice(0, 5).join(' | '));

		await browser.close();
	} finally {
		cleanup();
	}
};

main().then(() => process.exit(0)).catch(err => { console.error('[run] FAILED:', err); process.exit(1); });
```

- [ ] **Step 3: npm scripts + ignore run artifacts**

In `package.json` `scripts`, add after `test:perf-harness`:
```json
    "perf:build": "npm run generate:config && npm run build:shared && npx tsc",
    "perf:local": "npm run perf:build && firebase emulators:exec --only firestore,auth --config firebase.perf.json --project demo-perf \"node test/perf-harness/run.js --count 2000 --auth anon\"",
```
In `.gitignore` add `test/perf-harness/baselines/`; then:
```bash
mkdir -p test/perf-harness/baselines && touch test/perf-harness/baselines/.gitkeep
git add -f test/perf-harness/baselines/.gitkeep
```

- [ ] **Step 4: Run the pipeline (the moment of truth)**
```bash
bash -lc 'export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 20.20.0 >/dev/null; npm run perf:local 2>&1 | tail -25'
```
Expected: `[load-emulator] cards collection count = 2000`, then `[run] BOOT OK: cardCount=<~600 anon published subset> dataFullyLoaded=true user=null`. On `waitForCorpus` timeout the error prints the last state (cards arriving? DEBUG_STORE present?) and any wds stderr — debug from there.

- [ ] **Step 5: Commit**
```bash
git add test/perf-harness/run.js test/perf-harness/page-agent.js package.json .gitignore
git add -f test/perf-harness/baselines/.gitkeep
git commit -m "perf-harness: Playwright runner + anonymous published-only boot (pipeline verified)"
```

---

## Task 3: Re-export auth + headless admin sign-in via a fake emulator JWT (full 40k corpus)

Anonymous sees only published cards. To measure the full corpus (and to edit/commit), sign in as the admin whose uid matches the seeded `permissions/perf-admin` (`load-emulator.js` default `adminUid='perf-admin'`). The Auth emulator accepts an unsigned Google-style ID token via `signInWithCredential(auth, GoogleAuthProvider.credential(idToken))` (it does not verify signatures; maps to `accounts:signInWithIdp`, provisioning a user whose uid is the token `sub`). Smoke it in isolation first — it's the one step unproven against this SDK version.

**Files:** Modify `src/firebase.ts`, `test/perf-harness/page-agent.js`, `test/perf-harness/run.js`.

**Interfaces:**
- Produces: `src/firebase.ts` re-exports `GoogleAuthProvider`, `signInWithCredential`; `signInAsAdminInPage({uid, email})` (page-context); a `--auth admin` path ending with `state.user.uid === 'perf-admin'` and `cardCount ≈ count`.

- [ ] **Step 1: Re-export the auth symbols from the app's served module**

In `src/firebase.ts`, add (near the other `firebase/auth` usage) so the page can reach them through `/lib/src/firebase.js`:
```typescript
//Re-exported for the perf harness's page-context sign-in (test/perf-harness/),
//which must reach Auth through this served module — a runtime `import('firebase/auth')`
//from injected page code is a bare specifier wds will not resolve.
export { GoogleAuthProvider, signInWithCredential } from 'firebase/auth';
```
Verify it compiles: `bash -lc '... npx tsc'` → exit 0.

- [ ] **Step 2: Add the sign-in page function**

In `test/perf-harness/page-agent.js`, add. It builds an unsigned token (header uses `typ`, JWT convention) and drives the app's own `auth` via the served module, so `onAuthStateChanged` (`src/components/user-chip.ts:98-108`) runs the real `signInSuccess` path.

```javascript
//Runs IN THE PAGE. Signs in against the Auth emulator with a fake Google
//credential through the app's OWN served firebase module.
export const signInAsAdminInPage = async ({uid, email}) => {
	const b = (o) => btoa(JSON.stringify(o)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
	const header = {alg: 'none', kid: '', typ: 'JWT'};
	const payload = {iss: 'https://accounts.google.com', aud: 'demo-perf', sub: uid, user_id: uid, email, email_verified: true, name: 'Perf Admin', firebase: {sign_in_provider: 'google.com', identities: {'google.com': [uid], email: [email]}}};
	const idToken = `${b(header)}.${b(payload)}.`;
	const fb = await import('/lib/src/firebase.js');
	const res = await fb.signInWithCredential(fb.auth, fb.GoogleAuthProvider.credential(idToken));
	return {uid: res.user.uid, isAnonymous: res.user.isAnonymous};
};
```

- [ ] **Step 3: Smoke the sign-in in isolation, then wire it in**

In `run.js`, import `signInAsAdminInPage` and, after `page.goto` and BEFORE `waitForCorpus`, add:
```javascript
if (authMode === 'admin') {
	const signed = await page.evaluate(signInAsAdminInPage, {uid: 'perf-admin', email: 'perf-admin@example.com'});
	console.log('[run] signed in:', JSON.stringify(signed));
}
```
Temporarily set the `perf:local` script's invocation to `--auth admin --count 200` and run it. Expected: `[run] signed in: {"uid":"perf-admin","isAnonymous":false}`. If the emulator rejects the token, fall back to the REST path `POST http://localhost:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithIdp` with body `requestUri=http://localhost&returnSecureToken=true&postBody=id_token=<jwt>%26providerId=google.com` and adjust — this is the flagged unknown, resolved cheaply here.

- [ ] **Step 4: Confirm full-corpus visibility**

Run `npm run perf:local` (admin, `--count 2000`). Expected: `[run] BOOT OK: cardCount=~2000 dataFullyLoaded=true user={"uid":"perf-admin","isAnonymous":false}` — the admin sees the WHOLE corpus (the `minCards=count*0.9` gate passes only because unpublished are now visible).

- [ ] **Step 5: Commit**
```bash
git add src/firebase.ts test/perf-harness/run.js test/perf-harness/page-agent.js
git commit -m "perf-harness: re-export auth + headless admin sign-in via fake emulator JWT"
```

---

## Task 4: Appendix-A interaction script + baseline + commit-settle attribution

Drives the real interactions and captures the AUTHORITATIVE main-thread cost from the app's own `perfMiddleware` (`DEBUG_PERF.data().actionStats['dispatch:<TYPE>']` = `{count, totalMs, maxMs}`; avg = `totalMs/count`) — not Node-side wall-clock (which includes Playwright IPC). Critically, the nav loop fires the REAL auto-mark-read echo per press (the 5000ms timer never fires during a fast run), so `UPDATE_READS → makeFilterFromCards` — the design doc's prime suspect — is actually exercised.

**Files:** Create `test/perf-harness/interactions.js`; Modify `test/perf-harness/run.js`.

**Interfaces:**
- Consumes: `waitForCorpus` (page-agent), `page`, served `/lib/src/actions/{user,editor}.js`.
- Produces: `runInteractions(page, {keystrokes})` → `{dispatch: {...avg/max per type}, wall: {...coarse}, counters}`.

- [ ] **Step 1: The interaction drivers (real echo; auto-piercing selector; authoritative stats)**

Create `test/perf-harness/interactions.js`:

```javascript
/*eslint-env node*/

//Authoritative main-thread cost from perfMiddleware (src/perf.ts:52-63):
//actionStats['dispatch:<TYPE>'] = {count, totalMs, maxMs}. avg = totalMs/count.
const stat = (actionStats, type) => {
	const s = actionStats && actionStats['dispatch:' + type];
	if (!s || !s.count) return null;
	return {count: s.count, avgMs: +(s.totalMs / s.count).toFixed(2), maxMs: +s.maxMs.toFixed(2)};
};
const timed = async (fn) => { const t = Date.now(); await fn(); return Date.now() - t; };
const pctl = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return +s[Math.min(s.length - 1, Math.floor(p / 100 * s.length))].toFixed(2); };
const wall = (a) => ({n: a.length, p50: pctl(a, 50), p95: pctl(a, 95), max: a.length ? +Math.max(...a).toFixed(2) : null});

//Body contenteditable — a SINGLE auto-piercing selector (Playwright CSS descends
//open shadow roots; no explicit per-boundary >>> chain needed). Verify it
//resolves uniquely against the running app in Step 3; narrow only if ambiguous.
const bodyLoc = (page) => page.locator('section[data-field="body"][contenteditable="true"]');

//Fire the app's REAL auto-mark-read thunk for the active card (admin only),
//driving UPDATE_READS -> makeFilterFromCards synchronously instead of waiting
//out the 5000ms timer that back-to-back nav cancels.
const markActiveRead = (page) => page.evaluate(async () => {
	const u = await import('/lib/src/actions/user.js');
	window.DEBUG_STORE.dispatch(u.markActiveCardReadIfLoggedIn());
});

export const runInteractions = async (page, {keystrokes = 30} = {}) => {
	await page.evaluate(() => window.DEBUG_PERF && window.DEBUG_PERF.reset());

	//--- Arrow-nav x20: each ArrowDown (SHOW_CARD) FOLLOWED BY the real read
	//    echo (UPDATE_READS -> makeFilterFromCards). This is the budgeted path. ---
	const navWall = [];
	for (let i = 0; i < 20; i++) {
		navWall.push(await timed(async () => { await page.keyboard.press('ArrowDown'); await markActiveRead(page); }));
	}

	//--- Editor open: dispatch editingStart directly (robust vs a fragile
	//    shadow-piercing button locator), then wait for the contenteditable body. ---
	const editorWall = [await timed(async () => {
		await page.evaluate(async () => { const e = await import('/lib/src/actions/editor.js'); window.DEBUG_STORE.dispatch(e.editingStart()); });
		await bodyLoc(page).waitFor({state: 'visible', timeout: 10000});
	})];

	//--- 30 keystrokes into the focused body ---
	await bodyLoc(page).click();
	const keyWall = [];
	for (let i = 0; i < keystrokes; i++) keyWall.push(await timed(() => page.keyboard.type('x')));

	//--- Commit: dispatch editingCommit; wait pendingModificationCount==0
	//    (the true "interactive again" marker, reducers/data.ts:147-152).
	//    EMULATOR-OPTIMISTIC: the write->echo round-trip is ~0 locally, so this
	//    wall-clock is NOT budget-authoritative — see perf:dev. ---
	const commitWall = [await timed(async () => {
		await page.evaluate(async () => { const e = await import('/lib/src/actions/editor.js'); window.DEBUG_STORE.dispatch(e.editingCommit()); });
		await page.waitForFunction(() => { const s = window.DEBUG_STORE.getState(); return s.data && s.data.pendingModificationCount === 0; }, {timeout: 30000});
	})];

	//--- Find dialog (Cmd/Ctrl+F) + query (also emulator/compute local) ---
	const findWall = [await timed(async () => {
		await page.keyboard.press(process.platform === 'darwin' ? 'Meta+f' : 'Control+f');
		await page.keyboard.type('perf');
		await page.waitForTimeout(400); //past the 250ms debounce
	})];

	const perf = await page.evaluate(() => window.DEBUG_PERF ? window.DEBUG_PERF.data() : null);
	const A = perf ? perf.actionStats : {};
	return {
		//AUTHORITATIVE main-thread dispatch cost (avg/max). Compare budgets here.
		dispatch: {
			showCard: stat(A, 'SHOW_CARD'),        //nav
			updateReads: stat(A, 'UPDATE_READS'),  //auto-mark-read echo (makeFilterFromCards)
			editingStart: stat(A, 'EDITING_START'),//editor open
			modifyCard: stat(A, 'MODIFY_CARD'),    //commit (main-thread portion)
			updateCards: stat(A, 'UPDATE_CARDS'),  //echo apply
		},
		//COARSE wall-clock (incl. Playwright IPC; commit/find emulator-optimistic).
		wall: {nav: wall(navWall), editorOpen: wall(editorWall), keystroke: wall(keyWall), commit: wall(commitWall), find: wall(findWall)},
		counters: perf ? perf.counters : {},
	};
};
```
**Verify in Step 3:** the exact exported names — `markActiveCardReadIfLoggedIn` (`src/actions/user.ts`), `editingStart`/`editingCommit` (`src/actions/editor.ts`) — and that `bodyLoc` resolves uniquely. Adjust selectors/names against the running app; the discovery lists the element chain if manual `shadowRoot` walking is needed.

- [ ] **Step 2: Wire into run.js — write baseline + print authoritative numbers**

In `run.js`, import `{runInteractions}` and `fs`; after `const state = await waitForCorpus(...)` add:
```javascript
const results = await runInteractions(page, {keystrokes: 30});
const baseline = {
	count, seed, authMode, cardCount: state.cardCount, results,
	note: 'commit/find wall-clock is EMULATOR-OPTIMISTIC (near-zero local write-echo); budget-authoritative = results.dispatch.* (main-thread) and the real-corpus perf:dev run.',
};
const outPath = getArg('out', `test/perf-harness/baselines/${authMode}-${count}.json`);
fs.writeFileSync(outPath, JSON.stringify(baseline, null, 2));
console.log('[run] baseline -> ' + outPath);
const d = results.dispatch;
console.log('[run] main-thread avg/max ms: SHOW_CARD=' + JSON.stringify(d.showCard) + ' UPDATE_READS=' + JSON.stringify(d.updateReads) + ' EDITING_START=' + JSON.stringify(d.editingStart) + ' MODIFY_CARD=' + JSON.stringify(d.modifyCard) + ' UPDATE_CARDS=' + JSON.stringify(d.updateCards));
console.log('[run] makeFilterFromCards counters: ' + JSON.stringify(Object.fromEntries(Object.entries(results.counters).filter(([k]) => k.includes('makeFilterFromCards')))));
console.log('[run] NOTE: commit/find wall-clock is emulator-optimistic; commit→interactive budget belongs to perf:dev.');
```

- [ ] **Step 3: Run at 2k (validate names/selectors), then 40k (the first real numbers)**

Run `npm run perf:local` (admin, `--count 2000`). Expected: `[run] baseline -> .../admin-2000.json`, a `main-thread avg/max ms: SHOW_CARD={...} UPDATE_READS={...} ...` line with real numbers (UPDATE_READS present = the echo actually fired), and `makeFilterFromCards counters: {...}`. Fix any wrong export name / non-resolving selector here. Then edit the invocation to `--count 40000` and run once (multi-minute load): the first reproducible Appendix-A measurement — `dispatch.updateReads.maxMs` vs the ≤16ms nav budget and `dispatch.modifyCard`/`updateCards` for the commit's main-thread portion.

- [ ] **Step 4: Commit**
```bash
git add test/perf-harness/interactions.js test/perf-harness/run.js
git commit -m "perf-harness: Appendix-A interaction script (real auto-mark-read echo) + authoritative baseline"
```

---

## Task 5 (documented, not built here): worker-mode measurement

`corpus-worker=shadow`/`on` is the design doc's target end-state and where the ~2s commit-settle was originally observed (with the worker↔UI serialization leg — absent in `off` mode). Out of scope because the corpus worker (`src/worker/corpus-worker.ts`) has its own Firestore init and no `localStorage`, so the emulator config must be passed to it at spawn (postMessage/init param) — a separate app change. Follow-up: extend the emulator wiring to the worker, then re-run with `localStorage['corpus-worker']='shadow'`.

---

## Self-review notes

- **Coverage:** boot pipeline (T2), full-corpus admin visibility (T3), all Appendix-A interactions + baseline + authoritative dispatch stats (T4), auth-emulator config (T1). Worker mode deferred (T5).
- **Riskiest unknowns smoke-tested early:** fake-JWT emulator sign-in (T3 Step 3, in isolation, with a REST fallback) and shadow-DOM selectors + export names (T4 Step 3).
- **Adversarial-review fixes folded in:** page-context imports only served `/lib/src/*.js` (C1); `hasPreviousSignIn` key (C2); nav drives the REAL auto-mark-read echo (C3); minimal auto-piercing selector (I1); commit/find labeled emulator-optimistic, dispatch stats authoritative (I2/M1); real `selectDataIsFullyLoaded` (I3); `wds` process-tree reaping + stderr capture (M2); header `typ` not `type`.
- **Honesty:** measured meaningfully here = nav/UPDATE_READS/editor/keystroke/find + makeFilterFromCards counters (main-thread, corpus-shape-driven). Emulator-optimistic (defer to `perf:dev`) = commit→interactive and remote-echo wall-clock.
- **No live session/quota needed** for T1–T4 (emulator + synthetic corpus). The real-corpus G1 acceptance run is a thin `--auth admin` variant against the dev project (operator session), out of this plan.

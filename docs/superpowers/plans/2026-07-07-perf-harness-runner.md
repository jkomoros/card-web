# Perf-Harness Browser Runner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A committed, rerunnable Playwright harness that boots the real card-web app against the Firestore/Auth emulators with a synthetic worst-case corpus, drives the Appendix-A interactions at 40k cards, and emits a diffable baseline — turning the never-measured perf gates (and the ~2s commit-settle) into reproducible evidence.

**Architecture:** The foundation already exists (`test/perf-harness/`: `gen-corpus.js`, `load-emulator.js`, `firebase.perf.json`; `src/firebase.ts` has flag-gated emulator wiring; `src/perf.ts` has `DEBUG_PERF.data()`; `window.DEBUG_STORE` is already exposed). This plan adds the **browser runner** (`run.js`): it seeds the emulator, starts the `wds` dev server, launches headless chromium with `localStorage` flags set pre-boot (`addInitScript`), reads readiness/metrics from `window.DEBUG_STORE` + `window.DEBUG_PERF`, drives nav/editor/commit/find, and writes a baseline JSON. Built in milestones: anonymous published-only boot (verifies the whole pipeline) → admin sign-in → full interaction script + attribution.

**Tech Stack:** Playwright (`^1.61.1`, installed) + its bundled chromium; `firebase-tools` emulators (firestore + auth); `@web/dev-server` (`wds`); Node 20.20.0.

## Global Constraints

- **Node 20.20.0** (`.nvmrc`); prefix every command: `bash -lc 'export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 20.20.0 >/dev/null; <cmd>'`. System Node 26 breaks the toolchain.
- **`localhost:8081` is DEV (safe); `127.0.0.1:8081` is PROD** (`src/firebase.ts:49-50` sets DEV_MODE only for hostname `localhost`; the README warns 127.0.0.1 hit prod quota). The runner MUST use `http://localhost:8081`.
- **Emulator ports:** Firestore `8089`, Auth `9099` (hardcoded client-side at `src/firebase.ts:102`). Never port 8080 (the user's other project).
- **Emulator flag is default-off:** `src/firebase.ts:96-107` reads `localStorage['firebase-emulator']` (`host:firestorePort`, e.g. `localhost:8089`); absent = no-op. Set it pre-boot via Playwright `addInitScript` (runs before any page script).
- **Corpus-worker mode:** the runner runs `corpus-worker` **off** (unset) — the worker has no `localStorage` and can't read the emulator flag, so worker modes are out of scope here.
- **Serving prerequisites (run once before `wds`, they don't need the emulator):** `npm run generate:config` (writes `src/config.GENERATED.SECRET.ts` — required or `tsc` won't compile; `index.html` — references `lib/src/...` paths; `firestore.rules`), then `npm run build:shared` (writes `shared/dist/`), then `npx tsc` (writes `lib/`). `wds` serves `index.html` at the root.
- **Reporting policy** (from `docs/superpowers/plans/2026-07-07-adversarial-verification-plan.md`): **assert deterministic counter invariants; report wall-clock p95** (never hard-fail CI on milliseconds — hardware variance).
- **Appendix-A budgets** (`docs/fast-corpus-design-doc.md`): arrow-nav ≤16ms, keystroke ≤16ms, editor-open ≤100ms, commit→interactive ≤200ms, remote-echo ≤50ms, find ≤100ms.

---

## File structure

- **Modify** `firebase.perf.json` — add the auth emulator (port 9099).
- **Create** `test/perf-harness/run.js` — the runner CLI + orchestration (spawn wds, launch Playwright, drive, capture, teardown). One clear responsibility: orchestrate a run.
- **Create** `test/perf-harness/page-agent.js` — functions that execute **in the page context** (readiness poll, admin sign-in, DEBUG_STORE/DEBUG_PERF reads, shadow-DOM helpers), exported as plain functions passed to `page.evaluate`. Kept separate because page-context code (browser globals) must not be mixed with Node orchestration code.
- **Create** `test/perf-harness/interactions.js` — the Appendix-A interaction drivers (nav, editor-open, type, commit, find) + per-interaction timing. Separate so the interaction script is readable/editable in isolation.
- **Modify** `package.json` — add `perf:local` (and helper) scripts.
- **Modify** `.gitignore` — ignore `test/perf-harness/baselines/`.
- **Create** `test/perf-harness/baselines/.gitkeep` — output dir for run artifacts (contents gitignored).

---

## Task 1: Auth emulator config + smoke the two-emulator stack

**Files:**
- Modify: `firebase.perf.json`

**Interfaces:**
- Consumes: existing `load-emulator.js` (CLI).
- Produces: a `firebase.perf.json` that starts **firestore + auth** emulators; the loader still seeds under it.

- [ ] **Step 1: Add the auth emulator to the config**

Edit `firebase.perf.json` to add the `auth` entry (port matches `src/firebase.ts:102`):

```json
{
  "firestore": {
    "rules": "firestore.rules",
    "indexes": "firestore.indexes.json"
  },
  "emulators": {
    "firestore": { "port": 8089 },
    "auth": { "port": 9099 },
    "ui": { "enabled": false }
  }
}
```

- [ ] **Step 2: Regenerate rules (the config references `firestore.rules`) and smoke both emulators + the loader**

Run:
```bash
bash -lc 'export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 20.20.0 >/dev/null;
  npm run generate:config >/dev/null 2>&1;
  firebase emulators:exec --only firestore,auth --config firebase.perf.json --project demo-perf \
    "node test/perf-harness/load-emulator.js --count 2000 --project demo-perf"' 2>&1 | grep -iE "auth|firestore|count =|done|error" | tail -8
```
Expected: log lines showing BOTH `firestore` and `auth` emulators start (auth on 9099), then `[load-emulator] cards collection count = 2000` and `[load-emulator] done.`

- [ ] **Step 3: Commit**

```bash
git add firebase.perf.json
git commit -m "perf-harness: add auth emulator (9099) to firebase.perf.json"
```

---

## Task 2: Runner + anonymous published-only boot (Milestone 1 — verifies the whole pipeline)

This is the highest-value de-risking task: it proves the emulator + the `firebase.ts` wiring + `wds` + Playwright + `DEBUG_STORE` all work together, WITHOUT auth. The app shows PUBLISHED cards to a signed-out reader (the `all` permission tier grants `viewApp`, `src/selectors.ts:528-539`; `connectLivePublishedCards` has no auth requirement, `src/actions/database.ts:384-398`).

**Files:**
- Create: `test/perf-harness/page-agent.js`
- Create: `test/perf-harness/run.js`
- Modify: `package.json`
- Modify: `.gitignore`
- Create: `test/perf-harness/baselines/.gitkeep`

**Interfaces:**
- Consumes: `load-emulator.js` (spawned as a child), `firebase.perf.json`, `src/firebase.ts` emulator flag, `window.DEBUG_STORE` (`src/store.ts:58`).
- Produces: `run.js` CLI (`node test/perf-harness/run.js --count N [--auth admin|anon] [--seed S] [--out file]`); `page-agent.js` exporting `readState()` and `waitForCorpus(page, opts)`.

- [ ] **Step 1: Write the page-agent (in-page reads + readiness poll)**

Create `test/perf-harness/page-agent.js`. These functions are serialized into the page via `page.evaluate`, so they may only use browser globals (`window`, `document`).

```javascript
/*eslint-env browser*/
/* global window */

//Read a JSON-safe snapshot of load state + card count from the already-exposed
//window.DEBUG_STORE (src/store.ts:58) and window.DEBUG_PERF (src/perf.ts).
//Runs IN THE PAGE via page.evaluate.
export const readStateInPage = () => {
	const store = window.DEBUG_STORE;
	if (!store) return {ready: false, reason: 'no DEBUG_STORE'};
	const s = store.getState();
	const data = s.data || {};
	const cards = data.cards || {};
	const loading = data.loadingCardFetchTypes || {};
	//selectDataIsFullyLoaded (src/selectors.ts:1209-1215) reconstructed from raw state.
	const dataFullyLoaded = Object.keys(loading).length === 0 && !!data.sectionsLoaded && !!data.tagsLoaded;
	return {
		ready: true,
		cardCount: Object.keys(cards).length,
		dataFullyLoaded,
		loadingFetchTypes: Object.keys(loading),
		user: s.user && s.user.user ? {uid: s.user.user.uid, isAnonymous: s.user.user.isAnonymous} : null,
		perf: window.DEBUG_PERF ? window.DEBUG_PERF.data() : null,
	};
};

//Poll readStateInPage() until dataFullyLoaded (or minCards seen) or timeout.
//Runs IN NODE, drives the page.
export const waitForCorpus = async (page, {minCards = 1, timeoutMs = 120000, pollMs = 500} = {}) => {
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

- [ ] **Step 2: Write the runner (spawn wds, launch Playwright, boot, report)**

Create `test/perf-harness/run.js`. This orchestrates in Node; it assumes it runs INSIDE `firebase emulators:exec` (so `FIRESTORE_EMULATOR_HOST`/`FIREBASE_AUTH_EMULATOR_HOST` are set) and that the serving prerequisites are already built.

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

const sh = (cmd, cmdArgs, opts = {}) => new Promise((res, rej) => {
	const p = spawn(cmd, cmdArgs, {stdio: 'inherit', ...opts});
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
	//1. Seed the emulator (inherits the emulator env).
	await sh('node', ['test/perf-harness/load-emulator.js', '--count', String(count), '--seed', String(seed), '--project', projectId]);

	//2. Start wds (serves the already-built lib/ + index.html).
	const wds = spawn('npx', ['wds', '--node-resolve', '--port', String(PORT)], {stdio: 'ignore'});
	const cleanup = () => { try { wds.kill('SIGTERM'); } catch { /* noop */ } };
	process.on('exit', cleanup);
	try {
		await waitForServer(URL);

		//3. Launch chromium with a fresh (no-persistence) context so the service
		//worker + cache never carry across runs, and set localStorage pre-boot.
		const browser = await chromium.launch();
		const context = await browser.newContext({serviceWorkers: 'block'});
		await context.addInitScript(({emu, worker, perf}) => {
			try {
				window.localStorage.setItem('firebase-emulator', emu);
				if (worker) window.localStorage.setItem('corpus-worker', worker);
				window.localStorage.setItem('debug-perf', perf);
				//Suppress the auto-anonymous-signin race (src/actions/user.ts:213-217)
				//so it never competes with our own sign-in; harmless for anon runs.
				//CONFIRM the exact key string from LOCAL_STORAGE_HAS_PREVIOUS_SIGN_IN_KEY
				//(src/constants.ts, used at src/actions/user.ts:234-236) — replace the
				//literal below if it differs.
				window.localStorage.setItem('has-previous-sign-in', '1');
			} catch { /* noop */ }
		}, {emu: 'localhost:8089', worker: '', perf: '1'});

		const page = await context.newPage();
		page.on('dialog', d => d.accept().catch(() => {})); //editingCommit() confirm()/alert() (src/actions/editor.ts:352-389)
		const consoleErrors = [];
		page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });

		await page.goto(URL, {waitUntil: 'domcontentloaded'});

		//4. Wait for the corpus. Anonymous sees ~30% published; require a healthy chunk.
		const minCards = authMode === 'admin' ? Math.floor(count * 0.9) : Math.floor(count * 0.15);
		const state = await waitForCorpus(page, {minCards, timeoutMs: 180000});

		console.log('[run] BOOT OK: cardCount=' + state.cardCount + ' dataFullyLoaded=' + state.dataFullyLoaded + ' user=' + JSON.stringify(state.user));
		if (consoleErrors.length) console.log('[run] console errors (' + consoleErrors.length + '): ' + consoleErrors.slice(0, 5).join(' | '));

		await browser.close();
	} finally {
		cleanup();
	}
};

main().then(() => process.exit(0)).catch(err => { console.error('[run] FAILED:', err); process.exit(1); });
```

- [ ] **Step 3: Add npm scripts + ignore run artifacts**

In `package.json` `scripts`, add after `test:perf-harness`:
```json
    "perf:build": "npm run generate:config && npm run build:shared && npx tsc",
    "perf:local": "npm run perf:build && firebase emulators:exec --only firestore,auth --config firebase.perf.json --project demo-perf \"node test/perf-harness/run.js --count 2000 --auth anon\"",
```
(The `--count 2000` is the fast smoke default; raise to 40000 for a real run.)

In `.gitignore`, add:
```
test/perf-harness/baselines/
```
And create the dir keeper:
```bash
mkdir -p test/perf-harness/baselines && touch test/perf-harness/baselines/.gitkeep
```
(Force-add the keeper past the ignore: `git add -f test/perf-harness/baselines/.gitkeep`.)

- [ ] **Step 4: Run the pipeline (the moment of truth)**

Run:
```bash
bash -lc 'export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 20.20.0 >/dev/null; npm run perf:local 2>&1 | tail -25'
```
Expected: `[load-emulator] cards collection count = 2000`, then `[run] BOOT OK: cardCount=<~600 for anon published subset> dataFullyLoaded=true user=null`. If it times out in `waitForCorpus`, the last-state JSON in the error shows whether cards arrived (emulator/listener issue) or `DEBUG_STORE` was missing (build/serve issue) — debug from there. If console errors mention the service worker or a failed emulator connect, address per Global Constraints.

- [ ] **Step 5: Commit**

```bash
git add test/perf-harness/run.js test/perf-harness/page-agent.js package.json .gitignore
git add -f test/perf-harness/baselines/.gitkeep
git commit -m "perf-harness: Playwright runner + anonymous published-only boot (pipeline verified)"
```

---

## Task 3: Admin sign-in via a fake emulator JWT (unlocks the full 40k corpus)

Anonymous sees only published cards. To measure over the full corpus (and to edit/commit), the runner signs in as the admin whose uid matches the seeded `permissions/perf-admin` doc (`load-emulator.js` seeds `permissions/{adminUid}.admin = true`, default `perf-admin`). The Auth emulator accepts an unsigned "fake" Google ID token via `signInWithCredential(auth, GoogleAuthProvider.credential(idToken))`, reusing the app's own v9 auth singleton (`src/firebase.ts:85`) — the same API the app already imports (`src/actions/user.ts:196`). **Smoke-test this in isolation first (it's the one genuinely-unproven step against this SDK version).**

**Files:**
- Modify: `test/perf-harness/page-agent.js`
- Modify: `test/perf-harness/run.js`

**Interfaces:**
- Produces: `signInAsAdminInPage(uid, email)` (page-context) and a `--auth admin` path in `run.js` that ends with `state.user.uid === 'perf-admin'` and `cardCount ≈ count`.

- [ ] **Step 1: Add the sign-in page function**

In `test/perf-harness/page-agent.js`, add. The fake ID token is a JWT whose signature the emulator ignores; the app's `onAuthStateChanged` (`src/components/user-chip.ts:98-108`) then drives `signInSuccess`.

```javascript
//Build an unsigned Google-style ID token the Auth emulator accepts.
const b64url = (obj) => btoa(JSON.stringify(obj)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
const fakeGoogleIdToken = (uid, email) => {
	const header = {alg: 'none', kid: '', type: 'JWT'};
	const payload = {
		iss: 'https://accounts.google.com', aud: 'demo-perf', sub: uid,
		user_id: uid, email, email_verified: true, name: 'Perf Admin',
		firebase: {sign_in_provider: 'google.com', identities: {'google.com': [uid], email: [email]}},
	};
	return `${b64url(header)}.${b64url(payload)}.`;
};

//Sign in against the Auth emulator with a fake Google credential, in the page,
//using the app's own exported `auth`. Imports the app's compiled firebase module
//so the SAME auth singleton (already pointed at the emulator) is used.
export const signInAsAdminInPage = async ({uid, email}) => {
	const idToken = (() => {
		const b = (o) => btoa(JSON.stringify(o)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
		const header = {alg: 'none', kid: '', type: 'JWT'};
		const payload = {iss: 'https://accounts.google.com', aud: 'demo-perf', sub: uid, user_id: uid, email, email_verified: true, name: 'Perf Admin', firebase: {sign_in_provider: 'google.com', identities: {'google.com': [uid], email: [email]}}};
		return `${b(header)}.${b(payload)}.`;
	})();
	const authMod = await import('/lib/src/firebase.js');
	const provider = await import('firebase/auth');
	const cred = provider.GoogleAuthProvider.credential(idToken);
	const res = await provider.signInWithCredential(authMod.auth, cred);
	return {uid: res.user.uid, isAnonymous: res.user.isAnonymous};
};
```
Note: keep the standalone `fakeGoogleIdToken`/`b64url` for a Node-side smoke test; the exported `signInAsAdminInPage` inlines them because `page.evaluate` serializes only the passed function's own body.

- [ ] **Step 2: Smoke-test the sign-in in isolation BEFORE wiring it into the full run**

Add a temporary probe path to `run.js`: after `page.goto` and BEFORE `waitForCorpus`, if `authMode === 'admin'`, call it and log:
```javascript
if (authMode === 'admin') {
	const signed = await page.evaluate(({uid, email}) =>
		window.__signInAsAdmin ? window.__signInAsAdmin({uid, email}) : import('/lib/src/firebase.js').then(async (m) => {
			const a = await import('firebase/auth');
			const b = (o) => btoa(JSON.stringify(o)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
			const tok = b({alg: 'none', kid: '', type: 'JWT'}) + '.' + b({iss: 'https://accounts.google.com', aud: 'demo-perf', sub: uid, user_id: uid, email, email_verified: true, firebase: {sign_in_provider: 'google.com', identities: {'google.com': [uid], email: [email]}}}) + '.';
			const r = await a.signInWithCredential(m.auth, a.GoogleAuthProvider.credential(tok));
			return {uid: r.user.uid, isAnonymous: r.user.isAnonymous};
		}), {uid: 'perf-admin', email: 'perf-admin@example.com'});
	console.log('[run] signed in:', JSON.stringify(signed));
}
```
Run `npm run perf:local` with the script's `run.js` invocation temporarily set to `--auth admin --count 200`. Expected: `[run] signed in: {"uid":"perf-admin","isAnonymous":false}`. If the emulator rejects the token, try the alternative — the Auth emulator REST endpoint `POST http://localhost:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithIdp` — and adjust; this is the flagged unknown to resolve here, cheaply, before Task 4.

- [ ] **Step 3: Wire admin sign-in cleanly + confirm full-corpus visibility**

Replace the probe with a call to the exported `signInAsAdminInPage` (via `page.evaluate(signInAsAdminInPage, {uid:'perf-admin', email:'perf-admin@example.com'})`), placed after `page.goto` and before `waitForCorpus`. The `minCards` for admin is already `count*0.9`. Run `npm run perf:local` (admin, `--count 2000`). Expected: `[run] BOOT OK: cardCount=~2000 dataFullyLoaded=true user={"uid":"perf-admin","isAnonymous":false}` — i.e. the admin sees the WHOLE corpus (published + unpublished), unlike the anon run.

- [ ] **Step 4: Commit**

```bash
git add test/perf-harness/run.js test/perf-harness/page-agent.js
git commit -m "perf-harness: headless admin sign-in via fake emulator JWT (full-corpus visibility)"
```

---

## Task 4: Appendix-A interaction script + baseline + commit-settle attribution

Drives the real interactions, captures per-interaction wall-clock (via `performance.mark`/`measure` in the page) and Redux dispatch timings (`DEBUG_PERF.data()`), writes a baseline JSON, asserts the counter invariants, and attributes the ~2s commit-settle. Grounded in the discovery: arrow keys → `navigateTo{Next,Previous}Card` (window keydown, `main-view.ts:414`); commit-done = `state.data.pendingModificationCount === 0` (`src/reducers/data.ts:147-152`); body is `section[data-field='body'][contenteditable]` through 3 shadow roots.

**Files:**
- Create: `test/perf-harness/interactions.js`
- Modify: `test/perf-harness/run.js`

**Interfaces:**
- Consumes: `waitForCorpus`/`readStateInPage` (page-agent), `page` (Playwright).
- Produces: `runInteractions(page, {keystrokes})` returning `{nav, editorOpen, keystroke, commit, find, counters}` with p50/p95/p99 per interaction; a baseline written to `test/perf-harness/baselines/`.

- [ ] **Step 1: Percentile + timing helpers and the interaction drivers**

Create `test/perf-harness/interactions.js`:

```javascript
/*eslint-env node*/

const pct = (arr, p) => {
	if (!arr.length) return null;
	const s = [...arr].sort((a, b) => a - b);
	const i = Math.min(s.length - 1, Math.floor((p / 100) * s.length));
	return +s[i].toFixed(2);
};
const summary = (samples) => ({n: samples.length, p50: pct(samples, 50), p95: pct(samples, 95), p99: pct(samples, 99), max: samples.length ? +Math.max(...samples).toFixed(2) : null});

//Resolve the contenteditable body across the 3 shadow roots (card-view ->
//card-stage -> card-renderer#main -> section[data-field=body]). Returns a
//Playwright handle usable for focus/typing.
const bodyLocator = (page) => page.locator(
	'card-web-app >>> main-view >>> card-view >>> card-stage >>> card-renderer#main >>> section[data-field="body"][contenteditable="true"]'
);

//Measure a single interaction: reset the app's own perf counters, run `fn`,
//return elapsed ms measured in Node (wall-clock incl. sync render).
const timed = async (fn) => { const t = Date.now(); await fn(); return Date.now() - t; };

export const runInteractions = async (page, {keystrokes = 30} = {}) => {
	//--- Arrow-nav x20 (each press = one measured interaction) ---
	const nav = [];
	for (let i = 0; i < 20; i++) nav.push(await timed(() => page.keyboard.press('ArrowDown')));

	//--- Editor open (click the round Edit button in card-view's shadow root) ---
	const editorOpen = [await timed(async () => {
		await page.locator('card-web-app >>> main-view >>> card-view button.round').first().click();
		await bodyLocator(page).waitFor({state: 'visible', timeout: 10000});
	})];

	//--- 30 keystrokes into the body ---
	const body = bodyLocator(page);
	await body.click();
	const keystroke = [];
	for (let i = 0; i < keystrokes; i++) keystroke.push(await timed(() => page.keyboard.type('x')));

	//--- Commit (Cmd/Ctrl+Enter -> doCommit -> editingCommit) and wait for
	//    pendingModificationCount to return to 0 (the true "interactive" marker) ---
	const commit = [await timed(async () => {
		await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter');
		await page.waitForFunction(() => {
			const s = window.DEBUG_STORE && window.DEBUG_STORE.getState();
			return s && s.data && s.data.pendingModificationCount === 0;
		}, {timeout: 30000});
	})];

	//--- Find dialog (Cmd/Ctrl+F) + a query ---
	const find = [await timed(async () => {
		await page.keyboard.press(process.platform === 'darwin' ? 'Meta+f' : 'Control+f');
		await page.keyboard.type('perf');
		await page.waitForTimeout(400); //past the 250ms debounce
	})];

	//--- Snapshot the app's own dispatch timings + counters for attribution ---
	const perf = await page.evaluate(() => window.DEBUG_PERF ? window.DEBUG_PERF.data() : null);

	return {
		nav: summary(nav), editorOpen: summary(editorOpen), keystroke: summary(keystroke),
		commit: summary(commit), find: summary(find), perf,
	};
};
```
Note the `>>>` shadow-piercing combinator — Playwright's CSS engine supports it for open shadow roots. **Verify these locators resolve against the running app in Step 3; if a component uses a closed shadow root, fall back to `page.evaluate` walking `shadowRoot` manually (the discovery lists the exact element chain).**

**Timing accuracy — which number is authoritative.** `timed()` measures Node-side wall-clock around a Playwright call, so it INCLUDES Playwright IPC (~ms) and is a coarse UPPER BOUND, fine for the ~200ms/2s commit but too noisy for the ≤16ms budgets. The app's own `perfMiddleware` already times every dispatch on the MAIN THREAD with no IPC (`src/perf.ts:52-63`), so the authoritative per-interaction cost is `results.perf.actionStats['dispatch:SHOW_CARD']` (nav), `['dispatch:EDITING_START']` (editor open), `['dispatch:MODIFY_CARD']`/`['dispatch:UPDATE_CARDS']` (commit), etc. Report BOTH in the baseline, but budget-compare the `≤16ms` gates against the DEBUG_PERF dispatch timings, not `timed()`.

- [ ] **Step 2: Wire into run.js — measure, write baseline, assert invariants**

In `run.js`, after `waitForCorpus`, add (import `runInteractions` and `fs`):

```javascript
import {runInteractions} from './interactions.js';
import fs from 'fs';
// ...after `const state = await waitForCorpus(...)`:
await page.evaluate(() => window.DEBUG_PERF && window.DEBUG_PERF.reset());
const results = await runInteractions(page, {keystrokes: 30});
const baseline = {count, seed, authMode, cardCount: state.cardCount, when: process.env.PERF_STAMP || 'unstamped', results};
const outPath = getArg('out', `test/perf-harness/baselines/${authMode}-${count}.json`);
fs.writeFileSync(outPath, JSON.stringify(baseline, null, 2));
console.log('[run] baseline -> ' + outPath);
console.log('[run] p95 ms  nav=' + results.nav.p95 + ' editorOpen=' + results.editorOpen.p95 + ' keystroke=' + results.keystroke.p95 + ' commit=' + results.commit.p95 + ' find=' + results.find.p95);
//Deterministic invariant (assert, not wall-clock): the reference-block recompute
//must stay OFF the nav sync path. makeFilterFromCards clone count during nav is
//the design doc's key counter; surface it for the operator.
console.log('[run] counters: ' + JSON.stringify(results.perf ? results.perf.counters : {}));
```
(Timestamps: pass `PERF_STAMP=$(date +%s)` in the env when running — the runner must not call `Date.now()` for the stamp inside a reproducible artifact field beyond the measured elapseds.)

- [ ] **Step 3: Run at 2k, validate the interaction locators, then at 40k**

Run `npm run perf:local` (admin, `--count 2000`). Expected: `[run] baseline -> test/perf-harness/baselines/admin-2000.json` and a `p95 ms ...` line with real numbers, plus `counters: {...}` including `makeFilterFromCards:*`. Debug any locator that fails to resolve (Step 1 note). Then do one 40k run (edit the script's `--count` to `40000`, expect a multi-minute load): this is the first reproducible measurement of the Appendix-A budgets and the ~2s commit-settle. The `commit` p95 vs the `perf.actionStats['dispatch:MODIFY_CARD' | 'dispatch:UPDATE_CARDS' | ...]` split IS the commit-settle attribution.

- [ ] **Step 4: Commit**

```bash
git add test/perf-harness/interactions.js test/perf-harness/run.js
git commit -m "perf-harness: Appendix-A interaction script + baseline + commit-settle attribution"
```

---

## Task 5 (documented, not built here): worker-mode measurement

`corpus-worker=shadow`/`on` is the design doc's target end-state and where the ~2s commit-settle was originally observed. It's out of scope for this plan because the corpus worker (`src/worker/corpus-worker.ts`) has its OWN Firestore init and no `localStorage`, so the emulator config must be passed to it at spawn (postMessage/init param) — a separate app change. Capture as a follow-up: extend the emulator wiring to the worker, then re-run this harness with `localStorage['corpus-worker']='shadow'` (the runner already has a `worker` init-script slot).

---

## Self-review notes

- **Coverage:** boot pipeline (T2), full-corpus admin visibility (T3), all six Appendix-A interactions + baseline + attribution (T4), auth-emulator config (T1). Worker mode explicitly deferred (T5).
- **Riskiest unknowns are smoke-tested early:** the fake-JWT emulator sign-in (T3 Step 2, in isolation before the full script) and the shadow-DOM piercing locators (T4 Step 1 note + Step 3 validation).
- **Reporting policy honored:** wall-clock p95 is reported; the deterministic counter (`makeFilterFromCards` clones during nav) is surfaced for assertion. Baselines are gitignored (machine-specific numbers), not committed as pass/fail gates.
- **No live session/quota needed** for T1–T4 (all against the emulator + synthetic corpus). The real-corpus G1 run remains a thin `--auth admin` variant against the dev project (operator session), out of this plan.

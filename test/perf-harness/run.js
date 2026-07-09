/*eslint-env node*/
import {spawn} from 'child_process';
import fs from 'fs';
import {chromium} from 'playwright';
import {waitForCorpus, signInAsAdminInPage} from './page-agent.js';
import {runInteractions} from './interactions.js';

const args = process.argv.slice(2);
const getArg = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const count = parseInt(getArg('count', '40000'), 10);
const seed = parseInt(getArg('seed', '1'), 10);
const authMode = getArg('auth', 'anon'); //'anon' | 'admin'
const projectId = getArg('project', 'demo-perf');
//corpus-worker mode: 'off' (main-thread only, the OLD-shaped path) | 'shadow'
//(worker ingests, UI still serves) | 'on' (worker owns ingestion AND serves the
//collection — THE SHIP MODE). Only 'on' is a ship gate. Set pre-boot so the app
//reads it before spawning the worker.
const workerMode = getArg('corpus-worker', 'off');
//corpus-sync: '' = app default (listen); 'watermark' = the delta plane (the
//ship config for worker modes — O(changes) reads). Only set when provided.
const syncMode = getArg('corpus-sync', '');
const workerModeActive = workerMode === 'shadow' || workerMode === 'on';
//Corpus load can be slow at scale (the app's ingestion cost is itself part of
//what we measure); large runs need a longer budget than the 180s default.
const loadTimeoutMs = parseInt(getArg('load-timeout', '180000'), 10);
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
		await context.addInitScript((cfg) => {
			try {
				window.localStorage.setItem('firebase-emulator', 'localhost:8089');
				window.localStorage.setItem('debug-perf', '1');
				//Suppress the auto-anonymous-signin race (src/actions/user.ts:213-217).
				//KEY is 'hasPreviousSignIn' (LOCAL_STORAGE_HAS_PREVIOUS_SIGN_IN_KEY, src/constants.ts).
				window.localStorage.setItem('hasPreviousSignIn', '1');
				//corpus-worker/corpus-sync are read pre-boot by src/corpus-mode.ts.
				//The worker inherits the emulator target via the connect message
				//(it has no localStorage) — see src/corpus-bridge.ts.
				window.localStorage.setItem('corpus-worker', cfg.workerMode);
				if (cfg.syncMode) window.localStorage.setItem('corpus-sync', cfg.syncMode);
			} catch { /* noop */ }
		}, {workerMode, syncMode});

		const page = await context.newPage();
		page.on('dialog', d => d.accept().catch(() => {})); //editingCommit() confirm()/alert() (src/actions/editor.ts)
		const consoleMsgs = [];
		page.on('console', m => {
			const line = '[' + m.type() + '] ' + m.text();
			consoleMsgs.push(line);
			//Live-echo the signal lines (worker status, errors) so long loads and
			//failures aren't invisible until the final tail dump. Skip the
			//high-frequency [PERF] spam.
			const t = m.text();
			if ((m.type() === 'error' || t.includes('[corpus-worker]') || t.includes('[corpus-shadow]') || t.includes('transport errored') || t.includes('reconcil')) && !t.includes('[PERF]')) {
				console.log('  ' + line.slice(0, 240));
			}
		});
		page.on('response', r => { if (r.status() === 400) consoleMsgs.push('[400] ' + r.url().slice(0, 160)); });
		page.on('requestfailed', r => { consoleMsgs.push('[reqfail] ' + (r.failure() ? r.failure().errorText : '') + ' ' + r.url().slice(0, 160)); });

		await page.goto(URL, {waitUntil: 'domcontentloaded'});

		if (authMode === 'admin') {
			const signed = await page.evaluate(signInAsAdminInPage, {uid: 'perf-admin', email: 'perf-admin@example.com'});
			console.log('[run] signed in:', JSON.stringify(signed));
		}

		console.log('[run] corpus-worker=' + workerMode + (syncMode ? ' corpus-sync=' + syncMode : '') + (workerModeActive ? ' (gating on syncState===live)' : ''));
		const minCards = authMode === 'admin' ? Math.floor(count * 0.9) : Math.floor(count * 0.15);
		const state = await waitForCorpus(page, {minCards, timeoutMs: loadTimeoutMs, requireWorkerLive: workerModeActive, progressEveryMs: 15000}).catch(e => {
			//Dump the distinct signal lines (not raw last-N, which is dominated by
			//repeating transport errors) so a timeout is diagnosable.
			const signal = consoleMsgs.filter(m => m.startsWith('[error]') || m.includes('[corpus-worker]') || m.includes('reconcil') || m.includes('transport errored'));
			const seen = new Set();
			const distinct = signal.filter(m => { const k = m.replace(/SID=[^ &]+|0x[0-9a-f]+|[0-9.]+ms|[0-9]+ cards/g, ''); if (seen.has(k)) return false; seen.add(k); return true; });
			console.log('[run] distinct signal lines (' + distinct.length + ' of ' + consoleMsgs.length + ' console msgs):\n' + distinct.slice(-40).join('\n'));
			throw e;
		});
		console.log('[run] BOOT OK: mainCards=' + state.cardCount + ' workerCorpus=' + state.workerCorpusSize + ' dataFullyLoaded=' + state.dataFullyLoaded + ' loadComplete=' + state.workerLoadComplete + ' syncState="' + state.syncState + '" user=' + JSON.stringify(state.user));
		const errs = consoleMsgs.filter(m => m.startsWith('[error]'));
		if (errs.length) console.log('[run] console errors (' + errs.length + '): ' + errs.slice(0, 5).join(' | '));

		//The Appendix-A interaction script needs an editable card (admin).
		if (authMode === 'admin') {
			const results = await runInteractions(page, {keystrokes: 30}).catch(e => {
				console.log('[run] interactions failed. url=' + page.url() + '\ntail:\n' + consoleMsgs.slice(-18).join('\n'));
				throw e;
			});
			const baseline = {
				count, seed, authMode, workerMode, syncMode: syncMode || '(default)', cardCount: state.cardCount, syncState: state.syncState, results,
				note: 'commit/find wall-clock is EMULATOR-OPTIMISTIC (near-zero local write-echo); budget-authoritative = results.dispatch.* (main-thread) + results.worker.* (worker-thread) attributed together. Only corpus-worker=on is a ship gate.',
			};
			const outPath = getArg('out', `test/perf-harness/baselines/${authMode}-${workerMode}-${count}.json`);
			fs.writeFileSync(outPath, JSON.stringify(baseline, null, 2));
			console.log('[run] baseline -> ' + outPath);
			const d = results.dispatch;
			console.log('[run] main-thread avg/max ms: SHOW_CARD=' + JSON.stringify(d.showCard) + ' UPDATE_READS=' + JSON.stringify(d.updateReads) + ' EDITING_START=' + JSON.stringify(d.editingStart) + ' MODIFY_CARD=' + JSON.stringify(d.modifyCard) + ' UPDATE_CARDS=' + JSON.stringify(d.updateCards));
			if (d.updateWorkerCollection || d.echoLocalCardModifications) console.log('[run] worker-mode dispatches: UPDATE_WORKER_COLLECTION=' + JSON.stringify(d.updateWorkerCollection) + ' ECHO_LOCAL_CARD_MODIFICATIONS=' + JSON.stringify(d.echoLocalCardModifications));
			if (results.worker) console.log('[run] WORKER-thread avg/max ms: ingest=' + JSON.stringify(results.worker.ingest) + ' indexBuild=' + JSON.stringify(results.worker.indexBuild) + ' runCollection=' + JSON.stringify(results.worker.runCollection) + ' collectionPush=' + JSON.stringify(results.worker.collectionPush) + ' query=' + JSON.stringify(results.worker.query) + ' indexBuildMsCumulative=' + results.worker.indexBuildMsCumulative);
			console.log('[run] makeFilterFromCards counters: ' + JSON.stringify(Object.fromEntries(Object.entries(results.counters).filter(([k]) => k.includes('makeFilterFromCards')))));
			console.log('[run] NOTE: commit/find wall-clock is emulator-optimistic; commit→interactive budget belongs to perf:dev.');
		}

		await browser.close();
	} finally {
		cleanup();
	}
};

main().then(() => process.exit(0)).catch(err => { console.error('[run] FAILED:', err); process.exit(1); });

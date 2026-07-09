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
				//KEY is 'hasPreviousSignIn' (LOCAL_STORAGE_HAS_PREVIOUS_SIGN_IN_KEY, src/constants.ts).
				window.localStorage.setItem('hasPreviousSignIn', '1');
			} catch { /* noop */ }
		});

		const page = await context.newPage();
		page.on('dialog', d => d.accept().catch(() => {})); //editingCommit() confirm()/alert() (src/actions/editor.ts)
		const consoleMsgs = [];
		page.on('console', m => { consoleMsgs.push('[' + m.type() + '] ' + m.text()); });

		await page.goto(URL, {waitUntil: 'domcontentloaded'});

		const minCards = authMode === 'admin' ? Math.floor(count * 0.9) : Math.floor(count * 0.15);
		const state = await waitForCorpus(page, {minCards}).catch(e => {
			console.log('[run] console tail:\n' + consoleMsgs.slice(-20).join('\n'));
			throw e;
		});
		console.log('[run] BOOT OK: cardCount=' + state.cardCount + ' dataFullyLoaded=' + state.dataFullyLoaded + ' user=' + JSON.stringify(state.user));
		const errs = consoleMsgs.filter(m => m.startsWith('[error]'));
		if (errs.length) console.log('[run] console errors (' + errs.length + '): ' + errs.slice(0, 5).join(' | '));

		await browser.close();
	} finally {
		cleanup();
	}
};

main().then(() => process.exit(0)).catch(err => { console.error('[run] FAILED:', err); process.exit(1); });

/*eslint-env node*/
import {spawn} from 'child_process';
import fs from 'fs';
import {isDeepStrictEqual} from 'util';
import {chromium} from 'playwright';
import {initializeApp} from 'firebase-admin/app';
import {getFirestore, FieldValue} from 'firebase-admin/firestore';
import {waitForCorpus, waitForWorkerIdle, waitForSearchRecallReady} from './page-agent.js';
import {runInteractions} from './interactions.js';

const args = process.argv.slice(2);
const getArg = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const hasFlag = (n) => args.includes('--' + n);
const count = parseInt(getArg('count', '40000'), 10);
const seed = parseInt(getArg('seed', '1'), 10);
//publishedP: forwarded to the seeder. Lower it to keep the published listener
//under the emulator's ~10k back-channel cap so larger TOTAL corpora load (the
//emulator cannot stream >~10k docs over one WebChannel Listen — real Firestore
//can). Total corpus size is preserved; only the published/unpublished split.
const publishedP = getArg('published-p', '');
const authMode = getArg('auth', 'anon'); //'anon' | 'admin'
const testReader = hasFlag('test-reader'); //anonymous multi-tab reader path: no gate, cards render, both tabs
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
const serviceWorkers = getArg('service-workers', 'block');
const testTakeover = args.includes('--test-takeover');
const testMultiEdit = args.includes('--test-multiedit');
const multiEditCount = parseInt(getArg('multi-count', '500'), 10);
//The app waits 12s for a cooperative handoff before considering a clean lease
//stale and stealing it. Leave ample scheduler margin for the browser test.
const FROZEN_OWNER_TAKEOVER_TIMEOUT_MS = 27000;
if (serviceWorkers !== 'block' && serviceWorkers !== 'allow') throw new Error('--service-workers must be block or allow');
const PORT = 8081;
const URL = `http://localhost:${PORT}`;

if (!process.env.FIRESTORE_EMULATOR_HOST) {
	console.error('run.js must run inside `firebase emulators:exec` (FIRESTORE_EMULATOR_HOST unset).');
	process.exit(1);
}

for (const artifact of ['build/index.html', 'build/service-worker.js', 'build/lib/src/worker/corpus-worker.js']) {
	if (!fs.existsSync(artifact)) throw new Error(`missing production artifact ${artifact}; run npm run perf:build first`);
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

const waitForConsoleLine = async (messages, predicate, timeoutMs = 30000) => {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		const match = messages.find(predicate);
		if (match) return match;
		await new Promise(resolve => setTimeout(resolve, 100));
	}
	throw new Error('timed out waiting for expected console line');
};

const verifierDB = getFirestore(initializeApp({projectId}, 'perf-run-verifier'));
const readEmulatorCardBody = async (cardID) => (await verifierDB.collection('cards').doc(cardID).get()).data()?.body ?? '';

const main = async () => {
	//1. Seed the emulator (inherits the emulator env from emulators:exec).
	await sh(process.execPath, ['test/perf-harness/load-emulator.js', '--count', String(count), '--seed', String(seed), '--project', projectId, ...(publishedP ? ['--published-p', publishedP] : [])]);

	//2. Start the project-local wds. `detached` + kill(-pid) reaps the whole
	//server process group and prevents a failed run from wedging port 8081.
	const wdsErr = [];
	const wds = spawn(process.execPath, ['node_modules/@web/dev-server/dist/bin.js', '--root-dir', 'build', '--app-index', 'build/index.html', '--node-resolve', '--port', String(PORT)], {detached: true, stdio: ['ignore', 'ignore', 'pipe']});
	wds.stderr.on('data', d => wdsErr.push(d.toString()));
	let killed = false;
	const cleanup = () => { if (killed) return; killed = true; try { process.kill(-wds.pid, 'SIGTERM'); } catch { /* noop */ } };
	process.on('exit', cleanup);
	process.on('SIGINT', () => { cleanup(); process.exit(130); });
	process.on('SIGTERM', () => { cleanup(); process.exit(143); });

	try {
		await waitForServer(URL).catch(e => { throw new Error(e.message + '\nwds stderr:\n' + wdsErr.join('')); });

		const browser = await chromium.launch();
		const context = await browser.newContext({serviceWorkers});
		//Analytics is outside this local performance test and commonly blocked by
		//CI/network policy; fulfill it locally so a harmless beacon cannot mask a
		//real application request failure.
		await context.route('https://www.google-analytics.com/**', route => route.fulfill({status: 204, body: ''}));
		await context.route('https://www.googletagmanager.com/**', route => route.fulfill({status: 204, body: ''}));
		await context.route('https://fonts.googleapis.com/**', route => route.fulfill({status: 200, contentType: 'text/css', body: ''}));
		await context.route('https://fonts.gstatic.com/**', route => route.fulfill({status: 204, body: ''}));
		await context.addInitScript((cfg) => {
			try {
				window.localStorage.setItem('firebase-emulator', 'localhost:8089');
				window.localStorage.setItem('debug-perf', '1');
				//Suppress the auto-anonymous-signin race (src/actions/user.ts:213-217)
				//— EXCEPT in the reader scenario, whose whole point is booting the
				//way a fresh anonymous visitor does (no marker → reader path).
				//KEY is 'hasPreviousSignIn' (LOCAL_STORAGE_HAS_PREVIOUS_SIGN_IN_KEY, src/constants.ts).
				if (!cfg.testReader) window.localStorage.setItem('hasPreviousSignIn', '1');
				//corpus-worker/corpus-sync are read pre-boot by src/corpus-mode.ts.
				//The worker inherits the emulator target via the connect message
				//(it has no localStorage) — see src/corpus-bridge.ts.
				window.localStorage.setItem('corpus-worker', cfg.workerMode);
				if (cfg.syncMode) window.localStorage.setItem('corpus-sync', cfg.syncMode);
			} catch { /* noop */ }
		}, {workerMode, syncMode, testReader});

		let page = await context.newPage();
		let takeoverScenariosPassed = false;
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
			if (t.includes('[PERF] main collection ')) console.log('  [main-collection-source] ' + (m.location().url || '(unknown)'));
		});
		page.on('pageerror', error => { consoleMsgs.push('[pageerror] ' + (error.stack || error.message)); });
		page.on('response', r => { if (r.status() >= 400) { const line = '[' + r.status() + '] ' + r.url().slice(0, 200); consoleMsgs.push(line); console.log('  ' + line); } });
		page.on('requestfailed', r => { consoleMsgs.push('[reqfail] ' + (r.failure() ? r.failure().errorText : '') + ' ' + r.url().slice(0, 160)); });

		await page.goto(URL, {waitUntil: 'domcontentloaded'});
		await page.waitForFunction(() => Boolean(window.PERF_HARNESS), {timeout: 30000});

		if (testReader) {
			//READER MULTI-TAB: a fresh anonymous visitor (no previous-sign-in
			//marker) must get cards in EVERY tab with no ownership gate. This
			//is the scenario whose absence let a nonfunctional reader path ship
			//with green tests (round-6 audit): the worker-spawn guard rejected
			//the reader state, and the auto-anonymous sign-in disqualified
			//every visitor from readerness — two bugs that canceled into
			//"looks fine" everywhere except an actual fresh anonymous boot.
			const expectReaderCards = Math.max(1, Math.floor(count * (publishedP ? parseFloat(publishedP) : 0.05) * 0.5));
			const readerState = async (somePage) => somePage.evaluate(() => ({
				gateOpen: (() => {
					const app = document.querySelector('card-web-app');
					const gate = app && app.shadowRoot && app.shadowRoot.querySelector('corpus-ownership-gate');
					return Boolean(gate && gate.hasAttribute('open'));
				})(),
			}));
			await waitForCorpus(page, {minCards: expectReaderCards, timeoutMs: loadTimeoutMs});
			const tabA = await readerState(page);
			if (tabA.gateOpen) throw new Error('READER FAILED: first anonymous tab is gated');
			const readerB = await context.newPage();
			readerB.on('console', m => { if (m.type() === 'error') console.log('  [reader-b ' + m.type() + '] ' + m.text().slice(0, 200)); });
			await readerB.goto(URL, {waitUntil: 'domcontentloaded'});
			await readerB.waitForFunction(() => Boolean(window.PERF_HARNESS), {timeout: 30000});
			await waitForCorpus(readerB, {minCards: expectReaderCards, timeoutMs: loadTimeoutMs});
			//Give ownership resolution time to (wrongly) raise a gate.
			await readerB.waitForTimeout(6000);
			const tabB = await readerState(readerB);
			if (tabB.gateOpen) throw new Error('READER FAILED: second anonymous tab is gated — reader path not active');
			//And the FIRST tab must be unaffected by the second one existing.
			const tabAAfter = await readerState(page);
			if (tabAAfter.gateOpen) throw new Error('READER FAILED: first tab became gated after a second tab opened');
			await readerB.close();
			console.log('[run] READER MULTI-TAB OK: two anonymous tabs, cards in both, no gate');
			await browser.close();
			return;
		}

		if (authMode === 'admin') {
			const signed = await page.evaluate(() => window.PERF_HARNESS.signInAsAdmin('perf-admin'));
			console.log('[run] signed in:', JSON.stringify(signed));
		}

		console.log('[run] corpus-worker=' + workerMode + (syncMode ? ' corpus-sync=' + syncMode : '') + (workerModeActive ? ' (gating on syncState===live)' : ''));
		//Anon sessions only ever see published cards, so the readiness floor
		//must track the ACTUAL published ratio the seeder used (the old
		//hardcoded 0.15 guaranteed a timeout for any --published-p below it).
		const effectivePublishedP = publishedP ? parseFloat(publishedP) : 0.05;
		const minCards = authMode === 'admin' ? count : Math.floor(count * effectivePublishedP * 0.8);
		const expectedSyncState = syncMode === 'watermark' ? 'live' : '';
		const state = await waitForCorpus(page, {minCards, timeoutMs: loadTimeoutMs, requireWorkerLive: workerModeActive, expectedSyncState, progressEveryMs: 15000}).catch(e => {
			//Dump the distinct signal lines (not raw last-N, which is dominated by
			//repeating transport errors) so a timeout is diagnosable.
			const signal = consoleMsgs.filter(m => m.startsWith('[error]') || m.includes('[corpus-worker]') || m.includes('reconcil') || m.includes('transport errored'));
			const seen = new Set();
			const distinct = signal.filter(m => { const k = m.replace(/SID=[^ &]+|0x[0-9a-f]+|[0-9.]+ms|[0-9]+ cards/g, ''); if (seen.has(k)) return false; seen.add(k); return true; });
			console.log('[run] distinct signal lines (' + distinct.length + ' of ' + consoleMsgs.length + ' console msgs):\n' + distinct.slice(-40).join('\n'));
			throw e;
		});
		console.log('[run] BOOT OK: mainCards=' + state.cardCount + ' workerCorpus=' + state.workerCorpusSize + ' dataFullyLoaded=' + state.dataFullyLoaded + ' loadComplete=' + state.workerLoadComplete + ' syncState="' + state.syncState + '" user=' + JSON.stringify(state.user));
		if (authMode === 'admin' && (state.cardCount !== count || (workerModeActive && state.workerCorpusSize !== count))) {
			throw new Error(`exact corpus mismatch: seeded=${count} main=${state.cardCount} worker=${state.workerCorpusSize}`);
		}
		let serviceWorkerControlled = false;
		let warmState = null;
		let warmBoot = null;
		if (serviceWorkers === 'allow') {
			await page.waitForFunction(async () => Boolean((await navigator.serviceWorker.getRegistration())?.active), {timeout: 30000});
			const registration = await page.evaluate(async () => {
				const reg = await navigator.serviceWorker.getRegistration();
				const scriptURL = reg?.active?.scriptURL || '';
				const script = scriptURL ? await (await fetch(scriptURL, {cache: 'no-store'})).text() : '';
				return {state: reg?.active?.state || '', scriptURL, productionWorkbox: script.length > 1000 && script.includes('precacheAndRoute')};
			});
			if (registration.state !== 'activated' || !registration.scriptURL.endsWith('/service-worker.js') || !registration.productionWorkbox) {
				throw new Error('wrong service worker artifact: ' + JSON.stringify(registration));
			}
			//The first verified live boot creates the worker-owned compact corpus.
			//Wait for its atomic write before reloading so this is a true warm-boot
			//acceptance test, not merely another Firestore-cache boot.
			if (workerModeActive && syncMode === 'watermark' && authMode === 'admin') {
				await waitForConsoleLine(consoleMsgs, line => line.includes('[corpus-worker] compact snapshot saved:'), 60000);
			}
			const warmLogStart = consoleMsgs.length;
			const warmStartedAt = Date.now();
			await page.reload({waitUntil: 'domcontentloaded'});
			const domContentMs = Date.now() - warmStartedAt;
			await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), {timeout: 30000});
			serviceWorkerControlled = await page.evaluate(() => Boolean(navigator.serviceWorker.controller));
			await page.waitForFunction(() => Boolean(window.PERF_HARNESS), {timeout: 30000});
			await page.waitForFunction(() => {
				try { return Boolean(window.PERF_HARNESS?.activeRawCard()?.id); } catch { return false; }
			}, {timeout: 30000}).catch(async error => {
				const bootState = await page.evaluate(() => window.PERF_HARNESS?.bootState?.()).catch(() => null);
				throw new Error(`${error.message}; warm boot state=${JSON.stringify(bootState)}; console tail=${JSON.stringify(consoleMsgs.slice(-20))}`);
			});
			const usableMs = Date.now() - warmStartedAt;
			warmState = await waitForCorpus(page, {minCards, timeoutMs: loadTimeoutMs, requireWorkerLive: workerModeActive, expectedSyncState, progressEveryMs: 15000});
			warmBoot = {domContentMs, usableMs, liveMs: Date.now() - warmStartedAt};
			const warmLogs = consoleMsgs.slice(warmLogStart);
			const warmPrimeLine = warmLogs.find(m => m.includes('[corpus-worker] watermark prime:')) || '';
			const warmPrimeMatch = warmPrimeLine.match(/watermark prime: ([0-9]+) cards from the (persistent cache|compact snapshot)/);
			const warmCachePrime = Number(warmPrimeMatch?.[1] || 0);
			const warmPrimeSource = warmPrimeMatch?.[2] || '';
			if (workerModeActive && (!warmCachePrime || warmLogs.some(m => m.includes('[corpus-worker] cold corpus')))) {
				throw new Error(`controlled reload did not use the persistent corpus cache: prime=${warmCachePrime} coldSweep=${warmLogs.some(m => m.includes('[corpus-worker] cold corpus'))}`);
			}
			if (workerModeActive && syncMode === 'watermark' && authMode === 'admin' && warmPrimeSource !== 'compact snapshot') {
				throw new Error(`controlled warm reload did not use compact snapshot: ${warmPrimeLine}`);
			}
			if (authMode === 'admin' && (warmState.cardCount !== count || (workerModeActive && warmState.workerCorpusSize !== count))) {
				throw new Error(`service-worker warm corpus mismatch: seeded=${count} main=${warmState.cardCount} worker=${warmState.workerCorpusSize}`);
			}
			console.log('[run] PRODUCTION SERVICE WORKER CONTROLLED + WARM CACHE OK: mainCards=' + warmState.cardCount + ' workerCorpus=' + warmState.workerCorpusSize + ' syncState="' + warmState.syncState + '" cachePrime=' + warmCachePrime + ' source="' + warmPrimeSource + '" timing=' + JSON.stringify(warmBoot));
		}
		const errs = consoleMsgs.filter(m => m.startsWith('[error]'));
		if (errs.length) console.log('[run] console errors (' + errs.length + '): ' + errs.slice(0, 5).join(' | '));
		//The root URL performs a data-dependent canonical navigation. At large
		//corpora it can happen after sync becomes live; starting interactions in
		//that navigation destroys Playwright's execution context and makes the
		//gate flaky. Wait for the app's canonical route first.
		if (new globalThis.URL(page.url()).pathname === '/') {
			await page.waitForFunction(() => window.location.pathname !== '/', {timeout: 30000});
		}

		//Let the worker's one-time post-load collection computation finish before
		//measuring, so it isn't mis-attributed as a per-interaction cost.
		if (workerModeActive) {
			const idle = await waitForWorkerIdle(page);
			console.log('[run] worker settle: ' + JSON.stringify(idle));
			if (!idle.idle) throw new Error('worker did not settle before the measurement window: ' + JSON.stringify(idle));
		}

		if (testMultiEdit) {
			if (authMode !== 'admin') throw new Error('--test-multiedit requires --auth admin');
			console.log(`[run] BULK TAG: add/remove ${multiEditCount} cards with authoritative verification`);
			const result = await page.evaluate(count => window.PERF_HARNESS.bulkTagRoundTrip(count), multiEditCount);
			const refs = result.ids.map(id => verifierDB.collection('cards').doc(id));
			const snapshots = await verifierDB.getAll(...refs);
			for (const snapshot of snapshots) {
				const actual = snapshot.data();
				const expected = result.originals[snapshot.id];
				if (!actual || actual.body !== expected.body || actual.title !== expected.title ||
					JSON.stringify([...(actual.tags || [])].sort()) !== JSON.stringify([...(expected.tags || [])].sort()) ||
					!isDeepStrictEqual(actual.references || {}, expected.references)) {
					throw new Error(`bulk tag round-trip changed non-target state for ${snapshot.id}`);
				}
			}
			const tag = (await verifierDB.collection('tags').doc(result.tag).get()).data();
			const leaked = result.ids.filter(id => (tag?.cards || []).includes(id));
			if (leaked.length) throw new Error(`tag mirror retained ${leaked.length} removed cards`);
			if (result.addMs > 20000 || result.removeMs > 20000) throw new Error(`bulk tag latency exceeded 20s gate: ${JSON.stringify({addMs: result.addMs, removeMs: result.removeMs})}`);
			console.log('[run] BULK TAG OK: ' + JSON.stringify({count: result.ids.length, addMs: +result.addMs.toFixed(1), removeMs: +result.removeMs.toFixed(1)}));
			console.log(`[run] GENERAL MULTI-EDIT: every UI-expressible change round-trip on ${multiEditCount} cards`);
			const general = await page.evaluate(count => window.PERF_HARNESS.durableMultiEditRoundTrip(count), multiEditCount);
			if (general.applyMs > 20000 || general.restoreMs > 20000) throw new Error('general multi-edit exceeded 20s gate: ' + JSON.stringify({applyMs: general.applyMs, restoreMs: general.restoreMs}));
			const generalSnapshots = await verifierDB.getAll(...general.ids.map(id => verifierDB.collection('cards').doc(id)));
			for (const snapshot of generalSnapshots) {
				const actual = snapshot.data();
				const expected = general.originals[snapshot.id];
				const mismatches = !actual ? ['missing'] : [
					actual.body !== expected.body && 'body',
					actual.title !== expected.title && 'title',
					JSON.stringify([...(actual.tags || [])].sort()) !== JSON.stringify([...(expected.tags || [])].sort()) && 'tags',
					!isDeepStrictEqual(actual.references || {}, expected.references) && 'references',
					!isDeepStrictEqual(actual.references_info || {}, expected.references_info) && 'references_info',
					!isDeepStrictEqual(actual.auto_todo_overrides || {}, expected.auto_todo_overrides) && 'auto_todo_overrides',
					actual.published !== expected.published && 'published',
				].filter(Boolean);
				if (mismatches.length) {
					throw new Error(`general multi-edit round-trip changed ${mismatches.join(', ')} for ${snapshot.id}`);
				}
			}
			const generalTagSnapshots = await verifierDB.getAll(...general.tags.map(tag => verifierDB.collection('tags').doc(tag)));
			for (const tagSnapshot of generalTagSnapshots) {
				const mirroredIDs = new Set(tagSnapshot.data()?.cards || []);
				for (const id of general.ids) {
					const expected = (general.originals[id].tags || []).includes(tagSnapshot.id);
					if (mirroredIDs.has(id) !== expected) throw new Error(`general multi-edit tag mirror mismatch for ${tagSnapshot.id}/${id}`);
				}
			}
			// Recovery markers are not a substitute for the application's canonical
			// history. Certify that both halves of the round trip left a card audit
			// and that every tag mirror mutation left its matching tag audit.
			const cardAuditSnapshots = await Promise.all(general.ids.map(id =>
				verifierDB.collection('cards').doc(id).collection('updates').get()));
			for (let i = 0; i < general.ids.length; i++) {
				const id = general.ids[i];
				const audits = cardAuditSnapshots[i].docs.map(snapshot => snapshot.data());
				const apply = audits.find(audit => audit.published === true &&
					isDeepStrictEqual([...(audit.add_tags || [])].sort(), [...general.tags.slice(1)].sort()) &&
					isDeepStrictEqual(audit.remove_tags || [], [general.tags[0]]) &&
					isDeepStrictEqual(audit.auto_todo_overrides_enablements || [], ['prioritized']) &&
					isDeepStrictEqual(audit.auto_todo_overrides_disablements || [], ['prose']) &&
					(audit.references_diff || []).some(diff => diff.cardID === general.referenceTargetID && diff.referenceType === 'generic' && diff.value === ''));
				const restore = audits.find(audit => audit.published === false &&
					isDeepStrictEqual(audit.add_tags || [], [general.tags[0]]) &&
					isDeepStrictEqual([...(audit.remove_tags || [])].sort(), [...general.tags.slice(1)].sort()) &&
					isDeepStrictEqual([...(audit.auto_todo_overrides_removals || [])].sort(), ['prioritized', 'prose']) &&
					(audit.references_diff || []).some(diff => diff.cardID === general.referenceTargetID && diff.referenceType === 'generic' && diff.delete === true));
				if (!apply || !restore || !apply.timestamp || !restore.timestamp) {
					throw new Error(`general multi-edit canonical card audit incomplete for ${id}`);
				}
			}
			const tagAuditSnapshots = await Promise.all(general.tags.map(tag =>
				verifierDB.collection('tags').doc(tag).collection('updates').get()));
			for (let tagIndex = 0; tagIndex < general.tags.length; tagIndex++) {
				const tag = general.tags[tagIndex];
				const audits = tagAuditSnapshots[tagIndex].docs.map(snapshot => snapshot.data());
				for (const id of general.ids) {
					if (!audits.some(audit => audit.add_card === id && audit.timestamp) ||
						!audits.some(audit => audit.remove_card === id && audit.timestamp)) {
						throw new Error(`general multi-edit canonical tag audit incomplete for ${tag}/${id}`);
					}
				}
			}
			console.log('[run] GENERAL MULTI-EDIT OK: ' + JSON.stringify({count: general.count, applyMs: +general.applyMs.toFixed(1), restoreMs: +general.restoreMs.toFixed(1)}));

			// Lost-ack/checkpoint recovery: atomically install a completed chunk +
			// marker, apply a later conflicting edit, then resurrect an old local
			// checkpoint. Resume must trust the marker and NOT replay over the later
			// edit.
			const prepared = await page.evaluate(() => window.PERF_HARNESS.prepareBulkTag(10));
			const operationID = `perf-lost-ack-${Date.now()}`;
			const committed = verifierDB.batch();
			for (const id of prepared.ids) committed.update(verifierDB.collection('cards').doc(id), {
				tags: FieldValue.arrayUnion(prepared.tag), updated: FieldValue.serverTimestamp(),
			});
			committed.update(verifierDB.collection('tags').doc(prepared.tag), {
				cards: FieldValue.arrayUnion(...prepared.ids), updated: FieldValue.serverTimestamp(),
			});
			committed.set(verifierDB.collection('users').doc('perf-admin').collection('multi_edit_chunks').doc(`${operationID}-0`), {
				operation_id: operationID, next_index: prepared.ids.length, modified_count: prepared.ids.length, updated: FieldValue.serverTimestamp(),
			});
			await committed.commit();
			await verifierDB.collection('cards').doc(prepared.ids[0]).update({tags: FieldValue.arrayRemove(prepared.tag), updated: FieldValue.serverTimestamp()});
			await verifierDB.collection('tags').doc(prepared.tag).update({cards: FieldValue.arrayRemove(prepared.ids[0]), updated: FieldValue.serverTimestamp()});
			await page.evaluate(({operationID, prepared}) => {
				localStorage.setItem('card-web-pending-multi-edit-v1', JSON.stringify({
					version: 1, id: operationID, uid: 'perf-admin', targetIDs: prepared.ids,
					nextIndex: 0, modifiedCount: 0, update: {add_tags: [prepared.tag]},
				}));
			}, {operationID, prepared});
			await page.reload({waitUntil: 'domcontentloaded'});
			await page.waitForFunction(() => Boolean(window.PERF_HARNESS), {timeout: 30000});
			await waitForCorpus(page, {minCards, timeoutMs: loadTimeoutMs, requireWorkerLive: workerModeActive, expectedSyncState, progressEveryMs: 15000});
			await page.waitForFunction(() => !localStorage.getItem('card-web-pending-multi-edit-v1'), {timeout: 30000});
			const recovered = await verifierDB.getAll(...prepared.ids.map(id => verifierDB.collection('cards').doc(id)));
			if ((recovered[0].data()?.tags || []).includes(prepared.tag)) throw new Error('lost-ack resume replayed over a later tag removal');
			if (recovered.slice(1).some(doc => !(doc.data()?.tags || []).includes(prepared.tag))) throw new Error('lost-ack committed chunk fixture was incomplete');
			const cleanup = verifierDB.batch();
			for (const id of prepared.ids) cleanup.update(verifierDB.collection('cards').doc(id), {tags: FieldValue.arrayRemove(prepared.tag), updated: FieldValue.serverTimestamp()});
			cleanup.update(verifierDB.collection('tags').doc(prepared.tag), {cards: FieldValue.arrayRemove(...prepared.ids), updated: FieldValue.serverTimestamp()});
			await cleanup.commit();
			console.log('[run] LOST-ACK RESUME OK: server marker prevented replay over a later edit');
		}

		if (testTakeover) {
			if (!workerModeActive) throw new Error('--test-takeover requires --corpus-worker on or shadow');
			console.log('[run] TWO-TAB TAKEOVER: opening contender');
			const oldOwner = page;
			const contender = await context.newPage();
			contender.on('dialog', d => d.accept().catch(() => {}));
			contender.on('console', m => {
				const line = '[tab-b ' + m.type() + '] ' + m.text();
				consoleMsgs.push(line);
				if (m.type() === 'error' || m.text().includes('[corpus-worker]')) console.log('  ' + line.slice(0, 240));
			});
			contender.on('pageerror', error => consoleMsgs.push('[tab-b pageerror] ' + (error.stack || error.message)));
			contender.on('response', r => { if (r.status() >= 400) consoleMsgs.push('[tab-b ' + r.status() + '] ' + r.url().slice(0, 200)); });
			contender.on('requestfailed', r => consoleMsgs.push('[tab-b reqfail] ' + (r.failure()?.errorText || '') + ' ' + r.url().slice(0, 160)));
			await contender.goto(URL, {waitUntil: 'domcontentloaded'});
			await contender.waitForFunction(() => Boolean(window.PERF_HARNESS && window.CORPUS_WORKER), {timeout: 30000});
			if (serviceWorkers === 'allow') await contender.waitForFunction(() => Boolean(navigator.serviceWorker.controller), {timeout: 30000});
			await contender.waitForFunction(() => window.CORPUS_WORKER.ownershipState() === 'contended', {timeout: 30000});
			await contender.bringToFront();
			//Headless Chromium does not emit a window focus event for
			//bringToFront(); dispatch the same event real Chrome emits so the
			//gate's foreground-refocus behavior is exercised deterministically.
			await contender.evaluate(() => window.dispatchEvent(new Event('focus')));
			await contender.waitForFunction(() => document.querySelector('card-web-app')?.shadowRoot?.querySelector('corpus-ownership-gate')?.shadowRoot?.activeElement?.getAttribute('data-testid') === 'corpus-use-this-tab');
			await contender.keyboard.press('Tab');
			if (!await contender.evaluate(() => document.querySelector('card-web-app')?.shadowRoot?.querySelector('corpus-ownership-gate')?.shadowRoot?.activeElement?.getAttribute('data-testid') === 'corpus-use-this-tab')) throw new Error('ownership gate did not contain forward Tab focus on its CTA');
			await contender.keyboard.press('Shift+Tab');
			if (!await contender.evaluate(() => document.querySelector('card-web-app')?.shadowRoot?.querySelector('corpus-ownership-gate')?.shadowRoot?.activeElement?.getAttribute('data-testid') === 'corpus-use-this-tab')) throw new Error('ownership gate did not contain reverse Tab focus on its CTA');
			const blocked = await contender.evaluate(async () => {
				const locks = await navigator.locks.query();
				const appRoot = document.querySelector('card-web-app')?.shadowRoot;
				const gate = appRoot?.querySelector('corpus-ownership-gate');
				const button = gate?.shadowRoot?.querySelector('[data-testid="corpus-use-this-tab"]');
				const panel = gate?.shadowRoot?.querySelector('.panel');
				return {state: window.CORPUS_WORKER.ownershipState(), workerRunning: window.CORPUS_WORKER.workerRunning(), held: locks.held?.filter(lock => lock.name === 'corpus-worker-owner').length || 0, gateOpen: gate?.hasAttribute('open'), button: Boolean(button), focusablePanel: panel?.getAttribute('tabindex') === '-1', backgroundInert: Boolean(appRoot && [...appRoot.children].filter(child => child !== gate).every(child => child.inert))};
			});
			if (blocked.state !== 'contended' || blocked.workerRunning || blocked.held !== 1 || !blocked.gateOpen || !blocked.button || !blocked.focusablePanel || !blocked.backgroundInert) throw new Error('second tab was not safely blocked: ' + JSON.stringify(blocked));
			const clickUseThisTab = pageToClick => pageToClick.getByRole('button', {name: 'Use this tab', exact: true}).click();
			const pressUseThisTab = pageToPress => pageToPress.keyboard.press('Enter');

			//An active edit is a deliberate veto: takeover must never discard it.
			await oldOwner.evaluate(() => window.PERF_HARNESS.startEditingContent());
			await oldOwner.waitForFunction(() => Boolean(window.DEBUG_STORE.getState().editor?.editing));
			const dirtyMarker = `takeover-draft-${Date.now()}`;
			await oldOwner.evaluate(marker => window.PERF_HARNESS.dirtyEditingBody(marker), dirtyMarker);
			await pressUseThisTab(contender);
			await contender.waitForFunction(() => window.DEBUG_STORE.getState().data?.corpusStatus === 'contended' && /unsaved edit/.test(window.DEBUG_STORE.getState().data?.corpusStatusMessage || ''), {timeout: 10000});
			if (!await oldOwner.evaluate(() => Boolean(window.CORPUS_WORKER.workerRunning()))) throw new Error('dirty-edit denial displaced the owner');
			if (!await oldOwner.evaluate(marker => window.DEBUG_STORE.getState().editor?.card?.body?.includes(marker), dirtyMarker)) throw new Error('dirty-edit denial did not preserve the draft');
			await oldOwner.evaluate(() => window.PERF_HARNESS.finishEditing());

			await clickUseThisTab(contender);
			await contender.waitForFunction(() => window.CORPUS_WORKER.ownershipState() === 'active', {timeout: 20000});
			await oldOwner.waitForFunction(() => window.CORPUS_WORKER.ownershipState() === 'inactive' && !window.CORPUS_WORKER.workerRunning() && Object.keys(window.DEBUG_STORE.getState().data?.cards || {}).length === 0, {timeout: 10000});
			const takeoverState = await waitForCorpus(contender, {minCards, timeoutMs: loadTimeoutMs, requireWorkerLive: true, expectedSyncState, progressEveryMs: 15000});
			if (authMode === 'admin' && (takeoverState.cardCount !== count || takeoverState.workerCorpusSize !== count)) throw new Error('takeover corpus mismatch: ' + JSON.stringify(takeoverState));
			const contenderOwnerLogs = consoleMsgs.filter(line => line.startsWith('[tab-b '));
			if (!contenderOwnerLogs.some(line => line.includes('watermark prime:')) || contenderOwnerLogs.some(line => line.includes('cold corpus'))) throw new Error('takeover did not use the persistent warm corpus');
			const ownership = await contender.evaluate(async () => {
				const locks = await navigator.locks.query();
				return {held: locks.held?.filter(lock => lock.name === 'corpus-worker-owner').length || 0, pending: locks.pending?.filter(lock => lock.name === 'corpus-worker-owner').length || 0};
			});
			if (ownership.held !== 1 || ownership.pending !== 0) throw new Error('takeover left invalid lock state: ' + JSON.stringify(ownership));
			console.log('[run] TWO-TAB TAKEOVER OK: dirty edit preserved; old owner purged; new owner exact + live; lock=' + JSON.stringify(ownership));
			await oldOwner.reload({waitUntil: 'domcontentloaded'});
			await oldOwner.waitForFunction(() => window.CORPUS_WORKER?.ownershipState() === 'inactive' && !window.CORPUS_WORKER.workerRunning(), {timeout: 30000});
			if (serviceWorkers === 'allow') await oldOwner.waitForFunction(() => Boolean(navigator.serviceWorker.controller), {timeout: 30000});
			console.log('[run] SUPERSEDED RELOAD OK: old tab remained inactive + workerless');

			//A live tab can be suspended by Chrome so completely that it cannot answer
			//the cooperative BroadcastChannel request. Freeze the current owner through
			//CDP and prove the contender can replace its stale, explicitly-safe lease.
			//When Chrome resumes the old tab, the synchronously-published ownership epoch
			//must fence and purge it before it can mutate anything.
			const frozenOwnerSession = await context.newCDPSession(contender);
			await frozenOwnerSession.send('Page.setWebLifecycleState', {state: 'frozen'});
			await oldOwner.evaluate(() => window.CORPUS_WORKER.takeOver());
			await oldOwner.waitForFunction(() => window.CORPUS_WORKER.ownershipState() === 'active', {timeout: FROZEN_OWNER_TAKEOVER_TIMEOUT_MS});
			await frozenOwnerSession.send('Page.setWebLifecycleState', {state: 'active'});
			await contender.waitForFunction(() => window.CORPUS_WORKER.ownershipState() === 'inactive' && !window.CORPUS_WORKER.workerRunning() && Object.keys(window.DEBUG_STORE.getState().data?.cards || {}).length === 0, {timeout: 10000});
			const frozenTakeoverState = await waitForCorpus(oldOwner, {minCards, timeoutMs: loadTimeoutMs, requireWorkerLive: true, expectedSyncState});
			if (authMode === 'admin' && (frozenTakeoverState.cardCount !== count || frozenTakeoverState.workerCorpusSize !== count)) throw new Error('frozen-owner takeover corpus mismatch: ' + JSON.stringify(frozenTakeoverState));
			console.log('[run] FROZEN OWNER TAKEOVER OK: stale clean lease stolen; resumed owner fenced + purged');

			//Two simultaneous requesters must not both start workers. The owner
			//grants one request and explicitly rejects the other as busy.
			const racers = await Promise.all([context.newPage(), context.newPage()]);
			for (const [index, racer] of racers.entries()) {
				racer.on('dialog', d => d.accept().catch(() => {}));
				racer.on('console', m => consoleMsgs.push(`[tab-racer-${index} ${m.type()}] ` + m.text()));
				racer.on('pageerror', error => consoleMsgs.push(`[tab-racer-${index} pageerror] ` + (error.stack || error.message)));
				racer.on('response', r => { if (r.status() >= 400) consoleMsgs.push(`[tab-racer-${index} ${r.status()}] ` + r.url().slice(0, 200)); });
				racer.on('requestfailed', r => consoleMsgs.push(`[tab-racer-${index} reqfail] ` + (r.failure()?.errorText || '') + ' ' + r.url().slice(0, 160)));
				await racer.goto(URL, {waitUntil: 'domcontentloaded'});
				if (serviceWorkers === 'allow') await racer.waitForFunction(() => Boolean(navigator.serviceWorker.controller), {timeout: 30000});
			}
			await Promise.all(racers.map(racer => racer.waitForFunction(() => window.CORPUS_WORKER?.ownershipState() === 'contended', {timeout: 30000})));
			await Promise.all(racers.map(racer => racer.evaluate(() => window.CORPUS_WORKER.takeOver())));
			const raceDeadline = Date.now() + 20000;
			let raceStates = [];
			while (Date.now() < raceDeadline) {
				raceStates = await Promise.all(racers.map(racer => racer.evaluate(() => ({state: window.CORPUS_WORKER.ownershipState(), running: window.CORPUS_WORKER.workerRunning()}))));
				if (raceStates.filter(value => value.state === 'active').length === 1 && raceStates.filter(value => value.state === 'contended').length === 1) break;
				await new Promise(resolve => setTimeout(resolve, 100));
			}
			if (raceStates.filter(value => value.state === 'active').length !== 1 || raceStates.filter(value => value.state === 'contended').length !== 1) throw new Error('simultaneous takeover did not select exactly one winner: ' + JSON.stringify(raceStates));
			if (raceStates.find(value => value.state === 'contended')?.running) throw new Error('losing simultaneous contender started a worker');
			await oldOwner.waitForFunction(() => window.CORPUS_WORKER.ownershipState() === 'inactive' && !window.CORPUS_WORKER.workerRunning(), {timeout: 10000});
			const raceWinnerIndex = raceStates.findIndex(value => value.state === 'active');
			const raceLoserIndex = raceWinnerIndex === 0 ? 1 : 0;
			const raceWinner = racers[raceWinnerIndex];
			const raceLoser = racers[raceLoserIndex];
			const raceWinnerState = await waitForCorpus(raceWinner, {minCards, timeoutMs: loadTimeoutMs, requireWorkerLive: true, expectedSyncState});
			if (authMode === 'admin' && (raceWinnerState.cardCount !== count || raceWinnerState.workerCorpusSize !== count)) throw new Error('simultaneous winner corpus mismatch: ' + JSON.stringify(raceWinnerState));
			const raceWinnerLogs = consoleMsgs.filter(line => line.startsWith(`[tab-racer-${raceWinnerIndex} `));
			if (!raceWinnerLogs.some(line => line.includes('watermark prime:')) || raceWinnerLogs.some(line => line.includes('cold corpus'))) throw new Error('simultaneous winner did not use the persistent warm corpus');
			console.log('[run] SIMULTANEOUS TAKEOVER OK: exactly one winner; loser workerless');

			//A dead owner cannot cooperate, so the remaining contender must be able
			//to acquire the automatically released Web Lock directly.
			await raceWinner.close();
			await raceLoser.evaluate(() => window.CORPUS_WORKER.takeOver());
			await raceLoser.waitForFunction(() => window.CORPUS_WORKER.ownershipState() === 'active', {timeout: 20000});
			const crashRecoveryState = await waitForCorpus(raceLoser, {minCards, timeoutMs: loadTimeoutMs, requireWorkerLive: true, expectedSyncState});
			if (authMode === 'admin' && (crashRecoveryState.cardCount !== count || crashRecoveryState.workerCorpusSize !== count)) throw new Error('crash recovery corpus mismatch: ' + JSON.stringify(crashRecoveryState));
			const crashRecoveryLogs = consoleMsgs.filter(line => line.startsWith(`[tab-racer-${raceLoserIndex} `));
			if (!crashRecoveryLogs.some(line => line.includes('watermark prime:')) || crashRecoveryLogs.some(line => line.includes('cold corpus'))) throw new Error('crash recovery did not use the persistent warm corpus');
			page = raceLoser;
			console.log('[run] OWNER CRASH RECOVERY OK: surviving contender acquired directly and recovered exact corpus');
			takeoverScenariosPassed = true;
			const idle = await waitForWorkerIdle(page);
			if (!idle.idle) throw new Error('takeover worker did not settle: ' + JSON.stringify(idle));
		}

		//The Appendix-A interaction script needs an editable card (admin).
		if (authMode === 'admin') {
			//Let the background recall build finish first: on the emulator its
			//worker contention (plus CORS-failing similarity retries) otherwise
			//delays the just-committed card's echo past the readback window —
			//a measurement artifact, not a product latency (real infra doesn't
			//race a cold 28s index build during the same interaction).
			const recallReady = await waitForSearchRecallReady(page);
			if (!recallReady.ready) console.log('[run] WARN: search recall not ready before interactions; timings may be noisy');
			const idleBeforeInteractions = await waitForWorkerIdle(page);
			if (!idleBeforeInteractions.idle) console.log('[run] WARN: worker not idle before interactions');
			const results = await runInteractions(page, {keystrokes: 30}).catch(e => {
				console.log('[run] interactions failed. url=' + page.url() + '\ntail:\n' + consoleMsgs.slice(-18).join('\n'));
				throw e;
			});
			const persistedBody = await readEmulatorCardBody(results.committedCard.id);
			results.commitPersistence = {
				cardID: results.committedCard.id,
				exactBodyMatch: persistedBody === results.committedCard.expectedBody,
			};
			const baseline = {
				count, seed, authMode, workerMode, syncMode: syncMode || '(default)', serviceWorkers, serviceWorkerControlled, testTakeover, cardCount: state.cardCount, syncState: state.syncState, warmCardCount: warmState?.cardCount ?? null, warmBoot, results,
				passed: !(args.includes('--assert') || args.includes('--assert-budgets')),
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

			//--assert: the gate half the README promises. Deterministic
			//counter invariants FAIL the run (exit 1); wall-clock budgets
			//are reported as breaches but only fail under --assert-budgets
			//(hardware variance makes them advisory on shared machines).
			if (args.includes('--assert') || args.includes('--assert-budgets')) {
				const failures = [];
				const advisories = [];
				const counters = results.counters || {};
				//The local harness intentionally does not emulate callable Functions;
				//the app's optional legal/similarity probes therefore produce a CORS
				//line, Chrome's generic ERR_FAILED companion, and the Functions SDK's
				//generic `internal` rejection. Analytics may also originate in the
				//service worker outside context routing. Keep these exact known local
				//misses out of the sync/runtime gate.
				const normalizedBrowserMessage = m => m.replace(/^\[tab-[^ ]+ /, '[');
				const knownEmulatorFunctionMiss = raw => {
					const m = normalizedBrowserMessage(raw);
					return m.includes('us-central1-demo-perf.cloudfunctions.net') ||
						m === '[error] Failed to load resource: net::ERR_FAILED' ||
						m === '[pageerror] internal' ||
						(takeoverScenariosPassed && m.startsWith('[error] [') && m.includes('@firebase/firestore: Firestore (10.11.0): Could not reach Cloud Firestore backend. Backend didn\'t respond within 10 seconds.')) ||
						(m.startsWith('[reqfail]') && m.includes('www.google-analytics.com/g/collect')) ||
						(serviceWorkerControlled && m.startsWith('[reqfail] net::ERR_ABORTED ') && m.includes('/google.firestore.v1.Firestore/Listen/channel?')) ||
						(results.commitPersistence.exactBodyMatch && m.startsWith('[reqfail] net::ERR_ABORTED ') && m.includes('/google.firestore.v1.Firestore/Write/channel?'));
				};
				//The Firestore emulator occasionally rejects the first Listen WebChannel
				//with one 400 while it finishes coming up. Treat that exact, one-attempt
				//bootstrap triplet as recovered only after BOTH cold and controlled-warm
				//passes reached exact/live state; real endpoints and repeated failures
				//remain fatal.
				const exactWarmRecovery = serviceWorkerControlled && warmState?.cardCount === count && warmState?.workerCorpusSize === count && warmState?.syncState === expectedSyncState;
				const recoveredEmulatorBootstrap = raw => { const m = normalizedBrowserMessage(raw); return exactWarmRecovery && (
					(/^\[400\] http:\/\/localhost:8089\/google\.firestore\.v1\.Firestore\/Listen\/channel\?/.test(m)) ||
					m === '[error] Failed to load resource: the server responded with a status of 400 (Bad Request)' ||
					(m.startsWith('[error] [') && m.includes('@firebase/firestore: Firestore (10.11.0): Could not reach Cloud Firestore backend. Connection failed 1 times.'))
				); };
				const unexpectedRuntimeErrors = consoleMsgs.filter(m => {
					const normalized = normalizedBrowserMessage(m);
					return !knownEmulatorFunctionMiss(m) && !recoveredEmulatorBootstrap(m) && (normalized.startsWith('[error]') || normalized.startsWith('[pageerror]') || /^\[[45][0-9][0-9]\]/.test(normalized) || normalized.startsWith('[reqfail]') || normalized.startsWith('[warning] [corpus-worker]'));
				});
				if (unexpectedRuntimeErrors.length) failures.push(`browser emitted ${unexpectedRuntimeErrors.length} console/network errors: ${unexpectedRuntimeErrors.slice(0, 3).join(' | ')}`);
				const requiredSamples = {nav: 20, keystroke: 30, editorOpen: 1, commit: 1, find: 1};
				if (serviceWorkers === 'allow' && !serviceWorkerControlled) failures.push('service worker was allowed but did not control the measured page');
				if (!results.commitPersistence.exactBodyMatch) failures.push(`committed body for ${results.commitPersistence.cardID} did not exactly match the authoritative emulator document`);
				for (const [metric, minimum] of Object.entries(requiredSamples)) {
					const count = results.wall?.[metric]?.n ?? 0;
					if (count < minimum) failures.push(`${metric} produced ${count} samples (expected at least ${minimum})`);
				}
				//Nav in a settled session must not refilter when membership
				//is unchanged: every makeFilterFromCards call that changes
				//zero maps was pure waste. changedMaps > 0 across the whole
				//interaction script is expected (the commit legitimately
				//changes membership); calls with NO corresponding membership
				//change are the regression this invariant pins. We assert
				//the coarse form the counters support: calls must be small
				//and bounded (each corresponds to a real card-batch apply),
				//not once-per-navigation.
				const filterCalls = counters['makeFilterFromCards:calls'] ?? 0;
				const NAV_PRESSES = 20; //interactions.js drives 20 arrow presses
				if (filterCalls > 6) {
					failures.push(`makeFilterFromCards ran ${filterCalls}x across the script (expected <=6: card batches only, never per-navigation over ${NAV_PRESSES} presses)`);
				}
				const collectionFilterMax = results.mainWork?.collectionFilter?.maxMs ?? 0;
				//Duration is hardware/scheduling-sensitive (and the editing-card
				//variant intentionally stays local), so keep this visible without
				//misclassifying it as a deterministic correctness invariant.
				if (collectionFilterMax > 100) advisories.push(`main-thread collection filtering max=${collectionFilterMax}ms exceeds 100ms`);
				//Wall-clock budgets (Appendix A), advisory by default.
				//Find deliberately includes its 250ms query debounce. Editor-open is a
				//secondary first-use affordance; the acceptance-critical interaction
				//budgets are navigation, typing, and perceived save.
				const budgets = [['nav', 16], ['keystroke', 16], ['commit', 1000], ['editorOpen', 1500], ['find', 350]];
				for (const [metric, budgetMs] of budgets) {
					const wall = results.wall?.[metric];
					if (wall && typeof wall.p95 === 'number' && wall.p95 > budgetMs) {
						advisories.push(`${metric} p95=${wall.p95}ms exceeds ${budgetMs}ms budget`);
					}
				}
				if ((results.wall?.nav?.max ?? 0) > 50) advisories.push(`nav max=${results.wall.nav.max}ms exceeds 50ms worst-case budget`);
				if ((results.wall?.keystroke?.max ?? 0) > 50) advisories.push(`keystroke max=${results.wall.keystroke.max}ms exceeds 50ms long-task budget`);
				if (warmBoot?.usableMs > 10000) advisories.push(`warm usable=${warmBoot.usableMs}ms exceeds 10000ms budget`);
				if (warmBoot?.liveMs > 15000) advisories.push(`warm live=${warmBoot.liveMs}ms exceeds 15000ms budget`);
				if (advisories.length) {
					console.log('[run] BUDGET BREACHES (advisory' + (args.includes('--assert-budgets') ? ', FAILING per --assert-budgets' : '') + '):\n  ' + advisories.join('\n  '));
					if (args.includes('--assert-budgets')) failures.push(...advisories);
				}
				if (failures.length) {
					baseline.passed = false;
					baseline.failures = failures;
					fs.writeFileSync(outPath, JSON.stringify(baseline, null, 2));
					console.error('[run] ASSERT FAILED:\n  ' + failures.join('\n  '));
					process.exitCode = 1;
				} else {
					baseline.passed = true;
					fs.writeFileSync(outPath, JSON.stringify(baseline, null, 2));
					console.log('[run] ASSERT OK (counter invariants' + (args.includes('--assert-budgets') ? ' + budgets' : '') + ')');
				}
			}
		}

		await browser.close();
	} finally {
		cleanup();
	}
};

main().then(() => process.exit(process.exitCode || 0)).catch(err => { console.error('[run] FAILED:', err); process.exit(1); });

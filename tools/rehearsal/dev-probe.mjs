/*eslint-env node, es2022*/
//Anonymous probe of a DEPLOYED build (DEV by default): the half of the
//cutover rehearsal that needs no sign-in. Boots a fresh browser profile
//twice (cold, then warm from the persisted snapshot), and reports
//time-to-live, card counts, console errors, the deploy stamp, and the
//persisted snapshot records — in particular that the SHARED published record
//carries NO displayTitles (they are viewer-specific; a non-privileged
//author's titles once leaked through it). Reads only; never signs in.
//
//  node tools/rehearsal/dev-probe.mjs [--origin https://dev-complexity-compendium.web.app] [--out probe.json] [--settle-ms 40000]
import {chromium} from 'playwright';
import fs from 'fs';

const arg = (name, fallback) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : fallback; };
const origin = arg('origin', 'https://dev-complexity-compendium.web.app');
const out = arg('out', '');
const settleMs = parseInt(arg('settle-ms', '40000'), 10);
const liveTimeoutMs = parseInt(arg('live-timeout-ms', String(10 * 60 * 1000)), 10);

const readSnapshots = () => new Promise(res => {
	const rq = indexedDB.open('corpus-worker-snapshot');
	rq.onerror = () => res({err: String(rq.error)});
	rq.onsuccess = () => {
		const db = rq.result;
		if (!db.objectStoreNames.contains('snapshots')) { res([]); return; }
		const st = db.transaction('snapshots', 'readonly').objectStore('snapshots');
		const rows = [];
		const c = st.openCursor();
		c.onsuccess = () => {
			const cur = c.result;
			if (!cur) { res(rows); return; }
			const v = cur.value || {};
			rows.push({key: String(cur.key), schemaVersion: v.schemaVersion, cards: v.cards ? Object.keys(v.cards).length : null, displayTitles: v.displayTitles ? Object.keys(v.displayTitles).length : 0, savedAt: v.savedAt || null});
			cur.continue();
		};
	};
});

const bootOnce = async (context, label) => {
	const page = await context.newPage();
	const consoleErrors = [];
	const workerLines = [];
	page.on('console', m => {
		const text = m.text();
		if (m.type() === 'error' && !/cloudfunctions\.net\/legal|ERR_FAILED/.test(text)) consoleErrors.push(text.slice(0, 300));
		if (/\[corpus-worker\]/.test(text) && /boot to live|sync state|display titles warm|compact snapshot|fingerprints warm|idf epoch/.test(text)) workerLines.push(text.slice(0, 220));
	});
	page.on('pageerror', e => consoleErrors.push('pageerror: ' + String(e).slice(0, 300)));
	const t0 = Date.now();
	await page.goto(origin + '/', {waitUntil: 'domcontentloaded'});
	//Builds before DEBUG_STORE was exposed (the August 2026 DEV deploy) get
	//a DOM-only read: rows rendered, plus the persisted records below.
	let storeAvailable = true;
	try {
		await page.waitForFunction(() => Boolean(window.DEBUG_STORE), null, {timeout: 45000});
	} catch {
		storeAvailable = false;
	}
	let live = false;
	if (storeAvailable) {
		try {
			await page.waitForFunction(() => { const s = window.DEBUG_STORE.getState(); return s.data && s.data.corpusStatus === 'live'; }, null, {timeout: liveTimeoutMs, polling: 250});
			live = true;
		} catch { /* reported below */ }
	} else {
		try {
			await page.waitForFunction(() => { const walk = root => { for (const el of root.querySelectorAll('*')) { if (el.tagName === 'CARD-THUMBNAIL-LIST' && el.shadowRoot && el.shadowRoot.querySelector('.thumbnail[data-card]')) return true; if (el.shadowRoot && walk(el.shadowRoot)) return true; } return false; }; return walk(document); }, null, {timeout: liveTimeoutMs, polling: 500});
			live = true;
		} catch { /* reported below */ }
	}
	const liveMs = Date.now() - t0;
	const state = storeAvailable
		? await page.evaluate(() => { const s = window.DEBUG_STORE.getState(); return {corpusStatus: s.data.corpusStatus, corpusStatusMessage: s.data.corpusStatusMessage, cards: Object.keys(s.data.cards).length, corpusSize: s.data.corpusSize, uid: s.user && s.user.user ? s.user.user.uid : null, anonymous: s.user && s.user.user ? s.user.user.isAnonymous : null, sections: Object.keys(s.data.sections || {}).length, tags: Object.keys(s.data.tags || {}).length}; })
		: await page.evaluate(() => { let rows = 0; const walk = root => { for (const el of root.querySelectorAll('*')) { if (el.tagName === 'CARD-THUMBNAIL-LIST' && el.shadowRoot) rows += el.shadowRoot.querySelectorAll('.thumbnail[data-card]').length; if (el.shadowRoot) walk(el.shadowRoot); } }; walk(document); return {storeAvailable: false, renderedRows: rows}; });
	//Let the debounced snapshot save land before reading IndexedDB.
	await page.waitForTimeout(settleMs);
	const snapshots = await page.evaluate(readSnapshots);
	const result = {label, storeAvailable, live, liveMs, ...state, snapshots, consoleErrors, workerLines};
	await page.close();
	return result;
};

const main = async () => {
	const stamp = await fetch(origin + '/deploy-stamp.json').then(r => r.json()).catch(e => ({err: String(e)}));
	const browser = await chromium.launch();
	const context = await browser.newContext();
	//DEBUG_STORE is gated on the perf flag in every build; set it before the
	//app's first script runs, as DEBUG_PERF.enable() would.
	await context.addInitScript(() => { try { localStorage.setItem('debug-perf', '1'); } catch { /* storage blocked */ } });
	const cold = await bootOnce(context, 'cold');
	const warm = await bootOnce(context, 'warm');
	await browser.close();
	const publishedRecords = [...cold.snapshots, ...warm.snapshots].filter(r => /:published$/.test(r.key));
	const verdicts = {
		coldLive: cold.live,
		warmLive: warm.live,
		warmFasterThanCold: warm.live && cold.live && warm.liveMs < cold.liveMs,
		publishedRecordPresent: publishedRecords.length > 0,
		publishedRecordHasNoTitles: publishedRecords.every(r => !r.displayTitles),
		noConsoleErrors: cold.consoleErrors.length === 0 && warm.consoleErrors.length === 0,
	};
	const report = {origin, probedAt: new Date().toISOString(), stamp, cold, warm, verdicts};
	const text = JSON.stringify(report, null, 2);
	if (out) fs.writeFileSync(out, text);
	console.log(text);
	process.exit(Object.values(verdicts).every(Boolean) ? 0 : 2);
};
main().catch(e => { console.error('PROBE FAILED', e); process.exit(1); });

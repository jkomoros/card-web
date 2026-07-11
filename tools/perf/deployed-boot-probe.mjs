//Landing validation: watermark-mode boot on real dev. Captures the sync
//lifecycle (prime → tombstone catch-up → trust gate → cold sweep OR delta →
//loadComplete → syncState live) and BOUNDS billed reads from console
//evidence. Long window so a resumed cold sweep can complete.
import {chromium} from 'playwright';

const PROFILE = '/private/tmp/claude-501/-Users-jkomoros-Code-card-web/5580af71-bc1a-4828-a369-4fca04fef69c/scratchpad/perf-profile';

const log = (...parts) => console.log('[land]', ...parts);

const run = async () => {
	const context = await chromium.launchPersistentContext(PROFILE, {
		headless: false,
		viewport: {width: 1380, height: 900},
		executablePath: '/Users/jkomoros/Library/Caches/ms-playwright/chromium-1223/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
	});
	const page = context.pages()[0] || await context.newPage();
	await page.addInitScript(() => {
		try {
			window.localStorage.setItem('corpus-worker', 'on');
			window.localStorage.setItem('corpus-sync', 'watermark');
		} catch {
			//Best effort
		}
	});
	page.on('dialog', dialog => {
		log(`DIALOG: ${dialog.message().slice(0, 120)} - accepting`);
		dialog.accept().catch(() => {});
	});
	const t0 = Date.now();
	let sweepPages = 0;
	let done = false;
	page.on('console', message => {
		const text = message.text();
		if (text.includes('cold sweep') && text.includes('page')) sweepPages++;
		if (/(trust gate|watermark|sync state|cold|tombstone|load complete|delta|reconciliation|resource-exhausted)/.test(text) || message.type() === 'error') {
			console.log(`[console +${((Date.now() - t0) / 1000).toFixed(0)}s]`, text.slice(0, 240));
		}
		if (text.includes('sync state: live')) done = true;
	});
	page.on('pageerror', error => log('pageerror:', String(error).slice(0, 200)));

	log('loading…');
	await page.goto('https://dev-complexity-compendium.web.app/c/working-notes/', {waitUntil: 'domcontentloaded'});

	for (let i = 0; i < 80; i++) {
		await page.waitForTimeout(30000);
		const snapshot = await page.evaluate(() => {
			const state = window.DEBUG_STORE?.getState?.();
			if (!state) return null;
			return {
				email: state.user?.user?.email || null,
				cards: Object.keys(state.data?.cards || {}).length,
				activeCardID: state.collection?.activeCardID || null,
			};
		}).catch(() => null);
		log(`+${(i + 1) * 30}s`, JSON.stringify(snapshot), `sweepPages=${sweepPages}`);
		if (done && i > 2) {
			log('sync state LIVE reached — success');
			break;
		}
	}

	await context.close();
	log('DONE');
};

run().catch(error => {
	console.error('[land] FAILED', error);
	process.exit(1);
});

/*eslint-env node, es2022*/

//Capture a V8 heap snapshot from a running Compendium tab over CDP, and print
//the post-GC heap size alongside it so the snapshot can be trusted as a
//measurement rather than just a dump.
//
//  1. Start Chrome with a debugging port and a dedicated profile:
//       "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
//         --remote-debugging-port=9222 --user-data-dir=/tmp/compendium-debug
//     Sign in in that window.
//  2. node tools/capture-heap-snapshot.mjs <url> <out.heapsnapshot> [boots]
//  3. node --max-old-space-size=6144 tools/heap-snapshot-report.mjs <out.heapsnapshot>
//
//`boots` (default 1) re-navigates that many times before snapshotting, which is
//how a "does a long session accumulate" question gets asked. RESTART CHROME
//between comparison runs: a browser that has had CDP sessions attached for a
//long stretch does NOT give a comparable number, and mistaking that for
//application growth is exactly the trap this file exists to help avoid. Notably
//a `page.on('console')` listener retains its arguments' remote objects for the
//life of the session, so instrumentation itself can inflate the heap.

import {createRequire} from 'module';
import fs from 'fs';

const require = createRequire(new URL('../package.json', import.meta.url));
const {chromium} = require('playwright');

const [url, outPath, bootsArg] = process.argv.slice(2);
if (!url || !outPath) {
	console.error('usage: node tools/capture-heap-snapshot.mjs <url> <out.heapsnapshot> [boots]');
	process.exit(1);
}
const boots = Number(bootsArg || 1);

const mb = (bytes) => Math.round(bytes / 1048576);

const browser = await chromium.connectOverCDP('http://localhost:9222', {timeout: 180000});
const pages = browser.contexts()[0].pages();
const page = pages.find(p => p.url().includes(new URL(url).host)) || pages[0];
page.setDefaultTimeout(120000);
const cdp = await page.context().newCDPSession(page);

for (let i = 0; i < boots; i++) {
	await page.goto(url, {waitUntil: 'commit'});
	await page.waitForFunction(() => Boolean(window.DEBUG_STORE) && window.CORPUS_WORKER?.loadComplete?.(), {timeout: 600000});
	await page.waitForFunction(() => window.CORPUS_WORKER?.syncState?.() === 'live', {timeout: 600000});
}

//Twice, with a gap: one collection leaves recently-dead objects uncollected.
await cdp.send('HeapProfiler.collectGarbage');
await page.waitForTimeout(2000);
await cdp.send('HeapProfiler.collectGarbage');
const {usedSize} = await cdp.send('Runtime.getHeapUsage');
const corpus = await page.evaluate(() => Object.keys(window.DEBUG_STORE.getState().data.cards).length);
console.log(`heap after ${boots} boot(s), post-GC = ${mb(usedSize)}MB, corpus = ${corpus}`);

const out = fs.createWriteStream(outPath);
let bytes = 0;
cdp.on('HeapProfiler.addHeapSnapshotChunk', ({chunk}) => { bytes += chunk.length; out.write(chunk); });
await cdp.send('HeapProfiler.takeHeapSnapshot', {reportProgress: false, captureNumericValue: false, treatGlobalObjectsAsRoots: true});
await new Promise(resolve => out.end(resolve));
console.log(`snapshot written: ${mb(bytes)}MB -> ${outPath}`);

await browser.close();

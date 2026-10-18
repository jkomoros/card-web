/*eslint-env node*/

//Tests for the pure watermark logic underpinning the delta sync.

import assert from 'assert';
import {readFileSync} from 'fs';

let deriveWatermark;
let advanceWatermark;
let watermarkQueryBound;
let compareTimestamps;
let WATERMARK_MARGIN_SECONDS;
let deltaWindowRoute;
let DELTA_WINDOW_MAX_DOCS;

const ts = (seconds, nanoseconds = 0) => ({seconds, nanoseconds});

describe('watermark', () => {
	before(async () => {
		({deriveWatermark, advanceWatermark, watermarkQueryBound, compareTimestamps, WATERMARK_MARGIN_SECONDS, deltaWindowRoute, DELTA_WINDOW_MAX_DOCS} = await import('../../lib/src/worker/watermark.js'));
	});

	it('derives the max updated across cards', () => {
		assert.deepStrictEqual(deriveWatermark([ts(10), ts(30, 5), ts(30, 2), ts(20)]), ts(30, 5));
	});

	it('derive ignores missing/malformed values and returns null when empty', () => {
		assert.strictEqual(deriveWatermark([]), null);
		assert.strictEqual(deriveWatermark([null, undefined, {}]), null);
		assert.deepStrictEqual(deriveWatermark([null, ts(7), undefined]), ts(7));
	});

	it('advance only moves forward', () => {
		let watermark = null;
		watermark = advanceWatermark(watermark, ts(10));
		assert.deepStrictEqual(watermark, ts(10));
		//An older candidate (e.g. a re-delivered doc) never regresses it.
		watermark = advanceWatermark(watermark, ts(5));
		assert.deepStrictEqual(watermark, ts(10));
		//Nanosecond-level ordering respected.
		watermark = advanceWatermark(watermark, ts(10, 1));
		assert.deepStrictEqual(watermark, ts(10, 1));
		//Garbage never advances (echo cards without server timestamps).
		watermark = advanceWatermark(watermark, undefined);
		watermark = advanceWatermark(watermark, {});
		assert.deepStrictEqual(watermark, ts(10, 1));
	});

	it('query bound subtracts the margin, floored at epoch', () => {
		const bound = watermarkQueryBound(ts(1000000, 42));
		assert.deepStrictEqual(bound, ts(1000000 - WATERMARK_MARGIN_SECONDS, 42));
		assert.strictEqual(watermarkQueryBound(ts(10)).seconds, 0);
	});

	it('compareTimestamps orders seconds then nanoseconds', () => {
		assert.ok(compareTimestamps(ts(2), ts(1)) > 0);
		assert.ok(compareTimestamps(ts(1, 5), ts(1, 9)) < 0);
		assert.strictEqual(compareTimestamps(ts(1, 5), ts(1, 5)), 0);
	});

	it('routes an oversized delta window to the budgeted sweep, once per generation', () => {
		//#786: one listener over tens of thousands of docs is a memory burst
		//the owner's tab did not survive, and a query Firestore refuses.
		assert.strictEqual(deltaWindowRoute(3, DELTA_WINDOW_MAX_DOCS, false), 'listen');
		assert.strictEqual(deltaWindowRoute(DELTA_WINDOW_MAX_DOCS, DELTA_WINDOW_MAX_DOCS, false), 'listen', 'at the limit the listener serves it');
		assert.strictEqual(deltaWindowRoute(DELTA_WINDOW_MAX_DOCS + 1, DELTA_WINDOW_MAX_DOCS, false), 'sweep');
		assert.strictEqual(deltaWindowRoute(42904, DELTA_WINDOW_MAX_DOCS, false), 'sweep');
		assert.strictEqual(deltaWindowRoute(42904, DELTA_WINDOW_MAX_DOCS, true), 'listen', 'never sweeps twice in one generation');
		assert.strictEqual(deltaWindowRoute(null, DELTA_WINDOW_MAX_DOCS, false), 'listen', 'a failed count falls back to the listener');
	});

	it('the worker counts the window before attaching, heals marks from sweep pages, and saves the snapshot before warming up', () => {
		const worker = readFileSync(new URL('../../src/worker/corpus-worker.ts', import.meta.url), 'utf8');
		const between = (a, b) => { const i = worker.indexOf(a); const j = worker.indexOf(b, i); assert.ok(i >= 0 && j > i, `region ${a}`); return worker.slice(i, j); };
		assert.strictEqual((worker.match(/attachTombstoneListener\(database, \(\) => \{\s*void attachDeltaOrSweep\(database, myConnectionGeneration\);/g) || []).length, 2, 'both boot paths (after the sweep, and the warm path) go through attachDeltaOrSweep');
		const stripped = worker.replace(/\/\/[^\n]*/g, '');
		//The definition reads `const attachDeltaListener = (` and is not a call.
		const calls = (stripped.match(/attachDeltaListener\s*\(/g) || []).length;
		assert.strictEqual(calls, 1, 'the listener is attached in exactly one place: inside attachDeltaOrSweep');
		const route = between('const attachDeltaOrSweep', 'const afterColdSweep');
		assert.match(route, /getCountFromServer\(/, 'the window is counted');
		assert.match(route, /deltaWindowRoute\(count, DELTA_WINDOW_MAX_DOCS, alreadySwept\)/);
		assert.match(route, /await coldSweep\(database, myConnectionGeneration\)/, 'an oversized window runs the budgeted sweep');
		assert.ok(route.indexOf('if (!done)') >= 0 && route.indexOf('oversizedWindowSweptGeneration = myConnectionGeneration') > route.indexOf('if (!done)'), 'the latch is set only after the sweep completed, so a failed sweep retries rather than falling back to the oversized listener');
		assert.match(route, /afterColdSweep\(database, myConnectionGeneration, false\)/, 'the sweep route does not attach a second tombstone listener');
		assert.match(route, /const resumable = Boolean\(syncMetaStore && syncMetaState && syncMetaState\.coldSweep && !alreadySwept\)/, 'an interrupted sweep is resumable from its cursors');
		assert.match(route, /const resuming = resumable && \(count === null \|\| count <= DELTA_WINDOW_MAX_DOCS\)/, 'but only while the window from its start bound is within the limit, or an old sweep would hand the listener an oversized window');
		const resumeBranch = route.slice(route.indexOf('if (resuming) {'), route.indexOf('} else {', route.indexOf('if (resuming) {')));
		assert.ok(!/coldSweep = null/.test(resumeBranch), 'the resume branch never discards the sweep it resumes');
		const warmPath = between('const interrupted = syncMetaState.coldSweep', 'sessionWatermark = deriveClampedWatermark()');
		assert.ok(!/coldSweep = null/.test(warmPath), 'the warm path keeps an interrupted sweep for the delta plane to resume');
		const sweep = between('const sweepPartition', 'await Promise.all(UNPUBLISHED_CARD_PARTITIONS');
		assert.match(sweep, /serverConfirmedIDs\(page, clientClockCardIDs, heldUpdatedStamp\)/, 'sweep pages heal client-clock marks');
		const warm = between('const scheduleFingerprintWarmup', 'const runDisplayTitleWarmup');
		assert.match(warm, /await awaitPendingSnapshotSave\(shouldContinue\)/, 'the warm-up waits for the pending snapshot save');
		const wait = between('const awaitPendingSnapshotSave', 'const scheduleFingerprintWarmup');
		assert.match(wait, /while \(!corpusSnapshotPersistenceEnabled/, 'it waits for persistence to come on (live) before expecting a save');
	});
});

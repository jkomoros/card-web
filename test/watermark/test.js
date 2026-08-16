/*eslint-env node*/

//Tests for the pure watermark logic underpinning the delta sync.

import assert from 'assert';

let deriveWatermark;
let advanceWatermark;
let watermarkQueryBound;
let compareTimestamps;
let WATERMARK_MARGIN_SECONDS;

const ts = (seconds, nanoseconds = 0) => ({seconds, nanoseconds});

describe('watermark', () => {
	before(async () => {
		({deriveWatermark, advanceWatermark, watermarkQueryBound, compareTimestamps, WATERMARK_MARGIN_SECONDS} = await import('../../lib/src/worker/watermark.js'));
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
});

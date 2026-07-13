/*eslint-env node*/

//Tests for the pure worker-corpus trustworthiness check that gates serving
//collections/reference blocks and reconciliation.

import assert from 'assert';

let corpusSizeTrustworthy;
let corpusSyncReady;

describe('corpusSizeTrustworthy', () => {
	before(async () => {
		({corpusSizeTrustworthy, corpusSyncReady} = await import('../../lib/src/corpus-readiness.js'));
	});

	it('trusts a corpus that matches Redux exactly', () => {
		assert.strictEqual(corpusSizeTrustworthy(40225, 40225), true);
	});

	it('trusts a corpus larger than Redux (unprimed boot: worker leads)', () => {
		assert.strictEqual(corpusSizeTrustworthy(40225, 5001), true);
	});

	it('trusts an empty corpus when Redux is also empty (fresh account)', () => {
		assert.strictEqual(corpusSizeTrustworthy(0, 0), true);
	});

	it('does NOT trust an empty corpus over a primed Redux (offline boot)', () => {
		assert.strictEqual(corpusSizeTrustworthy(0, 40225), false);
	});

	it('does NOT trust a partial corpus (first of five partition flushes)', () => {
		assert.strictEqual(corpusSizeTrustworthy(8000, 40225), false);
	});

	it('does NOT trust a published-only corpus over a primed Redux (pre-permission connect)', () => {
		assert.strictEqual(corpusSizeTrustworthy(1240, 40225), false);
	});

	it('tolerates while-you-were-away deletions within max(50, 10%)', () => {
		//325 deletions at 40k: within the 10% allowance.
		assert.strictEqual(corpusSizeTrustworthy(39900, 40225), true);
		//At a small corpus the absolute floor of 50 governs.
		assert.strictEqual(corpusSizeTrustworthy(60, 100), true);
		assert.strictEqual(corpusSizeTrustworthy(49, 100), false);
	});

	it('rejects nonsense sizes', () => {
		assert.strictEqual(corpusSizeTrustworthy(-1, 0), false);
	});
});

describe('corpusSyncReady', () => {
	it('requires live coverage for privileged watermark sync', () => {
		assert.strictEqual(corpusSyncReady('watermark', true, ''), false);
		assert.strictEqual(corpusSyncReady('watermark', true, 'unverified'), false);
		assert.strictEqual(corpusSyncReady('watermark', true, 'stale'), false);
		assert.strictEqual(corpusSyncReady('watermark', true, 'live'), true);
	});

	it('does not gate listener mode or published/per-user connections', () => {
		assert.strictEqual(corpusSyncReady('listen', true, ''), true);
		assert.strictEqual(corpusSyncReady('watermark', false, ''), true);
	});
});

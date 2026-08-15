/*eslint-env node*/

//Tests for the pure state→glyph mapping behind corpus-status-indicator: the
//dot's tone (color layer), its pulse (still-working layer), the compact
//count label (fetch-progress layer), the pending badge (unconfirmed-changes
//layer), the multi-line tooltip, the progress ring's fraction and the band
//color of the phase it is showing, and the writeLocked padlock that says
//saving is refused rather than merely slow. The component renders exactly
//what this returns, so this is where the indicator's whole contract lives —
//keep that true: a layer added to the glyph without a layer added here is a
//layer nothing tests.

import assert from 'assert';

let corpusStatusGlyph;
let compactCardCount;

const HOUR = 60 * 60 * 1000;

//Everything healthy and settled; tests override what they exercise.
const base = {
	status: 'live',
	message: '',
	corpusSize: 40225,
	expectedCorpusSize: null,
	corpusComplete: false,
	verifyDone: null,
	verifyTotal: null,
	corpusSnapshotAgeMs: null,
	pendingSaveCount: 0,
	queuedWriteCount: 0,
};

const glyph = (overrides) => corpusStatusGlyph({...base, ...overrides});

describe('corpusStatusGlyph', () => {
	before(async () => {
		({corpusStatusGlyph, compactCardCount} = await import('../../lib/src/corpus-status-glyph.js'));
	});

	describe('tone layer (color = health)', () => {
		it('live with nothing pending is ok and steady', () => {
			const result = glyph({});
			assert.strictEqual(result.tone, 'ok');
			assert.strictEqual(result.pulse, false);
		});

		it('fetching states are working with a pulse', () => {
			for (const status of ['loading', 'checking', 'takeover']) {
				const result = glyph({status});
				assert.strictEqual(result.tone, 'working', status);
				assert.strictEqual(result.pulse, true, status);
			}
		});

		it('problem states are problem and never pulse', () => {
			for (const status of ['stale', 'degraded', 'unsupported', 'ownership-error']) {
				const result = glyph({status});
				assert.strictEqual(result.tone, 'problem', status);
				assert.strictEqual(result.pulse, false, status);
			}
		});

		it('other-tab and standard-mode states are muted', () => {
			for (const status of ['off', 'fallback', 'contended', 'inactive']) {
				const result = glyph({status});
				assert.strictEqual(result.tone, 'muted', status);
				assert.strictEqual(result.pulse, false, status);
			}
		});

		it('pending changes turn a live dot amber', () => {
			assert.strictEqual(glyph({pendingSaveCount: 1}).tone, 'pending');
			assert.strictEqual(glyph({queuedWriteCount: 1}).tone, 'pending');
		});

		it('fetching AND pending shows amber WITH the pulse', () => {
			const result = glyph({status: 'loading', queuedWriteCount: 2});
			assert.strictEqual(result.tone, 'pending');
			assert.strictEqual(result.pulse, true);
		});

		it('a problem outranks pending changes', () => {
			const result = glyph({status: 'degraded', pendingSaveCount: 3});
			assert.strictEqual(result.tone, 'problem');
		});
	});

	describe('count label (fetch-progress layer)', () => {
		it('shows the plain compact total when settled', () => {
			assert.strictEqual(glyph({}).countLabel, '40.2k');
			assert.strictEqual(glyph({corpusSize: 812}).countLabel, '812');
		});

		it('shows nothing with an empty corpus', () => {
			assert.strictEqual(glyph({corpusSize: 0}).countLabel, '');
		});

		it('marks a fetch without a known total with a ticking arrow', () => {
			assert.strictEqual(glyph({status: 'loading', corpusSize: 12400}).countLabel, '12.4k↑');
		});

		it('shows progress toward the expected total during a cold sweep', () => {
			assert.strictEqual(
				glyph({status: 'loading', corpusSize: 12400, expectedCorpusSize: 40200}).countLabel,
				'12.4k/40.2k');
		});

		it('drops the target once the count reaches it', () => {
			assert.strictEqual(
				glyph({status: 'loading', corpusSize: 40200, expectedCorpusSize: 40200}).countLabel,
				'40.2k↑');
		});

		it('ignores the expected total when not fetching', () => {
			assert.strictEqual(glyph({expectedCorpusSize: 90000}).countLabel, '40.2k');
		});
	});

	describe('pending badge (unconfirmed-changes layer)', () => {
		it('is empty when nothing is pending', () => {
			assert.strictEqual(glyph({}).pendingBadge, '');
		});

		it('sums saves awaiting echo and queued intents', () => {
			assert.strictEqual(glyph({pendingSaveCount: 2, queuedWriteCount: 1}).pendingBadge, '·3');
		});
	});

	describe('tooltip', () => {
		it('live reads as an up-to-date count', () => {
			assert.strictEqual(glyph({}).tooltip, 'Cards: 40,225 — up to date');
		});

		it('fetching with a known total reads as progress', () => {
			assert.strictEqual(
				glyph({status: 'loading', corpusSize: 12400, expectedCorpusSize: 40200}).tooltip,
				'Fetching cards: 12,400 of ~40,200 (31%)…\n' +
			'Reading, browsing and editing work now; saving unlocks when verification finishes.');
		});

		it('fetching without a total says so far', () => {
			assert.strictEqual(
				glyph({status: 'loading', corpusSize: 12400}).tooltip,
				'Fetching cards: 12,400 so far…\n' +
			'Reading, browsing and editing work now; saving unlocks when verification finishes.');
		});

		it('fetching with no cards yet falls back to the status copy', () => {
			assert.strictEqual(
				glyph({status: 'loading', corpusSize: 0}).tooltip,
				'Card sync: loading and verifying the corpus');
		});

		it('appends one line per pending kind, with plural forms', () => {
			const result = glyph({pendingSaveCount: 2, queuedWriteCount: 1});
			assert.deepStrictEqual(result.tooltip.split('\n'), [
				'Cards: 40,225 — up to date',
				'2 saves awaiting server confirmation',
				'1 queued change will be retried automatically',
			]);
			const singular = glyph({pendingSaveCount: 1, queuedWriteCount: 2});
			assert.deepStrictEqual(singular.tooltip.split('\n'), [
				'Cards: 40,225 — up to date',
				'1 save awaiting server confirmation',
				'2 queued changes will be retried automatically',
			]);
		});

		it('mentions the snapshot age only once it is at least an hour old', () => {
			assert.ok(!glyph({corpusSnapshotAgeMs: 30 * 60 * 1000}).tooltip.includes('Snapshot'));
			assert.ok(glyph({corpusSnapshotAgeMs: 3 * HOUR}).tooltip.includes('Snapshot: 3h old'));
			assert.ok(glyph({corpusSnapshotAgeMs: 3 * 24 * HOUR}).tooltip.includes('Snapshot: 3d old'));
		});

		it('keeps the status message as its own line when it adds information', () => {
			const result = glyph({message: 'Search indexing is running slowly.'});
			assert.deepStrictEqual(result.tooltip.split('\n'), [
				'Cards: 40,225 — up to date',
				'Search indexing is running slowly.',
			]);
		});

		it('does not repeat a message identical to a line already shown', () => {
			//The 'stale' dispatch carries the default stale copy verbatim.
			const staleCopy = 'Card sync is interrupted. Lists and search are temporarily unavailable; retrying automatically.';
			const result = glyph({status: 'stale', message: staleCopy});
			assert.deepStrictEqual(result.tooltip.split('\n'), [
				staleCopy,
				'Cards: 40,225',
				//Stale has cards on screen and saves gated, so the padlock line
				//appears — deduping only applies to the free-form message.
				'Reading, browsing and editing work now; saving unlocks when verification finishes.',
			]);
		});

		it('non-live, non-fetching states still surface the card count', () => {
			const result = glyph({status: 'inactive'});
			assert.deepStrictEqual(result.tooltip.split('\n'), [
				'Compendium moved to another tab. This tab is safely disconnected.',
				'Cards: 40,225',
			]);
		});
	});

	describe('compactCardCount', () => {
		it('keeps small counts exact and abbreviates large ones', () => {
			assert.strictEqual(compactCardCount(812), '812');
			assert.strictEqual(compactCardCount(9999), '9999');
			assert.strictEqual(compactCardCount(10000), '10.0k');
			assert.strictEqual(compactCardCount(40225), '40.2k');
		});
	});
});

describe('progress ring (the current phase\'s fraction)', () => {
	it('draws from the download fraction while downloading with a known target', () => {
		const g = glyph({status: 'loading', corpusSize: 12400, expectedCorpusSize: 40200});
		assert.ok(Math.abs(g.progress - 12400 / 40200) < 1e-9);
	});

	it('is absent while downloading without a target', () => {
		assert.strictEqual(glyph({status: 'loading', corpusSize: 12400}).progress, null);
	});

	it('draws from the verify fraction while verifying', () => {
		//Warm boot: corpus complete, checks under way.
		const g = glyph({status: 'loading', corpusSize: 40225, corpusComplete: true, verifyDone: 7, verifyTotal: 16});
		assert.ok(Math.abs(g.progress - 7 / 16) < 1e-9);
	});

	it('verify fraction never claims done before the status does', () => {
		const g = glyph({status: 'loading', corpusSize: 40225, corpusComplete: true, verifyDone: 16, verifyTotal: 16});
		assert.strictEqual(g.progress, 0.99);
	});

	it('clamps a re-run phase rather than exceeding the total', () => {
		const g = glyph({status: 'loading', corpusSize: 40225, corpusComplete: true, verifyDone: 20, verifyTotal: 16});
		assert.strictEqual(g.progress, 0.99);
		assert.ok(g.tooltip.includes('(16 of 16 checks, 99%)'));
	});

	it('is absent while verifying without checkpoint progress (reader/legacy modes)', () => {
		assert.strictEqual(glyph({status: 'loading', corpusSize: 40225, corpusComplete: true}).progress, null);
	});

	it('is absent once live', () => {
		assert.strictEqual(glyph({verifyDone: 7, verifyTotal: 16}).progress, null);
	});

	it('download progress ignores verify inputs and vice versa', () => {
		//Still downloading: the ring is the fetched fraction even if early
		//checkpoints (the trust gate that classified the corpus cold) landed.
		const g = glyph({status: 'loading', corpusSize: 12400, expectedCorpusSize: 40200, verifyDone: 11, verifyTotal: 16});
		assert.ok(Math.abs(g.progress - 12400 / 40200) < 1e-9);
	});
});

describe('verifying tooltip precision', () => {
	it('shows checks and percent when checkpoint progress is known', () => {
		const g = glyph({status: 'loading', corpusSize: 40225, corpusComplete: true, verifyDone: 7, verifyTotal: 12});
		assert.strictEqual(g.tooltip.split('\n')[0], 'Verifying 40,225 cards… (7 of 12 checks, 58%)');
	});

	it('stays imprecise when the connection reports no checkpoints', () => {
		const g = glyph({status: 'loading', corpusSize: 40225, corpusComplete: true});
		assert.strictEqual(g.tooltip.split('\n')[0], 'Verifying 40,225 cards…');
	});

	it('applies to the warm-boot checking/takeover states too', () => {
		const g = glyph({status: 'checking', corpusSize: 40225, verifyDone: 3, verifyTotal: 16});
		assert.strictEqual(g.tooltip.split('\n')[0], 'Verifying 40,225 cards… (3 of 16 checks, 19%)');
	});

	it('caps the verifying percent below 100', () => {
		const g = glyph({status: 'loading', corpusSize: 40225, corpusComplete: true, verifyDone: 16, verifyTotal: 16});
		assert.ok(g.tooltip.includes('(16 of 16 checks, 99%)'));
	});

	it('zero checks done reads as 0%', () => {
		const g = glyph({status: 'loading', corpusSize: 40225, corpusComplete: true, verifyDone: 0, verifyTotal: 16});
		assert.strictEqual(g.tooltip.split('\n')[0], 'Verifying 40,225 cards… (0 of 16 checks, 0%)');
	});
});

describe('writeLocked (the verifying padlock)', () => {
	it('locks during verification with cards on screen', () => {
		const g = corpusStatusGlyph({...base, status: 'loading', corpusSize: 1200});
		assert.strictEqual(g.writeLocked, true);
		assert.ok(g.tooltip.includes('saving unlocks when verification finishes'));
	});
	it('does not lock when live', () => {
		const g = corpusStatusGlyph({...base, status: 'live', corpusSize: 40225});
		assert.strictEqual(g.writeLocked, false);
	});
	it('locks on stale with cards on screen', () => {
		const g = corpusStatusGlyph({...base, status: 'stale', corpusSize: 40225});
		assert.strictEqual(g.writeLocked, true);
	});
	it('does not lock before any cards exist (nothing readable to contrast with)', () => {
		const g = corpusStatusGlyph({...base, status: 'loading', corpusSize: 0});
		assert.strictEqual(g.writeLocked, false);
	});
});

describe('progressPhase (the ring band color)', () => {
	it('is download while genuinely downloading with a target', () => {
		const g = corpusStatusGlyph({...base, status: 'loading', corpusSize: 12400, expectedCorpusSize: 40200, corpusComplete: false});
		assert.strictEqual(g.progressPhase, 'download');
	});
	it('is verify during the checkpointed verifying window', () => {
		const g = corpusStatusGlyph({...base, status: 'loading', corpusSize: 40225, corpusComplete: true, verifyDone: 4, verifyTotal: 16});
		assert.strictEqual(g.progressPhase, 'verify');
	});
	it('is null when settled', () => {
		const g = corpusStatusGlyph({...base, status: 'live'});
		assert.strictEqual(g.progressPhase, null);
	});
});

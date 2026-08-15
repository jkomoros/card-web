/*eslint-env node*/

//Tests for the pure state→glyph mapping behind corpus-status-indicator: the
//dot's tone (color layer), its pulse (still-working layer), the compact
//count label (fetch-progress layer), the pending badge (unconfirmed-changes
//layer) and the multi-line tooltip. The component renders exactly what this
//returns, so this is where the indicator's whole contract lives.

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

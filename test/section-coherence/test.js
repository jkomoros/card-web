/*eslint-env node*/

//Tests for the pure coherence rule behind the card-info rail's async
//sections (reference blocks, word cloud) and the card face's primary
//reference blocks: a section renders exactly one card's datum at a time —
//either the previous card's committed value dimmed as stale, or the incoming
//card's value once a result verifiably FOR that card commits — never a
//datum keyed to any other card, and never an empty flash between two real
//values. The components render exactly what these functions return, so this
//is where the contract lives (same shape as corpus-status-glyph).

import assert from 'assert';

let sectionRender;
let sectionResultCommits;
let similarContentLags;

describe('section coherence', () => {
	before(async () => {
		({sectionRender, sectionResultCommits, similarContentLags} = await import('../../lib/src/section-coherence.js'));
	});

	describe('sectionResultCommits (the wrong-card gate)', () => {
		it('commits a result computed for the active card', () => {
			assert.strictEqual(sectionResultCommits('card-b', 'card-b'), true);
		});

		it('drops a late result computed for a previous card', () => {
			//The observed bug's middle flash: a worker roundtrip launched for
			//card A resolving after the user navigated to card B.
			assert.strictEqual(sectionResultCommits('card-a', 'card-b'), false);
		});

		it('drops a result keyed to no card at all', () => {
			assert.strictEqual(sectionResultCommits('', 'card-b'), false);
		});

		it('drops any result when there is no active card', () => {
			assert.strictEqual(sectionResultCommits('card-a', ''), false);
			//Even a degenerate ''==='' pair must not commit: a no-card result
			//committed under no active card would stamp emptiness as real.
			assert.strictEqual(sectionResultCommits('', ''), false);
		});
	});

	describe('sectionRender (what the section shows right now)', () => {
		const EMPTY = Object.freeze([]);

		it('renders the empty state undimmed when nothing has committed', () => {
			const result = sectionRender({forCardID: '', value: ['leftover']}, 'card-a', EMPTY);
			assert.strictEqual(result.value, EMPTY);
			assert.strictEqual(result.stale, false);
		});

		it('renders the committed value undimmed for the card it was computed for', () => {
			const value = ['block-for-a'];
			const result = sectionRender({forCardID: 'card-a', value}, 'card-a', EMPTY);
			assert.strictEqual(result.value, value);
			assert.strictEqual(result.stale, false);
		});

		it('holds the previous card\'s value dimmed during a transition', () => {
			const value = ['block-for-a'];
			const result = sectionRender({forCardID: 'card-a', value}, 'card-b', EMPTY);
			assert.strictEqual(result.value, value);
			assert.strictEqual(result.stale, true);
		});

		it('holds the value dimmed while there is transiently no active card', () => {
			const value = ['block-for-a'];
			const result = sectionRender({forCardID: 'card-a', value}, '', EMPTY);
			assert.strictEqual(result.value, value);
			assert.strictEqual(result.stale, true);
		});
	});

	describe('similarContentLags (when a similar-cards block must dim)', () => {
		it('dims a fingerprint preview still awaiting embeddings', () => {
			//Between cards: the block renders the local-fingerprint placeholder
			//while the embedding fetch is in flight — not yet the real answer.
			assert.strictEqual(similarContentLags(true, false), true);
		});

		it('dims while an editing-draft similarity request is outstanding', () => {
			//While editing: from the settle-point request until its result
			//lands, whatever the block shows was computed for an older draft.
			assert.strictEqual(similarContentLags(false, true), true);
		});

		it('dims when both lag signals are set', () => {
			assert.strictEqual(similarContentLags(true, true), true);
		});

		it('renders undimmed when the content is the real answer', () => {
			assert.strictEqual(similarContentLags(false, false), false);
		});
	});

	describe('a full transition swaps each section at most once', () => {
		//Simulate the component: a held snapshot plus the commit gate, driven
		//through a fast scrub A -> B -> C with results arriving late and out
		//of order. The section must show A's value (dimmed once B is active)
		//for the whole scrub and swap exactly once, to C's value.
		it('fast scrub: intermediate cards\' late results never render', () => {
			let snapshot = {forCardID: 'card-a', value: 'blocks-A'};
			const renders = [];
			const record = (activeCardID) => {
				const {value, stale} = sectionRender(snapshot, activeCardID, 'EMPTY');
				const last = renders[renders.length - 1];
				const next = `${value}${stale ? ' (dimmed)' : ''}`;
				if (next !== last) renders.push(next);
			};
			const commit = (forCardID, value, activeCardID) => {
				if (!sectionResultCommits(forCardID, activeCardID)) return;
				snapshot = {forCardID, value};
			};

			record('card-a');            //settled on A
			record('card-b');            //nav A->B: A's value dims, no blank
			record('card-c');            //nav B->C before anything arrived
			commit('card-a', 'late-A', 'card-c');  //A's similarity-refresh result lands late
			record('card-c');
			commit('card-b', 'blocks-B', 'card-c'); //B's worker roundtrip lands late
			record('card-c');
			commit('card-c', 'blocks-C', 'card-c'); //C's own result
			record('card-c');
			commit('card-c', 'blocks-C-refined', 'card-c'); //similarity refinement, in place
			record('card-c');

			assert.deepStrictEqual(renders, [
				'blocks-A',
				'blocks-A (dimmed)',
				'blocks-C',
				'blocks-C-refined',
			]);
		});
	});
});

/*eslint-env node*/

import assert from 'assert';

import {
	SearchIndex
} from '../../lib/src/worker/search-index.js';

describe('SearchIndex', () => {
	it('indexes and recalls by intersection', async () => {
		const index = new SearchIndex();
		index.updateCard('a', ['hill', 'climb', 'hill climb']);
		index.updateCard('b', ['hill', 'valley']);
		index.updateCard('c', ['valley']);
		assert.deepStrictEqual([...index.candidates(['hill'])].sort(), ['a', 'b']);
		assert.deepStrictEqual([...index.candidates(['hill', 'valley'])], ['b']);
		assert.deepStrictEqual([...index.candidates(['hill climb'])], ['a']);
		//Tokens with no postings are skipped, not intersected to zero.
		assert.deepStrictEqual([...index.candidates(['hill', 'nonexistent'])].sort(), ['a', 'b']);
		//No token has postings: null signals full-scan fallback.
		assert.strictEqual(index.candidates(['nonexistent']), null);
	});

	it('updates incrementally', async () => {
		const index = new SearchIndex();
		index.updateCard('a', ['alpha', 'beta']);
		index.updateCard('a', ['beta', 'gamma']);
		assert.strictEqual(index.candidates(['alpha']), null);
		assert.deepStrictEqual([...index.candidates(['gamma'])], ['a']);
		assert.deepStrictEqual([...index.candidates(['beta'])], ['a']);
		assert.strictEqual(index.cardCount, 1);
	});

	it('removes cards', async () => {
		const index = new SearchIndex();
		index.updateCard('a', ['alpha']);
		index.updateCard('b', ['alpha', 'beta']);
		index.removeCard('a');
		assert.deepStrictEqual([...index.candidates(['alpha'])], ['b']);
		assert.strictEqual(index.cardCount, 1);
		//Removing the last card holding a token drops the posting entirely.
		index.removeCard('b');
		assert.strictEqual(index.tokenCount, 0);
	});

	it('supports union recall', async () => {
		const index = new SearchIndex();
		index.updateCard('a', ['alpha']);
		index.updateCard('b', ['beta']);
		assert.deepStrictEqual([...index.candidatesUnion(['alpha', 'beta'])].sort(), ['a', 'b']);
	});

	it('benchmark: builds and queries a synthetic 40k corpus', async function() {
		this.timeout(30000);
		const index = new SearchIndex();
		//Synthetic corpus: 40k cards, ~60 tokens each drawn from a 20k-token
		//vocabulary with a skewed distribution (mimicking natural language).
		const CARDS = 40000;
		const VOCAB = 20000;
		const TOKENS_PER_CARD = 60;
		//Deterministic PRNG so the benchmark is reproducible.
		let seed = 12345;
		const rand = () => {
			seed = (seed * 1103515245 + 12345) & 0x7fffffff;
			return seed / 0x7fffffff;
		};
		const tokenFor = (i) => 'tok' + i;
		const buildStart = process.hrtime.bigint();
		for (let cardIndex = 0; cardIndex < CARDS; cardIndex++) {
			const tokens = [];
			for (let tokenIndex = 0; tokenIndex < TOKENS_PER_CARD; tokenIndex++) {
				//Square the random draw to skew towards low token indexes
				//(common words appear in many cards).
				tokens.push(tokenFor(Math.floor(rand() * rand() * VOCAB)));
			}
			index.updateCard('card-' + cardIndex, tokens);
		}
		const buildMs = Number(process.hrtime.bigint() - buildStart) / 1e6;

		//Query: one common token + one rare token (the realistic shape — the
		//rare token's posting list drives the intersection cost).
		const queryStart = process.hrtime.bigint();
		const QUERIES = 100;
		let totalCandidates = 0;
		for (let queryIndex = 0; queryIndex < QUERIES; queryIndex++) {
			const candidates = index.candidates([tokenFor(queryIndex % 50), tokenFor(VOCAB - 1 - queryIndex)]);
			if (candidates) totalCandidates += candidates.size;
		}
		const queryMs = Number(process.hrtime.bigint() - queryStart) / 1e6 / QUERIES;

		console.log(`      [bench] build ${CARDS} cards: ${buildMs.toFixed(0)}ms total (${(buildMs / CARDS * 1000).toFixed(1)}µs/card); avg query: ${queryMs.toFixed(2)}ms; tokens: ${index.tokenCount}; avg candidates: ${(totalCandidates / QUERIES).toFixed(1)}`);

		assert.strictEqual(index.cardCount, CARDS);
		//Sanity bounds, generous so slow CI machines don't flake: build under
		//30s, average query under 50ms.
		assert.ok(buildMs < 30000, `index build took ${buildMs}ms`);
		assert.ok(queryMs < 50, `average query took ${queryMs}ms`);
	});
});

/*eslint-env node*/

//Tests for the synthetic worst-case corpus generator. The generator is the
//foundation of the perf harness: it must be DETERMINISTIC (same seed => same
//corpus, so runs are comparable across machines/CI), internally CONSISTENT
//(references_inbound derived from references), and actually WORST-CASE (dense
//reference graph + fat body tail), or the perf numbers it feeds are meaningless.

import assert from 'assert';
import {generateCorpus, corpusStats} from './gen-corpus.js';

describe('perf-harness synthetic corpus generator', () => {
	it('is deterministic: same seed produces byte-identical output', () => {
		const a = JSON.stringify(generateCorpus({count: 400, seed: 7}));
		const b = JSON.stringify(generateCorpus({count: 400, seed: 7}));
		assert.strictEqual(a, b);
	});

	it('a different seed produces different output', () => {
		const a = JSON.stringify(generateCorpus({count: 400, seed: 7}));
		const b = JSON.stringify(generateCorpus({count: 400, seed: 8}));
		assert.notStrictEqual(a, b);
	});

	it('produces exactly the requested count', () => {
		const cards = generateCorpus({count: 250, seed: 1});
		assert.strictEqual(Object.keys(cards).length, 250);
	});

	it('every card is well-formed (has an updated timestamp; references_info keys match references)', () => {
		const cards = generateCorpus({count: 300, seed: 3});
		for (const [id, c] of Object.entries(cards)) {
			assert.strictEqual(c.id, id);
			assert.ok(c.updated && typeof c.updated.seconds === 'number', `${id} must have an updated timestamp`);
			assert.ok(Array.isArray(c.tags), `${id}.tags is an array`);
			assert.strictEqual(typeof c.published, 'boolean', `${id}.published is boolean`);
			assert.deepStrictEqual(
				Object.keys(c.references).sort(),
				Object.keys(c.references_info).sort(),
				`${id}: references and references_info must cover the same targets`);
		}
	});

	it('references_inbound is the exact transpose of references (consistent graph)', () => {
		const cards = generateCorpus({count: 500, seed: 5});
		//Forward-edge count must equal inbound-edge count, and each forward edge
		//A->B must appear as B.references_inbound[A].
		let forward = 0, inbound = 0;
		for (const [a, card] of Object.entries(cards)) {
			for (const b of Object.keys(card.references)) {
				forward++;
				assert.strictEqual(cards[b].references_inbound[a], true, `inbound ${a}->${b} missing`);
				assert.deepStrictEqual(cards[b].references_info_inbound[a], card.references_info[b],
					`inbound info ${a}->${b} mismatched`);
			}
			inbound += Object.keys(card.references_inbound).length;
		}
		assert.strictEqual(forward, inbound, 'forward and inbound edge counts must match');
	});

	it('forward references only point at earlier cards (acyclic, deterministic)', () => {
		const cards = generateCorpus({count: 400, seed: 9});
		const index = new Map(Object.keys(cards).map((id, i) => [id, i]));
		for (const [a, card] of Object.entries(cards)) {
			for (const b of Object.keys(card.references)) {
				assert.ok(index.get(b) < index.get(a), `${a} references later card ${b}`);
			}
		}
	});

	it('is actually worst-case: dense graph, mixed published, and a fat body tail', () => {
		const cards = generateCorpus({count: 2000, seed: 2});
		const stats = corpusStats(cards);
		assert.ok(stats.avgRefs > 1.5, `expected a dense graph, got avgRefs=${stats.avgRefs}`);
		assert.ok(stats.published > 0 && stats.published < stats.count, `expected a published/unpublished mix, got ${stats.published}/${stats.count}`);
		//Fat tail: at least one card an order of magnitude larger than average.
		const bodies = Object.values(cards).map(c => c.body.length).sort((x, y) => y - x);
		assert.ok(bodies[0] > stats.avgBodyBytes * 4, `expected a fat body tail, max=${bodies[0]} avg=${stats.avgBodyBytes}`);
	});
});

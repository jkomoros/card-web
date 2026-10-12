/*eslint-env node*/

//Fingerprint.semanticOverlap runs once per corpus card for every
//similar-cards scan. Its rewrite must be bit-identical to the original
//union/intersection formulation — including floating-point summation order,
//which decides the sort order of near-equal overlaps in
//closestOverlappingItems — so the reference below is that original, inlined.

import assert from 'assert';

let Fingerprint;
let FingerprintGenerator;
let SEMANTIC_FINGERPRINT_MATCH_CONSTANT;

const referenceOverlap = (a, b) => {
	const fingerprintOne = a._items ? a._items : new Map();
	const fingerprintTwo = b && b._items ? b._items : new Map();
	const union = new Set([...fingerprintOne.keys(), ...fingerprintTwo.keys()]);
	const intersection = new Map();
	for (const key of union) {
		if (fingerprintOne.has(key) && fingerprintTwo.has(key)) {
			intersection.set(key, SEMANTIC_FINGERPRINT_MATCH_CONSTANT + fingerprintOne.get(key) + fingerprintTwo.get(key));
		}
	}
	return [...intersection.values()].reduce((p, c) => p + c, 0);
};

describe('Fingerprint.semanticOverlap', () => {
	before(async () => {
		({Fingerprint, FingerprintGenerator} = await import('../../lib/src/nlp.js'));
		//Not exported: recover it from a pair whose overlap is one matched key
		//with both weights zero.
		const a = new Fingerprint(new Map([['k', 0]]));
		SEMANTIC_FINGERPRINT_MATCH_CONSTANT = a.semanticOverlap(new Fingerprint(new Map([['k', 0]])));
		assert.ok(SEMANTIC_FINGERPRINT_MATCH_CONSTANT > 0);
	});

	let seed = 11;
	const rand = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return (seed >>> 16) % n; };
	//Weights with many bits set, so summation order would show in the result.
	const weight = () => (rand(1000000) + 1) / 7919;
	const randomFingerprint = (vocabSize, size) => {
		const items = new Map();
		for (let i = 0; i < size; i++) items.set('t' + rand(vocabSize), weight());
		return new Fingerprint(items);
	};

	it('is bit-identical to the union/intersection formulation, in both argument orders', () => {
		for (let i = 0; i < 3000; i++) {
			const a = randomFingerprint(1 + rand(80), rand(60));
			const b = randomFingerprint(1 + rand(80), rand(60));
			assert.strictEqual(a.semanticOverlap(b), referenceOverlap(a, b));
			assert.strictEqual(b.semanticOverlap(a), referenceOverlap(b, a));
		}
	});

	it('handles empty, identical and disjoint fingerprints like the reference', () => {
		const empty = new Fingerprint();
		const a = randomFingerprint(20, 30);
		for (const [x, y] of [[empty, empty], [a, empty], [empty, a], [a, a], [a, new Fingerprint(new Map([['zz', 1]]))]]) {
			assert.strictEqual(x.semanticOverlap(y), referenceOverlap(x, y));
		}
		assert.strictEqual(a.semanticOverlap(undefined), referenceOverlap(a, undefined));
	});

	it('leaves closestOverlappingItems ordering unchanged', () => {
		const generator = new FingerprintGenerator({}, undefined, undefined, {idf: {}, maxIDF: 1});
		const fingerprints = {};
		for (let i = 0; i < 400; i++) fingerprints['c' + i] = randomFingerprint(40, 1 + rand(50));
		const key = randomFingerprint(40, 50);
		const actual = [...generator.closestOverlappingItems('', key, fingerprints).entries()];
		const overlaps = Object.fromEntries(Object.keys(fingerprints).map(id => [id, referenceOverlap(key, fingerprints[id])]));
		const expected = Object.keys(overlaps).sort((x, y) => overlaps[y] - overlaps[x]).map(id => [id, overlaps[id]]);
		assert.deepStrictEqual(actual, expected);
	});
});

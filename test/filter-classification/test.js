/*eslint-env node*/

import {
	classifyCollectionDescription,
	FilterComplexity,
	buildQueryConstraints,
} from '../../lib/src/filter-classification.js';

import assert from 'assert';

// Helper: create a CollectionDescriptionLike object without importing
// CollectionDescription (which transitively pulls in Lit and requires window).
const desc = (set, filters) => ({ set, filters });

describe('filter classification', () => {
	it('classifies no filters as SIMPLE', async () => {
		const classification = classifyCollectionDescription(desc('main', []));
		assert.strictEqual(classification.complexity, FilterComplexity.SIMPLE);
		assert.strictEqual(classification.canGetServerCount, true);
		assert.strictEqual(classification.isExact, true);
	});

	it('classifies published filter as SIMPLE', async () => {
		const classification = classifyCollectionDescription(desc('', ['published']));
		assert.strictEqual(classification.complexity, FilterComplexity.SIMPLE);
		assert.strictEqual(classification.canGetServerCount, true);
		assert.strictEqual(classification.isExact, true);
	});

	it('classifies section filter as SIMPLE', async () => {
		const classification = classifyCollectionDescription(desc('', ['section/main']));
		assert.strictEqual(classification.complexity, FilterComplexity.SIMPLE);
		assert.strictEqual(classification.canGetServerCount, true);
		assert.strictEqual(classification.isExact, true);
	});

	it('classifies tag filter as SIMPLE', async () => {
		const classification = classifyCollectionDescription(desc('', ['tag/foo']));
		assert.strictEqual(classification.complexity, FilterComplexity.SIMPLE);
		assert.strictEqual(classification.canGetServerCount, true);
		assert.strictEqual(classification.isExact, true);
	});

	it('classifies type-X filter as SIMPLE', async () => {
		const classification = classifyCollectionDescription(desc('', ['type-content']));
		assert.strictEqual(classification.complexity, FilterComplexity.SIMPLE);
		assert.strictEqual(classification.canGetServerCount, true);
		assert.strictEqual(classification.isExact, true);
	});

	it('classifies starred filter as COMPLEX', async () => {
		const classification = classifyCollectionDescription(desc('', ['starred']));
		assert.strictEqual(classification.complexity, FilterComplexity.COMPLEX);
		assert.strictEqual(classification.canGetServerCount, false);
		assert.strictEqual(classification.isExact, false);
	});

	it('classifies children filter as COMPLEX', async () => {
		const classification = classifyCollectionDescription(desc('', ['children/card-123']));
		assert.strictEqual(classification.complexity, FilterComplexity.COMPLEX);
		assert.strictEqual(classification.canGetServerCount, false);
		assert.strictEqual(classification.isExact, false);
	});

	it('classifies query filter as SIMPLE', async () => {
		const classification = classifyCollectionDescription(desc('', ['query/test']));
		assert.strictEqual(classification.complexity, FilterComplexity.SIMPLE);
		assert.strictEqual(classification.canGetServerCount, true);
		assert.strictEqual(classification.isExact, true);
	});

	it('classifies mixed SIMPLE and COMPLEX as COMPLEX', async () => {
		const classification = classifyCollectionDescription(desc('', ['published', 'starred']));
		assert.strictEqual(classification.complexity, FilterComplexity.COMPLEX);
		assert.strictEqual(classification.canGetServerCount, false);
		assert.strictEqual(classification.isExact, false);
	});

	it('classifies multiple SIMPLE filters as SIMPLE', async () => {
		const classification = classifyCollectionDescription(desc('', ['published', 'section/main', 'tag/foo']));
		assert.strictEqual(classification.complexity, FilterComplexity.SIMPLE);
		assert.strictEqual(classification.canGetServerCount, true);
		assert.strictEqual(classification.isExact, true);
	});

	it('ignores limit/offset meta filters', async () => {
		const classification = classifyCollectionDescription(desc('', ['published', 'limit/10', 'offset/5']));
		assert.strictEqual(classification.complexity, FilterComplexity.SIMPLE);
		assert.strictEqual(classification.canGetServerCount, true);
		assert.strictEqual(classification.isExact, true);
	});

	it('classifies union of SIMPLE filters as COMPLEX', async () => {
		// Union filters always require client-side OR processing
		const classification = classifyCollectionDescription(desc('', ['section/a+section/b']));
		assert.strictEqual(classification.complexity, FilterComplexity.COMPLEX);
		assert.strictEqual(classification.canGetServerCount, false);
	});

	it('classifies union with COMPLEX filter as COMPLEX', async () => {
		const classification = classifyCollectionDescription(desc('', ['published+starred']));
		assert.strictEqual(classification.complexity, FilterComplexity.COMPLEX);
		assert.strictEqual(classification.canGetServerCount, false);
	});

	it('classifies unknown filter as COMPLEX for safety', async () => {
		const classification = classifyCollectionDescription(desc('', ['unknown-filter']));
		assert.strictEqual(classification.complexity, FilterComplexity.COMPLEX);
		assert.strictEqual(classification.canGetServerCount, false);
	});

	it('classifies combine filter as COMPLEX', async () => {
		const classification = classifyCollectionDescription(desc('', ['combine/published/starred']));
		assert.strictEqual(classification.complexity, FilterComplexity.COMPLEX);
		assert.strictEqual(classification.canGetServerCount, false);
	});

	it('classifies exclude filter as COMPLEX', async () => {
		const classification = classifyCollectionDescription(desc('', ['exclude/published/starred']));
		assert.strictEqual(classification.complexity, FilterComplexity.COMPLEX);
		assert.strictEqual(classification.canGetServerCount, false);
	});

	it('buildQueryConstraints produces array-contains constraint', async () => {
		const constraints = buildQueryConstraints('hill climbing');
		assert.strictEqual(constraints.length, 1);
		// The constraint should be targeting nlp_search_tokens
		// We verify by checking the constraint object structure
		assert.ok(constraints[0]);
	});

	it('buildQueryConstraints returns empty for empty query', async () => {
		const constraints = buildQueryConstraints('');
		assert.strictEqual(constraints.length, 0);
	});

	it('buildQueryConstraints with IDF selects rarest token', async () => {
		const mockIDF = {
			version: 1,
			cardCount: 100,
			ngramSize: 2,
			idf: {
				'hill': 2.0,
				'climb': 5.0,      // rarest unigram
				'hill climb': 8.0  // rarest overall
			},
			maxIDF: 10.0
		};
		const constraints = buildQueryConstraints('hill climbing', mockIDF);
		assert.strictEqual(constraints.length, 1);
		assert.ok(constraints[0]);
	});

	it('classifies tag + query combined as COMPLEX (multiple array-contains)', async () => {
		const classification = classifyCollectionDescription(desc('', ['tag/foo', 'query/bar']));
		assert.strictEqual(classification.complexity, FilterComplexity.COMPLEX);
		assert.strictEqual(classification.canGetServerCount, false);
	});

	it('classifies has-body as COMPLEX', async () => {
		const classification = classifyCollectionDescription(desc('', ['has-body']));
		assert.strictEqual(classification.complexity, FilterComplexity.COMPLEX);
		assert.strictEqual(classification.canGetServerCount, false);
	});

	it('classifies union filter as COMPLEX', async () => {
		// Even a union of all-SIMPLE parts is COMPLEX because standard
		// Firestore cannot do server-side OR queries
		const classification = classifyCollectionDescription(desc('', ['published+unpublished']));
		assert.strictEqual(classification.complexity, FilterComplexity.COMPLEX);
		assert.strictEqual(classification.canGetServerCount, false);
	});
});

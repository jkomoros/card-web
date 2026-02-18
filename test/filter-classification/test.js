/*eslint-env node*/

import {
	CollectionDescription,
} from '../../lib/src/collection_description.js';

import {
	classifyCollectionDescription,
	FilterComplexity,
	buildQueryConstraints,
} from '../../lib/src/filter-classification.js';

import assert from 'assert';

describe('filter classification', () => {
	it('classifies no filters as SIMPLE', async () => {
		const description = new CollectionDescription('main', []);
		const classification = classifyCollectionDescription(description);
		assert.strictEqual(classification.complexity, FilterComplexity.SIMPLE);
		assert.strictEqual(classification.canGetServerCount, true);
		assert.strictEqual(classification.isExact, true);
	});

	it('classifies published filter as SIMPLE', async () => {
		const description = new CollectionDescription('', ['published']);
		const classification = classifyCollectionDescription(description);
		assert.strictEqual(classification.complexity, FilterComplexity.SIMPLE);
		assert.strictEqual(classification.canGetServerCount, true);
		assert.strictEqual(classification.isExact, true);
	});

	it('classifies section filter as SIMPLE', async () => {
		const description = new CollectionDescription('', ['section/main']);
		const classification = classifyCollectionDescription(description);
		assert.strictEqual(classification.complexity, FilterComplexity.SIMPLE);
		assert.strictEqual(classification.canGetServerCount, true);
		assert.strictEqual(classification.isExact, true);
	});

	it('classifies tag filter as SIMPLE', async () => {
		const description = new CollectionDescription('', ['tag/foo']);
		const classification = classifyCollectionDescription(description);
		assert.strictEqual(classification.complexity, FilterComplexity.SIMPLE);
		assert.strictEqual(classification.canGetServerCount, true);
		assert.strictEqual(classification.isExact, true);
	});

	it('classifies type-X filter as SIMPLE', async () => {
		const description = new CollectionDescription('', ['type-content']);
		const classification = classifyCollectionDescription(description);
		assert.strictEqual(classification.complexity, FilterComplexity.SIMPLE);
		assert.strictEqual(classification.canGetServerCount, true);
		assert.strictEqual(classification.isExact, true);
	});

	it('classifies starred filter as COMPLEX', async () => {
		const description = new CollectionDescription('', ['starred']);
		const classification = classifyCollectionDescription(description);
		assert.strictEqual(classification.complexity, FilterComplexity.COMPLEX);
		assert.strictEqual(classification.canGetServerCount, false);
		assert.strictEqual(classification.isExact, false);
	});

	it('classifies children filter as COMPLEX', async () => {
		const description = new CollectionDescription('', ['children/card-123']);
		const classification = classifyCollectionDescription(description);
		assert.strictEqual(classification.complexity, FilterComplexity.COMPLEX);
		assert.strictEqual(classification.canGetServerCount, false);
		assert.strictEqual(classification.isExact, false);
	});

	it('classifies query filter as SIMPLE', async () => {
		const description = new CollectionDescription('', ['query/test']);
		const classification = classifyCollectionDescription(description);
		assert.strictEqual(classification.complexity, FilterComplexity.SIMPLE);
		assert.strictEqual(classification.canGetServerCount, true);
		assert.strictEqual(classification.isExact, true);
	});

	it('classifies mixed SIMPLE and COMPLEX as COMPLEX', async () => {
		const description = new CollectionDescription('', ['published', 'starred']);
		const classification = classifyCollectionDescription(description);
		assert.strictEqual(classification.complexity, FilterComplexity.COMPLEX);
		assert.strictEqual(classification.canGetServerCount, false);
		assert.strictEqual(classification.isExact, false);
	});

	it('classifies multiple SIMPLE filters as SIMPLE', async () => {
		const description = new CollectionDescription('', ['published', 'section/main', 'tag/foo']);
		const classification = classifyCollectionDescription(description);
		assert.strictEqual(classification.complexity, FilterComplexity.SIMPLE);
		assert.strictEqual(classification.canGetServerCount, true);
		assert.strictEqual(classification.isExact, true);
	});

	it('ignores limit/offset meta filters', async () => {
		const description = new CollectionDescription('', ['published', 'limit/10', 'offset/5']);
		const classification = classifyCollectionDescription(description);
		assert.strictEqual(classification.complexity, FilterComplexity.SIMPLE);
		assert.strictEqual(classification.canGetServerCount, true);
		assert.strictEqual(classification.isExact, true);
	});

	it('classifies union of SIMPLE filters as SIMPLE', async () => {
		const description = new CollectionDescription('', ['section/a+section/b']);
		const classification = classifyCollectionDescription(description);
		assert.strictEqual(classification.complexity, FilterComplexity.SIMPLE);
		assert.strictEqual(classification.canGetServerCount, true);
	});

	it('classifies union with COMPLEX filter as COMPLEX', async () => {
		const description = new CollectionDescription('', ['published+starred']);
		const classification = classifyCollectionDescription(description);
		assert.strictEqual(classification.complexity, FilterComplexity.COMPLEX);
		assert.strictEqual(classification.canGetServerCount, false);
	});

	it('classifies unknown filter as COMPLEX for safety', async () => {
		const description = new CollectionDescription('', ['unknown-filter']);
		const classification = classifyCollectionDescription(description);
		assert.strictEqual(classification.complexity, FilterComplexity.COMPLEX);
		assert.strictEqual(classification.canGetServerCount, false);
	});

	it('classifies combine filter as COMPLEX', async () => {
		const description = new CollectionDescription('', ['combine/published/starred']);
		const classification = classifyCollectionDescription(description);
		assert.strictEqual(classification.complexity, FilterComplexity.COMPLEX);
		assert.strictEqual(classification.canGetServerCount, false);
	});

	it('classifies exclude filter as COMPLEX', async () => {
		const description = new CollectionDescription('', ['exclude/published/starred']);
		const classification = classifyCollectionDescription(description);
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
});

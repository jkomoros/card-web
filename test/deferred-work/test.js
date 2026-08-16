import {strict as assert} from 'node:assert';
import {describe, it} from 'node:test';

import {
	deferredWorkIsOverdue,
	deferredWorkStartedAt
} from '../../src/deferred-work.ts';

describe('deferred expensive work', () => {
	it('preserves the first deferral for churn on the same subject', () => {
		assert.equal(deferredWorkStartedAt(100, 800, false), 100);
		assert.equal(deferredWorkIsOverdue(100, 1100, 1000), true);
	});

	it('starts a fresh max-wait window when the subject changes', () => {
		const startedAt = deferredWorkStartedAt(100, 1100, true);
		assert.equal(startedAt, 1100);
		assert.equal(deferredWorkIsOverdue(startedAt, 1100, 1000), false);
		assert.equal(deferredWorkIsOverdue(startedAt, 2100, 1000), true);
	});

	it('starts a window for the first deferral', () => {
		assert.equal(deferredWorkStartedAt(0, 250, false), 250);
		assert.equal(deferredWorkIsOverdue(0, 5000, 1000), false);
	});
});

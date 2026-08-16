/*eslint-env node*/

import assert from 'assert';

import {inspectSavedOperation} from '../../lib/src/durable-operation-recovery.js';

describe('durable operation recovery', () => {
	it('keeps the abandon path usable when a saved record is corrupt', () => {
		const result = inspectSavedOperation(() => { throw new Error('corrupt record'); });
		assert.equal(result.operation, null);
		assert.match(result.error.message, /corrupt record/);
	});

	it('returns a valid saved operation without changing it', () => {
		const operation = {id: 'op'};
		assert.deepStrictEqual(inspectSavedOperation(() => operation), {operation, error: null});
	});
});

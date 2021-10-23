/*eslint-env node*/

import {
	getObjectPath,
	objectPathToValue
} from '../../src/util.js';

import assert from 'assert';


describe('getObjectPath', () => {
	it('handles null object', async () => {
		const obj = null;
		const path = ['a', 'b'];
		const result = getObjectPath(obj, path);
		const golden = undefined;
		assert.strictEqual(result, golden);
	});

	it('handles null path', async () => {
		const obj = {};
		const path = null;
		const result = getObjectPath(obj, path);
		const golden = undefined;
		assert.strictEqual(result, golden);
	});

	it('handles empty path', async () => {
		const obj = {};
		const path = [];
		const result = getObjectPath(obj, path);
		const golden = obj;
		assert.strictEqual(result, golden);
	});

	it('handles non-object object', async () => {
		const obj = 'abc';
		const path = ['a', 'b'];
		const result = getObjectPath(obj, path);
		const golden = undefined;
		assert.strictEqual(result, golden);
	});

	it('handles non-array path', async () => {
		const obj = {};
		const path = 'a';
		const result = getObjectPath(obj, path);
		const golden = undefined;
		assert.strictEqual(result, golden);
	});

	it('basic single-level get', async () => {
		const obj = {
			a: 2,
			b: {
				c: 3,
			}
		};
		const path = ['a'];
		const result = getObjectPath(obj, path);
		const golden = 2;
		assert.strictEqual(result, golden);
	});

	it('basic single-level get of object', async () => {
		const obj = {
			a: 2,
			b: {
				c: 3,
			}
		};
		const path = ['b'];
		const result = getObjectPath(obj, path);
		const golden = obj['b'];
		assert.strictEqual(result, golden);
	});

	it('basic two-level get', async () => {
		const obj = {
			a: 2,
			b: {
				c: 3,
			}
		};
		const path = ['b', 'c'];
		const result = getObjectPath(obj, path);
		const golden = 3;
		assert.strictEqual(result, golden);
	});

	it('basic single-level get of missing key', async () => {
		const obj = {
			a: 2,
			b: {
				c: 3,
			}
		};
		const path = ['c'];
		const result = getObjectPath(obj, path);
		const golden = undefined;
		assert.strictEqual(result, golden);
	});

});

describe('objectPathToValue', () => {
	it('handles null object', async () => {
		const obj = null;
		const sentinel = 'foo';
		const result = objectPathToValue(obj, sentinel);
		const golden = undefined;
		assert.strictEqual(result, golden);
	});

	it('handles non-object object', async () => {
		const obj = 'abc';
		const sentinel = 'foo';
		const result = objectPathToValue(obj, sentinel);
		const golden = undefined;
		assert.strictEqual(result, golden);
	});

	it('handles basic value', async () => {
		const obj = {
			a: 'foo',
		};
		const sentinel = 'foo';
		const result = objectPathToValue(obj, sentinel);
		const golden = ['a'];
		assert.strictEqual(JSON.stringify(result), JSON.stringify(golden));
	});

	it('handles second-level value', async () => {
		const obj = {
			a: 2.0,
			b: {
				c: 'foo',
			}
		};
		const sentinel = 'foo';
		const result = objectPathToValue(obj, sentinel);
		const golden = ['b', 'c'];
		assert.strictEqual(JSON.stringify(result), JSON.stringify(golden));
	});

	it('handles non-existent value', async () => {
		const obj = {
			a: 2.0,
			b: {
				c: 'foo',
			}
		};
		const sentinel = 'food';
		const result = objectPathToValue(obj, sentinel);
		const golden = undefined;
		assert.strictEqual(JSON.stringify(result), JSON.stringify(golden));
	});
	

});
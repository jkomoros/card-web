/* eslint-env node, mocha, es2022 */
import assert from 'node:assert/strict';

import {cardFilterDomainMatches} from '../../lib/src/card-filter-domain.js';

describe('filter membership consumers', () => {
	it('checks the worker projection domain by own card IDs', () => {
		const existing = Object.fromEntries([['existing', {id:'existing'}]]);
		const incoming = Object.fromEntries([
			['__proto__', {id:'__proto__'}],
			['constructor', {id:'constructor'}],
			['toString', {id:'toString'}],
		]);
		assert.equal(cardFilterDomainMatches(existing, incoming, ['existing', '__proto__', 'constructor', 'toString']), true);
		assert.equal(cardFilterDomainMatches(existing, {}, ['existing', 'constructor']), false);
		assert.equal(cardFilterDomainMatches({}, {real:{id:'real'}}, ['constructor']), false);
		assert.equal(cardFilterDomainMatches(existing, incoming, ['existing', '__proto__', 'constructor']), false);
		assert.equal(cardFilterDomainMatches(existing, {second:{id:'second'}}, ['existing', 'existing']), false);
	});
});

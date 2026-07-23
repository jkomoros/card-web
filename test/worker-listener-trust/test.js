/*eslint-env node*/

import assert from 'assert';

import {listenerDocumentTrusted} from '../../lib/src/worker/listener-trust.js';

describe('worker listener watermark trust', () => {
	it('trusts only server-confirmed documents', () => {
		assert.equal(listenerDocumentTrusted(false, false), true);
		assert.equal(listenerDocumentTrusted(true, false), false);
		assert.equal(listenerDocumentTrusted(false, true), false);
		assert.equal(listenerDocumentTrusted(true, true), false);
	});
});

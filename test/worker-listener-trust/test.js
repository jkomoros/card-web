/*eslint-env node*/

import assert from 'assert';
import fs from 'fs';

import {listenerDocumentTrusted} from '../../lib/src/worker/listener-trust.js';

describe('worker listener watermark trust', () => {
	it('trusts only server-confirmed documents', () => {
		assert.equal(listenerDocumentTrusted(false, false), true);
		assert.equal(listenerDocumentTrusted(true, false), false);
		assert.equal(listenerDocumentTrusted(false, true), false);
		assert.equal(listenerDocumentTrusted(true, true), false);
	});

	it('applies document-level pending-write trust to the tombstone listener', () => {
		const worker = fs.readFileSync(new URL('../../src/worker/corpus-worker.ts', import.meta.url), 'utf8');
		const start = worker.indexOf('const attachTombstoneListener');
		const end = worker.indexOf('const attachDeltaListener', start);
		assert.ok(start >= 0 && end > start, 'could not isolate tombstone listener');
		const listener = worker.slice(start, end);
		assert.match(listener, /listenerDocumentTrusted\([\s\S]*snapshot\.metadata\.fromCache[\s\S]*change\.doc\.metadata\.hasPendingWrites/,
			'tombstone listener must reject both cached snapshots and pending documents');
		assert.ok(
			listener.indexOf('listenerDocumentTrusted(') < listener.indexOf("data({serverTimestamps: 'estimate'})"),
			'the pending-write check must happen before reading a client-estimated timestamp',
		);
	});
});

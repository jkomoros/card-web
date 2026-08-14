/*eslint-env node*/

import assert from 'assert';

let CORPUS_WORKER_PROTOCOL_VERSION;
let LEGACY_CORPUS_WORKER_PROTOCOL_VERSION;
let corpusWorkerProtocolCompatible;
let corpusWorkerProtocolVersion;

describe('corpus worker protocol compatibility', () => {
	before(async () => {
		({
			CORPUS_WORKER_PROTOCOL_VERSION,
			LEGACY_CORPUS_WORKER_PROTOCOL_VERSION,
			corpusWorkerProtocolCompatible,
			corpusWorkerProtocolVersion,
		} = await import('../../lib/src/worker/worker-protocol.js'));
	});

	it('accepts the matching page/worker protocol', () => {
		assert.strictEqual(corpusWorkerProtocolCompatible(CORPUS_WORKER_PROTOCOL_VERSION), true);
	});

	it('rejects a pre-handshake worker as legacy protocol zero', () => {
		//Deliberately pinned: bumping the protocol invalidates every cached
		//worker bundle, so it must be a conscious edit rather than a side
		//effect. Last bumped to 4 when per-user state (stars/reads/reading
		//list) moved into the worker; to 5 when sections and tags followed and the
		//page dropped its main-thread fallback for them.
		assert.strictEqual(CORPUS_WORKER_PROTOCOL_VERSION, 5);
		assert.strictEqual(LEGACY_CORPUS_WORKER_PROTOCOL_VERSION, 0);
		assert.strictEqual(corpusWorkerProtocolVersion(undefined), 0);
		assert.strictEqual(corpusWorkerProtocolCompatible(undefined), false);
	});

	it('rejects newer, older, and malformed protocol versions', () => {
		assert.strictEqual(corpusWorkerProtocolCompatible(CORPUS_WORKER_PROTOCOL_VERSION + 1), false);
		assert.strictEqual(corpusWorkerProtocolCompatible(CORPUS_WORKER_PROTOCOL_VERSION - 1), false);
		assert.strictEqual(corpusWorkerProtocolCompatible(String(CORPUS_WORKER_PROTOCOL_VERSION)), false);
	});
});

/*eslint-env node*/

//Source pins for the worker body (no unit harness): a runCollection whose
//filter reached the similarity fallback on a cold map waits for the sliced
//build instead of building synchronously, same-block requests chain behind
//it, and a stale concept change schedules a coalesced re-warm. Comments are
//stripped before matching so a `//TODO` cannot satisfy them. The engine
//half (what counts as cold, who throws) is behavioral: warmth.test.js.

import assert from 'assert';
import {readFileSync} from 'fs';
import path from 'path';

describe('corpus-worker warmth pins', () => {
	const source = readFileSync(path.resolve('src/worker/corpus-worker.ts'), 'utf8').replace(/\/\/[^\n]*/g, '');
	const slice = (startMarker, endMarker) => {
		const start = source.indexOf(startMarker);
		assert.ok(start > 0, 'found ' + startMarker);
		const end = source.indexOf(endMarker, start + startMarker.length);
		assert.ok(end > start, 'found the end of ' + startMarker);
		return source.slice(start, end);
	};

	it('a runCollection that comes back cold awaits the sliced build, then answers; same-block requests chain behind it', () => {
		const body = slice('const handleRunCollection = ', '\n};');
		assert.ok(/runCollectionRequest\(message, true\) === 'answered'\) return;/.test(body), 'the engine decides cold, not the description text');
		assert.ok(/await engine\.warmSimilarityFingerprints\(/.test(body), 'waits for the sliced build');
		assert.ok(body.indexOf('await engine.warmSimilarityFingerprints(') < body.indexOf('runCollectionRequest(message, false)'), 'and only then answers, synchronously if superseded');
		assert.ok(/deferredRunCollections\.get\(key\)/.test(body) && /prior\.then\(\(\) => handleRunCollection\(message\)\)/.test(body), 'a later request for the same block chains behind the deferred one');
		const caseBody = slice('case \'runCollection\':', 'case ');
		assert.ok(/handleRunCollection\(message\)/.test(caseBody), 'the message case routes through the handler');
		const request = slice('const runCollectionRequest = ', '\n};');
		assert.ok(/e instanceof SimilarityColdError\) return 'cold'/.test(request), 'the cold sentinel is the only error that defers');
	});

	it('updateLocalState schedules a coalesced re-warm when a concept change made the inputs stale, signed in only', () => {
		const body = slice('const updateLocalState = ', '\n};');
		assert.ok(/!initialLoadPending && currentUid && engine\.suggestInputsStale\(\)\) scheduleConceptRewarm\(\)/.test(body), 'stale inputs re-warm in the background');
		const rewarm = slice('const scheduleConceptRewarm = ', 'const scheduleIDFBuild');
		assert.ok(/clearTimeout\(conceptRewarmTimer\)/.test(rewarm) && /scheduleFingerprintWarmup\(\)/.test(rewarm), 'coalesced by a timer');
	});
});

/*eslint-env node*/

//THE ORDER IN WHICH A WORKER CARD BATCH IS APPLIED.
//
//`store.dispatch` runs every connected component's `stateChanged`
//synchronously, so any component — or any selector it calls — can throw back
//into whoever dispatched. The corpus bridge is the one place where that is not
//survivable: the worker's delta listener sends each change exactly once, so a
//batch abandoned because a render threw is lost until the tab reloads.
//
//`publishCorpusDetail()` used to be dispatched at the TOP of handleCardBatch,
//before the batch was even decoded. With one component throwing on every
//dispatch that single line turned a transient race into permanent loss: the
//worker held 500 cards while Redux stayed at 453.
//
//Reproducing the BEHAVIOUR needs a real worker plus a throwing component, which
//no test layer here has together. The ORDERING, though, is a structural
//property of one function — so pin it the way test/ownership-lease already pins
//purgeAndDeactivate, by reading the source. This is a weaker instrument than an
//execution test and it is chosen deliberately over having nothing: it catches
//the regression that actually happened (moving the dispatch back above the card
//apply, or unwrapping a step), which is the realistic way this breaks.
//
//Matching is deliberately anchored on CALL SITES, not prose: both function
//names also appear in the explanatory comments above the code, so a naive
//indexOf would pass on the comments alone.

import assert from 'assert';
import fs from 'fs';

const source = fs.readFileSync(new URL('../../src/corpus-bridge.ts', import.meta.url), 'utf8');

const handleCardBatch = (() => {
	const start = source.indexOf('const handleCardBatch = (batch : CardBatch) => {');
	assert.ok(start >= 0, 'could not find handleCardBatch');
	const end = source.indexOf('\n};', start);
	assert.ok(end > start, 'could not find the end of handleCardBatch');
	return source.slice(start, end);
})();

describe('worker card batches are applied before anything derived from them', () => {

	it('dispatches the cards BEFORE publishing corpus detail', () => {
		const cardsAt = handleCardBatch.indexOf('isolateDelivery(\'receiveCards\'');
		const detailAt = handleCardBatch.indexOf('isolateDelivery(\'publishCorpusDetail\'');
		assert.ok(cardsAt >= 0, 'receiveCards must be dispatched through isolateDelivery');
		assert.ok(detailAt >= 0, 'publishCorpusDetail must be dispatched through isolateDelivery');
		assert.ok(cardsAt < detailAt,
			'the cards must land first: a dispatch before them can throw from a subscriber and take the whole batch with it, and the delta listener never re-sends');
	});

	it('isolates every irreplaceable step of a delivery', () => {
		for (const step of ['receiveCards', 'removeCards', 'publishCorpusDetail']) {
			assert.ok(handleCardBatch.includes(`isolateDelivery('${step}'`),
				`${step} must be wrapped: one throwing subscriber must not abort the steps after it`);
		}
	});

	it('reports rather than rethrows, so the remaining steps still run', () => {
		const start = source.indexOf('const isolateDelivery = (');
		assert.ok(start >= 0, 'could not find isolateDelivery');
		const body = source.slice(start, source.indexOf('\n};', start));
		assert.match(body, /catch \(err\)/, 'isolateDelivery must catch');
		assert.match(body, /console\.error/, 'and must report — silent swallowing is how this class of bug hides');
		assert.doesNotMatch(body, /throw\b/, 'it must not rethrow, or it protects nothing');
	});

	it('keeps a backstop around the whole message handler', () => {
		const start = source.indexOf('const handleMessage = (');
		assert.ok(start >= 0, 'could not find handleMessage');
		const body = source.slice(start, source.indexOf('\n};', start));
		assert.match(body, /try \{[\s\S]*handleMessageInner\(event\)[\s\S]*catch/,
			'handleMessage must wrap handleMessageInner: every other case dispatches too, and a one-shot message half-applied is the worst outcome available');
		assert.match(body, /console\.error/, 'and must report it');
	});
});

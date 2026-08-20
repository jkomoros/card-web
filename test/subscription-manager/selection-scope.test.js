/*eslint-env node*/

//Pins the #760 fix: a selection toggle (Space on a card) is a single user
//keypress, and its flush must (a) skip every subscription whose description
//does not reference the selection filters, and (b) not wait out the 50ms
//batch-coalescing floor that exists to absorb ingestion bursts.

import assert from 'assert';

import {
	readFileSync
} from 'fs';

let QueryEngine;
let SubscriptionManager;
let SELECT_CARDS;
let UNSELECT_CARDS;
let CLEAR_SELECTED_CARDS;

const card = (id, extras) => ({
	id,
	card_type: 'content',
	title: 'Title of ' + id,
	body: '<p>Body of ' + id + '</p>',
	section: 'main',
	tags: [],
	sort_order: 1.0,
	references: {},
	references_info: {},
	references_inbound: {},
	references_info_inbound: {},
	auto_todo_overrides: {},
	published: true,
	...extras,
});

const params = (description) => ({
	description,
	keyCardID: '',
	uid: '',
	randomSalt: '',
	cardSimilarity: {},
});

describe('selection-scoped flushes (#760)', () => {
	before(async () => {
		({QueryEngine} = await import('../../lib/src/worker/query-engine.js'));
		({SubscriptionManager} = await import('../../lib/src/worker/subscription-manager.js'));
		({SELECT_CARDS, UNSELECT_CARDS, CLEAR_SELECTED_CARDS} = await import('../../lib/src/actions.js'));
	});

	//Wraps the engine so runCollection calls per description can be counted.
	const setup = (flushDelayMs = 50) => {
		const engine = new QueryEngine();
		engine.updateCards({
			a: card('a', {sort_order: 3.0}),
			b: card('b', {sort_order: 2.0}),
			c: card('c', {sort_order: 1.0}),
		}, []);
		const runCounts = {};
		const countingEngine = {
			runCollection: (description, opts) => {
				runCounts[description] = (runCounts[description] || 0) + 1;
				return engine.runCollection(description, opts);
			},
		};
		const pushes = [];
		const manager = new SubscriptionManager(countingEngine, push => pushes.push(push), flushDelayMs);
		return {engine, manager, pushes, runCounts};
	};

	it('a selection-only change skips subscriptions that do not reference selection', () => {
		const {engine, manager, pushes, runCounts} = setup();
		manager.subscribe(1, params('everything/'));
		manager.subscribe(2, params('everything/selected/'));
		manager.flush();
		assert.strictEqual(runCounts['everything/'], 1);
		assert.strictEqual(runCounts['everything/selected/'], 1);
		assert.strictEqual(pushes.length, 2);

		engine.applyAction({type: SELECT_CARDS, cards: ['b']});
		manager.markDirty('selection');
		manager.flush();
		//The plain collection was NOT recomputed; the selection one was, and
		//its new result was pushed.
		assert.strictEqual(runCounts['everything/'], 1, 'non-selection subscription must not recompute on a selection toggle');
		assert.strictEqual(runCounts['everything/selected/'], 2);
		assert.strictEqual(pushes.length, 3);
		assert.deepStrictEqual(pushes[2].ids, ['b']);
		assert.strictEqual(pushes[2].subscriptionID, 2);
	});

	it('not-selected descriptions also count as selection-dependent', () => {
		const {engine, manager, pushes, runCounts} = setup();
		manager.subscribe(1, params('everything/not-selected/'));
		manager.flush();
		assert.deepStrictEqual(pushes[0].ids, ['a', 'b', 'c']);
		engine.applyAction({type: SELECT_CARDS, cards: ['a']});
		manager.markDirty('selection');
		manager.flush();
		assert.strictEqual(runCounts['everything/not-selected/'], 2);
		assert.deepStrictEqual(pushes[1].ids, ['b', 'c']);
	});

	it('a subscription added during a selection burst still gets its first result', () => {
		const {manager, pushes} = setup();
		manager.markDirty('selection');
		manager.subscribe(9, params('everything/'));
		manager.flush();
		assert.strictEqual(pushes.length, 1);
		assert.strictEqual(pushes[0].subscriptionID, 9);
	});

	it('mixed dirt (selection + anything else) recomputes everything', () => {
		const {engine, manager, runCounts} = setup();
		manager.subscribe(1, params('everything/'));
		manager.flush();
		engine.applyAction({type: SELECT_CARDS, cards: ['b']});
		manager.markDirty('selection');
		manager.markDirty();
		manager.flush();
		assert.strictEqual(runCounts['everything/'], 2, 'mixed-scope flush must recompute everything');
	});

	it('unselect and clear are selection-scoped too', () => {
		const {engine, manager, runCounts, pushes} = setup();
		manager.subscribe(1, params('everything/selected/'));
		engine.applyAction({type: SELECT_CARDS, cards: ['a', 'b']});
		manager.flush();
		assert.deepStrictEqual(pushes[0].ids, ['a', 'b']);
		engine.applyAction({type: UNSELECT_CARDS, cards: ['a']});
		manager.markDirty('selection');
		manager.flush();
		assert.deepStrictEqual(pushes[1].ids, ['b']);
		engine.applyAction({type: CLEAR_SELECTED_CARDS});
		manager.markDirty('selection');
		manager.flush();
		assert.deepStrictEqual(pushes[2].ids, []);
		assert.strictEqual(runCounts['everything/selected/'], 3);
	});

	it('a selection flush bypasses the coalescing delay', async () => {
		//Generous floor so a scheduler hiccup cannot make the fast path
		//accidentally pass: if selection waited the full floor, the check at
		//~40ms would see no push.
		const {engine, manager, pushes} = setup(30000);
		manager.subscribe(1, params('everything/selected/'));
		manager.flush();
		assert.strictEqual(pushes.length, 1);
		engine.applyAction({type: SELECT_CARDS, cards: ['c']});
		manager.markDirty('selection');
		await new Promise(resolve => setTimeout(resolve, 40));
		assert.strictEqual(pushes.length, 2, 'selection push must not wait out the coalescing floor');
		assert.deepStrictEqual(pushes[1].ids, ['c']);
	});

	it('corpus-worker maps exactly the three selection actions to the selection scope', () => {
		//Source-text pin (repo convention, e.g. test/worker-listener-trust):
		//the manager tests above drive markDirty('selection') by hand, so
		//without this nothing asserts the real forwarded-action wiring. The
		//failure direction of an UNLISTED action is safe ('all' = correct but
		//slow); the dangerous drift is a non-selection action being added to
		//the selection branch.
		const source = readFileSync(new URL('../../src/worker/corpus-worker.ts', import.meta.url), 'utf8');
		const branch = source.match(/subscriptions\.markDirty\(\s*\n?\s*action\.type === ([^)]+)\? 'selection' : 'all'\)/);
		assert.ok(branch, 'corpus-worker must scope forwarded-action dirt by action type');
		const condition = branch[1];
		for (const expected of ['SELECT_CARDS', 'UNSELECT_CARDS', 'CLEAR_SELECTED_CARDS']) {
			assert.ok(condition.includes(expected), `selection scope must include ${expected}`);
		}
		const referenced = condition.match(/[A-Z][A-Z_]+/g) || [];
		assert.deepStrictEqual([...new Set(referenced)].sort(), ['CLEAR_SELECTED_CARDS', 'SELECT_CARDS', 'UNSELECT_CARDS'],
			'only the selection actions may map to the selection scope');
	});

	it('a selection markDirty pulls an already-scheduled slow flush forward', async () => {
		const {engine, manager, pushes} = setup(30000);
		manager.subscribe(1, params('everything/selected/'));
		manager.flush();
		//An 'all' markDirty schedules at the slow floor…
		engine.updateCards({d: card('d', {sort_order: 9.0})}, []);
		manager.markDirty();
		//…then a selection keypress lands. The flush must not sit behind the
		//floor; and because the dirt is now mixed, everything recomputes.
		engine.applyAction({type: SELECT_CARDS, cards: ['d']});
		manager.markDirty('selection');
		await new Promise(resolve => setTimeout(resolve, 40));
		assert.strictEqual(pushes.length, 2);
		assert.deepStrictEqual(pushes[1].ids, ['d']);
	});
});

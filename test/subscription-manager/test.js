/*eslint-env node*/

import assert from 'assert';

let QueryEngine;
let SubscriptionManager;
let UPDATE_STARS;

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

describe('SubscriptionManager', () => {
	before(async () => {
		({QueryEngine} = await import('../../lib/src/worker/query-engine.js'));
		({SubscriptionManager} = await import('../../lib/src/worker/subscription-manager.js'));
		({UPDATE_STARS} = await import('../../lib/src/actions.js'));
	});

	const setup = () => {
		const engine = new QueryEngine();
		engine.updateCards({
			a: card('a', {sort_order: 3.0}),
			b: card('b', {sort_order: 2.0}),
			c: card('c', {sort_order: 1.0}),
		}, []);
		const pushes = [];
		const manager = new SubscriptionManager(engine, push => pushes.push(push));
		return {engine, manager, pushes};
	};

	const params = (description) => ({
		description,
		keyCardID: '',
		uid: '',
		randomSalt: '',
		cardSimilarity: {},
	});

	it('pushes an initial result and only re-pushes on change', async () => {
		const {engine, manager, pushes} = setup();
		manager.subscribe(1, params('everything/'));
		manager.flush();
		assert.strictEqual(pushes.length, 1);
		assert.deepStrictEqual(pushes[0].ids, ['a', 'b', 'c']);
		//A flush with no relevant change pushes nothing.
		manager.markDirty();
		manager.flush();
		assert.strictEqual(pushes.length, 1);
		//A change that affects the result pushes again.
		engine.updateCards({d: card('d', {sort_order: 9.0})}, []);
		manager.flush();
		assert.strictEqual(pushes.length, 2);
		assert.deepStrictEqual(pushes[1].ids, ['d', 'a', 'b', 'c']);
	});

	it('tracks filter membership changes from replayed actions', async () => {
		const {engine, manager, pushes} = setup();
		manager.subscribe(7, params('everything/starred/'));
		manager.flush();
		assert.deepStrictEqual(pushes[0].ids, []);
		engine.applyAction({type: UPDATE_STARS, starsToAdd: ['b'], starsToRemove: []});
		manager.flush();
		assert.strictEqual(pushes.length, 2);
		assert.deepStrictEqual(pushes[1].ids, ['b']);
		assert.strictEqual(pushes[1].subscriptionID, 7);
	});

	it('unsubscribe stops pushes', async () => {
		const {engine, manager, pushes} = setup();
		manager.subscribe(1, params('everything/'));
		manager.flush();
		manager.unsubscribe(1);
		engine.updateCards({e: card('e')}, []);
		manager.flush();
		assert.strictEqual(pushes.length, 1);
		assert.strictEqual(manager.size, 0);
	});

	it('supports multiple concurrent subscriptions', async () => {
		const {engine, manager, pushes} = setup();
		manager.subscribe(1, params('everything/'));
		manager.subscribe(2, params('everything/starred/'));
		manager.flush();
		assert.strictEqual(pushes.length, 2);
		engine.applyAction({type: UPDATE_STARS, starsToAdd: ['a'], starsToRemove: []});
		manager.flush();
		//Only the starred subscription's result changed.
		assert.strictEqual(pushes.length, 3);
		assert.strictEqual(pushes[2].subscriptionID, 2);
		assert.deepStrictEqual(pushes[2].ids, ['a']);
	});

	//The initial-load window: the main thread subscribes at CONNECT so the
	//first result can ride behind the prime's card batches, and the pause
	//keeps every mid-load batch from burning an O(corpus) recompute on a
	//push the bridge would drop.
	it('pause holds all computation; resume flushes synchronously', async () => {
		const {engine, manager, pushes} = setup();
		manager.pause();
		manager.subscribe(1, params('everything/'));
		//Explicit flush while paused is refused wholesale — otherwise the
		//results would be marked pushed without being delivered.
		manager.flush();
		assert.strictEqual(pushes.length, 0);
		engine.updateCards({d: card('d', {sort_order: 9.0})}, []);
		manager.markDirty();
		manager.flush();
		assert.strictEqual(pushes.length, 0);
		//Resume delivers the CURRENT state, synchronously, exactly once.
		manager.resume();
		assert.strictEqual(pushes.length, 1);
		assert.deepStrictEqual(pushes[0].ids, ['d', 'a', 'b', 'c']);
		//Resuming again is a no-op…
		manager.resume();
		assert.strictEqual(pushes.length, 1);
		//…and normal operation continues after resume.
		engine.updateCards({e: card('e', {sort_order: 99.0})}, []);
		manager.flush();
		assert.strictEqual(pushes.length, 2);
		assert.deepStrictEqual(pushes[1].ids, ['e', 'd', 'a', 'b', 'c']);
	});
});

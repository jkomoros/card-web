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

	//The worker mirrors the editing card on every extraction while the user
	//types. Only subscriptions that can read it may change; on the real
	//corpus the undirected recompute was the largest warm worker cost.
	const countingSetup = () => {
		const {engine, manager, pushes} = setup();
		const runs = [];
		const original = engine.runCollection.bind(engine);
		engine.runCollection = (description, options) => { runs.push(description); return original(description, options); };
		return {engine, manager, pushes, runs};
	};

	it('recomputes only editing-card-dependent subscriptions on editing dirt', () => {
		const {engine, manager, pushes, runs} = countingSetup();
		//Serialized descriptions end in '/'; without it the last piece parses
		//as a selected card and the configurable filter silently vanishes.
		const CHILDREN = 'everything/children/a/';
		const SIMILAR = 'everything/similar/a/';
		manager.subscribe(1, params('everything/'));
		manager.subscribe(2, params(SIMILAR));
		manager.subscribe(3, params(CHILDREN));
		manager.subscribe(4, params('everything/unread/'));
		manager.flush();
		const childrenBefore = pushes.find(push => push.subscriptionID === 3).ids;
		assert.deepStrictEqual(childrenBefore, [], 'a has no links yet');
		runs.length = 0;
		//The draft adds a link a→c: the children collection must change,
		//and only the dependent subscriptions may run.
		const draft = {...engine._ensureProcessedCards().a, references: {c: true}, references_info: {c: {link: ''}}};
		engine.setEditingCard(draft, null);
		manager.markDirty('editing');
		manager.flush();
		assert.deepStrictEqual(runs.sort(), [CHILDREN, SIMILAR]);
		assert.deepStrictEqual(pushes[pushes.length - 1].subscriptionID === 3 ? pushes[pushes.length - 1].ids : pushes.filter(push => push.subscriptionID === 3).pop().ids, ['c']);
		//Clearing the draft reverts it, through the same scoped path.
		runs.length = 0;
		engine.setEditingCard(null, null);
		manager.markDirty('editing');
		manager.flush();
		assert.deepStrictEqual(runs.sort(), [CHILDREN, SIMILAR]);
		assert.deepStrictEqual(pushes.filter(push => push.subscriptionID === 3).pop().ids, []);
		//A subscription that has never been pushed always computes, alongside
		//the dependent ones; the independent pushed ones still skip.
		manager.subscribe(5, params('everything/starred/'));
		runs.length = 0;
		manager.markDirty('editing');
		manager.flush();
		assert.deepStrictEqual(runs.sort(), [CHILDREN, SIMILAR, 'everything/starred/']);
		//Mixed dirt widens to everything.
		runs.length = 0;
		manager.markDirty('editing');
		manager.markDirty();
		manager.flush();
		assert.strictEqual(runs.length, 5);
	});

	it('recomputes only the subscriptions naming a viewer-state set on that set\'s dirt', () => {
		//The auto-read a few seconds after every navigation delivered an
		//UPDATE_READS that re-ran every open subscription; only ones naming
		//read/unread can differ. Same for stars and the reading list.
		const {engine, manager, runs} = countingSetup();
		const UNREAD = 'everything/unread/';
		const STARRED = 'everything/starred/';
		const NOT_STARRED = 'everything/unstarred/';
		const READING_LIST_SET = 'reading-list/';
		const NOT_IN_LIST = 'everything/not-in-reading-list/';
		const CHILDREN = 'everything/children/a/';
		manager.subscribe(1, params('everything/'));
		manager.subscribe(2, params(UNREAD));
		manager.subscribe(3, params(STARRED));
		manager.subscribe(4, params(NOT_STARRED));
		manager.subscribe(5, params(READING_LIST_SET));
		manager.subscribe(6, params(NOT_IN_LIST));
		manager.subscribe(7, params(CHILDREN));
		//A union member and a configurable sub-expression embed the piece;
		//a query that merely contains the word does not name the filter.
		const UNION = 'everything/starred+unread/';
		const EXCLUDED = 'everything/exclude/read/';
		const QUERY = 'everything/query/already read this/';
		manager.subscribe(8, params(UNION));
		manager.subscribe(9, params(EXCLUDED));
		manager.subscribe(10, params(QUERY));
		manager.flush();
		for (const [scope, expected] of [
			['reads', [UNREAD, UNION, EXCLUDED]],
			['stars', [STARRED, NOT_STARRED, UNION]],
			['reading-list', [NOT_IN_LIST, READING_LIST_SET]],
		]) {
			runs.length = 0;
			manager.markDirty(scope);
			manager.flush();
			assert.deepStrictEqual(runs.sort(), [...expected].sort(), `${scope} dirt`);
		}
		//The dirt is real: reads delivered for 'a' change the unread result.
		runs.length = 0;
		engine.applyAction({type: 'UPDATE_READS', readsToAdd: ['a'], readsToRemove: []});
		manager.markDirty('reads');
		manager.flush();
		assert.deepStrictEqual(runs.sort(), [UNREAD, UNION, EXCLUDED].sort());
		//Mixed dirt widens to everything.
		runs.length = 0;
		manager.markDirty('reads');
		manager.markDirty('stars');
		manager.flush();
		assert.strictEqual(runs.length, 10);
	});

	it('pins EDITING_CARD_FILTER_NAMES to the registry factories that read the editing card', async () => {
		const {CONFIGURABLE_FILTER_INFO} = await import('../../lib/src/filters.js');
		const {EDITING_CARD_FILTER_NAMES, descriptionMayReadEditingCard} = await import('../../lib/src/filter-constants.js');
		//filters.ts reads extras.editingCard in exactly these factories. This
		//catches a new filter NAME registered on one of them, and a rename of
		//one of them (loudly). It cannot catch a DIFFERENT factory starting
		//to read extras.editingCard: that is a reviewer's job — grep
		//`extras.editingCard` in filters.ts when touching a factory.
		const readers = new Set(['makeCardLinksConfigurableFilter', 'makeSimilarConfigurableFilter', 'makeExpandConfigurableFilter']);
		const expected = Object.entries(CONFIGURABLE_FILTER_INFO).filter(([, info]) => readers.has(info.factory.name)).map(([name]) => name).sort();
		assert.deepStrictEqual([...EDITING_CARD_FILTER_NAMES].sort(), expected);
		assert.ok(descriptionMayReadEditingCard('main/similar/x'));
		assert.ok(descriptionMayReadEditingCard('everything/exclude/children/a'));
		assert.ok(!descriptionMayReadEditingCard('everything/unread'));
		assert.ok(!descriptionMayReadEditingCard('reading-list/'));
	});

	it('flushImmediately is leading-edge only: a burst coalesces onto the batching floor', async () => {
		const {engine, manager, pushes} = setup();
		manager.subscribe(1, params('everything/'));
		manager.flush();
		assert.strictEqual(pushes.length, 1);
		//First interactive echo after an idle stretch: flushes in this turn.
		//(subscribe() scheduled its own prompt flush at the 50ms floor; wait
		//long enough that it has fired AND its end is more than a floor ago,
		//so the manager is genuinely idle.)
		await new Promise(resolve => setTimeout(resolve, 150));
		engine.updateCards({d: card('d', {sort_order: 9.0})}, []);
		manager.markDirty();
		manager.flushImmediately();
		assert.strictEqual(pushes.length, 2, 'the first echo after idle must flush immediately');
		//A burst right behind it must NOT pay a full recompute per echo — at a
		//large corpus that wedged the worker for the length of the burst and
		//froze every navigation's subscribe message queued behind it. The
		//burst falls back to the flush markDirty scheduled.
		engine.updateCards({e: card('e', {sort_order: 10.0})}, []);
		manager.markDirty();
		manager.flushImmediately();
		engine.updateCards({f: card('f', {sort_order: 11.0})}, []);
		manager.markDirty();
		manager.flushImmediately();
		assert.strictEqual(pushes.length, 2, 'echoes within the floor of the last flush must coalesce');
		//The scheduled flush then covers the whole burst in ONE recompute.
		await new Promise(resolve => setTimeout(resolve, 80));
		assert.strictEqual(pushes.length, 3, 'one coalesced flush must cover the burst');
		assert.deepStrictEqual(pushes[2].ids, ['f', 'e', 'd', 'a', 'b', 'c']);
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

	//#731: a collection run that THROWS used to be indistinguishable from one
	//that legitimately matched nothing — the subscription simply never pushed,
	//and the only trace was a console.warn inside the worker. That silence is
	//what made a one-line type bug take so long to find.
	describe('a throwing subscription reports instead of silently rendering empty', () => {

		const throwingSetup = () => {
			const engine = new QueryEngine();
			engine.updateCards({a: card('a')}, []);
			const pushes = [];
			const errors = [];
			const manager = new SubscriptionManager(engine, push => pushes.push(push), undefined, (subscriptionID, description, error) => errors.push({subscriptionID, description, error}));
			//Make the engine's collection run throw the way a filter blowing up
			//on a prototype-stripped Timestamp did.
			engine.runCollection = () => {
				throw new TypeError('val.toMillis is not a function');
			};
			return {engine, manager, pushes, errors};
		};

		it('calls onError with the subscription, description and the error', () => {
			const {manager, pushes, errors} = throwingSetup();
			manager.subscribe(1, params('everything/'));
			manager.flush();
			assert.strictEqual(pushes.length, 0, 'nothing should be pushed for a failed run');
			assert.strictEqual(errors.length, 1, 'the failure must be reported, not swallowed');
			assert.strictEqual(errors[0].subscriptionID, 1);
			assert.strictEqual(errors[0].description, 'everything/');
			assert.ok(String(errors[0].error).includes('toMillis'), 'the original error should be carried through');
		});

		it('reports first-only per (subscription, message), and recovery exactly once (#739)', () => {
			//Measured pre-fix: 200 flushes × 3 throwing subscriptions = 600
			//onError calls — the console became useless exactly when it was
			//needed. A persisting failure reports once; a CHANGED message
			//reports again; recovery reports once with error null even when
			//the recovered result equals the last pushed one.
			const engine = new QueryEngine();
			engine.updateCards({a: card('a')}, []);
			const pushes = [];
			const errors = [];
			const manager = new SubscriptionManager(engine, push => pushes.push(push), undefined, (subscriptionID, description, error) => errors.push({subscriptionID, description, error}));
			const realRun = engine.runCollection.bind(engine);
			let failure = 'first boom';
			engine.runCollection = (description, opts) => {
				if (failure) throw new TypeError(failure);
				return realRun(description, opts);
			};
			manager.subscribe(1, params('everything/'));
			for (let i = 0; i < 50; i++) {
				manager.markDirty();
				manager.flush();
			}
			assert.strictEqual(errors.length, 1, 'a persisting failure reports exactly once');
			failure = 'second boom';
			manager.flush();
			assert.strictEqual(errors.length, 2, 'a CHANGED message reports again');
			assert.ok(String(errors[1].error).includes('second boom'));
			//Recover. The subscription has never pushed, so the first healthy
			//run pushes AND reports recovery.
			failure = '';
			manager.flush();
			assert.strictEqual(errors.length, 3, 'recovery must be reported');
			assert.strictEqual(errors[2].error, null, 'recovery is signaled with error null');
			assert.strictEqual(pushes.length, 1);
			//A healthy steady state reports nothing further, and a repeat
			//failure after recovery reports again.
			manager.flush();
			assert.strictEqual(errors.length, 3);
			failure = 'first boom';
			manager.flush();
			assert.strictEqual(errors.length, 4, 'a failure after recovery reports again');
		});

		it('reports recovery even when the recovered result equals the last push', () => {
			const engine = new QueryEngine();
			engine.updateCards({a: card('a')}, []);
			const errors = [];
			const manager = new SubscriptionManager(engine, () => undefined, undefined, (subscriptionID, description, error) => errors.push({error}));
			const realRun = engine.runCollection.bind(engine);
			manager.subscribe(1, params('everything/'));
			manager.flush();
			//Healthy push happened. Now fail, then recover with an UNCHANGED
			//result: no push follows, so the explicit recovery signal is the
			//only thing keeping the UI from showing a failure forever.
			engine.runCollection = () => { throw new TypeError('transient'); };
			manager.flush();
			engine.runCollection = realRun;
			manager.flush();
			assert.deepStrictEqual(errors.map(e => e.error === null), [false, true]);
		});

		it('does not let one failing subscription stop the others', () => {
			const engine = new QueryEngine();
			engine.updateCards({a: card('a'), b: card('b', {sort_order: 0.5})}, []);
			const pushes = [];
			const errors = [];
			const manager = new SubscriptionManager(engine, push => pushes.push(push), undefined, (subscriptionID, description, error) => errors.push({subscriptionID, description, error}));
			const realRun = engine.runCollection.bind(engine);
			engine.runCollection = (description, opts) => {
				if (description === 'everything/') throw new TypeError('boom');
				return realRun(description, opts);
			};
			manager.subscribe(1, params('everything/'));
			manager.subscribe(2, params('has-body/'));
			manager.flush();
			assert.strictEqual(errors.length, 1, 'the broken subscription reports');
			assert.strictEqual(pushes.length, 1, 'the healthy subscription still pushes');
			assert.strictEqual(pushes[0].subscriptionID, 2);
		});

		it('is optional — omitting onError keeps the old resilient behaviour', () => {
			const engine = new QueryEngine();
			engine.updateCards({a: card('a')}, []);
			const pushes = [];
			const manager = new SubscriptionManager(engine, push => pushes.push(push));
			engine.runCollection = () => { throw new TypeError('boom'); };
			manager.subscribe(1, params('everything/'));
			assert.doesNotThrow(() => manager.flush());
			assert.strictEqual(pushes.length, 0);
		});
	});

	//#736: the configurable-filter memo was dead, and enabling it alone would
	//NOT have helped the path that matters. QueryEngine._filters() returned a
	//fresh object literal per call, so the extras identity the memo keys on was
	//fresh on every runCollection — and the worker-served path is the DEFAULT.
	//These pin both halves.
	describe('configurable-filter work is reused across flushes', () => {



		it('keeps _filters() identity stable so extras can be memoized', () => {
			const engine = new QueryEngine();
			engine.updateCards({a: card('a'), b: card('b')}, []);
			const identities = new Set([engine._filters(), engine._filters(), engine._filters()]);
			assert.strictEqual(identities.size, 1, '_filters() must not return a fresh object per call');
		});

		//NOTE: deliberately NO test here asserting the memo avoids a corpus
		//re-scan. Two such tests were written and DELETED: a counting getter on
		//card.created fires during card PROCESSING (processCard spreads the card,
		//which invokes the getter once and stores a plain value), not during
		//filter evaluation — so they passed even with the memo entirely disabled.
		//The memo's hit/miss behaviour is covered where it is genuinely
		//observable, in test/collection, which filters over the raw cards map.
		//What IS pinned here is the precondition that fix depends on: stable
		//_filters() identity.
	});

});

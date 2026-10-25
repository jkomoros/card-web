/*eslint-env node, es2022*/

//A DATE-RELATIVE COLLECTION ROLLS OVER AT MIDNIGHT (#780, filed as an open
//exposure; it is not one). The bridge keys a worker subscription on the local
//day when its description uses relative dates, so a pass over the live slots
//after midnight unsubscribes yesterday's run and subscribes today's — and a
//midnight timer makes that pass happen in a tab that dispatches nothing.
//Driven through the real bridge against a fake worker, with the clock faked:
//`Date` is replaced by a subclass whose "now" the test moves, which is what
//both the day key and the timer read.

import assert from 'assert';
import {readFile} from 'fs/promises';
import {JSDOM} from 'jsdom';

const dom = new JSDOM('', {url: 'https://example.com/c/main/a'});
for (const name of [
	'window', 'document', 'Document', 'HTMLElement', 'Element', 'Node',
	'customElements', 'CSSStyleSheet', 'Event', 'CustomEvent', 'MouseEvent',
	'InputEvent', 'KeyboardEvent', 'ShadowRoot', 'HTMLInputElement',
	'HTMLButtonElement', 'HTMLSelectElement', 'HTMLTextAreaElement', 'HTMLSlotElement',
	'navigator', 'getComputedStyle', 'MutationObserver', 'requestAnimationFrame',
	'DocumentFragment', 'HTMLImageElement', 'HTMLAnchorElement',
]) globalThis[name] = name === 'window' ? dom.window : name === 'document' ? dom.window.document : dom.window[name];
globalThis.location = dom.window.location;
globalThis.history = dom.window.history;
globalThis.BroadcastChannel = class { addEventListener() {} removeEventListener() {} postMessage() {} close() {} };

//A controllable clock. `new Date()` and `Date.now()` read it; explicit
//arguments pass through untouched, so date parsing in the app is unaffected.
const RealDate = Date;
let fakeNow = new RealDate(2026, 9, 25, 23, 50, 0).getTime();
class FakeDate extends RealDate {
	constructor(...args) {
		if (args.length === 0) super(fakeNow);
		else super(...args);
	}
	static now() { return fakeNow; }
}
globalThis.Date = FakeDate;

class FakeWorker {
	static current;
	constructor() {
		this.sent = [];
		this.listeners = new Map();
		FakeWorker.current = this;
	}
	postMessage(message) { this.sent.push(message); }
	addEventListener(type, listener) { this.listeners.set(type, listener); }
	terminate() {}
	deliver(message) { this.listeners.get('message')?.({data: message}); }
	ofType(type) { return this.sent.filter(message => message.type === type); }
}
globalThis.Worker = FakeWorker;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const DESCRIPTION = 'everything/updated/after/today/';

describe('a date-relative collection rolls over at midnight', () => {
	let store;
	let bridge;
	let generation;
	const card = {id: 'a', name: 'a', card_type: 'content', section: 'main', title: 'A', body: '<p>a</p>', tags: [], published: true, sort_order: 2, references: {}, references_info: {}, references_inbound: {}, references_info_inbound: {}, auto_todo_overrides: {}};

	before(async () => {
		({store} = await import('../../lib/src/store.js'));
		const [{default: app}, {default: data}, {default: collection}] = await Promise.all([
			import('../../lib/src/reducers/app.js'), import('../../lib/src/reducers/data.js'), import('../../lib/src/reducers/collection.js'),
		]);
		const {CollectionDescription} = await import('../../lib/src/collection_description.js');
		const initial = {...store.getState(), collection: collection(undefined, {type: '@@INIT'})};
		store.replaceReducer((state = initial, action) => {
			if (action.type === 'TEST_PATCH') return {...state, ...action.changes};
			return {...state, app: app(state.app, action), data: data(state.data, action), collection: collection(state.collection, action)};
		});
		store.dispatch({type: 'TEST_PATCH', changes: {
			data: {...initial.data, cards: {a: card}},
			collection: {...initial.collection, active: CollectionDescription.deserialize(DESCRIPTION).configuration, activeCardID: 'a'},
			editor: {editing: false},
			find: {open: false, activeQuery: '', queryIsLiteral: false},
		}});
		bridge = await import('../../lib/src/corpus-bridge.js');
		bridge.corpusWorkerConnectCards(false, '');
		const connect = FakeWorker.current.ofType('connect').at(-1);
		generation = connect.generation;
		FakeWorker.current.deliver({type: 'loadComplete', generation, corpusSize: 1, snapshotAgeMs: 0});
		assert.ok(bridge.corpusWorkerCanRunCollections());
	});

	it('resubscribes the active collection once the local day changes, and only then', async () => {
		const worker = FakeWorker.current;
		await sleep(1100);
		const subscriptions = () => worker.ofType('subscribeCollection').filter(message => message.description === DESCRIPTION);
		assert.strictEqual(subscriptions().length, 1, 'subscribed once for today');
		//Dispatches before midnight change nothing: the key is stable within a day.
		store.dispatch({type: 'UNRELATED_ACTION'});
		await sleep(1100);
		assert.strictEqual(subscriptions().length, 1, 'the same day keeps the subscription');
		assert.strictEqual(worker.ofType('unsubscribeCollection').length, 0);
		//Midnight passes. The next pass over the live slots sees a new day key.
		fakeNow += 15 * 60 * 1000;
		store.dispatch({type: 'UNRELATED_ACTION'});
		await sleep(1100);
		assert.strictEqual(worker.ofType('unsubscribeCollection').length, 1, 'yesterday\'s run is unsubscribed');
		assert.strictEqual(subscriptions().length, 2, 'and today\'s is subscribed, so the worker runs the filters afresh');
	});

	it('has a timer for the tab that dispatches nothing overnight', async () => {
		//The timer fires hours away on the real clock, so its wiring is pinned
		//where it lives (comment-stripped): scheduled when the comparator
		//starts, running the live-slot pass, and rescheduling itself.
		const source = (await readFile(new URL('../../src/corpus-bridge.ts', import.meta.url), 'utf8')).replace(/^\s*\/\/.*$/gm, '');
		const timer = source.slice(source.indexOf('const scheduleRelativeDateRollover = '), source.indexOf('const startShadowComparator = '));
		assert.match(timer, /nextMidnight\.setDate\(nextMidnight\.getDate\(\) \+ 1\);\s*nextMidnight\.setHours\(0, 0, 0, 0\);/);
		assert.match(timer, /relativeDateRolloverTimer = setTimeout\(\(\) => \{\s*relativeDateRolloverTimer = null;\s*runShadowCompare\(\);\s*scheduleRelativeDateRollover\(\);/);
		const start = source.slice(source.indexOf('const startShadowComparator = '), source.indexOf('const stopShadowComparator') > 0 ? source.indexOf('const stopShadowComparator') : source.length);
		assert.match(start, /scheduleRelativeDateRollover\(\);/, 'armed when the comparator starts');
		//And the day is part of the key only for descriptions that need it.
		assert.match(source, /const dayKey = descriptionUsesRelativeDates\(description\) \? '\|' \+ relativeDateCacheKey\(\) : '';/);
	});
});

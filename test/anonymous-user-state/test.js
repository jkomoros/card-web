/*eslint-env node, es2022*/

//AN ANONYMOUS SESSION OWNS ITS OWN STARS, READS AND READING LIST (#788).
//
//Anonymous users may star, mark read and keep a reading list, and their
//documents live under their uid like anyone else's. In worker mode the
//bridge used to tell the worker NOT to attach the per-user listeners for an
//anonymous session, on the claim that "an anonymous account cannot own a
//star", and the main thread delivered empty sets instead — so every
//anonymous visitor's stars and reads looked lost on each reload. Driven
//through the real bridge against a fake worker, plus comment-stripped
//source pins on the one place that used to deliver the empty sets.

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

const stripped = async (path) => (await readFile(new URL('../../' + path, import.meta.url), 'utf8')).replace(/^\s*\/\/.*$/gm, '');

describe('an anonymous session owns its per-user state in the worker', () => {
	let store;
	let bridge;
	let patch;

	before(async () => {
		({store} = await import('../../lib/src/store.js'));
		const [{default: app}, {default: data}, {default: collection}, {default: user}] = await Promise.all([
			import('../../lib/src/reducers/app.js'), import('../../lib/src/reducers/data.js'), import('../../lib/src/reducers/collection.js'), import('../../lib/src/reducers/user.js'),
		]);
		const initial = {...store.getState(), collection: collection(undefined, {type: '@@INIT'}), user: user(undefined, {type: '@@INIT'})};
		store.replaceReducer((state = initial, action) => {
			if (action.type === 'TEST_PATCH') return {...state, ...action.changes};
			return {...state, app: app(state.app, action), data: data(state.data, action), collection: collection(state.collection, action), user: user(state.user, action)};
		});
		patch = changes => store.dispatch({type: 'TEST_PATCH', changes});
		bridge = await import('../../lib/src/corpus-bridge.js');
	});

	it('tells the worker to own user state on the reconnect that carries an anonymous uid', () => {
		//The first connect is pre-auth: no uid, nothing to attach. (It owned
		//user state before this change too — the anonymity gate read a null
		//user as not anonymous — so the proof is the reconnect below.)
		patch({user: {...store.getState().user, user: null}});
		bridge.corpusWorkerConnectCards(false, '');
		const worker = FakeWorker.current;
		const connect = worker.ofType('connect').at(-1);
		assert.ok(connect, 'the real bridge connects');
		assert.strictEqual(connect.ownsUserState, true);
		//Anonymous auth resolves: the reconnect carries the uid and still owns.
		patch({user: {...store.getState().user, user: {uid: 'anon-1', isAnonymous: true, photoURL: '', displayName: '', email: ''}}});
		bridge.corpusWorkerConnectCards(false, 'anon-1');
		const reconnect = worker.ofType('reconnect').at(-1);
		assert.ok(reconnect, 'a second connect with a uid is a reconnect');
		assert.strictEqual(reconnect.uid, 'anon-1');
		assert.strictEqual(reconnect.ownsUserState, true, 'an anonymous session owns its stars, reads and reading list');
	});

	it('the main thread no longer delivers empty sets for an anonymous session', async () => {
		const database = await stripped('src/actions/database.ts');
		assert.ok(!/selectUserIsAnonymous/.test(database), 'the per-user connects do not consult anonymity');
		for (const name of ['connectLiveStars', 'connectLiveReads', 'connectLiveReadingList']) {
			const start = database.indexOf(`export const ${name} = `);
			assert.ok(start >= 0, name);
			const body = database.slice(start, database.indexOf('\n};', start));
			assert.match(body, /if \(corpusWorkerOwnsCardIngestion\(\)\) return;/, `${name} leaves the listener to the worker`);
			assert.ok(!/updateStars\(\[\], \[\]\)|updateReads\(\[\], \[\]\)|updateReadingList\(\[\]\)/.test(body), `${name} delivers no empty set locally`);
		}
		const bridgeSource = await stripped('src/corpus-bridge.ts');
		assert.strictEqual((bridgeSource.match(/ownsUserState: corpusWorkerOwnsCardIngestion\(\),/g) || []).length, 2, 'both connect messages own user state unconditionally in worker mode');
		assert.ok(!/ownsUserState: corpusWorkerOwnsCardIngestion\(\) && !selectUserIsAnonymous/.test(bridgeSource));
		const worker = await stripped('src/worker/corpus-worker.ts');
		assert.match(worker, /if \(uid && currentOwnsUserState\) connectUserState\(uid\);/, 'the worker attaches for any uid it owns state for');
		//The flag is taken from BOTH messages (R19-1: a worker that kept its
		//first-connect value attached nothing for a session that resolved
		//anonymous after the pre-auth connect).
		assert.strictEqual((worker.match(/currentOwnsUserState = Boolean\(message\.ownsUserState\);/g) || []).length, 2, 'connect and reconnect both set the flag');
	});

	it('an offline boot still loads: a dropped empty cache delivery becomes the set after the fallback wait', async () => {
		//The main thread's local empty set was what let an anonymous offline
		//boot finish loading; with it gone, the worker's listener must not
		//treat "nothing from the server yet" as "no answer ever" (the review
		//ran the SDK offline on a memory cache: one empty from-cache delivery,
		//dropped, then silence). The fallback is the honest limit of a unit
		//test here — the worker's listener closures are not loadable alone —
		//so it is pinned where it lives.
		const {USER_STATE_CACHE_FALLBACK_MS} = await import('../../lib/src/worker/listener-trust.js');
		assert.strictEqual(USER_STATE_CACHE_FALLBACK_MS, 10000, 'the SDK\'s own online-state timeout');
		const worker = await stripped('src/worker/corpus-worker.ts');
		const stars = worker.slice(worker.indexOf('const cardIDDeltaListener = '), worker.indexOf('cardIDDeltaListener(STARS_COLLECTION, \'userStars\');'));
		const list = worker.slice(worker.indexOf('const attachReadingList = '), worker.indexOf('attachReadingList();'));
		const timer = (slice, send) => new RegExp(`if \\(decision === 'drop'\\) \\{[\\s\\S]{0,600}cacheFallback = setTimeout\\(\\(\\) => \\{\\s*cacheFallback = null;\\s*if \\(myConnectionGeneration !== connectionGeneration\\) return;\\s*status\\([\\s\\S]*?\\);\\s*${send}\\s*\\}, USER_STATE_CACHE_FALLBACK_MS\\);\\s*return;\\s*\\}`);
		assert.match(stars, timer(stars, 'send\\(\\{type, generation, added: \\[\\], removed: \\[\\], authoritative: true\\}\\);'), 'stars and reads: the empty cache becomes the authoritative set after the wait, guarded by the generation, and the latch is left alone so the real answer still lands whole');
		assert.match(list, timer(list, 'send\\(\\{type: \'userReadingList\', generation, list: \\[\\]\\}\\);'), 'reading list: the same');
		for (const [name, slice] of [['stars and reads', stars], ['reading list', list]]) {
			assert.match(slice, /clearCacheFallback\(\);\s*const decision = userStateDelivery/, `${name}: any delivery clears the pending fallback`);
			assert.match(slice, /error => \{\s*clearCacheFallback\(\);/, `${name}: an error clears it before re-attaching, or the old timer would wipe the new listener's set`);
			assert.match(slice, /userStateUnsubscribes\.push\(clearCacheFallback\);\s*userStateUnsubscribes\.push\(onSnapshot\(/, `${name}: detaching clears the timer, registered before the listener`);
			assert.ok(!/firstDelivery = false;\s*status\(/.test(slice), `${name}: the fallback does not consume the first delivery`);
		}
	});
});

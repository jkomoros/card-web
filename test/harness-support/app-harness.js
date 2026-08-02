/*eslint-env node, es2022*/

//Shared bootstrap for suites that drive REAL app write paths against a REAL
//Firestore emulator, in plain Node.
//
//The layers this reaches (thunks, executors, the store) had zero executable
//coverage for the life of this branch, guarded only by regex assertions over
//source text — which is how card creation shipped 100% broken through a green
//suite. The stated reason they could not be tested was wrong: the app modules
//import fine behind the jsdom shim five other suites already use, and
//src/firebase.ts has a loopback-only emulator hook.
//
//Everything here is ordering-sensitive, so it lives in one place:
//  - the DOM globals must exist before any app module is evaluated;
//  - the `firebase-emulator` flag must be set before lib/src/firebase.js is
//    evaluated, because it reads the flag ONCE at init and the flag is
//    host-gated (the jsdom URL must be localhost) and loopback-restricted;
//  - store.js registers only `app` and `data`, so any slice a code path reads
//    must be added by hand. Miss the `user` slice and the card-create executor
//    SILENTLY skips its author write — found by running this, not by reading.

import {JSDOM} from 'jsdom';

export const HARNESS_EMULATOR_PORT = 8093;

let cached = null;

//Every alert the app raised, newest last. Cleared per test via clearHarnessAlerts().
export const harnessAlerts = [];

export const clearHarnessAlerts = () => { harnessAlerts.length = 0; };

export const bootstrapApp = async ({uid = 'harness-user'} = {}) => {
	//One bootstrap per process: firebase initializes once, and a second JSDOM
	//would leave the app modules bound to the first set of globals.
	if (cached) return cached;

	const dom = new JSDOM('', {url: 'https://localhost/'});
	for (const key of ['window', 'document', 'navigator', 'localStorage', 'HTMLElement', 'customElements',
		'Document', 'Node', 'Element', 'DocumentFragment', 'CSSStyleSheet', 'ShadowRoot',
		'MutationObserver', 'requestAnimationFrame', 'getComputedStyle', 'CustomEvent', 'Event']) {
		globalThis[key] = key === 'window' ? dom.window : dom.window[key];
	}
	dom.window.localStorage.setItem('firebase-emulator', `localhost:${HARNESS_EMULATOR_PORT}`);

	//jsdom implements neither alert nor confirm. Without these, any code path
	//that REPORTS to the user throws inside a jsdom timer and surfaces as an
	//unrelated-looking uncaught error — which would make the reporting paths
	//effectively untestable, and those are precisely the ones that have been
	//failing silently. Captured rather than stubbed, so a test can assert that
	//the user was actually told.
	globalThis.alert = dom.window.alert = (message) => { harnessAlerts.push(String(message)); };
	globalThis.confirm = dom.window.confirm = () => true;

	const {overrideDocument} = await import('../../lib/shared/document.js');
	overrideDocument(dom.window.document);

	const {store} = await import('../../lib/src/store.js');
	const {default: userReducer} = await import('../../lib/src/reducers/user.js');
	store.addReducers({user: userReducer});

	const {db} = await import('../../lib/src/firebase.js');
	const firestore = await import('firebase/firestore');

	store.dispatch({type: 'SIGNIN_SUCCESS', user: {
		uid, isAnonymous: false, photoURL: '', displayName: 'Harness', email: 'harness@example.com'
	}});

	cached = {dom, store, db, uid, firestore};
	return cached;
};

//Every aux-queue key, so one suite's leftovers cannot alter another's replay
//order or claim state.
export const clearAuxQueue = () => {
	for (const key of Object.keys(globalThis.localStorage)) {
		if (key.includes('aux-write')) globalThis.localStorage.removeItem(key);
	}
};

//Put an already-built intent into the queue WITHOUT attempting it, so a test
//can drive the replay path (isReplay=true) rather than the first-attempt path.
export const seedQueuedIntent = (intent) => {
	globalThis.localStorage.setItem(`card-web-aux-writes-v2-i-${intent.id}`, JSON.stringify(intent));
	const index = JSON.parse(globalThis.localStorage.getItem('card-web-aux-writes-v2-index') || '[]');
	index.push({id: intent.id, uid: intent.uid, kind: intent.kind, createdAt: intent.createdAt});
	globalThis.localStorage.setItem('card-web-aux-writes-v2-index', JSON.stringify(index));
};

//A minimal wire-format card. Timestamps are deliberately dated 2020 so a
//client clock that leaks through instead of being server-stamped is
//unmistakable rather than a plausible-looking recent value.
export const OLD_WIRE_TIMESTAMP = {__wireTimestamp: true, seconds: 1577836800, nanoseconds: 0};

export const wireCard = (id, uid, overrides = {}) => ({
	id: '?DEFAULT-INVALID-ID?',
	name: id,
	created: OLD_WIRE_TIMESTAMP,
	updated: OLD_WIRE_TIMESTAMP,
	updated_substantive: OLD_WIRE_TIMESTAMP,
	updated_message: OLD_WIRE_TIMESTAMP,
	author: uid,
	permissions: {editCard: []},
	collaborators: [],
	star_count: 0,
	star_count_manual: 0,
	thread_count: 0,
	thread_resolved_count: 0,
	tweet_favorite_count: 0,
	tweet_retweet_count: 0,
	sort_order: 1,
	title: 'harness card',
	section: '',
	body: '<p>harness</p>',
	references: {},
	references_info: {},
	references_inbound: {},
	references_info_inbound: {},
	flags: {},
	font_size_boost: {},
	card_type: 'content',
	notes: '',
	todo: '',
	slugs: [],
	tags: [],
	published: false,
	images: [],
	auto_todo_overrides: {},
	last_tweeted: {__wireTimestamp: true, seconds: 0, nanoseconds: 0},
	tweet_count: 0,
	...overrides
});

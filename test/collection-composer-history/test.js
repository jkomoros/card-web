/*eslint-env node, es2022*/

import { JSDOM } from 'jsdom';
import assert from 'assert';

const dom = new JSDOM('', { url: 'https://example.com' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.Document = dom.window.Document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.customElements = dom.window.customElements;
globalThis.CSSStyleSheet = dom.window.CSSStyleSheet;

let CollectionDescription;
let readRecentCollections;
let readRememberedCollections;
let recordRecentCollection;
let flushRecentCollections;
let collectionDescriptionActuallyVisited;
let collectionDescriptionWithRelativeDateMemory;
let diagnosticsModule;

describe('Collection Composer history', () => {
	before(async () => {
		({ CollectionDescription } = await import(
			'../../lib/src/collection_description.js'
		));
		({ readRecentCollections, readRememberedCollections, recordRecentCollection, flushRecentCollections, collectionDescriptionActuallyVisited } = await import(
			'../../lib/src/collection-composer-history.js'
		));
		({ collectionDescriptionWithRelativeDateMemory } = await import(
			'../../lib/src/collection-composer-memory.js'
		));
		//The SAME module instance the history module imports — shared/dist is a
		//separate build with separate module state.
		diagnosticsModule = await import('../../lib/shared/url-diagnostics.js');
	});

	//Writes are deferred, so any write still queued from the previous test has
	//to land before the storage it would land in is thrown away.
	beforeEach(() => {
		flushRecentCollections();
		window.localStorage.clear();
		diagnosticsModule.clearURLDiagnostics();
	});

	it('records the retained active collection for bare-card navigation', () => {
		const requestedFallback = CollectionDescription.deserialize('main/section-a/');
		const retainedActive = CollectionDescription.deserialize('everything/starred/unread/');
		assert.strictEqual(
			collectionDescriptionActuallyVisited(requestedFallback, retainedActive, false),
			retainedActive
		);
		assert.strictEqual(
			collectionDescriptionActuallyVisited(requestedFallback, retainedActive, true),
			requestedFallback
		);
	});

	it('records transitions newest-first and preserves authoring order', () => {
		const first = CollectionDescription.deserialize(
			'everything/query/beta/query/alpha/'
		);
		const second = CollectionDescription.deserialize('everything/starred/');
		recordRecentCollection(first, 'alex', 100);
		recordRecentCollection(second, 'alex', 200);
		const recent = readRecentCollections('alex');
		assert.deepStrictEqual(
			recent.map((entry) => entry.canonical),
			[second.serialize(), first.serialize()]
		);
		assert.strictEqual(recent[1].authoring, first.serializeOriginalOrder());
	});

	it('collapses consecutive navigation within the same collection', () => {
		const description = CollectionDescription.deserialize(
			'everything/starred/'
		);
		recordRecentCollection(description, 'alex', 100);
		recordRecentCollection(description, 'alex', 200);
		assert.deepStrictEqual(readRecentCollections('alex'), [
			{
				canonical: description.serialize(),
				authoring: description.serializeOriginalOrder(),
				visitedAt: 100,
				visits: 1,
			},
		]);
	});

	it('increments visits when returning and keeps identity scopes separate', () => {
		const first = CollectionDescription.deserialize('everything/starred/');
		const second = CollectionDescription.deserialize('everything/unread/');
		recordRecentCollection(first, 'alex', 100);
		recordRecentCollection(second, 'alex', 200);
		recordRecentCollection(first, 'alex', 300);
		recordRecentCollection(second, 'other-user', 400);
		assert.strictEqual(readRecentCollections('alex')[0].visits, 2);
		assert.deepStrictEqual(
			readRecentCollections('other-user').map((entry) => entry.canonical),
			[second.serialize()]
		);
	});

	it('recognizes a frequently revisited moving date window', () => {
		recordRecentCollection(
			CollectionDescription.deserialize('everything/created/after/2026-7-7/'),
			'alex',
			new Date(2026, 6, 10, 12).getTime()
		);
		recordRecentCollection(
			CollectionDescription.deserialize('everything/created/after/2026-7-8/'),
			'alex',
			new Date(2026, 6, 11, 12).getTime()
		);
		recordRecentCollection(
			CollectionDescription.deserialize('everything/created/after/2026-7-9/'),
			'alex',
			new Date(2026, 6, 12, 12).getTime()
		);
		const remembered = readRememberedCollections('alex');
		//The immediate window is three deep, so all three exact visits precede
		//the rolling window they group into.
		assert.deepStrictEqual(remembered.slice(0, 3).map(entry => entry.authoring), [
			'everything/created/after/2026-7-9/',
			'everything/created/after/2026-7-8/',
			'everything/created/after/2026-7-7/',
		]);
		assert.strictEqual(remembered[3].authoring, 'everything/created/after/3-days-ago/');
		assert.strictEqual(remembered[3].visits, 3);
		assert.strictEqual(remembered[3].frequent, true);
		assert.strictEqual(remembered[3].relative, true);
	});

	it('keeps an often-used exact collection available beyond immediate recents', () => {
		const favorite = CollectionDescription.deserialize('everything/starred/unread/');
		const other = (name) => CollectionDescription.deserialize(`everything/${name}/`);
		recordRecentCollection(favorite, 'alex', 100);
		recordRecentCollection(other('working-notes'), 'alex', 200);
		recordRecentCollection(favorite, 'alex', 300);
		recordRecentCollection(other('has-todo'), 'alex', 400);
		recordRecentCollection(favorite, 'alex', 500);
		recordRecentCollection(other('published'), 'alex', 600);
		recordRecentCollection(other('unread'), 'alex', 700);
		//Three distinct collections visited since the favorite, so it is genuinely
		//beyond the immediate window rather than still sitting inside it.
		recordRecentCollection(other('content'), 'alex', 800);
		const remembered = readRememberedCollections('alex');
		assert.strictEqual(remembered[3].canonical, favorite.serialize());
		assert.strictEqual(remembered[3].visits, 3);
		assert.strictEqual(remembered[3].frequent, true);
		assert.ok(!remembered[3].relative);
	});

	it('keeps every leg of a three-collection rotation reachable', () => {
		const leg = (name) => CollectionDescription.deserialize(`everything/${name}/`);
		recordRecentCollection(leg('starred'), 'alex', 100);
		recordRecentCollection(leg('unread'), 'alex', 200);
		recordRecentCollection(leg('has-todo'), 'alex', 300);
		recordRecentCollection(leg('starred'), 'alex', 400);
		const remembered = readRememberedCollections('alex');
		//The immediate window holds all three legs. At two, the leg visited
		//longest ago fell past the rows the composer shows, and a rotation the
		//user was actively running lost a third of itself.
		assert.deepStrictEqual(remembered.slice(0, 3).map(entry => entry.canonical), [
			leg('starred').serialize(),
			leg('has-todo').serialize(),
			leg('unread').serialize(),
		]);
	});

	it('does not reinterpret a fixed absolute milestone as a rolling window', () => {
		const description = CollectionDescription.deserialize('everything/created/after/2026-7-7/');
		assert.strictEqual(
			collectionDescriptionWithRelativeDateMemory(description, new Date(2026, 6, 10, 12)).filters[0],
			'created/after/3-days-ago'
		);
		recordRecentCollection(description, 'alex', new Date(2026, 6, 10, 12).getTime());
		recordRecentCollection(CollectionDescription.deserialize('everything/starred/'), 'alex', new Date(2026, 6, 11, 12).getTime());
		recordRecentCollection(description, 'alex', new Date(2026, 6, 12, 12).getTime());
		recordRecentCollection(CollectionDescription.deserialize('everything/unread/'), 'alex', new Date(2026, 6, 13, 12).getTime());
		recordRecentCollection(description, 'alex', new Date(2026, 6, 14, 12).getTime());
		const remembered = readRememberedCollections('alex');
		assert.ok(!remembered.some(entry => entry.frequent && entry.relative));
		assert.ok(!remembered.some(entry => entry.canonical.includes('days-ago')));
		assert.strictEqual(remembered.find(entry => entry.canonical === description.serialize()).visits, 3);
	});

	it('ignores corrupt, invalid, duplicate, and cross-semantic entries', () => {
		window.localStorage.setItem(
			'collection-composer-history:alex',
			JSON.stringify([
				{
					canonical: 'everything/starred/',
					authoring: 'everything/starred/',
					visitedAt: 3,
					visits: 1,
				},
				{
					canonical: 'everything/starred/',
					authoring: 'everything/starred/',
					visitedAt: 2,
					visits: 9,
				},
				{
					canonical: 'everything/starred/',
					authoring: 'everything/unread/',
					visitedAt: 1,
					visits: 1,
				},
				{ garbage: true },
			])
		);
		assert.deepStrictEqual(readRecentCollections('alex'), [
			{
				canonical: 'everything/starred/',
				authoring: 'everything/starred/',
				visitedAt: 3,
				visits: 1,
			},
		]);
	});

	it('never throws on malformed storage', () => {
		window.localStorage.setItem('collection-composer-history:alex', '{');
		assert.deepStrictEqual(readRecentCollections('alex'), []);
	});

	//Recording a visit ran inside updateCardSelector, before the collection
	//update was even dispatched: a full read + validate + write against
	//localStorage on the main thread for every navigation. The write is now
	//deferred -- but a composer opened immediately after must still show the
	//navigation that just happened.
	it('defers the write without ever serving a stale list', () => {
		const key = 'collection-composer-history:alex';
		const first = CollectionDescription.deserialize('everything/starred/');
		recordRecentCollection(first, 'alex', 100);
		assert.strictEqual(window.localStorage.getItem(key), null,
			'the write must not happen on the navigation\'s critical path');
		//The read a freshly-opened composer performs.
		assert.deepStrictEqual(readRecentCollections('alex').map(entry => entry.canonical), [first.serialize()]);
		assert.deepStrictEqual(readRememberedCollections('alex').map(entry => entry.canonical), [first.serialize()]);

		//A second navigation before the first write has landed still stacks.
		const second = CollectionDescription.deserialize('everything/unread/');
		recordRecentCollection(second, 'alex', 200);
		assert.deepStrictEqual(readRecentCollections('alex').map(entry => entry.canonical),
			[second.serialize(), first.serialize()]);

		flushRecentCollections();
		assert.deepStrictEqual(
			JSON.parse(window.localStorage.getItem(key)).map(entry => entry.canonical),
			[second.serialize(), first.serialize()]
		);
		//And the durable list reads back the same.
		assert.deepStrictEqual(readRecentCollections('alex').map(entry => entry.canonical),
			[second.serialize(), first.serialize()]);
	});

	it('flushes a deferred write without being asked', async () => {
		const key = 'collection-composer-history:alex';
		recordRecentCollection(CollectionDescription.deserialize('everything/starred/'), 'alex', 100);
		assert.strictEqual(window.localStorage.getItem(key), null);
		//Whatever the environment offers -- requestIdleCallback in a browser, the
		//microtask queue otherwise -- the write lands on its own.
		await new Promise(resolve => setTimeout(resolve, 0));
		assert.ok(window.localStorage.getItem(key), 'the deferred write must land by itself');
	});

	//The parse is cached to keep repeat navigations off the fifty-entry
	//validation path, and the cache must not outlive the value it parsed.
	it('keeps a cached parse honest about storage written elsewhere', () => {
		const original = CollectionDescription.deserialize('everything/starred/');
		recordRecentCollection(original, 'alex', 100);
		flushRecentCollections();
		const cached = readRecentCollections('alex');
		assert.strictEqual(readRecentCollections('alex'), cached, 'an unchanged list keeps its identity');

		const other = CollectionDescription.deserialize('everything/unread/');
		window.localStorage.setItem('collection-composer-history:alex', JSON.stringify([{
			canonical: other.serialize(),
			authoring: other.serializeOriginalOrder(),
			visitedAt: 500,
			visits: 1,
		}]));
		assert.deepStrictEqual(readRecentCollections('alex').map(entry => entry.canonical), [other.serialize()]);
	});

	//THE `none` PLACEHOLDER POISONING.
	//
	//actions/collection.ts installs a `none` filter while a card-link redirect
	//resolves — a description that matches no cards and lives for about one
	//dispatch. Recorded as a visit it became permanent: CONTINUE offered
	//'Open Main AND None · 0 cards' forever, with a chip reading the bare word
	//'None'.
	it('never records the router\'s none placeholder as a visited collection', () => {
		const real = CollectionDescription.deserialize('everything/starred/');
		recordRecentCollection(real, 'alex', 100);
		recordRecentCollection(CollectionDescription.deserialize('main/none/'), 'alex', 200);
		recordRecentCollection(CollectionDescription.deserialize('everything/none/'), 'alex', 300);
		assert.deepStrictEqual(
			readRecentCollections('alex').map((entry) => entry.canonical),
			[real.serialize()],
			'a placeholder is not a destination anybody chose'
		);
	});

	//The guard lives on the module rather than on the one call site, so every
	//future caller inherits it — and it runs on READ as well, so a list poisoned
	//before it existed heals the next time it is opened.
	it('prunes an already-stored none placeholder on read', () => {
		const poisoned = CollectionDescription.deserialize('main/none/');
		const real = CollectionDescription.deserialize('everything/starred/');
		window.localStorage.setItem('collection-composer-history:alex', JSON.stringify([
			{
				canonical: poisoned.serialize(),
				authoring: poisoned.serializeOriginalOrder(),
				visitedAt: 500,
				visits: 12,
			},
			{
				canonical: real.serialize(),
				authoring: real.serializeOriginalOrder(),
				visitedAt: 400,
				visits: 2,
			},
		]));
		assert.deepStrictEqual(
			readRecentCollections('alex').map((entry) => entry.canonical),
			[real.serialize()]
		);
		assert.ok(
			!readRememberedCollections('alex').some((entry) => entry.canonical.includes('none')),
			'and it can never be promoted into what the composer offers'
		);
	});

	//RECENTS MUST NOT LAUNDER A BROKEN COLLECTION.
	//
	//Live: a URL with an unrecognised clause shows a "Didn't understand" notice
	//and a count computed without that clause. Recorded as a visit, it came back
	//as a confident Continue row — 'Tag 33x', with a card count beside it — for a
	//collection that never existed.
	it('does not record an arrival whose URL raised diagnostics', () => {
		const real = CollectionDescription.deserialize('everything/starred/');
		recordRecentCollection(real, 'alex', 100);
		diagnosticsModule.reportURLDiagnostic('tag-33x', 'ignored it, because it is not a filter or set');
		recordRecentCollection(CollectionDescription.deserialize('everything/tag-33x/'), 'alex', 200);
		assert.deepStrictEqual(
			readRecentCollections('alex').map((entry) => entry.canonical),
			[real.serialize()],
			'the app did not show what that URL described, so it is not a destination'
		);
		//A diagnostic about a DIFFERENT URL must not veto a good arrival: the
		//list is scoped the way the drawer notice is.
		recordRecentCollection(CollectionDescription.deserialize('everything/unread/'), 'alex', 300);
		assert.deepStrictEqual(
			readRecentCollections('alex').map((entry) => entry.canonical),
			[CollectionDescription.deserialize('everything/unread/').serialize(), real.serialize()]
		);
	});

	//The diagnostics for an arrival's FILTERS are reported lazily, by the
	//collection run — which has not happened yet when the visit is recorded. The
	//name check is the half that does not have to wait.
	it('does not record an arrival naming a filter this app cannot resolve', () => {
		const known = new Set(['starred', 'unread', 'tag-7']);
		const real = CollectionDescription.deserialize('everything/starred/');
		recordRecentCollection(real, 'alex', 100, {knownFilterNames: known});
		recordRecentCollection(CollectionDescription.deserialize('everything/frobnicate/'), 'alex', 200, {knownFilterNames: known});
		//A union with one resolvable member is a real collection; the engine
		//drops the unknown member and keeps going.
		recordRecentCollection(CollectionDescription.deserialize('everything/tag-33x+tag-7/'), 'alex', 300, {knownFilterNames: known});
		assert.deepStrictEqual(
			readRecentCollections('alex').map((entry) => entry.canonical),
			[
				CollectionDescription.deserialize('everything/tag-33x+tag-7/').serialize(),
				real.serialize(),
			]
		);
	});

	//Sections and tags load async, so "unknown" and "not here yet" are the same
	//observation until they arrive. With no names to judge against, nothing is.
	it('judges nothing when the filter names have not loaded', () => {
		const phantom = CollectionDescription.deserialize('everything/frobnicate/');
		recordRecentCollection(phantom, 'alex', 100, {knownFilterNames: new Set()});
		recordRecentCollection(CollectionDescription.deserialize('everything/starred/'), 'alex', 200);
		assert.ok(readRecentCollections('alex').some((entry) => entry.canonical === phantom.serialize()));
	});

	//HEALING ON READ, WITHOUT DESTROYING HISTORY. An entry stored before the
	//guard existed is suppressed from what the composer offers, but it is NOT
	//pruned from storage: a name that is unknown today may simply be a tag that
	//has not loaded, and a rewrite would lose real history for good.
	it('suppresses an already-stored phantom collection on read, and keeps the rest', () => {
		const phantom = CollectionDescription.deserialize('everything/frobnicate/');
		const real = CollectionDescription.deserialize('everything/starred/');
		window.localStorage.setItem('collection-composer-history:alex', JSON.stringify([
			{
				canonical: phantom.serialize(),
				authoring: phantom.serializeOriginalOrder(),
				visitedAt: 500,
				visits: 9,
			},
			{
				canonical: real.serialize(),
				authoring: real.serializeOriginalOrder(),
				visitedAt: 400,
				visits: 2,
			},
		]));
		const known = new Set(['starred', 'unread']);
		assert.deepStrictEqual(
			readRememberedCollections('alex', known).map((entry) => entry.canonical),
			[real.serialize()],
			'a phantom collection is never offered as a destination');
		//Still in storage, and still offered once the name is resolvable again.
		assert.deepStrictEqual(
			readRememberedCollections('alex', new Set(['starred', 'unread', 'frobnicate'])).map((entry) => entry.canonical),
			[phantom.serialize(), real.serialize()],
			'suppression is not deletion');
		assert.deepStrictEqual(
			readRecentCollections('alex').map((entry) => entry.canonical),
			[phantom.serialize(), real.serialize()],
			'and storage is left alone');
	});
});

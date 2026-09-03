/*eslint-env node, es2020*/

import {
	JSDOM
} from 'jsdom';

import assert from 'assert';

const dom = new JSDOM('');
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.Document = dom.window.Document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.customElements = dom.window.customElements;
globalThis.CSSStyleSheet = dom.window.CSSStyleSheet;

let CollectionDescription;
let collectionDescriptionWithQuery;
let collectionURLPath;
let collectionDescriptionWithOrderedDateBounds;
let COLLECTION_URL_PREFIX;
let UNION_FILTER_DELIMITER;

describe('card-web url parsing', () => {
	before(async () => {
		({
			CollectionDescription,
			collectionDescriptionWithQuery,
			collectionURLPath,
			collectionDescriptionWithOrderedDateBounds,
			COLLECTION_URL_PREFIX,
		} = await import('../../lib/src/collection_description.js'));
		({
			UNION_FILTER_DELIMITER
		} = await import('../../lib/src/filters.js'));
	});

	it('supports basic url parsing', async () => {
		const description = CollectionDescription.deserialize('starred/');
		const golden = new CollectionDescription('', ['starred']);
		assert.ok(description.equivalent(golden));
	});

	it('supports union filters', async() => {
		const description = CollectionDescription.deserialize('starred' + UNION_FILTER_DELIMITER + 'read/has-todo/');
		const golden = new CollectionDescription('', ['starred+read', 'has-todo']);
		assert.ok(description.equivalent(golden));
	});

	it('supports sorts', async() => {
		const description = CollectionDescription.deserialize('half-baked/sort/tweet-order/');
		const golden = new CollectionDescription('', ['half-baked'], 'tweet-order', false);
		assert.ok(description.equivalent(golden));
	});

	it('supports reversed sorts', async() => {
		const description = CollectionDescription.deserialize('half-baked/sort/reverse/tweet-order/');
		const golden = new CollectionDescription('', ['half-baked'], 'tweet-order', true);
		assert.ok(description.equivalent(golden));
	});

	it('supports sorts in between filters', async() => {
		const description = CollectionDescription.deserialize('half-baked/sort/tweet-order/has-todo/');
		const golden = new CollectionDescription('', ['half-baked', 'has-todo'], 'tweet-order');
		assert.ok(description.equivalent(golden));
	});

	it('supports sorts with no filters', async() => {
		const description = CollectionDescription.deserialize('sort/tweet-order/');
		const golden = new CollectionDescription('', null, 'tweet-order');
		assert.ok(description.equivalent(golden));
	});

	it('supports explicit sets', async() => {
		const description = CollectionDescription.deserialize('main/half-baked/sort/tweet-order/');
		const golden = new CollectionDescription('main', ['half-baked'], 'tweet-order');
		assert.ok(description.equivalent(golden));
		assert.ok(description.setNameExplicitlySet);
	});

	it('supports explicit sets that are not default', async() => {
		const description = CollectionDescription.deserialize('reading-list/sort/tweet-order/');
		const golden = new CollectionDescription('reading-list', null, 'tweet-order');
		assert.ok(description.equivalent(golden));
		assert.ok(description.setNameExplicitlySet);
	});

	it('supports basic url parsing with extra', async () => {
		const [description, extra] = CollectionDescription.deserializeWithExtra('starred/extra');
		const golden = new CollectionDescription('', ['starred']);
		assert.ok(description.equivalent(golden));
		assert.equal(extra, 'extra');
	});

	it('supports url parsing with single multi-part', async () => {
		const description = CollectionDescription.deserialize('updated/2020-10-02/');
		const golden = new CollectionDescription('', ['updated/2020-10-02']);
		assert.ok(description.equivalent(golden), 'Failed: ' + description.serialize());
	});

	it('supports url parsing with multi-part', async () => {
		const description = CollectionDescription.deserialize('updated/before/2020-10-02/');
		const golden = new CollectionDescription('', ['updated/before/2020-10-02']);
		assert.ok(description.equivalent(golden), 'Failed: ' + description.serialize());
	});

	it('supports url parsing with double multi-part', async () => {
		const description = CollectionDescription.deserialize('updated/between/2020-10-02/2020-11-03/');
		const golden = new CollectionDescription('', ['updated/between/2020-10-02/2020-11-03']);
		assert.ok(description.equivalent(golden), 'Failed: ' + description.serialize());
	});

	it('supports url parsing with multi-part filter before', async () => {
		const description = CollectionDescription.deserialize('half-baked/updated/before/2020-10-02/');
		const golden = new CollectionDescription('', ['half-baked', 'updated/before/2020-10-02']);
		assert.ok(description.equivalent(golden), 'Failed: ' + description.serialize());
	});

	it('supports url parsing with multi-part filter after', async () => {
		const description = CollectionDescription.deserialize('updated/before/2020-10-02/half-baked/');
		const golden = new CollectionDescription('', ['updated/before/2020-10-02', 'half-baked']);
		assert.ok(description.equivalent(golden), 'Failed: ' + description.serialize());
	});

	it('supports url parsing with multi-part filter before after', async () => {
		const description = CollectionDescription.deserialize('has-todo/updated/before/2020-10-02/half-baked/');
		const golden = new CollectionDescription('', ['has-todo','updated/before/2020-10-02', 'half-baked']);
		assert.ok(description.equivalent(golden), 'Failed: ' + description.serialize());
	});

	it('supports url parsing with partial mulit-part', async () => {
		const description = CollectionDescription.deserialize('updated/');
		const golden = new CollectionDescription('', []);
		assert.ok(description.equivalent(golden), 'Failed: ' + description.serialize());
	});

	it('supports url parsing with partial multi-part', async () => {
		const description = CollectionDescription.deserialize('updated/before/');
		const golden = new CollectionDescription('', []);
		assert.ok(description.equivalent(golden), 'Failed: ' + description.serialize());
	});

	it('supports url parsing with multi-part sort after', async () => {
		const description = CollectionDescription.deserialize('updated/before/2020-10-02/sort/random/');
		const golden = new CollectionDescription('', ['updated/before/2020-10-02'], 'random');
		assert.ok(description.equivalent(golden), 'Failed: ' + description.serialize());
	});

	it('does not support a multi-part filter without the first part', async () => {
		const description = CollectionDescription.deserialize('before/2020-10-02/');
		const golden = new CollectionDescription();
		assert.ok(description.equivalent(golden), 'Failed: ' + description.serialize());
	});

	it('replaces query with no prexisting query', async () => {
		const preDescription = new CollectionDescription('', ['has-todo']);
		const description = collectionDescriptionWithQuery(preDescription, 'my text');
		const golden = new CollectionDescription('', ['has-todo', 'query/my+text']);
		assert.ok(description.equivalent(golden), 'Failed: ' + description.serialize());
	});

	it('replaces query with prexisting query', async () => {
		const preDescription = new CollectionDescription('', ['has-todo', 'query/foo']);
		const description = collectionDescriptionWithQuery(preDescription, 'my text');
		const golden = new CollectionDescription('', ['has-todo', 'query/my+text']);
		assert.ok(description.equivalent(golden), 'Failed: ' + description.serialize());
	});

	it('supports default view modes', async() => {
		const description = CollectionDescription.deserialize('main/half-baked/view/list/sort/tweet-order/');
		const golden = new CollectionDescription('main', ['half-baked'], 'tweet-order');
		assert.ok(description.equivalent(golden));
	});

	it('supports non-default view modes', async() => {
		const description = CollectionDescription.deserialize('main/half-baked/view/web/similar/sort/tweet-order/');
		const golden = new CollectionDescription('main', ['half-baked'], 'tweet-order', false, 'web', 'similar');
		assert.ok(description.equivalent(golden));
	});

	//THE BARE MAIN COLLECTION SERIALIZES SHORT TO THE EMPTY STRING.
	//
	//That is correct — serializeShort elides the default set, and Main with no
	//filters, default sort and the list view has nothing else to say. It is
	//also the reason every hand-built `/c/${serializeShort()}` path produced
	//`/c/` for Main, which is a route with NO COLLECTION IN IT: the router
	//resolves it through its own default substitution and lands somewhere the
	//user never named. With a card appended it produced `/c/<cardid>`, where
	//the card id is read as the collection's first URL part.
	it('never builds a collection path with an empty collection portion', async () => {
		const bareMain = new CollectionDescription();
		assert.strictEqual(bareMain.serializeShort(), '', 'the premise: the short form really is empty');
		assert.strictEqual(collectionURLPath(bareMain), '/c/main/');
		assert.strictEqual(collectionURLPath(bareMain, {originalOrder: true}), '/c/main/');
		//And the path round-trips to the collection it names.
		const [roundTripped] = CollectionDescription.deserializeWithExtra(collectionURLPath(bareMain).slice(COLLECTION_URL_PREFIX.length));
		assert.ok(roundTripped.equivalent(bareMain));
	});

	it('appends a selected card only after the collection\'s trailing slash', async () => {
		const bareMain = new CollectionDescription();
		assert.strictEqual(collectionURLPath(bareMain, {selectedCard: 'card-123'}), '/c/main/card-123');
		const filtered = new CollectionDescription('', ['starred']);
		assert.strictEqual(collectionURLPath(filtered, {selectedCard: 'card-123'}), '/c/starred/card-123');
		//The card is the 'rest', not a filter, on the way back out.
		const [description, card] = CollectionDescription.deserializeWithExtra(
			collectionURLPath(bareMain, {selectedCard: 'card-123'}).slice(COLLECTION_URL_PREFIX.length));
		assert.ok(description.equivalent(bareMain));
		assert.strictEqual(card, 'card-123');
	});

	it('keeps authoring order when asked, and canonical order otherwise', async () => {
		const description = new CollectionDescription('', ['starred', 'has-todo']);
		assert.strictEqual(collectionURLPath(description, {originalOrder: true}), '/c/starred/has-todo/');
		assert.strictEqual(collectionURLPath(description), '/c/has-todo/starred/');
	});

	//`between` accepts its bounds either way round, and the display already puts
	//the earlier one first. The URL was the last surface still showing the typed
	//order, which is why Source could call a reversed range "safe to open" with
	//nothing to add. Spec §Canonicalization: canonical ordering applies when
	//producing the final canonical URL.
	it('orders a reversed date range when producing the canonical URL', async () => {
		const reversed = CollectionDescription.deserialize('main/updated/between/2026-08-21/2023-12-31/');
		const ordered = collectionDescriptionWithOrderedDateBounds(reversed);
		assert.deepStrictEqual([...ordered.filters], ['updated/between/2023-12-31/2026-08-21']);
		//Already in order: the SAME object, so nothing downstream sees a change
		//that did not happen.
		assert.strictEqual(collectionDescriptionWithOrderedDateBounds(ordered), ordered);
	});

	it('leaves a `between` that is not a date range alone', async () => {
		//The keyword only means a date range after a date FAMILY. `query/between`
		//is somebody searching for the word, and its neighbours are filters of
		//their own, not bounds.
		const query = CollectionDescription.deserialize('main/query/between/starred/');
		assert.strictEqual(collectionDescriptionWithOrderedDateBounds(query), query);
		//And an unparseable bound is not evidence of anything either.
		const vague = CollectionDescription.deserialize('main/updated/between/not-a-date/2023-12-31/');
		assert.strictEqual(collectionDescriptionWithOrderedDateBounds(vague), vague);
	});

	//The prefix is duplicated — actions/app.ts sits above collection_description
	//in the import graph, so the constant cannot be imported from it. A SOURCE
	//pin rather than an import, because importing actions/app.js here would drag
	//in the whole firebase-backed component graph for one literal.
	it('agrees with the router about which page collections live under', async () => {
		const { readFile } = await import('fs/promises');
		const source = await readFile(new URL('../../src/actions/app.ts', import.meta.url), 'utf8');
		const match = source.match(/export const PAGE_DEFAULT = '([^']+)';/);
		assert.ok(match, 'actions/app.ts must still declare PAGE_DEFAULT');
		assert.strictEqual(COLLECTION_URL_PREFIX, '/' + match[1] + '/');
	});

});

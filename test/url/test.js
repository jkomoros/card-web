/*eslint-env node*/

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
let UNION_FILTER_DELIMITER;

describe('card-web url parsing', () => {
	before(async () => {
		({
			CollectionDescription,
			collectionDescriptionWithQuery,
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

});

/*eslint-env node*/

import {
	CollectionDescription
} from '../../src/collection_description.js';

import {
	UNION_FILTER_DELIMITER
} from '../../src/filters.js';

import assert from 'assert';


describe('card-web url parsing', () => {
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


});
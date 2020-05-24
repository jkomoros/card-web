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
		const description = CollectionDescription.deserialize('all/half-baked/sort/tweet-order/');
		const golden = new CollectionDescription('all', ['half-baked'], 'tweet-order');
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

});
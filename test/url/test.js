/*eslint-env node*/

import {
	CollectionDescription
} from '../../src/collection_description.js';

import assert from 'assert';


describe('card-web url parsing', () => {
	it('supports basic url parsing', async () => {
		const description = CollectionDescription.deserialize('starred/');
		const golden = new CollectionDescription('', ['starred']);
		assert.ok(description.equivalent(golden));
	});

});
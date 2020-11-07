/*eslint-env node*/

import {
	referencesLegal,
	referencesDiff,
	referencesCardsDiff,
	applyReferencesDiff,
	REFERENCE_TYPE_LINK,
	REFERENCE_TYPE_DUPE_OF,
	REFERENCES_INFO_CARD_PROPERTY,
	REFERENCES_CARD_PROPERTY
} from '../../src/card_fields.js';

//We import these only to get deleteSentinel without importing from firebase.js.
import firebase from '@firebase/app';
import '@firebase/firestore';
const deleteSentinel = firebase.firestore.FieldValue.delete;

import assert from 'assert';

describe('card referencesLegal util functions', () => {
	it('strings not legal', async () => {
		const input = '';
		const result = referencesLegal(input);
		assert.strictEqual(result, false);
	});

	it('null not legal', async () => {
		const input = null;
		const result = referencesLegal(input);
		assert.strictEqual(result, false);
	});

	it('blank object legal', async () => {
		const input = {};
		const result = referencesLegal(input);
		assert.strictEqual(result, true);
	});

	it('object with one key that is string illegal', async () => {
		const input = {
			'foo': 'bar',
		};
		const result = referencesLegal(input);
		assert.strictEqual(result, false);
	});

	it('object with one key that is null illegal', async () => {
		const input = {
			'foo': null,
		};
		const result = referencesLegal(input);
		assert.strictEqual(result, false);
	});

	it('object with one key that is blank object illegal', async () => {
		const input = {
			'foo': {},
		};
		const result = referencesLegal(input);
		assert.strictEqual(result, false);
	});

	it('object with one key that is object with one whitelisted property that is empty string legal', async () => {
		const input = {
			'foo': {
				[REFERENCE_TYPE_LINK]: '',
			},
		};
		const result = referencesLegal(input);
		assert.strictEqual(result, true);
	});

	it('object with one key that is object with one whitelisted property that is non-empty string legal', async () => {
		const input = {
			'foo': {
				[REFERENCE_TYPE_LINK]: 'foo',
			},
		};
		const result = referencesLegal(input);
		assert.strictEqual(result, true);
	});

	it('object with one key that is object with one non-whitelisted property that is non-empty string illegal', async () => {
		const input = {
			'foo': {
				'foo': 'foo',
			},
		};
		const result = referencesLegal(input);
		assert.strictEqual(result, false);
	});

	it('object with one key that is object with one whitelisted property that is object illegal', async () => {
		const input = {
			'foo': {
				[REFERENCE_TYPE_LINK]: {},
			},
		};
		const result = referencesLegal(input);
		assert.strictEqual(result, false);
	});

});

const defaultDiffResult = [{},{},{},{}];
const defaultCardDiffResult = [{},{}];

describe('card referencesDiff util functions', () => {
	it('illegal for before illegal', async () => {
		const inputBefore = {
			'foo': {
				'illegal-link-type': '',
			},
		};
		const inputAfter = {
			'foo': {
				[REFERENCE_TYPE_LINK]: '',
			},
		};
		const result = referencesDiff(inputBefore, inputAfter);
		const expectedResult = defaultDiffResult;
		assert.deepStrictEqual(result, expectedResult);
		const cardResult = referencesCardsDiff(inputBefore, inputAfter);
		const expectedCardResult = defaultCardDiffResult;
		assert.deepStrictEqual(cardResult, expectedCardResult);
	});

	it('illegal for after illegal', async () => {
		const inputBefore = {
			'foo': {
				[REFERENCE_TYPE_LINK]: '',
			},
		};
		const inputAfter = {
			'foo': {
				'illegal-link-type': '',
			},
		};
		const result = referencesDiff(inputBefore, inputAfter);
		const expectedResult = defaultDiffResult;
		assert.deepStrictEqual(result, expectedResult);
		const cardResult = referencesCardsDiff(inputBefore, inputAfter);
		const expectedCardResult = defaultCardDiffResult;
		assert.deepStrictEqual(cardResult, expectedCardResult);
	});

	it('no op', async () => {
		const inputBefore = {
			'foo': {
				[REFERENCE_TYPE_LINK]: '',
			},
		};
		const inputAfter = {
			'foo': {
				[REFERENCE_TYPE_LINK]: '',
			},
		};
		const result = referencesDiff(inputBefore, inputAfter);
		const expectedResult = defaultDiffResult;
		assert.deepStrictEqual(result, expectedResult);
		const cardResult = referencesCardsDiff(inputBefore, inputAfter);
		const expectedCardResult = defaultCardDiffResult;
		assert.deepStrictEqual(cardResult, expectedCardResult);
	});

	it('Add card', async () => {
		const inputBefore = {
		};
		const inputAfter = {
			'foo': {
				[REFERENCE_TYPE_LINK]: 'value',
			},
		};
		const result = referencesDiff(inputBefore, inputAfter);
		const expectedAdditions = {
			['foo.' + REFERENCE_TYPE_LINK]: 'value',
		};
		const expectedResult = [expectedAdditions, {}, {}, {}];
		assert.deepStrictEqual(result, expectedResult);
		const cardResult = referencesCardsDiff(inputBefore, inputAfter);
		const expectedCardResult = [
			{
				'foo': true,
			},
			{},
		];
		assert.deepStrictEqual(cardResult, expectedCardResult);
	});

	it('Add two items in new card', async () => {
		const inputBefore = {
		};
		const inputAfter = {
			'foo': {
				[REFERENCE_TYPE_LINK]: 'value',
				[REFERENCE_TYPE_DUPE_OF]: 'other-value',
			},
		};
		const result = referencesDiff(inputBefore, inputAfter);
		const expectedAdditions = {
			['foo.' + REFERENCE_TYPE_LINK]: 'value',
			['foo.' + REFERENCE_TYPE_DUPE_OF]: 'other-value',
		};
		const expectedResult = [expectedAdditions, {}, {}, {}];
		assert.deepStrictEqual(result, expectedResult);
		const cardResult = referencesCardsDiff(inputBefore, inputAfter);
		const expectedCardResult = [
			{
				'foo': true,
			},
			{},
		];
		assert.deepStrictEqual(cardResult, expectedCardResult);
	});

	it('Add item to existing card', async () => {
		const inputBefore = {
			'foo': {
				[REFERENCE_TYPE_LINK]: 'value',
			},
		};
		const inputAfter = {
			'foo': {
				[REFERENCE_TYPE_LINK]: 'value',
				[REFERENCE_TYPE_DUPE_OF]: 'other-value',
			},
		};
		const result = referencesDiff(inputBefore, inputAfter);
		const expectedAdditions = {
			['foo.' + REFERENCE_TYPE_DUPE_OF]: 'other-value',
		};
		const expectedResult = [expectedAdditions, {}, {}, {}];
		assert.deepStrictEqual(result, expectedResult);
		const cardResult = referencesCardsDiff(inputBefore, inputAfter);
		const expectedCardResult = [
			{
				'foo': true,
			},
			{},
		];
		assert.deepStrictEqual(cardResult, expectedCardResult);
	});

	it('Remove existing card', async () => {
		const inputBefore = {
			'foo': {
				[REFERENCE_TYPE_LINK]: 'value',
			},
		};
		const inputAfter = {
		};
		const result = referencesDiff(inputBefore, inputAfter);
		const expectedCardDeletions = {
			'foo': true,
		};
		const expectedResult = [{}, {}, {}, expectedCardDeletions];
		assert.deepStrictEqual(result, expectedResult);
		const cardResult = referencesCardsDiff(inputBefore, inputAfter);
		const expectedCardResult = [
			{},
			{
				'foo': true,
			},
		];
		assert.deepStrictEqual(cardResult, expectedCardResult);
	});

	it('Remove item from existing card', async () => {
		const inputBefore = {
			'foo': {
				[REFERENCE_TYPE_LINK]: 'value',
				[REFERENCE_TYPE_DUPE_OF]: 'other-value',
			},
		};
		const inputAfter = {
			'foo': {
				[REFERENCE_TYPE_LINK]: 'value',
			},
		};
		const result = referencesDiff(inputBefore, inputAfter);
		const expectedLeafDeletions = {
			['foo.' + REFERENCE_TYPE_DUPE_OF]: true,
		};
		const expectedResult = [{}, {}, expectedLeafDeletions, {}];
		assert.deepStrictEqual(result, expectedResult);
		const cardResult = referencesCardsDiff(inputBefore, inputAfter);
		const expectedCardResult = [
			{
				'foo': true,
			},
			{},
		];
		assert.deepStrictEqual(cardResult, expectedCardResult);
	});

	it('Modify single item in card', async () => {
		const inputBefore = {
			'foo': {
				[REFERENCE_TYPE_LINK]: 'before-value',
			},
		};
		const inputAfter = {
			'foo': {
				[REFERENCE_TYPE_LINK]: 'value',
			},
		};
		const result = referencesDiff(inputBefore, inputAfter);
		const expectedModifications = {
			['foo.' + REFERENCE_TYPE_LINK]: 'value',
		};
		const expectedResult = [{}, expectedModifications, {}, {}];
		assert.deepStrictEqual(result, expectedResult);
		const cardResult = referencesCardsDiff(inputBefore, inputAfter);
		const expectedCardResult = [
			{
				'foo': true,
			},
			{},
		];
		assert.deepStrictEqual(cardResult, expectedCardResult);
	});

	it('Modify multiple items in card', async () => {
		const inputBefore = {
			'foo': {
				[REFERENCE_TYPE_LINK]: 'before-value',
				[REFERENCE_TYPE_DUPE_OF]: 'before-other-value',
			},
		};
		const inputAfter = {
			'foo': {
				[REFERENCE_TYPE_LINK]: 'value',
				[REFERENCE_TYPE_DUPE_OF]: 'other-value',
			},
		};
		const result = referencesDiff(inputBefore, inputAfter);
		const expectedModifications = {
			['foo.' + REFERENCE_TYPE_LINK]: 'value',
			['foo.' + REFERENCE_TYPE_DUPE_OF]: 'other-value',
		};
		const expectedResult = [{}, expectedModifications, {}, {}];
		assert.deepStrictEqual(result, expectedResult);
		const cardResult = referencesCardsDiff(inputBefore, inputAfter);
		const expectedCardResult = [
			{
				'foo': true,
			},
			{},
		];
		assert.deepStrictEqual(cardResult, expectedCardResult);
	});

	it('Multiple changes', async () => {
		const inputBefore = {
			'deletion-card': {
				[REFERENCE_TYPE_LINK]: 'before-value',
				[REFERENCE_TYPE_DUPE_OF]: 'before-other-value',
			},
			'modification-card': {
				[REFERENCE_TYPE_LINK]: 'before-value',
				[REFERENCE_TYPE_DUPE_OF]: 'before-other-value',
			},
		};
		const inputAfter = {
			'modification-card': {
				[REFERENCE_TYPE_LINK]: 'after-value',
			},
			'addition-card': {
				[REFERENCE_TYPE_LINK]: 'after-value',
			},
		};
		const result = referencesDiff(inputBefore, inputAfter);
		const expectedAdditions = {
			['addition-card.' + REFERENCE_TYPE_LINK]: 'after-value',
		};
		const expectedModifications = {
			['modification-card.' + REFERENCE_TYPE_LINK]: 'after-value',
		};
		const expectedLeafDeletions = {
			['modification-card.' + REFERENCE_TYPE_DUPE_OF]: true,
		};
		const expectedCardDeletions = {
			'deletion-card': true,
		};
		const expectedResult = [expectedAdditions, expectedModifications, expectedLeafDeletions, expectedCardDeletions];
		assert.deepStrictEqual(result, expectedResult);

		const updateObj = {
			//Set a property that shouldn't be touched
			'foo': 1,
		};

		applyReferencesDiff(inputBefore, inputAfter, updateObj);
	
		const expectedUpdateObj = {
			'foo': 1,
			[REFERENCES_INFO_CARD_PROPERTY + '.addition-card.' + REFERENCE_TYPE_LINK]: 'after-value',
			[REFERENCES_CARD_PROPERTY + '.addition-card']: true,
			[REFERENCES_INFO_CARD_PROPERTY + '.modification-card.' + REFERENCE_TYPE_LINK]: 'after-value',
			[REFERENCES_INFO_CARD_PROPERTY + '.modification-card.' + REFERENCE_TYPE_DUPE_OF]: deleteSentinel(),
			[REFERENCES_INFO_CARD_PROPERTY + '.deletion-card']: deleteSentinel(),
			[REFERENCES_CARD_PROPERTY + '.deletion-card']: deleteSentinel(),
		};

		assert.deepStrictEqual(updateObj, expectedUpdateObj);

		const cardResult = referencesCardsDiff(inputBefore, inputAfter);
		const expectedCardResult = [
			{
				'addition-card': true,
				'modification-card': true,
			},
			{
				'deletion-card': true,
			},
		];
		assert.deepStrictEqual(cardResult, expectedCardResult);

	});

});
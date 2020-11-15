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
	it('missing either references and references_info not legal', async () => {
		const input = {};
		const result = referencesLegal(input);
		assert.strictEqual(result, false);
	});

	it('missing either references not legal', async () => {
		const input = {
			[REFERENCES_INFO_CARD_PROPERTY]: '',
		};
		const result = referencesLegal(input);
		assert.strictEqual(result, false);
	});

	it('missing either references_info not legal', async () => {
		const input = {
			[REFERENCES_CARD_PROPERTY]: '',
		};
		const result = referencesLegal(input);
		assert.strictEqual(result, false);
	});

	it('strings not legal', async () => {
		const input = {
			[REFERENCES_INFO_CARD_PROPERTY]: '',
			[REFERENCES_CARD_PROPERTY]: '',
		};
		const result = referencesLegal(input);
		assert.strictEqual(result, false);
	});

	it('null not legal', async () => {
		const input = {
			[REFERENCES_INFO_CARD_PROPERTY]: null,
			[REFERENCES_CARD_PROPERTY]: null,
		};
		const result = referencesLegal(input);
		assert.strictEqual(result, false);
	});

	it('blank object legal', async () => {
		const input = {
			[REFERENCES_INFO_CARD_PROPERTY]: {},
			[REFERENCES_CARD_PROPERTY]: {},
		};
		const result = referencesLegal(input);
		assert.strictEqual(result, true);
	});

	it('missing references illegal', async () => {
		const input = {
			[REFERENCES_INFO_CARD_PROPERTY]: {},
		};
		const result = referencesLegal(input);
		assert.strictEqual(result, false);
	});

	it('object with one key that is string illegal', async () => {
		const input = {
			[REFERENCES_INFO_CARD_PROPERTY]: {
				'foo': 'bar',
			},
			[REFERENCES_CARD_PROPERTY]: {
				'foo': true,
			},
		};
		const result = referencesLegal(input);
		assert.strictEqual(result, false);
	});

	it('object with one key that is null illegal', async () => {
		const input = {
			[REFERENCES_INFO_CARD_PROPERTY]: {
				'foo': null,
			},
			[REFERENCES_CARD_PROPERTY]: {
				'foo': true,
			},
		};
		const result = referencesLegal(input);
		assert.strictEqual(result, false);
	});

	it('object with one key that is blank object illegal', async () => {
		const input = {
			[REFERENCES_INFO_CARD_PROPERTY]: {
				'foo': {},
			},
			[REFERENCES_CARD_PROPERTY]: {
				'foo': true,
			},
		};
		const result = referencesLegal(input);
		assert.strictEqual(result, false);
	});

	it('object with one key that is object with one whitelisted property that is empty string legal', async () => {
		const input = {
			[REFERENCES_INFO_CARD_PROPERTY]: {
				'foo': {
					[REFERENCE_TYPE_LINK]: '',
				},
			},
			[REFERENCES_CARD_PROPERTY]: {
				'foo': true,
			},
		};
		const result = referencesLegal(input);
		assert.strictEqual(result, true);
	});

	it('object with one key that is object with one whitelisted property that is empty string but no key in references illegal', async () => {
		const input = {
			[REFERENCES_INFO_CARD_PROPERTY]: {
				'foo': {
					[REFERENCE_TYPE_LINK]: '',
				},
			},
			[REFERENCES_CARD_PROPERTY]: {
				'bar': true,
			},
		};
		const result = referencesLegal(input);
		assert.strictEqual(result, false);
	});

	it('object with one key that is object with one whitelisted property that is empty string but no references illegal', async () => {
		const input = {
			[REFERENCES_INFO_CARD_PROPERTY]: {
				'foo': {
					[REFERENCE_TYPE_LINK]: '',
				},
			},
		};
		const result = referencesLegal(input);
		assert.strictEqual(result, false);
	});

	it('object with one key that is object with one whitelisted property that is empty string but false key in references illegal', async () => {
		const input = {
			[REFERENCES_INFO_CARD_PROPERTY]: {
				'foo': {
					[REFERENCE_TYPE_LINK]: '',
				},
			},
			[REFERENCES_CARD_PROPERTY]: {
				'foo': false,
			},
		};
		const result = referencesLegal(input);
		assert.strictEqual(result, false);
	});

	it('object with one key that is object with one whitelisted property that is empty string but string key in references illegal', async () => {
		const input = {
			[REFERENCES_INFO_CARD_PROPERTY]: {
				'foo': {
					[REFERENCE_TYPE_LINK]: '',
				},
			},
			[REFERENCES_CARD_PROPERTY]: {
				'foo': 'bar',
			},
		};
		const result = referencesLegal(input);
		assert.strictEqual(result, false);
	});

	it('object with one key that is object with one whitelisted property that is non-empty string legal', async () => {
		const input = {
			[REFERENCES_INFO_CARD_PROPERTY]: {
				'foo': {
					[REFERENCE_TYPE_LINK]: 'foo',
				},
			},
			[REFERENCES_CARD_PROPERTY]: {
				'foo': true,
			},
		};
		const result = referencesLegal(input);
		assert.strictEqual(result, true);
	});

	it('object with one key that is object with one non-whitelisted property that is non-empty string illegal', async () => {
		const input = {
			[REFERENCES_INFO_CARD_PROPERTY]: {
				'foo': {
					'foo': 'foo',
				},
			},
			[REFERENCES_CARD_PROPERTY]: {
				'foo': true,
			},
		};
		const result = referencesLegal(input);
		assert.strictEqual(result, false);
	});

	it('object with one key that is object with one whitelisted property that is object illegal', async () => {
		const input = {
			[REFERENCES_INFO_CARD_PROPERTY]: {
				'foo': {
					[REFERENCE_TYPE_LINK]: {},
				},
			},
			[REFERENCES_CARD_PROPERTY]: {
				'foo': true,
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
			[REFERENCES_INFO_CARD_PROPERTY]: {
				'foo': {
					'illegal-link-type': '',
				},
			},
			[REFERENCES_CARD_PROPERTY]: {
				'foo': true,
			},
		};
		const inputAfter = {
			[REFERENCES_INFO_CARD_PROPERTY]: {
				'foo': {
					[REFERENCE_TYPE_LINK]: '',
				},
			},
			[REFERENCES_CARD_PROPERTY]: {
				'foo': true,
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
			[REFERENCES_INFO_CARD_PROPERTY]: {
				'foo': {
					[REFERENCE_TYPE_LINK]: '',
				},
			},
			[REFERENCES_CARD_PROPERTY]: {
				'foo': true,
			},
		};
		const inputAfter = {
			[REFERENCES_INFO_CARD_PROPERTY]: {
				'foo': {
					'illegal-link-type': '',
				},
			},
			[REFERENCES_CARD_PROPERTY]: {
				'foo': true,
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
			[REFERENCES_INFO_CARD_PROPERTY]: {
				'foo': {
					[REFERENCE_TYPE_LINK]: '',
				},
			},
			[REFERENCES_CARD_PROPERTY]: {
				'foo': true,
			},
		};
		const inputAfter = {
			[REFERENCES_INFO_CARD_PROPERTY]: {
				'foo': {
					[REFERENCE_TYPE_LINK]: '',
				},
			},
			[REFERENCES_CARD_PROPERTY]: {
				'foo': true,
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
			[REFERENCES_INFO_CARD_PROPERTY]: {},
			[REFERENCES_CARD_PROPERTY]: {},
		};
		const inputAfter = {
			[REFERENCES_INFO_CARD_PROPERTY]: {
				'foo': {
					[REFERENCE_TYPE_LINK]: 'value',
				},
			},
			[REFERENCES_CARD_PROPERTY]: {
				'foo': true,
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
			[REFERENCES_INFO_CARD_PROPERTY]: {},
			[REFERENCES_CARD_PROPERTY]: {},
		};
		const inputAfter = {
			[REFERENCES_INFO_CARD_PROPERTY]: {
				'foo': {
					[REFERENCE_TYPE_LINK]: 'value',
					[REFERENCE_TYPE_DUPE_OF]: 'other-value',
				},
			},
			[REFERENCES_CARD_PROPERTY]: {
				'foo': true,
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
			[REFERENCES_INFO_CARD_PROPERTY]: {
				'foo': {
					[REFERENCE_TYPE_LINK]: 'value',
				},
			},
			[REFERENCES_CARD_PROPERTY]: {
				'foo': true,
			},
		};
		const inputAfter = {
			[REFERENCES_INFO_CARD_PROPERTY]: {
				'foo': {
					[REFERENCE_TYPE_LINK]: 'value',
					[REFERENCE_TYPE_DUPE_OF]: 'other-value',
				},
			},
			[REFERENCES_CARD_PROPERTY]: {
				'foo': true,
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
			[REFERENCES_INFO_CARD_PROPERTY]: {
				'foo': {
					[REFERENCE_TYPE_LINK]: 'value',
				},
			},
			[REFERENCES_CARD_PROPERTY]: {
				'foo': true,
			},
		};
		const inputAfter = {
			[REFERENCES_INFO_CARD_PROPERTY]: {},
			[REFERENCES_CARD_PROPERTY]: {},
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
			[REFERENCES_INFO_CARD_PROPERTY]: {
				'foo': {
					[REFERENCE_TYPE_LINK]: 'value',
					[REFERENCE_TYPE_DUPE_OF]: 'other-value',
				},
			},
			[REFERENCES_CARD_PROPERTY]: {
				'foo': true,
			},
		};
		const inputAfter = {
			[REFERENCES_INFO_CARD_PROPERTY]: {
				'foo': {
					[REFERENCE_TYPE_LINK]: 'value',
				},
			},
			[REFERENCES_CARD_PROPERTY]: {
				'foo': true,
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
			[REFERENCES_INFO_CARD_PROPERTY]: {
				'foo': {
					[REFERENCE_TYPE_LINK]: 'before-value',
				},
			},
			[REFERENCES_CARD_PROPERTY]: {
				'foo': true,
			},
		};
		const inputAfter = {
			[REFERENCES_INFO_CARD_PROPERTY]: {
				'foo': {
					[REFERENCE_TYPE_LINK]: 'value',
				},
			},
			[REFERENCES_CARD_PROPERTY]: {
				'foo': true,
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
			[REFERENCES_INFO_CARD_PROPERTY]: {
				'foo': {
					[REFERENCE_TYPE_LINK]: 'before-value',
					[REFERENCE_TYPE_DUPE_OF]: 'before-other-value',
				},
			},
			[REFERENCES_CARD_PROPERTY]: {
				'foo': true,
			},
		};
		const inputAfter = {
			[REFERENCES_INFO_CARD_PROPERTY]: {
				'foo': {
					[REFERENCE_TYPE_LINK]: 'value',
					[REFERENCE_TYPE_DUPE_OF]: 'other-value',
				},
			},
			[REFERENCES_CARD_PROPERTY]: {
				'foo': true,
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

	it('empty before object', async() => {
		const inputBefore = {};
		const inputAfter = {
			[REFERENCES_INFO_CARD_PROPERTY]: {
				'foo': {
					[REFERENCE_TYPE_LINK]: 'value',
					[REFERENCE_TYPE_DUPE_OF]: 'other-value',
				},
			},
			[REFERENCES_CARD_PROPERTY]: {
				'foo': true,
			},
		};
		const cardResult = referencesCardsDiff(inputBefore, inputAfter);
		const expectedCardResult = [
			{
				'foo': true,
			},
			{},
		];
		assert.deepStrictEqual(cardResult, expectedCardResult);
	});

	it('null before object', async() => {
		const inputBefore = null;
		const inputAfter = {
			[REFERENCES_INFO_CARD_PROPERTY]: {
				'foo': {
					[REFERENCE_TYPE_LINK]: 'value',
					[REFERENCE_TYPE_DUPE_OF]: 'other-value',
				},
			},
			[REFERENCES_CARD_PROPERTY]: {
				'foo': true,
			},
		};
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
			[REFERENCES_INFO_CARD_PROPERTY]: {
				'deletion-card': {
					[REFERENCE_TYPE_LINK]: 'before-value',
					[REFERENCE_TYPE_DUPE_OF]: 'before-other-value',
				},
				'modification-card': {
					[REFERENCE_TYPE_LINK]: 'before-value',
					[REFERENCE_TYPE_DUPE_OF]: 'before-other-value',
				},
			},
			[REFERENCES_CARD_PROPERTY]: {
				'deletion-card': true,
				'modification-card':true,
			},
		};
		const inputAfter = {
			[REFERENCES_INFO_CARD_PROPERTY]: {
				'modification-card': {
					[REFERENCE_TYPE_LINK]: 'after-value',
				},
				'addition-card': {
					[REFERENCE_TYPE_LINK]: 'after-value',
				},
			},
			[REFERENCES_CARD_PROPERTY]: {
				'modification-card': true,
				'addition-card': true,
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
/*eslint-env node*/

import {
	REFERENCE_TYPE_LINK,
	REFERENCE_TYPE_DUPE_OF,
	REFERENCE_TYPE_ACK,
	REFERENCES_INFO_CARD_PROPERTY,
	REFERENCES_CARD_PROPERTY
} from '../../src/type_constants.js';

import {
	references,
	referencesLegalShape,
	referencesDiff,
	referencesCardsDiff,
	applyReferencesDiff,
	referencesEntriesDiff,
	unionReferences,
	intersectionReferences
} from '../../src/references.js';

//We import these only to get deleteField without importing from firebase.js.
import {
	deleteField
} from 'firebase/firestore';

import assert from 'assert';

describe('card referencesLegalShape util functions', () => {
	it('missing either references and references_info not legal', async () => {
		const input = {};
		const result = referencesLegalShape(input);
		assert.strictEqual(result, false);
	});

	it('missing either references not legal', async () => {
		const input = {
			[REFERENCES_INFO_CARD_PROPERTY]: '',
		};
		const result = referencesLegalShape(input);
		assert.strictEqual(result, false);
	});

	it('missing either references_info not legal', async () => {
		const input = {
			[REFERENCES_CARD_PROPERTY]: '',
		};
		const result = referencesLegalShape(input);
		assert.strictEqual(result, false);
	});

	it('strings not legal', async () => {
		const input = {
			[REFERENCES_INFO_CARD_PROPERTY]: '',
			[REFERENCES_CARD_PROPERTY]: '',
		};
		const result = referencesLegalShape(input);
		assert.strictEqual(result, false);
	});

	it('null not legal', async () => {
		const input = {
			[REFERENCES_INFO_CARD_PROPERTY]: null,
			[REFERENCES_CARD_PROPERTY]: null,
		};
		const result = referencesLegalShape(input);
		assert.strictEqual(result, false);
	});

	it('blank object legal', async () => {
		const input = {
			[REFERENCES_INFO_CARD_PROPERTY]: {},
			[REFERENCES_CARD_PROPERTY]: {},
		};
		const result = referencesLegalShape(input);
		assert.strictEqual(result, true);
	});

	it('missing references illegal', async () => {
		const input = {
			[REFERENCES_INFO_CARD_PROPERTY]: {},
		};
		const result = referencesLegalShape(input);
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
		const result = referencesLegalShape(input);
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
		const result = referencesLegalShape(input);
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
		const result = referencesLegalShape(input);
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
		const result = referencesLegalShape(input);
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
		const result = referencesLegalShape(input);
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
		const result = referencesLegalShape(input);
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
		const result = referencesLegalShape(input);
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
		const result = referencesLegalShape(input);
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
		const result = referencesLegalShape(input);
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
		const result = referencesLegalShape(input);
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
		const result = referencesLegalShape(input);
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
		const entryResult = referencesEntriesDiff(inputBefore, inputAfter);
		const expectedEntryResult = [];
		assert.deepStrictEqual(entryResult, expectedEntryResult);
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
		const entryResult = referencesEntriesDiff(inputBefore, inputAfter);
		const expectedEntryResult = [];
		assert.deepStrictEqual(entryResult, expectedEntryResult);
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
		const entryResult = referencesEntriesDiff(inputBefore, inputAfter);
		const expectedEntryResult = [];
		assert.deepStrictEqual(entryResult, expectedEntryResult);
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
		const entryResult = referencesEntriesDiff(inputBefore, inputAfter);
		const expectedEntryResult = [
			{
				cardID: 'foo',
				referenceType: REFERENCE_TYPE_LINK,
				value: 'value',
			}
		];
		assert.deepStrictEqual(entryResult, expectedEntryResult);
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
		const entryResult = referencesEntriesDiff(inputBefore, inputAfter);
		const expectedEntryResult = [
			{
				cardID: 'foo',
				referenceType: REFERENCE_TYPE_LINK,
				value: 'value',
			},
			{
				cardID: 'foo',
				referenceType: REFERENCE_TYPE_DUPE_OF,
				value: 'other-value',
			}
		];
		assert.deepStrictEqual(entryResult, expectedEntryResult);
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
		const entryResult = referencesEntriesDiff(inputBefore, inputAfter);
		const expectedEntryResult = [
			{
				cardID: 'foo',
				referenceType: REFERENCE_TYPE_DUPE_OF,
				value: 'other-value',
			}
		];
		assert.deepStrictEqual(entryResult, expectedEntryResult);
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
		const entryResult = referencesEntriesDiff(inputBefore, inputAfter);
		const expectedEntryResult = [
			{
				cardID: 'foo',
				referenceType: REFERENCE_TYPE_LINK,
				delete:	true,
			}
		];
		assert.deepStrictEqual(entryResult, expectedEntryResult);
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
		const entryResult = referencesEntriesDiff(inputBefore, inputAfter);
		const expectedEntryResult = [
			{
				cardID: 'foo',
				referenceType: REFERENCE_TYPE_DUPE_OF,
				delete: true,
			}
		];
		assert.deepStrictEqual(entryResult, expectedEntryResult);
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
		const entryResult = referencesEntriesDiff(inputBefore, inputAfter);
		const expectedEntryResult = [
			{
				cardID: 'foo',
				referenceType: REFERENCE_TYPE_LINK,
				value: 'value',
			}
		];
		assert.deepStrictEqual(entryResult, expectedEntryResult);
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
		const entryResult = referencesEntriesDiff(inputBefore, inputAfter);
		const expectedEntryResult = [
			{
				cardID: 'foo',
				referenceType: REFERENCE_TYPE_LINK,
				value: 'value',
			},
			{
				cardID: 'foo',
				referenceType: REFERENCE_TYPE_DUPE_OF,
				value: 'other-value',
			}
		];
		assert.deepStrictEqual(entryResult, expectedEntryResult);
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
		const entryResult = referencesEntriesDiff(inputBefore, inputAfter);
		const expectedEntryResult = [];
		assert.deepStrictEqual(entryResult, expectedEntryResult);
	});

	it('empty after object', async() => {
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
		const inputAfter = {};
		const cardResult = referencesCardsDiff(inputBefore, inputAfter);
		const expectedCardResult = [
			{},
			{
				'foo': true,
			},
		];
		assert.deepStrictEqual(cardResult, expectedCardResult);
		const entryResult = referencesEntriesDiff(inputBefore, inputAfter);
		const expectedEntryResult = [];
		assert.deepStrictEqual(entryResult, expectedEntryResult);
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
		const entryResult = referencesEntriesDiff(inputBefore, inputAfter);
		const expectedEntryResult = [];
		assert.deepStrictEqual(entryResult, expectedEntryResult);
	});

	it('null after object', async() => {
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
		const inputAfter = null;
		const cardResult = referencesCardsDiff(inputBefore, inputAfter);
		const expectedCardResult = [
			{},
			{
				'foo': true,
			},
		];
		assert.deepStrictEqual(cardResult, expectedCardResult);
		const entryResult = referencesEntriesDiff(inputBefore, inputAfter);
		const expectedEntryResult = [];
		assert.deepStrictEqual(entryResult, expectedEntryResult);
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
			[REFERENCES_INFO_CARD_PROPERTY + '.modification-card.' + REFERENCE_TYPE_DUPE_OF]: deleteField(),
			[REFERENCES_INFO_CARD_PROPERTY + '.deletion-card']: deleteField(),
			[REFERENCES_CARD_PROPERTY + '.deletion-card']: deleteField(),
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
		const entryResult = referencesEntriesDiff(inputBefore, inputAfter);
		const expectedEntryResult = [
			{
				cardID: 'deletion-card',
				referenceType: REFERENCE_TYPE_LINK,
				delete: true,
			},
			{
				cardID: 'deletion-card',
				referenceType: REFERENCE_TYPE_DUPE_OF,
				delete: true,
			},
			{
				cardID: 'modification-card',
				referenceType: REFERENCE_TYPE_DUPE_OF,
				delete: true,
			},
			{
				cardID: 'modification-card',
				referenceType: REFERENCE_TYPE_LINK,
				value: 'after-value',
			},
			{
				cardID: 'addition-card',
				referenceType: REFERENCE_TYPE_LINK,
				value: 'after-value'
			},
		];
		assert.deepStrictEqual(entryResult, expectedEntryResult);

	});

});

describe('references.withFallbackText', () => {
	it('no op', () => {
		const input = {
			[REFERENCES_INFO_CARD_PROPERTY]: {
				'foo': {
					'ack': '',
				},
			},
			[REFERENCES_CARD_PROPERTY]: {
				'foo': true,
			},
		};

		const clonedInput = JSON.parse(JSON.stringify(input));

		const fallbackMap = {};

		const expectedResult = {
			[REFERENCES_INFO_CARD_PROPERTY]: {
				'foo': {
					'ack': '',
				},
			},
			[REFERENCES_CARD_PROPERTY]: {
				'foo': true,
			},
		};

		const ref = references(input);
		const fallbackRef = ref.withFallbackText(fallbackMap);
		assert.deepStrictEqual(fallbackRef._cardObj, expectedResult);
		//Verify the original didn't change
		assert.deepStrictEqual(ref._cardObj, clonedInput);
	});

	it('one to replace', () => {
		const input = {
			[REFERENCES_INFO_CARD_PROPERTY]: {
				'foo': {
					'ack': '',
				},
			},
			[REFERENCES_CARD_PROPERTY]: {
				'foo': true,
			},
		};

		const clonedInput = JSON.parse(JSON.stringify(input));

		const fallbackMap = {
			foo: {
				ack: 'bam',
			}
		};

		const expectedResult = {
			[REFERENCES_INFO_CARD_PROPERTY]: {
				'foo': {
					'ack': 'bam',
				},
			},
			[REFERENCES_CARD_PROPERTY]: {
				'foo': true,
			},
		};

		const ref = references(input);
		const fallbackRef = ref.withFallbackText(fallbackMap);
		assert.deepStrictEqual(fallbackRef._cardObj, expectedResult);
		//Verify the original didn't change
		assert.deepStrictEqual(ref._cardObj, clonedInput);
	});

	it('one to replace but it already has a string', () => {
		const input = {
			[REFERENCES_INFO_CARD_PROPERTY]: {
				'foo': {
					'ack': 'bar',
				},
			},
			[REFERENCES_CARD_PROPERTY]: {
				'foo': true,
			},
		};

		const clonedInput = JSON.parse(JSON.stringify(input));

		const fallbackMap = {
			foo: {
				ack: 'bam',
			}
		};

		const expectedResult = {
			[REFERENCES_INFO_CARD_PROPERTY]: {
				'foo': {
					'ack': 'bar',
				},
			},
			[REFERENCES_CARD_PROPERTY]: {
				'foo': true,
			},
		};

		const ref = references(input);
		const fallbackRef = ref.withFallbackText(fallbackMap);
		assert.deepStrictEqual(fallbackRef._cardObj, expectedResult);
		//Verify the original didn't change
		assert.deepStrictEqual(ref._cardObj, clonedInput);
	});

	it('no overlap in fallback map', () => {
		const input = {
			[REFERENCES_INFO_CARD_PROPERTY]: {
				'foo': {
					'ack': '',
				},
			},
			[REFERENCES_CARD_PROPERTY]: {
				'foo': true,
			},
		};

		const clonedInput = JSON.parse(JSON.stringify(input));

		const fallbackMap = {
			bar: {
				ack: 'bam',
			}
		};

		const expectedResult = {
			[REFERENCES_INFO_CARD_PROPERTY]: {
				'foo': {
					'ack': '',
				},
			},
			[REFERENCES_CARD_PROPERTY]: {
				'foo': true,
			},
		};

		const ref = references(input);
		const fallbackRef = ref.withFallbackText(fallbackMap);
		assert.deepStrictEqual(fallbackRef._cardObj, expectedResult);
		//Verify the original didn't change
		assert.deepStrictEqual(ref._cardObj, clonedInput);
	});

});

describe('unionReferences and intersectionReferences', () => {

	it('no cards', () => {
		const input = [];

		const expectedResult = {
			[REFERENCES_INFO_CARD_PROPERTY]: {},
			[REFERENCES_CARD_PROPERTY]: {},
		};

		const result = unionReferences(input);
		assert.deepStrictEqual(result, expectedResult);
		const intersectionResult = intersectionReferences(input);
		assert.deepStrictEqual(intersectionResult, expectedResult);
	});

	it('single card', () => {
		const input = [
			{
				[REFERENCES_INFO_CARD_PROPERTY]: {
					'foo': {
						[REFERENCE_TYPE_ACK]: '',
					},
				},
				[REFERENCES_CARD_PROPERTY]: {
					'foo': true,
				}
			},
		];

		const expectedResult = {
			[REFERENCES_INFO_CARD_PROPERTY]: {
				'foo': {
					[REFERENCE_TYPE_ACK]: '',
				},
			},
			[REFERENCES_CARD_PROPERTY]: {
				'foo': true,
			},
		};

		const result = unionReferences(input);
		assert.deepStrictEqual(result, expectedResult);
		const intersectionResult = intersectionReferences(input);
		assert.deepStrictEqual(intersectionResult, expectedResult);
	});

	it('two cards partial overlap', () => {
		const input = [
			{
				[REFERENCES_INFO_CARD_PROPERTY]: {
					'foo': {
						[REFERENCE_TYPE_ACK]: '',
					},
				},
				[REFERENCES_CARD_PROPERTY]: {
					'foo': true,
				}
			},
			{
				[REFERENCES_INFO_CARD_PROPERTY]: {
					'bar': {
						[REFERENCE_TYPE_ACK]: 'value',
					},
					'foo': {
						[REFERENCE_TYPE_ACK]: '',
						[REFERENCE_TYPE_DUPE_OF]: '',
					},
				},
				[REFERENCES_CARD_PROPERTY]: {
					'foo': true,
					'bar': true,
				}
			}
		];

		const expectedResult = {
			[REFERENCES_INFO_CARD_PROPERTY]: {
				'foo': {
					[REFERENCE_TYPE_ACK]: '',
					[REFERENCE_TYPE_DUPE_OF]: '',
				},
				'bar': {
					[REFERENCE_TYPE_ACK]: 'value',
				},
			},
			[REFERENCES_CARD_PROPERTY]: {
				'foo': true,
				'bar': true,
			},
		};

		const expectedIntersectionResult = {
			[REFERENCES_INFO_CARD_PROPERTY]: {
				'foo': {
					[REFERENCE_TYPE_ACK]: '',
				},
			},
			[REFERENCES_CARD_PROPERTY]: {
				'foo': true,
			},
		};

		const result = unionReferences(input);
		assert.deepStrictEqual(result, expectedResult);
		const intersectionResult = intersectionReferences(input);
		assert.deepStrictEqual(intersectionResult, expectedIntersectionResult);
	});

	it('two cards no overlap', () => {
		const input = [
			{
				[REFERENCES_INFO_CARD_PROPERTY]: {
					'foo': {
						[REFERENCE_TYPE_ACK]: '',
					},
				},
				[REFERENCES_CARD_PROPERTY]: {
					'foo': true,
				}
			},
			{
				[REFERENCES_INFO_CARD_PROPERTY]: {
					'bar': {
						[REFERENCE_TYPE_ACK]: 'value',
					},
				},
				[REFERENCES_CARD_PROPERTY]: {
					'bar': true,
				}
			}
		];

		const expectedResult = {
			[REFERENCES_INFO_CARD_PROPERTY]: {
				'foo': {
					[REFERENCE_TYPE_ACK]: '',
				},
				'bar': {
					[REFERENCE_TYPE_ACK]: 'value',
				},
			},
			[REFERENCES_CARD_PROPERTY]: {
				'foo': true,
				'bar': true,
			},
		};

		const expectedIntersectionResult = {
			[REFERENCES_INFO_CARD_PROPERTY]: {},
			[REFERENCES_CARD_PROPERTY]: {},
		};

		const result = unionReferences(input);
		assert.deepStrictEqual(result, expectedResult);
		const intersectionResult = intersectionReferences(input);
		assert.deepStrictEqual(intersectionResult, expectedIntersectionResult);
	});

	it('three cards some overlap', () => {
		const input = [
			{
				[REFERENCES_INFO_CARD_PROPERTY]: {
					'foo': {
						[REFERENCE_TYPE_ACK]: '',
						[REFERENCE_TYPE_DUPE_OF]: '',
					},
				},
				[REFERENCES_CARD_PROPERTY]: {
					'foo': true,
				}
			},
			{
				[REFERENCES_INFO_CARD_PROPERTY]: {
					'foo': {
						[REFERENCE_TYPE_DUPE_OF]: '',
					},
					'bar': {
						[REFERENCE_TYPE_ACK]: 'value',
					},
				},
				[REFERENCES_CARD_PROPERTY]: {
					'bar': true,
					'foo': true,
				}
			},
			{
				[REFERENCES_INFO_CARD_PROPERTY]: {
					'foo': {
						[REFERENCE_TYPE_DUPE_OF]: '',
					},
				},
				[REFERENCES_CARD_PROPERTY]: {
					'foo': true,
				}
			},
		];

		const expectedResult = {
			[REFERENCES_INFO_CARD_PROPERTY]: {
				'foo': {
					[REFERENCE_TYPE_ACK]: '',
					[REFERENCE_TYPE_DUPE_OF]: '',
				},
				'bar': {
					[REFERENCE_TYPE_ACK]: 'value',
				},
			},
			[REFERENCES_CARD_PROPERTY]: {
				'foo': true,
				'bar': true,
			},
		};

		const expectedIntersectionResult = {
			[REFERENCES_INFO_CARD_PROPERTY]: {
				'foo': {
					[REFERENCE_TYPE_DUPE_OF]: '',
				},
			},
			[REFERENCES_CARD_PROPERTY]: {
				'foo': true,
			}
		};

		const result = unionReferences(input);
		assert.deepStrictEqual(result, expectedResult);
		const intersectionResult = intersectionReferences(input);
		assert.deepStrictEqual(intersectionResult, expectedIntersectionResult);
	});
});
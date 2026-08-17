/*eslint-env node*/

//WHAT A LOCAL ECHO IS ALLOWED TO PUT IN A CARD.
//
//applyCardFirebaseUpdate is the one function that turns a Firestore update into
//a card object, and every optimistic echo goes through it: the card the user
//sees immediately after Save, and the copy handed to the corpus worker, are
//both built here. A Firestore update legally contains WRITE INSTRUCTIONS
//(deleteField, serverTimestamp, arrayUnion, arrayRemove) that are not values.
//Storing one as if it were a value produces a card whose field is a FieldValue
//object, and every later reader that iterates that field throws — which is
//exactly what happened in production: `tags` became an ArrayUnionFieldValueImpl
//and the multi-edit dialog's own tag-union selector threw out of store.dispatch
//in the middle of the save loop, aborting it with 10 of 100 cards left and a
//pending durable record that disabled editing until reload.
//
//deleteField and serverTimestamp were always handled. Array transforms were
//not. These tests pin all four, and pin the rule that covers the transform
//nobody has invented yet: a sentinel this layer cannot resolve must NEVER be
//written into the card.

import assert from 'assert';

let setFirebaseValueOnObj;
let applyCardFirebaseUpdate;

//A stand-in for the client SDK's sentinels. The real client config
//(src/card_diff.ts clientSentinels) is exercised end to end by
//test/durable-multi-edit-loop, which runs the real firebase SDK against the
//emulator; this file pins the shared contract those configs plug into.
const DELETE = {__sentinel: 'delete'};
const SERVER_TIMESTAMP = {__sentinel: 'serverTimestamp'};
const NOW = {__timestamp: true};
const union = (...elements) => ({__sentinel: 'arrayUnion', elements});
const remove = (...elements) => ({__sentinel: 'arrayRemove', elements});
//A transform this config does NOT know how to resolve — the stand-in for
//"someone added a new Firestore transform, or called the SDK's arrayUnion
//directly instead of the vending wrapper".
const UNKNOWN_TRANSFORM = {__sentinel: 'increment'};

const sentinels = {
	deleteField: () => DELETE,
	isDeleteSentinel: (value) => value === DELETE,
	isServerTimestampSentinel: (value) => value === SERVER_TIMESTAMP,
	currentTimestamp: () => NOW,
	asArrayTransform: (value) => {
		if (!value || typeof value !== 'object') return null;
		if (value.__sentinel === 'arrayUnion') return {union: true, elements: value.elements};
		if (value.__sentinel === 'arrayRemove') return {union: false, elements: value.elements};
		return null;
	},
	isUnmaterializableSentinel: (value) => Boolean(value && typeof value === 'object' && value.__sentinel),
};

const apply = (obj, field, value) => {
	setFirebaseValueOnObj(obj, field.split('.'), value, sentinels);
	return obj;
};

describe('setFirebaseValueOnObj sentinel materialization', () => {

	before(async () => {
		const cardWrite = await import('../../lib/shared/card_write.js');
		setFirebaseValueOnObj = cardWrite.setFirebaseValueOnObj;
		applyCardFirebaseUpdate = cardWrite.applyCardFirebaseUpdate;
	});

	it('resolves arrayUnion against the value already on the object', () => {
		const obj = {tags: ['alpha']};
		apply(obj, 'tags', union('beta', 'gamma'));
		assert.deepStrictEqual(obj.tags, ['alpha', 'beta', 'gamma']);
	});

	it('does not duplicate an element arrayUnion already has', () => {
		const obj = {tags: ['alpha', 'beta']};
		apply(obj, 'tags', union('beta'));
		assert.deepStrictEqual(obj.tags, ['alpha', 'beta']);
	});

	it('resolves arrayRemove, ignoring elements that are not present', () => {
		const obj = {tags: ['alpha', 'beta']};
		apply(obj, 'tags', remove('beta', 'never-had-it'));
		assert.deepStrictEqual(obj.tags, ['alpha']);
	});

	it('treats a missing field as an empty array rather than throwing', () => {
		const obj = {};
		apply(obj, 'tags', union('alpha'));
		assert.deepStrictEqual(obj.tags, ['alpha']);
	});

	it('does not mutate the array it was given', () => {
		//The base array is shared with the card still in Redux; mutating it
		//would change that card in place, which reselect cannot see.
		const original = ['alpha'];
		const obj = {tags: original};
		apply(obj, 'tags', union('beta'));
		assert.deepStrictEqual(original, ['alpha']);
		assert.notStrictEqual(obj.tags, original);
	});

	it('leaves a sentinel it cannot resolve out of the card entirely', () => {
		//Stale is recoverable — the server echo repairs it moments later. A
		//FieldValue sitting in the field is not: it throws in every consumer.
		const obj = {tags: ['alpha']};
		apply(obj, 'tags', UNKNOWN_TRANSFORM);
		assert.deepStrictEqual(obj.tags, ['alpha']);
	});

	it('still handles the two sentinels it always did', () => {
		const obj = {title: 'old', updated: 'old'};
		apply(obj, 'title', DELETE);
		apply(obj, 'updated', SERVER_TIMESTAMP);
		assert.ok(!('title' in obj));
		assert.strictEqual(obj.updated, NOW);
	});

	it('materializes a whole update, transforms included', () => {
		const card = {id: 'c1', tags: ['alpha'], auto_todo_overrides: {}, title: 'before'};
		const updated = applyCardFirebaseUpdate(card, {
			title: 'after',
			tags: union('beta'),
			'auto_todo_overrides.prioritized': true,
			updated: SERVER_TIMESTAMP,
		}, sentinels);
		assert.deepStrictEqual(updated.tags, ['alpha', 'beta']);
		assert.strictEqual(updated.title, 'after');
		assert.deepStrictEqual(updated.auto_todo_overrides, {prioritized: true});
		assert.strictEqual(updated.updated, NOW);
		//The input card is the one still in Redux; it must be untouched.
		assert.deepStrictEqual(card.tags, ['alpha']);
		assert.deepStrictEqual(card.auto_todo_overrides, {});
	});

	it('composes successive transforms on the same field', () => {
		//A multi-edit chunk materializes each card on top of the echoes already
		//accumulated for that batch, so the second transform must see the first.
		let card = {id: 'c1', tags: []};
		card = applyCardFirebaseUpdate(card, {tags: union('alpha')}, sentinels);
		card = applyCardFirebaseUpdate(card, {tags: union('beta')}, sentinels);
		card = applyCardFirebaseUpdate(card, {tags: remove('alpha')}, sentinels);
		assert.deepStrictEqual(card.tags, ['beta']);
	});

	it('is a no-op for configs that do not declare the new hooks', () => {
		//shared/ is used by functions/ too, whose admin-SDK config declares
		//neither hook. Those updates never carry array transforms, and the old
		//behavior (store the value) must be exactly preserved for them.
		const legacy = {
			deleteField: () => DELETE,
			isDeleteSentinel: (value) => value === DELETE,
			isServerTimestampSentinel: (value) => value === SERVER_TIMESTAMP,
			currentTimestamp: () => NOW,
		};
		const obj = {tags: ['alpha']};
		setFirebaseValueOnObj(obj, ['tags'], ['beta'], legacy);
		assert.deepStrictEqual(obj.tags, ['beta']);
	});
});

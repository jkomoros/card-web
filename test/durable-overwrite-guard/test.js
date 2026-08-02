/*eslint-env node*/

//The durable multi-edit's overwrite guard. The hazard: a record can be resumed
//automatically hours or days later, and its CardDiff REPLACES whole text
//fields — so replaying it over content saved in between destroys that content.

import assert from 'node:assert/strict';

let guard;

describe('durable overwrite guard', () => {
	before(async () => {
		guard = await import('../../lib/src/durable-overwrite-guard.js');
	});

	it('records a base only for fields that can destroy content', () => {
		assert.deepEqual(guard.replacedFieldsOf({body: 'x', add_tags: ['a']}), ['body']);
		//An additive multi-edit stores nothing at all.
		assert.deepEqual(guard.replacedFieldsOf({add_tags: ['a'], references_diff: []}), []);
	});

	it('flags the laptop-then-phone scenario', () => {
		//Save on laptop (base 'old'), fails transiently. Rewrite on phone.
		//Laptop wakes days later and would write 'laptop' over 'phone'.
		const conflicts = guard.overwrittenCardFields(
			{body: 'laptop'},
			{c1: {body: 'old'}},
			{c1: {body: 'phone'}},
			['c1']);
		assert.deepEqual(conflicts, [{id: 'c1', fields: ['body']}]);
		assert.match(guard.overwriteConflictMessage(conflicts), /^Changed elsewhere after you saved: c1 \(body\)/);
	});

	it('does not flag a card nobody touched', () => {
		assert.deepEqual(guard.overwrittenCardFields(
			{body: 'new'}, {c1: {body: 'old'}}, {c1: {body: 'old'}}, ['c1']), []);
	});

	it('does not flag our own partially-committed chunk', () => {
		//The server already holds exactly what we would write: the earlier
		//attempt landed for this card. Retrying must not look like a conflict,
		//or a split batch would wedge every resume.
		assert.deepEqual(guard.overwrittenCardFields(
			{body: 'new'}, {c1: {body: 'old'}}, {c1: {body: 'new'}}, ['c1']), []);
	});

	it('ignores additive fields entirely', () => {
		//add_tags merges; a divergent server value is not a loss. Nothing is
		//recorded for it, so nothing can be flagged.
		const base = {c1: {}};
		assert.deepEqual(guard.overwrittenCardFields(
			{add_tags: ['b']}, base, {c1: {tags: ['a', 'z']}}, ['c1']), []);
	});

	it('stays resumable for records written before the guard existed', () => {
		//An old record has no baseFields. It must not become permanently stuck.
		assert.deepEqual(guard.overwrittenCardFields(
			{body: 'new'}, undefined, {c1: {body: 'anything'}}, ['c1']), []);
	});

	it('reports every conflicting card and field in the chunk', () => {
		const conflicts = guard.overwrittenCardFields(
			{body: 'B', title: 'T'},
			{c1: {body: 'b0', title: 't0'}, c2: {body: 'b0', title: 't0'}, c3: {body: 'b0', title: 't0'}},
			{c1: {body: 'other', title: 't0'}, c2: {body: 'b0', title: 't0'}, c3: {body: 'other', title: 'other'}},
			['c1', 'c2', 'c3']);
		assert.deepEqual(conflicts, [
			{id: 'c1', fields: ['body']},
			{id: 'c3', fields: ['body', 'title']},
		]);
	});

	it('does not flag an unchanged ARRAY field as a conflict', () => {
		//images and title_alternates are arrays, and two arrays are never ===,
		//so identity comparison refused every image edit with a bogus
		//"changed elsewhere" conflict.
		assert.deepEqual(guard.overwrittenCardFields(
			{images: [{src: 'a'}, {src: 'b'}]},
			{c1: {images: [{src: 'a'}]}},
			{c1: {images: [{src: 'a'}]}},
			['c1']), [], 'an untouched array field is not a conflict');
		//Already equal to what we would write, by value.
		assert.deepEqual(guard.overwrittenCardFields(
			{images: [{src: 'a'}, {src: 'b'}]},
			{c1: {images: [{src: 'a'}]}},
			{c1: {images: [{src: 'a'}, {src: 'b'}]}},
			['c1']), [], 'a server value equal to ours by value is not a conflict');
		//A genuine divergence still is one.
		assert.deepEqual(guard.overwrittenCardFields(
			{images: [{src: 'a'}, {src: 'b'}]},
			{c1: {images: [{src: 'a'}]}},
			{c1: {images: [{src: 'z'}]}},
			['c1']), [{id: 'c1', fields: ['images']}]);
		//Order is meaningful for images: a reorder IS a change.
		assert.deepEqual(guard.overwrittenCardFields(
			{images: [{src: 'a'}]},
			{c1: {images: [{src: 'a'}, {src: 'b'}]}},
			{c1: {images: [{src: 'b'}, {src: 'a'}]}},
			['c1']), [{id: 'c1', fields: ['images']}]);
	});

	it('ignores KEY ORDER when comparing object fields', () => {
		//Server-stored images and client-constructed ones have different key
		//orders, so a key-order-sensitive compare brought the bogus "changed
		//elsewhere" refusal back for a second consecutive images save — the
		//base recorded from a local echo is the client-shaped copy.
		const serverShaped = [{position: 0, height: 10, src: 'a', width: 20}];
		const clientShaped = [{src: 'a', width: 20, height: 10, position: 0}];
		assert.deepEqual(guard.overwrittenCardFields(
			{images: [{src: 'b'}]},
			{c1: {images: clientShaped}},
			{c1: {images: serverShaped}},
			['c1']), [], 'same values in a different key order is not a conflict');
		//A real value difference still is one, whatever the key order.
		assert.deepEqual(guard.overwrittenCardFields(
			{images: [{src: 'b'}]},
			{c1: {images: clientShaped}},
			{c1: {images: [{position: 0, height: 10, src: 'DIFFERENT', width: 20}]}},
			['c1']), [{id: 'c1', fields: ['images']}]);
	});

	it('ignores KEY SET differences that carry no content (R15-7)', () => {
		//A base recorded before a field was added to the client's image defaults
		//lacks the key; the server copy carries it at its default. That is the
		//same content, but the guard refused the save over it — and the user
		//could not resolve it by editing anything, because there was nothing to
		//edit. This is a save the user cannot complete, so it is a data-loss
		//path, not a cosmetic one.
		const oldBase = [{src: 'a', width: 20}];
		const serverWithNewFields = [{src: 'a', width: 20, alt: '', margin: 0, uploadPath: ''}];
		assert.deepEqual(guard.overwrittenCardFields(
			{images: [{src: 'b'}]},
			{c1: {images: oldBase}},
			{c1: {images: serverWithNewFields}},
			['c1']), [], 'keys present only at their empty value are not a change');
		//It cuts both ways: the base may have the key and the server may not.
		assert.deepEqual(guard.overwrittenCardFields(
			{images: [{src: 'b'}]},
			{c1: {images: serverWithNewFields}},
			{c1: {images: oldBase}},
			['c1']), []);
		//But a key that appeared with REAL content is a genuine change, and must
		//still be caught. This is the assertion that keeps the fix from
		//degrading into "compare nothing".
		assert.deepEqual(guard.overwrittenCardFields(
			{images: [{src: 'b'}]},
			{c1: {images: oldBase}},
			{c1: {images: [{src: 'a', width: 20, alt: 'a caption they wrote'}]}},
			['c1']), [{id: 'c1', fields: ['images']}]);
	});

	it('treats a base recorded before the FIELD existed as unchanged (R15-7)', () => {
		//Whole-field version: baseFields records `card[field]`, which is
		//undefined for a field the card did not have, and the localStorage round
		//trip then drops the key entirely. The server holds the field's empty
		//value. Neither carries content, so neither can be overwritten.
		assert.deepEqual(guard.overwrittenCardFields(
			{external_link: 'https://example.com'},
			{c1: {external_link: undefined}},
			{c1: {external_link: ''}},
			['c1']), [], 'absent and empty are the same content');
		//Real content on either side is still a conflict.
		assert.deepEqual(guard.overwrittenCardFields(
			{external_link: 'https://example.com'},
			{c1: {external_link: undefined}},
			{c1: {external_link: 'https://they-set-this.example'}},
			['c1']), [{id: 'c1', fields: ['external_link']}]);
		assert.deepEqual(guard.overwrittenCardFields(
			{body: 'mine'},
			{c1: {body: 'what I saw'}},
			{c1: {body: ''}},
			['c1']), [{id: 'c1', fields: ['body']}], 'a field CLEARED elsewhere is still a conflict');
	});

	it('skips cards absent from the server (deleted elsewhere)', () => {
		assert.deepEqual(guard.overwrittenCardFields(
			{body: 'new'}, {c1: {body: 'old'}}, {}, ['c1']), []);
	});
});

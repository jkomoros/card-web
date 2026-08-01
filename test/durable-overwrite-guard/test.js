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

	it('skips cards absent from the server (deleted elsewhere)', () => {
		assert.deepEqual(guard.overwrittenCardFields(
			{body: 'new'}, {c1: {body: 'old'}}, {}, ['c1']), []);
	});
});

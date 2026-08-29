/*eslint-env node, es2022*/

//THE ACCEPTANCE GATE FOR THE BOOLEAN DRAFT LAYER.
//
//The spec makes round-trip tests mandatory before any composer UI is allowed to
//edit boolean structure, because the failure mode is silent: a draft layer that
//re-spells `exclude/combine/a/b` slightly wrong does not throw, it just shows
//the user a different collection than the URL they opened. So the contract
//asserted here is behavioral, not textual — where the compiler picks a better
//spelling than the one it read, the two spellings are handed to the ENGINE and
//required to select the same cards.

import { JSDOM } from 'jsdom';
import assert from 'assert';

import {
	ROUND_TRIP_FIXTURES,
	ENGINE_EQUIVALENT_SPELLINGS,
	CORPUS,
} from './fixtures.js';

const dom = new JSDOM('');
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.Document = dom.window.Document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.customElements = dom.window.customElements;
globalThis.CSSStyleSheet = dom.window.CSSStyleSheet;

let CollectionDescription;
let collectionURLPath;
let QueryEngine;
let INITIAL_STATE;
let INVERSE_FILTER_NAMES;
let expression;

const card = (id, extras) => ({
	id,
	card_type: 'content',
	title: 'Title of ' + id,
	body: '<p>Body of ' + id + '</p>',
	section: 'main',
	tags: [],
	sort_order: 1.0,
	references: {},
	references_info: {},
	references_inbound: {},
	references_info_inbound: {},
	star_count: 0,
	thread_count: 0,
	notes: '',
	todo: '',
	auto_todo_overrides: {},
	published: true,
	full_bleed: false,
	images: [],
	...extras,
});

let engine;

const serializedFor = (filters) => new CollectionDescription('main', filters).serialize();

//THE ENGINE IS THE JUDGE. Two filters[] are equivalent when a real collection
//run over the same corpus returns the same cards in the same order. The cheap
//check first: if the canonical serializations are identical there is nothing to
//run, because they ARE the same collection.
const assertEngineEquivalent = (a, b, message) => {
	const serializedA = serializedFor(a);
	const serializedB = serializedFor(b);
	if (serializedA === serializedB) return;
	const resultA = engine.runCollection(serializedA);
	const resultB = engine.runCollection(serializedB);
	assert.deepStrictEqual(resultB.ids, resultA.ids,
		`${message}: ${JSON.stringify(a)} and ${JSON.stringify(b)} select different cards`);
};

describe('Collection expression boolean draft layer', () => {

	before(async () => {
		({ CollectionDescription, collectionURLPath } = await import('../../lib/src/collection_description.js'));
		({ QueryEngine } = await import('../../lib/src/worker/query-engine.js'));
		({ INITIAL_STATE, INVERSE_FILTER_NAMES } = await import('../../lib/src/filters.js'));
		expression = await import('../../lib/src/collection-expression.js');

		const cards = Object.fromEntries(Object.entries(CORPUS).map(([id, extras]) => [id, card(id, extras)]));
		engine = new QueryEngine();
		engine.updateCards(cards, []);
	});

	describe('the round-trip matrix', () => {

		for (const fixture of ROUND_TRIP_FIXTURES) {

			it(`${fixture.category}: ${fixture.name}`, () => {
				const parsed = expression.parseCollectionExpression(fixture.filters);
				assert.deepStrictEqual(parsed, fixture.expression,
					'parsed into a different shape than the fixture states');

				const compiled = expression.serializeCollectionExpression(parsed);
				assert.deepStrictEqual(compiled, fixture.serialized,
					'compiled to a different spelling than the fixture states');

				//THE PROPERTY: parsing the compiled form must land on the same
				//tree. This is what "lossless" means operationally — a draft
				//that survives a trip through the URL and back is a draft the
				//composer can round-trip on every navigation.
				const reparsed = expression.parseCollectionExpression(compiled);
				assert.deepStrictEqual(reparsed, parsed,
					'parse(serialize(parse(f))) diverged from parse(f)');

				//And the spelling must be a fixed point, or every save would
				//rewrite the user's URL a second time for no reason.
				assert.deepStrictEqual(expression.serializeCollectionExpression(reparsed), compiled,
					'serialize was not idempotent on the second pass');

				assertEngineEquivalent(fixture.filters, compiled, fixture.name);
			});
		}
	});

	describe('every plain filter', () => {

		const plainFilterNames = () => {
			const names = new Set(Object.keys(INITIAL_STATE.filters));
			for (const [negative, positive] of Object.entries(INVERSE_FILTER_NAMES)) {
				names.add(negative);
				names.add(positive);
			}
			return [...names];
		};

		it('parses to one leaf and compiles back to itself', () => {
			const broken = [];
			for (const name of plainFilterNames()) {
				const parsed = expression.parseCollectionExpression([name]);
				const compiled = expression.serializeCollectionExpression(parsed);
				if (parsed.length !== 1 || parsed[0].kind !== 'filter' || parsed[0].filter !== name) {
					broken.push(`${name} parsed as ${JSON.stringify(parsed)}`);
					continue;
				}
				if (compiled.length !== 1 || compiled[0] !== name) broken.push(`${name} compiled as ${JSON.stringify(compiled)}`);
			}
			assert.deepStrictEqual(broken, []);
			//A sweep that silently covered nothing would also pass the check
			//above, so say how big it was supposed to be.
			assert.ok(plainFilterNames().length > 100,
				'the plain-filter sweep should cover the whole registry');
		});

		it('flips through the named inverse in both directions, and flipping twice is the identity', () => {
			const broken = [];
			for (const [negative, positive] of Object.entries(INVERSE_FILTER_NAMES)) {
				const flippedPositive = expression.negatedExpressionNode({kind: 'filter', filter: positive});
				if (flippedPositive.kind !== 'filter' || flippedPositive.filter !== negative) {
					broken.push(`${positive} flipped to ${JSON.stringify(flippedPositive)} instead of ${negative}`);
				}
				const flippedNegative = expression.negatedExpressionNode({kind: 'filter', filter: negative});
				if (flippedNegative.kind !== 'filter' || flippedNegative.filter !== positive) {
					broken.push(`${negative} flipped to ${JSON.stringify(flippedNegative)} instead of ${positive}`);
				}
				const twice = expression.negatedExpressionNode(flippedPositive);
				assert.deepStrictEqual(twice, {kind: 'filter', filter: positive});
			}
			assert.deepStrictEqual(broken, []);
		});

		it('reports which conditions have a word for their opposite', () => {
			assert.strictEqual(expression.conditionCanUseNamedInverse({kind: 'filter', filter: 'published'}), true);
			assert.strictEqual(expression.conditionCanUseNamedInverse({kind: 'filter', filter: 'unpublished'}), true);
			assert.strictEqual(expression.conditionCanUseNamedInverse({kind: 'filter', filter: 'query/zebra'}), false);
			assert.strictEqual(expression.conditionCanUseNamedInverse({
				kind: 'or',
				members: [{kind: 'filter', filter: 'published'}, {kind: 'filter', filter: 'no-tags'}]
			}), false);
			//A not-of-filter un-negates into the plain filter, which is a word
			//by construction.
			assert.strictEqual(expression.conditionCanUseNamedInverse({
				kind: 'not',
				child: {kind: 'filter', filter: 'query/zebra'}
			}), true);
		});
	});

	describe('engine-level equivalences the compiler relies on', () => {
		for (const pair of ENGINE_EQUIVALENT_SPELLINGS) {
			it(pair.name, () => {
				//Both must actually SELECT something, or "they agree" is a
				//statement about two empty sets.
				const result = engine.runCollection(serializedFor(pair.a));
				assert.ok(result.ids.length > 0, 'the fixture should select at least one card');
				assertEngineEquivalent(pair.a, pair.b, pair.name);
			});
		}

		it('never emits a combine whose first member the engine reads as a set name', () => {
			//A tag really can be named `everything`. Left-chaining means only
			//the FIRST member is ever re-parsed in leading position, so one
			//reorder is enough — and it has to happen, because the engine
			//silently no-ops the clause otherwise.
			const hazard = [
				{kind: 'filter', filter: 'everything'},
				{kind: 'filter', filter: 'query/zebra'},
			];
			const compiled = expression.serializeCollectionExpression([{kind: 'or', members: hazard}]);
			assert.deepStrictEqual(compiled, ['combine/query/zebra/everything']);
			//And the broken spelling is refused rather than modeled.
			assert.deepStrictEqual(
				expression.parseCollectionExpression(['combine/everything/query/zebra']),
				[{kind: 'manual', source: 'combine/everything/query/zebra'}]
			);
		});
	});

	describe('editing helpers', () => {

		const tag3 = {kind: 'filter', filter: 'tag-3'};
		const tag7 = {kind: 'filter', filter: 'tag-7'};

		it('appends a condition without touching the original', () => {
			const before = [tag3];
			const after = expression.withConditionAppended(before, tag7);
			assert.deepStrictEqual(after, [tag3, tag7]);
			assert.deepStrictEqual(before, [tag3], 'the input expression must not be mutated');
		});

		it('removes a condition by index and ignores an out-of-range one', () => {
			const before = [tag3, tag7];
			assert.deepStrictEqual(expression.withConditionRemoved(before, 0), [tag7]);
			assert.deepStrictEqual(expression.withConditionRemoved(before, 5), before);
			assert.deepStrictEqual(before, [tag3, tag7]);
		});

		it('grows a plain condition into an or-group when a member is added', () => {
			const after = expression.withMemberAddedToOr([tag3], 0, tag7);
			assert.deepStrictEqual(after, [{kind: 'or', members: [tag3, tag7]}]);
			assert.deepStrictEqual(expression.serializeCollectionExpression(after), ['tag-3+tag-7']);
		});

		it('adds a third member to a group that is already one', () => {
			const grown = expression.withMemberAddedToOr([tag3], 0, tag7);
			const after = expression.withMemberAddedToOr(grown, 0, {kind: 'filter', filter: 'tag-9'});
			assert.deepStrictEqual(expression.serializeCollectionExpression(after), ['tag-3+tag-7+tag-9']);
		});

		it('dissolves a one-member group back into a plain condition', () => {
			const grown = expression.withMemberAddedToOr([tag3], 0, tag7);
			const after = expression.withMemberRemoved(grown, 0, 1);
			assert.deepStrictEqual(after, [tag3], 'a group of one must not survive as a group');
			assert.deepStrictEqual(expression.serializeCollectionExpression(after), ['tag-3']);
		});

		it('removes the condition entirely when its last member goes', () => {
			const after = expression.withMemberRemoved([{kind: 'or', members: [tag3]}], 0, 0);
			assert.deepStrictEqual(after, []);
		});

		it('leaves a non-group condition alone when asked to remove a member', () => {
			const before = [tag3];
			assert.strictEqual(expression.withMemberRemoved(before, 0, 0), before);
		});

		it('prefers the named inverse when negating, in both directions', () => {
			const published = [{kind: 'filter', filter: 'published'}];
			const negated = expression.withNegationToggled(published, 0);
			assert.deepStrictEqual(negated, [{kind: 'filter', filter: 'unpublished'}]);
			assert.deepStrictEqual(expression.serializeCollectionExpression(negated), ['unpublished'],
				'a flip with a word for it must never compile to exclude/');
			//And back again — the pill reads `published`, not `not unpublished`.
			assert.deepStrictEqual(expression.withNegationToggled(negated, 0), published);
		});

		it('falls back to exclude/ only when there is no word', () => {
			const query = [{kind: 'filter', filter: 'query/zebra'}];
			const negated = expression.withNegationToggled(query, 0);
			assert.deepStrictEqual(negated, [{kind: 'not', child: {kind: 'filter', filter: 'query/zebra'}}]);
			assert.deepStrictEqual(expression.serializeCollectionExpression(negated), ['exclude/query/zebra']);
			assert.deepStrictEqual(expression.withNegationToggled(negated, 0), query);
		});

		it('negates a whole group with exclude/ over the group spelling', () => {
			const group = [{kind: 'or', members: [tag3, tag7]}];
			const negated = expression.withNegationToggled(group, 0);
			assert.deepStrictEqual(expression.serializeCollectionExpression(negated), ['exclude/tag-3+tag-7']);
			assert.deepStrictEqual(expression.withNegationToggled(negated, 0), group);
		});

		it('negates one member of a group without touching the others', () => {
			const group = [{kind: 'or', members: [{kind: 'filter', filter: 'published'}, tag7]}];
			const negated = expression.withMemberNegationToggled(group, 0, 0);
			assert.deepStrictEqual(negated, [{kind: 'or', members: [{kind: 'filter', filter: 'unpublished'}, tag7]}]);
			assert.deepStrictEqual(expression.serializeCollectionExpression(negated), ['unpublished+tag-7']);
		});

		it('negating a member of a non-group condition negates the condition', () => {
			const before = [{kind: 'filter', filter: 'published'}];
			assert.deepStrictEqual(expression.withMemberNegationToggled(before, 0, 0),
				[{kind: 'filter', filter: 'unpublished'}]);
		});

		it('a member with no word compiles the group as combine', () => {
			const group = [{kind: 'or', members: [{kind: 'filter', filter: 'query/zebra'}, tag7]}];
			const negated = expression.withMemberNegationToggled(group, 0, 0);
			assert.deepStrictEqual(expression.serializeCollectionExpression(negated),
				['combine/exclude/query/zebra/tag-7']);
			assert.deepStrictEqual(
				expression.parseCollectionExpression(['combine/exclude/query/zebra/tag-7']),
				negated, 'the combine spelling must read back as the same group');
		});
	});

	describe('display structure', () => {

		it('delegates leaf names to the composer display-name function', () => {
			const described = expression.describeExpressionNode(
				{kind: 'filter', filter: 'published'},
				{'published': 'Published'}
			);
			assert.deepStrictEqual(described, {kind: 'filter', label: 'Published', negated: false});
		});

		it('reads a group as its members joined by a subordinate or', () => {
			const described = expression.describeExpressionNode(
				{kind: 'or', members: [{kind: 'filter', filter: 'tag-3'}, {kind: 'filter', filter: 'tag-7'}]},
				{'tag-3': 'Systems', 'tag-7': 'AI'}
			);
			assert.strictEqual(described.kind, 'or');
			assert.strictEqual(described.label, 'Systems or AI');
			assert.strictEqual(described.negated, false);
			assert.deepStrictEqual(described.members.map(member => member.label), ['Systems', 'AI']);
		});

		it('marks a not-node negated and keeps the child described', () => {
			const described = expression.describeExpressionNode(
				{kind: 'not', child: {kind: 'filter', filter: 'query/zebra'}},
				{'query/zebra': 'Text contains “zebra”'}
			);
			assert.strictEqual(described.negated, true);
			assert.strictEqual(described.label, 'not Text contains “zebra”');
			assert.strictEqual(described.child.label, 'Text contains “zebra”');
		});

		it('does NOT mark a named inverse as negated — it is a word, not an operator', () => {
			const described = expression.describeExpressionNode(
				{kind: 'filter', filter: 'unpublished'},
				{'unpublished': 'Unpublished'}
			);
			assert.strictEqual(described.negated, false);
			assert.strictEqual(described.label, 'Unpublished');
		});

		it('shows a manual condition as its own source text', () => {
			const described = expression.describeExpressionNode({kind: 'manual', source: 'expand/published/children/+one'});
			assert.strictEqual(described.kind, 'manual');
			assert.strictEqual(described.label, 'expand/published/children/+one');
			assert.strictEqual(described.source, 'expand/published/children/+one');
		});
	});

	describe('the seam onto CollectionDescription', () => {

		it('carries set, sort and view through untouched', () => {
			const description = CollectionDescription.deserialize('everything/published/sort/reverse/stars/view/web/');
			const parsed = expression.collectionExpressionForDescription(description);
			assert.deepStrictEqual(parsed, [{kind: 'filter', filter: 'published'}]);
			const next = expression.collectionDescriptionWithExpression(description,
				expression.withConditionAppended(parsed, {kind: 'filter', filter: 'has-tags'}));
			assert.strictEqual(next.set, 'everything');
			assert.strictEqual(next.sort, 'stars');
			assert.strictEqual(next.sortReversed, true);
			assert.strictEqual(next.viewMode, 'web');
			assert.deepStrictEqual(next.filters, ['published', 'has-tags']);
		});

		it('preserves whether the set name was explicitly named', () => {
			//`setNameExplicitlySet` is carried, not recomputed, exactly as
			//collection_description's own private overrides helper carries it —
			//an edit to the CLAUSES is not an occasion to change the
			//description's account of its own set. (Note that `deserialize`
			//marks the set explicit even for `/c/starred/`, because it always
			//hands the constructor a name; the elision that keeps the URL short
			//is serializeShort's, not this flag's.)
			const built = new CollectionDescription(undefined, ['starred']);
			assert.strictEqual(built.setNameExplicitlySet, false);
			const nextBuilt = expression.collectionDescriptionWithExpression(built,
				expression.collectionExpressionForDescription(built));
			assert.strictEqual(nextBuilt.setNameExplicitlySet, false);
			assert.strictEqual(collectionURLPath(nextBuilt), '/c/starred/');

			const deserialized = CollectionDescription.deserialize('starred/');
			const nextDeserialized = expression.collectionDescriptionWithExpression(deserialized,
				expression.collectionExpressionForDescription(deserialized));
			assert.strictEqual(nextDeserialized.setNameExplicitlySet, deserialized.setNameExplicitlySet);
			assert.strictEqual(collectionURLPath(nextDeserialized), '/c/starred/');
		});

		it('produces proposal C’s URL spellings for a quick-composer edit', () => {
			//§3: type a tag, fuse an "or" onto it, flip a pill — and the URL
			//that falls out is `+` for the group and the inverse WORD for the
			//flip, with `exclude/` reserved for the group flip.
			const start = CollectionDescription.deserialize('main/');
			let expr = expression.collectionExpressionForDescription(start);
			assert.deepStrictEqual(expr, []);

			expr = expression.withConditionAppended(expr, {kind: 'filter', filter: 'tag-3'});
			assert.strictEqual(collectionURLPath(expression.collectionDescriptionWithExpression(start, expr)),
				'/c/tag-3/');

			expr = expression.withMemberAddedToOr(expr, 0, {kind: 'filter', filter: 'tag-7'});
			assert.strictEqual(collectionURLPath(expression.collectionDescriptionWithExpression(start, expr)),
				'/c/tag-3+tag-7/');

			expr = expression.withConditionAppended(expr, {kind: 'filter', filter: 'published'});
			expr = expression.withNegationToggled(expr, 1);
			assert.strictEqual(collectionURLPath(expression.collectionDescriptionWithExpression(start, expr)),
				'/c/tag-3+tag-7/unpublished/',
				'flipping a pill with a word for it must read as that word, never as exclude/');

			expr = expression.withNegationToggled(expr, 0);
			assert.deepStrictEqual(
				expression.collectionDescriptionWithExpression(start, expr).filters,
				['exclude/tag-3+tag-7', 'unpublished'],
				'flipping the GROUP is where exclude/ finally appears');

			//And the whole sentence reads back as the same tree it was built as.
			assert.deepStrictEqual(
				expression.collectionExpressionForDescription(expression.collectionDescriptionWithExpression(start, expr)),
				expr);
		});

		it('round-trips a description through the draft layer without changing what it selects', () => {
			for (const fixture of ROUND_TRIP_FIXTURES) {
				const description = new CollectionDescription('main', fixture.filters);
				const next = expression.collectionDescriptionWithExpression(
					description,
					expression.collectionExpressionForDescription(description)
				);
				assertEngineEquivalent(description.filters, next.filters, fixture.name);
			}
		});
	});
});

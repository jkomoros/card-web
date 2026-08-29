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
		({ CollectionDescription } = await import('../../lib/src/collection_description.js'));
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
});

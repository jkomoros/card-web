/*eslint-env node, es2022*/

import { JSDOM } from 'jsdom';
import assert from 'assert';

const dom = new JSDOM('');
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.Document = dom.window.Document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.customElements = dom.window.customElements;
globalThis.CSSStyleSheet = dom.window.CSSStyleSheet;

let buildCollectionFilterCatalog;
let CollectionDescription;
let CARD_FILTER_DESCRIPTIONS;
let INVERSE_FILTER_NAMES;
let REVERSE_CARD_FILTER_CONFIG_MAP;
let TODO_ALL_INFOS;

//The catalog builds its examples on the draft the user is actually composing,
//so every case here has to say which draft it is talking about.
const draft = (serialized = 'everything/') => CollectionDescription.deserialize(serialized);

describe('Collection filter catalog', () => {
	before(async () => {
		({ buildCollectionFilterCatalog } = await import('../../lib/src/collection-filter-catalog.js'));
		({ CollectionDescription } = await import('../../lib/src/collection_description.js'));
		({
			CARD_FILTER_DESCRIPTIONS,
			INVERSE_FILTER_NAMES,
			REVERSE_CARD_FILTER_CONFIG_MAP,
			TODO_ALL_INFOS,
		} = await import('../../lib/src/filters.js'));
	});

	const descriptions = {
		starred: 'Cards that you starred',
		updated: 'Cards updated in a date range',
		author: 'Cards by a contributor',
		query: 'Cards containing text',
		similar: 'Cards similar to a card',
		exclude: 'Cards outside another collection',
	};

	const candidates = [{
		filter: 'inductively-knowable',
		category: 'tag',
		label: 'Tagged “Inductively Knowable”',
		detail: 'Keeps cards with this tag',
		aliases: ['epistemology'],
	}, {
		filter: 'direct-connections/+card-1',
		category: 'relationship',
		label: 'Directly connected to this card',
		detail: 'Follows links in either direction',
		aliases: ['related'],
		spotlight: true,
	}];

	it('groups static, configurable, and live concrete filters by human concept', () => {
		const result = buildCollectionFilterCatalog(descriptions, candidates, draft());
		assert.strictEqual(result.find(item => item.filter === 'updated').category, 'Dates');
		assert.strictEqual(result.find(item => item.filter === 'author').category, 'People');
		assert.strictEqual(result.find(item => item.filter === 'query').category, 'Text and specific cards');
		assert.strictEqual(result.find(item => item.filter === 'similar').category, 'Similarity');
		assert.strictEqual(result.find(item => item.filter === 'inductively-knowable').category, 'Tags and sections');
		assert.strictEqual(result.find(item => item.filter.startsWith('direct-connections/')).category, 'Suggested for this card');
		assert.match(result.find(item => item.filter === 'updated').example, /Updated since 7 days ago/);
		assert.strictEqual(result.find(item => item.filter === 'updated').guided, true);
		assert.strictEqual(result.find(item => item.filter === 'exclude').guided, false);
		assert.match(result.find(item => item.filter === 'exclude').example, /NOT Working Notes/);
		assert.strictEqual(result.find(item => item.filter === 'inductively-knowable').example, 'Everything AND Tagged “Inductively Knowable”');
	});

	it('searches labels, descriptions, categories, and aliases', () => {
		assert.deepStrictEqual(buildCollectionFilterCatalog(descriptions, candidates, draft(), 'epistemology').map(item => item.filter), ['inductively-knowable']);
		assert.deepStrictEqual(buildCollectionFilterCatalog(descriptions, candidates, draft(), 'related').map(item => item.filter), ['direct-connections/+card-1']);
		assert.ok(buildCollectionFilterCatalog(descriptions, candidates, draft(), 'date').some(item => item.filter === 'updated'));
	});

	it('marks exact and configurable-family filters as already applied', () => {
		const result = buildCollectionFilterCatalog(descriptions, candidates, draft('everything/starred/updated/after/3-days-ago/direct-connections/+card-2/'));
		assert.strictEqual(result.find(item => item.filter === 'starred').appliedIndex, 0);
		assert.strictEqual(result.find(item => item.filter === 'updated').appliedIndex, 1);
		assert.strictEqual(result.find(item => item.filter === 'direct-connections/+card-1').appliedIndex, -1);
	});

	it('promotes applied and common filters within a category', () => {
		const result = buildCollectionFilterCatalog({
			alpha: 'Alpha',
			beta: 'Beta',
			content: 'Content',
			starred: 'Starred',
			unread: 'Unread',
		}, [], draft('everything/content/'));
		assert.deepStrictEqual(result.map(item => item.filter), ['content', 'unread', 'starred', 'alpha', 'beta']);
	});

	//The pairs are knowable from the filter machinery itself, so this asserts
	//against INVERSE_FILTER_NAMES rather than against a list of names that would
	//rot the moment a new card filter is defined.
	it('merges every x / not-x pair into a single row', () => {
		const result = buildCollectionFilterCatalog(CARD_FILTER_DESCRIPTIONS, [], draft());
		const shown = new Set(result.map(item => item.filter));
		const known = new Set(Object.keys(CARD_FILTER_DESCRIPTIONS));
		for (const [negated, positive] of Object.entries(INVERSE_FILTER_NAMES)) {
			if (!known.has(negated) || !known.has(positive)) continue;
			assert.ok(
				!(shown.has(negated) && shown.has(positive)),
				`${negated} and ${positive} are the same row, so only one may be listed`
			);
			const row = result.find(item => item.polarityKey === positive);
			assert.ok(row, `the ${positive} / ${negated} pair must still be reachable`);
			assert.strictEqual(
				new Set([row.filter, row.oppositeFilter]).size === 2 &&
          [row.filter, row.oppositeFilter].includes(negated) &&
          [row.filter, row.oppositeFilter].includes(positive),
				true,
				`the ${positive} row must carry ${negated} as its opposite`
			);
		}
		//156 alphabetized card properties was the dump the composer set out to
		//replace; merging the pairs is most of what makes it browsable.
		const cardProperties = result.filter(item => item.category === 'Card properties');
		assert.ok(cardProperties.length < 100, `Card properties is still a dump: ${cardProperties.length} entries`);
	});

	it('flips a merged row to the inverse filter, with copy that names no internal id', () => {
		const before = buildCollectionFilterCatalog(CARD_FILTER_DESCRIPTIONS, [], draft())
			.find(item => item.polarityKey === 'starred');
		assert.strictEqual(before.filter, 'starred');
		assert.strictEqual(before.negated, false);
		assert.strictEqual(before.oppositeFilter, 'unstarred');

		const after = buildCollectionFilterCatalog(CARD_FILTER_DESCRIPTIONS, [], draft(), '', { starred: 'unstarred' })
			.find(item => item.polarityKey === 'starred');
		assert.strictEqual(after.filter, 'unstarred');
		assert.strictEqual(after.negated, true);
		assert.strictEqual(after.oppositeFilter, 'starred');
		assert.strictEqual(after.label, 'Unstarred');
		//"Inverse of starred" is the synthesized description; a user must never see
		//a raw filter id (HS-1.4).
		assert.ok(!/Inverse of/.test(after.detail), `detail leaked an internal name: ${after.detail}`);
		assert.ok(!/\bstarred\b/.test(after.detail), `detail leaked a raw filter id: ${after.detail}`);
	});

	it('keeps both halves of a merged row findable by search', () => {
		const hits = buildCollectionFilterCatalog(CARD_FILTER_DESCRIPTIONS, [], draft(), 'unstarred');
		const row = hits.find(item => item.polarityKey === 'starred');
		assert.ok(row, 'searching for the excluding half must still find the row');
		//And it shows the half that was searched for, not its opposite.
		assert.strictEqual(row.filter, 'unstarred');
	});

	it('orders card properties by usefulness rather than alphabet', () => {
		const candidates = [{
			filter: 'zulu-property',
			category: 'other',
			label: 'Zulu property',
			detail: 'A property the suggestion system proposes',
		}];
		const result = buildCollectionFilterCatalog(
			{ 'alpha-property': 'Alpha', 'zulu-property': 'Zulu' },
			candidates,
			draft()
		).filter(item => item.category === 'Card properties');
		assert.deepStrictEqual(result.map(item => item.filter), ['zulu-property', 'alpha-property']);

		//And the corpus-grooming TODO family sorts below ordinary properties, which
		//alphabetical order buried the ordinary ones beneath.
		const real = buildCollectionFilterCatalog(CARD_FILTER_DESCRIPTIONS, [], draft())
			.filter(item => item.category === 'Card properties');
		const isTodoMachinery = (filter) => Boolean(TODO_ALL_INFOS[REVERSE_CARD_FILTER_CONFIG_MAP[filter]]);
		const firstTodo = real.findIndex(item => isTodoMachinery(item.filter));
		const lastOrdinary = real.map(item => isTodoMachinery(item.filter)).lastIndexOf(false);
		assert.ok(firstTodo > 0, 'there should be ordinary card properties before the TODO family');
		assert.ok(firstTodo > lastOrdinary, 'no TODO-machinery filter may precede an ordinary card property');
	});
});

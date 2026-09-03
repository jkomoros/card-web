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
let CONFIGURABLE_FILTER_INFO;

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
			CONFIGURABLE_FILTER_INFO,
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
		//'related' is now a CURATED word for the similarity family as well as an
		//alias of the connection candidate (collection-filter-synonyms), and both
		//answers are honest: "related cards" is what a person calls each of them.
		//What matters is the ORDER — the row anchored to the card on screen still
		//leads, because it is about where the user actually is.
		assert.deepStrictEqual(buildCollectionFilterCatalog(descriptions, candidates, draft(), 'related').map(item => item.filter), ['direct-connections/+card-1', 'similar']);
		assert.ok(buildCollectionFilterCatalog(descriptions, candidates, draft(), 'date').some(item => item.filter === 'updated'));
	});

	it('marks exact and configurable-family filters as already applied', () => {
		const result = buildCollectionFilterCatalog(descriptions, candidates, draft('everything/starred/updated/after/3-days-ago/direct-connections/+card-2/'));
		assert.strictEqual(result.find(item => item.filter === 'starred').appliedIndex, 0);
		assert.strictEqual(result.find(item => item.filter === 'updated').appliedIndex, 1);
		assert.strictEqual(result.find(item => item.filter === 'direct-connections/+card-1').appliedIndex, -1);
	});

	//AN EXAMPLE OF AN APPLIED FILTER IS THE DRAFT.
	//
	//exampleFor() composed "<draft> AND <this filter>" unconditionally, so a row
	//already in the draft showed the clause twice — "Everything AND Starred AND
	//Starred" — directly above its own "Already in this collection" badge, which
	//says the opposite. The draft already contains the filter, so the honest
	//example of choosing that row is the draft exactly as it stands.
	it('shows an applied filter’s example as the draft itself, not the draft plus a duplicate', () => {
		const result = buildCollectionFilterCatalog(descriptions, candidates, draft('everything/starred/'));
		const applied = result.find(item => item.filter === 'starred');
		assert.strictEqual(applied.appliedIndex, 0);
		assert.strictEqual(applied.example, 'Everything AND Starred');
		//An UNapplied row still previews what choosing it would produce.
		assert.strictEqual(result.find(item => item.filter === 'inductively-knowable').example,
			'Everything AND Starred AND Tagged “Inductively Knowable”');
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

	//A FILTER'S DESCRIPTION IS THE ONLY THING MOST USERS EVER READ ABOUT IT.
	//
	//`references-outbound` carried a VERBATIM copy of the sentence
	//`direct-references-inbound` carries — so the catalog offered the outbound
	//half of the pair under a description of the inbound half — and
	//`references-inbound` said the opposite of what it does, in a voice ('cards
	//that is referenced') that had never been read aloud. Both are user-facing
	//claims about a DIRECTION, which is exactly the kind of claim that cannot be
	//checked by reading it.
	//
	//So it is checked against the ENGINE rather than against another sentence: a
	//two-card corpus where A references B, each filter actually run from key
	//card A, and the description required to agree with what came back.
	describe('reference filters describe the direction they actually walk', () => {
		const card = (id) => ({
			id,
			references_info: {},
			references: {},
			references_info_inbound: {},
			references_inbound: {},
		});

		//A --link--> B, spelled on both sides the way card processing writes it.
		const corpus = () => {
			const a = card('a');
			const b = card('b');
			a.references_info = { b: { link: '' } };
			a.references = { b: true };
			b.references_info_inbound = { a: { link: '' } };
			b.references_inbound = { a: true };
			return { a, b };
		};

		const matchesFromKeyCardA = (filterName) => {
			const cards = corpus();
			const [func] = CONFIGURABLE_FILTER_INFO[filterName].factory(filterName, 'a', 'link', '2');
			return Object.values(cards)
				.filter((item) => func(item, { cards, keyCardID: 'a', editingCard: null }).matches)
				.map((item) => item.id);
		};

		for (const filterName of ['references-inbound', 'references-outbound', 'direct-references-inbound', 'direct-references-outbound']) {
			it(`${filterName} says which way it goes`, () => {
				const matched = matchesFromKeyCardA(filterName);
				const description = CONFIGURABLE_FILTER_INFO[filterName].description;
				assert.ok(description, `${filterName} must have a description`);
				//Downstream: the key card references B, so an outbound filter
				//returns B. Upstream: nothing references the key card in this
				//corpus, so an inbound filter returns nothing.
				const downstream = matched.includes('b');
				assert.deepStrictEqual(matched, downstream ? ['b'] : [],
					`${filterName} must match one direction or the other, not both`);
				//The sentence has to name the same direction. 'what it
				//references' against 'what references it' is precisely the
				//distinction the old copy had backwards, so it is the
				//distinction asserted — in whichever voice each sentence uses.
				//('other cards' is how the direct pair names the key card. It
				//is vague, not wrong, and the direction it states is right.)
				const otherCard = '(the key card|the given card|a given card|other cards)';
				const saysOutbound = new RegExp(`what it references|referenced by ${otherCard}`).test(description);
				const saysInbound = new RegExp(`what references it|references? ${otherCard}`).test(description);
				if (downstream) {
					assert.ok(saysOutbound && !saysInbound,
						`${filterName} walks the key card's OWN references, so its description must say so: "${description}"`);
				} else {
					assert.ok(saysInbound && !saysOutbound,
						`${filterName} walks the references pointing AT the key card, so its description must say so: "${description}"`);
				}
			});
		}

		//And no two of them may say the same thing, which is the shape the
		//original defect took: a correct sentence, copied onto the wrong filter.
		it('gives every configurable filter its own description', () => {
			const seen = new Map();
			for (const [name, info] of Object.entries(CONFIGURABLE_FILTER_INFO)) {
				if (!info.description) continue;
				const previous = seen.get(info.description);
				assert.strictEqual(previous, undefined,
					`${name} and ${previous} share one description: "${info.description}"`);
				seen.set(info.description, name);
			}
		});
	});
});

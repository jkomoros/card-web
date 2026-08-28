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
globalThis.BroadcastChannel = class {
	addEventListener() {}
	removeEventListener() {}
	postMessage() {}
	close() {}
};

let CollectionDescription;
let collectionComposerSuggestions;
let rankedComposerSuggestions;
let collectionDescriptionFromComposerSource;
let readableCollectionExpression;
let collectionExpressionParts;
let collectionFilterDisplayName;
let collectionFilterLabels;
let collectionDraftReceipt;
let selectCollectionComposerCandidates;
let activeCardRelationshipCandidates;
let activeCardMetadataCandidates;
let makeConfigurableFilter;
let configurableFilterCacheKey;

const descriptions = {
	starred: 'Cards you have starred',
	updated: 'Cards updated in a date range',
	exclude: 'Cards outside another collection',
	'working-notes': 'Working notes cards',
};

describe('Collection Composer suggestions', () => {
	before(async () => {
		({ CollectionDescription } = await import(
			'../../lib/src/collection_description.js'
		));
		({
			collectionComposerSuggestions,
			rankedComposerSuggestions,
			collectionDescriptionFromComposerSource,
			readableCollectionExpression,
			collectionExpressionParts,
			collectionFilterDisplayName,
			collectionFilterLabels,
			collectionDraftReceipt,
			activeCardRelationshipCandidates,
			activeCardMetadataCandidates,
		} = await import('../../lib/src/collection-composer-suggestions.js'));
		({ selectCollectionComposerCandidates } = await import('../../lib/src/selectors.js'));
		({ makeConfigurableFilter, configurableFilterCacheKey } = await import('../../lib/src/filters.js'));
	});

	it('starts from the current collection with deterministic transformations', () => {
		const current = CollectionDescription.deserialize(
			'everything/working-notes/'
		);
		const suggestions = collectionComposerSuggestions(
			current,
			'',
			descriptions
		);
		assert.strictEqual(suggestions[0].label, 'Remove Working Notes');
		assert.strictEqual(suggestions[0].action, 'remove');
		assert.strictEqual(suggestions[0].description.serialize(), 'everything/');
		assert.ok(suggestions.some((item) => item.label === 'Add Starred'));
		assert.ok(
			suggestions.some((item) => item.label === 'Reverse the current sort')
		);
	});

	it('uses contributor labels instead of durable IDs in removal suggestions', () => {
		const candidate = {
			filter: 'author/visibleperson',
			category: 'author',
			label: 'Cards Casey authored or collaborated on',
			detail: '',
			clauseLabel: 'Contributed By Casey',
		};
		const suggestions = collectionComposerSuggestions(
			CollectionDescription.deserialize('everything/author/visibleperson/'),
			'',
			descriptions,
			{ candidates: [candidate] }
		);
		assert.strictEqual(suggestions[0].label, 'Remove Contributed By Casey');
		assert.match(suggestions[0].detail, /Contributed By Casey/);
		assert.doesNotMatch(`${suggestions[0].label} ${suggestions[0].detail}`, /visibleperson/);
	});

	it('turns an existing card selection into an explicit filter', () => {
		const current = CollectionDescription.deserialize('everything/');
		const suggestions = collectionComposerSuggestions(
			current,
			'',
			descriptions,
			{ cardsSelected: true }
		);
		const selected = suggestions.find(
			(item) => item.label === 'Add Selected Cards'
		);
		assert.ok(selected);
		assert.deepStrictEqual(selected.description.filters, ['selected']);
		assert.match(selected.detail, /ordinary Selected Cards filter/);
	});

	it('describes recent destinations as explicit differences', () => {
		const current = CollectionDescription.deserialize(
			'everything/working-notes/'
		);
		const recent = CollectionDescription.deserialize(
			'main/starred/sort/recent/'
		);
		const suggestions = collectionComposerSuggestions(
			current,
			'',
			descriptions,
			{ recentCollections: [{ description: recent, visits: 3 }] }
		);
		//A recent is named by what it is. "Back to" is a claim about direction,
		//and it is spent only on the collection history can prove you came from.
		assert.strictEqual(
			suggestions[0].label,
			'Open Main AND Starred · sorted by Recent'
		);
		assert.strictEqual(suggestions[0].action, 'open');
		assert.match(suggestions[0].detail, /Uses Main instead of Everything/);
		assert.match(suggestions[0].detail, /Removes Working Notes/);
		assert.match(suggestions[0].detail, /Adds Starred/);
		assert.match(suggestions[0].detail, /Visited 3 times/);
	});

	//Recents are destinations, and the collection you are already standing in is
	//not one: "Back to <the thing on screen>" navigates nowhere and throws the
	//draft away. Deduping against the draft alone stopped covering this the
	//moment the draft diverged — the state every user is in after their first
	//Tab.
	it('never offers the active collection as a recent destination', () => {
		const active = CollectionDescription.deserialize('main/');
		const draft = CollectionDescription.deserialize('main/starred/');
		const other = CollectionDescription.deserialize('main/unread/');
		const context = {
			activeCollection: active,
			recentCollections: [
				{ description: active, visits: 9 },
				{ description: draft, visits: 4 },
				{ description: other, visits: 2 },
			],
		};
		const recents = collectionComposerSuggestions(draft, '', descriptions, context)
			.filter((suggestion) => suggestion.kind === 'recent');
		assert.deepStrictEqual(
			recents.map((suggestion) => suggestion.description.serialize()),
			[other.serialize()],
			'both the active collection and the draft itself are suppressed'
		);
		//And with no divergence yet, the same suppression holds.
		const atRest = collectionComposerSuggestions(active, '', descriptions, context)
			.filter((suggestion) => suggestion.kind === 'recent');
		assert.ok(!atRest.some((suggestion) => suggestion.description.serialize() === active.serialize()));
	});

	it('offers four Continue rows, so a rotation plus a frequent hub still fits', () => {
		const active = CollectionDescription.deserialize('main/');
		const named = (name) => CollectionDescription.deserialize(`main/${name}/`);
		//Three legs of a rotation, plus the frequency-promoted hub the history
		//module hoists in beside them. At three rows the last leg was dropped.
		//None of these are EMPTY_STATE_FILTERS, which would otherwise dedupe
		//against the refine rows offering the same destination.
		const context = {
			activeCollection: active,
			recentCollections: [
				{ description: named('half-baked'), visits: 2 },
				{ description: named('content'), visits: 2 },
				{ description: named('has-todo'), visits: 2 },
				{ description: named('published'), visits: 9 },
				{ description: named('has-links'), visits: 1 },
			],
		};
		const recents = collectionComposerSuggestions(active, '', descriptions, context)
			.filter((suggestion) => suggestion.kind === 'recent');
		assert.deepStrictEqual(
			recents.map((suggestion) => suggestion.description.serialize()),
			[
				named('half-baked').serialize(),
				named('content').serialize(),
				named('has-todo').serialize(),
				named('published').serialize(),
			],
			'all three rotation legs survive alongside the fourth row'
		);
	});

	it('explains promoted rolling-date memories mechanistically', () => {
		const suggestions = collectionComposerSuggestions(
			CollectionDescription.deserialize('everything/'),
			'',
			descriptions,
			{
				recentCollections: [{
					description: CollectionDescription.deserialize('everything/created/after/3-days-ago/'),
					visits: 3,
					frequent: true,
					relative: true,
				}],
			}
		);
		assert.match(suggestions[0].label, /^Open /);
		assert.match(suggestions[0].detail, /rolling date window/);
		assert.match(suggestions[0].detail, /Visited 3 times/);
	});

	//Two rows that land on the identical collection are not two choices, and a
	//row that rebuilds the collection you are already in is not a choice at all.
	//The audit found four of six default rows were two such pairs.
	it('offers each destination once, and never one that changes nothing', () => {
		const active = CollectionDescription.deserialize('main/');
		const suggestions = collectionComposerSuggestions(active, '', descriptions, {
			activeCollection: active,
			recentCollections: [
				//Exactly what "Add Unread" already rebuilds.
				{ description: CollectionDescription.deserialize('main/unread/'), visits: 4 },
				//Same filters, different sort: a genuinely different collection.
				{ description: CollectionDescription.deserialize('main/starred/sort/recent/'), visits: 2 },
			],
		});
		const destinations = suggestions.map((suggestion) => suggestion.description.serialize());
		assert.strictEqual(
			new Set(destinations).size,
			destinations.length,
			'no two rows resolve to the same collection'
		);
		assert.ok(!destinations.includes(active.serialize()),
			'no row rebuilds the collection the draft already describes');
		assert.ok(!suggestions.some((suggestion) => suggestion.kind === 'recent' &&
      suggestion.description.serialize() === 'main/unread/'),
		'the recent loses the tie to the refinement that teaches the transformation');
		assert.ok(suggestions.some((suggestion) => suggestion.label === 'Add Unread'),
			'and the refinement is the row that survives');
		assert.ok(suggestions.some((suggestion) => suggestion.kind === 'recent' &&
      suggestion.description.serialize() === 'main/starred/sort/recent/'),
		'a recent that differs by sort is a real destination and stays');
	});

	//The typed path can build an exact no-op too: re-typing the text you have
	//already searched for produces the collection you are already composing.
	it('does not offer a typed interpretation that would change nothing', () => {
		const current = CollectionDescription.deserialize('everything/query/work/');
		const suggestions = collectionComposerSuggestions(current, 'work', descriptions);
		assert.ok(!suggestions.some((suggestion) =>
			suggestion.description.serialize() === current.serialize()));
		assert.ok(!suggestions.some((suggestion) => suggestion.kind === 'search'));
	});

	//Counts can only rank when they exist, and only when the list was rebuilt.
	it('sinks rows that yield nothing below rows that yield something', () => {
		const current = CollectionDescription.deserialize('main/');
		const suggestions = collectionComposerSuggestions(current, '', descriptions);
		const starred = suggestions.findIndex((suggestion) => suggestion.id === 'add:starred');
		const unread = suggestions.findIndex((suggestion) => suggestion.id === 'add:unread');
		assert.ok(starred >= 0 && unread >= 0 && starred < unread);
		const ranked = rankedComposerSuggestions(suggestions, { 'add:starred': 0, 'add:unread': 5 });
		assert.notStrictEqual(ranked[0].id, 'add:starred');
		assert.ok(ranked.findIndex((suggestion) => suggestion.id === 'add:unread') <
      ranked.findIndex((suggestion) => suggestion.id === 'add:starred'));
		//A count that has not arrived is not evidence of emptiness.
		assert.deepStrictEqual(
			rankedComposerSuggestions(suggestions, {}).map((suggestion) => suggestion.id),
			suggestions.map((suggestion) => suggestion.id)
		);
		//Sections stay put: a recent with no cards does not fall in among the
		//refinements.
		const withRecent = collectionComposerSuggestions(current, '', descriptions, {
			recentCollections: [{ description: CollectionDescription.deserialize('everything/sort/recent/'), visits: 2 }],
		});
		const rankedWithRecent = rankedComposerSuggestions(withRecent, {
			[withRecent[0].id]: 0,
			'add:starred': 9,
		});
		assert.strictEqual(rankedWithRecent[0].kind, 'recent');
	});

	//A clause has one name. These are the three places the same clause shows up
	//while it is being composed, plus the receipt that follows.
	it('uses one name for a clause in the row, the chip, the broaden row, and the receipt', () => {
		const candidates = [{
			filter: 'inductively-knowable',
			category: 'tag',
			label: 'Tagged “Inductively Knowable”',
			detail: 'Keeps cards tagged Inductively Knowable',
			aliases: ['inductively knowable', 'tag'],
			clauseLabel: 'Tagged Inductively Knowable',
		}];
		const labels = collectionFilterLabels(candidates);
		const cases = [
			{ filter: 'starred', name: 'Starred', typed: 'starred' },
			{ filter: 'inductively-knowable', name: 'Tagged Inductively Knowable', typed: 'inductively' },
			//A configurable filter carrying a value nobody hardcoded. Its name has to
			//be derived from its own URL parts, or editing 7 into 14 degrades
			//"Updated since 7 days ago" into "Updated After · 14 Days Ago".
			{ filter: 'updated/after/14-days-ago', name: 'Updated since 14 days ago' },
			{ filter: 'created/between/3-days-ago/yesterday', name: 'Created between 3 days ago and yesterday' },
		];
		for (const { filter, name, typed } of cases) {
			assert.strictEqual(collectionFilterDisplayName(filter, labels), name, filter);
			const applied = CollectionDescription.deserialize(`everything/${filter}/`);
			assert.strictEqual(collectionExpressionParts(applied, labels).filters[0].label, name, `chip: ${filter}`);
			const broaden = collectionComposerSuggestions(applied, '', descriptions, { candidates })
				.find((suggestion) => suggestion.action === 'remove');
			assert.strictEqual(broaden.label, `Remove ${name}`, `broaden row: ${filter}`);
			assert.strictEqual(broaden.name, name, `broaden name: ${filter}`);
			assert.strictEqual(
				collectionDraftReceipt(applied, CollectionDescription.deserialize('everything/'), labels),
				`Removed ${name}`,
				`receipt: ${filter}`
			);
			if (!typed) continue;
			const add = collectionComposerSuggestions(
				CollectionDescription.deserialize('everything/'),
				typed,
				descriptions,
				{ candidates }
			).find((suggestion) => suggestion.description.filters.includes(filter));
			assert.strictEqual(add.label, `Add ${name}`, `add row: ${filter}`);
		}
	});

	//Receipts are sentences composed from the canonical name, not the row label
	//with its verb glued on a second time.
	it('composes receipts as sentences rather than restating the row', () => {
		const base = CollectionDescription.deserialize('main/');
		assert.strictEqual(
			collectionDraftReceipt(base, CollectionDescription.deserialize('main/starred/')),
			'Added Starred'
		);
		assert.strictEqual(
			collectionDraftReceipt(
				CollectionDescription.deserialize('main/updated/after/7-days-ago/'),
				CollectionDescription.deserialize('main/updated/after/14-days-ago/')
			),
			'Changed Updated since 7 days ago to Updated since 14 days ago'
		);
		assert.strictEqual(
			collectionDraftReceipt(base, CollectionDescription.deserialize('everything/')),
			'Changed the starting set to Everything'
		);
		assert.strictEqual(
			collectionDraftReceipt(base, CollectionDescription.deserialize('main/sort/recent/')),
			'Changed the order to Recent'
		);
		assert.strictEqual(
			collectionDraftReceipt(base, CollectionDescription.deserialize('main/starred/unread/working-notes/')),
			'Added Starred, Unread and 1 more'
		);
	});

	it('shows ambiguous text as explicit interpretations', () => {
		const current = CollectionDescription.deserialize('everything/');
		const suggestions = collectionComposerSuggestions(
			current,
			'work',
			descriptions
		);
		assert.strictEqual(suggestions[0].label, 'Add Working Notes');
		assert.strictEqual(suggestions.at(-1).label, 'Add Text contains “work”');
		assert.notStrictEqual(
			suggestions[0].description.serialize(),
			suggestions.at(-1).description.serialize()
		);
	});

	it('ranks name matches ahead of incidental description matches', () => {
		const current = CollectionDescription.deserialize('everything/');
		const suggestions = collectionComposerSuggestions(current, 'working', {
			'mined-for-content': 'Cards with working source material',
			'working-notes': 'Working notes cards',
		});
		assert.strictEqual(suggestions[0].label, 'Add Working Notes');
	});

	it('discovers concrete values with deterministic, inspectable filters', () => {
		const current = CollectionDescription.deserialize('everything/');
		const candidates = [
			{
				filter: 'inductively-knowable',
				category: 'tag',
				label: 'Tagged “Inductively Knowable”',
				detail: 'Keeps cards tagged Inductively Knowable',
				aliases: ['inductively knowable', 'tag'],
			},
			{
				filter: 'half-baked',
				category: 'section',
				label: 'In section “Half Baked”',
				detail: 'Keeps cards in the Half Baked section',
				aliases: ['half baked', 'section'],
			},
		];
		const suggestions = collectionComposerSuggestions(
			current,
			'tag inductively',
			{ 'inductively-knowable': 'Matches cards in the Inductively Knowable tag' },
			{ candidates }
		);
		assert.strictEqual(suggestions[0].label, 'Add Tagged “Inductively Knowable”');
		assert.deepStrictEqual(suggestions[0].description.filters, ['inductively-knowable']);
		//The URL note names the clause the way every other surface names it, and
		//never by its URL spelling (HS-1.4). The raw key must not appear at all.
		assert.match(suggestions[0].detail, /Adds Tagged “Inductively Knowable” to the collection URL/);
		assert.ok(!suggestions[0].detail.includes('inductively-knowable'),
			'a filter\'s URL spelling is an internal identifier, not a name');
		assert.strictEqual(suggestions.at(-1).label, 'Add Text contains “tag inductively”');
	});

	it('ranks exact built-ins over weaker concrete matches', () => {
		const current = CollectionDescription.deserialize('everything/');
		const suggestions = collectionComposerSuggestions(current, 'starred', descriptions, {
			candidates: [{
				filter: 'starred-ideas',
				category: 'tag',
				label: 'Tagged “Starred Ideas”',
				detail: 'Keeps cards tagged Starred Ideas',
			}],
		});
		assert.strictEqual(suggestions[0].label, 'Add Starred');
	});

	it('suppresses ambiguous and reserved section or tag IDs', () => {
		const candidates = selectCollectionComposerCandidates({
			data: {
				sections: {
					shared: { title: 'Shared section' },
					starred: { title: 'Misleading section' },
					safe: { title: 'Safe section' },
				},
				tags: {
					shared: { title: 'Shared tag' },
					unread: { title: 'Misleading tag' },
					useful: { title: 'Useful tag' },
				},
				cards: {},
				authors: {},
			},
		});
		assert.ok(!candidates.some(candidate => ['shared', 'starred', 'unread'].includes(candidate.filter)));
		assert.ok(candidates.some(candidate => candidate.filter === 'safe' && candidate.category === 'section'));
		assert.ok(candidates.some(candidate => candidate.filter === 'useful' && candidate.category === 'tag'));
		assert.strictEqual(candidates.find(candidate => candidate.filter === 'working-notes').label, 'Card type: Working Notes');
	});

	it('discovers only visible contributors with durable, honestly labeled clauses', () => {
		const candidates = selectCollectionComposerCandidates({
			data: {
				sections: {},
				tags: {},
				cards: {
					one: { author: 'CurrentUser', collaborators: ['VisiblePerson'] },
				},
				authors: {
					CurrentUser: { displayName: 'Jordan' },
					VisiblePerson: { displayName: 'Casey' },
					HiddenPerson: { displayName: 'Hidden' },
				},
			},
			user: { user: { uid: 'CurrentUser' } },
		});
		const mine = candidates.find(candidate => candidate.label === 'My cards');
		const casey = candidates.find(candidate => candidate.label.includes('Casey'));
		assert.strictEqual(mine.filter, 'author/currentuser');
		assert.strictEqual(casey.filter, 'author/visibleperson');
		assert.match(casey.label, /authored or collaborated on/);
		assert.ok(!candidates.some(candidate => candidate.label.includes('Hidden')));
		assert.ok(!casey.searchValues.some(value => value.includes('visibleperson')));

		const suggestions = collectionComposerSuggestions(
			CollectionDescription.deserialize('everything/'),
			'casey',
			{ author: 'Selects cards by contributor' },
			{ candidates }
		);
		assert.strictEqual(suggestions[0].label, 'Add Contributed By Casey');
		assert.deepStrictEqual(suggestions[0].description.filters, ['author/visibleperson']);
		assert.doesNotMatch(suggestions[0].detail, /visibleperson/i);
		const [contributorFilter] = makeConfigurableFilter('author/visibleperson');
		assert.strictEqual(contributorFilter({ author: 'Other', collaborators: ['VisiblePerson'] }, {}).matches, true);
		assert.strictEqual(
			readableCollectionExpression(suggestions[0].description, {
				'author/visibleperson': 'Cards Casey authored or collaborated on',
			}),
			'Everything AND Cards Casey authored or collaborated on'
		);

		const duplicateNames = selectCollectionComposerCandidates({
			data: {
				sections: {}, tags: {},
				cards: { one: { author: 'First', collaborators: ['Second'] } },
				authors: { First: { displayName: 'Casey' }, Second: { displayName: 'Casey' } },
			},
			user: { user: { uid: 'SomeoneElse' } },
		}).filter(candidate => candidate.category === 'author');
		assert.strictEqual(new Set(duplicateNames.map(candidate => candidate.label)).size, 2);
		assert.ok(duplicateNames.every(candidate => !/First|Second/.test(candidate.label)));
	});

	it('caps and deduplicates concrete values while retaining text search', () => {
		const current = CollectionDescription.deserialize('everything/tag-0/');
		const candidates = Array.from({ length: 9 }, (_, index) => ({
			filter: `tag-${index}`,
			category: 'tag',
			label: `Tagged “Tag ${index}”`,
			detail: `Keeps cards tagged Tag ${index}`,
			aliases: ['tag'],
		}));
		const suggestions = collectionComposerSuggestions(current, 'tag', {}, { candidates });
		assert.strictEqual(suggestions.filter(item => item.kind === 'add').length, 6);
		assert.ok(!suggestions.some(item => item.description.filters.filter(filter => filter === 'tag-0').length > 1));
		assert.strictEqual(suggestions.at(-1).kind, 'search');
	});

	it('offers explicit active-card relationship clauses only with context', () => {
		assert.deepStrictEqual(activeCardRelationshipCandidates(''), []);
		const candidates = activeCardRelationshipCandidates('card-123');
		const suggestions = collectionComposerSuggestions(
			CollectionDescription.deserialize('everything/'),
			'links from this card',
			descriptions,
			{ candidates }
		);
		assert.strictEqual(suggestions[0].label, 'Add This card and cards it links to');
		assert.deepStrictEqual(suggestions[0].description.filters, ['children/+card-123']);
		assert.match(suggestions[0].detail, /copied links keep this anchor/);
		assert.doesNotMatch(suggestions[0].description.serialize(), /key-card-id/);
		assert.strictEqual(suggestions.at(-1).kind, 'search');
		assert.strictEqual(
			readableCollectionExpression(suggestions[0].description),
			'Everything AND This card and cards it links to'
		);
		const byFamilyName = collectionComposerSuggestions(
			CollectionDescription.deserialize('everything/'),
			'children',
			descriptions,
			{ candidates }
		);
		assert.strictEqual(byFamilyName[0].label, 'Add This card and cards it links to');

		const withoutTyping = collectionComposerSuggestions(
			CollectionDescription.deserialize('everything/'),
			'',
			descriptions,
			{ candidates }
		);
		assert.deepStrictEqual(withoutTyping.slice(0, 1).map(suggestion => suggestion.label), [
			'Add This card and directly connected cards',
		]);
		const withRecent = collectionComposerSuggestions(
			CollectionDescription.deserialize('everything/'),
			'',
			descriptions,
			{
				candidates,
				recentCollections: [{
					description: CollectionDescription.deserialize('everything/starred/'),
					visits: 1,
				}],
			}
		);
		assert.ok(!withRecent.some(suggestion => suggestion.kind === 'add' && suggestion.label.includes('This card')));
		assert.ok(withRecent.some(suggestion => suggestion.label === 'Add Unread'));
	});

	it('turns visible active-card metadata into explicit contextual clauses', () => {
		const base = [
			{ filter: 'inductively-knowable', category: 'tag', label: 'Tagged', detail: '', valueLabel: 'Inductively Knowable', clauseLabel: 'Tagged Inductively Knowable' },
			{ filter: 'systems', category: 'tag', label: 'Tagged', detail: '', valueLabel: 'Systems', clauseLabel: 'Tagged Systems' },
			{ filter: 'half-baked', category: 'section', label: 'Section', detail: '', valueLabel: 'Half Baked', clauseLabel: 'Section Half Baked' },
			{ filter: 'working-notes', category: 'card type', label: 'Type', detail: '', valueLabel: 'Working Notes', clauseLabel: 'Card Type Working Notes' },
			{ filter: 'author/person', category: 'author', label: 'Cards Casey authored or collaborated on', detail: '', valueLabel: 'Casey', clauseLabel: 'Contributed By Casey' },
			{ filter: 'author/collaborator', category: 'author', label: 'Cards Alex authored or collaborated on', detail: '', valueLabel: 'Alex', clauseLabel: 'Contributed By Alex' },
		];
		const contextual = activeCardMetadataCandidates({
			section: 'half-baked',
			tags: ['missing-tag', 'systems', 'inductively-knowable'],
			cardType: 'working-notes',
			contributors: ['Person', 'Collaborator', 'Person'],
		}, base);
		assert.deepStrictEqual(contextual.map(candidate => candidate.filter), [
			'inductively-knowable',
			'systems',
			'half-baked',
			'working-notes',
			'author/person',
			'author/collaborator',
		]);
		assert.deepStrictEqual(contextual.filter(candidate => candidate.spotlight).map(candidate => candidate.filter), [
			'inductively-knowable',
			'half-baked',
		]);
		assert.match(contextual[0].detail, /open card has this tag/i);
		assert.match(contextual[0].urlDetail, /copied links keep this value/i);
		assert.strictEqual(
			readableCollectionExpression(
				CollectionDescription.deserialize('everything/inductively-knowable/'),
				Object.fromEntries(contextual.map(candidate => [candidate.filter, candidate.clauseLabel]))
			),
			'Everything AND Tagged Inductively Knowable'
		);

		const combined = [...contextual, ...activeCardRelationshipCandidates('card-123')];
		const withoutTyping = collectionComposerSuggestions(
			CollectionDescription.deserialize('everything/'), '', descriptions, { candidates: combined }
		);
		assert.deepStrictEqual(withoutTyping.slice(0, 3).map(suggestion => suggestion.label), [
			'Add Tagged Inductively Knowable',
			'Add Section Half Baked',
			'Add This card and directly connected cards',
		]);
	});

	it('executes durable relative-date candidates with their stated meaning', () => {
		const [filter] = makeConfigurableFilter('updated/after/7-days-ago');
		const timestamp = (date) => ({ toMillis: () => date.getTime() });
		const recent = new Date();
		const old = new Date();
		old.setDate(old.getDate() - 8);
		assert.strictEqual(filter({ updated_substantive: timestamp(recent) }).matches, true);
		assert.strictEqual(filter({ updated_substantive: timestamp(old) }).matches, false);

		const candidates = selectCollectionComposerCandidates({ data: { sections: {}, tags: {}, cards: {}, authors: {} } });
		const suggestions = collectionComposerSuggestions(
			CollectionDescription.deserialize('everything/'),
			'last 7 days',
			descriptions,
			{ candidates }
		);
		assert.strictEqual(suggestions[0].label, 'Add Updated since 7 days ago');
		assert.deepStrictEqual(suggestions[0].description.filters, ['updated/after/7-days-ago']);

		const beforeMidnight = new Date(2026, 6, 17, 23, 59);
		const afterMidnight = new Date(2026, 6, 18, 0, 1);
		assert.notStrictEqual(
			configurableFilterCacheKey('updated/after/today', beforeMidnight),
			configurableFilterCacheKey('updated/after/today', afterMidnight)
		);
		assert.strictEqual(
			configurableFilterCacheKey('updated/after/2026-7-17', beforeMidnight),
			configurableFilterCacheKey('updated/after/2026-7-17', afterMidnight)
		);
	});

	it('marks configurable families for guided editing before commitment', () => {
		const current = CollectionDescription.deserialize('everything/');
		const [suggestion] = collectionComposerSuggestions(
			current,
			'updated',
			descriptions
		);
		assert.match(suggestion.description.filters[0], /^updated\//);
		assert.strictEqual(suggestion.configureFilter, 'updated');
		assert.strictEqual(suggestion.label, 'Configure Updated');
		assert.match(suggestion.detail, /choose its values before changing the draft/);
	});

	it('routes nested collection expressions to lossless Source editing', () => {
		const current = CollectionDescription.deserialize('everything/');
		const [suggestion] = collectionComposerSuggestions(
			current,
			'exclude',
			descriptions
		);
		assert.strictEqual(suggestion.sourceFilter, 'exclude');
		assert.strictEqual(suggestion.configureFilter, undefined);
		assert.strictEqual(suggestion.label, 'Edit Exclude in Source');
		assert.match(suggestion.detail, /completions/);
	});

	it('accepts fragments, routes, and full URLs as collection source', () => {
		assert.strictEqual(
			collectionDescriptionFromComposerSource('starred').serialize(),
			'main/starred/'
		);
		assert.strictEqual(
			collectionDescriptionFromComposerSource(
				'/c/everything/working-notes/_'
			).serialize(),
			'everything/working-notes/'
		);
		assert.strictEqual(
			collectionDescriptionFromComposerSource(
				'https://example.com/c/everything/starred/_?ignored'
			).serialize(),
			'everything/starred/'
		);
	});

	it('returns null for invalid source instead of throwing', () => {
		assert.strictEqual(
			collectionDescriptionFromComposerSource('view/grid/'),
			null
		);
	});

	it('keeps text search available when slash-containing source is invalid', () => {
		const current = CollectionDescription.deserialize('everything/');
		const suggestions = collectionComposerSuggestions(current, 'view/grid/', descriptions);
		assert.ok(suggestions.some((suggestion) => suggestion.label === 'Add Text contains “view/grid/”'));
	});

	it('keeps text search available beside a valid slash source', () => {
		const current = CollectionDescription.deserialize('everything/');
		const suggestions = collectionComposerSuggestions(current, 'starred/unread/', descriptions);
		assert.strictEqual(suggestions[0].action, 'open');
		assert.ok(suggestions.some((suggestion) => suggestion.label === 'Add Text contains “starred/unread/”'));
	});

	it('does not offer to append an already applied filter', () => {
		const current = CollectionDescription.deserialize('everything/starred/');
		const suggestions = collectionComposerSuggestions(current, 'starred', descriptions);
		assert.ok(!suggestions.some((suggestion) => suggestion.label === 'Add Starred'));
	});

	it('renders a compact readable expression', () => {
		const description = CollectionDescription.deserialize(
			'everything/starred/working-notes/sort/reverse/updated/'
		);
		assert.strictEqual(
			readableCollectionExpression(description),
			'Everything AND Starred AND Working Notes · sorted by reverse Updated'
		);
		const query = CollectionDescription.deserialize(
			'everything/query/inductively+knowable/'
		);
		assert.strictEqual(
			readableCollectionExpression(query),
			'Everything AND Text contains “inductively knowable”'
		);
		const web = CollectionDescription.deserialize('everything/view/web/graph/');
		assert.strictEqual(
			readableCollectionExpression(web),
			'Everything · viewed as Web (Graph)'
		);
		const union = CollectionDescription.deserialize('everything/starred+unread/');
		assert.strictEqual(
			readableCollectionExpression(union),
			'Everything AND (Starred OR Unread)'
		);
	});

	it('exposes structured expression parts without reparsing display text', () => {
		const description = CollectionDescription.deserialize(
			'everything/starred+unread/query/inductively+knowable/sort/reverse/recent/view/web/graph/'
		);
		const parts = collectionExpressionParts(description);
		assert.deepStrictEqual(parts.set, { raw: 'everything', label: 'Everything' });
		assert.deepStrictEqual(parts.filters.map(({ raw, label, index }) => ({ raw, label, index })), [
			{ raw: 'starred+unread', label: '(Starred OR Unread)', index: 0 },
			{ raw: 'query/inductively+knowable', label: 'Text contains “inductively knowable”', index: 1 },
		]);
		assert.deepStrictEqual(parts.modifiers, ['sorted by reverse Recent', 'viewed as Web (Graph)']);
	});

	//THE LABEL DESCRIBES THE WINDOW THAT ACTUALLY FILTERS.
	//
	//filters.ts accepts `between`'s two bounds in either order and swaps them
	//deliberately, so `between/2026-08-19/2020-01-01` really does select the
	//2020→2026 window. Every label built from it said "between 2026-08-19 and
	//2020-01-01", which describes a window that runs backwards and therefore
	//matches nothing — a sentence about a collection the user is not looking at.
	//The engine keeps its tolerance; the DISPLAY puts the earlier bound first.
	it('names a date range in the order it actually filters', () => {
		const reversed = CollectionDescription.deserialize('everything/updated/between/2026-08-19/2020-01-01/');
		assert.strictEqual(
			readableCollectionExpression(reversed),
			'Everything AND Updated between 2020-01-01 and 2026-08-19'
		);
		//An already-ordered range is untouched, and so is the URL either way:
		//only the sentence changes.
		const ordered = CollectionDescription.deserialize('everything/updated/between/2020-01-01/2026-08-19/');
		assert.strictEqual(
			readableCollectionExpression(ordered),
			'Everything AND Updated between 2020-01-01 and 2026-08-19'
		);
		assert.strictEqual(reversed.filters[0], 'updated/between/2026-08-19/2020-01-01');
		//A relative bound resolves through the engine's own resolver, so a mixed
		//pair still orders: 3 days ago is later than a fixed 2020 date.
		assert.strictEqual(
			readableCollectionExpression(CollectionDescription.deserialize('everything/updated/between/3-days-ago/2020-01-01/')),
			'Everything AND Updated between 2020-01-01 and 3 days ago'
		);
	});

	//'Inverse of <internal id>' is what CARD_FILTER_DESCRIPTIONS synthesizes for
	//every excluding filter, and it is a raw filter id pointed at a user (§1.4).
	//The catalog had already been taught not to show it; the suggestion list had
	//not, so typing "unstarred" offered a row whose entire explanation was the
	//app's own identifier for the other half of the pair.
	it('never explains a filter with the app’s own identifier for another one', () => {
		const suggestions = collectionComposerSuggestions(
			CollectionDescription.deserialize('everything/'),
			'unstarred',
			{ unstarred: 'Inverse of starred', starred: 'Cards you have starred' }
		);
		const row = suggestions.find((suggestion) => suggestion.name === 'Unstarred');
		assert.ok(row, 'typing the excluding half must still offer it');
		assert.ok(!/Inverse of/.test(row.detail), `detail leaked the synthesized sentence: ${row.detail}`);
		assert.strictEqual(row.detail, 'Cards not matching Starred');
	});
});

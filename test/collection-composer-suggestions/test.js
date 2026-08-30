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
let filterNameIsViewerDependent;
let filterNamesAreViewerDependent;
let collectionLinkCopiedMessage;
let COLLECTION_LINK_COPY_FAILED_MESSAGE;

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
			activeCardRelationshipCandidates,
			activeCardMetadataCandidates,
		} = await import('../../lib/src/collection-composer-suggestions.js'));
		//The receipt moved to its own module: naming a clause and knowing that
		//two clauses are the same clause widened are different jobs, and the
		//namer cannot import the draft layer that knows the second one.
		({ collectionDraftReceipt } = await import('../../lib/src/collection-draft-receipt.js'));
		({ selectCollectionComposerCandidates } = await import('../../lib/src/selectors.js'));
		({
			makeConfigurableFilter,
			configurableFilterCacheKey,
			filterNameIsViewerDependent,
			filterNamesAreViewerDependent,
		} = await import('../../lib/src/filters.js'));
		({
			collectionLinkCopiedMessage,
			COLLECTION_LINK_COPY_FAILED_MESSAGE,
		} = await import('../../lib/src/collection-link-copy.js'));
	});

	describe('viewer-dependent filters', () => {
		it('flags every filter whose membership is computed from the signed-in account', () => {
			for (const filter of ['starred', 'unstarred', 'read', 'unread', 'in-reading-list', 'not-in-reading-list']) {
				assert.ok(filterNameIsViewerDependent(filter), `${filter} depends on who is looking`);
			}
		});

		it('separates naming yourself from naming a person', () => {
			//`me` is resolved against extras.userID at evaluation time, so the same
			//URL names a different person for every reader.
			assert.ok(filterNameIsViewerDependent('author/me'));
			assert.ok(filterNameIsViewerDependent('author/me+visibleperson'));
			//A concrete uid is durable, which is exactly what lets the contributor
			//candidates promise a copied link keeps the same person.
			assert.ok(!filterNameIsViewerDependent('author/visibleperson'));
		});

		it('leaves impersonal filters alone', () => {
			for (const filter of ['working-notes', 'has-todo', 'published', 'query/systems', 'updated/after/3-days-ago', 'selected']) {
				assert.ok(!filterNameIsViewerDependent(filter), `${filter} is the same collection for everyone`);
			}
		});

		it('treats one personal clause as making the whole collection personal', () => {
			assert.ok(filterNamesAreViewerDependent(['working-notes', 'unread']));
			assert.ok(!filterNamesAreViewerDependent(['working-notes', 'has-todo']));
			assert.ok(!filterNamesAreViewerDependent([]));
		});

		it('marks the chip for a personal clause and not for its neighbours', () => {
			const parts = collectionExpressionParts(
				CollectionDescription.deserialize('everything/working-notes/unread/')
			);
			assert.deepStrictEqual(
				parts.filters.map((filter) => [filter.raw, filter.viewerDependent]),
				[['working-notes', false], ['unread', true]]
			);
		});

		it('refuses to promise durability for a clause that is recomputed per reader', () => {
			const suggestions = collectionComposerSuggestions(
				CollectionDescription.deserialize('everything/'),
				'',
				descriptions
			);
			const starred = suggestions.find((suggestion) => suggestion.name === 'Starred');
			assert.ok(starred, 'the empty state offers Starred');
			assert.strictEqual(starred.viewerDependent, true);
			//The reassuring sentence is the one thing this row must not say.
			assert.ok(!starred.detail.includes('copied links keep'), starred.detail);
		});

		it('keeps the durability promise for a clause that really is durable', () => {
			const candidate = {
				filter: 'working-notes',
				category: 'todo',
				label: 'Working Notes',
				detail: 'Anchors to the open card',
				spotlight: true,
			};
			const suggestions = collectionComposerSuggestions(
				CollectionDescription.deserialize('everything/'),
				'working',
				descriptions,
				{ candidates: [candidate] }
			);
			const row = suggestions.find((suggestion) => suggestion.id.startsWith('candidate:'));
			assert.ok(row, 'the typed path offers the candidate');
			assert.ok(row.detail.includes('copied links keep it'), row.detail);
			assert.ok(!row.viewerDependent);
		});
	});

	it('says a text query admits cards matching only some of its words', () => {
		//The engine's own contract, pinned in test/fingerprint: a multi-word
		//non-strict query admits a card whose score is above zero, and reports
		//partialMatch when no field held the whole word set. The chip reads
		//`Text contains “…”`, which sounds like a promise that the words appear
		//together, so the row is where the qualification has to live.
		const suggestions = collectionComposerSuggestions(
			CollectionDescription.deserialize('everything/'),
			'systems thinking',
			descriptions
		);
		const query = suggestions.find((suggestion) => suggestion.kind === 'search');
		assert.ok(query, 'a text-query row is always offered');
		assert.match(query.detail, /only some of its words/);
	});

	describe('naming the card an anchored clause anchors', () => {
		const names = {'perf-card-12': 'Perf card 12', 'perf-card-42': 'Perf card 42'};

		it('names the card, in each anchored family', () => {
			const name = (filter) => collectionFilterDisplayName(filter, {}, names);
			assert.strictEqual(name('direct-connections/perf-card-12'), 'Connected to “Perf card 12”');
			assert.strictEqual(name('children/perf-card-12'), 'Cards “Perf card 12” links to');
			assert.strictEqual(name('parents/perf-card-12'), 'Cards linking to “Perf card 12”');
			assert.strictEqual(name('similar/perf-card-12'), 'Similar to “Perf card 12”');
		});

		it('names the same card whether or not the anchor is included in the results', () => {
			//`+` decides whether the anchor is itself a member. It does not change
			//which card is being named.
			assert.strictEqual(
				collectionFilterDisplayName('direct-connections/+perf-card-12', {}, names),
				'Connected to “Perf card 12”'
			);
		});

		it('falls back to the id, and only to the id, when no title has loaded', () => {
			assert.strictEqual(
				collectionFilterDisplayName('direct-connections/+perf-card-99', {}, names),
				'Connected to perf-card-99'
			);
			assert.strictEqual(
				collectionFilterDisplayName('direct-connections/+perf-card-99'),
				'Connected to perf-card-99'
			);
		});

		it('never says “this card” about a card that is not the open one', () => {
			//The open card's own clauses come through `labels`, which is the only
			//thing that knows which card is on screen.
			const labels = { 'children/+open-card': 'This card and cards it links to' };
			assert.strictEqual(
				collectionFilterDisplayName('children/+open-card', labels, names),
				'This card and cards it links to'
			);
			const other = collectionFilterDisplayName('children/+perf-card-42', labels, names);
			assert.strictEqual(other, 'Cards “Perf card 42” links to');
			assert.ok(!other.toLowerCase().includes('this card'), other);
		});

		it('leaves a spelling with more arguments than the family has to the generic path', () => {
			//`children` takes one argument. A name that silently dropped a second
			//would describe a different collection from the one that runs.
			assert.ok(!collectionFilterDisplayName('children/perf-card-12/2', {}, names).startsWith('Cards “Perf card 12” links to'));
		});

		it('labels a degree instead of leaving a bare number', () => {
			//`Descendants Perf-card-12 · 2` gave a search depth no label at all.
			assert.strictEqual(
				collectionFilterDisplayName('descendants/perf-card-12/2', {}, names),
				'Downstream of “Perf card 12” · within 2 steps'
			);
			assert.strictEqual(
				collectionFilterDisplayName('ancestors/perf-card-12/1', {}, names),
				'Upstream of “Perf card 12” · within 1 step'
			);
			//Upstream and downstream are distinguishable at a glance; the
			//sentences they replaced differed only in voice.
			assert.notStrictEqual(
				collectionFilterDisplayName('descendants/perf-card-12/2', {}, names),
				collectionFilterDisplayName('ancestors/perf-card-12/2', {}, names)
			);
		});

		it('names a reference type as a reference type', () => {
			//`References “X” · Link · 2` formatted a reference type and a search
			//depth identically and labelled neither.
			assert.strictEqual(
				collectionFilterDisplayName('references/perf-card-12/link/2', {}, names),
				'Connected to “Perf card 12” · by Link references · within 2 steps'
			);
			assert.strictEqual(
				collectionFilterDisplayName('direct-references-inbound/perf-card-12/link', {}, names),
				'Referencing “Perf card 12” · by Link references'
			);
			assert.strictEqual(
				collectionFilterDisplayName('references-outbound/perf-card-12/link+see-also/3', {}, names),
				'Referenced by “Perf card 12” · by Link or See Also references · within 3 steps'
			);
		});

		it('omits an argument the URL omits rather than inventing its default', () => {
			assert.strictEqual(
				collectionFilterDisplayName('descendants/perf-card-12', {}, names),
				'Downstream of “Perf card 12”'
			);
		});

		it('says which card an anchor changed from and to', () => {
			//This receipt read 'Changed This card and directly connected cards to
			//This card and directly connected cards' — both sides named by a
			//function that never looked at the card.
			const receipt = collectionDraftReceipt(
				CollectionDescription.deserialize('everything/direct-connections/+perf-card-12/'),
				CollectionDescription.deserialize('everything/direct-connections/+perf-card-42/'),
				{},
				names
			);
			assert.strictEqual(receipt, 'Changed Connected to “Perf card 12” to Connected to “Perf card 42”');
		});
	});

	//The clipboard itself is unreachable from a test runner and blocked in the
	//browser harness, so what is pinned here is the sentence the success path
	//hands to the snack bar — the part that actually had to change.
	describe('the sentence after Copy link', () => {
		it('names the collection and its size instead of only confirming a copy', () => {
			assert.strictEqual(
				collectionLinkCopiedMessage(
					CollectionDescription.deserialize('everything/working-notes/has-todo/'),
					{},
					42
				),
				'Copied a link to Everything · Working Notes · Has any TODO — 42 cards — Works for anyone.'
			);
		});

		it('says the link resolves differently for other people when it does', () => {
			assert.strictEqual(
				collectionLinkCopiedMessage(
					CollectionDescription.deserialize('everything/unread/'),
					{},
					7
				),
				'Copied a link to Everything · Unread — 7 cards — Results depend on who views it.'
			);
		});

		it('drops the count rather than claiming zero when none has resolved', () => {
			assert.strictEqual(
				collectionLinkCopiedMessage(CollectionDescription.deserialize('everything/has-todo/')),
				'Copied a link to Everything · Has any TODO — Works for anyone.'
			);
		});

		it('keeps a long expression to a sentence', () => {
			const message = collectionLinkCopiedMessage(
				CollectionDescription.deserialize('everything/working-notes/has-todo/has-links/has-comments/published/'),
				{},
				3
			);
			const expression = message.slice('Copied a link to '.length, message.indexOf(' — 3 cards'));
			assert.ok(expression.length <= 60, `expression was ${expression.length} chars: ${expression}`);
			assert.ok(expression.endsWith('…'), expression);
			assert.ok(message.endsWith('— 3 cards — Works for anyone.'), message);
		});

		it('uses the labels the composer names clauses with', () => {
			assert.strictEqual(
				collectionLinkCopiedMessage(
					CollectionDescription.deserialize('everything/author/visibleperson/'),
					{ 'author/visibleperson': 'Contributed By Casey' },
					2
				),
				'Copied a link to Everything · Contributed By Casey — 2 cards — Works for anyone.'
			);
		});

		it('offers a next step when the browser refuses the clipboard', () => {
			assert.strictEqual(
				COLLECTION_LINK_COPY_FAILED_MESSAGE,
				'Could not copy the collection link. The link is shown in Edit source.'
			);
		});
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
			'Open Main · Starred · sorted by recent'
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
			//SUPERSEDED PIN (D4). The singleton receipts used to narrate the
			//EDIT ('Changed the starting set to Everything'); they now name the
			//STATE ('Starting from Everything'), which is the sentence the
			//collection is actually in and the wording the round-2 feedback
			//asked for. Same voice as the sentence above the receipt.
			'Starting from Everything'
		);
		assert.strictEqual(
			collectionDraftReceipt(base, CollectionDescription.deserialize('main/sort/recent/')),
			'Sorted by Recent'
		);
		assert.strictEqual(
			collectionDraftReceipt(base, CollectionDescription.deserialize('main/starred/unread/working-notes/')),
			'Added Starred, Unread and 1 more'
		);
	});

	//A STRUCTURAL EDIT IS ONE EVENT, AND THE RECEIPT HAS TO SAY WHICH ONE.
	//
	//Read as a set difference, an or-fusion is two events — "Removed Tag 1 ·
	//Added (Tag 1 OR Tag 2)" — and the alarming half, the removal, is the half
	//that did not happen. The user widened a clause; nothing left the sentence.
	//The same is true of a flip (which a set difference sees as two unrelated
	//filters, because `published` and `unpublished` share no family) and of
	//dropping one alternative from a group.
	it('narrates a structural edit as the transformation it is', () => {
		const labels = { 'tag-1': 'Tag 1', 'tag-2': 'Tag 2', 'tag-3': 'Tag 3' };
		const receipt = (before, after) => collectionDraftReceipt(
			CollectionDescription.deserialize(before),
			CollectionDescription.deserialize(after),
			labels
		);

		assert.strictEqual(receipt('main/tag-1/', 'main/tag-1+tag-2/'),
			'Widened Tag 1 with Tag 2');
		assert.strictEqual(receipt('main/tag-1+tag-2/', 'main/tag-1+tag-2+tag-3/'),
			'Widened Tag 1 or Tag 2 with Tag 3',
			'widening an existing group names the group it widened');

		//THE FLIP, in both directions, through the app's own inverse names —
		//which is the whole reason this cannot be a string comparison: nothing
		//about the text of `published` and `unpublished` says they are one
		//clause and its opposite, and only the draft layer knows that they are.
		assert.strictEqual(receipt('main/published/', 'main/unpublished/'),
			'Flipped Published to Unpublished');
		assert.strictEqual(receipt('main/unpublished/', 'main/published/'),
			'Flipped Unpublished to Published');

		//A FLIPPED GROUP IS NOT A FLIPPED PILL, and it cannot be narrated as one.
		//"Flipped Tag 1 or Tag 2 to not Tag 1 or Tag 2" is the same words twice
		//with a negation buried in the middle, and read left to right it says
		//(not Tag 1) or Tag 2 — a different collection from the one it names, and
		//the exact precedence the group's border exists to settle on screen. The
		//group is named ONCE, and the change is stated as what the collection now
		//keeps.
		assert.strictEqual(receipt('main/tag-1+tag-2/', 'main/exclude/tag-1+tag-2/'),
			'Flipped Tag 1 or Tag 2 to keep only cards matching none of it');
		assert.strictEqual(receipt('main/exclude/tag-1+tag-2/', 'main/tag-1+tag-2/'),
			'Flipped Tag 1 or Tag 2 to keep cards matching any of it');

		//NARROWING NAMES WHAT THE CLAUSE IS NOW, not what left it: the reader
		//should not have to do the subtraction. Both the group that survives and
		//the group that dissolves into a single pill are the same edit.
		assert.strictEqual(receipt('main/tag-1+tag-2/', 'main/tag-1/'),
			'Narrowed Tag 1 or Tag 2 to Tag 1');
		assert.strictEqual(receipt('main/tag-1+tag-2+tag-3/', 'main/tag-1+tag-3/'),
			'Narrowed Tag 1 or Tag 2 or Tag 3 to Tag 1 or Tag 3');

		//AND THE SHAPES IT MUST NOT CLAIM. An argument edit keeps its family and
		//is not a structural change; two unrelated clauses swapping is not one
		//edit at all.
		assert.strictEqual(
			receipt('main/updated/after/7-days-ago/', 'main/updated/after/14-days-ago/'),
			'Changed Updated since 7 days ago to Updated since 14 days ago');
		assert.strictEqual(receipt('main/starred/', 'main/unread/'),
			'Removed Starred · Added Unread');
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
			'Everything · Cards Casey authored or collaborated on'
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
		//With the open card's labels in hand, the clause is the open card's, and
		//says so.
		assert.strictEqual(
			readableCollectionExpression(suggestions[0].description, collectionFilterLabels(candidates)),
			'Everything · This card and cards it links to'
		);
		//Without them, nothing here knows card-123 is the card on screen, so the
		//clause is named by the card it anchors rather than by a guess. This used
		//to read 'This card and cards it links to' for every anchor, which made
		//two clauses anchored to different cards indistinguishable.
		assert.strictEqual(
			readableCollectionExpression(suggestions[0].description),
			'Everything · Cards card-123 links to'
		);
		//And with a title loaded, the card is named the way a person would.
		assert.strictEqual(
			readableCollectionExpression(suggestions[0].description, {}, {'card-123': 'Perf card 12'}),
			'Everything · Cards “Perf card 12” links to'
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
		//The active-card destination SURVIVES a recent now. It used to reach the
		//empty list only through the spotlight branch, which requires no recents,
		//no refinements and no filters — so the one row that depends on where the
		//user actually is was the row the opening list almost never offered, and
		//§Opening state names active-card destinations in its first section.
		const anchored = withRecent.filter(suggestion => suggestion.kind === 'add' && suggestion.label.includes('This card'));
		assert.deepStrictEqual(anchored.map(suggestion => suggestion.label), [
			'Add This card and directly connected cards',
		], 'exactly one active-card row, not the family of three');
		//And it is ranked after the recents, ahead of the generic refinements.
		const labels = withRecent.map(suggestion => suggestion.label);
		assert.ok(labels.indexOf('Add This card and directly connected cards') > labels.findIndex((_, index) => withRecent[index].kind === 'recent'));
		assert.ok(labels.indexOf('Add This card and directly connected cards') < labels.indexOf('Add Unread'));
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
			'Everything · Tagged Inductively Knowable'
		);

		const combined = [...contextual, ...activeCardRelationshipCandidates('card-123')];
		const withoutTyping = collectionComposerSuggestions(
			CollectionDescription.deserialize('everything/'), '', descriptions, { candidates: combined }
		);
		//The active-card destination leads the refinements now; the tag and
		//section spotlights keep their slots behind it rather than being
		//displaced by it.
		assert.deepStrictEqual(withoutTyping.slice(0, 3).map(suggestion => suggestion.label), [
			'Add This card and directly connected cards',
			'Add Tagged Inductively Knowable',
			'Add Section Half Baked',
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
			'Everything · Starred · Working Notes · sorted by reverse updated'
		);
		const query = CollectionDescription.deserialize(
			'everything/query/inductively+knowable/'
		);
		assert.strictEqual(
			readableCollectionExpression(query),
			'Everything · Text contains “inductively knowable”'
		);
		const web = CollectionDescription.deserialize('everything/view/web/graph/');
		assert.strictEqual(
			readableCollectionExpression(web),
			'Everything · viewed as web (Graph)'
		);
		const union = CollectionDescription.deserialize('everything/starred+unread/');
		assert.strictEqual(
			readableCollectionExpression(union),
			'Everything · Starred or Unread'
		);
	});

	it('exposes structured expression parts without reparsing display text', () => {
		const description = CollectionDescription.deserialize(
			'everything/starred+unread/query/inductively+knowable/sort/reverse/recent/view/web/graph/'
		);
		const parts = collectionExpressionParts(description);
		assert.deepStrictEqual(parts.set, { raw: 'everything', label: 'Everything' });
		assert.deepStrictEqual(parts.filters.map(({ raw, label, index }) => ({ raw, label, index })), [
			{ raw: 'starred+unread', label: 'Starred or Unread', index: 0 },
			{ raw: 'query/inductively+knowable', label: 'Text contains “inductively knowable”', index: 1 },
		]);
		assert.deepStrictEqual(parts.modifiers, ['sorted by reverse recent', 'viewed as web (Graph)']);
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
			'Everything · Updated between 2020-01-01 and 2026-08-19'
		);
		//An already-ordered range is untouched, and so is the URL either way:
		//only the sentence changes.
		const ordered = CollectionDescription.deserialize('everything/updated/between/2020-01-01/2026-08-19/');
		assert.strictEqual(
			readableCollectionExpression(ordered),
			'Everything · Updated between 2020-01-01 and 2026-08-19'
		);
		assert.strictEqual(reversed.filters[0], 'updated/between/2026-08-19/2020-01-01');
		//A relative bound resolves through the engine's own resolver, so a mixed
		//pair still orders: 3 days ago is later than a fixed 2020 date.
		assert.strictEqual(
			readableCollectionExpression(CollectionDescription.deserialize('everything/updated/between/3-days-ago/2020-01-01/')),
			'Everything · Updated between 2020-01-01 and 3 days ago'
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
		//'Cards not matching Starred' is the DERIVED repair, and it is the
		//fallback. Once collection-filter-synonyms curates a real sentence for
		//this half of the pair, that sentence wins: an authored description is
		//strictly better than one composed out of the other half's display name,
		//and it still names no identifier.
		assert.strictEqual(row.detail, 'Cards you have never marked with a star.');
		assert.ok(!/\bstarred\b/.test(row.detail), `detail leaked a raw filter id: ${row.detail}`);
	});
});

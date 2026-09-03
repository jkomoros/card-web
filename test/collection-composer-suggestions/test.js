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
let collectionFilterDescription;
let collectionFilterLabels;
let collectionComposerDestinationDiff;
let collectionCompletionCandidates;
let selectCollectionComposerCandidates;
let activeCardRelationshipCandidates;
let activeCardMetadataCandidates;
let makeConfigurableFilter;
let configurableFilterCacheKey;
let filterNameIsViewerDependent;
let filterNamesAreViewerDependent;
let collectionLinkCopiedMessage;
let COLLECTION_LINK_COPY_FAILED_MESSAGE;
let collectionOrderPhrases;

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
			collectionComposerDestinationDiff,
			collectionExpressionParts,
			collectionFilterDisplayName,
			collectionFilterDescription,
			collectionFilterLabels,
			collectionOrderPhrases,
			activeCardRelationshipCandidates,
			activeCardMetadataCandidates,
		} = await import('../../lib/src/collection-composer-suggestions.js'));
		//THE TYPED PATH LIVES NEXT DOOR. collectionComposerSuggestions answers
		//only the idle question now, so the two pins below that are about what
		//typing produces ask the module that actually produces it.
		({ collectionCompletionCandidates } = await import('../../lib/src/collection-completion-index.js'));
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

		//RE-POINTED from the deleted typed list. The URL note is composed by one
		//function for every row that carries one, and the rows still asking it for
		//one are the opening list's spotlight candidates — so the promise, and the
		//refusal above it, are pinned where they are still made.
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
				'',
				descriptions,
				{ candidates: [candidate] }
			);
			const row = suggestions.find((suggestion) => suggestion.id.startsWith('candidate:'));
			assert.ok(row, 'the opening list offers the spotlight candidate');
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
		//
		//RE-POINTED. This used to ask this module's own typed list for its
		//trailing `query:` row. That list is deleted; the row a user actually
		//reads this sentence on is the completion index's free-text floor row,
		//which carries the same sentence and is the only place that still does.
		const rows = collectionCompletionCandidates({
			token: 'systems thinking',
			expression: [],
			description: CollectionDescription.deserialize('everything/'),
			context: { candidates: [], filterDescriptions: {} },
			limit: 20,
		});
		const query = rows.find((row) => row.filter && row.filter.startsWith('query/'));
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
			//SUPERSEDED PIN (round 3, D1/D3). This used to run through
			//collectionDraftReceipt, the in-dialog narration of a draft edit —
			//deleted with the receipt strip, because the owner's constitution
			//makes the draft a preview that has changed nothing real and Escape
			//the undo. The naming defect it was filed against ('Changed This card
			//and directly connected cards to This card and directly connected
			//cards' — both sides named by a function that never looked at the
			//card) belongs to the diff namer that SURVIVED: the one-line
			//annotation a combinatorial row carries (D3).
			const diff = collectionComposerDestinationDiff(
				CollectionDescription.deserialize('everything/direct-connections/+perf-card-12/'),
				CollectionDescription.deserialize('everything/direct-connections/+perf-card-42/'),
				{},
				names
			);
			assert.strictEqual(diff, 'Removes Connected to “Perf card 12” · Adds Connected to “Perf card 42”');
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

	//A clause has one name. These are the places the same clause shows up while
	//it is being composed, plus the receipt that follows. The typed ADD row was
	//a fifth of them until the typed list was deleted; the four left are the
	//four this module still draws.
	it('uses one name for a clause in the namer, the chip, the broaden row, and the receipt', () => {
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
			{ filter: 'starred', name: 'Starred' },
			{ filter: 'inductively-knowable', name: 'Tagged Inductively Knowable' },
			//A configurable filter carrying a value nobody hardcoded. Its name has to
			//be derived from its own URL parts, or editing 7 into 14 degrades
			//"Updated since 7 days ago" into "Updated After · 14 Days Ago".
			{ filter: 'updated/after/14-days-ago', name: 'Updated since 14 days ago' },
			{ filter: 'created/between/3-days-ago/yesterday', name: 'Created between 3 days ago and yesterday' },
		];
		for (const { filter, name } of cases) {
			assert.strictEqual(collectionFilterDisplayName(filter, labels), name, filter);
			const applied = CollectionDescription.deserialize(`everything/${filter}/`);
			assert.strictEqual(collectionExpressionParts(applied, labels).filters[0].label, name, `chip: ${filter}`);
			const broaden = collectionComposerSuggestions(applied, '', descriptions, { candidates })
				.find((suggestion) => suggestion.action === 'remove');
			assert.strictEqual(broaden.label, `Remove ${name}`, `broaden row: ${filter}`);
			assert.strictEqual(broaden.name, name, `broaden name: ${filter}`);
			assert.strictEqual(
				collectionComposerDestinationDiff(applied, CollectionDescription.deserialize('everything/'), labels),
				`Removes ${name}`,
				`diff: ${filter}`
			);
		}
	});

	//THE PIN LEDGER FOR THE DELETED RECEIPT (round 3, D1).
	//
	//Two suites lived here: 'composes receipts as sentences rather than restating
	//the row', and 'narrates a structural edit as the transformation it is' — the
	//second of which pinned a genuinely careful piece of work (an or-fusion is ONE
	//event, "Widened Tag 1 with Tag 2", not the set difference's two, whose
	//alarming half is the half that did not happen).
	//
	//Both are superseded because the surface they described is gone. The owner's
	//constitution: "Not live-changing the real collection until you commit with
	//Cmd-Enter; before that it's just showing a preview; if you make a mistake,
	//esc/X resets to the previous state." A receipt strip narrating each draft
	//edit reports a change nobody has made yet, and its Undo button was a second,
	//weaker undo standing beside the one Escape already was. collection-draft-
	//receipt.ts is deleted with them.
	//
	//WHAT SURVIVED IS THE PREDICTION, NOT THE REPORT. A combinatorial row — a
	//recent, a pivot — cannot show what it does as one pill, so it says it in a
	//line: 'Removes Starred · Adds Tagged systems · Sorts by Recent' (D3, the
	//annotation slot). That is the same sentence turned around from past tense to
	//present, and it is pinned here in the tense the product now speaks.
	it('names what a combinatorial row would do to the draft, in one line', () => {
		const base = CollectionDescription.deserialize('main/');
		const diff = (before, after, labels = {}) => collectionComposerDestinationDiff(
			CollectionDescription.deserialize(before),
			CollectionDescription.deserialize(after),
			labels
		);
		assert.strictEqual(
			collectionComposerDestinationDiff(base, CollectionDescription.deserialize('main/starred/')),
			'Adds Starred'
		);
		assert.strictEqual(diff('main/starred/', 'main/unread/'),
			'Removes Starred · Adds Unread');
		assert.strictEqual(diff('main/', 'everything/'),
			'Uses Everything instead of Main');
		assert.strictEqual(diff('main/', 'main/sort/recent/'),
			'Sorts by Recent');
		//THE WHOLE PAYLOAD IN ONE SLOT. This is the shape the row anatomy asks a
		//combinatorial row for: several changes, one line, same place every other
		//row puts its quiet annotation.
		assert.strictEqual(diff('main/starred/', 'everything/unread/sort/recent/'),
			'Uses Everything instead of Main · Removes Starred · Adds Unread · Sorts by Recent');
		//AND NOTHING AT ALL when the row would change nothing, which is what lets
		//the palette leave the annotation off rather than print an empty one.
		assert.strictEqual(diff('main/starred/', 'main/starred/'), '');
	});

	//RE-POINTED AND NARROWED, from 'discovers concrete values with deterministic,
	//inspectable filters'. The discovery half of that claim — a typed phrase
	//finding this tag, and finding it ahead of the free-text reading — was the
	//deleted typed list's ranking, and the completion index pins the same
	//ordering over the same vocabulary. WHAT SURVIVES IS THE URL NOTE: it is
	//composed by one function for every row that carries one, opening-list rows
	//included, and the §1.4 rule it enforces has nothing to do with typing.
	it('names a concrete value in its URL note, never by its URL spelling', () => {
		const current = CollectionDescription.deserialize('everything/');
		const candidates = [
			{
				filter: 'inductively-knowable',
				category: 'tag',
				label: 'Tagged “Inductively Knowable”',
				detail: 'Keeps cards tagged Inductively Knowable',
				aliases: ['inductively knowable', 'tag'],
				spotlight: true,
			},
		];
		const suggestions = collectionComposerSuggestions(
			current,
			'',
			{ 'inductively-knowable': 'Matches cards in the Inductively Knowable tag' },
			{ candidates }
		);
		const row = suggestions.find((suggestion) => suggestion.id.startsWith('candidate:'));
		assert.ok(row, 'the opening list offers the spotlight candidate');
		assert.strictEqual(row.label, 'Add Tagged “Inductively Knowable”');
		assert.deepStrictEqual(row.description.filters, ['inductively-knowable']);
		//The URL note names the clause the way every other surface names it, and
		//never by its URL spelling (HS-1.4). The raw key must not appear at all.
		assert.match(row.detail, /Adds Tagged “Inductively Knowable” to the collection URL/);
		assert.ok(!row.detail.includes('inductively-knowable'),
			'a filter\'s URL spelling is an internal identifier, not a name');
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

		//THE HONEST LABEL, asked of the namer rather than of a typed list. Typing
		//'casey' and getting this candidate is the completion index's business
		//now; that the clause it produces is NAMED by the person and never by the
		//uid in its URL is this module's, and is the half that was ever at risk.
		const labels = collectionFilterLabels(candidates);
		assert.strictEqual(collectionFilterDisplayName('author/visibleperson', labels), 'Contributed By Casey');
		assert.doesNotMatch(collectionFilterDisplayName('author/visibleperson', labels), /visibleperson/i);
		const contributed = CollectionDescription.deserialize('everything/author/visibleperson/');
		const [contributorFilter] = makeConfigurableFilter('author/visibleperson');
		assert.strictEqual(contributorFilter({ author: 'Other', collaborators: ['VisiblePerson'] }, {}).matches, true);
		assert.strictEqual(
			readableCollectionExpression(contributed, {
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

	it('offers explicit active-card relationship clauses only with context', () => {
		assert.deepStrictEqual(activeCardRelationshipCandidates(''), []);
		const candidates = activeCardRelationshipCandidates('card-123');
		const children = candidates.find((candidate) => candidate.filter === 'children/+card-123');
		assert.ok(children, 'the family anchors to the card that is actually open');
		//The anchor is durable: the clause carries the card's own id, never the
		//router's placeholder for "whatever card happens to be open".
		assert.doesNotMatch(children.filter, /key-card-id/);
		assert.match(children.detail, /copied links keep this anchor/);
		const linksFrom = CollectionDescription.deserialize('everything/children/+card-123/');
		//With the open card's labels in hand, the clause is the open card's, and
		//says so.
		assert.strictEqual(
			readableCollectionExpression(linksFrom, collectionFilterLabels(candidates)),
			'Everything · This card and cards it links to'
		);
		//Without them, nothing here knows card-123 is the card on screen, so the
		//clause is named by the card it anchors rather than by a guess. This used
		//to read 'This card and cards it links to' for every anchor, which made
		//two clauses anchored to different cards indistinguishable.
		assert.strictEqual(
			readableCollectionExpression(linksFrom),
			'Everything · Cards card-123 links to'
		);
		//And with a title loaded, the card is named the way a person would.
		assert.strictEqual(
			readableCollectionExpression(linksFrom, {}, {'card-123': 'Perf card 12'}),
			'Everything · Cards “Perf card 12” links to'
		);

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

		//AND THE SEEDED CANDIDATE IS NAMED BY THE MEANING IT EXECUTES WITH. Which
		//typed phrase surfaces it ('last 7 days') is the completion index's
		//ranking; that the clause it seeds is spelled `updated/after/7-days-ago`
		//and named 'Updated since 7 days ago' — the same window the filter above
		//just ran — is the part that has to hold wherever the row appears.
		const candidates = selectCollectionComposerCandidates({ data: { sections: {}, tags: {}, cards: {}, authors: {} } });
		const seeded = candidates.find((candidate) => candidate.filter === 'updated/after/7-days-ago');
		assert.ok(seeded, 'the corpus seeds a durable relative-date candidate');
		assert.strictEqual(
			collectionFilterDisplayName(seeded.filter, collectionFilterLabels(candidates)),
			'Updated since 7 days ago'
		);

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
	//
	//RE-POINTED to the namer itself. The row that leaked the sentence was in the
	//deleted typed list, but the leak was never that list's: it is
	//collectionFilterDescription that decides what an excluding filter says, and
	//that function feeds the catalog, the completion index and every aria-label
	//composed from either. Asking it directly pins the MUST at the one place it
	//is answered rather than at one of the surfaces that repeat the answer.
	it('never explains a filter with the app’s own identifier for another one', () => {
		const synthesized = { unstarred: 'Inverse of starred', starred: 'Cards you have starred' };
		assert.strictEqual(collectionFilterDisplayName('unstarred'), 'Unstarred',
			'the excluding half is still a nameable clause');
		const detail = collectionFilterDescription('unstarred', synthesized);
		assert.ok(!/Inverse of/.test(detail), `detail leaked the synthesized sentence: ${detail}`);
		//'Cards not matching Starred' is the DERIVED repair, and it is the
		//fallback. Once collection-filter-synonyms curates a real sentence for
		//this half of the pair, that sentence wins: an authored description is
		//strictly better than one composed out of the other half's display name,
		//and it still names no identifier.
		assert.strictEqual(detail, 'Cards you have never marked with a star.');
		assert.ok(!/\bstarred\b/.test(detail), `detail leaked a raw filter id: ${detail}`);
	});

	//THE ORDER TAIL, IN TWO REGISTERS (owner, F1).
	//
	//'full' spells the collection; 'summary' names a DESTINATION, in a list,
	//beside an annotation and a count, with the whole diff a highlight away. The
	//difference between them is exactly one question: was this order CHOSEN?
	//
	//Two orders count as unchosen. `default` is the engine's no-op sort and was
	//already omitted everywhere. `recent` is the app's own answer when a
	//collection is asked for and nothing says how to order it —
	//selectCollectionDescriptionForQuery picks it for a generic find with nothing
	//typed, which is the only place in this app a sort is ever chosen ON the
	//user's behalf. That is what makes it an assumption rather than a statement,
	//and it is why so many stored collections wear it.
	describe('the order tail', () => {

		it('omits the no-op sort in both registers, as it always did', () => {
			assert.deepStrictEqual(collectionOrderPhrases('default', false, 'list', ''), []);
			assert.deepStrictEqual(collectionOrderPhrases('default', false, 'list', '', 'summary'), []);
		});

		it('spells an assumed order in full and omits it in a summary', () => {
			assert.deepStrictEqual(collectionOrderPhrases('recent', false, 'list', ''), ['sorted by recent']);
			assert.deepStrictEqual(collectionOrderPhrases('recent', false, 'list', '', 'summary'), []);
		});

		it('keeps an order that IS a choice, in both registers', () => {
			for (const mode of ['full', 'summary']) {
				assert.deepStrictEqual(collectionOrderPhrases('stars', false, 'list', '', mode), ['sorted by stars'], mode);
			}
		});

		it('treats a REVERSED order as a choice, whichever sort it reverses', () => {
			//`sort/reverse/recent` is oldest-first, which no default ever means.
			assert.deepStrictEqual(collectionOrderPhrases('recent', true, 'list', '', 'summary'), ['sorted by reverse recent']);
			assert.deepStrictEqual(collectionOrderPhrases('default', true, 'list', '', 'summary'), ['sorted by reverse default']);
		});

		it('never abbreviates the VIEW, which is not an order at all', () => {
			assert.deepStrictEqual(collectionOrderPhrases('recent', false, 'web', '', 'summary'), ['viewed as web']);
		});

		it('defaults to the full register, so an unmarked caller loses nothing', () => {
			assert.deepStrictEqual(collectionOrderPhrases('recent', false, 'list', ''), ['sorted by recent']);
		});
	});
});

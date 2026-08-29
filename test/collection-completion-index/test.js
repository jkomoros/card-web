/*eslint-env node, es2022*/

//THE ACCEPTANCE GATE FOR THE PALETTE'S DATA LAYER.
//
//Three contracts, all of them things the redesign states as promises to the
//user and none of them visible by reading the module:
//
//  1. THE TIERS. "Killing the catalog bets on search metadata quality"
//     (meta-proposal, risks on record). A tier order that quietly inverts —
//     description prose outranking a filter's own name — turns the one input
//     into a slot machine, and it does it without throwing.
//  2. THE VALENCES. Proposal B §3.1's grammar: `+` leads, `~` is labeled with
//     what it widens, `–` ranks below unless the user led with a negation. The
//     rows are also EDITS, so what they compile to is asserted against the
//     engine's own spellings from proposal C §3, not against prose.
//  3. THE IDLE CAP. "Idle suggestions capped at recents + 3 deterministic
//     contextual rows" (Graft 1), which is the owner's complaint #6 answered by
//     arithmetic. Determinism is asserted by calling twice.

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
let collectionCompletionCandidates;
let collectionCompletionIdleRows;
let completionValences;
let strippedNegationPrefix;
let valueFamilyForFilter;
let filtersForValence;
let IDLE_CONTEXTUAL_ROW_LIMIT;
let parseCollectionExpression;
let serializeCollectionExpression;
let CARD_FILTER_DESCRIPTIONS;

//A small closed world. Two tags, one section, so a tag/tag OR and a tag/section
//OR are both expressible and can be told apart.
const candidates = () => [
	{
		filter: 'tag-b',
		category: 'tag',
		label: 'Tagged “Systems”',
		detail: 'Keeps cards tagged Systems',
		aliases: ['tag-b', 'Systems', 'tag', 'tagged'],
		valueLabel: 'Systems',
		clauseLabel: 'Tagged Systems',
	},
	{
		filter: 'tag-c',
		category: 'tag',
		label: 'Tagged “Complexity”',
		detail: 'Keeps cards tagged Complexity',
		aliases: ['tag-c', 'Complexity', 'tag', 'tagged'],
		valueLabel: 'Complexity',
		clauseLabel: 'Tagged Complexity',
	},
	{
		filter: 'notes-section',
		category: 'section',
		label: 'In section “Notes”',
		detail: 'Keeps cards in the Notes section',
		aliases: ['notes-section', 'Notes', 'section'],
		valueLabel: 'Notes',
		clauseLabel: 'Section Notes',
	},
].map(candidate => ({
	...candidate,
	searchValues: [candidate.label, candidate.filter, candidate.category, ...(candidate.aliases || [])].map(value => value.toLowerCase()),
}));

const draft = (serialized = 'everything/') => CollectionDescription.deserialize(serialized);

const complete = (token, serialized = 'everything/', extra = {}) => collectionCompletionCandidates({
	token,
	expression: parseCollectionExpression(draft(serialized).filters),
	description: draft(serialized),
	context: {
		candidates: candidates(),
		filterDescriptions: CARD_FILTER_DESCRIPTIONS,
		...extra,
	},
	limit: 20,
});

describe('Collection completion index', () => {
	before(async () => {
		({ CollectionDescription } = await import('../../lib/src/collection_description.js'));
		({
			collectionCompletionCandidates,
			collectionCompletionIdleRows,
			completionValences,
			strippedNegationPrefix,
			valueFamilyForFilter,
			filtersForValence,
			IDLE_CONTEXTUAL_ROW_LIMIT,
		} = await import('../../lib/src/collection-completion-index.js'));
		({ parseCollectionExpression, serializeCollectionExpression } = await import('../../lib/src/collection-expression.js'));
		({ CARD_FILTER_DESCRIPTIONS } = await import('../../lib/src/filters.js'));
	});

	describe('matching tiers', () => {
		//THE TIER ORDER, asserted on one token against four candidates built to
		//match at exactly one tier each. Anything that reorders the tiers reorders
		//this list.
		it('ranks name over alias over description over fuzzy', () => {
			const world = [
				//name-exact
				{ filter: 'zebra', category: 'tag', label: 'zebra', detail: 'nothing relevant here' },
				//alias: the name does not contain the token, a search word does
				{ filter: 'aardvark', category: 'tag', label: 'Aardvark', detail: 'nothing relevant here', aliases: ['zebra stripes'] },
				//description: the token starts a word in the prose only
				{ filter: 'bison', category: 'tag', label: 'Bison', detail: 'A herd of zebra graze nearby' },
				//fuzzy: z-e-b-r-a appear in order, close together, and at no
				//better tier — no word of the name starts with 'zebra'
				{ filter: 'zebu-barn', category: 'tag', label: 'Zebu Barn Area', detail: 'nothing relevant here' },
			].map(candidate => ({
				...candidate,
				searchValues: [candidate.label, candidate.filter, ...(candidate.aliases || [])].map(value => value.toLowerCase()),
			}));
			const result = collectionCompletionCandidates({
				token: 'zebra',
				expression: [],
				description: draft(),
				context: { candidates: world, filterDescriptions: {} },
				limit: 20,
			});
			assert.deepStrictEqual(
				result.map(candidate => [candidate.filter, candidate.tier]),
				[
					['zebra', 'name-exact'],
					['aardvark', 'alias'],
					['bison', 'description'],
					['zebu-barn', 'fuzzy'],
				]
			);
		});

		it('prefers a whole-name prefix to a word inside the name', () => {
			const world = [
				{ filter: 'inner', category: 'tag', label: 'Deep Systems Thinking', detail: '' },
				{ filter: 'leading', category: 'tag', label: 'Systems', detail: '' },
			].map(candidate => ({ ...candidate, searchValues: [candidate.label.toLowerCase()] }));
			const result = collectionCompletionCandidates({
				token: 'system',
				expression: [],
				description: draft(),
				context: { candidates: world, filterDescriptions: {} },
				limit: 20,
			});
			assert.deepStrictEqual(result.map(candidate => candidate.filter), ['leading', 'inner']);
		});

		it('matches description prose only at a word boundary', () => {
			//'or' is inside 'authored' and 'colored'; a substring matcher would
			//return both. Only a description that STARTS a word with the token
			//counts, and here nothing does.
			const world = [{
				filter: 'colorful',
				category: 'tag',
				label: 'Colorful',
				detail: 'Cards that are authored and colored',
				searchValues: ['colorful'],
			}];
			const result = collectionCompletionCandidates({
				token: 'or',
				expression: [],
				description: draft(),
				context: { candidates: world, filterDescriptions: {} },
				limit: 20,
			});
			assert.deepStrictEqual(result.filter(candidate => candidate.filter).map(candidate => candidate.filter), []);
			//The rows that DO come back are sentence words whose own names begin
			//with the token — 'Original Order', 'Tweet Order'. Those are name
			//matches, not prose matches, which is exactly the distinction this
			//test exists to keep: 'or' reaches a thing called Order and does not
			//reach a thing merely described as 'authored and colored'.
			assert.ok(result.every(candidate => candidate.kind === 'sort'),
				`prose matched something it should not have: ${result.map(candidate => candidate.id).join(', ')}`);
		});

		it('finds a tag by its own authored description', () => {
			//tagInfos[].description is the half of description matching the filter
			//registry cannot supply — proposal C §2b names it explicitly.
			const result = complete('epistemology', 'everything/', {
				tagInfos: {
					'tag-b': { id: 'tag-b', title: 'Systems', description: 'Cards about epistemology and how we know things' },
				},
			});
			const row = result.find(candidate => candidate.filter === 'tag-b');
			assert.ok(row, 'a tag must be findable by the words of its own description');
			assert.strictEqual(row.tier, 'description');
			assert.strictEqual(row.matchedOn, 'epistemology');
		});

		it('finds the not-updated family by typing “stale”', () => {
			//The inverse of `updated` has no name of its own, so 'stale' can only
			//reach it through the family's curated metadata. This is the exact
			//example proposal C §2b gives for why description/synonym matching is
			//worth building.
			const result = complete('stale');
			const row = result.find(candidate => candidate.filter.split('/')[0] === 'updated');
			assert.ok(row, `typing “stale” must reach the updated family: ${result.map(item => item.filter).join(', ')}`);
			//And the row it reaches carries a `not` valence, which is the half of
			//the family the word actually means.
			assert.ok(row.valences.some(valence => valence.kind === 'not'),
				'the stale row must be able to become a negation');
		});

		it('finds published by typing “pub”', () => {
			//Proposal C's flow ③ names this by hand: "aliases catch 'pub'".
			const result = complete('pub');
			const row = result.find(candidate => candidate.filter === 'published');
			assert.ok(row, `typing “pub” must reach published: ${result.map(item => item.filter).join(', ')}`);
			assert.strictEqual(row.tier, 'name-prefix');
		});

		it('matches a recent collection by typed text and ranks it first among equals', () => {
			//A recent whose name starts with the token and a tag whose name starts
			//with the token are the same tier. The recent wins, because it is a
			//collection the user has actually been in.
			const result = complete('tagged', 'everything/', {
				recentCollections: [
					{ description: draft('everything/tag-c/'), visits: 3 },
				],
			});
			assert.ok(result.length, 'something must match');
			assert.strictEqual(result[0].kind, 'recent',
				`a recent must lead among equals, got ${result.map(item => `${item.kind}:${item.tier}`).join(', ')}`);
			assert.strictEqual(result[0].tier, result[1].tier,
				'the tie this asserts only exists if the two matched at the same tier');
			//And a recent is a destination, not an edit: it carries a description
			//and no valences.
			assert.ok(result[0].description, 'a recent must carry the collection it opens');
			assert.deepStrictEqual(result[0].valences, []);
		});

		it('does not let a recent outrank a better-matched filter', () => {
			//The tiebreak is within a tier only. A recent matched fuzzily must not
			//jump a filter matched by its own name.
			const result = complete('published', 'everything/', {
				recentCollections: [
					{ description: draft('everything/tag-b/'), visits: 9 },
				],
			});
			assert.strictEqual(result[0].filter, 'published');
		});

		it('strips a negation prefix before matching', () => {
			for (const raw of ['not published', '-published', 'without published', 'except published', '!published']) {
				assert.deepStrictEqual(strippedNegationPrefix(raw), { token: 'published', negated: true }, raw);
			}
			//A bare prefix is somebody mid-word, not a negation of nothing.
			assert.deepStrictEqual(strippedNegationPrefix('not '), { token: 'not', negated: false });
			assert.deepStrictEqual(strippedNegationPrefix('-'), { token: '-', negated: false });
			//And the stripped token still finds the family.
			const result = complete('not pub');
			assert.ok(result.some(candidate => candidate.filter === 'published'),
				'stripping must happen before matching, not after');
		});

		it('offers set, sort and view as words in the sentence', () => {
			const result = complete('reading');
			assert.ok(result.some(candidate => candidate.kind === 'set' && candidate.id === 'set:reading-list'),
				'a set must be typeable');
			const sorts = complete('stars').filter(candidate => candidate.kind === 'sort');
			assert.ok(sorts.length, 'a sort must be typeable');
			//A sentence word replaces part of the description, so it carries one
			//and no valences.
			assert.ok(sorts[0].description);
			assert.deepStrictEqual(sorts[0].valences, []);
		});
	});

	describe('valence generation', () => {
		const node = filter => ({ kind: 'filter', filter });

		it('offers add and not against an empty sentence, and no or', () => {
			const valences = completionValences(node('tag-b'), [], { idPrefix: 'x', candidates: candidates() });
			assert.deepStrictEqual(valences.map(valence => valence.kind), ['add', 'not']);
		});

		it('offers or only against a condition, labeled with what it widens', () => {
			const expression = parseCollectionExpression(['tag-c']);
			const valences = completionValences(node('tag-b'), expression, {
				idPrefix: 'x',
				labels: { 'tag-b': 'Tagged Systems', 'tag-c': 'Tagged Complexity' },
				candidates: candidates(),
			});
			const or = valences.find(valence => valence.kind === 'or');
			assert.ok(or, 'a compatible condition must produce an or row');
			assert.strictEqual(or.targetIndex, 0);
			assert.strictEqual(or.targetLabel, 'Tagged Complexity');
			assert.strictEqual(or.label, 'Tagged Complexity or Tagged Systems');
			assert.strictEqual(or.compatible, true);
			//`+` leads; `~` next; `–` below (proposal B §3.1).
			assert.deepStrictEqual(valences.map(valence => valence.kind), ['add', 'or', 'not']);
		});

		it('ranks an incompatible or below not rather than refusing it', () => {
			//The engine unions ANY two conditions, so this row is legal and is
			//offered. It is just not what somebody usually meant, so it sinks.
			const expression = parseCollectionExpression(['notes-section']);
			const valences = completionValences(node('tag-b'), expression, {
				idPrefix: 'x',
				candidates: candidates(),
			});
			assert.deepStrictEqual(valences.map(valence => valence.kind), ['add', 'not', 'or']);
			const or = valences.find(valence => valence.kind === 'or');
			assert.strictEqual(or.compatible, false);
			//And it still WORKS — an available row that produced a broken
			//expression would be worse than no row.
			assert.deepStrictEqual(filtersForValence(or), ['notes-section+tag-b']);
		});

		it('treats two ordinary card properties as one family', () => {
			assert.strictEqual(valueFamilyForFilter('has-images'), 'property');
			assert.strictEqual(valueFamilyForFilter('has-diagram'), 'property');
			const expression = parseCollectionExpression(['has-images']);
			const valences = completionValences(node('has-diagram'), expression, { idPrefix: 'x' });
			assert.strictEqual(valences.find(valence => valence.kind === 'or').compatible, true);
		});

		it('treats a tag and a section as different families', () => {
			assert.strictEqual(valueFamilyForFilter('tag-b', candidates()), 'value:tag');
			assert.strictEqual(valueFamilyForFilter('notes-section', candidates()), 'value:section');
		});

		it('treats one configurable family as compatible with itself only', () => {
			assert.strictEqual(valueFamilyForFilter('updated/after/today'), 'configurable:updated');
			assert.strictEqual(valueFamilyForFilter('created/after/today'), 'configurable:created');
			const expression = parseCollectionExpression(['updated/after/today']);
			const sameFamily = completionValences(node('updated/after/7-days-ago'), expression, { idPrefix: 'x' });
			assert.strictEqual(sameFamily.find(valence => valence.kind === 'or').compatible, true);
			const otherFamily = completionValences(node('created/after/today'), expression, { idPrefix: 'x' });
			assert.strictEqual(otherFamily.find(valence => valence.kind === 'or').compatible, false);
		});

		it('refuses to grow an or inside a clause it could not model', () => {
			//A manual node is text this layer preserved verbatim; widening it would
			//mean rewriting a spelling it said it did not understand.
			const expression = parseCollectionExpression(['expand/starred/link']);
			assert.strictEqual(expression[0].kind, 'manual');
			const valences = completionValences(node('tag-b'), expression, { idPrefix: 'x' });
			assert.deepStrictEqual(valences.map(valence => valence.kind), ['add', 'not']);
		});

		it('offers no row that would change nothing', () => {
			//`a AND a` is `a`, and `(a or a)` is `a`. Both were offered before this
			//guard, which is complaint #9's dead affordance wearing a count.
			const expression = parseCollectionExpression(['tag-b']);
			const valences = completionValences(node('tag-b'), expression, {
				idPrefix: 'x',
				candidates: candidates(),
			});
			//The negation survives: `a AND NOT a` really is a different collection,
			//and its preview count says so honestly.
			assert.deepStrictEqual(valences.map(valence => valence.kind), ['not']);

			//Same rule, one level down, but ONLY for the or: widening
			//`(tag-b or tag-c)` with `tag-c` changes only the spelling. Appending
			//it as a new condition is a different matter — `(b or c) AND c` really
			//is `c`, a narrowing — so `add` survives and only `or` is suppressed.
			const group = parseCollectionExpression(['tag-b+tag-c']);
			const inGroup = completionValences(node('tag-c'), group, {
				idPrefix: 'y',
				candidates: candidates(),
			});
			assert.deepStrictEqual(inGroup.map(valence => valence.kind), ['add', 'not']);

			//And a genuinely new member still widens the group.
			const fresh = completionValences(node('notes-section'), group, {
				idPrefix: 'z',
				candidates: candidates(),
			});
			assert.ok(fresh.some(valence => valence.kind === 'or'));
		});

		it('promotes not to the top when the user led with a negation', () => {
			const result = complete('not published');
			const row = result.find(candidate => candidate.filter === 'published');
			assert.strictEqual(row.valences[0].kind, 'not',
				`a typed negation must lead with the negation: ${row.valences.map(valence => valence.kind).join(', ')}`);
			//And add is still offered — the user may have been typing toward the
			//plain clause.
			assert.ok(row.valences.some(valence => valence.kind === 'add'));
		});

		it('names the flip with the app’s own word when it has one', () => {
			const valences = completionValences(node('published'), [], { idPrefix: 'x' });
			const not = valences.find(valence => valence.kind === 'not');
			//Convergence 2: the pill reads `unpublished`, not `not published`.
			assert.strictEqual(not.label, 'Unpublished');
			assert.deepStrictEqual(filtersForValence(not), ['unpublished']);
		});

		//THE EDITS COMPILE TO THE ENGINE'S OWN SPELLINGS (proposal C §3):
		//AND = segments, plain OR-group = `b+c`, flipped simple pill = the inverse
		//name or `exclude/d`.
		describe('the edits produce the engine’s spellings', () => {
			it('authors a AND (b OR c) AND NOT d by choosing rows', () => {
				//Exactly the keyboard flow proposal B §3.1 and proposal C §3
				//describe: type a, add; type b, add; type c, take the “or” row;
				//type d, take the “not” row.
				let expression = [];
				const take = (filter, kind) => {
					const valences = completionValences({ kind: 'filter', filter }, expression, {
						idPrefix: filter,
						candidates: candidates(),
					});
					const valence = valences.find(entry => entry.kind === kind);
					assert.ok(valence, `no ${kind} valence for ${filter}`);
					expression = valence.expression;
				};
				take('starred', 'add');
				take('tag-b', 'add');
				take('tag-c', 'or');
				//`query/systems` has no named inverse, so this is the branch of
				//proposal C §3 that reaches for the engine's exclude wrapper. The
				//other branch — a filter whose opposite the app has a WORD for —
				//is asserted separately below.
				take('query/systems', 'not');
				assert.deepStrictEqual(serializeCollectionExpression(expression), [
					'starred',
					//A plain union of single-token members is the short form.
					'tag-b+tag-c',
					'exclude/query/systems',
				]);
			});

			it('spells a flip as the app’s inverse name when there is one', () => {
				let expression = parseCollectionExpression(['tag-b']);
				const valences = completionValences({ kind: 'filter', filter: 'published' }, expression, { idPrefix: 'p' });
				expression = valences.find(valence => valence.kind === 'not').expression;
				assert.deepStrictEqual(serializeCollectionExpression(expression), ['tag-b', 'unpublished']);
			});

			it('spells an or over a configurable member as combine', () => {
				//`a+b` is only legal for single-token members, so an OR that
				//involves a multi-part clause has to become `combine/`.
				const expression = parseCollectionExpression(['updated/after/today']);
				const valences = completionValences(
					{ kind: 'filter', filter: 'created/after/today' },
					expression,
					{ idPrefix: 'c' }
				);
				const or = valences.find(valence => valence.kind === 'or');
				assert.deepStrictEqual(filtersForValence(or), ['combine/updated/after/today/created/after/today']);
			});

			it('leaves the input expression untouched', () => {
				const expression = parseCollectionExpression(['tag-b']);
				const before = serializeCollectionExpression(expression);
				completionValences({ kind: 'filter', filter: 'tag-c' }, expression, { idPrefix: 'x' });
				assert.deepStrictEqual(serializeCollectionExpression(expression), before);
			});
		});

		it('gives every valence a stable id that does not carry the query', () => {
			const first = complete('published').find(candidate => candidate.filter === 'published');
			const second = complete('publ').find(candidate => candidate.filter === 'published');
			assert.strictEqual(first.id, second.id, 'a candidate id must survive a keystroke');
			assert.deepStrictEqual(
				first.valences.map(valence => valence.id),
				second.valences.map(valence => valence.id),
				'a valence id must survive a keystroke, or its preview count cannot be cached'
			);
		});
	});

	describe('the idle contract', () => {
		const idleContext = () => ({
			filterDescriptions: CARD_FILTER_DESCRIPTIONS,
			candidates: candidates(),
			recentCollections: [
				{ description: draft('everything/tag-b/'), visits: 4 },
				{ description: draft('everything/tag-c/'), visits: 2 },
			],
			activeCollection: draft('main/'),
		});

		it('returns recents plus at most three contextual rows', () => {
			const rows = collectionCompletionIdleRows(draft('everything/starred/'), idleContext());
			assert.ok(rows.recents.length, 'recents are the first content of the first gesture');
			assert.ok(rows.recents.every(row => row.kind === 'recent'));
			assert.strictEqual(rows.contextual.length, IDLE_CONTEXTUAL_ROW_LIMIT);
			assert.ok(rows.contextual.every(row => row.kind !== 'recent'));
		});

		it('is deterministic across two calls', () => {
			const identity = result => [
				...result.recents.map(row => row.id),
				'--',
				...result.contextual.map(row => row.id),
			];
			const first = collectionCompletionIdleRows(draft('everything/starred/'), idleContext());
			const second = collectionCompletionIdleRows(draft('everything/starred/'), idleContext());
			assert.deepStrictEqual(identity(first), identity(second));
		});

		it('dedupes against the draft and the collection on screen', () => {
			//Neither the collection being composed nor the one already on screen is
			//a destination, and the existing dedupe machinery is what enforces it —
			//this asserts the idle path actually runs through it.
			const context = idleContext();
			context.activeCollection = draft('everything/tag-b/');
			const rows = collectionCompletionIdleRows(draft('everything/tag-c/'), context);
			const destinations = rows.recents.map(row => row.description.serialize());
			assert.ok(!destinations.includes(draft('everything/tag-b/').serialize()),
				'the collection on screen is not a destination');
			assert.ok(!destinations.includes(draft('everything/tag-c/').serialize()),
				'the draft being composed is not a destination');
		});

		it('offers no duplicate destination across the whole idle list', () => {
			const rows = collectionCompletionIdleRows(draft('everything/starred/'), idleContext());
			const destinations = [...rows.recents, ...rows.contextual]
				.filter(row => !row.configureFilter && !row.sourceFilter)
				.map(row => row.description.serialize());
			assert.strictEqual(new Set(destinations).size, destinations.length,
				`two idle rows offer the same collection: ${destinations.join(' | ')}`);
		});
	});
});

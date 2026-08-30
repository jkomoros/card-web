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
let collectionFilterDescription;
let paletteTypingRows;
let paletteIdleRows;
let paletteWordRows;
let VOCABULARY_SECTION;

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
		({ collectionFilterDescription } = await import('../../lib/src/collection-composer-suggestions.js'));
		({ paletteTypingRows, paletteIdleRows, paletteWordRows, VOCABULARY_SECTION } = await import('../../lib/src/collection-palette-rows.js'));
	});

	//THE FREE-TEXT READING IS ALWAYS AVAILABLE, so the tier tests below exclude
	//it: it is not a NAME match and it is deliberately in the `guess` tier — the
	//ranked floor, by arithmetic, under every real one. It has its own pins
	//further down.
	const isFreeText = (candidate) => Boolean(candidate.filter && candidate.filter.startsWith('query/'));

	describe('matching tiers', () => {
		//THE TIER ORDER, asserted on one token against four candidates built to
		//match at exactly one tier each. Anything that reorders the tiers reorders
		//this list.
		//THE TIER ORDER, ROUND 2. `fuzzy` split into two tiers that were doing
		//two different jobs under one name: a bounded edit-distance TYPO hit
		//(evidence the user meant that NAME and mistyped it) now sits ABOVE the
		//description tier, and the subsequence fallback — the letters appear in
		//order, which long names satisfy by accident — became `structural` and
		//stayed at the bottom. The owner's metric is arrow-downs, and a
		//transposed letter used to cost the whole ranking.
		it('ranks name over alias over typo over description over structural', () => {
			const world = [
				//name-exact
				{ filter: 'zebra', category: 'tag', label: 'zebra', detail: 'nothing relevant here' },
				//alias: the name does not contain the token, a search word does
				{ filter: 'aardvark', category: 'tag', label: 'Aardvark', detail: 'nothing relevant here', aliases: ['zebra stripes'] },
				//typo: one transposition away from the typed token
				{ filter: 'zerba-crossing', category: 'tag', label: 'Zerba', detail: 'nothing relevant here' },
				//description: the token is a word in the prose only
				{ filter: 'bison', category: 'tag', label: 'Bison', detail: 'A herd of zebra graze nearby' },
				//structural: z-e-b-r-a appear in order, close together, and at no
				//better tier — no word of the name starts with 'zebra' and it is
				//more than two edits away
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
				result.filter(candidate => !isFreeText(candidate)).map(candidate => [candidate.filter, candidate.tier]),
				[
					['zebra', 'name-exact'],
					['aardvark', 'alias'],
					['zerba-crossing', 'typo'],
					['bison', 'description'],
					['zebu-barn', 'structural'],
				]
			);
			//AND THE GUESS IS THE FLOOR, always, under every one of them.
			assert.strictEqual(result[result.length - 1].tier, 'guess');
			assert.ok(isFreeText(result[result.length - 1]));
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
			assert.deepStrictEqual(
				result.filter(candidate => !isFreeText(candidate)).map(candidate => candidate.filter),
				['leading', 'inner']
			);
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
			assert.deepStrictEqual(
				result.filter(candidate => candidate.filter && !isFreeText(candidate)).map(candidate => candidate.filter),
				[]
			);
			//The rows that DO come back are sentence words whose own names begin
			//with the token — 'Original Order', 'Tweet Order'. Those are name
			//matches, not prose matches, which is exactly the distinction this
			//test exists to keep: 'or' reaches a thing called Order and does not
			//reach a thing merely described as 'authored and colored'.
			assert.ok(result.every(candidate => candidate.kind === 'sort' || isFreeText(candidate)),
				`prose matched something it should not have: ${result.map(candidate => candidate.id).join(', ')}`);
		});

		//WHATEVER ELSE THEY MEANT, THEY MEANT THE WORDS THEY TYPED. Without this
		//row a token that matches no name at all produces an empty list, and the
		//typed-token spine the whole design rests on has a hole in it.
		it('always offers the literal reading of the token, under every name match', () => {
			const world = [{ filter: 'starred', category: 'tag', label: 'Starred', detail: '' }];
			const named = collectionCompletionCandidates({
				token: 'star',
				expression: [],
				description: draft(),
				context: { candidates: world, filterDescriptions: {} },
				limit: 20,
			});
			const freeText = named.find(isFreeText);
			assert.ok(freeText, 'the literal reading is offered');
			assert.strictEqual(freeText.filter, 'query/star');
			assert.ok(named.indexOf(freeText) > named.findIndex(candidate => candidate.filter === 'starred'),
				'a user who typed "star" meant Starred; the literal reading is the fallback');
			assert.ok(freeText.valences.some(valence => valence.kind === 'add'),
				'and it is a clause like any other, with its own valences');

			//A token no name matches still produces a row.
			const unmatched = collectionCompletionCandidates({
				token: 'quixotic phrasing',
				expression: [],
				description: draft(),
				context: { candidates: world, filterDescriptions: {} },
				limit: 20,
			});
			assert.deepStrictEqual(unmatched.map(candidate => candidate.filter), ['query/quixotic phrasing']);
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
			assert.ok(row.valences.some(valence => valence.kind === 'add'),
				'the family must be addable from the word that found it');
			//THE NEGATION IS NOT ISSUED UNASKED (see the valence tests below): a
			//bare token gets the clause, and the flip is one gesture away on the
			//pill it produces. Typed AS a negation, the row is the negation.
			const negated = complete('not stale')
				.find(candidate => candidate.filter.split('/')[0] === 'updated');
			assert.ok(negated.valences.some(valence => valence.kind === 'not'),
				'a typed negation must be able to become one');
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

		it('never offers the engine’s boolean plumbing as a clause', () => {
			//"Never exclude, combine, not, or invert as UI nouns" (proposal C §3).
			//The engineering reason is sharper than the style one: a configurable
			//family is offered spelled with its own defaults, and these three
			//default to placeholders — `exclude/all-cards` excludes everything, so
			//the row would silently empty the collection while showing a count.
			for (const token of ['exclude', 'combine', 'expand', 'either', 'invert']) {
				const rows = complete(token).filter(candidate =>
					['combine', 'exclude', 'expand'].includes((candidate.filter || '').split('/')[0]));
				//AS A CLAUSE, never. Their defaults are placeholders —
				//`exclude/all-cards` empties the collection — so a row that ADDED
				//one would carry a count that lies about what choosing it does.
				assert.deepStrictEqual(rows.filter(row => row.valences.length).map(row => row.id), [],
					`typing “${token}” offered the plumbing as a clause`);
				//AS A ROUTE INTO SOURCE, yes, and this is a round-2 addition
				//rather than a relaxation. The vocabulary is supposed to be
				//complete, and these three used to be reachable only through the
				//deleted `Browse all filters` feed — so deleting that feed
				//without this would have deleted them from the product. They
				//still never appear as UI nouns: the only way to this row is to
				//type the word yourself.
				for (const row of rows) {
					assert.ok(row.sourceFilter, `${row.id} must be a Source route, not a clause`);
					assert.deepStrictEqual(row.valences, []);
					assert.strictEqual(row.description, undefined, 'and it promises no collection');
				}
			}
			//They are still reachable as what they actually are: the valences.
			const published = complete('not published').find(candidate => candidate.filter === 'published');
			assert.ok(published.valences.some(valence => valence.kind === 'not'));
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

		//THE NOT-ROW IS ASKED FOR, NOT ISSUED WITH EVERY CANDIDATE.
		//
		//It used to spawn unconditionally, which doubled every typed list — four
		//rows for two collections when a filter and its named inverse both
		//matched the token. The design's own rule is narrower: proposal B §3.1
		//ranks `–` below "unless the token starts with not/-", and the
		//meta-proposal's Graft 1 scopes the valence graft to "when a typed token
		//is family-compatible with an existing pill". Everywhere else the flip is
		//one gesture away on the pill the `add` produces.
		it('offers only add against an empty sentence — no or, and no unasked not', () => {
			const valences = completionValences(node('tag-b'), [], { idPrefix: 'x', candidates: candidates() });
			assert.deepStrictEqual(valences.map(valence => valence.kind), ['add']);
		});

		it('offers not when the typed token led with a negation', () => {
			const valences = completionValences(node('tag-b'), [], { idPrefix: 'x', negated: true, candidates: candidates() });
			assert.deepStrictEqual(valences.map(valence => valence.kind), ['not', 'add'],
				'a typed negation leads with the negation');
		});

		it('offers not when the sentence already has a clause of the same family', () => {
			//"…but not this one" is a sentence somebody is plausibly in the middle
			//of writing only once there is a same-family clause to say it about.
			const sameFamily = parseCollectionExpression(['tag-c']);
			assert.ok(completionValences(node('tag-b'), sameFamily, { idPrefix: 'x', candidates: candidates() })
				.some(valence => valence.kind === 'not'));
			const otherFamily = parseCollectionExpression(['notes-section']);
			assert.ok(!completionValences(node('tag-b'), otherFamily, { idPrefix: 'x', candidates: candidates() })
				.some(valence => valence.kind === 'not'));
		});

		//THE NEGATED ROW DESCRIBES THE NEGATED COLLECTION. Every valence used to
		//inherit the candidate's one description, so the flipped row read
		//"Unpublished — Keeps cards you have published": a row whose name and
		//whose explanation say opposite things.
		it('gives the not row its own description', () => {
			const valences = completionValences(node('published'), parseCollectionExpression(['unread']), {
				idPrefix: 'x',
				negated: true,
				filterDescriptions: CARD_FILTER_DESCRIPTIONS,
			});
			const not = valences.find(valence => valence.kind === 'not');
			assert.ok(not.detail, 'a negation must say what IT keeps');
			assert.notStrictEqual(not.detail, collectionFilterDescription('published', CARD_FILTER_DESCRIPTIONS),
				'and it must not be the positive clause’s sentence');
			//A filter with no named inverse gets the derived negative rather than
			//nothing at all.
			const derived = completionValences(node('tag-b'), [], {
				idPrefix: 'y',
				negated: true,
				labels: { 'tag-b': 'Tagged Systems' },
				candidates: candidates(),
			}).find(valence => valence.kind === 'not');
			assert.strictEqual(derived.detail, 'Cards not matching Tagged Systems');
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
			//Typed as a negation so the `not` row this is ranked against exists
			//at all — see the not-is-asked-for tests above.
			const expression = parseCollectionExpression(['notes-section']);
			const valences = completionValences(node('tag-b'), expression, {
				idPrefix: 'x',
				negated: true,
				candidates: candidates(),
			});
			assert.deepStrictEqual(valences.map(valence => valence.kind), ['not', 'add', 'or']);
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
			const valences = completionValences(node('tag-b'), expression, { idPrefix: 'x', negated: true });
			assert.deepStrictEqual(valences.map(valence => valence.kind), ['not', 'add']);
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
			const valences = completionValences(node('published'), [], { idPrefix: 'x', negated: true });
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
						//A `not` row exists when the user asked for one, so the
						//keyboard flow this pins types the negation as a negation
						//— which is exactly what proposal B §3.1's own "unless the
						//token starts with not/-" describes.
						negated: kind === 'not',
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
				const valences = completionValences({ kind: 'filter', filter: 'published' }, expression, { idPrefix: 'p', negated: true });
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

	//THE RANKING TRAPS THE LIVE CRITIQUE WALKED INTO. Each of these is a row
	//that led the list while being the wrong answer to what was typed.
	describe('ranking', () => {

		it('caps weak-match recents to one, and never caps a name match', () => {
			//A generic token matches every recent whose DETAIL line happens to
			//contain the word. Three destinations then sat above the first actual
			//interpretation of what was typed — the critique found some of them
			//zero-card junk. A name-tier match is evidence; a description match
			//is not.
			const weak = complete('visited', 'everything/', {
				recentCollections: [
					{ description: draft('everything/tag-b/'), visits: 3 },
					{ description: draft('everything/tag-c/'), visits: 2 },
					{ description: draft('everything/starred/'), visits: 5 },
				],
			});
			assert.strictEqual(weak.filter(candidate => candidate.kind === 'recent').length, 1,
				`a weak token may lead with one recent: ${weak.map(item => item.id).join(', ')}`);

			//The same three recents, reached by a word that is in their NAMES.
			const named = complete('tagged', 'everything/', {
				recentCollections: [
					{ description: draft('everything/tag-b/'), visits: 3 },
					{ description: draft('everything/tag-c/'), visits: 2 },
				],
			});
			assert.ok(named.filter(candidate => candidate.kind === 'recent').length >= 2,
				'a name match is evidence, and every one of those is offered');
		});

		it('reads a pasted collection path as the collection it names', () => {
			//A URL is a feature of this product — every collection IS one — and
			//pasting the composer's own compiled path came back as
			//`Text contains "/c/main/starred/"`.
			const rows = complete('/c/everything/starred/');
			assert.strictEqual(rows[0].kind, 'source',
				`a parsed source outranks every guess: ${rows.map(item => `${item.kind}:${item.id}`).join(', ')}`);
			assert.strictEqual(rows[0].description.serialize(), draft('everything/starred/').serialize());
			assert.ok(rows[0].destinationPath, 'and it carries the path it opens');
			assert.deepStrictEqual(rows[0].valences, [], 'a destination is not an edit');
			//Text that is not a collection is still read literally.
			assert.ok(!complete('systems thinking').some(candidate => candidate.kind === 'source'));
		});
	});

	//WHAT THE PALETTE ACTUALLY RENDERS. The rows are where two candidates that
	//mean the same edit become one row, and where the browse feed's ranking
	//either survives its regrouping or does not.
	describe('the palette rows', () => {

		const typedRows = (token, serialized = 'everything/') => paletteTypingRows(
			complete(token, serialized),
			draft(serialized)
		);

		it('offers one row per RESULTING EDIT, not one per candidate', () => {
			//`published` and `unpublished` are both real filters, both match the
			//token, and each can be added or flipped: four rows naming two
			//collections, with the twins carrying contradictory descriptions.
			const rows = typedRows('published', 'everything/unread/');
			const edits = rows.filter(row => row.kind === 'valence').map(row => row.description.serialize());
			assert.strictEqual(new Set(edits).size, edits.length,
				`two rows make the same edit: ${edits.join(' | ')}`);
		});

		it('carries the negated row’s own description onto the row', () => {
			const rows = typedRows('not published', 'everything/unread/');
			const not = rows.find(row => row.valenceKind === 'not');
			assert.ok(not, 'a typed negation produces a negated row');
			assert.notStrictEqual(not.detail, collectionFilterDescription('published', CARD_FILTER_DESCRIPTIONS),
				'the negated row must not explain itself with the positive clause’s sentence');
		});

		//SUPERSEDED PIN (D1). This used to assert that the `Browse all filters`
		//feed's category regrouping preserved the catalog's match ranking. That
		//feed is deleted — the one list contains the whole vocabulary, so there
		//is nothing to browse TO — and with it went paletteBrowseRows and the
		//category walls it grouped by.
		//
		//What replaced it is asserted here instead: the idle list IS the
		//vocabulary, it arrives through the same scoring function as the typed
		//list (an empty token, matching everything at the `vocabulary` tier),
		//and it carries ONE section rather than a wall per category.
		it('puts the whole vocabulary in one ranked run when nothing is typed', () => {
			const idle = collectionCompletionCandidates({
				token: '',
				expression: [],
				description: draft('everything/'),
				context: { candidates: candidates(), filterDescriptions: CARD_FILTER_DESCRIPTIONS },
				//THE CALLER ASKS FOR THE WHOLE VOCABULARY EXPLICITLY. "The list
				//IS browse-all" is a decision the palette makes, so the default
				//limit stays what the typed list wants.
				limit: 1000,
			});
			assert.ok(idle.length > 100, `the idle list is the whole vocabulary: ${idle.length} rows`);
			assert.ok(idle.every(candidate => candidate.tier === 'vocabulary'),
				'with nothing typed, nothing is a better or worse MATCH — only a more or less likely pick');
			//Every family of thing is in it.
			const kinds = new Set(idle.map(candidate => candidate.kind));
			for (const kind of ['value', 'filter', 'filter-family', 'set', 'sort']) {
				assert.ok(kinds.has(kind), `the idle list is missing every ${kind}: ${[...kinds].join(', ')}`);
			}
			//And no free-text guess: there is no text to guess about. (The query
			//FAMILY is in the list, spelled with its own default — that is a
			//family row like any other, not the guess-tier fallback.)
			assert.ok(!idle.some(candidate => candidate.tier === 'guess'),
				'nothing typed means nothing to search for');
			//ONE SECTION, NOT A WALL PER CATEGORY.
			const rows = paletteIdleRows([], [], paletteTypingRows(idle, draft('everything/')));
			assert.deepStrictEqual([...new Set(rows.map(row => row.section))], [VOCABULARY_SECTION]);
			assert.ok(rows.some(row => row.annotation === 'tag'),
				'the category survives as a quiet annotation on the row');
		});

		it('marks the sort and view already in force rather than deleting them', () => {
			const rows = paletteWordRows(draft('everything/sort/recent/'), 'sort');
			const current = rows.find(row => row.current);
			assert.ok(current, 'a list of alternatives has to say which one you are in');
			assert.strictEqual(current.id, 'sort:recent');
			assert.strictEqual(rows.filter(row => row.current).length, 2,
				'one current sort and one current view');
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

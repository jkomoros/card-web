/*eslint-env node, es2022*/

//THE ACCEPTANCE GATE FOR THE COMPLETION MODEL THE OWNER'S ROUND-2 FEEDBACK ASKED
//FOR.
//
//The palette's own list is pinned next door (test/collection-completion-index);
//this file pins the four pure pieces the ranking is built out of, each of which
//is a claim about behaviour that reading the code cannot verify:
//
//  1. THE TYPO TIER. A behaviour TABLE, not a spot check: the bound is
//     length-dependent (never at 2 chars, one edit at 3-5, two at 6+) and
//     transpositions cost one, and every one of those boundaries is a decision
//     somebody could quietly change while the code still "works".
//  2. THE DESCRIPTION TIER'S TF-IDF. That a common stem is worth ~nothing and a
//     rare one carries the match is the whole reason the tier was rebuilt; it is
//     also invisible unless asserted, because both cases still "match".
//  3. THE DATE GRAMMAR. A fixture table over the phrases people actually type,
//     asserting the exact clause each compiles to, against a FROZEN reference
//     date so 'this month' is a specification and not a moving target.
//  4. THE PERSONAL-USAGE STORE. Frequency and recency in one decayed number,
//     scoped per uid, and never throwing.
//
//And then the metric itself: THE ARROW-DOWNS FIXTURE. The owner stated the goal
//as an interaction cost — "minimize arrow-downs: type characters, hit Enter as
//soon as the top one matches" — so it is asserted as one. Each row is a typed
//token and the candidate the user meant; the assertion is that the intended one
//is first, or at worst second.

import { JSDOM } from 'jsdom';
import assert from 'assert';

const dom = new JSDOM('', {url: 'https://localhost/'});
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
let parseCollectionExpression;
let CARD_FILTER_DESCRIPTIONS;
let boundedDamerauLevenshtein;
let tokenIsTypoOf;
let typoBudgetForToken;
let buildCompletionIDFIndex;
let completionDescriptionScore;
let completionStems;
let parseCollectionDatePhrase;
let collectionDatePhraseFilters;
let completionUsageWeights;
let recordCompletionAcceptance;
let readStickyComposerSet;
let recordStickyComposerSet;
let collectionDescriptionWithStickyStart;
let DEFAULT_STICKY_SET;
let USAGE_HALF_LIFE_MS;

//A SMALL CORPUS WITH REAL SHAPE. Two tags, a section, a person: enough that a
//tag/tag OR is expressible, that a stem can be common ('cards') or rare
//('epistemology'), and that the corpus-fit term has something to rank.
const candidates = () => [
	{
		filter: 'tag-systems',
		category: 'tag',
		label: 'Tagged “Systems”',
		detail: 'Keeps cards tagged Systems',
		aliases: ['tag-systems', 'Systems', 'tag', 'tagged'],
		corpusCount: 400,
	},
	{
		filter: 'tag-complexity',
		category: 'tag',
		label: 'Tagged “Complexity”',
		detail: 'Keeps cards tagged Complexity',
		aliases: ['tag-complexity', 'Complexity', 'tag', 'tagged'],
		corpusCount: 3,
	},
	{
		filter: 'notes-section',
		category: 'section',
		label: 'In section “Notes”',
		detail: 'Keeps cards in the Notes section',
		aliases: ['notes-section', 'Notes', 'section'],
		corpusCount: 120,
	},
].map(candidate => ({
	...candidate,
	searchValues: [candidate.label, candidate.filter, candidate.category, ...(candidate.aliases || [])].map(value => value.toLowerCase()),
}));

const draft = (serialized = 'everything/') => CollectionDescription.deserialize(serialized);

//The tiers at which a token genuinely NAMED a candidate. Spelled here rather
//than imported so the test states the boundary in its own words: if the engine
//moves the line, this file has to be edited on purpose.
const NAME_ISH = new Set(['parsed', 'name-exact', 'name-prefix', 'alias', 'typo']);

const complete = (token, serialized = 'everything/', extra = {}) => collectionCompletionCandidates({
	token,
	expression: parseCollectionExpression(draft(serialized).filters),
	description: draft(serialized),
	context: {
		candidates: candidates(),
		filterDescriptions: CARD_FILTER_DESCRIPTIONS,
		...extra,
	},
	limit: 40,
});

describe('Collection completion model', () => {
	before(async () => {
		({ CollectionDescription } = await import('../../lib/src/collection_description.js'));
		({ collectionCompletionCandidates } = await import('../../lib/src/collection-completion-index.js'));
		({ parseCollectionExpression } = await import('../../lib/src/collection-expression.js'));
		({ CARD_FILTER_DESCRIPTIONS } = await import('../../lib/src/filters.js'));
		({ boundedDamerauLevenshtein, tokenIsTypoOf, typoBudgetForToken } = await import('../../lib/src/collection-completion-typos.js'));
		({ buildCompletionIDFIndex, completionDescriptionScore, completionStems } = await import('../../lib/src/collection-completion-idf.js'));
		({ parseCollectionDatePhrase, collectionDatePhraseFilters } = await import('../../lib/src/collection-date-phrases.js'));
		({
			completionUsageWeights,
			recordCompletionAcceptance,
			readStickyComposerSet,
			recordStickyComposerSet,
			collectionDescriptionWithStickyStart,
			DEFAULT_STICKY_SET,
			USAGE_HALF_LIFE_MS,
		} = await import('../../lib/src/collection-composer-usage.js'));
	});

	//--- 1. The typo tier ---------------------------------------------------

	describe('the typo tier', () => {

		//THE DISTANCE FUNCTION ITSELF, including the one property plain
		//Levenshtein does not have.
		it('charges one edit for a transposition, not two', () => {
			assert.strictEqual(boundedDamerauLevenshtein('starred', 'starrde', 2), 1);
			assert.strictEqual(boundedDamerauLevenshtein('updated', 'updaetd', 2), 1);
			assert.strictEqual(boundedDamerauLevenshtein('section', 'setcion', 2), 1,
				'se[ct]ion -> se[tc]ion is one adjacent transposition, which plain Levenshtein would charge two for');
			assert.strictEqual(boundedDamerauLevenshtein('filter', 'fliter', 1), 1,
				'and so is fi[lt]er -> fl[il]... — adjacent, one edit, inside a 6-char budget of two');
			assert.strictEqual(boundedDamerauLevenshtein('abc', 'abc', 1), 0);
		});

		//AN OUT-OF-BUDGET ANSWER IS `maximum + 1`, NOT THE TRUE DISTANCE. The
		//caller only ever asks "within budget?", and computing an exact value
		//nobody reads is work spent for nothing — so the early exits are allowed
		//to be lossy above the bound, and are pinned as such.
		it('reports over-budget rather than the exact distance', () => {
			assert.strictEqual(boundedDamerauLevenshtein('starred', 'quixotic', 2), 3);
			assert.strictEqual(boundedDamerauLevenshtein('a', 'abcdefgh', 1), 2);
			assert.ok(boundedDamerauLevenshtein('starred', 'starred!!!!!', 2) > 2);
		});

		//THE BUDGET TABLE. Every row here is a boundary somebody could move.
		it('budgets by the TYPED token’s length', () => {
			const table = [
				['', 0],
				['a', 0],
				['or', 0],
				['tag', 1],
				['tags', 1],
				['stars', 1],
				['starred', 2],
				['epistemology', 2],
			];
			for (const [token, budget] of table) {
				assert.strictEqual(typoBudgetForToken(token), budget, `budget for “${token}”`);
			}
		});

		//THE BEHAVIOUR TABLE the design describes in prose, asserted. Each row is
		//(typed, candidate, is-a-typo-of) with the reason in the comment.
		it('fires exactly where the design says it fires', () => {
			const table = [
				//3-5 chars: one edit.
				['tgs', 'tag', false, 'two edits at three characters is over budget'],
				['tsg', 'tag', true, 'one transposition at three characters'],
				['stra', 'star', true, 'one transposition'],
				['strae', 'star', false, 'a transposition plus an insertion is two, over the 5-char budget'],
				//6+ chars: two edits.
				['starrde', 'starred', true, 'one transposition'],
				['staarred', 'starred', true, 'one insertion'],
				['staared', 'starred', true, 'one insertion and one substitution is two'],
				['quixotic', 'starred', false, 'not remotely the same word'],
				//NEVER at two characters or fewer: at that length every short word
				//is one edit from every other one, and a tier that fires there is
				//noise with a spellchecker's reputation.
				['or', 'on', false, 'two characters never fire'],
				['or', 'of', false, 'two characters never fire'],
				['a', 'b', false, 'one character never fires'],
				//A PREFIX IS A HIGHER TIER'S BUSINESS. Claiming it here would let
				//a name-prefix match arrive labelled 'typo'.
				['star', 'starred', false, 'a prefix is name-prefix, not a typo'],
				['starred', 'starred', false, 'an exact match is name-exact, not a typo'],
			];
			for (const [token, candidate, expected, why] of table) {
				assert.strictEqual(tokenIsTypoOf(token, candidate), expected,
					`“${token}” vs “${candidate}”: ${why}`);
			}
		});

		//AND THE TIER IN CONTEXT: a misspelled NAME beats a description hit.
		it('ranks a fuzzy name above any description hit', () => {
			const world = [
				//The typo target.
				{ filter: 'starred-tag', category: 'tag', label: 'Starred', detail: 'nothing relevant' },
				//A description that genuinely contains the typed word.
				{ filter: 'astronomy', category: 'tag', label: 'Astronomy', detail: 'Cards about staarred constellations' },
			].map(candidate => ({...candidate, searchValues: [candidate.label.toLowerCase()]}));
			const result = collectionCompletionCandidates({
				token: 'staarred',
				expression: [],
				description: draft(),
				context: { candidates: world, filterDescriptions: {} },
				limit: 20,
			});
			assert.strictEqual(result[0].filter, 'starred-tag',
				`a mistyped name outranks a prose hit: ${result.map(row => `${row.filter}:${row.tier}`).join(', ')}`);
			assert.strictEqual(result[0].tier, 'typo');
		});

		//DETERMINISM: the same inputs give the same order, twice.
		it('is deterministic', () => {
			const once = complete('staarred').map(row => row.id);
			const twice = complete('staarred').map(row => row.id);
			assert.deepStrictEqual(once, twice);
		});
	});

	//--- 2. The description tier's TF-IDF -----------------------------------

	describe('the description tier', () => {

		//THE HOUSE STEMMER, REUSED. 'updating' and 'updated' are one term here
		//because they are one term everywhere else in this app.
		it('stems with the app’s own pipeline', () => {
			assert.deepStrictEqual(completionStems('Updating'), completionStems('updated'));
			assert.deepStrictEqual(completionStems('cards and the tags'), ['card', 'tag'],
				'stop words are dropped, and what is left is stemmed');
		});

		it('weighs a rare stem and ignores a common one', () => {
			//Ten documents. 'card' is in all of them; 'epistemology' is in one.
			const documents = [];
			for (let index = 0; index < 10; index++) {
				documents.push({
					id: `doc-${index}`,
					text: index === 0 ? 'Cards about epistemology' : 'Cards about something ordinary',
				});
			}
			const index = buildCompletionIDFIndex(documents);
			assert.strictEqual(index.documentCount, 10);
			const commonStem = completionStems('cards');
			const rareStem = completionStems('epistemology');
			assert.strictEqual(completionDescriptionScore(index, 'doc-0', commonStem), 0,
				'a stem in every document weighs nothing — this is the “or matched every sort” defect, priced out');
			assert.ok(completionDescriptionScore(index, 'doc-0', rareStem) > 0.5,
				'and a stem in one document carries the match');
		});

		//A REPEATED ID IS ONE DOCUMENT. Counting a candidate twice would quietly
		//halve the IDF of every word it contains.
		it('counts one candidate once', () => {
			const index = buildCompletionIDFIndex([
				{id: 'a', text: 'epistemology'},
				{id: 'a', text: 'epistemology'},
				{id: 'b', text: 'ordinary'},
			]);
			assert.strictEqual(index.documentCount, 2);
		});

		//THE TIER FIRES ON PRESENCE AND RANKS ON RARITY. These are two questions
		//and conflating them was a real bug: a token whose stems are all common
		//produced an EMPTY list rather than a low-ranked one.
		it('still matches on a common word, at the bottom of its tier', () => {
			const result = complete('epistemology', 'everything/', {
				tagInfos: {
					'tag-systems': { id: 'tag-systems', title: 'Systems', description: 'Cards about epistemology and how we know things' },
				},
			});
			const row = result.find(candidate => candidate.filter === 'tag-systems');
			assert.ok(row, 'a tag is findable by the words of its own description');
			assert.strictEqual(row.tier, 'description');
			assert.strictEqual(row.matchedOn, 'epistemology',
				'and it says WHY in the user’s own word, not in the stem');
		});
	});

	//--- 3. The date grammar ------------------------------------------------

	describe('the date phrase grammar', () => {

		//A FROZEN REFERENCE DATE, so a calendar-anchored phrase is a fixture
		//rather than an observation. 2026-08-30, a Sunday.
		const NOW = new Date(2026, 7, 30, 13, 45);

		//THE FIXTURE TABLE. Left: what somebody types. Right: the clause tail it
		//compiles to, and the families it offers.
		//
		//ROUND 3, D4: "NUMBERS AND UNITS ARE ALWAYS BOUND FROM THE INPUT, never
		//defaulted". The rows marked below are the ones that used to REFUSE —
		//'created since 5 days ago' had its 5 written down in the input and no
		//production that could read it, so the phrase fell all the way to `Text
		//contains "since 5 days ago"`, a search of card prose for the word
		//'days'. MOMENT now carries `COUNT UNIT ago?` outright.
		const table = [
			['last 7 days', 'after/7-days-ago', ['updated', 'created']],
			['in the last 7 days', 'after/7-days-ago', ['updated', 'created']],
			['past week', 'after/7-days-ago', ['updated', 'created']],
			['last week', 'after/7-days-ago', ['updated', 'created']],
			['last 2 weeks', 'after/14-days-ago', ['updated', 'created']],
			['last 3 months', 'after/3-months-ago', ['updated', 'created']],
			['past year', 'after/1-year-ago', ['updated', 'created']],
			['last fortnight', 'after/14-days-ago', ['updated', 'created']],
			['this week', 'after/2026-8-30', ['updated', 'created']],
			['this month', 'after/2026-8-1', ['updated', 'created']],
			['this year', 'after/2026-1-1', ['updated', 'created']],
			['today', 'after/today', ['updated', 'created']],
			//YESTERDAY IS A DAY, NOT A BOUNDARY: 'after/yesterday' would keep
			//everything touched today too, which is not what the word means.
			['yesterday', 'between/yesterday/today', ['updated', 'created']],
			['since 2024', 'after/2024-1-1', ['updated', 'created']],
			['since 2024 01 15', 'after/2024-1-15', ['updated', 'created']],
			['before 2024', 'before/2024-1-1', ['updated', 'created']],
			['until 2020', 'before/2020-1-1', ['updated', 'created']],
			['prior to 2020', 'before/2020-1-1', ['updated', 'created']],
			['since last week', 'after/7-days-ago', ['updated', 'created']],
			['since today', 'after/today', ['updated', 'created']],
			['before yesterday', 'before/yesterday', ['updated', 'created']],
			['after 2024', 'after/2024-1-1', ['updated', 'created']],
			//THE COUNT COMES OUT OF THE INPUT. Every one of these used to refuse.
			['since 5 days ago', 'after/5-days-ago', ['updated', 'created']],
			['since 12 days ago', 'after/12-days-ago', ['updated', 'created']],
			['since 3 weeks ago', 'after/21-days-ago', ['updated', 'created']],
			['before 2 months ago', 'before/2-months-ago', ['updated', 'created']],
			['until 6 months ago', 'before/6-months-ago', ['updated', 'created']],
			['since two years ago', 'after/2-years-ago', ['updated', 'created']],
			['5 days ago', 'after/5-days-ago', ['updated', 'created']],
			['created since 5 days ago', 'after/5-days-ago', ['created']],
			['updated in the past 3 weeks', 'after/21-days-ago', ['updated']],
			['created in the last 9 days', 'after/9-days-ago', ['created']],
			//WHEN THE PHRASE NAMES THE FIELD, ONLY THAT FIELD.
			['updated last week', 'after/7-days-ago', ['updated']],
			['created this month', 'after/2026-8-1', ['created']],
			['created this week', 'after/2026-8-30', ['created']],
			['modified in the last 30 days', 'after/30-days-ago', ['updated']],
			['cards added since 2024', 'after/2024-1-1', ['created']],
			['30 days', 'after/30-days-ago', ['updated', 'created']],
			['3 months', 'after/3-months-ago', ['updated', 'created']],
			['few days', 'after/3-days-ago', ['updated', 'created']],
		];

		it('compiles the phrases people type into the clauses they mean', () => {
			for (const [phrase, clause, families] of table) {
				const parsed = parseCollectionDatePhrase(phrase, NOW);
				assert.ok(parsed, `“${phrase}” must parse`);
				assert.strictEqual(parsed.clause, clause, `“${phrase}”`);
				assert.deepStrictEqual([...parsed.families], families, `“${phrase}” families`);
			}
		});

		//THE OTHER HALF OF A GRAMMAR: what it REFUSES. A parser that fires on
		//everything is a parser that ranks noise at the top of the list, which is
		//the one place this one is allowed to put things.
		it('declines everything that is not a date phrase', () => {
			//THE REFUSALS ARE THE OTHER HALF OF D4's "total over the documented
			//grammar and refuses honestly outside it". Note especially the two
			//counted ones: a count the parser cannot USE is a refusal, never a
			//clamp — 'last 9999 days' compiled to a 999-day window would be a
			//phrase silently rewritten into one the user did not type.
			for (const phrase of [
				'',
				'starred',
				'systems thinking',
				'week',
				'last',
				'this',
				'this decade',
				'created',
				'updated',
				'ago',
				'days ago',
				'since days ago',
				'since week',
				'last 9999 days',
				'0 days',
				'2024',
				'since 2024 13 40',
				'created updated last week',
				'since',
				'before',
				'prior to',
			]) {
				assert.strictEqual(parseCollectionDatePhrase(phrase, NOW), null, `“${phrase}” is not a date phrase`);
			}
		});

		it('is deterministic against a fixed reference date', () => {
			const once = parseCollectionDatePhrase('this month', NOW);
			const twice = parseCollectionDatePhrase('this month', NOW);
			assert.deepStrictEqual(once, twice);
		});

		it('names the filters the clause becomes, updated first', () => {
			assert.deepStrictEqual(
				collectionDatePhraseFilters(parseCollectionDatePhrase('last 7 days', NOW)),
				['updated/after/7-days-ago', 'created/after/7-days-ago']
			);
		});

		//AND IN THE LIST: a successful parse LEADS, spelled as the pill it would
		//become. Before this the phrase fell through every tier to the guess
		//floor — a search of card prose for the word 'days'.
		it('leads the typed list, as the configured pill', () => {
			const rows = complete('last 7 days', 'everything/', {now: NOW});
			assert.strictEqual(rows[0].tier, 'parsed',
				`a parsed date phrase outranks every guess: ${rows.slice(0, 3).map(row => `${row.tier}:${row.id}`).join(', ')}`);
			assert.strictEqual(rows[0].filter, 'updated/after/7-days-ago');
			assert.match(rows[0].label, /Updated/, `the row renders as the pill it becomes: ${rows[0].label}`);
			assert.strictEqual(rows[1].filter, 'created/after/7-days-ago',
				'both fields are offered when the phrase names neither, updated first');
			//And the literal reading is still there, at the floor, because the
			//user might genuinely have meant to search for those words.
			const guess = rows.find(row => row.tier === 'guess');
			assert.ok(guess, 'the guess-fallback is never deleted, only outranked');
			assert.match(guess.detail, /Search card text for/,
				'and it says that it is a guess');
		});
	});

	//--- 4. The personal-usage store ----------------------------------------

	describe('the personal usage store', () => {

		beforeEach(() => window.localStorage.clear());

		it('records an acceptance and reports it as a weight', () => {
			const now = Date.now();
			assert.deepStrictEqual(completionUsageWeights('uid-a', now), {});
			recordCompletionAcceptance('value:tag-systems', 'uid-a', now);
			assert.strictEqual(completionUsageWeights('uid-a', now)['value:tag-systems'], 1);
			recordCompletionAcceptance('value:tag-systems', 'uid-a', now);
			assert.strictEqual(completionUsageWeights('uid-a', now)['value:tag-systems'], 2);
		});

		//FREQUENCY AND RECENCY IN ONE NUMBER. Three acceptances a half-life ago
		//are worth one and a half now, so a single fresh acceptance is close
		//behind — which is the ordering a person would expect and the reason the
		//counter decays rather than counting.
		it('decays by half every half-life', () => {
			const now = Date.now();
			recordCompletionAcceptance('old', 'uid-b', now - USAGE_HALF_LIFE_MS);
			recordCompletionAcceptance('old', 'uid-b', now - USAGE_HALF_LIFE_MS);
			const weights = completionUsageWeights('uid-b', now);
			assert.ok(Math.abs(weights['old'] - 1) < 0.0001, `two acceptances one half-life ago weigh one: ${weights['old']}`);
		});

		//SCOPE IS THE UID, exactly as the recents store scopes its own list. A
		//shared browser has more than one person in it.
		it('keeps one person’s habits out of another’s', () => {
			const now = Date.now();
			recordCompletionAcceptance('value:tag-systems', 'uid-a', now);
			assert.deepStrictEqual(completionUsageWeights('uid-b', now), {});
		});

		//IT IS AN ENHANCEMENT AND IT NEVER THROWS.
		it('survives storage that refuses to store', () => {
			const original = window.localStorage.setItem;
			window.localStorage.setItem = () => { throw new Error('QuotaExceeded'); };
			try {
				assert.doesNotThrow(() => recordCompletionAcceptance('value:tag-systems', 'uid-c'));
				assert.doesNotThrow(() => recordStickyComposerSet('everything', 'uid-c'));
			} finally {
				window.localStorage.setItem = original;
			}
		});

		//THE RANKING ACTUALLY USES IT: two candidates matching at the same tier
		//come out in the order this person has used them.
		it('lifts a used candidate above an unused one at the same tier', () => {
			const usage = {'value:tag-complexity': 8};
			const withoutUsage = complete('tagged').filter(row => row.kind === 'value').map(row => row.filter);
			const withUsage = complete('tagged', 'everything/', {usage}).filter(row => row.kind === 'value').map(row => row.filter);
			assert.ok(withoutUsage.indexOf('tag-complexity') > 0,
				`the small tag does not lead on its own: ${withoutUsage.join(', ')}`);
			assert.strictEqual(withUsage[0], 'tag-complexity',
				`a candidate this person keeps picking leads: ${withUsage.join(', ')}`);
		});

		//CORPUS FIT: with no personal history, the tag that covers more of the
		//corpus is the likelier thing to be reaching for.
		it('ranks a big tag above a tiny one when nothing else separates them', () => {
			const values = complete('tagged').filter(row => row.kind === 'value').map(row => row.filter);
			assert.ok(values.indexOf('tag-systems') < values.indexOf('tag-complexity'),
				`400 cards outranks 3: ${values.join(', ')}`);
		});
	});

	//--- 5. The sticky starting set -----------------------------------------

	describe('the sticky starting set', () => {

		beforeEach(() => window.localStorage.clear());

		it('defaults to everything, and remembers what was chosen instead', () => {
			assert.strictEqual(readStickyComposerSet('uid-a'), DEFAULT_STICKY_SET);
			assert.strictEqual(DEFAULT_STICKY_SET, 'everything');
			recordStickyComposerSet('reading-list', 'uid-a');
			assert.strictEqual(readStickyComposerSet('uid-a'), 'reading-list');
			//A set name this build no longer has is a stale string, not a
			//preference.
			recordStickyComposerSet('a-set-that-does-not-exist', 'uid-a');
			assert.strictEqual(readStickyComposerSet('uid-a', ['main', 'reading-list', 'everything']), DEFAULT_STICKY_SET);
		});

		//PRINCIPLE 1 IS PRESERVED. This fires only from the app's own bare
		//default view, which is the one state with no "where the user is".
		//
		//SUPERSEDED PIN (round-3 tightness, M6). It used to take (before, after,
		//stickySet) and pin the rewrite to the FIRST EDIT: a bare `main/` draft
		//plus an added `starred` came back as `everything/starred/`, and a bare
		//`main/` with no edit came back untouched. That deferral is exactly the
		//defect the tightness critique found — the sentence rendered the set the
		//draft still had while the commit used the set it was about to get, so
		//the composer said `Main` and opened `everything/`. The question is asked
		//once now, of the DRAFT, at the moment the composer opens, and the two
		//assertions that survive are the two that were ever about behaviour: it
		//fires from the app's bare default, and it does not fire anywhere else.
		it('answers where a composition starts from, once, from the draft alone', () => {
			assert.strictEqual(
				collectionDescriptionWithStickyStart(draft('main/'), 'everything').set,
				'everything',
				'a composition begun from the app’s bare default starts from the sticky set'
			);
			//A collection the user was already IN is composed from where they are.
			assert.strictEqual(
				collectionDescriptionWithStickyStart(draft('main/unread/'), 'everything').set,
				'main',
				'a draft with conditions on it is where the user is, and is left alone'
			);
			//And so is a set they chose themselves.
			assert.strictEqual(
				collectionDescriptionWithStickyStart(draft('reading-list/'), 'everything').set,
				'reading-list'
			);
			//A sticky set that IS the draft's set changes nothing, including the
			//identity of the object — the seeding path compares serializations to
			//decide whether to dispatch at all.
			const bare = draft('main/');
			assert.strictEqual(collectionDescriptionWithStickyStart(bare, 'main'), bare);
			assert.strictEqual(collectionDescriptionWithStickyStart(bare, ''), bare);
		});
	});

	//--- 6. The metric: expected arrow-downs --------------------------------

	//"MINIMIZE ARROW-DOWNS: type characters, hit Enter as soon as the top one
	//matches." That is an interaction cost, so it is asserted as one. Every row
	//is a token somebody would plausibly type and the candidate they meant; the
	//assertion is that the intended candidate is FIRST, or at worst second (one
	//arrow-down), and the failure message prints the list that beat it.
	describe('expected arrow-downs', () => {

		const arrivals = (token, extra, serialized = 'everything/') => complete(token, serialized, extra);

		const assertReachable = (token, predicate, why, extra, serialized) => {
			const rows = arrivals(token, extra, serialized);
			const index = rows.findIndex(predicate);
			assert.ok(index >= 0, `“${token}” never reached ${why}: ${rows.slice(0, 5).map(row => row.id).join(', ')}`);
			assert.ok(index <= 1,
				`“${token}” needed ${index} arrow-downs to reach ${why}: ${rows.slice(0, index + 1).map(row => row.id).join(' | ')}`);
		};

		const isFilter = (name) => (row) => row.filter === name;
		const isFamily = (name) => (row) => (row.filter || '').split('/')[0] === name;

		it('puts the intended candidate first or second for every typed token', () => {
			const battery = [
				//EXACT AND PREFIX — the easy cases, pinned so a regression in the
				//hard ones cannot be excused by "the easy ones still work".
				['starred', isFilter('starred'), 'the Starred filter'],
				['star', isFilter('starred'), 'the Starred filter from a prefix'],
				['pub', isFilter('published'), 'Published from its documented alias-prefix'],
				['unread', isFilter('unread'), 'Unread'],
				//SYNONYMS — the curated metadata the design bet the catalog's
				//deletion on.
				['favorite', isFilter('starred'), 'Starred by a synonym'],
				['draft', isFilter('unpublished'), 'Unpublished by a synonym'],
				['inbox', isFilter('unread'), 'Unread by a synonym'],
				['untagged', isFilter('no-tags'), 'No Tags by a synonym'],
				['stale', isFamily('updated'), 'the updated family by a synonym'],
				//TYPOS — the round-2 tier. Each of these used to fall past every
				//name in the app.
				['staarred', isFilter('starred'), 'Starred through an inserted letter'],
				['starrde', isFilter('starred'), 'Starred through a transposition'],
				['unpublised', isFilter('unpublished'), 'Unpublished through a dropped letter'],
				['favorties', isFilter('starred'), 'Starred through a transposed synonym'],
				//VALUES from the live corpus.
				['systems', isFilter('tag-systems'), 'the Systems tag'],
				['notes', isFilter('notes-section'), 'the Notes section'],
				//DATE PHRASES — the deterministic grammar.
				['last 7 days', isFilter('updated/after/7-days-ago'), 'the rolling week'],
				['this month', isFamily('updated'), 'this calendar month'],
				['created this month', isFamily('created'), 'this calendar month, created'],
				//ROUND 3, D4: the count bound out of the input. 'created since 5
				//days ago' has to reach the FIVE-day pill, not a five-word text
				//search, and it has to reach it at the top.
				['created since 5 days ago', isFilter('created/after/5-days-ago'), 'the 5-day pill, created'],
				['since 12 days ago', isFilter('updated/after/12-days-ago'), 'the 12-day pill'],
				['updated in the past 3 weeks', isFilter('updated/after/21-days-ago'), 'the 3-week pill'],
				['this week', isFamily('updated'), 'this calendar week'],
				//SINGLETONS — set, sort and view, by name and by alias.
				['reading list', (row) => row.id === 'set:reading-list', 'the Reading List set'],
				['sort by stars', (row) => row.id === 'sort:stars', 'the Stars sort'],
				//The draft this battery runs against is already in the list view,
				//so the CHANGE somebody types 'graph' for is the web one. (A
				//singleton already in force is suppressed — choosing what you
				//have is a no-op with a count beside it.)
				['graph', (row) => row.id === 'view:web', 'the web view by an alias'],
				//NEGATION — the clause is reached and the negated row leads it.
				['not published', isFilter('published'), 'Published, to negate'],
				['exclude starred', isFilter('starred'), 'Starred, to negate'],
			];
			for (const [token, predicate, why, extra] of battery) {
				assertReachable(token, predicate, why, extra);
			}
		});

		//THE BATTERY AGAINST A DRAFT THAT ALREADY HAS SOMETHING IN IT (round-3
		//tightness). Every row above runs against an EMPTY draft, which is the
		//easy half: a token can only mean "add this". The friction the critique
		//measured was all on the other half — the same tokens typed at a draft
		//with two tags and a date clause in it, where the same candidate now has
		//four or five valences and the count-driven rules have something to sink.
		it('reaches the same candidate against a draft that already has clauses', () => {
			const NOW = new Date(2026, 7, 30, 13, 45);
			const withTags = 'everything/tag-systems/notes-section/';
			const battery = [
				//B2's own repro, one layer down: the parsed phrase's candidate has
				//to be the FIRST candidate, not a reading of the raw words and not
				//a recent that happens to mention them.
				['created since 5 days ago', isFilter('created/after/5-days-ago'), 'the 5-day pill against a two-tag draft', {now: NOW}, withTags],
				//And the ordinary tokens keep working when the draft is not empty.
				['starred', isFilter('starred'), 'Starred against a two-tag draft', undefined, withTags],
				['systems', isFilter('tag-systems'), 'the Systems tag it already has', undefined, withTags],
			];
			for (const [token, predicate, why, extra, serialized] of battery) {
				assertReachable(token, predicate, why, extra, serialized);
			}
		});

		//M3: A TYPED VALUE FOR A FAMILY THE SENTENCE HAS IS A CHANGE.
		//
		//'created since 5 days ago' against a draft holding `created/after/
		//7-days-ago` used to produce an ADD — two date clauses AND-ed into their
		//intersection, which for two rolling windows is silently the narrower one
		//— and the add led the candidate's valences. It is one collection whose
		//window moved, expressed as a node replacement in place.
		it('changes a configured clause in place rather than AND-ing a second one', () => {
			const NOW = new Date(2026, 7, 30, 13, 45);
			const rows = complete('created since 5 days ago', 'everything/created/after/7-days-ago/', {now: NOW});
			const row = rows.find(candidate => candidate.filter === 'created/after/5-days-ago');
			assert.ok(row, `the 5-day pill is offered: ${rows.slice(0, 4).map(candidate => candidate.id).join(', ')}`);
			assert.strictEqual(rows.indexOf(row), 0, 'and it is the first candidate — zero arrow-downs');
			const change = row.valences[0];
			assert.strictEqual(change.kind, 'change',
				`the top valence is the change: ${row.valences.map(valence => valence.kind).join(', ')}`);
			//ONE CLAUSE OUT, ONE CLAUSE IN, IN PLACE.
			assert.deepStrictEqual(
				change.expression.map(node => node.filter),
				['created/after/5-days-ago'],
				'the sentence keeps one date clause, at the value that was typed');
			assert.strictEqual(change.targetIndex, 0);
			assert.strictEqual(change.targetMemberIndex, -1);
			assert.strictEqual(change.targetNode.filter, 'created/after/7-days-ago',
				'and it names the clause it replaces, so the row can say what it changes');
			//THE ADD IS NOT ALSO OFFERED: a change and an add are one gesture read
			//two ways, and the reading that empties the collection is retired.
			assert.ok(!row.valences.some(valence => valence.kind === 'add'),
				`no second date clause is offered: ${row.valences.map(valence => valence.kind).join(', ')}`);
		});

		//AND THE OTHER HALF OF THE SAME DISTINCTION: a FAMILY name typed against a
		//clause of that family opens its controls rather than appending this
		//layer's own default beside the user's value.
		it('opens a family already in the sentence instead of adding its default', () => {
			const rows = complete('created', 'everything/created/after/5-days-ago/');
			const row = rows.find(candidate => candidate.id === 'family:created');
			assert.ok(row, 'the family is still reachable by name');
			const kinds = row.valences.map(valence => valence.kind);
			assert.ok(kinds.includes('edit'), `it offers the clause's own controls: ${kinds.join(', ')}`);
			assert.ok(!kinds.includes('add'),
				`and not a seven-day default beside a five-day window: ${kinds.join(', ')}`);
			assert.ok(!kinds.includes('change'),
				'a family default is not a value the user typed, so it does not silently replace one');
		});

		//THE FUZZY TIERS DO NOT INVENT NEGATIONS (round-3 tightness, minor).
		//
		//With a tag in the draft, every subsequence hit was family-compatible with
		//it, so `not Tagged Growth Mindset` — a negation of a tag nobody named, of
		//a match nobody made — led the list for the token 'grid'. A negation is
		//offered beside a clause the user NAMED, or when the token asked for one
		//outright; below that line it is noise wearing a sentence's shape.
		it('offers an unrequested negation only for a token that named something', () => {
			//THE PRECONDITION IS ASSERTED, NOT ASSUMED. The claim is about a match
			//BELOW the name tiers; guarded by `if`, a day when 'sysms' stopped
			//reaching the tag at all — or started reaching it by name — would
			//retire the assertion silently and leave a green test making no claim.
			const structural = complete('sysms', 'everything/tag-complexity/')
				.find(candidate => candidate.filter === 'tag-systems');
			assert.ok(structural, '“sysms” must still reach the Systems tag, or this test is about nothing');
			assert.ok(!NAME_ISH.has(structural.tier),
				`and it must reach it below the name tiers: ${structural.tier}`);
			assert.ok(!structural.valences.some(valence => valence.kind === 'not'),
				`a ${structural.tier} match carries no unrequested negation: ${structural.valences.map(valence => valence.kind).join(', ')}`);
			//A NAMED match beside a clause of its own family still gets one — that
			//is the state where "…but not this one" is a sentence being written.
			const named = complete('systems', 'everything/tag-complexity/')
				.find(candidate => candidate.filter === 'tag-systems');
			assert.ok(named, 'the named tag is found');
			assert.ok(named.valences.some(valence => valence.kind === 'not'),
				`and it keeps its flip: ${named.valences.map(valence => valence.kind).join(', ')}`);
			//And a negated token gets one at ANY tier, because it was asked for.
			//THE `if` HERE GUARDED THE EXACT REGRESSION THE TEST EXISTS TO CATCH:
			//if stripping the prefix ever stopped the remainder reaching the tag
			//through the typo tier, `requested` would be undefined and the whole
			//claim would evaporate into a passing test.
			const requested = complete('not sysms', 'everything/')
				.find(candidate => candidate.filter === 'tag-systems');
			assert.ok(requested, 'a negation prefix must not cost the token its typo-tier reach');
			const not = requested.valences.find(valence => valence.kind === 'not');
			assert.ok(not, 'a negation prefix is honoured at every tier');
			assert.strictEqual(not.requested, true);
		});

		//THE HONEST FLOOR IS REACHABLE (round-3 tightness, minor). `Text contains
		//X` is the one reading that is always literally true, and a dozen
		//uncapped subsequence hits pushed it to the eighth row.
		it('keeps the free-text floor within a glance when nothing better matches', () => {
			const rows = complete('grid', 'everything/tag-systems/');
			const guess = rows.findIndex(row => row.tier === 'guess');
			assert.ok(guess >= 0, 'the floor is never deleted');
			assert.ok(guess <= 4,
				`the floor is reachable: ${rows.slice(0, guess + 1).map(row => `${row.tier}:${row.id}`).join(' | ')}`);
			assert.ok(rows.filter(row => row.tier === 'structural').length <= 3,
				'and the subsequence tier is capped rather than allowed to fill the list');
		});

		//THE NEGATION PREFIXES, ALL FIVE OF THE FORMS THE TASK NAMES, plus the
		//two the module already had. Stripping happens before matching, and the
		//negated row LEADS — so somebody who typed 'not X' presses Enter, not
		//Enter-after-an-arrow-down.
		it('strips and leads with the negation for every prefix', () => {
			for (const raw of [
				'not published',
				'exclude published',
				'without published',
				'-published',
				'!published',
				//Already supported before round 2; kept so the set cannot shrink.
				'except published',
				'no published',
				'excluding published',
			]) {
				const rows = complete(raw);
				const row = rows.find(candidate => candidate.filter === 'published');
				assert.ok(row, `“${raw}” must still find Published`);
				assert.ok(rows.indexOf(row) <= 1, `“${raw}” must reach it in one arrow-down at most`);
				assert.strictEqual(row.valences[0]?.kind, 'not',
					`“${raw}” must lead with the negation, not the plain add`);
			}
		});

		//A SINGLETON REPLACES; IT NEVER STACKS. Two sets cannot both be in force,
		//so accepting one must produce a description with the new set and the
		//SAME conditions — not a description with a second set clause appended.
		it('replaces the set, sort and view rather than appending them', () => {
			const withClause = 'main/starred/';
			const set = complete('everything', withClause).find(row => row.id === 'set:everything');
			assert.ok(set, 'the set is typeable');
			assert.deepStrictEqual(set.valences, [], 'a singleton is not a clause and has no valences');
			assert.strictEqual(set.singleton, true);
			assert.strictEqual(set.description.set, 'everything');
			assert.deepStrictEqual(set.description.filters, ['starred'], 'the conditions are untouched');

			const sort = complete('stars', withClause).find(row => row.id === 'sort:stars');
			assert.ok(sort);
			assert.strictEqual(sort.description.sort, 'stars');
			assert.deepStrictEqual(sort.description.filters, ['starred']);

			//THE CURRENT VALUE IS SUPPRESSED: choosing what you already have is a
			//no-op with a count beside it.
			assert.ok(!complete('everything', 'everything/starred/').some(row => row.id === 'set:everything'),
				'the set already in force is not offered as a change');
			assert.ok(!complete('stars', 'everything/starred/sort/stars/').some(row => row.id === 'sort:stars'));
		});

		//AND THEY MATCH BY NAME AND ALIAS ONLY. Matching their generated prose is
		//what made the token 'or' hit every sort in the app: 'Orders this
		//collection by …' begins with the letters somebody typed.
		it('never reaches a sentence word through its prose', () => {
			//A SWEEP WITH A `continue` IN IT PROVES NOTHING ABOUT AN EMPTY SET, so
			//each sweep says first that it has something to sweep. Otherwise the
			//day sentence words stop being offered for 'order' at all is the day
			//this test starts passing for the wrong reason.
			const rows = complete('order');
			const sentenceWords = rows.filter(row => ['set', 'sort', 'view'].includes(row.kind));
			assert.ok(sentenceWords.length, '“order” must reach sentence words for this sweep to mean anything');
			for (const row of sentenceWords) {
				assert.ok(['name-exact', 'name-prefix', 'alias', 'typo'].includes(row.tier),
					`${row.id} was reached at the ${row.tier} tier — a sentence word is named, not described`);
			}
			//'or' is two characters, so the typo tier cannot fire either. Only
			//sorts whose own NAME begins with it may appear.
			const orSorts = complete('or').filter(row => row.kind === 'sort');
			assert.ok(orSorts.length, '“or” must still reach the sorts whose names contain it');
			for (const row of orSorts) {
				assert.ok(row.label.toLowerCase().includes('or'), `${row.id} matched “or” on prose`);
			}
		});
	});

	//--- 7. The arithmetic that keeps the tiers promises ---------------------

	//THE TIER BOUNDARIES ARE KEPT BY ARITHMETIC, NOT BY CARE. Personal
	//likelihood ranks WITHIN a tier; if its budget could ever exceed one tier
	//step, a well-used description hit would outrank an unused exact name and
	//the whole contract would become a tendency.
	it('never lets likelihood cross a tier boundary', () => {
		//A candidate with the most usage the store can express, matched at the
		//worst tier there is, against an unused candidate matched at the best.
		const world = [
			{ filter: 'beloved', category: 'tag', label: 'Beloved', detail: 'Cards about quixotry' },
			{ filter: 'quixotry', category: 'tag', label: 'Quixotry', detail: 'nothing relevant' },
		].map(candidate => ({...candidate, searchValues: [candidate.label.toLowerCase()], corpusCount: 100000}));
		const result = collectionCompletionCandidates({
			token: 'quixotry',
			expression: [],
			description: draft(),
			context: {
				candidates: world,
				filterDescriptions: {},
				usage: {'value:beloved': 1e9},
			},
			limit: 20,
		});
		assert.strictEqual(result[0].filter, 'quixotry',
			`an exact name beats any amount of history: ${result.map(row => `${row.filter}:${row.tier}:${row.score}`).join(', ')}`);
		assert.ok(result[0].score < result[1].score);
	});
});

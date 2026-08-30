//THE MATCHING-AND-VALENCE ENGINE FOR THE NATIVE SENTENCE.
//
//This is the pure-data layer under the redesigned palette
//(docs/composer-redesign/05-meta-proposal-native-sentence.md). It answers ONE
//question — "the user typed this; what could they mean, and what would each
//meaning do to the sentence?" — and it answers it with data, so the palette can
//render it, count it, and rank it without knowing anything about filters.
//
//TWO HALVES, and they are deliberately separable:
//
//  MATCHING (D1). A typed token against everything nameable: filters and
//  configurable families, tag/section/person values, sorts, views, sets, and
//  RECENT COLLECTIONS — recents are first-class matches, not a separate
//  section, because the meta-proposal makes them "the first content of the
//  first gesture" (convergence 4) and typing 'systems' should reach the
//  collection you already built out of it before it reaches the raw tag.
//
//  VALENCE (D2). For a matched clause, the +/~/– rows proposal B's §3.1
//  describes: `+ tagged c · 41 → 12`, `…or tagged c — widens (tagged b)`,
//  `not tagged c`. Each valence carries the WHOLE after-expression, so the
//  palette previews a count by running the expression it will actually apply.
//  "This list is where booleans are born" — so the boolean edit has to be in
//  the row, not reconstructed from it.
//
//WHY A NEW FILE rather than more of collection-composer-suggestions: that
//module answers in `CollectionDescription`s (a row is a destination), which is
//right for a list of places to go and wrong for a list of EDITS to a sentence.
//A valence is not a destination — three valences of one token are three
//different edits to the same draft, and two of them do not exist unless the
//draft already has a condition to widen. So this module answers in
//CollectionExpression edits, and reuses that module for everything about a
//filter's NAME, DESCRIPTION and RECENTS, which must not fork.

import {
	CollectionDescription,
	collectionDescriptionWithSet,
	collectionDescriptionWithSort,
	collectionDescriptionWithViewMode,
} from './collection_description.js';

import {
	CollectionExpression,
	FilterExpressionNode,
	negatedExpressionNode,
	serializeCollectionExpression,
	serializeFilterNode,
	withConditionAppended,
	withConditionRemoved,
	withMemberAddedToOr,
	withMemberRemoved,
	describeExpressionNode,
} from './collection-expression.js';

import {
	CollectionComposerCandidate,
	CollectionComposerContext,
	CollectionComposerSuggestion,
	collectionComposerRecentSuggestions,
	collectionComposerSuggestions,
	collectionFilterDescription,
	collectionFilterDisplayName,
	collectionFilterLabels,
	collectionOptionDisplayName,
	readableCollectionExpression,
} from './collection-composer-suggestions.js';

import {
	filterSynonyms,
} from './collection-filter-synonyms.js';

import {
	parseCollectionSource,
} from './collection-source.js';

import {
	CompletionDocument,
	CompletionIDFIndex,
	completionDescriptionMatchedWord,
	completionDescriptionScore,
	completionIDFIndexFor,
	completionStemPairs,
	completionStems,
} from './collection-completion-idf.js';

import {
	boundedDamerauLevenshtein,
	typoBudgetForToken,
} from './collection-completion-typos.js';

import {
	collectionDatePhraseFilters,
	parseCollectionDatePhrase,
} from './collection-date-phrases.js';

import {
	CompletionUsageWeights,
} from './collection-composer-usage.js';

import {
	CARD_FILTER_DESCRIPTIONS,
	CONFIGURABLE_FILTER_INFO,
	SORTS,
	filterNameIsViewerDependent,
	filterNamesAreViewerDependent,
} from './filters.js';

import {
	LEGAL_VIEW_MODES,
	SET_NAMES,
} from '../shared/collection_description_base.js';

import {
	SetName,
	SortName,
	ViewMode,
} from '../shared/types.js';

import {
	TagInfos,
} from './types.js';

//--- The shapes the palette consumes ---------------------------------------

//WHAT KIND OF THING was matched. The palette renders each kind differently (a
//value pill carries its tag's color; a recent renders as a miniature sentence),
//and the kind is also a ranking input, so it is named rather than inferred.
export type CompletionCandidateKind =
	| 'filter'
	| 'filter-family'
	| 'value'
	| 'recent'
	//A COLLECTION URL OR PATH THE PARSER ACCEPTED. A URL is a feature of this
	//product — every collection is one — so pasting one into the composer and
	//being told `Text contains “http://…”` is the palette failing at the one
	//interpretation it should be surest about. The parser is already imported
	//here for nothing else; this is it answering.
	| 'source'
	| 'set'
	| 'sort'
	| 'view';

//THE TIERS, in the hard order the owner's round-2 model states. The names are
//the vocabulary a failing ranking test should speak in.
//
//  parsed       the app PARSED what was typed rather than guessing at it: a
//               pasted collection URL, or a date phrase the grammar accepted.
//               Nothing outranks a successful parse — there is no ambiguity
//               left to rank.
//  name-exact   the display name IS the token
//  name-prefix  the display name (or a word of it) STARTS WITH the token
//  alias        a curated synonym, a candidate alias, or a searchValue
//  typo         a bounded Damerau-Levenshtein hit on a name or alias token, or
//               on its stem. A misspelled NAME is still a name, so this tier
//               sits ABOVE description: somebody who typed 'staarred' meant
//               Starred, not the filter whose prose happens to mention stars.
//  description  TF-IDF over stemmed prose (see collection-completion-idf)
//  structural   the subsequence fallback: the token's characters appear in
//               order, close together. The last thing that is still a MATCH.
//  vocabulary   no token at all — the idle list, which is the whole vocabulary
//               ranked by personal likelihood alone.
//  guess        `text contains "WORD"`. ALWAYS the floor, by arithmetic.
export type CompletionMatchTier =
	| 'parsed'
	| 'name-exact'
	| 'name-prefix'
	| 'alias'
	| 'typo'
	| 'description'
	| 'structural'
	| 'vocabulary'
	| 'guess';

//THE SCORE IS THREE PLACES IN ONE NUMBER, in strict order of authority:
//
//    TIER (millions) · DESTINATION (hundred-thousands) · LIKELIHOOD (below)
//
//The magnitudes are chosen so a lower place can never carry a higher one, which
//is what makes a tier boundary a PROMISE rather than a tendency: the largest
//possible destination term (100_000) is smaller than one tier step (1_000_000),
//and the largest possible likelihood term (LIKELIHOOD_CEILING) is smaller than
//one destination step. No accumulation of personal-usage evidence can promote a
//description match above an alias match; personal likelihood ranks WITHIN a
//tier, which is exactly what the owner asked for and exactly what a list that
//re-ranked across tiers would stop being able to promise.
//
//LOWER SORTS FIRST, so likelihood enters as a subtraction from a ceiling.
const TIER_STEP = 1_000_000;

const TIER_SCORES : Record<CompletionMatchTier, number> = {
	'parsed': 0,
	'name-exact': 1 * TIER_STEP,
	'name-prefix': 2 * TIER_STEP,
	'alias': 3 * TIER_STEP,
	'typo': 4 * TIER_STEP,
	'description': 5 * TIER_STEP,
	'structural': 6 * TIER_STEP,
	'vocabulary': 7 * TIER_STEP,
	'guess': 8 * TIER_STEP,
};

//RECENTS AND PASTED SOURCES RANK FIRST AMONG EQUALS. A recent that matched at
//the same tier as a raw filter is a collection the user has actually been IN,
//which is strictly more evidence than a name that merely also matches
//(meta-proposal convergence 4); a pasted source is not a guess at all. It is a
//tiebreak, not a tier: a recent matched by a subsequence still loses to a filter
//matched by its own name.
const DESTINATION_STEP = 100_000;

//The likelihood budget, and the ceiling it is subtracted from. Every component
//below is bounded, and their bounds sum to less than this — asserted by the
//ranking tests rather than trusted.
const LIKELIHOOD_CEILING = 99_999;

//WHAT "HOW LIKELY IS THIS PERSON TO PICK THIS" IS MADE OF. Five bounded terms,
//each answering a different question the owner named:
//
//  MATCH QUALITY   how well this candidate answers what was actually typed,
//                  measured in the terms of its own tier (whole-name prefix vs
//                  interior word; edit distance; summed TF-IDF).
//  USAGE           what this person has ACCEPTED before, frequency and recency
//                  decayed (collection-composer-usage). The largest single
//                  term, because it is the only evidence about this user
//                  specifically.
//  CORPUS FIT      how much of the corpus this value actually covers. A tag on
//                  four hundred cards is a more likely destination than a tag
//                  on one, and the composer knows the difference.
//  CONTEXT         what is already in the collection description: a clause of a
//                  family already present is one the user is plausibly in the
//                  middle of widening.
//  KIND PRIOR      the old KIND_RANK, demoted to a tiebreak. A tag and a filter
//                  that match equally well and are equally used should still
//                  come out in a stable, sensible order.
const MATCH_QUALITY_MAXIMUM = 30_000;
const USAGE_MAXIMUM = 40_000;
const CORPUS_FIT_MAXIMUM = 12_000;
const CONTEXT_BOOST = 6_000;
const KIND_PRIOR_STEP = 750;

//How many accepted uses it takes to reach half the usage budget. Three: one
//acceptance is a fact, three is a habit, and a habit is what the ranking should
//be shaped by.
const USAGE_HALF_SATURATION = 3;

//How many cards it takes for a value to reach half the corpus-fit budget.
const CORPUS_FIT_HALF_SATURATION = 20;

const saturating = (value : number, halfSaturation : number, maximum : number) : number =>
	value > 0 ? maximum * (value / (value + halfSaturation)) : 0;

//HOW MANY RECENTS A TYPED LIST MAY LEAD WITH WHEN THE MATCH IS WEAK.
//
//Recents rank first among equals, which is right for a token that genuinely
//names one. It is wrong for a generic token: 'a' or 'tag' matches every recent
//whose detail happens to contain the word, and three destinations — some of
//them zero-card junk — then sit above the first actual interpretation of what
//was typed. A name-tier match is evidence the user meant that collection; an
//alias, typo, description or structural match is not, and one such row is the
//whole budget.
const WEAK_MATCH_RECENT_LIMIT = 1;

const NAME_TIERS : ReadonlySet<CompletionMatchTier> = new Set<CompletionMatchTier>(['parsed', 'name-exact', 'name-prefix']);

//EVERY ROW IS AN ACTION ON THE DRAFT (the owner's round-3 constitution: "the top
//action can be 'change the sort' or 'change the set' or 'add a filter' or
//'remove a filter' or 'change a filter's configuration'"). Two of those five were
//missing from this list, and their absence is what made typing the name of a
//clause the draft ALREADY HAS produce an offer to add it a second time and an
//offer to fuse it with its own negation.
//
//  remove — the clause is in the sentence; this takes it out. Reachable by
//           typing its name, in either valence: typing 'common-tools' when the
//           sentence says `not common-tools` offers `Remove not common-tools`.
//  edit   — the clause is in the sentence and has arguments; this opens its pill
//           row. It is the one valence that does not change the expression, and
//           it is exempt from the no-op guard for exactly that reason: the action
//           is "show me this clause's controls", not "rewrite the draft".
export type CompletionValenceKind = 'add' | 'or' | 'not' | 'remove' | 'edit';

//A VALENCE CARRIES ITS OWN AFTER-EXPRESSION. The palette shows `41 → 118` by
//running this expression; nothing between the row and the count re-derives what
//the row meant.
export type CompletionValence = {
	//Stable across keystrokes for the same token+valence+target, which is what
	//makes it usable as a preview-count cache key.
	id : string;
	kind : CompletionValenceKind;
	//The row's own sentence, in the composer's voice.
	label : string;
	//WHAT THIS ROW KEEPS, when that is not what the CANDIDATE keeps.
	//
	//Every valence used to inherit the candidate's one description, so the
	//negated row read "not Tagged tag-2 — Keeps cards tagged tag-2": a row whose
	//name and whose explanation say opposite things, on the surface whose whole
	//job is to teach what a clause does. A negation describes a different
	//collection, so it gets a different sentence — the app's own authored one
	//when the flipped clause has a name of its own, and an honest derived
	//negative when it does not. '' means "the candidate's own line is right for
	//this row", which is true of `add` and of `or`.
	detail? : string;
	//The expression this row would produce, whole.
	expression : CollectionExpression;
	//For 'or': WHICH condition it widens. Proposal B §3.1 requires the row
	//to be "labeled with what it widens", so the palette is handed both the
	//index (to highlight the pill) and the name (to say it).
	//
	//For 'remove' and 'edit': WHICH condition the action is about, so the palette
	//can open the pill row on it without re-finding it by name.
	targetIndex? : number;
	targetLabel? : string;
	//For 'remove' and 'edit' inside an or-group: which alternative. -1 (or
	//absent) means the whole condition.
	targetMemberIndex? : number;
	//For 'remove' and 'edit': the clause in the sentence this row is about, so
	//the palette can render it as the pill it already is rather than re-finding
	//it. The row's anatomy is the same as every other row's — it shows the pill —
	//and this is the pill.
	targetNode? : FilterExpressionNode;
	//For 'or': whether the target is in the same value family. The engine allows
	//a union of ANY two conditions, so this is a RANKING fact, not a legality
	//one — see valenceRank.
	compatible? : boolean;
	//Lower sorts first, within one candidate's valences.
	rank : number;
};

export type CompletionCandidate = {
	//Stable id for preview-count keying. Contains the kind and the thing, never
	//the query, so a count survives the next keystroke.
	id : string;
	kind : CompletionCandidateKind;
	//THE PILL IT WOULD BECOME. Proposal A's token discipline: "completions
	//render as the pill they would become", so this is the clause's canonical
	//display name and not a search-oriented restatement of it.
	label : string;
	//One line of prose about what it keeps.
	detail : string;
	tier : CompletionMatchTier;
	score : number;
	//The word that actually matched, so a row can show WHY it is here when the
	//match was not on the name.
	matchedOn : string;
	//Present for the clause kinds: the filter this candidate would insert.
	filter? : string;
	//Present for the clause kinds: the node the valences build on.
	node? : FilterExpressionNode;
	//Present for the destination kinds ('recent'/'source') and the sentence-word
	//kinds ('set'/'sort'/'view'): the description this candidate would produce.
	//These are not expression edits — a set is not a condition — so they carry a
	//description instead of valences.
	description? : CollectionDescription;
	//A destination that carries its own path, because the path says more than
	//the description does: a pasted source may name a selected card.
	destinationPath? : string;
	//Empty for the non-clause kinds.
	valences : CompletionValence[];
	//True when this clause's membership is computed from the signed-in account.
	viewerDependent : boolean;
	//THE KEY THIS CANDIDATE IS REMEMBERED UNDER when the user accepts it. It is
	//coarser than `id` on purpose: every configuration of the `updated` family
	//is one habit, not thirty, and a key that carried the arguments would learn
	//nothing that transfers to the next window the user asks for. Absent for the
	//kinds there is nothing to learn from — a pasted source, a free-text guess.
	usageKey? : string;
	//A QUIET WORD SAYING WHAT KIND OF THING THIS IS ('tag', 'section',
	//'author', 'sort'). The idle list is the whole vocabulary in one ranked run,
	//so a row needs to be able to say what it is without the list growing
	//category walls to say it for them.
	annotation? : string;
	//A CANDIDATE WHOSE ACCEPTANCE REPLACES A WORD rather than appending a
	//clause: the set, the sort, the view. They are singletons — a collection has
	//exactly one of each — so the palette must never treat them as stacking.
	singleton? : boolean;
	//A FAMILY THIS LAYER WILL NOT COMPOSE, offered as the honest route into
	//Source instead of as a clause. See STRUCTURAL_FILTER_FAMILIES: their
	//defaults are placeholders that would silently empty a collection, so they
	//get a row that OPENS the text editor at that family rather than a row that
	//adds something and lies about the count beside it.
	sourceFilter? : string;
};

//Everything the index needs that it cannot derive. Deliberately the same shape
//the existing suggestion path already receives, plus the two prose sources
//proposal C §2b names (filter descriptions and tagInfos descriptions).
export type CollectionCompletionContext = CollectionComposerContext & {
	filterDescriptions? : Readonly<Record<string, string>>;
	//Tag/section metadata, whose `description` is user-authored prose about a
	//tag and therefore matchable at the description tier. This is the half of
	//"description matching" the filter registry cannot supply.
	tagInfos? : TagInfos;
	//The sorts and views this app knows. Defaulted from the registries; passed
	//explicitly by tests that want a small closed world.
	sortNames? : readonly string[];
	viewModes? : readonly string[];
	setNames? : readonly string[];
	//WHAT THIS PERSON HAS ACCEPTED BEFORE: usage key -> decayed weight, from
	//collection-composer-usage. Passed in rather than read here so this module
	//stays pure and so a session's ranking cannot shift under the user
	//mid-keystroke — the composer reads the store once, when it opens.
	usage? : CompletionUsageWeights;
	//The reference instant for the date-phrase grammar. Defaulted to now;
	//passed explicitly by tests so 'this month' is a fixture rather than a
	//moving target.
	now? : Date;
};

//--- Matching --------------------------------------------------------------

const normalized = (value : string) : string => value.trim().toLowerCase();

//A NAME MATCHES BY WORD PREFIX, NOT BY SUBSTRING.
//
//Substring matching is what makes a search feel haunted: typing 'or' matches
//"auth-OR", "categ-OR-ized", and "col-OR". A name therefore matches only when
//the token starts a WORD in it, which is the only kind of match a reader can see
//the reason for.
const wordPrefixMatch = (prose : string, token : string) : string => {
	if (!prose || !token) return '';
	for (const word of prose.toLowerCase().split(/[^a-z0-9]+/)) {
		if (word.startsWith(token)) return word;
	}
	return '';
};

//THE SUBSEQUENCE FALLBACK, AND IT IS LAST FOR A REASON.
//
//'tgs' finding 'tags' is a real recovery; 'tgs' finding
//'not-automatically-prioritized' is noise wearing the same clothes. So it
//requires three characters (below that every candidate matches something) and
//refuses to span more than a bounded stretch of the haystack, which is what
//separates a slip from a coincidence. It sits BELOW the typo tier because it
//makes no claim about how many mistakes were made — only that the letters
//appear in order, which a lot of long names satisfy by accident.
const STRUCTURAL_MINIMUM_TOKEN_LENGTH = 3;
const STRUCTURAL_MAXIMUM_SPAN = 24;

const subsequenceMatch = (haystack : string, token : string) : boolean => {
	if (token.length < STRUCTURAL_MINIMUM_TOKEN_LENGTH) return false;
	const value = haystack.toLowerCase();
	let start = -1;
	let position = 0;
	for (const character of token) {
		position = value.indexOf(character, position);
		if (position < 0) return false;
		if (start < 0) start = position;
		position++;
	}
	return position - start <= STRUCTURAL_MAXIMUM_SPAN;
};

//THE KIND PRIOR, demoted from a rank to a tiebreak. Two candidates that match
//equally well and are equally used still need a stable, sensible order, and this
//is it: what the corpus contains, then what the app defines, then the words of
//the sentence.
const KIND_RANK : Record<CompletionCandidateKind, number> = {
	'source': 0,
	'recent': 0,
	'value': 1,
	'filter': 2,
	'filter-family': 3,
	'set': 4,
	'sort': 5,
	'view': 6,
};

type Match = {
	tier : CompletionMatchTier;
	matchedOn : string;
	//The tier-local measure of how good this match is, already scaled into
	//[0, MATCH_QUALITY_MAXIMUM]. Computed where the tier is decided, because
	//only there is it known what "good" means for that tier.
	quality : number;
};

//THE WORDS OF A NAME OR ALIAS, and their stems, as the typo tier compares them.
//Stemming is the app's own (shared/nlp, through the completion IDF module), so
//'updating' typed against a candidate called 'Updated' is one comparison of two
//identical stems rather than two edits apart.
const comparisonTokens = (values : readonly string[]) : string[] => {
	const result = new Set<string>();
	for (const value of values) {
		if (!value) continue;
		const lowered = value.toLowerCase();
		result.add(lowered);
		for (const word of lowered.split(/[^a-z0-9]+/)) {
			if (word.length >= STRUCTURAL_MINIMUM_TOKEN_LENGTH) result.add(word);
		}
		for (const stem of completionStems(value)) {
			if (stem.length >= STRUCTURAL_MINIMUM_TOKEN_LENGTH) result.add(stem);
		}
	}
	return [...result];
};

//THE TYPO TIER. The bound comes from the TYPED token's length (3-5 chars: one
//edit; 6+: two; never at 2 or below), transpositions cost one, and the candidate
//side is compared word-by-word and stem-by-stem so a slip inside a long phrase
//name is still recoverable. Returns the distance, or -1 for no hit.
const typoDistance = (token : string, comparisons : readonly string[]) : number => {
	const budget = typoBudgetForToken(token);
	if (!budget) return -1;
	let best = -1;
	for (const comparison of comparisons) {
		//A prefix relationship is a higher tier's business, not this one's.
		if (comparison === token || comparison.startsWith(token)) continue;
		const distance = boundedDamerauLevenshtein(token, comparison, budget);
		if (distance > budget) continue;
		if (best < 0 || distance < best) best = distance;
		if (best === 1) break;
	}
	return best;
};

//THE ONE MATCHING FUNCTION, and the whole of the tier contract. Every caller
//passes the same buckets, so a tag, a filter family and a recent collection are
//all matched by one rule and cannot drift into three.
//
//The DESCRIPTION tier is not decided here: it needs the corpus-wide IDF table,
//which the entry point owns. Callers pass a `descriptionScore` closure that
//answers "how much does this candidate's prose weigh against the typed stems",
//and a zero answer means the tier does not fire.
const matchTier = (
	token : string,
	name : string,
	aliases : readonly string[],
	descriptionScore : () => {score : number, matchedOn : string}
) : Match | null => {
	const normalizedName = normalized(name);
	if (normalizedName === token) return {tier: 'name-exact', matchedOn: name, quality: MATCH_QUALITY_MAXIMUM};
	//Inside the prefix tier, a match on the whole name beats a match on a word
	//in the middle of it, and a shorter name beats a longer one — the token is a
	//larger fraction of what the user actually named.
	const lengthPenalty = Math.min(name.length, 40) * 100;
	if (normalizedName.startsWith(token)) {
		return {tier: 'name-prefix', matchedOn: name, quality: MATCH_QUALITY_MAXIMUM - lengthPenalty};
	}
	//A name is often a phrase ('Updated since 7 days ago'), and typing a word
	//from the middle of it is still typing its name. Ranked inside the prefix
	//tier rather than below it, at half the quality so the whole-name prefix
	//wins when both match.
	const nameWord = wordPrefixMatch(name, token);
	if (nameWord) {
		return {tier: 'name-prefix', matchedOn: nameWord, quality: MATCH_QUALITY_MAXIMUM / 2 - lengthPenalty};
	}
	for (const alias of aliases) {
		const normalizedAlias = normalized(alias);
		if (normalizedAlias === token || normalizedAlias.startsWith(token)) {
			return {
				tier: 'alias',
				matchedOn: alias,
				quality: MATCH_QUALITY_MAXIMUM - Math.min(alias.length, 40) * 100,
			};
		}
	}
	//A FUZZY NAME HIT OUTRANKS ANY DESCRIPTION HIT. This is the tier order's one
	//genuinely contestable call and it is made deliberately: a person who
	//mistypes a name is reaching for that thing, while a person whose token
	//appears in some prose may be reaching for anything that prose is about.
	const distance = typoDistance(token, comparisonTokens([name, ...aliases]));
	if (distance >= 0) {
		return {
			tier: 'typo',
			matchedOn: name,
			//One edit wrong is much better evidence than two.
			quality: MATCH_QUALITY_MAXIMUM - distance * (MATCH_QUALITY_MAXIMUM / 3),
		};
	}
	//THE TIER FIRES ON PRESENCE AND RANKS ON RARITY. `matchedOn` is the presence
	//answer and `score` is the rarity one; a common stem is a real hit worth
	//almost no rank, which is a different fact from a miss.
	const description = descriptionScore();
	if (description.matchedOn) {
		return {
			tier: 'description',
			matchedOn: description.matchedOn,
			//TF-IDF is unbounded above in principle; in this corpus a strong
			//single-stem hit is around 1.0-1.5. Scaled and clamped so a
			//pathological document cannot borrow a whole tier's worth of rank.
			quality: Math.min(MATCH_QUALITY_MAXIMUM, Math.round(description.score * 20_000)),
		};
	}
	if (subsequenceMatch(name, token)) return {tier: 'structural', matchedOn: name, quality: MATCH_QUALITY_MAXIMUM / 6};
	for (const alias of aliases) {
		if (subsequenceMatch(alias, token)) return {tier: 'structural', matchedOn: alias, quality: 0};
	}
	return null;
};

//WHAT THE RANKING KNOWS ABOUT A CANDIDATE BEYOND HOW IT MATCHED.
type LikelihoodInputs = {
	kind : CompletionCandidateKind;
	quality : number;
	//The decayed acceptance weight for this candidate's usage key.
	usage : number;
	//How many cards this value covers, when the corpus can say.
	corpusCount : number;
	//True when a condition of this candidate's family is already in the draft.
	familyPresent : boolean;
};

//P(SELECT | TYPED, HISTORY, CORPUS, DESCRIPTION), as a bounded number. Every
//term is named above; the sum is asserted to stay under LIKELIHOOD_CEILING by
//the ranking tests, which is what keeps the tier boundaries arithmetic.
const likelihoodFor = (inputs : LikelihoodInputs) : number =>
	Math.max(0, Math.min(inputs.quality, MATCH_QUALITY_MAXIMUM)) +
	saturating(inputs.usage, USAGE_HALF_SATURATION, USAGE_MAXIMUM) +
	saturating(inputs.corpusCount, CORPUS_FIT_HALF_SATURATION, CORPUS_FIT_MAXIMUM) +
	(inputs.familyPresent ? CONTEXT_BOOST : 0) +
	(6 - KIND_RANK[inputs.kind]) * KIND_PRIOR_STEP;

const DESTINATION_KINDS : ReadonlySet<CompletionCandidateKind> = new Set<CompletionCandidateKind>(['recent', 'source']);

const scoreFor = (tier : CompletionMatchTier, inputs : LikelihoodInputs) : number =>
	TIER_SCORES[tier] +
	(DESTINATION_KINDS.has(inputs.kind) ? 0 : DESTINATION_STEP) +
	(LIKELIHOOD_CEILING - Math.min(LIKELIHOOD_CEILING, likelihoodFor(inputs)));

//--- Family compatibility --------------------------------------------------

//WHAT AN "OR" IS BETWEEN, AND WHY THIS IS A RANKING CALL.
//
//The engine unions ANY two conditions — `a+b` for plain tokens, `combine/` for
//anything else — so `(tagged systems or in section Notes)` is perfectly legal
//and runs exactly as written. Nothing here can make it illegal, and pretending
//otherwise would be a UI lying about the engine.
//
//But it is rarely what somebody MEANT. An OR is how a person says "either of
//these two answers to the same question", and two clauses answer the same
//question when they are the same KIND of clause: tag with tag, section with
//section, one configurable family with itself. So compatibility here decides
//RANK, not possibility: a compatible `or` sits directly under `add` where
//proposal B §3.1 puts it, and an incompatible one is offered below `not`, where
//it is available to somebody who really did mean it and out of the way of
//everybody who did not.
//
//The edge call, stated: mixing a tag and a section in one OR is INCOMPATIBLE
//here. They are both "value" clauses and the temptation is to call them one
//family, but "tagged X or in section Y" is a different question from "tagged X
//or tagged Y", and only the second one is the sentence the sibling-value row of
//proposal C §2b was invented to offer.
export type CompletionValueFamily = string;

const configurableFamily = (filter : string) : string => {
	const family = filter.split('/')[0];
	return CONFIGURABLE_FILTER_INFO[family] ? `configurable:${family}` : '';
};

//valueFamilyForFilter answers what KIND of clause a filter is, in the terms an
//OR cares about. `candidates` supplies the live corpus's own categorization
//(this id is a tag, that one is a section), because the app has no other way to
//know: a tag and a section are both bare tokens in the URL.
export const valueFamilyForFilter = (
	filter : string,
	candidates : readonly CollectionComposerCandidate[] = []
) : CompletionValueFamily => {
	const candidate = candidates.find(entry => entry.filter === filter);
	if (candidate) return `value:${candidate.category}`;
	const configurable = configurableFamily(filter);
	if (configurable) return configurable;
	//An ordinary boolean card property. All of them answer the same shape of
	//question ("is this card X?"), so `has-images or has-diagram` is a coherent
	//OR and ranks as one.
	return 'property';
};

//A node's family. An OR group takes its family from its members when they
//agree, and is `mixed` when they do not — widening an already-mixed group is
//never the confident suggestion.
export const valueFamilyForNode = (
	node : FilterExpressionNode,
	candidates : readonly CollectionComposerCandidate[] = []
) : CompletionValueFamily => {
	switch (node.kind) {
	case 'filter':
		return valueFamilyForFilter(node.filter, candidates);
	case 'not':
		//Flipping does not change what kind of question a clause answers.
		return valueFamilyForNode(node.child, candidates);
	case 'or': {
		const families = new Set(node.members.map(member => valueFamilyForNode(member, candidates)));
		return families.size === 1 ? [...families][0] : 'mixed';
	}
	case 'manual':
		//A clause this layer could not model is not a clause this layer will
		//claim to know the family of.
		return 'manual';
	}
};

//--- Valence generation ----------------------------------------------------

//The order proposal B §3.1 states — "`+` leads; `~` appears only when a
//compatible condition exists, labeled with what it widens; `–` ranked below
//unless the token starts with not/-" — plus the one refinement the engine's
//honesty forces: an INCOMPATIBLE or is offered, below `not`, rather than
//suppressed.
//
//REMOVE AND EDIT OUTRANK EVERYTHING (round 3, D2). When the typed token names a
//clause the sentence ALREADY HAS, the thing the user is reaching for is that
//clause — not a second copy of it. So the two actions that are about the clause
//they already have lead, and the ones that would add another sit under them.
const VALENCE_RANKS = {
	remove: -2,
	edit: -1,
	add: 0,
	orCompatible: 1,
	not: 2,
	orIncompatible: 3,
};

//WHEN THE USER LED WITH A NEGATION, THE NEGATION LEADS.
//
//'not published', 'exclude published', '-published', 'without tags', '!starred'.
//The prefix is stripped before matching (so 'not pub' still finds published) and
//remembered, so the `not` row is what the highlighted row already is when they
//stop typing.
//
//`exclude` is here even though it is one of the three words the palette promises
//never to SHOW (proposal C §3: "never exclude, combine, not, or invert as UI
//nouns"). That promise is about the app's vocabulary, not the user's: somebody
//who types 'exclude starred' has said exactly what they want, and answering with
//`Text contains "exclude starred"` because the word is off-limits in our copy is
//the UI refusing to hear a sentence it understands perfectly.
//
//ORDER MATTERS: longer prefixes first, so 'not ' is tried before the bare '-'
//would ever get a chance at a hyphenated token, and 'without ' before 'w'-shaped
//nothing. Each entry is checked as a literal prefix of the normalized input.
const NOT_PREFIXES = ['not ', 'exclude ', 'excluding ', 'without ', 'except ', 'no ', '-', '!'];

export type StrippedToken = {
	token : string;
	negated : boolean;
};

export const strippedNegationPrefix = (raw : string) : StrippedToken => {
	const value = normalized(raw);
	for (const prefix of NOT_PREFIXES) {
		if (!value.startsWith(prefix)) continue;
		const rest = value.slice(prefix.length).trim();
		//'-' alone, or 'not ' alone, is a person mid-word, not a negation of
		//nothing. Leave it as an ordinary token so it can still match 'not-…'
		//filters by name.
		if (!rest) continue;
		return {token: rest, negated: true};
	}
	return {token: value, negated: false};
};

const valenceRank = (kind : CompletionValenceKind, compatible : boolean, negated : boolean) : number => {
	if (kind === 'remove') return VALENCE_RANKS.remove;
	if (kind === 'edit') return VALENCE_RANKS.edit;
	if (kind === 'add') return negated ? VALENCE_RANKS.not + 0.5 : VALENCE_RANKS.add;
	//A negation the user ASKED for still leads the rows that would ADD something;
	//it does not outrank an action about a clause that already exists.
	if (kind === 'not') return negated ? VALENCE_RANKS.add - 0.5 : VALENCE_RANKS.not;
	return compatible ? VALENCE_RANKS.orCompatible : VALENCE_RANKS.orIncompatible;
};

//WHERE THIS CLAUSE ALREADY IS IN THE SENTENCE, in EITHER valence, or null.
//
//"Either valence" is the whole point: typing 'common-tools' when the sentence
//says `not common-tools` is somebody reaching for the clause they can see, and a
//search that only matched the positive spelling answered them with an offer to
//add its opposite alongside it. Negation is an involution on every node kind, so
//one comparison against the negated spelling covers both directions.
//Whether this condition's family takes arguments — the question 'is there
//anything to edit here?'. A negation is transparent to it: `not updated/…` is
//still a date clause with a date in it.
const nodeIsConfigurable = (node : FilterExpressionNode) : boolean => {
	if (node.kind === 'not') return nodeIsConfigurable(node.child);
	if (node.kind !== 'filter') return false;
	return Boolean(CONFIGURABLE_FILTER_INFO[node.filter.split('/')[0]]);
};

const existingClauseSite = (
	expression : CollectionExpression,
	spelling : string,
	negatedSpelling : string
) : {index : number, memberIndex : number, node : FilterExpressionNode} | null => {
	for (const [index, condition] of expression.entries()) {
		if (condition.kind === 'or') {
			const memberIndex = condition.members.findIndex(member => {
				const member_spelling = serializeFilterNode(member);
				return member_spelling === spelling || member_spelling === negatedSpelling;
			});
			if (memberIndex >= 0) return {index, memberIndex, node: condition.members[memberIndex]};
			continue;
		}
		const conditionSpelling = serializeFilterNode(condition);
		if (conditionSpelling === spelling || conditionSpelling === negatedSpelling) {
			return {index, memberIndex: -1, node: condition};
		}
	}
	return null;
};

//WHAT A NEGATED CLAUSE KEEPS, said as a negation.
//
//The honest authored sentence comes first: `unpublished` has one of its own in
//the synonyms module ("Cards you have not published yet…"), and a filter family
//that grows a named inverse gets its curated negative here for free. Only a
//negation the app has no word for falls through to the derived sentence, which
//is deliberately the same phrasing collectionFilterDescription already
//synthesizes for the excluding half of a named pair — one spelling of "the
//other half of this", not a second one invented here.
const negatedClauseDescription = (
	negatedNode : FilterExpressionNode,
	positiveName : string,
	filterDescriptions : Readonly<Record<string, string>>,
	labels : Record<string, string>,
	cardNames : Record<string, string>
) : string => {
	if (negatedNode.kind === 'filter') {
		const authored = collectionFilterDescription(negatedNode.filter, filterDescriptions, labels);
		if (authored) return authored;
	}
	void cardNames;
	return `Cards not matching ${positiveName}`;
};

//completionValences is D2 whole: given the clause a candidate would insert and
//the sentence as it stands, the rows that clause could become.
//
//`add` always exists — appending a condition is legal against any expression.
//`not` always exists, because negation is total in the draft layer
//(negatedExpressionNode is an involution on every node kind). `or` exists once
//per existing condition, because that is how many conditions there are to
//widen; with an empty sentence there are none, and no `or` row is generated.
export const completionValences = (
	node : FilterExpressionNode,
	expression : CollectionExpression,
	options : {
		idPrefix : string,
		negated? : boolean,
		labels? : Record<string, string>,
		cardNames? : Record<string, string>,
		candidates? : readonly CollectionComposerCandidate[],
		filterDescriptions? : Readonly<Record<string, string>>,
		//'add' asks for the plain append and nothing else. The IDLE list is the
		//whole vocabulary — hundreds of candidates — and it is a list of THINGS
		//rather than of interpretations of a token: offering each of them its
		//own or-per-condition and its own flip would turn three hundred rows
		//into fifteen hundred and bury the vocabulary inside its own valences.
		//The other valences are one typed character away, which is where the
		//design has always put them.
		only? : 'add',
	}
) : CompletionValence[] => {
	const labels = options.labels || {};
	const cardNames = options.cardNames || {};
	const candidates = options.candidates || [];
	const filterDescriptions = options.filterDescriptions || {};
	const negated = Boolean(options.negated);
	const name = describeExpressionNode(node, labels, cardNames).label;
	const nodeFamily = valueFamilyForNode(node, candidates);
	const valences : CompletionValence[] = [];

	//A ROW THAT WOULD CHANGE NOTHING IS NOT A ROW.
	//
	//`a AND a` is `a`, and `(a or a)` is `a` — the first changes the sentence
	//not at all, the second changes only its spelling. Both were offered by the
	//first cut of this function whenever the user typed a clause their draft
	//already had, which is complaint #9's dead affordance in a new place: a row
	//with a count beside it promising a consequence it cannot deliver. So a
	//condition already in the sentence suppresses its own add, and suppresses
	//the or that would widen it with itself. Its `not` survives, because
	//`a AND NOT a` really is a different (empty) collection, and the preview
	//count says so honestly.
	const spelling = serializeFilterNode(node);
	const negatedSpelling = serializeFilterNode(negatedExpressionNode(node));
	const alreadyPresent = expression.map(serializeFilterNode);

	//TYPING THE NAME OF A CLAUSE YOU ALREADY HAVE IS A REQUEST ABOUT THAT CLAUSE.
	//
	//The two actions the constitution names for an existing clause — remove it,
	//change its configuration — are generated here, ahead of everything that
	//would add a second one, and they are found by the same search in either
	//valence. `only: 'add'` skips them for the same reason it skips the rest: the
	//idle list is a list of things you could ADD, and a few hundred rows each
	//carrying their own removals is the vocabulary buried inside its own
	//valences.
	const existing = options.only === 'add' ? null : existingClauseSite(expression, spelling, negatedSpelling);
	if (existing) {
		const existingName = describeExpressionNode(existing.node, labels, cardNames).label;
		valences.push({
			id: `${options.idPrefix}:remove:${existing.index}:${existing.memberIndex}`,
			kind: 'remove',
			label: existingName,
			detail: `Takes ${existingName} back out of this collection.`,
			expression: existing.memberIndex < 0 ?
				withConditionRemoved(expression, existing.index) :
				withMemberRemoved(expression, existing.index, existing.memberIndex),
			targetIndex: existing.index,
			targetMemberIndex: existing.memberIndex,
			targetNode: existing.node,
			rank: valenceRank('remove', true, negated),
		});
		//WHETHER THE CLAUSE IN THE SENTENCE HAS ARGUMENTS, asked of THAT clause
		//rather than of the candidate that found it. 'Edit Starred' would open a
		//pill row with nothing in it; 'Edit Updated since 7 days ago' opens the
		//date controls — and the second of those is reached by typing a date
		//PHRASE, whose candidate is a plain filter and whose clause is
		//configurable, so a test on the candidate's own kind would have missed
		//exactly the family this row is most useful for.
		if (nodeIsConfigurable(existing.node)) {
			valences.push({
				id: `${options.idPrefix}:edit:${existing.index}:${existing.memberIndex}`,
				kind: 'edit',
				label: existingName,
				detail: `Opens ${existingName}’s own controls, so you can change what it matches.`,
				//THE ONE VALENCE THAT DOES NOT REWRITE THE DRAFT. Its expression is
				//the draft unchanged, which is honest: the action is "show me this
				//clause's controls". The no-op filter at the bottom exempts it by
				//kind rather than by a fake edit, so nothing downstream has to
				//pretend a change happened.
				expression,
				targetIndex: existing.index,
				targetMemberIndex: existing.memberIndex,
				targetNode: existing.node,
				rank: valenceRank('edit', true, negated),
			});
		}
	}

	if (!alreadyPresent.includes(spelling)) {
		valences.push({
			id: `${options.idPrefix}:add`,
			kind: 'add',
			label: name,
			expression: withConditionAppended(expression, node),
			rank: valenceRank('add', true, negated),
		});
	}

	if (options.only === 'add') {
		const beforeAddOnly = serializeCollectionExpression(expression).join('\n');
		return valences.filter(valence => serializeCollectionExpression(valence.expression).join('\n') !== beforeAddOnly);
	}

	//THE NOT-ROW IS ASKED FOR, NOT ISSUED WITH EVERY CANDIDATE.
	//
	//It used to be unconditional, which doubled the list for every token: typing
	//'published' produced Published, Unpublished, Unpublished and Published,
	//four rows for two collections, with the two negative ones carrying the
	//positive one's description. The design's own rule (proposal B §3.1) is
	//narrower and was never implemented: "`–` ranked below unless the token
	//starts with not/-", and the meta-proposal's Graft 1 scopes the whole
	//valence graft to "when a typed token is family-compatible with an existing
	//pill".
	//
	//So the negation appears when it has been ASKED for — the typed token led
	//with a negation prefix — or when the sentence already contains a clause of
	//the same family, which is the state where "…but not this one" is a sentence
	//somebody is plausibly in the middle of writing. Everywhere else negation is
	//still one gesture away: add the clause and press Flip (the pill row's own
	//verb, which promises the resulting word before you commit), or reach it by
	//name in Browse all.
	const familyCompatibleConditionPresent = expression.some(condition => {
		const family = valueFamilyForNode(condition, candidates);
		return family !== 'mixed' && family !== 'manual' && family === nodeFamily;
	});
	if (negated || familyCompatibleConditionPresent) {
		const negatedNode = negatedExpressionNode(node);
		valences.push({
			id: `${options.idPrefix}:not`,
			kind: 'not',
			//The app's own word when it has one — flipping `published` produces a
			//pill that reads `unpublished`, not `not published` (meta-proposal
			//convergence 2). describeExpressionNode already knows the difference, so
			//the row promises exactly the pill the flip will make.
			label: describeExpressionNode(negatedNode, labels, cardNames).label,
			detail: negatedClauseDescription(negatedNode, name, filterDescriptions, labels, cardNames),
			expression: withConditionAppended(expression, negatedNode),
			rank: valenceRank('not', true, negated),
		});
	}

	for (const [index, condition] of expression.entries()) {
		//A manual condition is text this layer refused to model. Growing an OR
		//inside it would mean rewriting a spelling we said we did not understand.
		if (condition.kind === 'manual') continue;
		//Widening a condition with a member it already contains is the same
		//no-op as above, one level down.
		//
		//AND A CLAUSE MAY NEVER BE OR'D WITH ITS OWN NEGATION (round 3, D2). `(not
		//common-tools OR common-tools)` is every card in the corpus — a row that
		//promises a refinement and delivers the universe — and it was the TOP
		//offer whenever somebody typed the name of a clause they had already
		//excluded. The guard is the same no-op rule the line above states, with
		//the negated spelling added to what counts as "already there": a clause
		//and its negation are the same clause as far as widening is concerned,
		//because their union is a tautology and their intersection is empty.
		const memberSpellings = condition.kind === 'or' ?
			condition.members.map(serializeFilterNode) :
			[serializeFilterNode(condition)];
		if (memberSpellings.includes(spelling) || memberSpellings.includes(negatedSpelling)) continue;
		const targetLabel = describeExpressionNode(condition, labels, cardNames).label;
		const conditionFamily = valueFamilyForNode(condition, candidates);
		const compatible = conditionFamily !== 'mixed' && conditionFamily !== 'manual' && conditionFamily === nodeFamily;
		valences.push({
			id: `${options.idPrefix}:or:${index}`,
			kind: 'or',
			//The sentence proposal B §2.2 writes: what it becomes, and what it
			//widens. The palette renders the widening half as the subordinate
			//clause it is.
			label: `${targetLabel} or ${name}`,
			expression: withMemberAddedToOr(expression, index, node),
			targetIndex: index,
			targetLabel,
			compatible,
			rank: valenceRank('or', compatible, negated),
		});
	}

	//THE NO-OP GUARD, EXTENDED FROM ONE NODE TO THE WHOLE EXPRESSION.
	//
	//The guards above are node-level: they refuse an `add` of a condition
	//already present and an `or` with a member the group already has. Both are
	//special cases of the same rule — a row whose result is the collection you
	//are already composing is a promise with nothing behind it — and stating the
	//rule on the RESULT catches the cases the special cases do not, including
	//the normalizations the compiler performs on the way out (a group that
	//re-spells to what it already was, a double negation that cancels).
	//
	//`edit` IS EXEMPT, BY KIND. It is the one action here that is not an edit to
	//the expression at all — it opens a clause's controls — so "its result is the
	//collection you already have" is not a broken promise, it is the promise.
	const before = serializeCollectionExpression(expression).join('\n');
	return valences
		.filter(valence => valence.kind === 'edit' || serializeCollectionExpression(valence.expression).join('\n') !== before)
		.sort((left, right) => left.rank - right.rank || left.id.localeCompare(right.id));
};

//--- The entry point -------------------------------------------------------

const SORT_NAMES : readonly string[] = Object.keys(SORTS);
const VIEW_MODES : readonly string[] = Object.keys(LEGAL_VIEW_MODES);

//A DATE FAMILY'S OWN DEFAULT ASKS FOR AN EDIT; A ROLLING WINDOW ANSWERS A
//QUESTION. `updated` defaults to `before/<today>`, which selects very nearly the
//whole corpus and means nothing until somebody changes it — a clause that has to
//be edited before it does anything is the pending-add gate in another form.
//"Updated in the last week" is what a person reaching for a date filter almost
//always means, and it is a real collection the moment it lands.
const ROLLING_DATE_FAMILIES : ReadonlySet<string> = new Set(['created', 'updated', 'last-tweeted']);

//A configurable family is offered by its FAMILY name, because its values do not
//exist yet — the palette opens its pill row next. Its node is the family spelled
//with the default below, which is the clause the engine would run if the user
//stopped there.
//
//EXPORTED because the palette adds the same family the same way when it is
//chosen from Browse all rather than typed. Two spellings of "the default clause
//for this family" is how one route ends up producing a different draft from the
//other for the same gesture.
export const defaultConfigurableFilter = (family : string) : string => {
	const configurable = CONFIGURABLE_FILTER_INFO[family];
	if (!configurable) return family;
	if (ROLLING_DATE_FAMILIES.has(family)) return `${family}/after/7-days-ago`;
	return family + '/' + configurable.arguments.map(argument => argument.default).join('/');
};

const filterNode = (filter : string) : FilterExpressionNode => ({kind: 'filter', filter});

//THE THREE WORDS THE PALETTE PROMISES NEVER TO SHOW, and the concrete reason
//the promise is also the correct engineering.
//
//`exclude`, `combine` and `expand` are the engine's boolean plumbing, and
//proposal C §3 states the vocabulary rule flatly: "never exclude, combine, not,
//or invert as UI nouns". They are reachable here as the `not` and `or`
//VALENCES, which is the entire point of the design — the user authors the same
//shapes without meeting the words.
//
//Offering them as clause candidates anyway would not merely have been off-key.
//A configurable family is offered spelled with its own defaults, and these
//three default to placeholders: `exclude/all-cards` excludes everything (a row
//that silently empties the collection), `combine/all-cards/all-cards` unions
//everything with itself, and `expand/all-cards/children/+key-card-id` names a
//key card that does not exist. Every one of those is a row with a count beside
//it that lies about what choosing it does.
//
//They keep their curated synonyms, which still serve the catalog's surviving
//"Browse all" list and source mode's completions — the two places where the
//words are the honest name for the thing.
const STRUCTURAL_FILTER_FAMILIES : ReadonlySet<string> = new Set(['combine', 'exclude', 'expand']);

//The free-text reading of a token. Two characters is where a search stops being
//a search — `query/a` matches most of a corpus — and the same threshold the
//fuzzy tier already uses would have been too generous here, because this
//candidate is offered for EVERY token rather than only for ones that match
//something.
const QUERY_FILTER_FAMILY = 'query';
const FREE_TEXT_MINIMUM_LENGTH = 2;

//SAY THAT IT MATCHES PARTIALLY. The pill reads `Text contains “systems
//thinking”`, which sounds like a promise that both words appear together; the
//row is where the user decides, so it is where the qualification belongs. Same
//sentence the suggestion module's own query row uses, so the two readings of one
//clause cannot drift.
const FREE_TEXT_DETAIL = 'Keeps cards whose text matches this query, including cards matching only some of its words';

//A URL IS A FEATURE OF THIS PRODUCT, so pasting one is a first-class gesture.
//
//Every collection in this app IS a URL; the composer's own footer prints the
//one the draft would open. A user who copies that line out of one window and
//pastes it into another was given `Text contains “/c/main/starred/”` — the
//literal reading, offered because nothing else claimed the token. The parser
//that would have recognized it is already a dependency of this module's own
//suggestion path, so this is not new machinery, only a call.
//
//ONE row, not a list of interpretations: a source either parses into a
//collection or it does not, and when it does there is exactly one collection it
//names. A source the parser calls incomplete or invalid produces nothing at
//all, and the free-text reading below is then the honest answer.
const SOURCE_SHAPED = /\/|^https?:/i;

const pastedCollectionSource = (
	rawToken : string,
	context : CollectionCompletionContext,
	filterDescriptions : Readonly<Record<string, string>>
) : CompletionCandidate | null => {
	const query = rawToken.trim();
	if (!query || !SOURCE_SHAPED.test(query)) return null;
	const parsed = parseCollectionSource(query, {
		ordinaryFilters: new Set([...Object.keys(CARD_FILTER_DESCRIPTIONS), ...Object.keys(filterDescriptions)]),
		preservedSelectedCard: context.preservedSelectedCard,
		allowedOrigins: context.sourceAllowedOrigins,
	});
	if (!parsed.description || !parsed.canonicalPath) return null;
	const labels = collectionFilterLabels(context.candidates || []);
	const cardNames = context.cardNames || {};
	return {
		id: `source:${parsed.description.serialize()}`,
		kind: 'source',
		label: readableCollectionExpression(parsed.description, labels, cardNames),
		detail: 'Opens the collection this link names',
		//PARSED, NOT GUESSED. The user handed the app a collection written in the
		//app's own URL grammar and the parser accepted it; there is no
		//interpretation left to rank against.
		tier: 'parsed',
		score: TIER_SCORES['parsed'],
		matchedOn: query,
		description: parsed.description,
		destinationPath: parsed.canonicalPath,
		//A destination, not an edit — the same rule a recent follows.
		valences: [],
		viewerDependent: filterNamesAreViewerDependent(parsed.description.filters),
	};
};

export type CollectionCompletionOptions = {
	//What the user typed, verbatim. Negation prefixes are stripped here, not by
	//the caller, so every consumer strips them the same way.
	token : string;
	//The sentence as it stands, which is what the valences edit.
	expression : CollectionExpression;
	//The draft as a whole, which is what the destination kinds replace. The
	//expression and the description are passed separately because they are edited
	//separately — a set is not a condition.
	description : CollectionDescription;
	context? : CollectionCompletionContext;
	//How many candidates to return. The palette shows one list.
	limit? : number;
};

//HOW MANY CANDIDATES ONE CALL RETURNS BY DEFAULT. Unchanged for the typed case,
//and deliberately not the number the idle list uses — the idle caller asks for
//the whole vocabulary explicitly, because "the list IS browse-all" is a decision
//the palette makes, not a default this module quietly imposes.
const DEFAULT_CANDIDATE_LIMIT = 8;

const EMPTY_USAGE : CompletionUsageWeights = {};
const EMPTY_IDF_INDEX : CompletionIDFIndex = {idf: {}, documents: {}, documentCount: 0};

//THE SENTENCE WORDS DECLINE THE DESCRIPTION TIER, said once rather than by a
//boolean threaded through the matcher. See sentenceWord below for why.
const NO_DESCRIPTION_MATCH = () => ({score: 0, matchedOn: ''});

//THE WORDS PEOPLE ACTUALLY TYPE FOR THE SINGLETONS.
//
//These three lists are short because the vocabulary is short, and they are
//curated for the same reason the filter synonyms are: 'everything', 'reading
//list', 'newest', 'grid' are what somebody types, and none of them is a prefix
//of the name the app displays. They are matched at the ALIAS tier like any other
//synonym, so a set named by its own name still wins.
const SET_ALIASES : Readonly<Record<string, readonly string[]>> = {
	'everything': ['all', 'all cards', 'whole corpus', 'unfiltered', 'anything'],
	'main': ['sections', 'the sections', 'published sections', 'default'],
	'reading-list': ['reading list', 'queue', 'to read', 'saved for later', 'later'],
};

const SORT_ALIASES : Readonly<Record<string, readonly string[]>> = {
	'default': ['section order', 'natural order', 'as filed'],
	'original-order': ['section order', 'natural order', 'as filed'],
	'stars': ['sort by stars', 'most starred', 'popular', 'favorites', 'best'],
	'updated': ['newest', 'most recently updated', 'freshest', 'latest'],
	'created': ['newest', 'most recently created', 'youngest', 'latest'],
	'recent': ['newest', 'latest activity', 'most recent'],
	'link-count': ['most linked', 'inbound links', 'most referenced'],
	'commented': ['most recently discussed', 'latest comments'],
	'card-rank': ['page rank', 'most important', 'authority'],
	'random': ['shuffle', 'surprise me', 'any order'],
	'todo-difficulty': ['hardest todos', 'by difficulty'],
	'tweet-count': ['most tweeted'],
	'tweet-order': ['most tweetable'],
	'last-tweeted': ['least recently tweeted'],
};

const VIEW_ALIASES : Readonly<Record<string, readonly string[]>> = {
	'list': ['grid', 'cards', 'card grid', 'gallery', 'normal'],
	'web': ['graph', 'map', 'network', 'diagram', 'links'],
};

//PEOPLE SAY THE VERB WITH THE NOUN. 'by stars', 'sort by stars', 'start from
//everything', 'show as grid' — the preposition is part of how the phrase is
//typed, and none of it is a prefix of the display name, so without these the
//whole phrase falls past the name tiers into the guess floor.
//
//`order by …` is deliberately ABSENT. It begins with the letters 'or', and an
//alias-prefix match on those would put every sort in the app above whatever the
//user was actually reaching for — the exact regression the sentence-word matcher
//was narrowed to prevent, reintroduced through the back door of an alias table.
const phrasedAliases = (kind : CompletionCandidateKind, displayName : string) : string[] => {
	const name = displayName.toLowerCase();
	if (kind === 'sort') return [`by ${name}`, `sort by ${name}`, `sorted by ${name}`];
	if (kind === 'set') return [`from ${name}`, `start from ${name}`, `starting from ${name}`];
	return [`as ${name}`, `show as ${name}`, `shown as ${name}`];
};

//THE DOCUMENT SET THE DESCRIPTION TIER'S IDF IS COMPUTED OVER: one document per
//candidate, made of its name, its aliases and its description. The list's
//IDENTITY is what the IDF module caches on, so this is memoized on the inputs
//that can change it — the live corpus's candidates, the filter registry, the tag
//metadata. A keystroke never rebuilds it.
let documentsMemo : {
	candidates : readonly CollectionComposerCandidate[],
	filterDescriptions : Readonly<Record<string, string>>,
	tagInfos : TagInfos,
	labels : Record<string, string>,
	documents : CompletionDocument[],
} | null = null;

const completionDocumentsFor = (
	candidates : readonly CollectionComposerCandidate[],
	filterDescriptions : Readonly<Record<string, string>>,
	tagInfos : TagInfos,
	labels : Record<string, string>,
	cardNames : Record<string, string>
) : CompletionDocument[] => {
	if (
		documentsMemo &&
		documentsMemo.candidates === candidates &&
		documentsMemo.filterDescriptions === filterDescriptions &&
		documentsMemo.tagInfos === tagInfos &&
		documentsMemo.labels === labels
	) return documentsMemo.documents;
	const documents : CompletionDocument[] = [];
	for (const candidate of candidates) {
		const label = collectionFilterDisplayName(candidate.filter, labels, cardNames);
		documents.push({
			id: `value:${candidate.category}:${candidate.filter}`,
			text: [
				label,
				...(candidate.aliases || []),
				...filterSynonyms(candidate.filter),
				tagInfos[candidate.filter]?.description || '',
				candidate.detail,
			].filter(Boolean).join(' '),
		});
	}
	for (const name of Object.keys(filterDescriptions)) {
		if (candidates.some(candidate => candidate.filter === name)) continue;
		if (STRUCTURAL_FILTER_FAMILIES.has(name)) continue;
		const configurable = Boolean(CONFIGURABLE_FILTER_INFO[name]);
		const filter = configurable ? defaultConfigurableFilter(name) : name;
		documents.push({
			id: configurable ? `family:${name}` : `filter:${filter}`,
			text: [
				collectionFilterDisplayName(configurable ? name : filter, labels),
				...filterSynonyms(name),
				collectionFilterDescription(name, filterDescriptions, labels),
			].filter(Boolean).join(' '),
		});
	}
	documentsMemo = {candidates, filterDescriptions, tagInfos, labels, documents};
	return documents;
};

//THE ONE ENTRY POINT THE PALETTE CALLS.
export const collectionCompletionCandidates = (
	options : CollectionCompletionOptions
) : CompletionCandidate[] => {
	const context = options.context || {};
	const {token, negated} = strippedNegationPrefix(options.token);
	const candidates = context.candidates || [];
	const labels = collectionFilterLabels(candidates);
	const cardNames = context.cardNames || {};
	const filterDescriptions = context.filterDescriptions || {};
	const tagInfos = context.tagInfos || {};
	const expression = options.expression;
	const usage = context.usage || EMPTY_USAGE;
	//THE IDLE LIST IS THE SAME LIST WITH NOTHING TYPED YET.
	//
	//The owner's model is one ranked list over the entire vocabulary that typing
	//FILTERS. So there is no second code path for "idle": an empty token means
	//every candidate matches, at the `vocabulary` tier, ranked by personal
	//likelihood alone. A separate idle generator is exactly how the old build
	//came to show a capped list of three things that had nothing to do with the
	//list you got as soon as you typed a character.
	const browsing = !token;

	//THE IDF TABLE, built once per vocabulary rather than once per keystroke.
	//It is keyed on the document list's identity inside the IDF module, and the
	//document list is rebuilt only when the corpus or the metadata behind it
	//changes.
	const idfIndex = browsing ? EMPTY_IDF_INDEX : completionIDFIndexFor(
		completionDocumentsFor(candidates, filterDescriptions, tagInfos, labels, cardNames)
	);
	const tokenPairs = browsing ? [] : completionStemPairs(token);
	const tokenStems = tokenPairs.map(pair => pair.stem);

	const results : CompletionCandidate[] = [];
	const seen = new Set<string>();

	//WHAT IS ALREADY IN THE SENTENCE, as families, so a candidate that continues
	//the thought the user is already having ranks above one that starts a new
	//one. This is the "what's already in the collection description" half of the
	//owner's likelihood model.
	const presentFamilies = new Set(
		expression
			.map(condition => valueFamilyForNode(condition, candidates))
			.filter(family => family !== 'mixed' && family !== 'manual')
	);

	//The description tier for one candidate, deferred so it costs nothing for
	//the candidates that matched at a name tier — which is most of them.
	const descriptionScoreFor = (id : string) => () => browsing ? {score: 0, matchedOn: ''} : {
		score: completionDescriptionScore(idfIndex, id, tokenStems),
		matchedOn: completionDescriptionMatchedWord(idfIndex, id, tokenPairs),
	};

	//IDLE MATCHES EVERYTHING, EQUALLY. The quality term is zero for every row,
	//so the whole of the idle ordering is personal likelihood — usage, corpus
	//fit, context, and the kind prior — which is the list the owner asked for.
	const browseMatch : Match = {tier: 'vocabulary', matchedOn: '', quality: 0};

	const clauseCandidate = (
		id : string,
		kind : CompletionCandidateKind,
		filter : string,
		label : string,
		detail : string,
		match : Match,
		extra : {usageKey? : string, annotation? : string, corpusCount? : number} = {}
	) => {
		if (seen.has(id)) return;
		seen.add(id);
		const node = filterNode(filter);
		//`??`, not `||`: the free-text guess passes '' DELIBERATELY, meaning "there
		//is nothing here worth learning". With `||` that empty string fell back to
		//the default key and the ranking learned that this person likes searching
		//card text in general — which is not a fact about any candidate it can
		//offer them next time.
		const usageKey = extra.usageKey ?? `filter:${filter}`;
		results.push({
			id,
			kind,
			label,
			detail,
			tier: match.tier,
			score: scoreFor(match.tier, {
				kind,
				quality: match.quality,
				usage: usage[usageKey] || 0,
				corpusCount: extra.corpusCount || 0,
				familyPresent: presentFamilies.has(valueFamilyForFilter(filter, candidates)),
			}),
			matchedOn: match.matchedOn,
			filter,
			node,
			usageKey,
			annotation: extra.annotation,
			valences: completionValences(node, expression, {
				idPrefix: id,
				negated,
				labels,
				cardNames,
				candidates,
				filterDescriptions,
				only: browsing ? 'add' : undefined,
			}),
			viewerDependent: filterNameIsViewerDependent(filter),
		});
	};

	//A PASTED COLLECTION IS AN ANSWER, NOT A GUESS. Offered first because it is
	//the only interpretation the app can be certain of: the user handed it a
	//collection written in the app's own URL grammar, and the parser accepted
	//it. Without this the palette read a pasted link as free text and offered
	//`Text contains “http://…”`.
	const pastedSource = browsing ? null : pastedCollectionSource(options.token, context, filterDescriptions);
	if (pastedSource && !seen.has(pastedSource.id)) {
		seen.add(pastedSource.id);
		results.push(pastedSource);
	}

	//A DATE PHRASE IS A PARSE, NOT A GUESS (D5). 'last 7 days' is not the name
	//of anything, so every tier below would have missed it and the honest floor —
	//`Text contains "last 7 days"` — would have led the list with a search over
	//card prose for the word 'days'. The grammar is deterministic and lives in
	//its own module; when it accepts, its clauses lead, spelled as the pill they
	//would become ('Updated in the last 7 days').
	const datePhrase = browsing ? null : parseCollectionDatePhrase(token, context.now);
	if (datePhrase) {
		for (const [order, filter] of collectionDatePhraseFilters(datePhrase).entries()) {
			const family = filter.split('/')[0];
			clauseCandidate(
				`filter:${filter}`,
				'filter',
				filter,
				collectionFilterDisplayName(filter, labels),
				collectionFilterDescription(family, filterDescriptions, labels),
				//THE PARSER'S OWN ORDER SURVIVES ITS SCORING. A phrase that
				//names no field offers both, and the grammar says which comes
				//first (updated: "when did this change" is asked far more often
				//than "when did this begin"). Without this term the two rows
				//scored identically and the alphabetical tiebreak silently put
				//Created on top.
				{tier: 'parsed', matchedOn: token, quality: MATCH_QUALITY_MAXIMUM - order * 1000},
				{usageKey: `family:${family}`, annotation: 'date'}
			);
		}
	}

	//RECENTS FIRST, as content rather than as a section. They are built by the
	//existing recents generator, so a recent row here and a recent row in the
	//idle list are the same row with the same id, name and dedupe.
	//
	//IDLE DOES NOT GENERATE THEM HERE. The idle feed builds its recents through
	//collectionCompletionIdleRows, which already dedupes them against the draft
	//and the collection on screen; generating a second copy at the vocabulary
	//tier would put every recent in the list twice.
	//
	//WEAK MATCHES ARE CAPPED. See WEAK_MATCH_RECENT_LIMIT: a name-tier match is
	//evidence the user meant that collection and every one of those is offered;
	//a generic token that merely appears in three recents' detail lines is not,
	//and it must not push the first real interpretation of what was typed below
	//the fold.
	let weakRecents = 0;
	for (const recent of browsing ? [] : collectionComposerRecentSuggestions(options.description, context)) {
		const match = matchTier(token, recent.name, [], () => {
			//A recent has no document in the vocabulary table — it is a
			//collection, not a filter — so its prose is matched by the same
			//stem test, weighted by the table's own IDF. One rule, one corpus.
			const stems = new Set(completionStems(recent.detail));
			let score = 0;
			let matchedOn = '';
			for (const pair of tokenPairs) {
				if (!stems.has(pair.stem)) continue;
				score += idfIndex.idf[pair.stem] || 0;
				if (!matchedOn) matchedOn = pair.word;
			}
			return {score, matchedOn};
		});
		if (!match) continue;
		if (!NAME_TIERS.has(match.tier)) {
			if (weakRecents >= WEAK_MATCH_RECENT_LIMIT) continue;
			weakRecents++;
		}
		if (seen.has(recent.id)) continue;
		seen.add(recent.id);
		results.push({
			id: recent.id,
			kind: 'recent',
			label: recent.name,
			detail: recent.detail,
			tier: match.tier,
			score: scoreFor(match.tier, {
				kind: 'recent',
				quality: match.quality,
				usage: 0,
				corpusCount: 0,
				familyPresent: false,
			}),
			matchedOn: match.matchedOn,
			description: recent.description,
			//A recent is a destination, not an edit. Offering it valences would
			//mean offering to AND somebody's whole saved collection onto the
			//draft, which is not what clicking a recent has ever meant.
			valences: [],
			viewerDependent: Boolean(recent.viewerDependent),
		});
	}

	//VALUES — the live corpus's tags, sections, people, card types, and the
	//seeded date and relationship clauses. Their `description` prose comes from
	//tagInfos, which is where a tag's authored explanation lives.
	for (const candidate of candidates) {
		const id = `value:${candidate.category}:${candidate.filter}`;
		const label = collectionFilterDisplayName(candidate.filter, labels, cardNames);
		const tagDescription = tagInfos[candidate.filter]?.description || '';
		const match = browsing ? browseMatch : matchTier(
			token,
			label,
			[
				...(candidate.aliases || []),
				...(candidate.searchValues || []),
				...filterSynonyms(candidate.filter),
			],
			descriptionScoreFor(id)
		);
		if (!match) continue;
		clauseCandidate(
			id,
			'value',
			candidate.filter,
			label,
			tagDescription || candidate.detail,
			match,
			{
				usageKey: `value:${candidate.filter}`,
				annotation: candidate.category,
				//CORPUS FIT: a tag on four hundred cards is a likelier
				//destination than a tag on one, and the selector knows the
				//difference. Absent for the kinds that have no count (a card
				//type, a person), which simply score zero on this term.
				corpusCount: candidate.corpusCount || 0,
			}
		);
	}

	//FILTERS AND CONFIGURABLE FAMILIES — the WHOLE registry, because the owner's
	//model is that the list never hides the full set of filters: "don't hide the
	//full set of filters — it shows the power". With a token this is a filter;
	//with none it is the browsable vocabulary itself.
	for (const name of Object.keys(filterDescriptions)) {
		//A name the live corpus already offered as a value is that value, not a
		//second row for the same clause.
		if (candidates.some(candidate => candidate.filter === name)) continue;
		//THE ENGINE'S BOOLEAN PLUMBING IS REACHABLE, AS SOURCE.
		//
		//`exclude`, `combine` and `expand` still may not be offered as CLAUSES —
		//their defaults are placeholders (`exclude/all-cards` empties the
		//collection) and a row with a count beside it must not lie about what
		//choosing it does. But the vocabulary is supposed to be complete, and
		//before this they were reachable only through the deleted Browse-all
		//feed, so deleting that feed would have deleted them from the product.
		//They come back as what they honestly are: a row that opens Source at
		//that family. The user still never meets the words as UI nouns — the row
		//is only reached by typing one.
		if (STRUCTURAL_FILTER_FAMILIES.has(name)) {
			const structuralID = `source-family:${name}`;
			const structuralLabel = collectionFilterDisplayName(name, labels);
			const structuralDetail = collectionFilterDescription(name, filterDescriptions, labels);
			const structuralMatch = browsing ? browseMatch : matchTier(token, structuralLabel, filterSynonyms(name), descriptionScoreFor(structuralID));
			if (!structuralMatch || seen.has(structuralID)) continue;
			seen.add(structuralID);
			results.push({
				id: structuralID,
				kind: 'filter-family',
				label: structuralLabel,
				detail: structuralDetail,
				tier: structuralMatch.tier,
				score: scoreFor(structuralMatch.tier, {
					kind: 'filter-family',
					quality: structuralMatch.quality,
					usage: usage[structuralID] || 0,
					corpusCount: 0,
					familyPresent: false,
				}),
				matchedOn: structuralMatch.matchedOn,
				filter: name,
				sourceFilter: name,
				usageKey: structuralID,
				annotation: 'source',
				//Not an edit this layer can make: no valences, no description.
				valences: [],
				viewerDependent: false,
			});
			continue;
		}
		const configurable = Boolean(CONFIGURABLE_FILTER_INFO[name]);
		const filter = configurable ? defaultConfigurableFilter(name) : name;
		const id = configurable ? `family:${name}` : `filter:${filter}`;
		const label = collectionFilterDisplayName(configurable ? name : filter, labels);
		const detail = collectionFilterDescription(name, filterDescriptions, labels);
		const match = browsing ? browseMatch : matchTier(token, label, filterSynonyms(name), descriptionScoreFor(id));
		if (!match) continue;
		clauseCandidate(
			id,
			configurable ? 'filter-family' : 'filter',
			filter,
			label,
			detail,
			match,
			{usageKey: id, annotation: configurable ? 'family' : 'filter'}
		);
	}

	//WHATEVER ELSE THEY MEANT, THEY MEANT THE WORDS THEY TYPED.
	//
	//Every other candidate here is a NAME the user might have been reaching for.
	//A free-text query is the interpretation that is always available and always
	//literal — proposal B §2.2 puts `+ text contains "sys"` in its own mock — and
	//it is the only row that can answer a token no name matches at all. Without
	//it, typing a phrase that is not a filter's name produces an empty list, and
	//the typed-token spine the whole design rests on has a hole in it.
	//
	//It is scored in the GUESS tier, which is the ranked FLOOR by arithmetic: no
	//accumulation of personal usage, corpus fit or context can lift it above a
	//real name match. A user who typed 'star' meant the Starred filter, and the
	//literal reading is the fallback rather than the answer — it is labeled as
	//the guess it is. The token used is the RAW one, with any negation prefix
	//stripped, because that is the text the clause will search for.
	if (!browsing && token.length >= FREE_TEXT_MINIMUM_LENGTH) {
		const filter = `${QUERY_FILTER_FAMILY}/${token}`;
		clauseCandidate(
			`filter:${filter}`,
			'filter',
			filter,
			collectionFilterDisplayName(filter, labels),
			//THE FALLBACK SAYS THAT IT IS ONE. 'Search card text for "stale"' is
			//what this row actually does, and naming it that way is what stops it
			//reading as a confident interpretation when it is the last one.
			`Search card text for “${token}” — the fallback when nothing else matches. ${FREE_TEXT_DETAIL}.`,
			{tier: 'guess', matchedOn: token, quality: 0},
			//A guess is not a habit. Recording acceptances of it would teach the
			//ranking that this user likes free-text search in general, which is
			//not a fact about any candidate the list can offer next time.
			{usageKey: '', annotation: 'text'}
		);
	}

	//SET, SORT AND VIEW ARE WORDS IN THE SENTENCE (meta-proposal convergence 7),
	//so they are typeable like every other word — and they are SINGLETONS. A
	//collection has exactly one set, one sort and one view, so accepting one of
	//these REPLACES the word rather than appending a clause; they change the
	//description rather than the expression, which is why they carry no valences
	//and why the palette must never stack them.
	const sentenceWord = (
		id : string,
		kind : CompletionCandidateKind,
		name : string,
		label : string,
		detail : string,
		aliases : readonly string[],
		description : CollectionDescription
	) => {
		//A SENTENCE WORD IS NAMED, NOT DESCRIBED. There are three sets, two
		//views, and a short list of sorts; a person types their names. Matching
		//their prose instead turned the generated line 'Orders this collection
		//by …' into a hit for the token 'or', which put every sort in the app
		//above whatever the user was actually reaching for. So these kinds match
		//by name, by their URL token and by curated aliases, and stop there —
		//the description closure below always answers zero.
		const match = browsing ? browseMatch : matchTier(
			token,
			label,
			[name, ...aliases, ...phrasedAliases(kind, label)],
			NO_DESCRIPTION_MATCH
		);
		//And a typo is a name mistake, so it stays; the tiers below a name are
		//what this kind declines.
		if (!match || match.tier === 'description' || match.tier === 'structural') return;
		if (seen.has(id)) return;
		seen.add(id);
		results.push({
			id,
			kind,
			label,
			detail,
			tier: match.tier,
			score: scoreFor(match.tier, {
				kind,
				quality: match.quality,
				usage: usage[id] || 0,
				corpusCount: 0,
				familyPresent: false,
			}),
			matchedOn: match.matchedOn,
			description,
			valences: [],
			viewerDependent: false,
			usageKey: id,
			annotation: kind,
			singleton: true,
		});
	};

	//THE CURRENT VALUE IS NOT A CANDIDATE. Choosing the set you are already in is
	//a no-op with a count beside it — the same dead affordance the valence layer
	//refuses one level down. The sentence itself always shows which one is in
	//force, and the word's own list marks it; this list is of CHANGES.
	for (const name of context.setNames || SET_NAMES) {
		if (name === options.description.set) continue;
		sentenceWord(
			`set:${name}`,
			'set',
			name,
			collectionOptionDisplayName(name),
			`Starts this collection from the ${collectionOptionDisplayName(name)} set instead.`,
			SET_ALIASES[name] || [],
			collectionDescriptionWithSet(options.description, name as SetName)
		);
	}
	for (const name of context.sortNames || SORT_NAMES) {
		if (name === options.description.sort) continue;
		sentenceWord(
			`sort:${name}`,
			'sort',
			name,
			collectionOptionDisplayName(name),
			SORTS[name as SortName]?.description || `Orders this collection by ${collectionOptionDisplayName(name)}.`,
			SORT_ALIASES[name] || [],
			collectionDescriptionWithSort(options.description, name as SortName)
		);
	}
	for (const name of context.viewModes || VIEW_MODES) {
		if (name === options.description.viewMode) continue;
		sentenceWord(
			`view:${name}`,
			'view',
			name,
			collectionOptionDisplayName(name),
			`Shows this collection as ${collectionOptionDisplayName(name)}.`,
			VIEW_ALIASES[name] || [],
			collectionDescriptionWithViewMode(options.description, name as ViewMode)
		);
	}

	return results
		.sort((left, right) => left.score - right.score || left.label.localeCompare(right.label) || left.id.localeCompare(right.id))
		.slice(0, options.limit === undefined ? DEFAULT_CANDIDATE_LIMIT : options.limit);
};

//--- The idle contract -----------------------------------------------------

//RECENTS + AT MOST 3. The meta-proposal's Graft 1 states the whole contract in
//one clause — "Idle suggestions capped at recents + 3 deterministic contextual
//rows" — and it is the owner's complaint #6 ("random suggestions") answered by
//arithmetic.
export const IDLE_CONTEXTUAL_ROW_LIMIT = 3;

export type CollectionCompletionIdleRows = {
	recents : CollectionComposerSuggestion[];
	contextual : CollectionComposerSuggestion[];
};

//DETERMINISTIC BECAUSE IT IS THE SAME GENERATOR, not because it re-sorts a
//random one. The existing empty-state path already dedupes against the draft
//AND the collection on screen, already suppresses a recent that a refinement
//rebuilds, and already orders recents ahead of refinements. All this adds is
//the cap the redesign promises — so two calls with the same inputs cannot
//differ, and neither can this list and the list the current composer shows.
export const collectionCompletionIdleRows = (
	description : CollectionDescription,
	context : CollectionCompletionContext = {}
) : CollectionCompletionIdleRows => {
	const rows = collectionComposerSuggestions(
		description,
		'',
		//The empty-state path does not consult descriptions, but passing the real
		//ones keeps this call identical to the one the palette makes when typing.
		{...(context.filterDescriptions || {})},
		context
	);
	return {
		recents: rows.filter(row => row.kind === 'recent'),
		contextual: rows.filter(row => row.kind !== 'recent').slice(0, IDLE_CONTEXTUAL_ROW_LIMIT),
	};
};

//--- Applying ---------------------------------------------------------------

//The seam back to the engine, for a caller that has chosen a valence: the
//expression the row carries, compiled into the `filters[]` an engine run
//consumes. Exists so the palette never reaches for serializeCollectionExpression
//itself and so the preview and the commit compile the same way.
export const filtersForValence = (valence : CompletionValence) : string[] =>
	serializeCollectionExpression(valence.expression);

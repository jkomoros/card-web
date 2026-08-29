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
	withMemberAddedToOr,
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
} from './collection-composer-suggestions.js';

import {
	filterSynonyms,
} from './collection-filter-synonyms.js';

import {
	CONFIGURABLE_FILTER_INFO,
	SORTS,
	filterNameIsViewerDependent,
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
	| 'set'
	| 'sort'
	| 'view';

//THE TIERS, in the order the task and proposal C §2b state them. The names are
//the vocabulary a failing ranking test should speak in.
export type CompletionMatchTier =
	| 'name-exact'
	| 'name-prefix'
	| 'alias'
	| 'description'
	| 'fuzzy';

//THE SCORE IS THREE DIGITS IN ONE NUMBER, in strict order of authority:
//
//    TIER (thousands)  ·  KIND (twenties)  ·  quality of the match (units)
//
//The magnitudes are chosen so a lower place can never carry a higher one: the
//largest possible kind term (120) is smaller than one tier step (1000), and the
//largest possible quality term (~10) is smaller than one kind step (20). A tier
//boundary is a promise about order, so it is kept by arithmetic rather than by
//care — no accumulation of tiebreakers can promote a description match above an
//alias match, and no name-prefix nicety can promote a filter above a recent
//that matched just as well.
const TIER_SCORES : Record<CompletionMatchTier, number> = {
	'name-exact': 0,
	'name-prefix': 1000,
	'alias': 2000,
	'description': 3000,
	'fuzzy': 4000,
};

//RECENTS RANK FIRST AMONG EQUALS. A recent that matched at the same tier as a
//raw filter is a collection the user has actually been IN, which is strictly
//more evidence than a name that merely also matches (meta-proposal convergence
//4). It is a tiebreak, not a tier: a recent matched by a fuzzy subsequence
//still loses to a filter matched by its own name.
const KIND_STEP = 20;

const KIND_RANK : Record<CompletionCandidateKind, number> = {
	'recent': 0,
	'value': 1,
	'filter': 2,
	'filter-family': 3,
	'set': 4,
	'sort': 5,
	'view': 6,
};

export type CompletionValenceKind = 'add' | 'or' | 'not';

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
	//The expression this row would produce, whole.
	expression : CollectionExpression;
	//For 'or' only: WHICH condition it widens. Proposal B §3.1 requires the row
	//to be "labeled with what it widens", so the palette is handed both the
	//index (to highlight the pill) and the name (to say it).
	targetIndex? : number;
	targetLabel? : string;
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
	//Present for the destination kinds ('recent') and the sentence-word kinds
	//('set'/'sort'/'view'): the description this candidate would produce. These
	//are not expression edits — a set is not a condition — so they carry a
	//description instead of valences.
	description? : CollectionDescription;
	//Empty for the non-clause kinds.
	valences : CompletionValence[];
	//True when this clause's membership is computed from the signed-in account.
	viewerDependent : boolean;
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
};

//--- Matching --------------------------------------------------------------

const normalized = (value : string) : string => value.trim().toLowerCase();

//A DESCRIPTION MATCHES BY WORD PREFIX, NOT BY SUBSTRING.
//
//Substring matching on prose is what makes a search feel haunted: typing 'or'
//matches "auth-OR", "categ-OR-ized", and "col-OR". Prose is long, so it has a
//lot of interior. A description therefore matches only when the token starts a
//WORD in it, which is the only kind of match a reader can see the reason for.
const wordPrefixMatch = (prose : string, token : string) : string => {
	if (!prose || !token) return '';
	for (const word of prose.toLowerCase().split(/[^a-z0-9]+/)) {
		if (word.startsWith(token)) return word;
	}
	return '';
};

//FUZZY IS A SUBSEQUENCE, AND IT IS LAST FOR A REASON.
//
//'tgs' finding 'tags' is a real recovery from a typo; 'tgs' finding
//'not-automatically-prioritized' is noise wearing the same clothes. So fuzzy
//requires three characters (below that every candidate matches something) and
//refuses to span more than a bounded stretch of the haystack, which is what
//separates a typo from a coincidence.
const FUZZY_MINIMUM_TOKEN_LENGTH = 3;
const FUZZY_MAXIMUM_SPAN = 24;

const fuzzyMatch = (haystack : string, token : string) : boolean => {
	if (token.length < FUZZY_MINIMUM_TOKEN_LENGTH) return false;
	const value = haystack.toLowerCase();
	let start = -1;
	let position = 0;
	for (const character of token) {
		position = value.indexOf(character, position);
		if (position < 0) return false;
		if (start < 0) start = position;
		position++;
	}
	return position - start <= FUZZY_MAXIMUM_SPAN;
};

type Match = {
	tier : CompletionMatchTier;
	matchedOn : string;
};

//THE ONE SCORING FUNCTION, and the whole of the tier contract:
//
//  1. name-exact   the display name IS the token
//  2. name-prefix  the display name STARTS WITH the token (any word of it)
//  3. alias        a curated synonym, a candidate alias, or a searchValue
//  4. description  the token starts a word in the prose (filter descriptions
//                  AND tagInfos[].description)
//  5. fuzzy        the token's characters appear in order, close together
//
//Every caller passes the same four buckets, so a tag, a filter family and a
//recent collection are all ranked by one rule and cannot drift into three.
const matchTier = (
	token : string,
	name : string,
	aliases : readonly string[],
	prose : readonly string[]
) : Match | null => {
	const normalizedName = normalized(name);
	if (normalizedName === token) return {tier: 'name-exact', matchedOn: name};
	if (normalizedName.startsWith(token)) return {tier: 'name-prefix', matchedOn: name};
	//A name is often a phrase ('Updated since 7 days ago'), and typing a word
	//from the middle of it is still typing its name. Ranked inside the prefix
	//tier rather than below it, with a point of penalty so the whole-name prefix
	//wins when both match.
	const nameWord = wordPrefixMatch(name, token);
	if (nameWord) return {tier: 'name-prefix', matchedOn: nameWord};
	for (const alias of aliases) {
		const normalizedAlias = normalized(alias);
		if (normalizedAlias === token || normalizedAlias.startsWith(token)) {
			return {tier: 'alias', matchedOn: alias};
		}
	}
	for (const sentence of prose) {
		const word = wordPrefixMatch(sentence, token);
		if (word) return {tier: 'description', matchedOn: word};
	}
	if (fuzzyMatch(name, token)) return {tier: 'fuzzy', matchedOn: name};
	for (const alias of aliases) {
		if (fuzzyMatch(alias, token)) return {tier: 'fuzzy', matchedOn: alias};
	}
	return null;
};

const scoreFor = (match : Match, kind : CompletionCandidateKind, name : string, token : string) : number => {
	//The units place: inside the prefix tier, a match on the whole name beats a
	//match on a word in the middle of it, and a shorter name beats a longer one
	//— the token is a larger fraction of what the user actually named. This
	//discriminates BETWEEN two candidates of the same kind and never across
	//kinds, which is the whole reason it is confined to the units place.
	let quality = 0;
	if (match.tier === 'name-prefix') {
		if (!normalized(name).startsWith(token)) quality += 10;
		quality += Math.min(name.length, 40) / 100;
	}
	return TIER_SCORES[match.tier] + KIND_RANK[kind] * KIND_STEP + quality;
};

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
const VALENCE_RANKS = {
	add: 0,
	orCompatible: 1,
	not: 2,
	orIncompatible: 3,
};

//WHEN THE USER LED WITH A NEGATION, THE NEGATION LEADS.
//
//'not published', '-published', 'without tags', 'except starred'. The prefix is
//stripped before matching (so 'not pub' still finds published) and remembered,
//so the `not` row is what the highlighted row already is when they stop typing.
const NOT_PREFIXES = ['not ', 'no ', 'without ', 'except ', '-', '!'];

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
	if (kind === 'add') return negated ? VALENCE_RANKS.not + 0.5 : VALENCE_RANKS.add;
	if (kind === 'not') return negated ? -1 : VALENCE_RANKS.not;
	return compatible ? VALENCE_RANKS.orCompatible : VALENCE_RANKS.orIncompatible;
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
	}
) : CompletionValence[] => {
	const labels = options.labels || {};
	const cardNames = options.cardNames || {};
	const candidates = options.candidates || [];
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
	const alreadyPresent = expression.map(serializeFilterNode);

	if (!alreadyPresent.includes(spelling)) {
		valences.push({
			id: `${options.idPrefix}:add`,
			kind: 'add',
			label: name,
			expression: withConditionAppended(expression, node),
			rank: valenceRank('add', true, negated),
		});
	}

	const negatedNode = negatedExpressionNode(node);
	valences.push({
		id: `${options.idPrefix}:not`,
		kind: 'not',
		//The app's own word when it has one — flipping `published` produces a
		//pill that reads `unpublished`, not `not published` (meta-proposal
		//convergence 2). describeExpressionNode already knows the difference, so
		//the row promises exactly the pill the flip will make.
		label: describeExpressionNode(negatedNode, labels, cardNames).label,
		expression: withConditionAppended(expression, negatedNode),
		rank: valenceRank('not', true, negated),
	});

	for (const [index, condition] of expression.entries()) {
		//A manual condition is text this layer refused to model. Growing an OR
		//inside it would mean rewriting a spelling we said we did not understand.
		if (condition.kind === 'manual') continue;
		//Widening a condition with a member it already contains is the same
		//no-op as above, one level down.
		if (condition.kind === 'or' && condition.members.map(serializeFilterNode).includes(spelling)) continue;
		if (condition.kind !== 'or' && serializeFilterNode(condition) === spelling) continue;
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

	return valences.sort((left, right) => left.rank - right.rank || left.id.localeCompare(right.id));
};

//--- The entry point -------------------------------------------------------

const SORT_NAMES : readonly string[] = Object.keys(SORTS);
const VIEW_MODES : readonly string[] = Object.keys(LEGAL_VIEW_MODES);

//A configurable family is offered by its FAMILY name, because its values do not
//exist yet — the palette drills into the argument editor next. Its node is the
//family spelled with its own defaults, which is the clause the engine would run
//if the user stopped there.
const defaultConfigurableFilter = (family : string) : string => {
	const configurable = CONFIGURABLE_FILTER_INFO[family];
	if (!configurable) return family;
	return family + '/' + configurable.arguments.map(argument => argument.default).join('/');
};

const filterNode = (filter : string) : FilterExpressionNode => ({kind: 'filter', filter});

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

//THE ONE ENTRY POINT THE PALETTE CALLS.
export const collectionCompletionCandidates = (
	options : CollectionCompletionOptions
) : CompletionCandidate[] => {
	const context = options.context || {};
	const {token, negated} = strippedNegationPrefix(options.token);
	if (!token) return [];
	const candidates = context.candidates || [];
	const labels = collectionFilterLabels(candidates);
	const cardNames = context.cardNames || {};
	const filterDescriptions = context.filterDescriptions || {};
	const tagInfos = context.tagInfos || {};
	const expression = options.expression;

	const results : CompletionCandidate[] = [];
	const seen = new Set<string>();

	const clauseCandidate = (
		id : string,
		kind : CompletionCandidateKind,
		filter : string,
		label : string,
		detail : string,
		match : Match
	) => {
		if (seen.has(id)) return;
		seen.add(id);
		const node = filterNode(filter);
		results.push({
			id,
			kind,
			label,
			detail,
			tier: match.tier,
			score: scoreFor(match, kind, label, token),
			matchedOn: match.matchedOn,
			filter,
			node,
			valences: completionValences(node, expression, {
				idPrefix: id,
				negated,
				labels,
				cardNames,
				candidates,
			}),
			viewerDependent: filterNameIsViewerDependent(filter),
		});
	};

	//RECENTS FIRST, as content rather than as a section. They are built by the
	//existing recents generator, so a recent row here and a recent row in the
	//idle list are the same row with the same id, name and dedupe.
	for (const recent of collectionComposerRecentSuggestions(options.description, context)) {
		const match = matchTier(token, recent.name, [], [recent.detail]);
		if (!match) continue;
		if (seen.has(recent.id)) continue;
		seen.add(recent.id);
		results.push({
			id: recent.id,
			kind: 'recent',
			label: recent.name,
			detail: recent.detail,
			tier: match.tier,
			score: scoreFor(match, 'recent', recent.name, token),
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
		const label = collectionFilterDisplayName(candidate.filter, labels, cardNames);
		const tagDescription = tagInfos[candidate.filter]?.description || '';
		const match = matchTier(
			token,
			label,
			[
				...(candidate.aliases || []),
				...(candidate.searchValues || []),
				...filterSynonyms(candidate.filter),
			],
			[tagDescription, candidate.detail]
		);
		if (!match) continue;
		clauseCandidate(
			`value:${candidate.category}:${candidate.filter}`,
			'value',
			candidate.filter,
			label,
			tagDescription || candidate.detail,
			match
		);
	}

	//FILTERS AND CONFIGURABLE FAMILIES.
	for (const name of Object.keys(filterDescriptions)) {
		//A name the live corpus already offered as a value is that value, not a
		//second row for the same clause.
		if (candidates.some(candidate => candidate.filter === name)) continue;
		const configurable = Boolean(CONFIGURABLE_FILTER_INFO[name]);
		const filter = configurable ? defaultConfigurableFilter(name) : name;
		const label = collectionFilterDisplayName(configurable ? name : filter, labels);
		const detail = collectionFilterDescription(name, filterDescriptions, labels);
		const match = matchTier(token, label, filterSynonyms(name), [detail]);
		if (!match) continue;
		clauseCandidate(
			configurable ? `family:${name}` : `filter:${filter}`,
			configurable ? 'filter-family' : 'filter',
			filter,
			label,
			detail,
			match
		);
	}

	//SET, SORT AND VIEW ARE WORDS IN THE SENTENCE (meta-proposal convergence 7),
	//so they are typeable like every other word. They change the description
	//rather than the expression, which is why they carry no valences.
	const sentenceWord = (
		id : string,
		kind : CompletionCandidateKind,
		name : string,
		label : string,
		detail : string,
		description : CollectionDescription
	) => {
		const match = matchTier(token, label, [name], [detail]);
		//A SENTENCE WORD IS NAMED, NOT DESCRIBED. There are three sets, a
		//handful of views, and a short list of sorts; a person types their names.
		//Matching their prose instead turned the generated line 'Orders this
		//collection by …' into a hit for the token 'or', which put every sort in
		//the app above whatever the user was actually reaching for. So these
		//kinds match by name and by their URL token, and stop there.
		if (!match || match.tier === 'description' || match.tier === 'fuzzy') return;
		if (seen.has(id)) return;
		seen.add(id);
		results.push({
			id,
			kind,
			label,
			detail,
			tier: match.tier,
			score: scoreFor(match, kind, label, token),
			matchedOn: match.matchedOn,
			description,
			valences: [],
			viewerDependent: false,
		});
	};

	for (const name of context.setNames || SET_NAMES) {
		if (name === options.description.set) continue;
		sentenceWord(
			`set:${name}`,
			'set',
			name,
			collectionOptionDisplayName(name),
			`Starts this collection from the ${collectionOptionDisplayName(name)} set instead.`,
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
			collectionDescriptionWithViewMode(options.description, name as ViewMode)
		);
	}

	return results
		.sort((left, right) => left.score - right.score || left.label.localeCompare(right.label) || left.id.localeCompare(right.id))
		.slice(0, options.limit === undefined ? 8 : options.limit);
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

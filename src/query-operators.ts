//ONE PARSER FOR TYPED OPERATORS, SHARED BY THE FIND DIALOG AND THE COMPOSER.
//
//The owner: "update the find dialog parsing to be the same and more powerful
//here." There were two readings of `tag:internal` in this app and they agreed
//about nothing:
//
//  THE FIND DIALOG had a real one, buried in nlp.ts: `rewriteQueryFilters` +
//  `queryWordsAndFilters` understood `filter:`, `is:`, `section:`, `tag:` and
//  `has:`, rewrote them all to a single `filter:` spelling, and split the result
//  into [query text, filter names]. It never checked a value against the
//  vocabulary, so `tag:intrnal` silently became a filter matching no card, with
//  no notice; it had no `sort:`, no `set:`, no `query:`, no negation, and no way
//  to report WHICH operator produced a filter.
//
//  THE COMPOSER had none at all. `tag:internal` fell through every tier of the
//  completion index and came out as a description-tier guess, or as nothing,
//  because a colon is not a word in any of the vocabularies it indexes.
//
//So the reading lives here, once, and both surfaces consume it. That is the
//requirement, not an implementation nicety: the whole point of a typed operator
//is that it means the same thing wherever you type it, and two parsers is
//exactly how it stops.
//
//WHAT THIS MODULE IS NOT. It has no store, no corpus, no filters.js import, and
//it does not know which tags exist. Vocabulary arrives as a PARAMETER, so that
//(a) the same function runs inside the corpus worker, where nlp.ts lives and the
//store does not, (b) it is testable as pure data, and (c) the caller decides how
//much checking it wants: the composer passes the live corpus and gets typo
//tolerance, and a caller who passes nothing gets the find dialog's historical
//trust-the-user behavior, unchanged, to the character.
//
//THE FLOOR, STATED AS A RULE. Every existing find-dialog behavior is preserved
//when no vocabulary is supplied: the five legacy operators, the `has:`/`has:no-`
//asymmetry, lower-casing, order-independence, and the re-joining of the
//remaining words with single spaces. New operators only ADD readings to strings
//that used to be plain text.
//
//AN UNKNOWN PREFIX IS NOT AN OPERATOR. `ratio:3` and `http://example.com` and an
//English sentence with a colon in it are text, and they stay text — the operator
//table is a closed list, and a token whose head is not in it is never touched.
//That rule is what makes it safe to type a colon at all.

import {
	tokenIsTypoOf,
} from './collection-completion-typos.js';

//THE FAMILIES AN OPERATOR CAN NAME.
//
//Not the same list as the pill palette's or the catalog's: this is the set of
//things a COLON can address, which is narrower. A family exists here when there
//is one unambiguous canonical spelling to produce from a bare value.
export type QueryOperatorFamily =
	| 'filter'
	| 'tag'
	| 'section'
	| 'card-type'
	| 'person'
	| 'query'
	| 'sort'
	| 'set';

//How a typed value was matched against its family's vocabulary.
//
//`literal` is not a failure and not a guess: it is the answer for a family that
//HAS no closed vocabulary. `query:crystallizing` is whatever the user typed and
//always was; there is nothing to check it against.
//
//`unresolved` IS the interesting one. It means the family has a vocabulary, the
//caller supplied it, and the value is in none of it — which the find dialog has
//always accepted silently and which a caller may now notice.
export type QueryOperatorMatchKind = 'exact' | 'prefix' | 'typo' | 'literal' | 'unresolved';

export type QueryOperatorMatch = {
	//The whitespace-delimited token as typed, lower-cased.
	raw : string;
	//The word before the colon, lower-cased — the alias actually used, not the
	//canonical one, so a caller can echo the user's own vocabulary back.
	operator : string;
	family : QueryOperatorFamily;
	//Everything after the FIRST colon, lower-cased and verbatim.
	rawValue : string;
	//What the value resolved to. Equal to rawValue for a literal or unresolved
	//match, which is what keeps the no-vocabulary path byte-identical to the
	//find dialog's old behavior.
	value : string;
	match : QueryOperatorMatchKind;
	//The canonical URL filter name this operator produces, or '' for the two
	//operators that are not filters at all (sort and set change the collection
	//around the filters rather than adding one).
	filter : string;
};

export type ParsedQuery = {
	//The words that were not operators, lower-cased and re-joined with single
	//spaces — exactly the shape the find dialog's query text has always had.
	text : string;
	//Canonical filter names, in typed order.
	filters : string[];
	//'' when no sort: operator appeared. A caller that has its own sort keeps it.
	sort : string;
	sortReversed : boolean;
	//'' when no set: operator appeared.
	set : string;
	//Every recognized operator, in typed order, for a caller that wants to
	//explain or rank what it read rather than just apply it.
	operators : QueryOperatorMatch[];
};

//The closed vocabularies a caller can offer, all optional. An absent family is
//not checked; an EMPTY one is also not checked, so a corpus that has not loaded
//its tags yet degrades to the find dialog's trusting behavior rather than
//declaring every tag unknown.
export type QueryOperatorVocabulary = {
	tags? : readonly string[];
	sections? : readonly string[];
	cardTypes? : readonly string[];
	//Ordinary (non-configurable) filter names, for `filter:` / `is:` / `has:`.
	filters? : readonly string[];
	sorts? : readonly string[];
	sets? : readonly string[];
	//Contributor ids. `me` is always legal and is not expected in this list.
	authors? : readonly string[];
};

//THE OPERATOR TABLE.
//
//One row per family, listing every word that may precede the colon. The first
//word is the canonical one — what a surface should teach — and the rest are
//aliases, kept deliberately short: an alias earns its place by being the word
//somebody would type FIRST, not by being conceivable. `type:` is the owner's
//own example. `is:` and `has:` are the find dialog's inheritance and are
//load-bearing.
//
//ORDER MATTERS ONLY FOR READING. Lookup is by exact head match against a map
//built below, so there is no prefix-shadowing to reason about: `card-type` and
//`type` are two keys, not one key and a prefix of it.
type QueryOperatorRow = {
	family : QueryOperatorFamily;
	words : readonly string[];
};

const QUERY_OPERATOR_ROWS : readonly QueryOperatorRow[] = [
	//The find dialog's own escape hatch: whatever follows is a filter name,
	//taken at its word. `is:` is its older synonym and behaves identically —
	//`is:published` and `filter:published` have always produced the same filter.
	{family: 'filter', words: ['filter', 'is']},
	//`has:` is the one operator with a rewrite of its own; see hasFilterName.
	{family: 'filter', words: ['has']},
	{family: 'tag', words: ['tag', 'tagged']},
	{family: 'section', words: ['section']},
	{family: 'card-type', words: ['card-type', 'cardtype', 'type', 'kind']},
	{family: 'person', words: ['author', 'by']},
	{family: 'query', words: ['query', 'text', 'search']},
	{family: 'sort', words: ['sort', 'sorted', 'order']},
	{family: 'set', words: ['set']},
];

//`has:` KEEPS ITS ASYMMETRY. `has:comments` means the filter `has-comments`, and
//`has:no-comments` means `no-comments` — because the app's own filter names
//already carry the polarity in that second case and `has-no-comments` is not a
//filter. This was nlp.ts's rule and it is preserved verbatim, including that it
//is decided on the RAW value, before any vocabulary resolution: the value the
//user typed is what the prefix is glued to.
const hasFilterName = (value : string) : string =>
	value.startsWith('no-') ? value : `has-${value}`;

const OPERATOR_WORDS : ReadonlyMap<string, QueryOperatorRow> = new Map(
	QUERY_OPERATOR_ROWS.flatMap(row => row.words.map(word => [word, row] as [string, QueryOperatorRow]))
);

//Exported so a surface can TEACH the grammar from the same table it is parsed
//with, rather than from a hand-written list that drifts.
export const queryOperatorWords = () : string[] => [...OPERATOR_WORDS.keys()];

export const queryOperatorFamilyForWord = (word : string) : QueryOperatorFamily | null =>
	OPERATOR_WORDS.get(word.toLowerCase())?.family || null;

//WHICH VOCABULARY A FAMILY IS CHECKED AGAINST. `query` is absent on purpose: it
//is free text, and the resolver's `literal` answer is the honest one.
const vocabularyForFamily = (family : QueryOperatorFamily, vocabulary : QueryOperatorVocabulary) : readonly string[] | null => {
	switch (family) {
	case 'tag': return vocabulary.tags || null;
	case 'section': return vocabulary.sections || null;
	case 'card-type': return vocabulary.cardTypes || null;
	case 'filter': return vocabulary.filters || null;
	case 'sort': return vocabulary.sorts || null;
	case 'set': return vocabulary.sets || null;
	case 'person': return vocabulary.authors || null;
	case 'query': return null;
	}
};

//THE VALUE SIDE GETS THE SAME MATCHING THE NAME SIDE GETS — SCOPED TO THE
//OPERATOR'S FAMILY.
//
//That scoping is the whole benefit of having typed an operator. `intrn` against
//the entire vocabulary is a coin flip between a tag, a filter and a section;
//against the tags alone it is `internal`, unambiguously, because the user
//already told us which drawer to look in. So the ladder is deliberately more
//permissive than the unscoped one: a PREFIX match is accepted even when it is
//not unique (shortest candidate wins, which is the one the user is most likely
//to have been abbreviating), and a typo match is accepted at the same budget the
//completion index uses.
//
//The ladder, in order, first hit wins:
//  exact  — the value IS a member.
//  prefix — a member starts with the value. Shortest member first, then
//           alphabetical, so the answer is deterministic and does not depend on
//           the order a corpus happened to enumerate its tags in.
//  typo   — bounded Damerau-Levenshtein, via the completion index's own
//           tokenIsTypoOf so one budget governs both surfaces. Same tie-break.
//  none   — unresolved: hand back exactly what was typed. The find dialog has
//           always done this and a lot of URLs depend on it.
const resolveValue = (
	family : QueryOperatorFamily,
	value : string,
	vocabulary : QueryOperatorVocabulary
) : {value : string, match : QueryOperatorMatchKind} => {
	const candidates = vocabularyForFamily(family, vocabulary);
	if (!candidates) return {value, match: 'literal'};
	//An empty vocabulary is "I do not know", not "nothing exists" — see the
	//QueryOperatorVocabulary note.
	if (!candidates.length) return {value, match: 'literal'};
	if (!value) return {value, match: 'unresolved'};
	const lowered = candidates.map(candidate => candidate.toLowerCase());
	if (lowered.includes(value)) return {value, match: 'exact'};
	const byPreference = (left : string, right : string) : number =>
		left.length - right.length || (left < right ? -1 : left > right ? 1 : 0);
	const prefixed = lowered.filter(candidate => candidate.startsWith(value)).sort(byPreference);
	if (prefixed.length) return {value: prefixed[0], match: 'prefix'};
	const typos = lowered.filter(candidate => tokenIsTypoOf(value, candidate)).sort(byPreference);
	if (typos.length) return {value: typos[0], match: 'typo'};
	return {value, match: 'unresolved'};
};

//The canonical URL spelling each family produces from a resolved value.
//
//tag, section and card-type all produce a BARE TOKEN, because that is genuinely
//how this app spells them in a collection path: `/c/everything/internal/` is the
//tag, `/c/everything/content/` is the card type. They are three operators over
//one namespace, and the operator's real job is to tell the RESOLVER which drawer
//to look in — which is exactly why `tag:intrn` can find `internal` when bare
//`intrn` cannot.
const filterNameFor = (family : QueryOperatorFamily, operator : string, value : string) : string => {
	switch (family) {
	case 'filter': return operator === 'has' ? hasFilterName(value) : value;
	case 'tag':
	case 'section':
	case 'card-type':
		return value;
	case 'person': return value === 'me' ? 'author/me' : `author/${value}`;
	//The query filter's own encoding lives in filters.ts (queryFilter), which
	//this module deliberately does not import — see the header. The caller
	//spells it; what this module reports is the TEXT.
	case 'query': return '';
	case 'sort':
	case 'set':
		return '';
	}
};

//`sort:reverse-recent` and `sort:-recent` both mean the same thing the URL
//spells `sort/reverse/recent`. Stripped before resolution so the value side is
//matched against plain sort names.
const REVERSED_SORT_PREFIXES = ['reverse-', 'reversed-', '-'];

const splitReversedSort = (value : string) : {value : string, reversed : boolean} => {
	for (const prefix of REVERSED_SORT_PREFIXES) {
		if (value.startsWith(prefix) && value.length > prefix.length) {
			return {value: value.slice(prefix.length), reversed: true};
		}
	}
	return {value, reversed: false};
};

//ONE TOKEN, READ. Null means "this is not an operator" — which is the answer for
//ordinary words, for an unknown head, and for a bare colon with nothing in front
//of it, so a caller can simply treat null as text.
export const parseQueryOperatorToken = (
	token : string,
	vocabulary : QueryOperatorVocabulary = {}
) : QueryOperatorMatch | null => {
	const raw = token.toLowerCase();
	const colon = raw.indexOf(':');
	if (colon <= 0) return null;
	const operator = raw.slice(0, colon);
	const row = OPERATOR_WORDS.get(operator);
	if (!row) return null;
	const rawValue = raw.slice(colon + 1);
	//`tag:` with nothing after it is a person mid-typing, not a clause. It is
	//still an operator — a completion surface wants to know the drawer is open —
	//but it resolves to nothing and produces no filter.
	if (!rawValue) {
		return {raw, operator, family: row.family, rawValue: '', value: '', match: 'unresolved', filter: ''};
	}
	if (row.family === 'sort') {
		const split = splitReversedSort(rawValue);
		const resolved = resolveValue('sort', split.value, vocabulary);
		return {
			raw,
			operator,
			family: 'sort',
			rawValue,
			//The reversal is carried back in the VALUE the caller applies, so a
			//consumer that only looks at `value` still gets the sort name and a
			//consumer that reads ParsedQuery gets the flag beside it.
			value: resolved.value,
			match: resolved.match,
			filter: '',
		};
	}
	const resolved = resolveValue(row.family, rawValue, vocabulary);
	return {
		raw,
		operator,
		family: row.family,
		rawValue,
		value: resolved.value,
		match: resolved.match,
		filter: filterNameFor(row.family, operator, resolved.value),
	};
};

//THE SAME NORMALIZATION, NONE OF THE READING.
//
//A query is not always TYPED. The find dialog is also SEEDED — Ctrl-L hands it
//whatever text the cursor had selected in the card being edited — and that text
//is prose, not grammar. Run through the table above, `Type: safety` loses the
//word `Type` entirely (a head with an empty value is an operator mid-typed, so
//it produces no filter and contributes no word), `type:content` becomes a
//card-type filter, and `the set: of all things` quietly drops `set:`. Every one
//of those is the parser working exactly as designed on a string nobody typed at
//it.
//
//So provenance decides, not the string: text the app put in the box is searched
//for literally, and the moment the user edits it they are typing a query and get
//the whole table back. This is the literal half of that rule, and it lives here
//rather than at the call site so both halves are read from one module. What it
//returns is what parseQueryOperators returns for a string containing no
//operators at all — lower-cased words, re-joined with single spaces — so a
//consumer needs no second code path.
export const parseQueryAsLiteralText = (text : string) : ParsedQuery => ({
	text: text.toLowerCase().split(/\s+/).filter(token => token).join(' '),
	filters: [],
	sort: '',
	sortReversed: false,
	set: '',
	operators: [],
});

//A WHOLE TYPED STRING, READ. Operators may appear anywhere and in any order,
//which is the find dialog's own long-standing behavior and the only one that
//survives contact with people typing.
export const parseQueryOperators = (
	text : string,
	vocabulary : QueryOperatorVocabulary = {}
) : ParsedQuery => {
	const words : string[] = [];
	const filters : string[] = [];
	const operators : QueryOperatorMatch[] = [];
	let sort = '';
	let sortReversed = false;
	let set = '';
	for (const token of text.toLowerCase().split(/\s+/)) {
		if (!token) continue;
		const parsed = parseQueryOperatorToken(token, vocabulary);
		if (!parsed) {
			words.push(token);
			continue;
		}
		operators.push(parsed);
		if (!parsed.value) continue;
		if (parsed.family === 'sort') {
			//LAST ONE WINS, for sort and set alike. A collection has exactly one
			//order and one starting set, so two `sort:` operators are a person
			//changing their mind mid-line rather than a conflict to report.
			sort = parsed.value;
			sortReversed = splitReversedSort(parsed.rawValue).reversed;
			continue;
		}
		if (parsed.family === 'set') {
			set = parsed.value;
			continue;
		}
		if (parsed.family === 'query') {
			//`query:` puts its value back into the TEXT rather than producing a
			//filter of its own. The find dialog wraps the whole text in one
			//`query/` filter at the end; two of them would be an AND of two text
			//searches, which is not what a second `query:` word means.
			words.push(parsed.value);
			continue;
		}
		if (parsed.filter) filters.push(parsed.filter);
	}
	return {text: words.join(' '), filters, sort, sortReversed, set, operators};
};

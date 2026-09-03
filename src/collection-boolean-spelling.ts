//THE ONE PLACE THE URL'S BOOLEAN SPELLING IS TAKEN APART.
//
//`exclude/`, `combine/` and `+` are the engine's three ways of writing a
//boolean, and exactly two layers need to READ them: the draft layer
//(collection-expression), which turns a segment into a tree, and the namer
//(collection-composer-suggestions), which turns a segment into the words a user
//reads. Those two modules cannot import each other — the draft layer is built
//ON the namer, which is why collection-draft-receipt exists on neither side —
//so before this file the decomposition existed once and the namer did without
//it. That is precisely how `tag-2+tag-1` came to read "(Tag 2 OR Tag 1)" in a
//snackbar while the same clause read "Tagged tag-2 or Tagged tag-1" as a pill,
//and how a flipped group came out as "Exclude Tag 1 Tag 2".
//
//So the decomposition moves DOWN, under both of them, where it depends on
//nothing but the URL grammar itself. Both callers now split a `combine/` the
//same way, by definition, because there is one splitter.

import {
	CollectionDescription,
} from './collection_description.js';

import {
	INVERSE_FILTER_NAMES,
	UNION_FILTER_DELIMITER,
} from './filters.js';

import {
	SET_NAMES,
} from '../shared/collection_description_base.js';

import {
	FilterName,
} from '../shared/types.js';

//THE INVERSE MAP RUNS BOTH WAYS, and only INVERSE_FILTER_NAMES knows either
//direction. It is keyed by the NEGATIVE name ('unpublished' -> 'published'), so
//negating a positive filter needs the reverse index. Both directions are
//derived from the same source of truth so a filter family that grows a named
//inverse gets it in the composer — and in every sentence the composer writes —
//for free.
const POSITIVE_TO_INVERSE_FILTER_NAMES : Record<string, string> = Object.fromEntries(
	Object.entries(INVERSE_FILTER_NAMES).map(([negative, positive]) => [positive, negative])
);

//The name that means "not this filter", when the app already has a word for it.
//`published` -> `unpublished`, and `unpublished` -> `published`. Returns ''
//when there is no such word, which is the caller's cue to reach for `exclude/`
//(the draft layer) or for the word "not" (the namer).
export const namedInverseFilterName = (filter : FilterName) : string => {
	const towardsPositive = INVERSE_FILTER_NAMES[filter];
	if (towardsPositive) return towardsPositive;
	return POSITIVE_TO_INVERSE_FILTER_NAMES[filter] || '';
};

const SET_NAME_TOKENS : ReadonlySet<string> = new Set<string>(SET_NAMES);

//A `+` union is only a union when the segment carries no `/` — filters.ts's own
//rule, because `children/+ab123` puts a `+` inside a configurable filter's
//argument.
export const unionSpellingMembers = (segment : string) : string[] | null => {
	if (segment.includes('/')) return null;
	const members = segment.split(UNION_FILTER_DELIMITER);
	if (members.length < 2 || !members.every(member => member)) return null;
	return members;
};

//COMBINE IS BINARY, AND ITS TWO HALVES ARE FOUND BY RE-PARSING.
//
//Verified against the engine (filters.ts makeCombineConfigurableFilter ->
//extractSubFilters): `combine` claims 2 URL parts in
//CONFIGURABLE_FILTER_URL_PARTS, and at run time it hands everything after
//`combine/` back to `CollectionDescription.deserialize(rest + '/')` and takes
//`filters[0]` and `filters[1]`. Anything past the second sub-filter is
//DISCARDED, and fewer than two makes the whole clause a silent no-op ("Expected
//two sub-filters for combine but didn't get it"). So n-ary OR has to be
//chained, and this function is the exact inverse of that split — it calls the
//same parser the engine calls, so the two cannot disagree about where the first
//sub-filter ends.
export const splitCombineMembers = (rest : string) : [string, string] | null => {
	//A SET NAME IN THE FIRST POSITION EATS A MEMBER.
	//
	//`deserialize` shifts a leading `main` / `reading-list` / `everything` off
	//as the SET, so `combine/everything/starred` reaches the factory as one
	//sub-filter and no-ops the whole clause. Filter names are open (every tag
	//becomes one), so a tag literally named `everything` really can produce
	//this. We refuse to model such a segment rather than re-spell it into
	//something that runs differently, and the compiler never PRODUCES one.
	if (SET_NAME_TOKENS.has(rest.split('/')[0])) return null;
	const filters = CollectionDescription.deserialize(rest + '/').filters;
	if (filters.length !== 2) return null;
	//Paranoia with teeth: the URL parser DROPS a multi-part group whose head is
	//not a filter (the #757 orphan-head path). If the two halves do not rejoin
	//into exactly what we handed it, a part went missing and this segment is
	//not ours to rewrite.
	if (filters.join('/') !== rest) return null;
	return [filters[0], filters[1]];
};

export const combineMemberSpellingIsSafe = (spelling : string) : boolean =>
	!SET_NAME_TOKENS.has(spelling.split('/')[0]);

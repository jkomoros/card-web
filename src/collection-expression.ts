//THE BOOLEAN DRAFT LAYER.
//
//`CollectionDescription.filters` is a flat array of URL segments. That is the
//right canonical execution form and a hopeless editing form: `combine` and
//`exclude` are spelled as prefixes on a slash-joined string, an OR is sometimes
//`a+b` and sometimes `combine/a/b` depending on whether its members happen to be
//single-token, and the arity of a compound is decided by a table in filters.ts
//that the string itself does not carry. A composer that edits those strings
//directly has to re-derive all of that at every keystroke, and every surface
//that re-derives it gets a slightly different answer.
//
//So this module is the ONE place the URL's boolean spelling is decoded into a
//tree and re-encoded back. Everything above it (the sentence renderer, the
//pill row, the keyboard grammar) edits the tree; nothing above it composes an
//`exclude/` or a `+` by hand.
//
//THE CONTRACT, from the spec's "Round-trip contract":
//
//  CollectionDescription -> expression -> CollectionDescription must preserve
//  SEMANTICS for every valid existing description.
//
//Semantics, not spelling. The compiler is allowed to pick a better spelling
//than the one it read (`combine/a/b` becomes `a+b`; a flattened chain of
//combines becomes one n-ary OR), and the test suite asserts ENGINE-level
//equivalence for exactly those cases. What it is never allowed to do is lose a
//segment or change what a segment selects. Anything this layer cannot model
//honestly becomes a `manual` node holding the segment's text verbatim, which
//compiles back to itself character-for-character.
//
//WHAT THE UI MODELS vs WHAT THE MODEL EXPRESSES. The user-facing scope
//(collection-composer-spec, "Boolean expression model") is: an AND of
//conditions; OR inside a condition; NOT on a condition or on an OR group. The
//TYPES here are honestly recursive anyway — an `or` may contain a `not` may
//contain an `or` — so deeper source-authored shapes round-trip as real nodes
//where the engine can express them, and unlimited nesting is a later UI unlock
//rather than a rewrite of this file.

import {
	CollectionDescription,
} from './collection_description.js';

import {
	COMBINE_FILTER_NAME,
	EXCLUDE_FILTER_NAME,
	EXPAND_FILTER_NAME,
	UNION_FILTER_DELIMITER,
	excludeFilter,
} from './filters.js';

import {
	combineMemberSpellingIsSafe,
	namedInverseFilterName,
	splitCombineMembers,
} from './collection-boolean-spelling.js';

import {
	collectionFilterDisplayName,
} from './collection-composer-suggestions.js';

import {
	FilterName,
} from '../shared/types.js';

//A single concrete filter, possibly configurable and therefore possibly
//spelled across several URL parts (`updated/between/2020-01-01/2021-01-01`).
//The whole multi-part spelling is ONE leaf: the composer edits its arguments
//through the existing piecesForConfigurableFilter machinery, not through this
//tree.
export type FilterExpressionFilterNode = {
	kind: 'filter',
	filter: FilterName
};

//Two or more alternatives, any of which satisfies the condition. Members are
//nodes, not bare filters: `combine/exclude/published/no-tags` is a legal URL
//and means "unpublished OR untagged".
export type FilterExpressionOrNode = {
	kind: 'or',
	members: FilterExpressionNode[]
};

export type FilterExpressionNotNode = {
	kind: 'not',
	child: FilterExpressionNode
};

//Legal engine text this layer will not pretend to understand — an `expand/`
//rule, or a `combine/` whose two halves the engine's own sub-splitter cannot
//recover. Preserved verbatim and compiled back verbatim; the UI renders it as
//a gray pill offering only edit-in-source and remove.
export type FilterExpressionManualNode = {
	kind: 'manual',
	source: string
};

export type FilterExpressionNode =
	| FilterExpressionFilterNode
	| FilterExpressionOrNode
	| FilterExpressionNotNode
	| FilterExpressionManualNode;

//The top level is the AND of its conditions, one per `filters` segment — the
//same conjunction the URL's path segments already are.
export type CollectionExpression = FilterExpressionNode[];

//The inverse map, and the `combine/` splitter, now live one layer down in
//collection-boolean-spelling: the NAMER needs both too (a snackbar has to read
//`exclude/tag-1+tag-2` as words), and it cannot import this file. Re-exported
//here so every existing consumer of the draft layer keeps its import.
export { namedInverseFilterName };

//Whether flipping this condition produces a WORD rather than an operator. The
//sentence renderer asks so it can promise "this pill will read 'unpublished'"
//before the user commits to the flip.
export const conditionCanUseNamedInverse = (node : FilterExpressionNode) : boolean => {
	if (node.kind === 'filter') return Boolean(namedInverseFilterName(node.filter));
	//A not-of-filter un-negates into the plain filter, which is always a word.
	if (node.kind === 'not' && node.child.kind === 'filter') return true;
	return false;
};

//NEGATION PREFERS THE APP'S OWN WORD, IN BOTH DIRECTIONS.
//
//Flipping `published` yields the filter `unpublished` — a plain leaf, not a
//not-node — so the pill reads as language and the compiler has nothing to
//spell. Flipping it back yields `published` again, by the same map. Only a
//filter with no named inverse becomes a not-node, and flipping THAT back
//unwraps it. Negation is therefore an involution on every node kind: applying
//it twice is the identity.
//
//The PARSER runs through here too, which is what makes the model canonical: a
//not-node never wraps a filter that has a word of its own, so `exclude/published`
//and `unpublished` produce the SAME tree — as they must, since they select the
//same cards, and a draft layer that told them apart would let the composer
//re-spell one into the other and call it an edit.
export const negatedExpressionNode = (node : FilterExpressionNode) : FilterExpressionNode => {
	if (node.kind === 'filter') {
		const named = namedInverseFilterName(node.filter);
		if (named) return {kind: 'filter', filter: named};
		return {kind: 'not', child: node};
	}
	if (node.kind === 'not') return node.child;
	return {kind: 'not', child: node};
};

//An OR flattens: `combine/a/combine/b/c` and `a+b+c` are the same three-way
//union to the engine (verified on a synthetic corpus in the test suite), and
//one n-ary node is what the UI's fused pill actually is.
const flattenedOrMembers = (members : FilterExpressionNode[]) : FilterExpressionNode[] =>
	members.flatMap(member => member.kind === 'or' ? member.members : [member]);

//parseFilterSegment turns ONE `filters[]` segment into a node. Total: every
//input produces a node, and no input throws.
const parseFilterSegment = (segment : string) : FilterExpressionNode => {
	const slash = segment.indexOf('/');
	if (slash < 0) {
		const members = segment.split(UNION_FILTER_DELIMITER);
		if (members.length > 1 && members.every(member => member)) {
			return {
				kind: 'or',
				members: members.map(member => ({kind: 'filter', filter: member} as FilterExpressionNode))
			};
		}
		return {kind: 'filter', filter: segment};
	}
	const head = segment.slice(0, slash);
	const rest = segment.slice(slash + 1);
	//`exclude/` with nothing after it is not a negation of anything; leave it
	//as the leaf the engine will shrug at.
	if (!rest) return {kind: 'filter', filter: segment};
	if (head === EXCLUDE_FILTER_NAME) {
		//Through negatedExpressionNode, not a raw not-node: `exclude/published`
		//is the app's `unpublished`, and `exclude/exclude/x` is x. Both
		//normalizations are engine-verified in the round-trip matrix.
		return negatedExpressionNode(parseFilterSegment(rest));
	}
	if (head === COMBINE_FILTER_NAME) {
		const halves = splitCombineMembers(rest);
		if (!halves) return {kind: 'manual', source: segment};
		return {
			kind: 'or',
			members: flattenedOrMembers(halves.map(parseFilterSegment))
		};
	}
	//expand/ is a subcollection plus an expansion rule, not a boolean operator.
	//Modeling it as one would let the UI offer "or"/"flip" on a shape those
	//verbs do not describe.
	if (head === EXPAND_FILTER_NAME) return {kind: 'manual', source: segment};
	//Every other slash-bearing segment is one configurable filter, multi-part
	//spelling and all.
	return {kind: 'filter', filter: segment};
};

//parseCollectionExpression is TOTAL: it never throws, and it never drops a
//segment. A segment it cannot decompose comes back as a leaf or a manual node
//that compiles to itself.
export const parseCollectionExpression = (filters : readonly string[]) : CollectionExpression =>
	filters.map(parseFilterSegment);

//A `+` union is only a union when the segment carries no `/` — filters.ts's own
//rule, because `children/+ab123` puts a `+` inside a configurable filter's
//argument. Mirrored here rather than imported because collection_description
//keeps its copy private.
const isPlainUnionToken = (spelling : string) : boolean =>
	Boolean(spelling) && !spelling.includes('/') && !spelling.includes(UNION_FILTER_DELIMITER);

//COMBINE'S FIRST MEMBER IS THE ONE AT RISK, so nothing else has to be.
//
//Chaining left — `combine/combine/a/b/c` — means every nesting level except the
//outermost begins with the literal word `combine`, and only member ONE is ever
//re-parsed in leading position. (Chaining right, `combine/a/combine/b/c`,
//exposes every member but the last.) So a single reorder — float any member
//whose first URL token is a set name past the front — is enough to make the
//set-name hazard above unreachable from anything this compiler emits.
const orderedCombineMembers = (spellings : string[]) : string[] => {
	if (combineMemberSpellingIsSafe(spellings[0])) return spellings;
	const safeIndex = spellings.findIndex(combineMemberSpellingIsSafe);
	//Every member starts with a set name: there is no legal chaining, so leave
	//the order alone rather than pretend a rotation fixed it. Such an
	//expression cannot be built by parsing (splitCombineMembers refuses it) —
	//only by hand-constructing nodes out of names that collide with set names.
	if (safeIndex < 0) return spellings;
	const reordered = [...spellings];
	const [safe] = reordered.splice(safeIndex, 1);
	return [safe, ...reordered];
};

const combineSpelling = (spellings : string[]) : string =>
	orderedCombineMembers(spellings).reduce((accumulated, spelling) =>
		accumulated === '' ? spelling : COMBINE_FILTER_NAME + '/' + accumulated + '/' + spelling, '');

//serializeFilterNode picks the ENGINE'S OPTIMAL SPELLING for a node, which is
//not always the spelling it was parsed from:
// - an OR of plain tokens is `a+b`, the short form;
// - an OR that involves a configurable or negated member has to be `combine/`,
//   chained pairwise for three or more;
// - a NOT of a filter is the app's own inverse WORD when one exists
//   (`published` -> `unpublished`), and `exclude/` only when it does not;
// - a NOT of a group is `exclude/` over the group's own best spelling;
// - a manual node is its source, byte for byte.
export const serializeFilterNode = (node : FilterExpressionNode) : string => {
	switch (node.kind) {
	case 'filter':
		return node.filter;
	case 'manual':
		return node.source;
	case 'not':
		if (node.child.kind === 'filter') {
			const named = namedInverseFilterName(node.child.filter);
			if (named) return named;
		}
		return excludeFilter(serializeFilterNode(node.child));
	case 'or': {
		if (!node.members.length) return '';
		if (node.members.length === 1) return serializeFilterNode(node.members[0]);
		const spellings = node.members.map(serializeFilterNode);
		if (spellings.every(isPlainUnionToken)) return spellings.join(UNION_FILTER_DELIMITER);
		return combineSpelling(spellings);
	}
	}
};

//serializeCollectionExpression compiles the whole sentence back into the
//`filters[]` an engine run consumes. An empty OR contributes nothing rather
//than an empty segment, which would parse back as an unknown filter.
export const serializeCollectionExpression = (expression : CollectionExpression) : string[] =>
	expression.map(serializeFilterNode).filter(spelling => spelling !== '');

//--- Editing helpers -------------------------------------------------------
//
//All pure: each returns a NEW expression and leaves its input untouched, so the
//composer's history store can keep every intermediate draft by reference.

export const withConditionAppended = (expression : CollectionExpression, node : FilterExpressionNode) : CollectionExpression =>
	[...expression, node];

export const withConditionRemoved = (expression : CollectionExpression, index : number) : CollectionExpression => {
	if (index < 0 || index >= expression.length) return expression;
	return expression.filter((_, current) => current !== index);
};

const withConditionReplaced = (expression : CollectionExpression, index : number, node : FilterExpressionNode) : CollectionExpression =>
	expression.map((current, currentIndex) => currentIndex === index ? node : current);

//Adding an alternative to a condition that is not yet a group GROWS it into
//one — the "or fuses two pills into one pill" gesture. A condition that is
//already a group just gains a member.
export const withMemberAddedToOr = (expression : CollectionExpression, index : number, node : FilterExpressionNode) : CollectionExpression => {
	if (index < 0 || index >= expression.length) return expression;
	const condition = expression[index];
	if (condition.kind === 'or') {
		return withConditionReplaced(expression, index, {kind: 'or', members: [...condition.members, node]});
	}
	return withConditionReplaced(expression, index, {kind: 'or', members: [condition, node]});
};

//Removing an alternative DISSOLVES a group that no longer needs to be one: a
//one-member OR is just the member, and the sentence must never render a group
//container around a single pill.
export const withMemberRemoved = (expression : CollectionExpression, index : number, memberIndex : number) : CollectionExpression => {
	if (index < 0 || index >= expression.length) return expression;
	const condition = expression[index];
	if (condition.kind !== 'or') return expression;
	if (memberIndex < 0 || memberIndex >= condition.members.length) return expression;
	const members = condition.members.filter((_, current) => current !== memberIndex);
	if (!members.length) return withConditionRemoved(expression, index);
	if (members.length === 1) return withConditionReplaced(expression, index, members[0]);
	return withConditionReplaced(expression, index, {kind: 'or', members});
};

//REPLACING A NODE IN PLACE IS WHAT AN ARGUMENT EDIT IS: the clause keeps its
//place in the sentence and changes what it selects. `memberIndex` addresses one
//alternative inside a group when it is >= 0 and the condition itself otherwise
//— the same two-number address the sentence's events carry, so the pill row can
//pass one straight through without deciding what it means.
export const withNodeReplaced = (
	expression : CollectionExpression,
	index : number,
	memberIndex : number,
	node : FilterExpressionNode
) : CollectionExpression => {
	if (index < 0 || index >= expression.length) return expression;
	if (memberIndex < 0) return withConditionReplaced(expression, index, node);
	const condition = expression[index];
	if (condition.kind !== 'or') return expression;
	if (memberIndex >= condition.members.length) return expression;
	const members = condition.members.map((member, current) => current === memberIndex ? node : member);
	return withConditionReplaced(expression, index, {kind: 'or', members});
};

export const withNegationToggled =(expression : CollectionExpression, index : number) : CollectionExpression => {
	if (index < 0 || index >= expression.length) return expression;
	return withConditionReplaced(expression, index, negatedExpressionNode(expression[index]));
};

export const withMemberNegationToggled = (expression : CollectionExpression, index : number, memberIndex : number) : CollectionExpression => {
	if (index < 0 || index >= expression.length) return expression;
	const condition = expression[index];
	if (condition.kind !== 'or') return withNegationToggled(expression, index);
	if (memberIndex < 0 || memberIndex >= condition.members.length) return expression;
	const members = condition.members.map((member, current) =>
		current === memberIndex ? negatedExpressionNode(member) : member);
	return withConditionReplaced(expression, index, {kind: 'or', members});
};

//--- Display ---------------------------------------------------------------

//WHAT THE RENDERER NEEDS AND NOTHING MORE: the shape, one label per node, and
//the negation flag that decides outlined-vs-filled. Leaf NAMES are not decided
//here — collectionFilterDisplayName is the one place a filter's name is, and
//this delegates to it so a pill, a suggestion row and a receipt cannot disagree.
export type ExpressionNodeDescription = {
	kind: FilterExpressionNode['kind'],
	//The whole node read as a phrase, for a collapsed pill or an aria-label.
	label: string,
	//True when this node reads as a negation the renderer should show as one.
	//A named inverse is NOT negated: `unpublished` is a word, not an operator.
	negated: boolean,
	//Present for 'or': one entry per alternative, in sentence order.
	members?: ExpressionNodeDescription[],
	//Present for 'not': what is being negated.
	child?: ExpressionNodeDescription,
	//Present for 'manual': the verbatim source, which is also its label.
	source?: string,
};

export const describeExpressionNode = (
	node : FilterExpressionNode,
	labels : Record<string, string> = {},
	cardNames : Record<string, string> = {}
) : ExpressionNodeDescription => {
	switch (node.kind) {
	case 'filter':
		return {
			kind: 'filter',
			label: collectionFilterDisplayName(node.filter, labels, cardNames),
			negated: false,
		};
	case 'manual':
		return {
			kind: 'manual',
			label: node.source,
			negated: false,
			source: node.source,
		};
	case 'or': {
		const members = node.members.map(member => describeExpressionNode(member, labels, cardNames));
		return {
			kind: 'or',
			//Lowercase 'or' because the operator is subordinate text in the
			//sentence, not a keyword the user is being taught.
			label: members.map(member => member.label).join(' or '),
			negated: false,
			members,
		};
	}
	case 'not': {
		const child = describeExpressionNode(node.child, labels, cardNames);
		return {
			kind: 'not',
			//A NEGATED ALTERNATION NEEDS ITS BRACKETS BACK.
			//
			//"not Tagged tag-1 or Tagged tag-2" has two readings and only one of
			//them is the collection: read left to right it says (not tag-1) or
			//tag-2. On screen the group's border settles that; in a STRING —
			//an aria-label, a pill row's scope, a snackbar — there is no border,
			//so the string has to say it. Brackets are not one of the words the
			//design refuses (that list is exclude/combine/invert); they are
			//ordinary punctuation for exactly this, and they appear only where
			//the ambiguity is real.
			label: child.kind === 'or' && (child.members || []).length > 1 ?
				`not (${child.label})` :
				'not ' + child.label,
			negated: true,
			child,
		};
	}
	}
};

//--- The one consumer ------------------------------------------------------

//collectionDescriptionWithExpression is the seam between the draft layer and
//the engine: everything else about the description — set, sort, view — is
//carried through untouched, because this layer has an opinion about exactly one
//of the six fields.
//
//The set is passed through as `undefined` when it was never explicitly named,
//mirroring collection_description's own private overrides helper: editing the
//CLAUSES is not an occasion to change a description's account of its own set,
//and the two helpers must not disagree about how that account survives an edit.
export const collectionDescriptionWithExpression = (
	description : CollectionDescription,
	expression : CollectionExpression
) : CollectionDescription =>
	new CollectionDescription(
		description.setNameExplicitlySet ? description.set : undefined,
		serializeCollectionExpression(expression),
		description.sort,
		description.sortReversed,
		description.viewMode,
		description.viewModeExtra
	);

//collectionExpressionForDescription is the other half of that seam, named to
//read in the same breath at the call site.
export const collectionExpressionForDescription = (description : CollectionDescription) : CollectionExpression =>
	parseCollectionExpression(description.filters);

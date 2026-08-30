//WHY THIS CARD IS HERE — THE MODEL, WITH NO OPINION ABOUT HOW IT LOOKS.
//
//Proposal C's flow ⑤: the card info panel gains "In this collection", the
//sentence's own pills rendered vertically, each carrying a verdict for the card
//on screen. Passing pills at full treatment; failing pills in tag-chip's subtle
//state; inside an OR group the passing member lit and the group's own verdict on
//the group. Membership is "every pill lit".
//
//THE ONE DECISION THIS FILE EXISTS TO GET RIGHT is where a verdict comes from.
//A panel that re-derived "is this card tagged systems" by looking at the card
//would be a second implementation of the engine, and the day the two disagreed
//the explanation would be lying about the exact thing it exists to explain —
//with no way for a reader to tell which half was wrong. So there is no second
//implementation: every boolean here is `cardPassesFilterSegment`, which is
//`filterSetForFilterDefinitionItem` (the function the engine's own
//`combinedFilterForFilterDefinition` calls for every segment) followed by
//`makeCombinedFilter`'s exact include/exclude rule, over the FilterExtras the
//collection itself filtered with. The conjunction of the condition verdicts is
//`combinedFilter(cardID)` by construction rather than by agreement.
//
//THE SPELLINGS COME FROM THE DRAFT LAYER, WHICH IS WHY MEMBERS CAN HAVE
//VERDICTS AT ALL. `filters[]` is flat, so a description alone can answer for a
//whole segment and nothing smaller; the expression tree names the alternatives
//inside an OR, and each of them serializes to a sub-filter the engine evaluates
//through that same function (filters.ts's combine factory calls it on each
//half). The draft layer's compiler may pick a better spelling than the URL's —
//`combine/a/b` becomes `a+b` — which is semantics-preserving by its own
//engine-level round-trip matrix, so a verdict read off the node is a verdict
//about the same cards as one read off the segment.
//
//A GROUP'S VERDICT IS ASKED, NOT ASSEMBLED. It would be tempting to OR the
//member verdicts together, and in every ordinary case that is the same answer.
//It is not the same answer when a member is not a filter at all: the engine
//DROPS an unknown member from the group and says so against the whole segment,
//while asking that member on its own gets the no-op-excludes-nothing verdict
//that a standalone unknown filter earns. The group is what the collection ran,
//so the group is what gets asked; the sentence's own strike-through is what
//tells the reader about the unknown part.

import {
	CardID,
	FilterExtras,
} from './types.js';

import {
	SetName,
} from '../shared/types.js';

import {
	CollectionExpression,
	FilterExpressionNode,
	serializeFilterNode,
} from './collection-expression.js';

import {
	cardPassesFilterSegment,
} from './collection_description.js';

import {
	SET_INFOS,
} from './filters.js';

//One condition's verdict, addressed the way the sentence addresses its tokens:
//`index` into the expression, and one entry per alternative for a group.
export type ConditionVerdict = {
	//True when the card passes this whole condition — for a group, the group.
	passes : boolean,
	//One verdict per alternative, in sentence order. Empty for a condition that
	//is not a group, so `members.length` is also "is this a group".
	members : readonly boolean[],
};

export type CollectionMembership = {
	//In sentence order, one per condition.
	conditions : readonly ConditionVerdict[],
	//Whether the card is in the set the sentence starts from.
	setPasses : boolean,
	//How many conditions the card fails. The count the honest line quotes.
	failingConditions : number,
	//The whole answer: in the set AND passing every condition. This is the
	//engine's own membership predicate for this card, reassembled from the
	//engine's own parts.
	passes : boolean,
};

//The alternatives inside a condition, or null when the condition is one pill. A
//negated group is still a group — the "not" is a word in front of the container
//— which is the same shape rule the sentence renderer applies.
const groupMembers = (node : FilterExpressionNode) : readonly FilterExpressionNode[] | null => {
	if (node.kind === 'or') return node.members;
	if (node.kind === 'not' && node.child.kind === 'or') return node.child.members;
	return null;
};

//A NEGATED PILL'S VERDICT IS ABOUT THE NEGATION, and that falls out rather than
//being special-cased: `serializeFilterNode` spells a not-node as the app's own
//inverse word (`unpublished`) or as `exclude/…`, and the engine's own reverse
//flag then decides. The pill that reads "unpublished" is lit exactly when the
//card is unpublished, because that is the clause the engine ran.
const conditionVerdict = (node : FilterExpressionNode, cardID : CardID, extras : FilterExtras) : ConditionVerdict => {
	const members = groupMembers(node);
	return {
		passes: cardPassesFilterSegment(serializeFilterNode(node), cardID, extras),
		members: members ? members.map(member => cardPassesFilterSegment(serializeFilterNode(member), cardID, extras)) : [],
	};
};

export const collectionMembershipForCard = (
	expression : CollectionExpression,
	set : SetName,
	cardID : CardID,
	extras : FilterExtras
) : CollectionMembership => {
	const conditions = expression.map(node => conditionVerdict(node, cardID, extras));
	//The SET is a clause too, and the engine already knows how to ask about one:
	//every set has a filterEquivalent, which is the filter that reproduces it
	//over `everything`. Collection.cardsThatWillBeRemoved appends exactly this
	//to a filter definition for exactly this reason, so the panel is not
	//inventing a way to ask — it is reusing the app's own.
	const setPasses = cardPassesFilterSegment(SET_INFOS[set].filterEquivalent, cardID, extras);
	const failingConditions = conditions.filter(condition => !condition.passes).length;
	return {
		conditions,
		setPasses,
		failingConditions,
		passes: setPasses && !failingConditions,
	};
};

//THE ONE LINE, AND ONLY WHEN THERE IS SOMETHING TO ADMIT.
//
//A card that fails a clause can still be the card on screen — a fallback
//collection, a direct link, a card edited out of its own collection — and the
//section must say so rather than showing dimmed pills and leaving the reader to
//infer it. When the card IS in the collection the verdicts are the whole story
//and there is no sentence: every pill lit says it better than a line claiming
//the same thing in words.
//
//Sentence case, no terminal period: this is a status fragment in the same idiom
//as the draft receipt and the drawer's own count line, not a full sentence
//(HS-2.2 — fragments do not take one).
export const collectionMembershipNote = (membership : CollectionMembership, setLabel : string) : string => {
	if (membership.passes) return '';
	if (!membership.failingConditions) return `Not in this collection — this card isn’t in ${setLabel}`;
	const total = membership.conditions.length;
	return `Not in this collection — fails ${membership.failingConditions} of ${total} condition${total === 1 ? '' : 's'}`;
};

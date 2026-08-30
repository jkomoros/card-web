//THE ONE PLACE A DRAFT EDIT TURNS INTO A SENTENCE.
//
//Receipts are composed from the same canonical names the rows and the chips use,
//so "Add: Add Starred" and "Updated filter" cannot happen: the receipt says what
//changed, in the words the change was offered in.
//
//IT LIVES IN ITS OWN FILE BECAUSE IT NEEDS BOTH HALVES. Naming a clause is
//collection-composer-suggestions' job; knowing that two clauses are the SAME
//clause widened, flipped or narrowed is the draft layer's. collection-expression
//already imports the namer, so the namer cannot import the draft layer back —
//and a receipt that had to live on one side of that line would either be unable
//to name a clause or unable to see the structure of an edit. So it lives on
//neither side, which is also the honest description of what a receipt is.
//
//STRUCTURAL EDITS NARRATE THE TRANSFORMATION, NOT THE BOOKKEEPING.
//
//A set-difference over `filters[]` sees an or-fusion as two unrelated events —
//"Removed Tagged tag-1 · Added (Tag 1 OR Tag 2)" — which is true about the URL
//and false about what the user did. They did not remove a clause; they widened
//one. Worse, the removal is the alarming half and it is the half that did not
//happen, so the receipt's most legible claim is its wrongest one, on the one
//surface whose whole job is to say what just happened.
//
//Three shapes cover every structural gesture the pill row offers, and each is
//recognized by ASKING THE DRAFT LAYER rather than by pattern-matching the
//strings: a flip is the edit whose after-node is the before-node negated (which
//is how `published` -> `unpublished` gets recognized as a flip and not as a
//swap of two unrelated filters); a widening is the edit whose after-node is an
//OR containing the before-node's members plus one; a narrowing is its inverse,
//including the one that dissolves the group entirely, because a one-member OR is
//just the member.
//
//Sentence case, no terminal period, like every other receipt on this strip and
//like the drawer's own count line: these are fragments (HS-2.2), and several of
//them are joined by interpuncts into one line.

import {
	CollectionDescription,
} from './collection_description.js';

import {
	FilterExpressionNode,
	describeExpressionNode,
	negatedExpressionNode,
	parseCollectionExpression,
	serializeFilterNode,
} from './collection-expression.js';

import {
	collectionFilterDisplayName,
	collectionOptionDisplayName,
} from './collection-composer-suggestions.js';

const truncatedName = (name: string): string => (name.length > 48 ? `${name.slice(0, 47)}…` : name);

const namedList = (names: string[]): string => {
	const shown = names.slice(0, 2).map(truncatedName);
	const remaining = names.length - shown.length;
	if (!remaining) return shown.join(' and ');
	return `${shown.join(', ')} and ${remaining} more`;
};

//The alternatives a condition offers. A condition that is not a group offers
//exactly one — itself — which is what makes widening and narrowing the same
//comparison whether or not a group existed before the edit.
const alternativesOf = (node : FilterExpressionNode) : FilterExpressionNode[] => {
	if (node.kind === 'or') return [...node.members];
	if (node.kind === 'not' && node.child.kind === 'or') return [...node.child.members];
	return [node];
};

//The OR-group inside a condition, whichever side of a negation it is on, or
//null for a condition that is not a group at all. A flipped group and a flipped
//pill are the same edit to the draft layer and two different sentences to a
//reader, and this is the one question that tells them apart.
const groupNode = (node : FilterExpressionNode) : FilterExpressionNode | null => {
	if (node.kind === 'or') return node;
	if (node.kind === 'not' && node.child.kind === 'or') return node.child;
	return null;
};

//Whether `subset`'s spellings all appear in `superset`, and which spelling is
//left over when exactly one is. Spellings rather than nodes because the compiler
//is what decides when two nodes are the same clause, and it already answers that
//by giving them the same spelling.
const surplusMember = (superset : FilterExpressionNode[], subset : FilterExpressionNode[]) : FilterExpressionNode | null => {
	if (superset.length !== subset.length + 1) return null;
	const remaining = subset.map(serializeFilterNode);
	let surplus : FilterExpressionNode | null = null;
	for (const member of superset) {
		const index = remaining.indexOf(serializeFilterNode(member));
		if (index >= 0) {
			remaining.splice(index, 1);
			continue;
		}
		//Two members unaccounted for is not a widening; it is a different edit
		//wearing a similar shape, and it belongs in the plain added/removed line.
		if (surplus) return null;
		surplus = member;
	}
	return remaining.length ? null : surplus;
};

//THE STRUCTURAL SENTENCE, or '' when this edit is not one of the three shapes.
//Takes the two segments a one-for-one replacement swapped, which is the only
//edit shape a structural gesture can produce: or, flip and remove-an-alternative
//all rewrite ONE condition in place.
const structuralReceipt = (
	removedSegment : string,
	addedSegment : string,
	labels: Record<string, string>,
	cardNames: Record<string, string>
): string => {
	const [before] = parseCollectionExpression([removedSegment]);
	const [after] = parseCollectionExpression([addedSegment]);
	if (!before || !after) return '';
	const name = (node : FilterExpressionNode) => truncatedName(describeExpressionNode(node, labels, cardNames).label);
	//FLIP FIRST, because negation is an involution on every node kind and a
	//flipped group would otherwise read as a narrowing of nothing.
	if (serializeFilterNode(negatedExpressionNode(before)) === serializeFilterNode(after)) {
		//A FLIPPED GROUP CANNOT BE NAMED THE WAY A FLIPPED PILL IS.
		//
		//"Flipped Tagged tag-1 or Tagged tag-2 to not Tagged tag-1 or Tagged
		//tag-2" is the same eleven words twice with one negation buried in the
		//middle of them, and it has the precedence ambiguity the group's own
		//border exists to resolve on screen: read left to right it says (not
		//tag-1) or tag-2, which is a different collection. So the group is named
		//ONCE and the change is stated as what the collection now keeps — which
		//is the fact the user needs, and the only one this sentence can carry
		//unambiguously.
		const group = groupNode(before) || groupNode(after);
		if (group) {
			const negating = Boolean(groupNode(after) && after.kind === 'not');
			return negating ?
				`Flipped ${name(group)} to keep only cards matching none of it` :
				`Flipped ${name(group)} to keep cards matching any of it`;
		}
		return `Flipped ${name(before)} to ${name(after)}`;
	}
	const beforeMembers = alternativesOf(before);
	const afterMembers = alternativesOf(after);
	const added = surplusMember(afterMembers, beforeMembers);
	if (added) return `Widened ${name(before)} with ${name(added)}`;
	//Narrowing names the WHOLE before and the WHOLE after rather than the
	//alternative that left: "Narrowed X or Y to X" says what the clause is now,
	//which is the thing the user has to hold, where "Removed Y from X or Y"
	//would make them do the subtraction themselves.
	if (surplusMember(beforeMembers, afterMembers)) return `Narrowed ${name(before)} to ${name(after)}`;
	return '';
};

export const collectionDraftReceipt = (
	before: CollectionDescription,
	after: CollectionDescription,
	filterLabels: Record<string, string> = {},
	cardNames: Record<string, string> = {}
): string => {
	const beforeFilters = new Set(before.filters);
	const afterFilters = new Set(after.filters);
	const removed = before.filters.filter(filter => !afterFilters.has(filter));
	const added = after.filters.filter(filter => !beforeFilters.has(filter));
	const name = (filter: string) => collectionFilterDisplayName(filter, filterLabels, cardNames);
	if (removed.length === 1 && added.length === 1) {
		const structural = structuralReceipt(removed[0], added[0], filterLabels, cardNames);
		if (structural) return structural;
		//An argument edit: the same family, differently configured. Checked
		//AFTER the structural shapes, because a flip of a configurable clause
		//keeps its family and would otherwise read as a change of arguments.
		if (removed[0].split('/')[0] === added[0].split('/')[0]) {
			return `Changed ${truncatedName(name(removed[0]))} to ${truncatedName(name(added[0]))}`;
		}
	}
	const changes: string[] = [];
	if (removed.length) changes.push(`Removed ${namedList(removed.map(name))}`);
	if (added.length) changes.push(`Added ${namedList(added.map(name))}`);
	if (before.set !== after.set) changes.push(`Changed the starting set to ${collectionOptionDisplayName(after.set)}`);
	if (before.sort !== after.sort) changes.push(`Changed the order to ${collectionOptionDisplayName(after.sort)}`);
	if (before.sortReversed !== after.sortReversed) changes.push(after.sortReversed ? 'Reversed the order' : 'Restored the normal order');
	if (before.viewMode !== after.viewMode) changes.push(`Changed the view to ${collectionOptionDisplayName(after.viewMode)}`);
	else if (before.viewModeExtra !== after.viewModeExtra) changes.push('Changed the focus card');
	if (!changes.length) return 'Updated this draft';
	return changes.join(' · ');
};

//THE TYPO TIER: A MISSPELLED NAME IS STILL A NAME.
//
//The owner's round-2 note asks for one ranked list that "filters quickly and
//deterministically", with the metric being arrow-downs: type characters, press
//Enter as soon as the top row is right. A single transposed letter used to cost
//the whole ranking — 'staarred' fell through the name tiers, through alias, and
//landed in the description tier underneath every filter whose prose happens to
//contain the word, or in the subsequence fallback underneath those. That is a
//list that punishes typing fast, which is the only way anybody types here.
//
//So a bounded edit distance sits BETWEEN alias and description. The bound is the
//whole design:
//
//  - tokens of 1-2 characters: NEVER. At that length every short word is within
//    one edit of every other one ('or'/'on'/'of'/'is'), so a typo tier there is
//    not a recovery, it is noise with a spellchecker's reputation.
//  - tokens of 3-5 characters: distance <= 1.
//  - tokens of 6+ characters: distance <= 2.
//
//DAMERAU, not plain Levenshtein, because the mistake this tier exists to
//forgive is mostly a TRANSPOSITION — 'tsarred', 'updaetd', 'setcion' — and
//plain Levenshtein charges two edits for one slip of two fingers, which puts
//exactly the commonest typo outside the bound at every length under six.
//
//IT IS AN OPTIMAL-STRING-ALIGNMENT DAMERAU (adjacent transpositions only), and
//that is stated rather than glossed: unrestricted Damerau needs an alphabet-sized
//table per comparison and buys nothing here, because a typed token and a filter
//name do not differ by two overlapping transpositions.
//
//BOUNDED FOR SPEED AS WELL AS FOR MEANING. Every keystroke compares one token
//against every name and alias in the vocabulary — hundreds of strings — so the
//function bails on a length difference greater than the bound before allocating
//anything, and stops a row early when the whole row is already over budget. Both
//are exact: an early return can only happen when the true distance is provably
//greater than `maximum`.
//
//DETERMINISTIC BY CONSTRUCTION: no locale collation, no normalization tables, no
//corpus statistics. The same two strings and the same bound give the same answer
//on every machine and in every session, which is what lets the arrow-down
//fixture in the test suite be an assertion rather than a hope.

//The length thresholds, named so a failing test can speak in the words the
//design uses.
export const TYPO_MINIMUM_TOKEN_LENGTH = 3;
export const TYPO_SHORT_TOKEN_MAXIMUM_LENGTH = 5;

//How many edits a token of a given length is allowed to be wrong by. 0 means
//the typo tier does not fire at all for that token.
export const typoBudgetForToken = (token : string) : number => {
	if (token.length < TYPO_MINIMUM_TOKEN_LENGTH) return 0;
	if (token.length <= TYPO_SHORT_TOKEN_MAXIMUM_LENGTH) return 1;
	return 2;
};

//BOUNDED OPTIMAL-STRING-ALIGNMENT DISTANCE. Returns the true distance when it is
//<= maximum, and `maximum + 1` when it is not — callers only ever ask "is it
//within budget", and computing the exact value of an out-of-budget distance is
//work spent on an answer nobody reads.
export const boundedDamerauLevenshtein = (left : string, right : string, maximum : number) : number => {
	if (maximum < 0) return 1;
	if (left === right) return 0;
	//A length difference is a lower bound on the distance, and it is free.
	if (Math.abs(left.length - right.length) > maximum) return maximum + 1;
	if (!left.length) return right.length <= maximum ? right.length : maximum + 1;
	if (!right.length) return left.length <= maximum ? left.length : maximum + 1;

	const width = right.length + 1;
	//Three rows is all an OSA distance needs: the transposition case reaches
	//exactly two rows back.
	let twoBack : number[] = new Array(width).fill(0);
	let oneBack : number[] = new Array(width);
	let current : number[] = new Array(width);
	for (let column = 0; column < width; column++) oneBack[column] = column;

	for (let row = 1; row <= left.length; row++) {
		current[0] = row;
		//Only the band within `maximum` of the diagonal can hold a value that
		//stays under budget; everything outside it is over by construction.
		const from = Math.max(1, row - maximum);
		const to = Math.min(right.length, row + maximum);
		for (let column = 1; column < from; column++) current[column] = maximum + 1;
		for (let column = to + 1; column <= right.length; column++) current[column] = maximum + 1;
		let best = maximum + 1;
		for (let column = from; column <= to; column++) {
			const substitution = left[row - 1] === right[column - 1] ? 0 : 1;
			let value = Math.min(
				current[column - 1] + 1,
				oneBack[column] + 1,
				oneBack[column - 1] + substitution
			);
			//The transposition, at the cost of one edit rather than two.
			if (
				row > 1 && column > 1 &&
				left[row - 1] === right[column - 2] &&
				left[row - 2] === right[column - 1]
			) {
				value = Math.min(value, twoBack[column - 2] + 1);
			}
			current[column] = value;
			if (value < best) best = value;
		}
		//Every reachable cell in this row is already over budget, and distances
		//never decrease going down, so the answer is out of budget.
		if (best > maximum) return maximum + 1;
		const rotated = twoBack;
		twoBack = oneBack;
		oneBack = current;
		current = rotated;
	}
	const distance = oneBack[right.length];
	return distance <= maximum ? distance : maximum + 1;
};

//IS THIS TOKEN A TYPO OF THAT ONE? The bound comes from the TYPED token's
//length, not the candidate's: the user's word is the evidence about how much
//they meant to type, and letting a long candidate widen the budget is how
//'tag' comes to match 'not-automatically-prioritized'.
export const tokenIsTypoOf = (token : string, candidate : string) : boolean => {
	const budget = typoBudgetForToken(token);
	if (!budget) return false;
	if (!candidate) return false;
	//An exact or prefix relationship is not a typo — those are higher tiers, and
	//claiming them here would let a name-prefix match arrive labeled 'typo'.
	if (candidate === token || candidate.startsWith(token)) return false;
	return boundedDamerauLevenshtein(token, candidate, budget) <= budget;
};

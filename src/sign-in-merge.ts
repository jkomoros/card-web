//WHAT TO DO WHEN THE GOOGLE ACCOUNT A VISITOR SIGNS IN WITH ALREADY EXISTS
//(#789). Signing in links Google onto the anonymous account, which keeps that
//account's uid and so its stars, reads and reading list. When the Google
//account is already a user of its own — signed in on another device, or on
//this one before the site data was cleared — linking fails
//(auth/credential-already-in-use) and the only way forward is to SWITCH to
//that account, leaving whatever this anonymous session accumulated under its
//own uid, where nothing will read it again (nothing migrates it: each star
//re-counted would inflate the card's star_count and email the admin once per
//star).
//
//So the question is whether there is anything to lose, and the answer comes
//from the session's own counts — real since #788, when an anonymous session
//started loading its stars back. Stars and a reading list are deliberate;
//reads mostly are not (auto-mark-read records one after five seconds on any
//card), so a few dozen of them are the threshold the original TODO named.
//Counts that have not loaded yet count as something to lose: never switch
//on a guess.
//
//Pure, with no notion of WHICH leg (popup or redirect) is asking: giving the
//rule those inputs is how the two legs came to disagree in the first place.

export type MergeInputs = {
	stars : number,
	readingList : number,
	reads : number,
	//Whether all three authoritative sets have been delivered.
	loaded : boolean,
};

export type MergeLoss = {
	stars : number,
	readingList : number,
	reads : number,
};

export type MergeDecision =
	| {kind : 'switch'}
	//`lose` is null when the counts are not known, and the copy says so.
	| {kind : 'ask', lose : MergeLoss | null};

export const READS_WORTH_ASKING_ABOUT = 25;

export const mergeDecision = (inputs : MergeInputs) : MergeDecision => {
	if (!inputs.loaded) return {kind: 'ask', lose: null};
	const lose = {stars: inputs.stars, readingList: inputs.readingList, reads: inputs.reads};
	if (lose.stars > 0 || lose.readingList > 0 || lose.reads >= READS_WORTH_ASKING_ABOUT) return {kind: 'ask', lose};
	return {kind: 'switch'};
};

const cards = (count : number) : string => `${count.toLocaleString('en-US')} card${count === 1 ? '' : 's'}`;

const joinParts = (parts : string[]) : string => {
	if (parts.length <= 1) return parts.join('');
	return parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1];
};

//THE QUESTION, as the destructive-confirm dialog asks it (HOUSE-STYLE §2.4
//what/what-it-means, §2.7's phrasing supplied by the dialog, §3.7's verb on
//the button). It is the STARS, the MARKS and the LIST that are left behind,
//not the cards, and they are left behind for good, not kept on the device.
//Only the parts that are not zero are named, and reads only when there are
//enough to have asked about; with unknown counts it names nothing it cannot
//count.
export const switchAccountQuestion = (lose : MergeLoss | null) : {title : string, what : string, verb : string} => {
	const parts : string[] = [];
	if (lose) {
		if (lose.stars > 0) parts.push(`your stars on ${cards(lose.stars)}`);
		if (lose.readingList > 0) parts.push(`${cards(lose.readingList)} in your reading list`);
		if (lose.reads >= READS_WORTH_ASKING_ABOUT) parts.push(`your read marks on ${cards(lose.reads)}`);
	}
	const leaves = parts.length ? joinParts(parts) : 'any stars, read marks and reading list from this session';
	return {
		title: 'Switch Account',
		what: `You\u2019ve signed in with that Google account before. Switching to it leaves behind ${leaves}.`,
		verb: 'Switch account',
	};
};

//User-facing copy for transient outcomes, in one place.
//
//Modelled on sync-copy.ts, and for the same reason it exists: #758 documents
//FIVE different prose phrasings all reconstructing one already-clean enum.
//AuxWriteOutcome is 'committed' | 'queued' | 'discarded' (aux-write-queue.ts),
//and none of that structure reaches the user — so "processed safely",
//"server-confirmed", "queued for replay" and two more all describe the same
//three states, inconsistently, and the one that actually means data did not
//survive is the one a user is least equipped to pick out.
//
//Zero imports beyond the types, so any action or component can use it.

import {
	SnackbarKind
} from './types.js';

//Only 'discarded' is bad news. 'queued' must never lead with a failure verb:
//the write IS saved, it simply has not reached the server, and telling someone
//their work failed when it did not is its own defect.
export const outcomeMessage = (kind : SnackbarKind, noun : string, count : number) : string => {
	const things = count === 1 ? noun : noun + 's';
	const they = count === 1 ? 'It' : 'They';
	switch (kind) {
	case 'committed':
		return `${count} ${things} saved.`;
	case 'queued':
		return `${count} ${things} saved on this device. ${they} will reach the server when the connection recovers. Nothing is lost.`;
	case 'discarded':
		return `${count} ${things} could not be saved and will not be retried.`;
	default:
		//refused/info are not outcome counts; a caller passing one here has
		//almost certainly picked the wrong kind, and a bare "1 card." is a
		//fragment, not a message.
		return `${count} ${things}`;
	}
};

//How long a message of each kind should stay, in ms. 0 means "until dismissed".
//
//Taken from what the app already chose, not from taste: the two
//durability-promise messages in actions/data.ts already use 8000, and the
//outcome counts use 5000.
//
//A discarded write does not time out at all. Being straight about the rule:
//HOUSE-STYLE §3.6.1 point 4 says a discarded write belongs in a persistent
//ERROR BANNER, not a snackbar. That banner is listed in §5 as not yet built, so
//a sticky toast is the interim, NOT what the rule asks for. When the banner
//lands, `discarded` should move to it and this entry should go back to a
//normal duration.
export const DEFAULT_DURATIONS : {[kind in SnackbarKind] : number} = {
	'committed': 5000,
	'queued': 8000,
	'discarded': 0,
	'refused': 6000,
	'info': 4000,
};

//A message with something to press needs long enough to reach for it.
export const MINIMUM_DURATION_WITH_ACTION = 10000;

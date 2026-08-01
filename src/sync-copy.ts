//The single source of truth for user-facing copy about card sync not being
//ready. Zero imports beyond the status type, so any component or action can use
//it without a cycle.
//
//There were eight different sentences for "sync is not live yet" — "still
//verifying", "temporarily unavailable while card sync verifies", "must be live
//before saving", "saving opens when it is live", and so on. Worse, all of them
//ASSERTED verifying, while the gate (selectCardSavesEligible) also fires on
//`stale`, `off` and `degraded` — so during an interruption the header pill read
//"Card sync is interrupted" while the Save tooltip two inches away read "still
//verifying". Derive the reason from the actual status instead of asserting one.

import {
	CorpusStatus
} from './types.js';

//What is currently true of sync, as a clause that can follow "because".
const stateClause = (status : CorpusStatus) : string => {
	switch (status) {
	case 'stale':
		return 'card sync is interrupted';
	case 'degraded':
		return 'card sync is degraded';
	case 'contended':
	case 'inactive':
		return 'Compendium is active in another tab';
	case 'takeover':
		return 'Compendium is moving to this tab';
	case 'unsupported':
	case 'ownership-error':
		return 'card sync could not start';
	default:
		//'loading' / 'checking' / anything else still settling.
		return 'card sync is still verifying';
	}
};

//When it will resolve, if it will resolve on its own.
const resolutionClause = (status : CorpusStatus) : string => {
	switch (status) {
	case 'stale':
		return 'It unlocks when sync reconnects.';
	case 'contended':
	case 'inactive':
		return 'Use this tab to bring it back here.';
	case 'unsupported':
	case 'ownership-error':
	case 'degraded':
		return '';
	default:
		return 'It unlocks as soon as sync is live.';
	}
};

//`verb` is the thing the user is trying to do, as a gerund phrase: 'Saving',
//'Creating a card', 'Editing all cards'.
export const blockedReason = (status : CorpusStatus, verb : string) : string => {
	const resolution = resolutionClause(status);
	return `${verb} is unavailable because ${stateClause(status)}.${resolution ? ' ' + resolution : ''}`;
};

//The same thing phrased for a thrown Error, where the subject is the action
//rather than the control.
export const blockedError = (status : CorpusStatus, verb : string) : string =>
	`${blockedReason(status, verb)} Your work is kept.`;

export const SAVE_VERB = 'Saving';
export const CREATE_VERB = 'Creating a card';

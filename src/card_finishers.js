import {
	CARD_TYPE_WORKING_NOTES
} from './card_fields.js';

import {
	getSemanticFingerprintForCard
} from './selectors.js';

const WORKING_NOTES_TITLE_PREFIX = '>';
const NUM_TERMS_OF_FINGERPRINT = 8;

const workingNotesExtractor = (card,state) => {
	//TODO: also include first part of semantic fingerprint.
	const date = card.updated.toDate();
	const fingerprint = getSemanticFingerprintForCard(state, card.id);
	const prettyFingerprint = fingerprint ? [...fingerprint.keys()].slice(0, NUM_TERMS_OF_FINGERPRINT).join(' ') : '';
	const title = WORKING_NOTES_TITLE_PREFIX + ' ' + date.toLocaleDateString('en-US', {month:'numeric', day:'numeric', year:'2-digit'}) + ' ' + prettyFingerprint;
	return {
		...card,
		title,
	};
};

//These are the functions that should be passed a card right as editing is
//committing. They are given the card and the state, and should return a card
//with the fields set as they want. The card should not be modified; if new
//fields are to be added a copy should be returned. This is a useful point to do
//field derivation, like title fields for working-notes cards. 
export const CARD_TYPE_EDITING_FINISHERS = {
	[CARD_TYPE_WORKING_NOTES]: workingNotesExtractor,
};
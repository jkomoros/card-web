import {
	CARD_TYPE_WORKING_NOTES
} from './card_fields.js';

import {
	cardWithNormalizedTextProperties,
} from './nlp.js';

import {
	getSemanticFingerprintForCard,
	selectCards,
	selectConcepts,
} from './selectors.js';

import {
	backportFallbackTextMapForCard,
} from './util.js';

const NUM_TERMS_OF_FINGERPRINT = 8;

const workingNotesExtractor = (card,state) => {
	//TODO: also include first part of semantic fingerprint.
	const date = card.updated && card.updated.toDate ? card.updated.toDate() : new Date();
	//The fingerprint requires these to be up to date, but we only update these
	//on a timeout in textFieldUpdated so typing isn't expensive. It's possible
	//that timeout hasn't fired yet, so make sure the card content is up to date.
	const fallbackMap = backportFallbackTextMapForCard(card, selectCards(state));
	const conceptsMap = selectConcepts(state);
	const cardCopy = cardWithNormalizedTextProperties(card, fallbackMap, conceptsMap);
	const fingerprint = getSemanticFingerprintForCard(state, cardCopy);
	const pretty = fingerprint.dedupedPrettyItems();
	const title = date.toLocaleDateString('en-US', {month:'numeric', day:'numeric', year:'2-digit'}) + ' ' + pretty.split(' ').slice(0, NUM_TERMS_OF_FINGERPRINT).join(' ');
	return {
		...card,
		title,
	};
};

//These are the functions that should be passed a card right as editing is
//committing. They are given the card and the state, and should return a card
//with the fields set as they want. The card should not be modified; if new
//fields are to be added a copy should be returned. This is a useful point to do
//field derivation, like title fields for working-notes cards. If the finisher
//throws an error, then the card edit/create will not happen, which makes it
//also a useful place to do validation before saving.
export const CARD_TYPE_EDITING_FINISHERS = {
	[CARD_TYPE_WORKING_NOTES]: workingNotesExtractor,
};

//TODO: ideally the above would be fields in CARD_TYPE_CONFIGURATION if the
//circular import problem could be gotten rid of
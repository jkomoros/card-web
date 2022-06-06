import {
	CARD_TYPE_WORKING_NOTES,
	CARD_TYPE_CONCEPT,
	TEXT_FIELD_BODY
} from './card_field_constants.js';

import {
	cardWithNormalizedTextProperties,
	getAllConceptStringsFromConceptCard,
	getAllConceptCardsForConcept
} from './nlp.js';

import {
	getSemanticFingerprintForCard,
	selectCards,
	selectConcepts,
	selectSynonymMap
} from './selectors.js';

import {
	backportFallbackTextMapForCard,
} from './util.js';

import {
	Card,
	State
} from './types.js';

const NUM_TERMS_OF_FINGERPRINT = 8;

const workingNotesExtractor = (card : Card, state : State) => {
	//TODO: also include first part of semantic fingerprint.
	const date = card.updated && card.updated.toDate ? card.updated.toDate() : new Date();
	//The fingerprint requires these to be up to date, but we only update these
	//on a timeout in textFieldUpdated so typing isn't expensive. It's possible
	//that timeout hasn't fired yet, so make sure the card content is up to date.
	const fallbackMap = backportFallbackTextMapForCard(card, selectCards(state));
	const conceptsMap = selectConcepts(state);
	const synonymMap = selectSynonymMap(state);
	const cardCopy = cardWithNormalizedTextProperties(card, fallbackMap, conceptsMap, synonymMap);
	const fingerprint = getSemanticFingerprintForCard(state, cardCopy, [TEXT_FIELD_BODY]);
	const pretty = fingerprint.dedupedPrettyItemsFromCard();
	const title = date.toLocaleDateString('en-US', {month:'numeric', day:'numeric', year:'2-digit'}) + ' ' + pretty.split(' ').slice(0, NUM_TERMS_OF_FINGERPRINT).join(' ');
	card.title = title;
};

const conceptValidator = (card : Card, state : State) => {
	//The primary purpose of this validator is to make sure that this card's
	//title doesn't clash with any that already exist as concepts.
	const allCards = selectCards(state);
	for (const conceptStr of getAllConceptStringsFromConceptCard(card)) {
		//Filter all OTHER cards that overlap with this card
		const matchingCards = getAllConceptCardsForConcept(allCards, conceptStr).filter(conceptCard => card.id != conceptCard.id);
		if (matchingCards.length > 0) {
			const warningMessage = 'Other cards overlapped with the proposed concept name or alternate title: "' + conceptStr + '": ' + matchingCards.map(card => card.id + ':"' + card.title + '"').join(',') + '\nChange the title to something that doesn\'t overlap in order to save';
			throw new Error(warningMessage);
		}
	}
};

//These are the functions that should be passed a card right as editing is
//committing. They are given the card and the state, and should return a card
//with the fields set as they want. The card may be modified in place. This is a
//useful point to do field derivation, like title fields for working-notes
//cards. If the finisher throws an error, then the card edit/create will not
//happen, which makes it also a useful place to do validation before saving.
//Note that the card might not have ever been saved before, so its timestamp
//fields in particular might be empty or sentinel values.
export const CARD_TYPE_EDITING_FINISHERS = {
	[CARD_TYPE_WORKING_NOTES]: workingNotesExtractor,
	[CARD_TYPE_CONCEPT]: conceptValidator, 
};

//TODO: ideally the above would be fields in CARD_TYPE_CONFIGURATION if the
//circular import problem could be gotten rid of
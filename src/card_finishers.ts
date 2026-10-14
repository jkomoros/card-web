import {
	getAllConceptStringsFromConceptCard,
	getAllConceptCardsForConcept
} from './nlp.js';

import {
	selectCards
} from './selectors.js';

import {
	clipTitle
} from './util.js';

import {
	innerTextForHTML
} from '../shared/util.js';

import {
	Card,
	CardType,
	State
} from './types.js';

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
//
//Working-notes no longer has one: its finisher wrote a dated semantic
//fingerprint of the body — built over the VIEWER's corpus and IDF — into the
//shared title field on every save, and worker-off rebuilt that IDF over the
//whole corpus per save. The title is authorable and optional now, and the
//dated summary is a display-only projection (working-notes-display-title.ts).
export const CARD_TYPE_EDITING_FINISHERS : {[type in CardType]+?: (card : Card, state : State) => void} = {
	'concept': conceptValidator,
	'quote': (card : Card) => {
		const title = innerTextForHTML(card.body);
		card.title = clipTitle(title);
	}
};

//TODO: ideally the above would be fields in CARD_TYPE_CONFIGURATION if the
//circular import problem could be gotten rid of
//The kernel of the working-notes display title, pure over a processed card
//and a fingerprint generator: "<m/d/yy> <up to eight fingerprint terms from
//the body>". Shared by the worker (which computes titles over the viewer's
//corpus, freezes them to the card's substantive-update time and ships them
//in the compact meta) and by the main-thread fallback in
//working-notes-display-title.ts. It reads no state and imports no selectors,
//so the worker may import it; the import-boundary pin guards the main-thread
//module, not this one, because this one cannot produce a title without being
//handed the viewer's own generator.

import {
	FingerprintGenerator
} from './nlp.js';

import {
	timestampToMillis
} from './util.js';

import type {
	Card,
	ProcessedCard
} from './types.js';

const NUM_TERMS = 8;

//The date the finisher used was `updated`, which no longer survives: every
//inbound-link write bumps it and the cutover script bumps it once more, so
//every legacy note would show the cutover date. updated_substantive is the
//last content save (the drawer's "last activity"); created is the fallback
//for a never-saved card, and now for a card with neither.
export const displayTitleDate = (card : Card) : Date => {
	const millis = timestampToMillis(card.updated_substantive, NaN);
	if (Number.isFinite(millis)) return new Date(millis);
	const created = timestampToMillis(card.created, NaN);
	if (Number.isFinite(created)) return new Date(created);
	return new Date();
};

//One formatter, hoisted: toLocaleDateString constructs one per call (~35µs),
//and a cold drawer window renders ~250 date placeholders per pass.
const DATE_FORMAT = new Intl.DateTimeFormat('en-US', {month: 'numeric', day: 'numeric', year: '2-digit'});
export const displayTitleDateLabel = (card : Card) : string => DATE_FORMAT.format(displayTitleDate(card));

//What a frozen title is keyed on: the card's substantive-update time. A
//title changes only when the card's content was saved — never on an IDF
//epoch or a concept edit, which is what the owner asked for ("very, very
//rarely; quite stale is fine").
export const displayTitleKey = (card : Card) : string => {
	const millis = timestampToMillis(card.updated_substantive, NaN);
	if (Number.isFinite(millis)) return 's' + millis;
	const created = timestampToMillis(card.created, NaN);
	return Number.isFinite(created) ? 'c' + created : '';
};

//The projection itself, uncached. The card must be the processed card (its
//normalized text, backported reference text and concept enrichment are what
//the finisher computed inline before fingerprinting).
export const generatedWorkingNotesTitle = (card : ProcessedCard, generator : FingerprintGenerator) : string => {
	const pretty = generator.fingerprintForCardObj(card, ['body']).dedupedPrettyItemsFromCard();
	const terms = pretty.split(' ').filter(Boolean).slice(0, NUM_TERMS).join(' ');
	const date = displayTitleDateLabel(card);
	return terms ? `${date} ${terms}` : date;
};

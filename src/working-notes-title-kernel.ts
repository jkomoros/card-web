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

//The key frozen titles carried before the revision key: the substantive-
//update time, else the creation time. Still the key for a legacy card that
//has never been written under the revision Rules, and what a persisted
//title is migrated FROM at prime (restoredDisplayTitleKey).
export const legacyDisplayTitleKey = (card : Card) : string => {
	const millis = timestampToMillis(card.updated_substantive, NaN);
	if (Number.isFinite(millis)) return 's' + millis;
	const created = timestampToMillis(card.created, NaN);
	return Number.isFinite(created) ? 'c' + created : '';
};

//What a frozen title is keyed on: the card's revision, which the Rules bump
//on every content write (body, tags, section, sort order…) and which
//counters and inbound-reference mirrors leave alone. A title changes only
//when the card was saved — never on an IDF epoch or a concept edit, which
//is what the owner asked for ("very, very rarely; quite stale is fine").
//It was keyed on updated_substantive, and that field moves only when the
//editor's "substantive" box is checked: an ordinary body edit on a note
//left it at the creation time, so the title computed at creation — over an
//EMPTY body, the bare date — was never recomputed (#784; the finisher this
//replaced regenerated the title at every save, so master never showed it).
export const displayTitleKey = (card : Card) : string => {
	if (typeof card.revision === 'number' && Number.isFinite(card.revision)) return 'r' + card.revision;
	return legacyDisplayTitleKey(card);
};

//The key a persisted title should carry for the card image it was saved
//with: a title frozen under the legacy key for THAT image is exact for it,
//so it is re-keyed rather than recomputed. Without this the first boot after
//the key change would have dropped every saved title at prime and recomputed
//all ~44.7k in the warm-up (~24 s), with bare dates on every surface the
//first window does not cover — the flash the owner asked never to see.
export const restoredDisplayTitleKey = (card : Card | undefined, key : string) : string => {
	if (!card) return key;
	return key === legacyDisplayTitleKey(card) ? displayTitleKey(card) : key;
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

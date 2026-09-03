//WHAT COLOUR A CLAUSE IS, DECIDED FROM ITS SPELLING AND NOTHING ELSE.
//
//THE MAPPING, WHICH IS THE WHOLE MODULE:
//
//  family          example spellings                        token
//  ------------------------------------------------------------------------
//  card-type       content, working-notes, concept,          --app-clause-card-type-color
//                  person, quote, work, section-head           steel blue
//  date            created/…, updated/after/…,               --app-clause-date-color
//                  last-tweeted/…                              forest green
//  person          author/me, author/<uid>                   --app-clause-person-color
//                                                              plum
//  relationship    children/…, parents/…, ancestors/…,       --app-clause-relationship-color
//                  descendants/…, connections/…,               indigo
//                  direct-connections/…, references/…,
//                  references-{in,out}bound/…,
//                  direct-references{,-inbound,-outbound}/…
//  similarity      similar/…, similar-cutoff/…,              --app-clause-similarity-color
//                  same-type/…, different-type/…               rose
//  text            query/…, query-strict/…, cards/…,         --app-clause-text-color
//                  about-concept/…, missing-concept/…          terracotta
//  card-property   starred, unstarred, published,            --app-clause-property-color
//                  unpublished, unread, has-todo,              olive
//                  has-*-references, needs-*, …
//  set-or-sort     in-all-set, in-reading-list,              --app-clause-structural-color
//                  in-everything-set (and their inverses)      slate
//  unknown         combine/…, exclude/…, expand/…,           --app-dark-text-color-darker
//                  limit/…, offset/…, a manual clause's        grey (reused, not new)
//                  verbatim source, anything unrecognised
//
//WHY THERE IS A PALETTE AT ALL, AND WHY THE PREVIOUS ANSWER WAS "ONE NEUTRAL".
//
//The sentence used to paint every clause that was not a value pill in a single
//grey, and the argument for that was a good one as far as it went: colour
//should appear where it ALREADY means something, so a tag wears the colour it
//wears in the card-info panel and everything else stays quiet. The cost of that
//rule only shows up at the scale a collection is actually read at. `Card type:
//Content`, `Updated since 7 days ago`, `By me` and `Starred` are four different
//KINDS of claim about a set of cards — one about what a card IS, one about
//when it changed, one about who wrote it, one about a flag on it — and painted
//in one grey they are four identical lozenges. The owner's call: "It should be
//MORE colourful than not, so at a glance, if you squint, you can tell what the
//collection has."
//
//So the rule is no longer "colour only where authored". It is:
//
//  A CLAUSE WEARS ITS FAMILY'S HUE, AND A VALUE WEARS ITS OWN.
//
//Those are different claims and they compose without contradicting each other.
//A value pill — a tag, a section, a contributor — is a specific THING the app
//already has a colour for, and it keeps that colour so the sentence's chip and
//the card's chip cannot disagree. A clause that is not a value has no identity
//of its own to be coloured by, so it takes the colour of the QUESTION it asks.
//The lookup that decides which of those a clause is has not changed at all
//(see collection-sentence's _chipInfos); only the answer for the second case
//has.
//
//WHY NOT JUST GIVE EVERY FILTER ITS OWN COLOUR? Because that is the pill
//rainbow the spec warned about, and it fails the actual test. Squinting at a
//sentence does not resolve a hundred hues; it resolves five or six. Per-filter
//colour would also have to be authored per filter and would rot the moment the
//reference-type registry grew a member. One hue per CATEGORY is the coarsest
//partition that still answers the question a glance asks — "what sort of
//collection is this?" — and differentiation WITHIN a category comes from the
//label, which is where prose belongs, never from a second hue.
//
//THE RAMP, AND WHY IT IS A RAMP. Every hue sits between 26% and 42% lightness
//at 40–62% saturation, so the eight fills read as one deliberate family rather
//than as confetti — the failure mode of any palette assembled one colour at a
//time. Minimum separation between any two of the seven HUED families is 38°
//(rose 340° to terracotta 18°, going the short way round), which is what the
//squint test needs: closer than that and two categories merge at a glance,
//which is the only thing the palette exists to prevent.
//
//SET-OR-SORT IS THE ONE THAT IS DELIBERATELY NOT A HUE. A set or a sort is not
//a subject the collection is about; it is scaffolding the subjects hang on. So
//it gets the one QUIET treatment — slate at 12% saturation — rather than an
//eighth hue competing with the seven that carry meaning. That is why the
//"no two categories share a hue" pin measures the hued seven and asserts
//separately that this one is desaturated: 210° is card-type's angle too, and at
//12% saturation it is not a blue, it is a grey with a temperature.
//
//THE FOUR RESERVED SEMANTICS OF §4.5 ARE KEPT CLEAR. Brand purple sits at
//~268°, live teal at 174°, warning red at 0°, pending amber at 33°. Every
//family hue is at least 15° from every one of them (the two tightest:
//terracotta 18° against amber 33°, indigo 252° against purple 268°), and each
//is far darker and less saturated than the status colour it is nearest, so a
//clause hue is never mistaken for a status. A pill saying which cards you asked
//for must never read as a pill saying something went wrong.
//
//WHITE TEXT, EVERYWHERE, AT AA. tag-chip paints --app-light-text-color on the
//fill, so every value here is checked against white rather than against the
//page. Measured, not asserted: date 6.96:1, card-type 7.80:1, relationship
//8.44:1, person 8.74:1, similarity 8.17:1, text 7.36:1, card-property 6.37:1,
//set-or-sort 6.34:1, and the reused grey 8.45:1. The floor is 4.5:1 and the
//worst of them clears it by 40%.
//
//WHAT THIS MODULE REFUSES TO KNOW. It takes a filter SPELLING and nothing else
//— no candidates, no store, no corpus, no card. That is the constraint that
//makes it usable from the sentence renderer, which has no store connection by
//design, and it is also what makes the whole mapping testable as a pure table.
//Every table it reads is a static registry that ships with the app.
//
//AND WHY THE TAXONOMY IS NOT A NEW ONE. The families below are the same
//partition collection-filter-catalog's `categoryFor` uses to group the
//composer's list, in the same ORDER, because an app with two taxonomies of its
//filters will eventually show a clause filed under Dates painted the colour of
//Relationships. The one difference is the key: `categoryFor` may consult a
//live CANDIDATE (which knows a spelling is a tag, a section, an author), and
//this cannot, so the candidate-only branches are simply absent here — a tag or
//a section never reaches this function at all, because the sentence's tagInfos
//lookup answers it first.

import {
	CARD_FILTER_DESCRIPTIONS,
	CONFIGURABLE_FILTER_ARGUMENTS,
	CONFIGURABLE_FILTER_NAMES,
	INVERSE_FILTER_NAMES,
	SET_INFOS,
} from './filters.js';

import {
	UNION_FILTER_DELIMITER,
} from './filter-constants.js';

import {
	CARD_TYPE_CONFIGURATION,
} from '../shared/card_fields.js';

import {
	CSSColorString,
} from '../shared/types.js';

export type CollectionPillFamily = 'card-type' | 'date' | 'person' | 'relationship' | 'similarity' | 'text' | 'card-property' | 'set-or-sort' | 'unknown';

//THE PLUMBING FAMILIES, WHICH ARE CHECKED FIRST BECAUSE THEIR ARGUMENTS LIE.
//`exclude`, `combine` and `expand` take sub-filter arguments, which is the same
//argument type the relationship families take, so an argument-type test alone
//would file the boolean plumbing of a collection under "relationship" and paint
//it indigo. They are not claims about cards at all — they are the shape of the
//expression — so they take no hue. `categoryFor` puts them in 'Advanced' for
//exactly the same reason and in exactly the same position.
const STRUCTURAL_FAMILIES : ReadonlySet<string> = new Set(['combine', 'exclude', 'expand', 'limit', 'offset']);

//THE SAME FACT, ASKED BY THE EDITOR RATHER THAN BY THE PAINTER.
//
//A structural clause is not a claim about cards, and both verbs the pill row
//offers are claims ABOUT claims: 'Also match…' builds an OR of two predicates,
//and 'Invert' asks for the cards a predicate does not select. Neither means
//anything for `limit/10`, which matches every card and is applied after the
//sort — so `limit/10+limit/20` is not "either" of anything, and inverting it
//empties the collection without saying so. One list decides the colour and the
//verbs, because both are answering the same question about the same clause.
export const collectionFilterIsStructural = (filter : string) : boolean =>
	STRUCTURAL_FAMILIES.has(filter.split('/')[0]);

//Likewise ahead of the argument-type tests: every similarity filter takes a
//key-card, so untested-for they would all come out as relationships. "Cards
//like this one" and "cards this one links to" are different questions and the
//squint test is precisely the place that difference has to survive.
const SIMILARITY_FAMILIES : ReadonlySet<string> = new Set(['similar', 'similar-cutoff', 'same-type', 'different-type']);

//The three date families by name, because `categoryFor` names them too: they
//also declare a `date` argument, so this is belt-and-braces rather than the
//only route, and it keeps the two taxonomies literally the same list.
const DATE_FAMILIES : ReadonlySet<string> = new Set(['created', 'updated', 'last-tweeted']);

//A card type's filter name IS the card type's key — `content`, `working-notes`,
//`concept`, `person`, `quote`, `work`, `section-head`. Read from the
//configuration rather than written out, so a new card type is coloured the day
//it exists rather than the day someone remembers this file.
//
//Checked before the card-property test because every one of these is ALSO a
//perfectly ordinary card filter with a description; and `person` is checked
//here rather than in the person family because the `person` card type is a card
//about a human, while `author/…` is a clause about who wrote a card. Same word,
//two different questions, and the type is the one spelled bare.
const CARD_TYPE_FILTERS : ReadonlySet<string> = new Set(Object.keys(CARD_TYPE_CONFIGURATION));

//A set's filter equivalent, and the excluding half of each pair. Derived from
//SET_INFOS and INVERSE_FILTER_NAMES rather than spelled out, because
//`not-in-reading-list` is scaffolding for exactly the reason
//`in-reading-list` is, and a hand-written list would have carried only one of
//them.
const SET_FILTERS : ReadonlySet<string> = (() => {
	const positives = Object.values(SET_INFOS).map(info => String(info.filterEquivalent));
	const out = new Set<string>(positives);
	for (const [negated, positive] of Object.entries(INVERSE_FILTER_NAMES)) {
		if (out.has(positive)) out.add(negated);
	}
	return out;
})();

const argumentTypesFor = (family : string) : string[] => (CONFIGURABLE_FILTER_ARGUMENTS[family] || []).map(argument => argument.type);

//A filter the app has a user-facing description for is a filter the app KNOWS,
//which is the difference between "a property clause we can name" and "a string
//we could not parse". INVERSE_FILTER_NAMES is consulted too because the
//excluding halves are generated rather than described by hand.
const isKnownFilterName = (name : string) : boolean =>
	CARD_FILTER_DESCRIPTIONS[name] !== undefined || INVERSE_FILTER_NAMES[name] !== undefined;

//THE FAMILY OF ONE CLAUSE, FROM ITS SPELLING.
//
//Two normalisations before any question is asked, and both are shapes the URL
//grammar actually produces:
//
//  `family/arg/arg` — a configurable filter carries its arguments in the same
//  string, so the family is the first segment. `updated/after/2020-01-01` is a
//  date clause; the date itself is not a family.
//
//  `a+b+c` — a union filter is one clause meaning "any of these", and it takes
//  the FIRST member's family. The alternative (refusing to colour a union) would
//  make the commonest multi-tag clause the one grey pill in a coloured
//  sentence, and unions are near-always drawn from one family anyway.
//
//NEGATION IS NOT NORMALISED HERE, because it has already happened: the sentence
//strips a `not` node to its child before asking (`_pill`'s colorNode), for the
//same reason tag-chip inverts a negated pill's fill rather than recolouring it
//— negation changes whether a clause includes or excludes, never what it is
//about. A filter whose negation is a WORD rather than an operator
//(`unpublished`, `unread`, `not-in-reading-list`) arrives spelled out and is
//answered by name, which is why the inverse names are in the tables above.
export const collectionPillFamilyForFilter = (filter : string) : CollectionPillFamily => {
	if (!filter) return 'unknown';
	const firstMember = filter.split(UNION_FILTER_DELIMITER)[0];
	const family = firstMember.split('/')[0];
	if (!family) return 'unknown';
	if (STRUCTURAL_FAMILIES.has(family)) return 'unknown';
	if (CARD_TYPE_FILTERS.has(family)) return 'card-type';
	if (SIMILARITY_FAMILIES.has(family)) return 'similarity';
	if (SET_FILTERS.has(family)) return 'set-or-sort';
	const argumentTypes = argumentTypesFor(family);
	if (argumentTypes.includes('date') || DATE_FAMILIES.has(family)) return 'date';
	if (argumentTypes.includes('user-id')) return 'person';
	if (argumentTypes.some(type => ['key-card', 'reference-type', 'sub-filter', 'expand-filter'].includes(type))) return 'relationship';
	if (argumentTypes.some(type => ['text', 'multiple-cards', 'concept-str-or-id'].includes(type))) return 'text';
	//A configurable filter that matched none of the argument tests above is one
	//this taxonomy has no opinion about yet, and guessing would be worse than
	//saying so: an unfamiliar hue on a familiar clause is the one outcome the
	//squint test cannot recover from.
	if (CONFIGURABLE_FILTER_NAMES[family]) return 'unknown';
	if (isKnownFilterName(family)) return 'card-property';
	return 'unknown';
};

//THE ONE PLACE THE HUES LIVE, AND THEY LIVE HERE AS TOKEN NAMES.
//
//§4.1 is a MUST: no literal colour outside card-web-app.ts's :host block, and
//test/design-tokens fails the build if a component names a token that block does
//not define. So every value here is a var() reference and the values themselves
//are in that block with their role comments. `unknown` reuses the grey the
//sentence has always used for a clause it cannot categorise — it is not a new
//colour and must not become one, because "no opinion" is exactly what that grey
//already means everywhere else in the app.
export const COLLECTION_PILL_FAMILY_COLORS : {readonly [family in CollectionPillFamily] : CSSColorString} = {
	'card-type': 'var(--app-clause-card-type-color)',
	'date': 'var(--app-clause-date-color)',
	'person': 'var(--app-clause-person-color)',
	'relationship': 'var(--app-clause-relationship-color)',
	'similarity': 'var(--app-clause-similarity-color)',
	'text': 'var(--app-clause-text-color)',
	'card-property': 'var(--app-clause-property-color)',
	'set-or-sort': 'var(--app-clause-structural-color)',
	'unknown': 'var(--app-dark-text-color-darker)',
};

export const COLLECTION_PILL_FAMILIES : readonly CollectionPillFamily[] = Object.keys(COLLECTION_PILL_FAMILY_COLORS) as CollectionPillFamily[];

export const collectionPillColorForFilter = (filter : string) : CSSColorString => COLLECTION_PILL_FAMILY_COLORS[collectionPillFamilyForFilter(filter)];

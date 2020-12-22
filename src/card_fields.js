/*

On each card is a references property and a references info.

references_info has the following shape:
{
    'CARD_ID_A': {
        'link': 'text that links to the other',
        'dupe-of': ''
    },
    'CARD_ID_B': {
        'link': '',
    }
}

That is, an object of card ids that then map to a sub-object with keys of
REFERENCE_TYPE_* to strings. The strings are the description affiliated with
that reference. For example, for links, it's the text of the link. For
citations, it might be information like "Page 22". Note that an empty string is
allowed, and counts as a reference. If the cardID is in the reference_info, then
there must be at least one reference set on the object. References_info is the
canonical object that we typically mutate and contains the information.

There's also a references field, that has the following shape:
{
    'CARD_ID_A': true,
    'CARD_ID_B': true,
}

That is, an object mapping card ids to true, IFF that card has a non-empty
references object in referenes_info. References duplicates the references_info,
but in a format that allows doing queries via Firestore (it's not possible to
query for the existence or non-existence of a subobject. You can do the orderBy
trick, but that requires a separate index for each subkey)

Cards also have references_inbound and references_info_inbound. These have
exactly the same shape, but represent the card references blocks from cards that
point TO this card. Those are maintained in the updateInboundLinks cloud
function, and basically just copy the sub-object from refrences_info to the card
that is poitned to.

*/

//NOTE: this next one is duplicated in tweet-helpers.js and both are in
//functions/updates.js;
export const REFERENCES_INFO_CARD_PROPERTY = 'references_info';
export const REFERENCES_INFO_INBOUND_CARD_PROPERTY = 'references_info_inbound';
//These two properties are exactly like the normal references fields exccept
//it's a map of cardID -> true for cards that are referenced.
export const REFERENCES_CARD_PROPERTY = 'references';
export const REFERENCES_INBOUND_CARD_PROPERTY = 'references_inbound';

export const TEXT_FIELD_BODY = 'body';
export const TEXT_FIELD_TITLE = 'title';
export const TEXT_FIELD_SUBTITLE = 'subtitle';
export const TEXT_FIELD_REFERENCES_INFO_INBOUND = REFERENCES_INFO_INBOUND_CARD_PROPERTY;
export const TEXT_FIELD_REFERENCES_NON_LINK_OUTBOUND = 'non_link_references';
export const TEXT_FIELD_STRONG_BODY_TEXT = 'strong_body_text';
export const TEXT_FIELD_RERERENCES_CONCEPT_OUTBOUND = 'concept_references';

export const CARD_TYPE_CONTENT = 'content';
export const CARD_TYPE_SECTION_HEAD = 'section-head';
export const CARD_TYPE_WORKING_NOTES = 'working-notes';
export const CARD_TYPE_CONCEPT = 'concept';

//The card type to assume if none is specified.
export const DEFAULT_CARD_TYPE = CARD_TYPE_CONTENT;

/*

invertContentPublishWarning: if true, then the 'There's content but unpublished,
are you sure?' will not trigger... unelss you try to publish in which case it
will ask for confirmation.

orphanedByDefault: if true, then the confirmation of 'You're about to make this
card orphaned' will be flipped, and the natural location of them will be
orphaned.

publishedByDefault: if true, then createCard will by default create a card that
is published. This is useful for example for concept cards, where the primary
content is the reference list.

styleBlock: if provided, will be rendered as the style block in the card
renderer when this card type is selected. A string that will be run through html
tag. This isn't an html tag to avoid having heavyweight imports so this can be
included in tests.

dark: if true, the card is considered dark, and styles for e.g. thumbnails,
including badge color, will swap.

iconName: a reference from icons to show in front of the title everywhere it
shows up. A string that indexes into icons. This isn't an html tag to avoid
having heavyweight imports so this can be included in tests.

autoSlug: if true, then when a new card is created, it will try to automatically
add a name to the card that is `CARD_TYPE-NORMALIZED-TITLE`.

*/

export const CARD_TYPE_CONFIGURATION = {
	[CARD_TYPE_CONTENT]: {},
	[CARD_TYPE_SECTION_HEAD]: {
		dark: true,
		styleBlock: String.raw`
			<style>
				.background {
					position:absolute;
					display:block;
					height:50%;
					bottom:0;
					width:100%;
					background-color: var(--app-primary-color);
					/* counteract the padding in the base card */
					margin-left:-1.45em;
				}
				h1 {
					font:var(--app-header-font-family);
					font-weight:bold;
					font-size:3.0em;
					margin-top:2.25em;
				}
				h2 {
					color: var(--app-primary-color-subtle);
					font-size:1.2em;
					font-weight:normal;
					position:absolute;
					bottom:1em;
				}
			</style>
		`
	},
	[CARD_TYPE_WORKING_NOTES]: {
		invertContentPublishWarning: true,
		orphanedByDefault: true,
		styleBlock: `
		<style>
			section {
				font-size:0.8em;
				line-height:1.2;
			}
		</style>
		`,
		iconName: 'INSERT_DRIVE_FILE_ICON',
	},
	[CARD_TYPE_CONCEPT]: {
		orphanedByDefault: true,
		publishedByDefault: true,
		iconName: 'MENU_BOOK_ICON',
		autoSlug: true,
	},
};

//For card-links within body content
//NOTE: duplicated in tweet-helpers.js
export const REFERENCE_TYPE_LINK = 'link';
//For cards that are dupes of another card
export const REFERENCE_TYPE_DUPE_OF = 'dupe-of';
//For cards that want to acknowledge another card (e.g. to get the 'missing
//reciprocal links' to go away) without actually doing a more substantive
//reference. These references typically shouldn't 'count' in many cases.
export const REFERENCE_TYPE_ACK = 'ack';
//For references that aren't any of the other types
export const REFERENCE_TYPE_GENERIC = 'generic';
//For cards that were forked from another--that is, whose content started as a
//direct copy of the other card at some point
export const REFERENCE_TYPE_FORK_OF = 'fork-of';
//For cards that want to express they are based on insights 'mined' from the
//other card--typically a working-notes card.
export const REFERENCE_TYPE_MINED_FROM = 'mined-from';
//For cards that want to say you should also see a related card that is similar,
//a kind of peer.
export const REFERENCE_TYPE_SEE_ALSO = 'see-also';
//For saying that the card that is pointing from uses the concept pointed to at
//the other card. The other card may only be a concept card.
export const REFERENCE_TYPE_CONCEPT = 'concept';

//Any key in this object is a legal reference type
/*
name - name of the reference type, for presenting in UIs
descripton - string describing what it means
editable - whether it should be directly editable by a user
substantive - whether the reference is important enough to acknowledge to a non-editor-user in the UI
color - the color to use when it shows up as a tag
excludeFromInfoPanel - if true, will not show up in the infoPanelArray. That might be because they are already visible elsewhere, or aren't important enough to show.
toCardTypeAllowList - if null or undefined, any card of any type may be on the receiving end. If not null, then only card_types in the toCardTypeAllowList map are allowed.
backportMissingText - if true, then if a card has an outbound reference of this type without text, it will backport the title of the to card, so for the purposes of any nlp processing, it will be as though the outbound reference included the title of the card it's pointing to. (The underlying data in the db is untouched)
*/
export const REFERENCE_TYPES = {
	[REFERENCE_TYPE_LINK]: {
		name: 'Body link',
		description: 'Automatically extracted links from the body of the card',
		editable: false,
		substantive: true,
		//limegreen
		color: '#32CD32',
		//already visible on the card itself
		excludeFromInfoPanel: true,
	},
	[REFERENCE_TYPE_DUPE_OF]: {
		name: 'Duplicate of',
		description: 'Denotes that this card is a duplicate of the card that it\'s pointing to',
		editable: true,
		substantive: true,
		//darkcyan
		color: '#008B8B',
		excludeFromInfoPanel: false,
	},
	[REFERENCE_TYPE_ACK]: {
		name: 'Non-substantive acknowledgement',
		description: 'For when a card wants to acknowledge another card, but not form a substantive link. Useful for making the missing-reference go away',
		editable: true,
		substantive: false,
		color: '#CCCCCC',
		//Not important enough
		excludeFromInfoPanel: true,
	},
	[REFERENCE_TYPE_GENERIC]: {
		name: 'Generic reference',
		description: 'For a card to reference another where no other reference type makes sense',
		editable: true,
		substantive: true,
		//sandybrown
		color: '#F4A460',
		excludeFromInfoPanel: false,
	},
	[REFERENCE_TYPE_FORK_OF]: {
		name: 'Forked from',
		description: 'For a card that was forked from another card',
		editable: true,
		substantive: true,
		//darkmagenta
		color: '#8B008B',
		excludeFromInfoPanel: false,
	},
	[REFERENCE_TYPE_MINED_FROM]: {
		name: 'Insights mined from',
		description: 'For a card that denotes that its insights are at least partially based on insights in another card',
		editable: true,
		substantive: true,
		//royalblue
		color: '#4169E1',
		excludeFromInfoPanel: false,
	},
	[REFERENCE_TYPE_SEE_ALSO]: {
		name: 'See also',
		description: 'For cards that make similar points and make sense to consume as a set',
		editable: true,
		substantive: true,
		//navy
		color: '#000080',
		excludeFromInfoPanel: false,
	},
	[REFERENCE_TYPE_CONCEPT]: {
		name: 'Concept',
		description: 'For cards that are about a concept this card uses',
		editable: true,
		substantive: true,
		//darkkhahki
		color: '#BDB76B',
		//It's included in its own section
		excludeFromInfoPanel: true,
		toCardTypeAllowList: {
			[CARD_TYPE_CONCEPT]: true,
		},
		backportMissingText: true,
	}
};

export const REFERENCE_TYPES_THAT_BACKPORT_MISSING_TEXT = Object.fromEntries(Object.entries(REFERENCE_TYPES).filter(entry => entry[1].backportMissingText).map(entry => [entry[0], true]));

//map of card-type -> map of reference-type -> true. So for a given card type,
//you can check if there are any inbound references to the card that should not
//be allowed.
export const LEGAL_INBOUND_REFERENCES_BY_CARD_TYPE = Object.fromEntries(Object.keys(CARD_TYPE_CONFIGURATION).map(cardType => [cardType, Object.fromEntries(Object.entries(REFERENCE_TYPES).filter(referenceTypeEntry => !referenceTypeEntry[1].toCardTypeAllowList || referenceTypeEntry[1].toCardTypeAllowList[cardType]).map(entry => [entry[0], true]))]));

/*
html: whether or not the field allows html. NOTE: currently it's only supported
for a single field to be marked as html, and it must be called 'body'. See #345
for fixing that.

container: the type of container element the field should be printed out into
(the actual card custom element will decide whether to print it out in the first
place)

legalCardTypes: a map of CARD_TYPE constant to true for cards it is legal on. If
this field is null, it signals it's legal on all card types.

derivedForCardTypes: a map of CARD_TYPE constant to true for card types for
which the field is fully derived based on OTHER enumrated fields. Derived fields
are already "counted" so should be skipped when extracting normalized card
details for example in indexes.

readOnly: if true, a form field to edit this won't be printed out in cardEditor.

matchWeight: if a match is found when searching in that field, how much weight
should it receive?

autoFontSizeBoostForCardTypes: For any card type that has a key, fontSizeBoosts
will auto-set the font size for that field, with the value for that field being
used as the max value that the boost can legally be for that field. NOTE: card
types that define reference blocks will interfere with auto-sizing currently.
#407 tracks fixing that.

overrideExtractor: boolean. If true, then nlp.js will expect there to be an
override extractor defined in nlp.js. That is, instead of literally just
fetching a field with that name from card, it will instead rely on an extractor
function. (Those override extractors often require references, which would
pollute the clean imports for this file, so they're defined there)

extraIndexingCount: if a number greater than zero, then when counting words from
that text field, the wordCountForSemantics will pretend like all of the text run
showed up that many times. So undefined or 0 would count as one, and 2 would
triple count.

indexFullRun: if true, then the full normalized text string of each run will be
indexed as though it were an ngram (even if the number of words is too high to
be counted as an ngram). In addition, it will count full (not 1/wordCount).

*/

const DEFAULT_MAX_FONT_BOOST = 0.3;

export const TEXT_FIELD_CONFIGURATION = {
	[TEXT_FIELD_TITLE]: {
		html: false,
		container: 'h1',
		legalCardTypes: {
			[CARD_TYPE_CONTENT]: true,
			[CARD_TYPE_SECTION_HEAD]: true,
			[CARD_TYPE_CONCEPT]: true,
		},
		derivedForCardTypes: {
			[CARD_TYPE_WORKING_NOTES]: true
		},
		autoFontSizeBoostForCardTypes: {},
		matchWeight: 1.0,
	},
	[TEXT_FIELD_BODY]: {
		html: true,
		container: 'section',
		legalCardTypes: {
			[CARD_TYPE_CONTENT]: true,
			[CARD_TYPE_WORKING_NOTES]: true,
			[CARD_TYPE_CONCEPT]: true,
		},
		derivedForCardTypes: {},
		autoFontSizeBoostForCardTypes: {
			[CARD_TYPE_WORKING_NOTES]: DEFAULT_MAX_FONT_BOOST
		},
		matchWeight:0.5,
	},
	[TEXT_FIELD_SUBTITLE]: {
		html: false,
		container: 'h2',
		legalCardTypes: {[CARD_TYPE_SECTION_HEAD]: true},
		derivedForCardTypes: {},
		autoFontSizeBoostForCardTypes: {},
		matchWeight:0.75,
	},
	[TEXT_FIELD_REFERENCES_INFO_INBOUND]: {
		html: false,
		readOnly: true,
		//null signals it's legal for all card types
		legalCardTypes: null,
		derivedForCardTypes: {},
		autoFontSizeBoostForCardTypes: {},
		matchWeight:0.95,
	},
	//This one has a custom extractor, so its name doesn't correspond to a
	//literl field. It's the text of outbound references, except links. The
	//logic is that links are already represented in text in the body, but every
	//other type of reference is not, so it should count for indexing. This is
	//also where backported reference text shows up.
	[TEXT_FIELD_REFERENCES_NON_LINK_OUTBOUND]: {
		html: false,
		readOnly: true,
		//null signals it's legal for all card types
		legalCardTypes: null,
		derivedForCardTypes: {},
		autoFontSizeBoostForCardTypes: {},
		matchWeight:0.5,
		overrideExtractor: true,
	},
	//This one has a custom extractor, to extract text within strong spans in
	//the body. This effectively double-counts any text that is strong in the
	//text, since it's also included in body. Also, since the runs are likely
	//short, it's likely that the runs will be indexed as a full ngram by
	//ngrams.
	[TEXT_FIELD_STRONG_BODY_TEXT]: {
		html: false,
		readOnly: true,
		//null signals it's legal for all card types
		legalCardTypes: null,
		derivedForCardTypes: {},
		autoFontSizeBoostForCardTypes: {},
		matchWeight:1.0,
		overrideExtractor: true,
	},
	//This counts outboudn reference text to concepts. That text will have
	//already been counted in TEXT_FIELD_REFERENCES_NON_LINK_OUTBOUND, so this
	//has the effect of triple counting concepts since theyr'e so important.
	//NOTE: fingerprintItemsFromConceptReferences in nlp.js relies on this configuration
	[TEXT_FIELD_RERERENCES_CONCEPT_OUTBOUND]: {
		html: false,
		readOnly: true,
		//null signals it's legal for all card types
		legalCardTypes: null,
		derivedForCardTypes: {},
		autoFontSizeBoostForCardTypes: {},
		matchWeight:0.75,
		overrideExtractor: true,
		extraIndexingCount: 1,
		indexFullRun: true,
	}
};

export const DERIVED_FIELDS_FOR_CARD_TYPE = Object.fromEntries(Object.keys(CARD_TYPE_CONFIGURATION).map(typ => {
	return [typ, Object.fromEntries(Object.entries(TEXT_FIELD_CONFIGURATION).filter(entry => (entry[1].derivedForCardTypes || {})[typ]).map(entry => [entry[0], true]))];
}));

const AUTO_FONT_SIZE_BOOST_FIELDS_FOR_CARD_TYPE = Object.fromEntries(Object.keys(CARD_TYPE_CONFIGURATION).map(typ => {
	return [typ, Object.fromEntries(Object.entries(TEXT_FIELD_CONFIGURATION).filter(entry => (entry[1].autoFontSizeBoostForCardTypes || {})[typ]).map(entry => [entry[0], true]))];
}));

//types of card that have a body
export const BODY_CARD_TYPES = TEXT_FIELD_CONFIGURATION[TEXT_FIELD_BODY].legalCardTypes;

export const editableFieldsForCardType = (cardType) => {
	let result = {};
	for (let key of Object.keys(TEXT_FIELD_CONFIGURATION)) {
		const config = TEXT_FIELD_CONFIGURATION[key];
		//Items with null for legalCardTypes are legal in all card types
		if (config.legalCardTypes && !config.legalCardTypes[cardType]) continue;
		if (config.readOnly) continue;
		result[key] = config;
	}
	return result;
};

//The special key card ID that will be replaced with a given card in reference blocks
export const SELF_KEY_CARD_ID = 'self';

//Returns an object with field -> boosts to set. It will return
//card.font_size_boosts if no change, or an object like font_size_boosts, but
//with modifications made as appropriate leaving any untouched keys the same,
//and any keys it modifies but sets to 0.0 deleted.
export const fontSizeBoosts = async (card) => {
	if (!card) return {};
	const fields = AUTO_FONT_SIZE_BOOST_FIELDS_FOR_CARD_TYPE[card.card_type] || {};
	const currentBoost = card.font_size_boost || {};
	if (Object.keys(fields).length === 0) return currentBoost;
	const result = {...currentBoost};
	for (const field of Object.keys(fields)) {
		const boost = await calculateBoostForCardField(card, field);
		if (boost == 0.0) {
			if (result[field] !== undefined) delete result[field];
			continue;
		}
		result[field] = boost;
	}
	return result;
};

let cardRendererProvider = null;

//Custom elements that have a sizing card-renderer should all this to offer
//themselves up. This module can't create its own card-renderer because a)
//importing card-renderer leads to a circular dependency, but also because the
//card-renderer has to be within the main web app to get the right css vars so
//it can size accurately. provider should hae a sizingCardRenderer property we
//can fetch an instance of card-renderer from that we may inject our own card
//into.
export const setFontSizingCardRendererProvider = (provider) => {
	if (!cardRendererProvider) cardRendererProvider = provider;
};

const MAX_FONT_BOOST_BISECT_STEPS = 3;

//calculateBoostForCardField is an expensive method because it repeatedly
//changes layout and then reads it back. But even with that, it typically takes
//less than 15ms or so on a normal computer.
const calculateBoostForCardField = async (card, field) => {

	const max = TEXT_FIELD_CONFIGURATION[field].autoFontSizeBoostForCardTypes[card.card_type];
	let low = 0.0;
	let high = max;
	let alwaysLow = true;
	let alwaysHigh = true;

	let middle = ((high - low) / 2) + low;
	let count = 0;
	while (count < MAX_FONT_BOOST_BISECT_STEPS) {
		const overflows = await cardOverflowsFieldForBoost(card, field, middle);
		if (overflows) {
			high = middle;
			alwaysHigh = false;
		} else {
			low = middle;
			alwaysLow = false;
		}
		middle = ((high - low) / 2) + low;
		count++;
	}
	//No matter where we stopped, the value of middle might now overflow (even
	//if there had been no overflows yet). Check one more time. If it does
	//overflow, round down.
	const overflows = await cardOverflowsFieldForBoost(card, field, middle);
	if (overflows) {
		middle = low;
		alwaysHigh = false;
	}

	//Check if it should return the extremes
	if (alwaysHigh && !await cardOverflowsFieldForBoost(card, field, max)) return max;
	if (alwaysLow && await cardOverflowsFieldForBoost(card, field, 0.0)) return 0.0;

	return middle;
};

const cardOverflowsFieldForBoost = async (card, field, proposedBoost) => {
	if (!cardRendererProvider) {
		console.warn('No card renderer provider provided');
		return false;
	}
	let ele = cardRendererProvider.sizingCardRenderer;
	if (!ele) {
		console.warn('No active card renderer');
		return false;
	}
	let tempCard = {...card, font_size_boost: {...card.font_size_boost, [field]:proposedBoost}};
	ele.card = tempCard;
	await ele.updateComplete;
	const isOverflowing = ele.isOverflowing([field]);
	return isOverflowing;
};
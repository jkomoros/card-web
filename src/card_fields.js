import {
	stemmer
} from './stemmer.js';

//We import these only to get deleteSentinel without importing from firebase.js.
import firebase from '@firebase/app';
import '@firebase/firestore';
const deleteSentinel = firebase.firestore.FieldValue.delete;

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

export const CARD_TYPE_CONTENT = 'content';
export const CARD_TYPE_SECTION_HEAD = 'section-head';
export const CARD_TYPE_WORKING_NOTES = 'working-notes';

/*

invertContentPublishWarning: if true, then the 'There's content but unpublished,
are you sure?' will not trigger... unelss you try to publish in which case it
will ask for confirmation.

invertOrphanWarning: if true, then the confirmation of 'You're about to make
this card orphaned' will be flipped

*/

export const CARD_TYPE_CONFIGURATION = {
	[CARD_TYPE_CONTENT]: {},
	[CARD_TYPE_SECTION_HEAD]: {},
	[CARD_TYPE_WORKING_NOTES]: {
		invertContentPublishWarning: true,
		invertOrphanWarning: true,
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

//Any key in this object is a legal reference type
/*
name - name of the reference type, for presenting in UIs
descripton - string describing what it means
editable - whether it should be directly editable by a user
substantive - whether the reference is important enough to acknowledge to a non-editor-user in the UI
color - the color to use when it shows up as a tag
excludeFromInfoPanel - if true, will not show up in the infoPanelArray. That might be because they are already visible elsewhere, or aren't important enough to show.
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
	}
};

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
used as the max value that the boost can legally be for that field

*/

const DEFAULT_MAX_FONT_BOOST = 0.3;

export const TEXT_FIELD_CONFIGURATION = {
	[TEXT_FIELD_TITLE]: {
		html: false,
		container: 'h1',
		legalCardTypes: {[CARD_TYPE_CONTENT]: true, [CARD_TYPE_SECTION_HEAD]: true},
		derivedForCardTypes: {[CARD_TYPE_WORKING_NOTES]: true},
		autoFontSizeBoostForCardTypes: {},
		matchWeight: 1.0,
	},
	[TEXT_FIELD_BODY]: {
		html: true,
		container: 'section',
		legalCardTypes: {[CARD_TYPE_CONTENT]: true, [CARD_TYPE_WORKING_NOTES]: true},
		derivedForCardTypes: {},
		autoFontSizeBoostForCardTypes: {[CARD_TYPE_WORKING_NOTES]: DEFAULT_MAX_FONT_BOOST},
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
	let lastLayoutOverflowed = false;
	let alwaysLow = true;
	let alwaysHigh = true;

	let middle = ((high - low) / 2) + low;
	let count = 0;
	while (count < MAX_FONT_BOOST_BISECT_STEPS) {
		lastLayoutOverflowed = false;
		if (await cardOverflowsFieldForBoost(card, field, middle)) {
			high = middle;
			alwaysHigh = false;
			lastLayoutOverflowed = true;
		} else {
			low = middle;
			alwaysLow = false;
		}
		middle = ((high - low) / 2) + low;
		count++;
	}

	//If lastLayoutOverflowed is true, then the current middlemight also
	//overflow. Round down to low, which should always be a non-overflowing, to
	//be safe.
	if (lastLayoutOverflowed) middle = low;

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
	await ele.activeCardEle.updateComplete;
	const isOverflowing = ele.activeCardEle.isOverflowing([field]);
	return isOverflowing;
};

export const normalizedWords = (str) => {
	if (!str) str = '';

	//Pretend like em-dashes are just spaces
	str = str.split('--').join(' ');
	str = str.split('&emdash;').join(' ');

	const splitWords = str.toLowerCase().split(/\s+/);
	let result = [];
	for (let word of splitWords) {
		word = word.replace(/^\W*/, '');
		word = word.replace(/\W*$/, '');
		if (!word) continue;
		result.push(word);
	}
	return result;
};

let memoizedStemmedWords = {};
const memorizedStemmer = (word) => {
	if (!memoizedStemmedWords[word]) {
		memoizedStemmedWords[word] = stemmer(word);
	}
	
	return memoizedStemmedWords[word];
};

//A more aggressive form of normalization
export const stemmedNormalizedWords = (str) => {
	//Assumes the words are already run through nomralizedWords

	//We split the words the same way in destemmedWordMap. We have to split
	//within here due to complex logic about where '-' is treated as a word
	//split and where it isnt in queries.
	const splitWords = str.split('-').join(' ').split(' ');
	let result = [];
	for (let word of splitWords) {
		result.push(memorizedStemmer(word));
	}
	return result;
};

const innerTextForHTML = (body) => {
	let ele = document.createElement('section');
	//TODO: is there an XSS vulnerability here?
	ele.innerHTML = body;
	return ele.innerText;
};

//Returns a string, where if it's an array or object (or any of their subkeys
//are) they're joined by ' '. This allows it to work straightforwardly for
//normal text properties, as well as arrays, objects, or even nested objects
//that have string values at the terminus.
const extractFieldValueForIndexing = (fieldValue) => {
	if (typeof fieldValue !== 'object') return fieldValue;
	if (!fieldValue) return '';
	return Object.values(fieldValue).map(item => extractFieldValueForIndexing(item)).join(' ');
};

//extractContentWords returns an object with the field to the non-de-stemmed
//normalized words for each of the main properties.
const extractContentWords = (card) => {
	const cardType = card.card_type || '';
	//These three properties are expected to be set by TEXT_SEARCH_PROPERTIES
	//Fields that are derived are calculated based on other fields of the card
	//and should not be considered to be explicit set on the card by the author.
	//For thse fields, skip them in normalized*, since they'll otherwise be part
	//of the fingerprint, and for cards with not much content that use the
	//fingerprint in a derived field that can create reinforcing loops.
	const obj = {};
	for (let [fieldName, config] of Object.entries(TEXT_FIELD_CONFIGURATION)) {
		let value = '';
		if (!DERIVED_FIELDS_FOR_CARD_TYPE[cardType][fieldName]) {
			const fieldValue = extractFieldValueForIndexing(card[fieldName]);
			const content = config.html ? innerTextForHTML(fieldValue) : fieldValue;
			const words = normalizedWords(content);
			value = words.join(' ');
		}
		obj[fieldName] = value;
	}
	return obj;
};

//destemmedWordMap returns a map of where each given destemmed word is mapped to
//its most common stemmed variant from within this card.
export const destemmedWordMap = (card) => {
	const content = extractContentWords(card);
	const counts = {};
	for (let str of Object.values(content)) {
		//We split the words the same way in stemmedNormalizedWords.
		const words = str.split('-').join(' ').split(' ');
		for (let word of words) {
			const stemmedWord = memorizedStemmer(word);
			if (!counts[stemmedWord]) counts[stemmedWord] = {};
			counts[stemmedWord][word] = (counts[stemmedWord][word] || 0) + 1;
		}
	}
	//counts is now a map of destemmedWord to word.
	const result = {};
	for (let [destemmedWord, wordCounts] of Object.entries(counts)) {
		let maxCount = 0;
		let maxWord = '';
		for (let [word, count] of Object.entries(wordCounts)) {
			if (count <= maxCount) continue;
			maxCount = count;
			maxWord = word;
		}
		result[destemmedWord] = maxWord;
	}
	return result;
};

//cardSetNormalizedTextProperties sets the properties that search and
//fingerprints work over. It sets them on the same card object sent.
export const cardSetNormalizedTextProperties = (card) => {
	//Basically it takes the output of extractContentWords and then stems them.
	card.normalized = Object.fromEntries(Object.entries(extractContentWords(card)).map(entry => [entry[0], stemmedNormalizedWords(entry[1]).join(' ')]));
};

const memoizedCardAccessors = new Map();

//References returns a ReferencesAccessor to access references for this cardObj.
//It may return one that's already been returned for this card obj.
export const references = (cardObj) => {
	let accessor = memoizedCardAccessors.get(cardObj);
	if (!accessor) {
		accessor = new ReferencesAccessor(cardObj);
		memoizedCardAccessors.set(cardObj, accessor);
	}
	return accessor;
};

const byTypeMapToArray = (byTypeMap) => {
	return Object.fromEntries(Object.entries(byTypeMap).map(entry => [entry[0], [...Object.keys(entry[1])]]));
};

const referencesToByType = (referencesMap) => {
	let result = {};
	if (!referencesMap) referencesMap = {};
	for (const [cardID, referenceBlock] of Object.entries(referencesMap)) {
		for (const [referenceType, str] of Object.entries(referenceBlock)) {
			if (!result[referenceType]) result[referenceType] = {};
			result[referenceType][cardID] = str;
		}
	}
	return result;
};

const byTypeToReferences = (byTypeMap) => {
	const result = {};
	if (!byTypeMap) byTypeMap = {};
	for (let [referenceType, referenceBlock] of Object.entries(byTypeMap)) {
		for (let [cardID, str] of Object.entries(referenceBlock)) {
			if (!result[cardID]) result[cardID] = {};
			result[cardID][referenceType] = str;
		}
	}
	return result;
};

const ReferencesAccessor = class {
	//ReferencesAccessor assumes that, if you do one of the mutating methods,
	//it's legal to modify cardObj, but NOT the previously set reference blocks.
	//(That is, that cardObj is a mutable shallow copy from any state objects).
	//If you modify anything, it will overwrite the references blocks instead of
	//modifying them.
	constructor(cardObj) {
		this._cardObj = cardObj;
		if (!this._cardObj) return;
		this._modified = false;
		this._memoizedByType = null;
		this._memoizedByTypeInbound = null;
		this._memoizedByTypeSubstantive = null;
		this._memoizedByTypeInboundSubstantive = null;
		this._referencesInfo = cardObj[REFERENCES_INFO_CARD_PROPERTY];
		this._referencesInfoInbound = cardObj[REFERENCES_INFO_INBOUND_CARD_PROPERTY];
	}

	linksArray() {
		//NOTE: similar manual logic is duplicated manually in tweets-helper.js
		return [...Object.keys(this.byType[REFERENCE_TYPE_LINK] || {})];
	}

	substantiveArray() {
		return Object.keys(byTypeToReferences(this.byTypeSubstantive));
	}

	infoPanelArray() {
		const nonExcludedReferencesByType = Object.fromEntries(Object.entries(this.byType).filter(entry => !REFERENCE_TYPES[entry[0]].excludeFromInfoPanel));
		return Object.keys(byTypeToReferences(nonExcludedReferencesByType));
	}

	//ALL references as an array. You typically want substantiveArray, which is only the substantive references.
	array() {
		if (!this._referencesInfo) return [];
		return Object.keys(this._referencesInfo);
	}

	inboundLinksArray() {
		return [...Object.keys(this.byTypeInbound[REFERENCE_TYPE_LINK] || {})];
	}

	inboundSubstantiveArray() {
		return Object.keys(byTypeToReferences(this.byTypeInboundSubstantive));
	}

	//ALL inbound references as an array. You typically want inboundSubstantiveArray, which is only the substantive references.
	inboundArray() {
		if (!this._referencesInfoInbound) return [];
		return Object.keys(this._referencesInfoInbound);
	}

	_cloneReferencesInfo() {
		return cloneReferences(this._cardObj[REFERENCES_INFO_CARD_PROPERTY]);
	}

	//ensureReferences ensures that the cardObj we're associated with has valid
	//references. If it doesn, and otherCardObj does, it clones it from there.
	//If otherCardObj doesn't and we don't as well, then we set the trivial
	//empty reerences. Returns itself for convenience in chaining.
	ensureReferences(otherCardObj) {
		if (referencesLegal(this._cardObj)) return this;
		let referencesInfo = {};
		if (referencesLegal(otherCardObj)) {
			referencesInfo = references(otherCardObj)._cloneReferencesInfo();
		}
		this._setReferencesInfo(referencesInfo);
		return this;
	}

	//returns a new map where each key in the top level is the type, and the second level objects are card-id to string value.
	get byType() {
		if (!this._memoizedByType) {
			this._memoizedByType = referencesToByType(this._referencesInfo);
		}
		return this._memoizedByType;
	}

	get byTypeSubstantive() {
		if (!this._memoizedByTypeSubstantive) {
			this._memoizedByTypeSubstantive = Object.fromEntries(Object.entries(this.byType).filter(entry => REFERENCE_TYPES[entry[0]].substantive));
		}
		return this._memoizedByTypeSubstantive;
	}

	//returns a new map where each key in the top level is the type, and the second level objects are card-id to string value.
	get byTypeInbound() {
		if (!this._memoizedByTypeInbound) {
			this._memoizedByTypeInbound = referencesToByType(this._referencesInfoInbound);
		}
		return this._memoizedByTypeInbound;
	}

	get byTypeInboundSubstantive() {
		if (!this._memoizedByTypeInboundSubstantive) {
			this._memoizedByTypeInboundSubstantive = Object.fromEntries(Object.entries(this.byTypeInbound).filter(entry => REFERENCE_TYPES[entry[0]].substantive));
		}
		return this._memoizedByTypeInboundSubstantive;
	}

	//Returns an object where it's link_type => array_of_card_ids
	byTypeArray() {
		//Generally it should be that if it's a method it returns a copy, if it's a getter it returns a shared resource
		return byTypeMapToArray(this.byType);
	}

	//Returns an object where it's link_type => array_of_card_ids
	byTypeInboundArray() {
		return byTypeMapToArray(this.byTypeInbound);
	}

	//We're allowed to modify the card object we're associated with, but NOT its
	//inner refrence properties. If we want to touch them, we have to copy them
	//over from their original values.
	_prepareForModifications() {
		if (this._modified) return;
		this._cardObj[REFERENCES_INFO_CARD_PROPERTY] = cloneReferences(this._cardObj[REFERENCES_INFO_CARD_PROPERTY]);
		this._cardObj[REFERENCES_CARD_PROPERTY] = cloneReferences(this._cardObj[REFERENCES_CARD_PROPERTY]);
		this._referencesInfo = this._cardObj[REFERENCES_INFO_CARD_PROPERTY];
		this._modified = true;
	}

	_modificationsFinished() {
		this._cardObj[REFERENCES_CARD_PROPERTY] = Object.fromEntries(Object.entries(this._cardObj[REFERENCES_INFO_CARD_PROPERTY]).map(entry => [entry[0], true]));
		this._memoizedByType = null;
		this._memoizedByTypeInbound = null;
		this._memoizedByTypeSubstantive = null;
		this._memoizedByTypeInboundSubstantive = null;
		if (!referencesLegal(this._cardObj)) {
			throw new Error('References block set to something illegal');
		}
		this._modified = true;
	}

	_setReferencesInfo(referenceBlock) {
		//We set these directly and don't use prepareForModifications because we'll just blow away all of the changes anyway.
		this._cardObj[REFERENCES_INFO_CARD_PROPERTY] = referenceBlock;
		this._referencesInfo = referenceBlock;
		this._modificationsFinished();
	}

	//Consumes a referenceBlock organized by type (e.g. as received by byType)
	_setWithByTypeReferences(byTypeReferenceBlock) {
		this._setReferencesInfo(byTypeToReferences(byTypeReferenceBlock));
	}

	setCardReference(cardID, referenceType, optValue) {
		if (!optValue) optValue = '';
		this._prepareForModifications();
		if (!this._referencesInfo[cardID]) this._referencesInfo[cardID] = {};
		this._referencesInfo[cardID][referenceType] = optValue;
		this._modificationsFinished();
	}

	removeCardReference(cardID, referenceType) {
		if (!this._referencesInfo[cardID]) return;
		//Leaf values might be '', which are falsey but should count as being set
		if (this._referencesInfo[cardID][referenceType] === undefined) return;
		this._prepareForModifications();
		delete this._referencesInfo[cardID][referenceType];
		if (Object.keys(this._referencesInfo[cardID]).length === 0) {
			delete this._referencesInfo[cardID];
		}
		this._modificationsFinished();
	}

	//Sets it so that all references of that type will be set to the values in
	//valueObj. valueObj may be a map of CARD_ID -> str value, or it may be an
	//array of CARD_IDs.
	setCardReferencesOfType(referenceType, valueObj) {
		this._modifyCardReferencesOfType(referenceType,valueObj, true);
	}

	//Like setCardReferencesOfType but doesn't remove existing values
	addCardReferencesOfType(referenceType, valueObj) {
		this._modifyCardReferencesOfType(referenceType,valueObj, false);
	}

	_modifyCardReferencesOfType(referenceType, valueObj, overwrite) {
		const byType = this.byType;
		if (typeof valueObj !== 'object' || !valueObj) {
			throw new Error('valueObj not object or array');
		}
		const mapObj = Array.isArray(valueObj) ? Object.fromEntries(Object.values(valueObj).map(id => [id, ''])) : valueObj;
		//Yes, we're modifying the byType, but will be removed immediately anyway
		byType[referenceType] = overwrite ? {...mapObj} : {...(byType[referenceType] || {}), ...mapObj};
		this._setWithByTypeReferences(byType);
	}

	//linksObj should be a cardID -> str value map. It will replace all
	//currently set references of the current type. A simple wrapper around
	//setCardReferencesOfType with the constant for links burned in
	setLinks(linksObj) {
		this.setCardReferencesOfType(REFERENCE_TYPE_LINK, linksObj);
	}

	equivalentTo(otherCardObj) {
		const diff = referencesCardsDiff(this._cardObj, otherCardObj);
		return diff.every(item => Object.keys(item).length === 0);
	}
};

//referencesLegal is a sanity check that the referencesBlock looks like it's expected to.
//Copied to functions/update.js
export const referencesLegal = (cardObj) => {
	if (!cardObj) return false;
	if (typeof cardObj !== 'object') return false;
	const referencesInfoBlock = cardObj[REFERENCES_INFO_CARD_PROPERTY];
	if (!referencesInfoBlock) return false;
	if (typeof referencesInfoBlock !== 'object') return false;
	if (Array.isArray(referencesInfoBlock)) return false;

	const referencesBlock = cardObj[REFERENCES_CARD_PROPERTY];
	if (!referencesBlock) return false;
	if (typeof referencesBlock !== 'object') return false;
	if (Array.isArray(referencesBlock)) return false;

	//It's OK for it to have no keys.
	if (Object.keys(referencesInfoBlock).length === 0 && Object.keys(referencesBlock).length === 0) return true;

	if (Object.keys(referencesInfoBlock).length !== Object.keys(referencesBlock).length) return false;

	for (let [cardID, cardBlock] of Object.entries(referencesInfoBlock)) {
		if (!cardBlock) return false;
		if (typeof cardBlock !== 'object') return false;
		if (Array.isArray(cardBlock)) return false;
		//If a card block is empty is shouldn't exist
		if (Object.keys(cardBlock).length === 0) return false;
		for (let [key, value] of Object.entries(cardBlock)) {
			//The only types of keys that are allowed are the explicitly defined reference types
			if (!REFERENCE_TYPES[key]) return false;
			if (typeof value !== 'string') return false;
		}
		let referenceValue = referencesBlock[cardID];
		if (typeof referenceValue !== 'boolean') return false;
		//only true is allowed, since it shows that an object exists at that key in references_info
		if (!referenceValue) return false;
	}
	return true;
};

const cloneReferences = (referencesBlock) => {
	let result = {};
	for (let [key, value] of Object.entries(referencesBlock)) {
		if (typeof value === 'object') {
			result[key] = {...value};
		} else {
			//e.g. a boolean
			result[key] = value;
		}
	}
	return result;
};

//Returns a 4-tuple of [additions, modifications, leafDeletions, cardDeletions].
//Each one is a dotted property name. If a given cardDeletion is included, then
//no leafDeletions that start with that CARD_ID will be included. Additions will
//not create new card objects, it will assume the dotted accesor that implies it
//in the path will create it.
export const referencesDiff = (beforeCard, afterCard) => {
	const result = [{}, {}, {}, {}];
	if (!referencesLegal(beforeCard)) return result;
	if (!referencesLegal(afterCard)) return result;
	const before = beforeCard[REFERENCES_INFO_CARD_PROPERTY];
	const after = afterCard[REFERENCES_INFO_CARD_PROPERTY];
	//For cards that were not in before but are in after
	let cardAdditions = {};
	//For card blocks that exist in both before and after... but might have modifications within them
	let cardSame = {};
	//For card blocks that are not in after but were in before.
	let cardDeletions = {};
	for (let cardID of Object.keys(before)) {
		if (after[cardID]) {
			cardSame[cardID] = true;
		} else {
			cardDeletions[cardID] = true;
		}
	}
	for (let cardID of Object.keys(after)) {
		if (!before[cardID]) {
			cardAdditions[cardID] = true;
		}
	}

	for (let cardID of Object.keys(cardAdditions)) {
		//All of the properties in the cardID block are additions.
		for (let [key, value] of Object.entries(after[cardID])) {
			result[0][cardID + '.' + key] = value;
		}
	}

	//NOTE: this logic can assume that if all of the keys for a card were
	//deleted, the cardID block also was, since referencesLegal validates that.

	//Now look at the cardBlocks that exist in both and compare the leaf values
	//to see what changed.
	for (let cardID of Object.keys(cardSame)) {
		let beforeCardBlock = before[cardID];
		let afterCardBlock = after[cardID];

		//Whether keys exist (even if the string value for them is different) in
		//before and after.
		let keyAdditions = {};
		let keySame = {};
		let keyDeletions = {};
		for (let key of Object.keys(beforeCardBlock)) {
			if (afterCardBlock[key] === undefined) {
				keyDeletions[key] = true;
			} else {
				keySame[key] = true;
			}
		}
		for (let key of Object.keys(afterCardBlock)) {
			if (beforeCardBlock[key] === undefined) {
				keyAdditions[key] = true;
			}
		}

		for (let key of Object.keys(keyAdditions)) {
			result[0][cardID + '.' + key] = afterCardBlock[key];
		}

		for (let key of Object.keys(keyDeletions)) {
			result[2][cardID + '.' + key] = true;
		}

		for (let key of Object.keys(keySame)) {
			if (beforeCardBlock[key] === afterCardBlock[key]) continue;
			result[1][cardID + '.' + key] = afterCardBlock[key];
		}
	}

	result[3] = cardDeletions;

	return result;
};

const cardReferenceBlockHasDifference = (before, after) => {
	for(let linkType of Object.keys(before)) {
		if (after[linkType] === undefined) return true;
		if (after[linkType] !== before[linkType]) return true;
	}
	for (let linkType of Object.keys(after)) {
		if (before[linkType] === undefined) return true;
	}
	return false;
};

//Inspired by referencesDiff from card_fields.js Returns
//[cardIDAdditionsOrModifications, cardIDDeletions]. each is a map of cardID =>
//true, and say that you should copy over the whole block.
//Duplicated in functions/update.js
export const referencesCardsDiff = (beforeCard, afterCard) => {
	const result = [{}, {}];
	const emptyCard = {[REFERENCES_INFO_CARD_PROPERTY]:{}, [REFERENCES_CARD_PROPERTY]: {}};
	if (!beforeCard || Object.keys(beforeCard).length === 0) beforeCard = emptyCard;
	if (!afterCard || Object.keys(afterCard).length === 0) afterCard = emptyCard;
	if (!referencesLegal(beforeCard)) return result;
	if (!referencesLegal(afterCard)) return result;
	const before = beforeCard[REFERENCES_INFO_CARD_PROPERTY];
	const after = afterCard[REFERENCES_INFO_CARD_PROPERTY];
	//For card blocks that exist in both before and after... but might have modifications within them
	let cardSame = {};
	for (let cardID of Object.keys(before)) {
		if (after[cardID]) {
			cardSame[cardID] = true;
		} else {
			result[1][cardID] = true;
		}
	}
	for (let cardID of Object.keys(after)) {
		if (!before[cardID]) {
			result[0][cardID] = true;
		}
	}

	//For cards that are bin both before and after, are there any things that changed?
	for (let cardID of Object.keys(cardSame)) {
		if (cardReferenceBlockHasDifference(before[cardID], after[cardID])) result[0][cardID] = true;
	}

	return result;
};

//applyReferencesDiff will generate the modifications necessary to go from
//references_info.before to references_info.after, and accumulate them IN PLACE as keys on
//update, including using deleteSentinel. update should be a cardUpdateObject,
//so the keys this sets will have references_info. This also sets the necessary keys
//on references. prepended. update object is also returned as a
//convenience.
export const applyReferencesDiff = (beforeCard, afterCard, update) => {
	if (!update) update = {};
	let [additions, modifications, leafDeletions, cardDeletions] = referencesDiff(beforeCard,afterCard);
	for (let [key, val] of Object.entries(additions)) {
		let parts = key.split('.');
		let cardID = parts[0];
		update[REFERENCES_INFO_CARD_PROPERTY + '.' + key] = val;
		update[REFERENCES_CARD_PROPERTY + '.' + cardID] = true;
	}
	for (let [key, val] of Object.entries(modifications)) {
		update[REFERENCES_INFO_CARD_PROPERTY + '.' + key] = val;
	}
	for (let key of Object.keys(leafDeletions)) {
		update[REFERENCES_INFO_CARD_PROPERTY + '.' + key] = deleteSentinel();
	}
	for (let key of Object.keys(cardDeletions)) {
		update[REFERENCES_INFO_CARD_PROPERTY + '.' + key] = deleteSentinel();
		update[REFERENCES_CARD_PROPERTY + '.' + key] = deleteSentinel();
	}
	return update;
};
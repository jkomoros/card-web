import snarkdown from 'snarkdown';
import dompurify from 'dompurify';

import {
	CardID,
	Slug,
	CardIdentifier,
	Uid,
	Card,
	ProcessedCard,
	Cards,
	CardType,
	ReferencesInfoMap,
	TweetInfo,
	ReferenceType
} from './types.js';

import {
	LEGAL_INBOUND_REFERENCES_BY_CARD_TYPE,
	REFERENCE_TYPES_THAT_BACKPORT_MISSING_TEXT,
	CARD_TYPE_CONFIGURATION,
	BODY_CARD_TYPES,
	LEGAL_OUTBOUND_REFERENCES_BY_CARD_TYPE,
	IMAGE_CARD_TYPES,
	getCardTitleForBackporting
} from './card_fields.js';

import {
	TEXT_FIELD_BODY,
	CARD_TYPE_CONTENT,
} from './type_constants.js';

import {
	references
} from './references.js';

import {
	getDocument
} from './document.js';

import {
	getImagesFromCard
} from './images.js';

import {
	Timestamp
} from 'firebase/firestore';

import {
	TEXT_FIELD_TYPES_EDITABLE
} from './type_constants.js';

import {
	DERIVED_FIELDS_FOR_CARD_TYPE
} from './card_fields.js';

import {
	TypedObject
} from './typed_object.js';

import {
	normalizeLineBreaks,
} from './contenteditable.js';

//define this here and then re-export form app.js so this file doesn't need any
//other imports.
export const _PAGE_BASIC_CARD = 'basic-card';

export const allSubstrings = (str : string) => {
	const result = [];

	for (let i = 0; i < str.length; i++) {
		for (let j = i + 1; j < str.length + 1; j++) {
			result.push(str.slice(i, j));
		}
	}
	return result;
};

export const hash = (str : string) => {
	//Adapted from https://stackoverflow.com/questions/7616461/generate-a-hash-from-string-in-javascript
	let hash = 0, i, chr;
	for (i = 0; i < str.length; i++) {
		chr   = str.charCodeAt(i);
		hash  = ((hash << 5) - hash) + chr;
		hash |= 0; // Convert to 32bit integer
	}
	return hash;
};

const randomCharSetNumbers = '0123456789';
const randomCharSetLetters = 'abcdef';
const randomCharSet = randomCharSetNumbers + randomCharSetLetters;

export const randomString = (length : number, charSet = randomCharSet) => {
	let text = '';
	for (let i = 0; i < length; i++) {
		text += charSet.charAt(Math.floor(Math.random() * charSet.length));
	}
	return text;
};

//TODO: consider renaming this, because we also use it in selectFullDataNeeded.
export const pageRequiresMainView = (pageName : string) => {
	return pageName != _PAGE_BASIC_CARD;
};

export const deepActiveElement = () : Element | null => {
	//Based on code snippet at https://developers.google.com/web/fundamentals/web-components/shadowdom
	const doc = getDocument();
	if (!doc) return null;
	let a = doc.activeElement;
	while (a && a.shadowRoot && a.shadowRoot.activeElement) {
		a = a.shadowRoot.activeElement;
	}
	return a;
};

export const capitalizeFirstLetter = (str : string) => {
	return str.charAt(0).toUpperCase() + str.slice(1);
};

export const toTitleCase = (str : string) => {
	//Based on https://gomakethings.com/converting-a-string-to-title-case-with-vanilla-javascript/
	const parts = str.toLowerCase().split(' ');
	for (let i = 0; i < parts.length; i++) {
		parts[i] = parts[i].charAt(0).toUpperCase() + parts[i].slice(1);
	}
	return parts.join(' ');
};

//note: these are recreated in functions/legal.js

const slugIllegalPartExpression = /[^a-zA-Z0-9-_ ]/g;
const slugRegularExpression = /^[a-zA-Z0-9-_]+$/;

//returns if the given uid looks like it could be legal
export const legalUid = (uid : Uid) => {
	if (!slugRegularExpression.test(uid)) return false;
	if (uid.length < 10) return false;
	return true;
};

//normalizes a mostly-OK slug, returning '' if it wasn't legal. If you want to
//generate a good one given an arbitrary string that may contain illegal
//characters to strip, see createSlugFromArbitraryString
export const normalizeSlug = (slug : Slug) : Slug => {
	slug = slug.trim();
	slug = slug.toLowerCase();
	slug = slug.split(' ').join('-');
	slug = slug.split('_').join('-');

	if (!slugRegularExpression.test(slug)) slug = '';

	return slug;
};

export const createSlugFromArbitraryString = (str : string) : Slug => {
	str = str.replace(slugIllegalPartExpression, '');
	return normalizeSlug(str);
};

const vendedNewIDs : {[name: CardID]: boolean} = {};

//returns true if the given ID was recently vended in this client from newID.
export const idWasVended = (id : CardID) => {
	return vendedNewIDs[id] || false;
};

export const newID = () : CardID => {
	const result = normalizeSlug('c_' + randomString(3, randomCharSetNumbers) + '_' + randomString(3, randomCharSetLetters) + randomString(3, randomCharSetNumbers));
	vendedNewIDs[result] = true;
	return result;
};

export const urlForTweet = (tweet : TweetInfo) => {
	return 'https://twitter.com/' + tweet.user_screen_name + '/status/' + tweet.id;
};

export const cardHasContent = (card : Card) => {
	if (!card) return false;
	//We treat all non-body-card cards as having content, since the main reason
	//to count a card has not having content is if there's nothing to see on it.
	if (!BODY_CARD_TYPES[card.card_type]) return true;
	const cardTypeConfig = CARD_TYPE_CONFIGURATION[card.card_type];
	//If it just uses the default content for that card type then it's as though
	//it doesn't have content at all.
	if (cardTypeConfig && cardTypeConfig.defaultBody == card[TEXT_FIELD_BODY]) return false;
	const content = card[TEXT_FIELD_BODY] ? card[TEXT_FIELD_BODY].trim() : '';
	return content ? true : false;
};

const SUBSTANTIVE_CONTENT_THRESHOLD = 300;
export const cardHasSubstantiveContent = (card : ProcessedCard) => {
	if (!card) return false;
	//We treat all non-content cards as having content, since the main reason to
	//count a card has not having content is if there's nothing to see on it.
	if (card.card_type != CARD_TYPE_CONTENT) return true;
	const content = card.nlp && card.nlp[TEXT_FIELD_BODY] ? card.nlp[TEXT_FIELD_BODY].map(run => run.stemmed).join(' ') : '';
	return content.length > SUBSTANTIVE_CONTENT_THRESHOLD;
};

export const cardHasNotes = (card : Card) => {
	if (!card) return false;
	const content = card.notes ? card.notes.trim() : '';
	return content ? true : false;
};

export const cardHasTodo = (card : Card) => {
	if (!card) return false;
	const content = card.todo ? card.todo.trim() : '';
	return content ? true : false;
};

export const innerTextForHTML = (body : string) : string => {
	//This shouldn't be an XSS vulnerability even though body is supplied by
	//users and thus untrusted, because the temporary element is never actually
	//appended into the DOM
	const ele = getDocument().createElement('section');
	// makes sure line breaks are in the right place after each legal block level element
	body = normalizeLineBreaks(body);
	ele.innerHTML = body;
	//textContent would return things like style and script contents, but those shouldn't be included anyway.
	return ele.textContent;
};

export const cardPlainContent = (card : Card) : string => {
	const cardType = card.card_type;
	if (!BODY_CARD_TYPES[cardType]) return '';
	const result : string[] = [];
	for (const field of TypedObject.keys(TEXT_FIELD_TYPES_EDITABLE)) {
		//Skip derived fields
		if (DERIVED_FIELDS_FOR_CARD_TYPE[cardType][field]) continue;
		result.push(card[field]);
	}
	return result.join('\n');
};

//Returns a string with the reason that the proposed card type is not legal for
//this card. If the string is '' then it is legal.
export const reasonCardTypeNotLegalForCard = (card : Card, proposedCardType : CardType) => {
	const legalInboundReferenceTypes = LEGAL_INBOUND_REFERENCES_BY_CARD_TYPE[proposedCardType];
	if (!legalInboundReferenceTypes) return '' + proposedCardType + ' is not a legal card type';
	const legalOutboundRefrenceTypes = LEGAL_OUTBOUND_REFERENCES_BY_CARD_TYPE[proposedCardType];

	//Because this is INBOUND references, the changes we might be making to
	//the card won't have touched it.
	const inboundReferencesByType = references(card).byTypeInbound;
	for (const referenceType of Object.keys(inboundReferencesByType)) {
		if (!legalInboundReferenceTypes[referenceType]) {
			return 'The card has an inbound reference of type ' + referenceType + ', but that is not legal for the proposed card type ' + proposedCardType;
		}
	}

	const outboundReferencesByType = references(card).byType;
	for (const referenceType of Object.keys(outboundReferencesByType)) {
		if (!legalOutboundRefrenceTypes[referenceType]) {
			return 'The card has an outbound reference of type ' + referenceType + ', but that is not legal for the proposed card type ' + proposedCardType;
		}
	}

	if (getImagesFromCard(card).length > 0 && !IMAGE_CARD_TYPES[proposedCardType]) return 'The card has images but the new card type does not allow images';

	return '';
};

//returns a fallbackMap, appropriate to be passed to
//references.withFallbackText, for card, where any of the references it has that
//opt into backporting via backportMissingText that don't have text will fetch
//it from the title of the card they point to. Cards that don't have any
//references that need backporting will return null.
export const backportFallbackTextMapForCard = (card : Card, cards : Cards) : ReferencesInfoMap => {
	//TODO: anotehr approach is to iterate through byTypeInbound, and contribute
	//to one, shared, global fallbackMap. That would create fewer objects, but
	//it would mean that every time the fallbackMap changed, every card would
	//have to have its text renormalized, even though it likely didn't need it,
	//whereas this creates a targeted list of fallbacks per card, where most of
	//them are null.
	const result : ReferencesInfoMap = {};
	const refsByType = references(card).byType;
	for (const referenceType of Object.keys(REFERENCE_TYPES_THAT_BACKPORT_MISSING_TEXT) as ReferenceType[]) {
		const refs = refsByType[referenceType];
		if (!refs) continue;
		for (const [cardID, str] of Object.entries(refs) as [CardID, string][]) {
			if (str) continue;
			const otherCard = cards[cardID];
			if (!otherCard) continue;
			//OK, we're going to add it
			if (!result[cardID]) result[cardID] = {};
			result[cardID][referenceType] = getCardTitleForBackporting(otherCard, referenceType, cards);
		}
	}
	if (Object.keys(result).length == 0) return null;
	return result;
};

//Takes a string (single id/slug) or an array of strings of id/slugs, and
//returns an array where every item is a normalized id.
export const normalizeCardSlugOrIDList = (slugOrIDList : CardIdentifier | CardIdentifier[], cards : Cards) => {
	if (!Array.isArray(slugOrIDList)) slugOrIDList = [slugOrIDList];
	const missingCardIDs : {[name : CardIdentifier] : Slug} = {};
	for (const idOrSlug of slugOrIDList) {
		if (cards[idOrSlug]) continue;
		missingCardIDs[idOrSlug] = idOrSlug;
	}
	if (Object.keys(missingCardIDs).length) {
		//These are the slugs we have to figure out what their IDs are
		for (const card of Object.values(cards)) {
			for (const slug of card.slugs || []) {
				if (missingCardIDs[slug]) {
					missingCardIDs[slug] = card.id;
				}
			}
		}
		//convert the list to ids, and remove any items that ended up not being found as valid ids
		slugOrIDList = slugOrIDList.map(idOrSlug => missingCardIDs[idOrSlug] || idOrSlug).filter(id => cards[id]);
	}
	return slugOrIDList;
};

//cardBFS returns a map of cardID -> degrees of separation from the key card
//(which is eitehr a string, or an array of ids-or-slugs-of start cards). Note
//that if the keyCard is included, it will map that keyID -> 0, which is falsey,
//so when checking for existence, you should check whether it's undefined or
//not. if optReferenceType is falsey, it will use all substantive references.
//Otherwise, it will filter to only references of the given type, if it's a
//string, or any reference types listed if it's an array.
export const cardBFS = (keyCardIDOrSlugList : CardID | Slug[], cards : Cards, ply : number, includeKeyCard : boolean, isInbound : boolean, optReferenceTypes? : ReferenceType | ReferenceType[]) => {

	keyCardIDOrSlugList = normalizeCardSlugOrIDList(keyCardIDOrSlugList, cards);

	const seenCards : {[id : CardID]: number} = {};
	const cardsToProcess : CardID[] = [];

	for (const id of keyCardIDOrSlugList) {
		seenCards[id] = 0;
		cardsToProcess.push(id);
	}

	//if optReferenceTypes is provided, make sure it's an array
	if (optReferenceTypes && !Array.isArray(optReferenceTypes)) optReferenceTypes = [optReferenceTypes];

	while (cardsToProcess.length) {
		const id = cardsToProcess.shift();
		if (!id) continue;
		const card = cards[id];
		//Must be unpublished
		if (!card) continue;
		const newCardDepth = (seenCards[id] || 0) + 1;
		if (newCardDepth > ply) continue;
		let links : CardID[] = [];
		if (optReferenceTypes) {
			for (const referenceType of optReferenceTypes as ReferenceType[]) {
				//Some of these will be dupes and that's OK because we skip items that are already seen
				links = links.concat((isInbound ? references(card).byTypeInboundArray()[referenceType] : references(card).byTypeArray()[referenceType]) || []);
			}
		} else {
			links = isInbound ? references(card).inboundSubstantiveArray() : references(card).substantiveArray();
		}
		for (const linkItem of links) {
			//Skip ones that have already been seen
			if (seenCards[linkItem] !== undefined) continue;
			seenCards[linkItem] = newCardDepth;
			cardsToProcess.push(linkItem);
		}
	}
	if (!includeKeyCard) {
		for (const id of keyCardIDOrSlugList) {
			delete seenCards[id];
		}
	}
	return seenCards;
};

//cardMissingReciprocalLinks returns the links that point to a card that are not
//reciprocated and not explicitly listed as OK to skip.
export const cardMissingReciprocalLinks = (card : Card) => {
	if (!card) return [];
	const links = new Map();
	const refs = references(card);
	for (const link of refs.inboundNeedsReciprocationArray()) {
		links.set(link, true);
	}
	for (const link of refs.array()) {
		links.delete(link);
	}
	return [...links.keys()];
};

//other can be a card ID or a card
export const cardNeedsReciprocalLinkTo = (card : Card, other: CardID | Card) => {
	if (typeof other == 'object') other = other.id;
	if (!card || !other) return false;
	const missingReciprocalLinks = cardMissingReciprocalLinks(card);
	for (const link of missingReciprocalLinks) {
		if (link == other) return true;
	}
	return false;
};

const MULTIPLE_LINK_TEXT_DELIMITER = '\n';

export const extractCardLinksFromBody = (body : string) : {[name : CardID] : string} => {
	const document = getDocument();
	if (!document) return {};
	const ele = document.createElement('section');
	//This is not an XSS vulnerability because we never append ele into the
	//actual dom.
	ele.innerHTML = body;
	const result : {[name : CardID]: string} = {};
	const nodes = ele.querySelectorAll('card-link[card]');
	nodes.forEach(link => {
		const attribute = link.getAttribute('card');
		if (!attribute) return;
		const id : CardID = attribute;
		const linkAsHTMLElement = link as HTMLElement;
		if (result[id]) {
			result[id] = result[id] + MULTIPLE_LINK_TEXT_DELIMITER + linkAsHTMLElement.innerText;
		} else {
			result[id] = linkAsHTMLElement.innerText;
		}
	});
	return result;
};

export function arrayRemoveUtil<T>(arr : T[], items : T[]) : T[] {
	if (!items) {
		console.warn('arrayRemoveUtil called without a second argument, which means you probably wanted arrayRemoveSentinel');
	}
	const itemsToRemove = new Map();
	for (const item of Object.values(items)) {
		itemsToRemove.set(item, true);
	}
	const result : T[] = [];
	for (const val of Object.values(arr)) {
		if (itemsToRemove.has(val)) continue;
		result.push(val);
	}
	return result;
}

export function arrayUnionUtil<T>(arr : T[], items : T[]) : T[]{
	if (!items) {
		console.warn('arrayUnionUtil called without a second argument, which means you probably wanted arrayUnionSentinel');
	}
	const result = [];
	const seenItems = new Map();
	for (const val of Object.values(arr)) {
		seenItems.set(val, true);
		result.push(val);
	}
	for (const val of Object.values(items)) {
		if (seenItems.has(val)) continue;
		result.push(val);
	}	
	return result;
}

export function arrayUnique<T>(arr : T[]) : T[] {
	const seenItems = new Map();
	const result = [];
	for (const item of arr) {
		if (seenItems.has(item)) continue;
		result.push(item);
		seenItems.set(item, true);
	}
	return result;
}

export const arrayToSet = (arr : string[]) : {[name : string]: true} => {
	const result : {[name : string] : true} = {};
	for (const item of arr) {
		result[item] = true;
	}
	return result;
};

export const arrayDiffAsSets = (before : string[] = [], after : string[] = []) : [{[name : string] : true}, {[name : string] : true}] => {
	const [additions, deletions] = arrayDiff(before,after);
	return [arrayToSet(additions), arrayToSet(deletions)];
};

export function arrayDiff<T>(before : T[] = [], after : T[] = []) : [T[], T[]] {
	if (!before) before = [];
	if (!after) after = [];
	const afterMap = new Map();
	for (const item of after) {
		afterMap.set(item, true);
	}
	const deletions = [];
	for (const item of before) {
		if (afterMap.has(item)) {
			//Keep track of that we've seen this one
			afterMap.delete(item);
		} else {
			deletions.push(item);
		}
	}
	//Additions is the keys not remved in afterMap
	const additions = [...afterMap.keys()];
	return [additions, deletions];
}

type TriStateMap = {
	[name : string]: boolean
}

//triStateMapDiff operates on objects that have keys that are either true or
//false. It returns keys to explicit set to true, keys to explicitly set to
//false, and keys to remove.
export const triStateMapDiff = (before : TriStateMap, after : TriStateMap) : [string[], string[], string[]] => {
	if (!before) before = {};
	if (!after) after = {};
	//Generat the list of removals by looking for keys that do not exist in
	//after but are in before.
	const removals = [];
	for (const beforeKey of Object.keys(before)) {
		if (after[beforeKey] === undefined) {
			removals.push(beforeKey);
		}
	}

	const enabled = [];
	const disabled = [];
	for (const afterKey of Object.keys(after)) {
		//If before has the after key undefined or false it doesn't matter; in
		//either case it requires an explicit set.
		if(before[afterKey] != after[afterKey]) {
			if (after[afterKey]) {
				enabled.push(afterKey);
			} else {
				disabled.push(afterKey);
			}
		}
	}

	return [enabled, disabled, removals];
};

/*
//Uncomment this block to test tri state.
function testTriStateMapDiff() {
	//TODO: do this in a proper testing framework
	const tests = [
		[
			'No op',
			{a: true, b: false},
			{a: true, b: false},
			[[],[],[]]
		],
		[
			'add c enabled',
			{a: true, b: false},
			{a: true, b: false, c: true},
			[['c'],[],[]],
		],
		[
			'add c disabled',
			{a: true, b: false},
			{a: true, b: false, c: false},
			[[],['c'],[]],
		],
		[
			'remove a',
			{a: true, b: false},
			{b: false},
			[[],[],['a']]
		],
		[
			'disable a',
			{a: true, b: false},
			{a: false, b: false},
			[[],['a'],[]]
		],
		[
			'remove a add c',
			{a: true, b: false},
			{b: false, c: false},
			[[],['c'],['a']]
		],
	];
	for (let test of tests) {
		const description = test[0];
		let [enabled, disabled, deleted] = triStateMapDiff(test[1], test[2]);
		let [goldenEnabled, goldenDisabled, goldenDeleted] = test[3];

		let [enabledAdditions, enabledDeletions] = arrayDiff(goldenEnabled, enabled);
		if (enabledAdditions.length != 0 || enabledDeletions.length != 0) console.warn(description + ' failed enabled didn\'t match: ' + enabled.toString());

		let [disabledAdditions, disabledDeletions] = arrayDiff(goldenDisabled, disabled);
		if (disabledAdditions.length != 0 || disabledDeletions.length != 0) console.warn(description + ' failed disabled didn\'t match: ' + disabled.toString());

		let [deletedAdditions, deletedDeletions] = arrayDiff(goldenDeleted, deleted);
		if (deletedAdditions.length != 0 || deletedDeletions.length != 0) console.warn(description + ' failed deletions didn\'t match: ' + deleted.toString());
	}
	console.log('Tristate tests passed');
}
testTriStateMapDiff();
*/

//items is an array
export function setRemove(obj : {[name : string] : true}, items : string[]) : {[name : string] : true} {
	const result : {[name : string] : true } = {...obj};
	for (const item of items) {
		delete result[item];
	}
	return result;
}

//items is an array
export function setUnion(obj : {[name : string] : true}, items : string[]) : {[name : string] : true} {
	const result : {[name : string]: true } = {...obj};
	for (const item of items) {
		result[item] = true;
	}
	return result;
}

//This logic is finicky and we have a few defaults we want to have, so wrap it
//in a util.
export const makeElementContentEditable = (ele : HTMLElement) => {
	ele.contentEditable = 'true';
	//It's OK if we have already done these commands to do them again

	const document = getDocument();

	if (!document) return;

	//styleWithCSS turns off styling spans with CSS and just uses presentational
	//attributes. 
	document.execCommand('styleWithCSS', false, 'false');
	//Browsers currently insert a "<div>" as default paragraph separator but we
	//want 'p'; 
	document.execCommand('defaultParagraphSeparator', false, 'p');
};

//Returns a safe markdown element that can be emitted in a lit-html template.
export const markdownElement = (content : string) : HTMLElement | null => {
	const document = getDocument();
	if (!document) return null;
	const div = document.createElement('div');
	const html = snarkdown(content);
	const sanitizedHTML = dompurify.sanitize(html);
	div.innerHTML = sanitizedHTML;
	return div;
};

export const downloadFile = (content : Blob, filename : string) => {
	//Based on https://stackoverflow.com/a/24922761
	const link = document.createElement('a');
	const url = URL.createObjectURL(content);
	link.setAttribute('href', url);
	link.setAttribute('download', filename);
	link.style.visibility = 'hidden';
	document.body.appendChild(link);
	link.click();
	document.body.removeChild(link);
};

export const timestampForFilename = () : string => {
	const timestamp = new Date();
	const timeString = new Intl.DateTimeFormat('en-US', {hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false}).format(timestamp);
	return '' + timestamp.getFullYear() + '-' + (timestamp.getMonth() + 1) + '-' + timestamp.getDate() + '-' + timeString.split(':').join('-');
};

//date may be a firestore timestamp or a date object.
export const prettyTime = (date : Timestamp | Date) => {
	if (!date) return '';
	const dateDate : Date = typeof (date as Timestamp).toDate == 'function' ? (date as Timestamp).toDate() : date as Date;
	return dateDate.toDateString();
};

export const killEvent = (e : Event) : void => {
	if (e) {
		e.preventDefault();
	}
};

export const isWhitespace = (s : string) => {
	return /^\s*$/.test(s);
};

//Items in the reads and stars collections are stored at a canonical id given
//a uid and card id.
export const idForPersonalCardInfo = (uid : Uid, cardId : CardID) => {
	return '' + uid + '+' + cardId;
};

let memoizedPageRank : {[id : CardID]: number} | null = null;
let memoizedPageRankInput : Cards | null = null;

type NodeInfo = {
	id: CardID,
	rank: number,
	previousRank: number,
	outDegree: number,
	inDegree: number,
	inboundLinks: CardID[]
}

//return a map of id to rank for each card.
export const pageRank = (cards : Cards) => {

	if (memoizedPageRankInput === cards) {
		return memoizedPageRank;
	}

	const targetEpsilon = 0.005;
	const jumpProbability = 0.85;
	//since it's not guaranteed to converge, will bail out at this number of
	//iterations.
	const maxIterations = 50;

	const nodes : {[id: CardID]: NodeInfo} = {};
	const inboundLinksMap : {[id : CardID]: CardID[]} = {};
	const numNodes = Object.keys(cards).length;
	const initialRank = 1 / numNodes;

	for (const card of Object.values(cards)) {
		//We can't trust links or inbound_links as they exist, because they
		//might point to unpublished cards, and it's important for the
		//convergence of the algorithm that we have the proper indegree and outdegree. 
		const links = arrayUnique(references(card).substantiveArray().filter((id : CardID) => cards[id]));
		for (const id of links) {
			let list = inboundLinksMap[id];
			if (!list) {
				list = [];
				inboundLinksMap[id] = list;
			}
			list.push(card.id);
		}
		nodes[card.id] = {
			id: card.id,
			rank: initialRank,
			previousRank: initialRank,
			outDegree: links.length,
			//we'll have to updated boht of these in a second pass
			inDegree: 0,
			inboundLinks: [],
		};
	}

	//inboundLinks is now set, so we can set the inDegree.
	for (const id of Object.keys(nodes)) {
		const inboundLinks = inboundLinksMap[id] || [];
		nodes[id].inDegree = inboundLinks.length;
		nodes[id].inboundLinks = inboundLinks;
	}

	//how much the overall graph changed from last time
	let updateDistance = 0;
	let numIterations = 0;

	do {
		numIterations++;
		let totalDistributedRank = 0;
		for (const node of Object.values(nodes)) {
			if (node.inDegree === 0) {
				node.rank = 0.0;
			} else {
				let currentRank = 0.0;
				for (const linkID of node.inboundLinks) {
					const otherNode = nodes[linkID];
					if (!otherNode) continue;
					currentRank += nodes[linkID].previousRank / nodes[linkID].outDegree;
				}
				node.rank = currentRank * jumpProbability;
				totalDistributedRank += node.rank;
			}
		}
		const leakedRankPerNode = (1 - totalDistributedRank) / numNodes;
		updateDistance = 0;
		for (const node of Object.values(nodes)) {
			const currentRank = node.rank + leakedRankPerNode;
			updateDistance += Math.abs(currentRank - node.previousRank);
			node.previousRank = currentRank;
		}
	} while(numIterations < maxIterations && updateDistance > targetEpsilon);

	const result =  Object.fromEntries(Object.entries(nodes).map(entry => [entry[0], entry[1].previousRank]));
	memoizedPageRankInput = cards;
	memoizedPageRank = result;
	return result;
};

const LOG_DEEP_EQUAL_DIFFERENCES = false;

//Tests for deep eqaulity of a and b. note: not yet tested for anythong other
//than objects, arrays, strings, numbers, bools.∑ If a and b are too non-equal
//objecst, and objectChecker is provided, then if both return true from
//objectChecker then deepEqual will short-circuit and return true.
export const deepEqual = (a : unknown, b : unknown, objectChecker : ((object: unknown) => boolean) | null = null) => {
	if (a === b) return true;
	if (!a || !b) return false;
	if (typeof a != 'object' || typeof b != 'object') return false;
	if (Array.isArray(a)) {
		if (!Array.isArray(b)) return false;
		if (a.length != b.length) return false;
		for (const [i, val] of a.entries()) {
			if (!deepEqual(b[i], val, objectChecker)) return false;
		}
		return true;
	}
	if (objectChecker && objectChecker(a) && objectChecker(b)) return true;
	//Two objects
	if (Object.keys(a).length != Object.keys(b).length) {
		if (LOG_DEEP_EQUAL_DIFFERENCES) {
			const aKeys = new Set(Object.keys(a));
			const bKeys = new Set(Object.keys(b));
			if (aKeys.size > bKeys.size) {
				const difference = [...aKeys].filter(x => !bKeys.has(x));
				console.log('a has keys ', difference, 'that b lacks', a, b);
			} else {
				const difference = [...bKeys].filter(x => !aKeys.has(x));
				console.log('b has keys ', difference, 'that a lacks', a, b);
			}
		}
		return false;
	}
	const stringKeyedB = b as {[key : string] : unknown};
	for (const [key, val] of Object.entries(a)) {
		if (!deepEqual(val, stringKeyedB[key], objectChecker)) {
			if (LOG_DEEP_EQUAL_DIFFERENCES) {
				console.log('Key', key, ' is different in a and b: ', val, stringKeyedB[key], a, b);
			}
			return false;
		}
	}
	return true;
};

//Modifies the object (and sub-objects) passed. For ['a', 'b'], would set {a:
//{b: VALUE}}. It implies intermediate keys into existence as objects, and
//errors if those keys already exist and are not objects.
//Similar to card_diff.ts:estFirebaseValueOnObj but with different semantics.
export const setValueOnObj = (obj : {[field : string]: unknown}, fieldParts : string[], value : unknown) : void => {
	//Obj is an object it's OK to modify
	const firstFieldPart = fieldParts[0];
	//Modifies obj in place.
	if (fieldParts.length == 1) {
		//Base case, operate in place.
		obj[firstFieldPart] = value;
		return;
	}
	if (obj[firstFieldPart] !== undefined) {
		//If the property exists, make sure it's an object, and not null and not
		//an array (arrays would get string values set which would be confusing)
		if (typeof obj[firstFieldPart] != 'object' || obj[firstFieldPart] == null || Array.isArray(obj[firstFieldPart])) throw new Error('Existing field is not a sub object');
	}
	if (!obj[firstFieldPart]) obj[firstFieldPart] = {};
	const subObject = obj[firstFieldPart] as {[field : string] : unknown};
	setValueOnObj(subObject, fieldParts.slice(1), value);
};

//For {a: {b: 2}, c: 3}, a path of ['a', 'b'] would return 2.
export const getObjectPath = (obj : unknown, path : string[]) : unknown => {
	if (!path) return undefined;
	if (!Array.isArray(path)) return undefined;
	if (path.length == 0) return obj;
	if (!obj) return undefined;
	if (typeof obj !== 'object') return undefined;
	const stringKeyedObj = obj as {[field : string] : unknown};
	const modifiedPath = [...path];
	const firstPart = modifiedPath.shift();
	const subObject = firstPart === undefined ? undefined : stringKeyedObj[firstPart];
	return getObjectPath(subObject, modifiedPath);
};

//Returns a path within the given object to find an occurance of sentinel value.
export const objectPathToValue = (obj : unknown, sentinel : unknown) : string[] => {
	if (!obj) return undefined;
	if (typeof obj !== 'object') return undefined;
	for (const [key, value] of Object.entries(obj)) {
		if (value == sentinel) return [key];
		if (typeof value !== 'object') continue;
		const partialPath = objectPathToValue(value, sentinel);
		if (!partialPath) continue;
		return [key, ...partialPath];
	}
	return undefined;
};
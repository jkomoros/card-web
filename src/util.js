import snarkdown from 'snarkdown';
import dompurify from 'dompurify';

import {
	TEXT_FIELD_BODY,
	CARD_TYPE_CONTENT,
	LEGAL_INBOUND_REFERENCES_BY_CARD_TYPE,
	REFERENCE_TYPES_THAT_BACKPORT_MISSING_TEXT,
} from './card_fields.js';

import {
	references
} from './references.js';

import {
	getDocument
} from './document.js';

//define this here and then re-export form app.js so this file doesn't need any
//other imports.
export const _PAGE_BASIC_CARD = 'basic-card';

export const allSubstrings = (str) => {
	let result = [];

	for (let i = 0; i < str.length; i++) {
		for (let j = i + 1; j < str.length + 1; j++) {
			result.push(str.slice(i, j));
		}
	}
	return result;
};

export const hash = (str) => {
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

export const randomString = (length, charSet) => {
	if (!charSet) {
		charSet = randomCharSet;
	}
	let text = '';
	for (let i = 0; i < length; i++) {
		text += charSet.charAt(Math.floor(Math.random() * charSet.length));
	}
	return text;
};

//TODO: consider renaming this, because we also use it in selectFullDataNeeded.
export const pageRequiresMainView = (pageName) => {
	return pageName != _PAGE_BASIC_CARD;
};

export const capitalizeFirstLetter = (str) => {
	return str.charAt(0).toUpperCase() + str.slice(1);
};

export const toTitleCase = (str) => {
	//Based on https://gomakethings.com/converting-a-string-to-title-case-with-vanilla-javascript/
	str = str.toLowerCase().split(' ');
	for (var i = 0; i < str.length; i++) {
		str[i] = str[i].charAt(0).toUpperCase() + str[i].slice(1);
	}
	return str.join(' ');
};

//note: these are recreated in functions/legal.js

const slugIllegalPartExpression = /[^a-zA-Z0-9-_ ]/g;
const slugRegularExpression = /^[a-zA-Z0-9-_]+$/;

//returns if the given uid looks like it could be legal
export const legalUid = (uid) => {
	if (!slugRegularExpression.test(uid)) return false;
	if (uid.length < 10) return false;
	return true;
};

//normalizes a mostly-OK slug, returning '' if it wasn't legal. If you want to
//generate a good one given an arbitrary string that may contain illegal
//characters to strip, see createSlugFromArbitraryString
export const normalizeSlug = (slug) => {
	slug = slug.trim();
	slug = slug.toLowerCase();
	slug = slug.split(' ').join('-');
	slug = slug.split('_').join('-');

	if (!slugRegularExpression.test(slug)) slug = '';

	return slug;
};

export const createSlugFromArbitraryString = (str) => {
	str = str.replace(slugIllegalPartExpression, '');
	return normalizeSlug(str);
};

let vendedNewIDs = {};

//returns true if the given ID was recently vended in this client from newID.
export const idWasVended = (id) => {
	return vendedNewIDs[id] || false;
};

export const newID = () => {
	const result = normalizeSlug('c_' + randomString(3, randomCharSetNumbers) + '_' + randomString(3, randomCharSetLetters) + randomString(3, randomCharSetNumbers));
	vendedNewIDs[result] = true;
	return result;
};

export const urlForTweet = (tweet) => {
	return 'https://twitter.com/' + tweet.user_screen_name + '/status/' + tweet.id;
};

export const cardHasContent = (card) => {
	if (!card) return false;
	//We treat all non-content cards as having content, since the main reason to
	//count a card has not having content is if there's nothing to see on it.
	if (card.card_type != CARD_TYPE_CONTENT) return true;
	let content = card[TEXT_FIELD_BODY] ? card[TEXT_FIELD_BODY].trim() : '';
	return content ? true : false;
};

const SUBSTANTIVE_CONTENT_THRESHOLD = 300;
export const cardHasSubstantiveContent = (card) => {
	if (!card) return false;
	//We treat all non-content cards as having content, since the main reason to
	//count a card has not having content is if there's nothing to see on it.
	if (card.card_type != CARD_TYPE_CONTENT) return true;
	let content = card.normalized && card.normalized.body ? card.normalized.body.join(' ') : '';
	return content.length > SUBSTANTIVE_CONTENT_THRESHOLD;
};

export const cardHasNotes = (card) => {
	if (!card) return false;
	let content = card.notes ? card.notes.trim() : '';
	return content ? true : false;
};

export const cardHasTodo = (card) => {
	if (!card) return false;
	let content = card.todo ? card.todo.trim() : '';
	return content ? true : false;
};

//Returns a string with the reason that the proposed card type is not legal for
//this card. If the string is '' then it is legal.
export const reasonCardTypeNotLegalForCard = (card, proposedCardType) => {
	const legalInboundReferenceTypes = LEGAL_INBOUND_REFERENCES_BY_CARD_TYPE[proposedCardType];
	if (!legalInboundReferenceTypes) return '' + proposedCardType + ' is not a legal card type';

	//Because this is INBOUND references, the changes we might be making to
	//the card won't have touched it.
	const inboundReferencesByType = references(card).byTypeInbound;
	for (let referenceType of Object.keys(inboundReferencesByType)) {
		if (!legalInboundReferenceTypes[referenceType]) {
			return 'The card has an inbound reference of type ' + referenceType + ', but that is not legal for the proposed card type ' + proposedCardType;
		}
	}

	return '';
};

//returns a fallbackMap, appropriate to be passed to
//references.withFallbackText, for card, where any of the references it has that
//opt into backporting via backportMissingText that don't have text will fetch
//it from the title of the card they point to. Cards that don't have any
//references that need backporting will return null.
export const backportFallbackTextMapForCard = (card, cards) => {
	//TODO: anotehr approach is to iterate through byTypeInbound, and contribute
	//to one, shared, global fallbackMap. That would create fewer objects, but
	//it would mean that every time the fallbackMap changed, every card would
	//have to have its text renormalized, even though it likely didn't need it,
	//whereas this creates a targeted list of fallbacks per card, where most of
	//them are null.
	const result = {};
	const refsByType = references(card).byType;
	for (let referenceType of Object.keys(REFERENCE_TYPES_THAT_BACKPORT_MISSING_TEXT)) {
		const refs = refsByType[referenceType];
		if (!refs) continue;
		for (let [cardID, str] of Object.entries(refs)) {
			if (str) continue;
			const otherCard = cards[cardID];
			if (!otherCard) continue;
			//OK, we're going to add it
			if (!result[cardID]) result[cardID] = {};
			if (!result[cardID][referenceType]) result[cardID][referenceType] = {};
			result[cardID][referenceType] = otherCard.title;
		}
	}
	if (Object.keys(result).length == 0) return null;
	return result;
};

//cardBFS returns a map of cardID -> degrees of separation from the key card.
//Note that if the keyCard is included, it will map that keyID -> 0, which is
//falsey, so when checking for existence, you should check whether it's
//undefined or not. if optReferenceType is falsey, it will use all substantive
//references. Otherwise, it will filter to only references of the given type, if
//it's a string, or any reference types listed if it's an array.
export const cardBFS = (keyCardIDOrSlug, cards, ply, includeKeyCard, isInbound, optReferenceTypes) => {
	if (!cards[keyCardIDOrSlug]) {
		let foundID = '';
		//The ID isn't in the list of cards. Check to see if maybe it's a slug.
		//getIdForCard requires a state to access slugIndex, so we'll just brute force it.
		for (let card of Object.values(cards)) {
			for (let slug of card.slugs || []) {
				if (slug == keyCardIDOrSlug) {
					foundID = card.id;
					break;
				}
			}
			if (foundID) break;
		}
		keyCardIDOrSlug = foundID;
	}
	let seenCards = {[keyCardIDOrSlug]: 0};
	let cardsToProcess = [keyCardIDOrSlug];

	//if optReferenceTypes is provided, make sure it's an array
	if (optReferenceTypes && !Array.isArray(optReferenceTypes)) optReferenceTypes = [optReferenceTypes];

	while (cardsToProcess.length) {
		const id = cardsToProcess.shift();
		const card = cards[id];
		//Must be unpublished
		if (!card) continue;
		const newCardDepth = (seenCards[id] || 0) + 1;
		if (newCardDepth > ply) continue;
		let links = [];
		if (optReferenceTypes) {
			for (const referenceType of optReferenceTypes) {
				//Some of these will be dupes and that's OK because we skip items that are already seen
				links = links.concat((isInbound ? references(card).byTypeInboundArray()[referenceType] : references(card).byTypeArray()[referenceType]) || []);
			}
		} else {
			links = isInbound ? references(card).inboundSubstantiveArray() : references(card).substantiveArray();
		}
		for (let linkItem of links) {
			//Skip ones that have already been seen
			if (seenCards[linkItem] !== undefined) continue;
			seenCards[linkItem] = newCardDepth;
			cardsToProcess.push(linkItem);
		}
	}
	if (!includeKeyCard) delete seenCards[keyCardIDOrSlug];
	return seenCards;
};

//cardMissingReciprocalLinks returns the links that point to a card that are not
//reciprocated and not explicitly listed as OK to skip.
export const cardMissingReciprocalLinks = (card) => {
	if (!card) return [];
	let links = new Map();
	const refs = references(card);
	for (let link of refs.inboundArray()) {
		links.set(link, true);
	}
	for (let link of refs.array()) {
		links.delete(link);
	}
	return [...links.keys()];
};

//other can be a card ID or a card
export const cardNeedsReciprocalLinkTo = (card, other) => {
	if (typeof other == 'object') other = other.id;
	if (!card || !other) return false;
	const missingReciprocalLinks = cardMissingReciprocalLinks(card);
	for (let link of missingReciprocalLinks) {
		if (link == other) return true;
	}
	return false;
};

const MULTIPLE_LINK_TEXT_DELIMITER = '\n';

export const extractCardLinksFromBody = (body) => {
	let ele = getDocument().createElement('section');
	//This is not an XSS vulnerability because we never append ele into the
	//actual dom.
	ele.innerHTML = body;
	let result = {};
	let nodes = ele.querySelectorAll('card-link[card]');
	nodes.forEach(link => {
		const id = link.getAttribute('card');
		if (result[id]) {
			result[id] = result[id] + MULTIPLE_LINK_TEXT_DELIMITER + link.innerText;
		} else {
			result[id] = link.innerText;
		}
	});
	return result;
};

//returns an array of strong text.
export const extractStrongTextFromBody = (body) => {
	let ele = getDocument().createElement('section');
	//This is not an XSS vulnerability because we never append ele into the
	//actual dom.
	ele.innerHTML = body;
	const strongEles = [...ele.querySelectorAll('strong')];
	return strongEles.map(ele => ele.innerText);
};

export const arrayRemove = (arr, items) => {
	if (!items) {
		console.warn('arrayRemove called without a second argument, which means you probably wanted arrayRemoveSentinel');
	}
	let itemsToRemove = new Map();
	for (let item of Object.values(items)) {
		itemsToRemove.set(item, true);
	}
	let result = [];
	for (let val of Object.values(arr)) {
		if (itemsToRemove.has(val)) continue;
		result.push(val);
	}
	return result;
};

export const arrayUnion = (arr, items) => {
	if (!items) {
		console.warn('arrayUnion called without a second argument, which means you probably wanted arrayUnionSentinel');
	}
	let result = [];
	let seenItems = new Map();
	for (let val of Object.values(arr)) {
		seenItems.set(val, true);
		result.push(val);
	}
	for (let val of Object.values(items)) {
		if (seenItems.has(val)) continue;
		result.push(val);
	}	
	return result;
};

export const arrayUnique = (arr) => {
	let seenItems = new Map();
	let result = [];
	for (let item of arr) {
		if (seenItems.has(item)) continue;
		result.push(item);
		seenItems.set(item, true);
	}
	return result;
};

export const arrayToSet = (arr) => {
	let result = {};
	for (let item of arr) {
		result[item] = true;
	}
	return result;
};

export const arrayDiffAsSets = (before, after) => {
	let [additions, deletions] = arrayDiff(before,after);
	return [arrayToSet(additions), arrayToSet(deletions)];
};

export const arrayDiff = (before, after) => {
	if (!before) before = [];
	if (!after) after = [];
	let afterMap = new Map();
	for (let item of after) {
		afterMap.set(item, true);
	}
	let deletions = [];
	for (let item of before) {
		if (afterMap.has(item)) {
			//Keep track of that we've seen this one
			afterMap.delete(item);
		} else {
			deletions.push(item);
		}
	}
	//Additions is the keys not remved in afterMap
	let additions = [...afterMap.keys()];
	return [additions, deletions];
};

//triStateMapDiff operates on objects that have keys that are either true or
//false. It returns keys to explicit set to true, keys to explicitly set to
//false, and keys to remove.
export const triStateMapDiff = (before, after) => {
	if (!before) before = {};
	if (!after) after = {};
	//Generat the list of removals by looking for keys that do not exist in
	//after but are in before.
	let removals = [];
	for (let beforeKey of Object.keys(before)) {
		if (after[beforeKey] === undefined) {
			removals.push(beforeKey);
		}
	}

	let enabled = [];
	let disabled = [];
	for (let afterKey of Object.keys(after)) {
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
export const setRemove = (obj, items) => {
	let result = {};
	for (let key of Object.keys(obj)) {
		result[key] = true;
	}
	for (let item of items) {
		delete result[item];
	}
	return result;
};

//items is an array
export const setUnion = (obj, items) => {
	let result = {};
	for (let key of Object.keys(obj)) {
		result[key] = true;
	}
	for (let item of items) {
		result[item] = true;
	}
	return result;
};

//This logic is finicky and we have a few defaults we want to have, so wrap it
//in a util.
export const makeElementContentEditable = (ele) => {
	ele.contentEditable = 'true';
	//It's OK if we have already done these commands to do them again

	let document = getDocument();

	//styleWithCSS turns off styling spans with CSS and just uses presentational
	//attributes. 
	document.execCommand('styleWithCSS', false, false);
	//Browsers currently insert a "<div>" as default paragraph separator but we
	//want 'p'; 
	document.execCommand('defaultParagraphSeparator', false, 'p');
};

//Returns a safe markdown element that can be emitted in a lit-html template.
export const markdownElement = (content) => {
	let div = getDocument().createElement('div');
	let html = snarkdown(content);
	let sanitizedHTML = dompurify.sanitize(html);
	div.innerHTML = sanitizedHTML;
	return div;
};

//date may be a firestore timestamp or a date object.
export const prettyTime = (date) => {
	if (!date) return '';
	if (typeof date.toDate == 'function') date = date.toDate();
	return date.toDateString();
};

export const killEvent = (e) => {
	if (e) {
		e.preventDefault();
	}
	return true;
};

export const isWhitespace = (s) => {
	return /^\s*$/.test(s);
};

//Items in the reads and stars collections are stored at a canonical id given
//a uid and card id.
export const idForPersonalCardInfo = (uid, cardId) => {
	return '' + uid + '+' + cardId;
};

let memoizedPageRank = null;
let memoizedPageRankInput = null;

//return a map of id to rank for each card.
export const pageRank = (cards) => {

	if (memoizedPageRankInput === cards) {
		return memoizedPageRank;
	}

	const targetEpsilon = 0.005;
	const jumpProbability = 0.85;
	//since it's not guaranteed to converge, will bail out at this number of
	//iterations.
	const maxIterations = 50;

	const nodes = {};
	const inboundLinksMap = {};
	const numNodes = Object.keys(cards).length;
	const initialRank = 1 / numNodes;

	for (let card of Object.values(cards)) {
		//We can't trust links or inbound_links as they exist, because they
		//might point to unpublished cards, and it's important for the
		//convergence of the algorithm that we have the proper indegree and outdegree. 
		const links = arrayUnique(references(card).substantiveArray().filter(id => cards[id]));
		for (let id of links) {
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
	for (let id of Object.keys(nodes)) {
		let inboundLinks = inboundLinksMap[id] || [];
		nodes[id].inDegree = inboundLinks.length;
		nodes[id].inboundLinks = inboundLinks;
	}

	//how much the overall graph changed from last time
	let updateDistance = 0;
	let numIterations = 0;

	do {
		numIterations++;
		let totalDistributedRank = 0;
		for (let node of Object.values(nodes)) {
			if (node.inDegree === 0) {
				node.rank = 0.0;
			} else {
				let currentRank = 0.0;
				for (let linkID of node.inboundLinks) {
					let otherNode = nodes[linkID];
					if (!otherNode) continue;
					currentRank += nodes[linkID].previousRank / nodes[linkID].outDegree;
				}
				node.rank = currentRank * jumpProbability;
				totalDistributedRank += node.rank;
			}
		}
		let leakedRankPerNode = (1 - totalDistributedRank) / numNodes;
		updateDistance = 0;
		for (let node of Object.values(nodes)) {
			let currentRank = node.rank + leakedRankPerNode;
			updateDistance += Math.abs(currentRank - node.previousRank);
			node.previousRank = currentRank;
		}
	} while(numIterations < maxIterations && updateDistance > targetEpsilon);

	const result =  Object.fromEntries(Object.entries(nodes).map(entry => [entry[0], entry[1].previousRank]));
	memoizedPageRankInput = cards;
	memoizedPageRank = result;
	return result;
};
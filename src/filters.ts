import {
	prettyTime,
	cardHasContent,
	cardHasNotes,
	cardHasTodo,
	toTitleCase,
	cardMissingReciprocalLinks,
	cardHasSubstantiveContent,
	randomString,
	hash,
	cardBFS,
	pageRank,
	createSlugFromArbitraryString,
	normalizeCardSlugOrIDList,
	assertUnreachable
} from './util.js';

import {
	tweetOrderExtractor,
} from './tweet-helpers.js';

import {
	CARD_TYPE_CONFIGURATION,
	BODY_CARD_TYPES,
	REFERENCE_TYPES,
	KEY_CARD_ID_PLACEHOLDER,
} from './card_fields.js';

import {
	references
} from './references.js';

import {
	FingerprintGenerator,
	PreparedQuery,
	getConceptCardForConcept,
	suggestedConceptReferencesForCard,
	getConceptsFromConceptCards,
	conceptCardsFromCards,
} from './nlp.js';

import {
	filterSetForFilterDefinitionItem,
	CollectionDescription,
	makeConcreteInverseFilter
} from './collection_description.js';

import {
	memoize,
} from './memoize.js';

import {
	SortConfigurationMap,
	ProcessedCard,
	ProcessedCards,
	Card,
	CardID,
	ConfigurableFilterConfigurationMap,
	ConfigurableFilterFuncFactoryResult,
	FilterExtras,
	CardIDMap,
	Sections,
	CardType,
	ReferenceType,
	CollectionState,
	FilterMap,
	SortExtra,
	TODOType,
	StringCardMap,
	ViewMode,
	DateRangeType,
	CardIdentifier,
	CardTestFunc,
	CardTimestampPropertyName,
	ConfigurableFilterControlPiece,
	Cards,
	ConfigurableFilterName,
	ConfigurableFilterType,
	URLPart,
	FilterName,
	ConfigurableFilterRest,
	UnionFilterName,
	ConcreteFilterName,
	CardSimilarityMap,
	FilterFuncResult,
	ConfigurableFilterResult,
	SetName,
	setName,
	referenceType,
	AutoTODOType,
	todoType,
	autoTODOType,
	FreeformTODOKey
} from './types.js';

import {
	Timestamp
} from 'firebase/firestore';

import {
	TypedObject
} from './typed_object.js';

import {
	fetchSimilarCardsIfEnabled
} from './actions/similarity.js';

const INBOUND_SUFFIX = '-inbound';
const OUTBOUND_SUFFIX = '-outbound';
const DIRECT_PREFIX = 'direct-';

const UPDATED_FILTER_NAME = 'updated';
const LAST_TWEETED_FILTER_NAME = 'last-tweeted';

const DIRECT_CONNECTIONS_FILTER_NAME = 'direct-connections';
const CONNECTIONS_FILTER_NAME = 'connections';
const CHILDREN_FILTER_NAME = 'children';
const DESCENDANTS_FILTER_NAME = 'descendants';
const PARENTS_FILTER_NAME = 'parents';
const ANCESTORS_FILTER_NAME = 'ancestors';
const REFERENCES_FILTER_NAME = 'references';
const REFERENCES_INBOUND_FILTER_NAME = REFERENCES_FILTER_NAME + INBOUND_SUFFIX;
const REFERENCES_OUTBOUND_FILTER_NAME = REFERENCES_FILTER_NAME + OUTBOUND_SUFFIX;
export const DIRECT_REFERENCES_FILTER_NAME = DIRECT_PREFIX + REFERENCES_FILTER_NAME;
export const DIRECT_REFERENCES_INBOUND_FILTER_NAME = DIRECT_PREFIX + REFERENCES_INBOUND_FILTER_NAME;
export const DIRECT_REFERENCES_OUTBOUND_FILTER_NAME = DIRECT_PREFIX + REFERENCES_OUTBOUND_FILTER_NAME;
const AUTHOR_FILTER_NAME = 'author';
const CARDS_FILTER_NAME = 'cards';
export const EXCLUDE_FILTER_NAME = 'exclude';
export const COMBINE_FILTER_NAME = 'combine';
const EXPAND_FILTER_NAME = 'expand';
export const QUERY_FILTER_NAME = 'query';
const QUERY_STRICT_FILTER_NAME = 'query-strict';
export const LIMIT_FILTER_NAME = 'limit';
export const OFFSET_FILTER_NAME = 'offset';
const SIMILAR_FILTER_NAME = 'similar';
const SIMILAR_CUTOFF_FILTER_NAME = 'similar-cutoff';
//About as in 'about this concept'. Ideally it would have been 'concept', but
//that's reserved for the cardType filter. It used to be 'about' but that
//conflicts with section name in production.
const ABOUT_CONCEPT_FILTER_NAME = 'about-concept';
const MISSING_CONCEPT_FILTER_NAME = 'missing-concept';
const SAME_TYPE_FILTER_NAME = 'same-type';
const DIFFERENT_TYPE_FILTER_NAME = 'different-type';

/*
* filterEquivalent - the name of the filter that, when applied to the everything
  set, will filter down to contain just the items in that set (although
  obviously without any particular order).

* description - the description for the set, to be shown to potentially all
  users.
*/
export const SET_INFOS : {[name in SetName]: {filterEquivalent: FilterName, description: string}} = {
	'main': {
		filterEquivalent: 'in-all-set',
		description: 'The default set, typically containing only content cards that are specifically included in a section'
	},
	'reading-list': {
		filterEquivalent: 'in-reading-list',
		description: 'This user\'s list of cards they\'ve put on their reading list',
	},
	'everything': {
		filterEquivalent: 'in-everything-set',
		description: 'Every single card of every type, including cards that aren\'t in any section (orphaned)'
	}
};

//If filter names have this character in them then they're actually a union of
//the filters
export const UNION_FILTER_DELIMITER = '+';

export const SET_NAMES = TypedObject.keys(SET_INFOS);

//The word in the URL That means "the part after this is a sort".
export const SORT_URL_KEYWORD = 'sort';
export const SORT_REVERSED_URL_KEYWORD = 'reverse';

export const VIEW_MODE_URL_KEYWORD = 'view';

export const NONE_FILTER_NAME = 'none';
export const ALL_FILTER_NAME = 'all-cards';

//Legal view modes, including whether an option is expected or not.
export const LEGAL_VIEW_MODES : {[mode in ViewMode]: boolean} = {
	//Note: collection_description logic assumes that default_view_mode takes not extra option.
	'list': false,
	'web': true,
};

export const collectionDescription = (...parts : FilterName[]) : CollectionDescription => new CollectionDescription('everything', parts);

export const referencesFilter = (direction : 'inbound' | 'outbound' | 'both', referenceType : ReferenceType | ReferenceType[], invertReferencesTypes? : boolean) : ConfigurableFilterName => {
	let filter = '';
	switch(direction) {
	case 'inbound':
		filter = DIRECT_REFERENCES_INBOUND_FILTER_NAME;
		break;
	case 'outbound':
		filter = DIRECT_REFERENCES_OUTBOUND_FILTER_NAME;
		break;
	case 'both':
		filter = DIRECT_REFERENCES_FILTER_NAME;
		break;
	default:
		assertUnreachable(direction);
	}
	if (!filter) throw new Error('Unexpected no error');
	return referencesConfigurableFilterText(filter, KEY_CARD_ID_PLACEHOLDER, referenceType, invertReferencesTypes);
};

export const excludeFilter = (filter : FilterName) : ConfigurableFilterName => EXCLUDE_FILTER_NAME + '/' + filter;
export const limitFilter = (count : number) : ConfigurableFilterName => LIMIT_FILTER_NAME + '/' + String(count);
export const unionFilter = (...parts : CardID[]) : UnionFilterName => parts.join(UNION_FILTER_DELIMITER);
export const similarFilter = (cardID : CardID = KEY_CARD_ID_PLACEHOLDER) : ConfigurableFilterName => SIMILAR_FILTER_NAME + '/' + cardID;
export const sameTypeFilter = (cardID : CardID = KEY_CARD_ID_PLACEHOLDER) : ConfigurableFilterName => SAME_TYPE_FILTER_NAME + '/' + cardID;
export const differentTypeFilter = (cardID : CardID = KEY_CARD_ID_PLACEHOLDER) : ConfigurableFilterName => DIFFERENT_TYPE_FILTER_NAME + '/' + cardID;
export const cardsFilter = (input : CardIdentifier | UnionFilterName) : ConfigurableFilterName => CARDS_FILTER_NAME + '/' + input;
//This one is mainly useful for type checking
export const cardTypeFilter = (type : CardType) : FilterName => type;
export const aboutConceptFilter = (conceptStr : string | CardID = KEY_CARD_ID_PLACEHOLDER) : ConfigurableFilterName => {
	//yes, this is a bit of a hack that the slug happens to be a valid concept string argument...
	return ABOUT_CONCEPT_FILTER_NAME + '/' + createSlugFromArbitraryString(conceptStr);
};
//if conceptStr is blank, it means 'all cards missing any concept'
export const missingConceptFilter = (conceptStr : string = KEY_CARD_ID_PLACEHOLDER) : ConfigurableFilterName => {
	const arg = conceptStr ? createSlugFromArbitraryString(conceptStr) : '+';
	//yes, this is a bit of a hack that the slug happens to be a valid concept string argument...
	return MISSING_CONCEPT_FILTER_NAME + '/' + arg;
};

export const parseDateSection = (str : string) : [dateType : DateRangeType, firstDate : Date, secondDate : Date] => {
	let pieces = str.split('/');
	const targetLength = CONFIGURABLE_FILTER_URL_PARTS[pieces[0]] + 1;
	pieces = pieces.slice(0, targetLength);
	let firstDate = null;
	let secondDate = null;
	if (pieces.length > 1) firstDate = new Date(pieces[1]);
	//make sure there's always a second date, defaulting to now.
	if (pieces.length > 2) secondDate = pieces[2] ? new Date(pieces[2]) : new Date();
	return [pieces[0] as DateRangeType, firstDate, secondDate];
};

export const makeDateSection = (comparsionType : DateRangeType, dateOne : Date, dateTwo : Date) : string => {
	const result : string[] = [comparsionType];
	result.push('' + dateOne.getFullYear() + '-' + (dateOne.getMonth() + 1) + '-' + dateOne.getDate());
	if (CONFIGURABLE_FILTER_URL_PARTS[comparsionType] == 2) {
		if (!dateTwo) dateTwo = new Date();
		result.push('' + dateTwo.getFullYear() + '-' + (dateTwo.getMonth() + 1) + '-' + dateTwo.getDate());
	}
	return result.join('/');
};

const dateConfigurableFilterMap : {[name : string] : CardTimestampPropertyName} = {
	[UPDATED_FILTER_NAME] : 'updated_substantive' as CardTimestampPropertyName,
	[LAST_TWEETED_FILTER_NAME]: 'last_tweeted' as CardTimestampPropertyName,
};

const makeDateConfigurableFilter = (propName : CardTimestampPropertyName | typeof UPDATED_FILTER_NAME | typeof LAST_TWEETED_FILTER_NAME, comparisonType : DateRangeType, firstDateStr? : string, secondDateStr? : string) : ConfigurableFilterFuncFactoryResult => {

	const cardKey = dateConfigurableFilterMap[propName] || propName as CardTimestampPropertyName;

	const firstDate = firstDateStr ? new Date(firstDateStr) : null;
	const secondDate = secondDateStr ? new Date(secondDateStr) : null;

	let func : ((card : ProcessedCard) => FilterFuncResult) = () => ({matches: false});

	switch (comparisonType) {
	case 'before':
		func = function(card) {
			const val = card[cardKey] as Timestamp;
			if (!val) return {matches: false};
			const difference = val.toMillis() - firstDate.getTime();
			return {matches: difference < 0};
		};
		break;
	case 'after':
		func = function(card) {
			const val = card[cardKey] as Timestamp;
			if (!val) return {matches: false};
			const difference = val.toMillis() - firstDate.getTime();
			return {matches: difference > 0};
		};
		break;
	case 'between':
		//Bail if the second date isn't provided
		if (secondDate) {
			func = function(card) {
				const val = card[cardKey] as Timestamp;
				if (!val) return {matches: false};
				const firstDifference = val.toMillis() - firstDate.getTime();
				const secondDifference = val.toMillis() - secondDate.getTime();
				return {matches: (firstDifference > 0 && secondDifference < 0) || (firstDifference < 0 && secondDifference > 0)} ;
			};
		}
		break;
	default:
		assertUnreachable(comparisonType);
	}

	return [func, false];
};

function unionSet<T>(...sets : {[name : string] : T}[]) : {[name : string] : T} {
	const result : {[name : string] : T} = {};
	for (const set of sets) {
		if (!set) continue;
		for (const key of Object.keys(set)) {
			result[key] = set[key];
		}
	}
	return result;
}

const referencesConfigurableFilterText = (referencesFilterType : string, cardID : CardID, referencesTypes : ReferenceType | ReferenceType[], invertReferencesTypes? : boolean, ply? : number) => {
	if (!referencesFilterType.includes(REFERENCES_FILTER_NAME)) throw new Error(referencesFilterType + ' is not a valid type for this function');
	if (!referencesTypes) throw new Error('referenceTypes must be a string or array');
	if (typeof referencesTypes != 'string' && !Array.isArray(referencesTypes)) throw new Error('referencesTypes must be a string or array');
	if (typeof referencesTypes == 'string') referencesTypes = [referencesTypes];
	if (ply === undefined && !referencesFilterType.includes(DIRECT_PREFIX)) throw new Error('ply is required if the reference type is not a direct one');
	return referencesFilterType + '/' + cardID + '/' + (invertReferencesTypes ? INVERT_REFERENCE_TYPES_PREFIX : '') + referencesTypes.join(UNION_FILTER_DELIMITER) + (ply === undefined ? '' : '/' + ply);
};

const INCLUDE_KEY_CARD_PREFIX = '+';
const INVERT_REFERENCE_TYPES_PREFIX = '-';

//returns the cardID, whether it's a key card, and an array of all cardIDs if it's a union
export const parseKeyCardID = (cardID : string) : [id : CardID, includeKeyCard : boolean, allIDs : CardID[]] => {
	let includeKeyCard = false;
	if (cardID.startsWith(INCLUDE_KEY_CARD_PREFIX)) {
		includeKeyCard = true;
		cardID = cardID.substring(INCLUDE_KEY_CARD_PREFIX.length);
	}
	const ids = cardID.split(UNION_FILTER_DELIMITER);
	return [ids[0], includeKeyCard, ids];
};

export const keyCardID = (cardID : CardID | CardID[], includeKeyCard? : boolean) : CardID => {
	if (Array.isArray(cardID)) cardID = cardID.join(UNION_FILTER_DELIMITER);
	return includeKeyCard ? INCLUDE_KEY_CARD_PREFIX + cardID : cardID;
};

const INVALID_FILTER_NAME_SENTINEL = () => ({});

//Returns a function that takes cards, activeCardID, and editingCard and returns
//a map of cardID -> depth from the keycard. If optOverrideCards is defined,
//then cardID is ignored, and instead it passes the keys of that map to the BFS.
const cardBFSMaker = (filterName : ConfigurableFilterType, cardID : CardID, countOrTypeStr : string, countStr : string, optOverrideCards? : CardIDMap) : (cards : Cards, activeCardID : CardID, editingCard : Card) => SortExtra => {
	//note: makeExpandConfigurableFilter needs to be updated if the number or order of parameters changes.

	if (!LINKS_FILTER_NAMES[filterName]) {
		console.warn('Expected a links filter for cardBFSMaker, got: ', filterName);
		return INVALID_FILTER_NAME_SENTINEL;
	}

	//refernces filters take typeStr as second parameter, but others skip those.
	const referenceFilter = filterName.includes(REFERENCES_FILTER_NAME);
	//we always pass referenceTypes to cardBFS, so make sure it's falsey unless it's a reference filter.
	let referenceTypes : ReferenceType[] = null;
	if (referenceFilter) {
		let typeStr = countOrTypeStr;
		const invertReferenceTypes = typeStr.startsWith(INVERT_REFERENCE_TYPES_PREFIX);
		if (invertReferenceTypes) typeStr = typeStr.substring(INVERT_REFERENCE_TYPES_PREFIX.length);
		referenceTypes = typeStr.split(UNION_FILTER_DELIMITER) as ReferenceType[];
		//if we were told to invert, include any reference type that WASN'T passed.
		if (invertReferenceTypes) {
			const providedTypesMap = Object.fromEntries(referenceTypes.map(item => [item, true]));
			referenceTypes = TypedObject.keys(REFERENCE_TYPES).filter(key => !providedTypesMap[key]);
		}
	}
	if (!referenceFilter) countStr = countOrTypeStr;

	const isInbound = filterName == PARENTS_FILTER_NAME || filterName == ANCESTORS_FILTER_NAME || filterName == REFERENCES_INBOUND_FILTER_NAME || filterName == DIRECT_REFERENCES_INBOUND_FILTER_NAME;
	const twoWay = filterName == DIRECT_CONNECTIONS_FILTER_NAME || filterName == CONNECTIONS_FILTER_NAME || filterName == REFERENCES_FILTER_NAME || filterName == DIRECT_REFERENCES_FILTER_NAME;
	if (filterName == CHILDREN_FILTER_NAME || filterName == PARENTS_FILTER_NAME || filterName == DIRECT_CONNECTIONS_FILTER_NAME || filterName == DIRECT_REFERENCES_FILTER_NAME || filterName == DIRECT_REFERENCES_INBOUND_FILTER_NAME || filterName == DIRECT_REFERENCES_OUTBOUND_FILTER_NAME) countStr = '1';
	let count = parseInt(countStr);
	if (isNaN(count)) count = 1;
	if (count == 0) count = Number.MAX_SAFE_INTEGER;
	if (!cardID) cardID = '';

	let includeKeyCard = false;
	[cardID, includeKeyCard] = parseKeyCardID(cardID);

	const overrideCardIDs = optOverrideCards ? Object.keys(optOverrideCards) : null;

	//We have to memoize the functor we return, even though the filter machinery
	//will memoize too, because otherwise literally every card in a given run
	//will have a NEW BFS done. So memoize as long as cards are the same.
	return memoize((cards : Cards, activeCardID : CardID, editingCard : Card) => {
		const cardIDToUse = cardID == KEY_CARD_ID_PLACEHOLDER ? activeCardID : cardID;
		//If editingCard is provided, use it to shadow the unedited version of itself.
		if (editingCard) cards = {...cards, [editingCard.id]: editingCard};
		const starterSet = overrideCardIDs || cardIDToUse;
		if (twoWay){
			const bfsForOutbound = cardBFS(starterSet, cards, count, includeKeyCard, false, referenceTypes);
			const bfsForInbound = Object.fromEntries(Object.entries(cardBFS(starterSet, cards, count, includeKeyCard, true, referenceTypes)).map(entry => [entry[0], entry[1] * -1]));
			//inbound might have a -0 in it, so have outbound be second so we get just the zero
			return unionSet(bfsForInbound,bfsForOutbound);
		} else {
			return cardBFS(starterSet, cards, count, includeKeyCard, isInbound, referenceTypes);
		}
	});
};

const makeCardLinksConfigurableFilter = (filterName : ConfigurableFilterType, cardID : string, countOrTypeStr : string, countStr : string) : ConfigurableFilterFuncFactoryResult => {

	const mapCreator = cardBFSMaker(filterName, cardID, countOrTypeStr, countStr);

	const func = function(card : ProcessedCard, extras : FilterExtras) : FilterFuncResult {
		
		const val = mapCreator(extras.cards, extras.keyCardID, extras.editingCard)[card.id];
		//Return the degree of separation so it's available to sort on
		return {matches: val !== undefined, sortExtra: val};
	};

	return [func, false];
};

export const parseMultipleCardIDs = (str : string) : CardIdentifier[] => str.split(INCLUDE_KEY_CARD_PREFIX);
export const combineMultipleCardIDs = (cardIDs : CardIdentifier[]) : string => cardIDs.join(INCLUDE_KEY_CARD_PREFIX);

const makeCardsConfigurableFilter = (_ : ConfigurableFilterType, idString : string) : ConfigurableFilterFuncFactoryResult => {
	//ids can be a single id or slug, or a conjunction of them delimited by '+'
	const rawIdsToMatch : {[id : CardIdentifier] : true} = Object.fromEntries(parseMultipleCardIDs(idString).map(id => [id, true]));

	//TODO: we could check if KEY_CARD_ID_PLACEHOLDER is in any of them, and if not
	//never generate a new set of expanded ids to match to save a little
	//performance.
	const generator = memoize((keyCardID : CardID) : {[id : CardIdentifier] : true} => Object.fromEntries(Object.entries(rawIdsToMatch).map(entry => [entry[0] == KEY_CARD_ID_PLACEHOLDER ? keyCardID : entry[0], entry[1]])));

	//TODO: only calculate the slug --> id once so subsequent matches can be done with one lookup
	const func = function(card : ProcessedCard, extras : FilterExtras) : FilterFuncResult {
		const idsToMatch = generator(extras.keyCardID);
		if (idsToMatch[card.id]) return {matches: true};
		if (!card.slugs) return {matches: false};
		for (const slug of card.slugs) {
			if (idsToMatch[slug]) return {matches: true};
		}
		return {matches: false};
	};
	return [func, false];
};

const makeAboutConceptConfigurableFilter = (_ : ConfigurableFilterType, conceptStrOrID : string) : ConfigurableFilterFuncFactoryResult => {
	//conceptStr should have '-' delimiting its terms; normalize text
	//will automatically handle them the same.

	//This function is pretty simple: find the concept card, then memoize the
	//inbound concept references it has.

	const matchingCardsFunc = memoize((cards : ProcessedCards, keyCardID : CardID) : [FilterMap, CardID]=> {
		const expandedConceptStrOrId = conceptStrOrID == KEY_CARD_ID_PLACEHOLDER ? keyCardID : conceptStrOrID;
		const conceptCard = cards[expandedConceptStrOrId] || getConceptCardForConcept(cards, expandedConceptStrOrId);
		if (!conceptCard) return [{}, ''];
		const conceptReferenceMap = references(conceptCard).byTypeClassInbound('concept');
		const matchingCards : FilterMap = {};
		for (const cardMap of Object.values(conceptReferenceMap)) {
			for (const cardID of Object.keys(cardMap)) {
				matchingCards[cardID] = true;
			}
		}
		const conceptCardID = conceptCard.id;
		return [matchingCards, conceptCardID];
	});

	const func = function(card : ProcessedCard, extras : FilterExtras) : FilterFuncResult {
		const [matchingCards, conceptCardID] = matchingCardsFunc(extras.cards, extras.keyCardID);
		if (card.id == conceptCardID) {
			return {matches: true, sortExtra: 1};
		}
		return {matches: matchingCards[card.id], sortExtra: 0};
	};
	return [func, false];
};

const makeSameTypeConfigurableFilter = (filterName : ConfigurableFilterType, inputCardID : string) : ConfigurableFilterFuncFactoryResult => {
	//We use this function for both same and different type
	const sameType = filterName == SAME_TYPE_FILTER_NAME;
	//Technically the '+' prefix doesn't make any sense here, but temporarily
	//we're using hte dialog config type that might give us one as a prefix, so
	//look for it just in case.
	const [cardID, ] = parseKeyCardID(inputCardID);

	const func = (card : ProcessedCard, extras : FilterExtras) : FilterFuncResult => {
		const actualCardID = cardID == KEY_CARD_ID_PLACEHOLDER ? extras.keyCardID : cardID;
		const mainCard = extras.cards[actualCardID];
		if (!mainCard) return {matches: false};
		return {matches: sameType ? mainCard.card_type == card.card_type : mainCard.card_type != card.card_type};
	};

	return [func, false];

};

const makeMissingConceptConfigurableFilter = (_ : ConfigurableFilterType, conceptStrOrCardID : URLPart) : ConfigurableFilterFuncFactoryResult => {
	//subFilter can only be a very small set of special filter names. They're
	//done as subtypes of `missing` becuase there's no way to do a configurable
	//filter without having a multi-part filter name.

	//+ is the way to signal 'all concept cards', otherwise we match all of them
	const keyConceptCard = conceptStrOrCardID != '+';

	//This is very expensive, and keyCardID will change way more often than
	//cards will, so do the two-level memoization.
	const expensiveGenerator = memoize((cards : ProcessedCards) : [conceptCards : ProcessedCards, concepts : StringCardMap]  => {
		//TODO: have conceptCardsFromCards return ProcessedCards if it was passed ProcessedCards
		const conceptCards = conceptCardsFromCards(cards) as ProcessedCards;
		const concepts = getConceptsFromConceptCards(conceptCards);
		return [conceptCards, concepts];
	});

	// returns [conceptCards, concepts, keyConceptCardID]
	const generator = memoize((cards : ProcessedCards, keyCardID : CardID) : [concepts : StringCardMap, keyConceptCardID : CardID] => {
		const [conceptCards, concepts] = expensiveGenerator(cards);
		let keyConceptCardID = '';
		if (keyConceptCard) {
			const expandedConcepStrOrCardID = conceptStrOrCardID == KEY_CARD_ID_PLACEHOLDER ? keyCardID : conceptStrOrCardID;
			if (cards[expandedConcepStrOrCardID]) {
				keyConceptCardID = expandedConcepStrOrCardID;
			} else {
				const conceptCard = getConceptCardForConcept(conceptCards, expandedConcepStrOrCardID);
				//If there's no matching concept then use a filter that won't
				//match anything because it has illegal characters
				keyConceptCardID = conceptCard ? conceptCard.id : '?INVALID-ID?';
			}
		}
		return [concepts, keyConceptCardID];
	});

	const func = function(card : ProcessedCard, extras : FilterExtras) : FilterFuncResult {
		const [concepts, keyConceptCardID] = generator(extras.cards, extras.keyCardID);
		const suggestedReferences = suggestedConceptReferencesForCard(card, concepts);
		const filteredSuggestedReferences = keyConceptCard ? suggestedReferences.filter(id => id == keyConceptCardID) : suggestedReferences;
		if (filteredSuggestedReferences.length == 0) return {matches: false, sortExtra: 0};
		return {matches: true, sortExtra: filteredSuggestedReferences.length};
	};
	return [func, false];
};

const makeExcludeConfigurableFilter = (_ : ConfigurableFilterType, ...remainingParts : URLPart[]) : ConfigurableFilterFuncFactoryResult => {
	const rest = remainingParts.join('/');

	const generator = memoize((extras : FilterExtras) : ConfigurableFilterResult => {
		return filterSetForFilterDefinitionItem(rest, extras);
	});

	//our func is just checking in the expanded filter.
	const func = function(card : ProcessedCard, extras : FilterExtras) : FilterFuncResult {

		const [filterSet, reversed] = generator(extras);

		const id = card.id;
		//TODO: ideally we wouldn't create an entire new filter for all of the
		//reversed keys only to then reverse it, but would instead pass it
		//trough and used !reversed for our own func definition. But there' no
		//good way to figure out if it will be reversed early enough to say
		//whether the function's results should be reversed. The current
		//approach works, it just requires a bit more memory.
		return {matches: reversed ? !filterSet[id] : filterSet[id]};
	};
	//The true is the whole business end of this configurable filter,
	//reversing the filter it operates on.
	return [func, true];
};

const extractSubFilters = (parts : URLPart[]) : FilterName[] => {
	//It's not clear where the first filter argument ends and the second one
	//starts because they'll all be smooshed together. We'll rely on
	//CollectionDescription machinery to parse it. If we don't include a
	//trailing '/' then it will interpret the last part as a CardID.
	const rest = parts.join('/') + '/';

	const combinedDescription = CollectionDescription.deserialize(rest);

	return combinedDescription.filters;
};

//This allows the use case "search for cards that match a given query, and then also include any cards that are within 1 inbound or outbound link"
const makeExpandConfigurableFilter = (_ : ConfigurableFilterType, ...remainingParts : URLPart[]) : ConfigurableFilterFuncFactoryResult => {
	const [mainFilter, expandFilter] = extractSubFilters(remainingParts);
	if (!mainFilter || !expandFilter) {
		console.warn('Expected two sub-filters for expand but didn\'t get it');
		return makeNoOpConfigurableFilter();
	}

	const generator = memoize((extras : FilterExtras) : FilterMap => {
		let [filterMembershipMain, excludeMain] = filterSetForFilterDefinitionItem(mainFilter, extras);

		//Make sure the sub filter membership is direct and not inverted
		if (excludeMain) filterMembershipMain = makeConcreteInverseFilter(filterMembershipMain, extras.cards);

		const expandFilterPieces = expandFilter.split('/');
		let expandedSet : FilterMap = {};

		if (expandFilterPieces[0] == SIMILAR_CUTOFF_FILTER_NAME) {
			const [similarFilter] = makeSimilarConfigurableFilter(SIMILAR_CUTOFF_FILTER_NAME, keyCardID(Object.keys(filterMembershipMain), false), expandFilterPieces[2]);
			//Walk through each card and run the similarFilter manually.
			for (const card of Object.values(extras.cards)) {
				const {matches: include} = similarFilter(card, extras);
				if (include) expandedSet[card.id] = true;
			}
		} else {
			//Must be a link style secondary filter
			const bfs = cardBFSMaker(expandFilterPieces[0], expandFilterPieces[1], expandFilterPieces[2], expandFilterPieces[3], filterMembershipMain);

			if (bfs == INVALID_FILTER_NAME_SENTINEL) {
				console.warn('Invalid links filter for second part: ' + expandFilter);
				return filterMembershipMain;
			}

			//We just pass '' for activeCardID each time because we don't acutally use it since we passed filterMembershipMain
			expandedSet = Object.fromEntries(Object.entries(bfs(extras.cards, '', extras.editingCard)).map(entry => [entry[0], true]));
		}

		return unionSet(filterMembershipMain, expandedSet);
	});
	
	const func = function(card : ProcessedCard, extras : FilterExtras) : FilterFuncResult {
		const filterSet = generator(extras);
		return {matches: filterSet[card.id]};
	};

	return [func, false];
};

const makeCombineConfigurableFilter = (_ : ConfigurableFilterType, ...remainingParts : URLPart[]) : ConfigurableFilterFuncFactoryResult => {

	const [subFilterOne, subFilterTwo] = extractSubFilters(remainingParts);

	if (!subFilterOne || !subFilterTwo) {
		console.warn('Expected two sub-filters for combine but didn\'t get it');
		return makeNoOpConfigurableFilter();
	}

	const generator = memoize((extras : FilterExtras) : FilterMap => {
		let [filterMembershipOne, excludeOne] = filterSetForFilterDefinitionItem(subFilterOne, extras);
		let [filterMembershipTwo, excludeTwo] = filterSetForFilterDefinitionItem(subFilterTwo, extras);

		//Make sure the sub filter membership is direct and not inverted
		if (excludeOne) filterMembershipOne = makeConcreteInverseFilter(filterMembershipOne, extras.cards);
		if (excludeTwo) filterMembershipTwo = makeConcreteInverseFilter(filterMembershipTwo, extras.cards);

		const result : FilterMap = {};
		for (const key of Object.keys(filterMembershipOne)) {
			result[key] = true;
		}
		for (const key of Object.keys(filterMembershipTwo)) {
			result[key] = true;
		}
		return result;
	});
	
	const func = function(card : ProcessedCard, extras : FilterExtras) : FilterFuncResult {
		const filterSet = generator(extras);
		return {matches: filterSet[card.id]};
	};

	return [func, false];
};

export const queryConfigurableFilterText = (queryText : string) : ConfigurableFilterName => {
	return QUERY_FILTER_NAME + '/' + encodeURIComponent(queryText).split('%20').join('+');
};

const configurableFilterIsQuery = (filterName : string) : boolean => {
	return filterName.startsWith(QUERY_FILTER_NAME + '/');
};

export const queryTextFromQueryFilter = (queryFilter : ConfigurableFilterName) : string => {
	if (!configurableFilterIsQuery(queryFilter)) return '';
	const rawQueryString = queryFilter.split('/')[1];
	return decodeURIComponent(rawQueryString).split('+').join(' ');
};

const makeQueryConfigurableFilter = (filterName : ConfigurableFilterType, rawQueryString : URLPart) : ConfigurableFilterFuncFactoryResult => {

	const decodedQueryString = decodeURIComponent(rawQueryString).split('+').join(' ');

	const query = new PreparedQuery(decodedQueryString);

	const strict = filterName === QUERY_STRICT_FILTER_NAME;

	const func = function(card : ProcessedCard) : FilterFuncResult {
		const [score, fullMatch] = query.cardScore(card);
		const matches = strict ? fullMatch && score > 0.0 : score > 0.0;
		//TODO: is returning a boolean for last argument intentional?
		return {matches, sortExtra: score, partialMatch: !fullMatch};
	};

	return [func, false];
};

//The special keyword for 'my user ID' in the configurable authors filter
export const ME_AUTHOR_ID = 'me';

const makeAuthorConfigurableFilter = (_ : ConfigurableFilterName, idString : URLPart) : ConfigurableFilterFuncFactoryResult => {
	const ids = Object.fromEntries(idString.split(INCLUDE_KEY_CARD_PREFIX).map(id => [id, true]));
	//Technically the IDs are case sensitive, but the URL machinery lowercases everything.
	//Realistically, collisions are astronomically unlikely
	const func = function(card : ProcessedCard, extras : FilterExtras) : FilterFuncResult {
		if (ids[ME_AUTHOR_ID]) {
			const userID = extras.userID;
			if (card.author == userID) return {matches: true};
			if (card.collaborators.some(id => id == userID)) return {matches: true};
		}
		if (ids[card.author.toLowerCase()]) return {matches: true};
		for (const collab of card.collaborators) {
			if (ids[collab.toLowerCase()]) return {matches: true};
		}
		return {matches: false};
	};
	return [func, false];
};

//We memoize the cards/generator outside even a singular configurable filter,
//because advance to next/previous card changes the keyCardID, but not the
//underlying card set, and that should be fast.
const memoizedFingerprintGenerator = memoize((cards : ProcessedCards) => new FingerprintGenerator(cards));

const makeSimilarConfigurableFilter = (_ : ConfigurableFilterType, rawCardID : URLPart, rawFloatCutoff : URLPart = String(Number.MIN_SAFE_INTEGER)) : ConfigurableFilterFuncFactoryResult => {
	//note: makeExpandConfigurableFilter needs to be updated if the number or order of parameters changes.

	const [, includeKeyCard, cardIDs] = parseKeyCardID(rawCardID);

	let floatCutoff = parseFloat(rawFloatCutoff || '0');
	if (isNaN(floatCutoff)) floatCutoff = 0;
	
	const generator = memoize((cards : ProcessedCards, rawCardIDsToUse : CardID[], editingCard : ProcessedCard, cardSimilarity : CardSimilarityMap) : {map: Map<CardID, number>, preview: boolean}  => {
		const cardIDsToUse = normalizeCardSlugOrIDList(rawCardIDsToUse, cards);

		let preview = false;

		//If there's an editing card, skip trying the embedding based similarity (for now).
		//When you create a card, the embedding is very likely a '' embedding anyway, so actively bad results.
		//Falling back on normal tfidf pipeline works great. 
		//In the future, we'll be constantly updating the card based on recent edits.
		if (!editingCard) {
			//TODO: figure out a way to support multiple key cards
			for (const cardID of cardIDsToUse) {
				if (cardSimilarity[cardID]) {
					if (Object.keys(cardSimilarity[cardID]).length) {
						//TODO: merge in fingerprint cards for the ones not in top amount
						return {map: new Map(Object.entries(cardSimilarity[cardID])), preview: false};
					}
					//If there are no keys, that's how the backend signals that it's a final error.
				} else {
					//Kick off a request for similarities we don't currently have, so
					//we'll have them next time. We'll get called again once it's fetched.
					//fetchSimilarCardsIfEnabled will tell us if we should expect values in the future.
					//We want it to be a preview if any of the cards is positive.
					preview = preview || fetchSimilarCardsIfEnabled(cardID);
				}
			}
		}

		const fingerprintGenerator = memoizedFingerprintGenerator(cards);
		const editingCardFingerprint = editingCard && cardIDsToUse.some(id => id == editingCard.id) ? fingerprintGenerator.fingerprintForCardObj(editingCard) : null;
		const fingerprint = editingCardFingerprint || fingerprintGenerator.fingerprintForCardIDList(cardIDsToUse);
		return {map: fingerprintGenerator.closestOverlappingItems('', fingerprint), preview};
	});

	//Make sure that the key of the IDs list will have object equality for a downstream memoized thing
	const replacedCardIDsGenerator = memoize((cardIDs : CardID[], keyCardID : CardID) => cardIDs.map(id => id == KEY_CARD_ID_PLACEHOLDER ? keyCardID : id));

	const func = function(card : ProcessedCard, extras : FilterExtras) : FilterFuncResult{
		const cardIDsToUse = replacedCardIDsGenerator(cardIDs, extras.keyCardID);
		if (cardIDsToUse.some(id => id == card.id)) {
			if (includeKeyCard) {
				return {matches: true, sortExtra: Number.MAX_SAFE_INTEGER};
			}
			return {matches: false, sortExtra: Number.MIN_SAFE_INTEGER};
		}

		const {map: closestItems, preview} = generator(extras.cards, cardIDsToUse, extras.editingCard, extras.cardSimilarity);

		//Return 0 if the map is missing the item, which could happen if it's server similarity
		const value : number = closestItems.get(card.id) || 0;

		return {matches: value ? value > floatCutoff : false, sortExtra: value, preview};
	};

	return [func, false];
};

//Fallback configurable filter
const makeNoOpConfigurableFilter = () : ConfigurableFilterFuncFactoryResult => {
	return [() => ({matches: true}),  false];
};

const BEFORE_FILTER_NAME : DateRangeType = 'before';
const AFTER_FILTER_NAME : DateRangeType = 'after';
const BETWEEN_FILTER_NAME : DateRangeType = 'between';

//When these are seen in the URL as parts, how many more pieces to expect, to be
//combined later. For things like `updated`, they want more than 1 piece more
//(e.g. `before/2020-10-03`, but the next pieces will also ask for more) in the
//piece. Note that only the ones listed in CONFIGURABLE_FILTER_NAMES may START a
//filter name.
export const CONFIGURABLE_FILTER_URL_PARTS = {
	[UPDATED_FILTER_NAME]: 1,
	[LAST_TWEETED_FILTER_NAME]: 1,
	[BEFORE_FILTER_NAME]: 1,
	[AFTER_FILTER_NAME]: 1,
	//with between, the dates can go in either order
	[BETWEEN_FILTER_NAME]: 2,
	[CHILDREN_FILTER_NAME]: 1,
	[DESCENDANTS_FILTER_NAME]: 2,
	[PARENTS_FILTER_NAME]: 1,
	[ANCESTORS_FILTER_NAME]: 2,
	[DIRECT_CONNECTIONS_FILTER_NAME]: 1,
	[CONNECTIONS_FILTER_NAME]: 2,
	//CARD-ID/TYPE/PLY
	[REFERENCES_FILTER_NAME]: 3,
	[REFERENCES_INBOUND_FILTER_NAME]: 3,
	[REFERENCES_OUTBOUND_FILTER_NAME]: 3,
	//CARD-ID/TYPE
	[DIRECT_REFERENCES_FILTER_NAME]: 2,
	[DIRECT_REFERENCES_INBOUND_FILTER_NAME]: 2,
	[DIRECT_REFERENCES_OUTBOUND_FILTER_NAME]: 2,
	[AUTHOR_FILTER_NAME]: 1,
	//Exclude takes itself, plus whatever filter comes after it
	[EXCLUDE_FILTER_NAME]: 1,
	//Combine takes itself, plus two other filters after it
	[COMBINE_FILTER_NAME]: 2,
	//Expand takes one sub-filter, and then one expanding link filter
	[EXPAND_FILTER_NAME]: 2,
	[CARDS_FILTER_NAME]: 1,
	[QUERY_FILTER_NAME]: 1,
	[QUERY_STRICT_FILTER_NAME]: 1,
	[LIMIT_FILTER_NAME]: 1,
	[OFFSET_FILTER_NAME]: 1,
	[SIMILAR_FILTER_NAME]: 1,
	//key card, float
	[SIMILAR_CUTOFF_FILTER_NAME]: 2,
	[ABOUT_CONCEPT_FILTER_NAME]: 1,
	[MISSING_CONCEPT_FILTER_NAME]: 1,
	[SAME_TYPE_FILTER_NAME]: 1,
	[DIFFERENT_TYPE_FILTER_NAME]: 1,
};

const beforeTodayDefaultsFactory = () => {
	const today = new Date();
	return BEFORE_FILTER_NAME + '/' + today.getFullYear() + '-' + (today.getMonth() + 1) + '-' + today.getDate();
};

const DEFAULT_DATE_FILTER = beforeTodayDefaultsFactory();

const LINK_FILTER_BASE = INCLUDE_KEY_CARD_PREFIX + KEY_CARD_ID_PLACEHOLDER;

const DEFAULT_LINK_SUB_FILTER = CHILDREN_FILTER_NAME + '/' + LINK_FILTER_BASE;

//the factories should return a filter func that takes the card to opeate on,
//then cards. The factory will be provided with the individual parts of the
//configuration return a func and whether or not its output should be reversed.
//The function takes card, and an extras object. Extras contains cards,
//filterSetMemberships, keyCardID (which is typically the activeCardID, but
//might be a different one for example if the collection in question is being
//prepared for a hovered card), editingCard, and userIO. (See
//makeExtrasForFilterFunc to see precisely the fields) The func should return
//either true/false, or, if wants to make values available for later sorts in
//sortExtras, it can emit an array [matches, sortValue] where matches is a
//boolean and sortValue is the value to pass into sortExtras for that card. It
//can also emit a [matches, sortValue, partialMatch], where partialMatch denotes
//the item should be ghosted. If the filter emits sortExtras, then it should
//also define a labelName. 
export const CONFIGURABLE_FILTER_INFO : ConfigurableFilterConfigurationMap = {
	[UPDATED_FILTER_NAME]: {
		factory: makeDateConfigurableFilter,
		description: 'Selects cards that were updated within a given date range',
		arguments: [{
			type: 'date',
			description: 'Date Range',
			default: DEFAULT_DATE_FILTER,
		}],
	},
	[LAST_TWEETED_FILTER_NAME]: {
		factory: makeDateConfigurableFilter,
		description: 'Selects cards that had a tweet within a given date range',
		arguments: [{
			type: 'date',
			description: 'Date Range',
			default: DEFAULT_DATE_FILTER,
		}],
	},
	[CHILDREN_FILTER_NAME]: {
		factory: makeCardLinksConfigurableFilter,
		labelName: 'Degree',
		flipOrder: true,
		description: 'Selects cards that are directly referenced by a given card',
		arguments: [{
			type: 'key-card',
			description: 'The key card',
			default: LINK_FILTER_BASE
		}]
	},
	[DESCENDANTS_FILTER_NAME]: {
		factory: makeCardLinksConfigurableFilter,
		labelName: 'Degree',
		flipOrder: true,
		description: 'Selects cards that are direct or indirectly referenced by a given card',
		arguments: [{
			type: 'key-card',
			description: 'The key card',
			default: LINK_FILTER_BASE
		},{
			type: 'int',
			description: 'Ply',
			default: '2',
		}]
	},
	[PARENTS_FILTER_NAME]: {
		factory: makeCardLinksConfigurableFilter,
		labelName: 'Degree',
		flipOrder: true,
		description: 'Selects cards that directly reference the given card',
		arguments: [{
			type: 'key-card',
			description: 'The key card',
			default: LINK_FILTER_BASE
		}]
	},
	[ANCESTORS_FILTER_NAME]: {
		factory: makeCardLinksConfigurableFilter,
		labelName: 'Degree',
		flipOrder: true,
		description: 'Selects cards that directly or indirectly reference the given card',
		arguments: [{
			type: 'key-card',
			description: 'The key card',
			default: LINK_FILTER_BASE
		},{
			type: 'int',
			description: 'Ply',
			default: '2',
		}]
	},
	[DIRECT_CONNECTIONS_FILTER_NAME]: {
		factory: makeCardLinksConfigurableFilter,
		labelName: 'Degree',
		flipOrder: true,
		description: 'Selects cards that directly reference or are referenced by a given card',
		arguments: [{
			type: 'key-card',
			description: 'The key card',
			default: LINK_FILTER_BASE
		}]
	},
	[CONNECTIONS_FILTER_NAME]: {
		factory: makeCardLinksConfigurableFilter,
		labelName: 'Degree',
		flipOrder: true,
		description: 'Selects cards that directly or indirectly reference (or are referenced by) a given card',
		arguments: [{
			type: 'key-card',
			description: 'The key card',
			default: LINK_FILTER_BASE
		},{
			type: 'int',
			description: 'Ply',
			default: '2',
		}]
	},
	[REFERENCES_FILTER_NAME]: {
		factory: makeCardLinksConfigurableFilter,
		labelName: 'Degree',
		flipOrder: true,
		description: 'Selects cards that reference or are referenced by other cards with a particular type of reference',
		arguments: [{
			type: 'key-card',
			description: 'The key card',
			default: LINK_FILTER_BASE
		},{
			type: 'reference-type',
			description: 'Reference types',
			default: referenceType('link'),
		},{
			type: 'int',
			description: 'Ply',
			default: '2',
		}]
	},
	[REFERENCES_INBOUND_FILTER_NAME]: {
		factory: makeCardLinksConfigurableFilter,
		labelName: 'Degree',
		flipOrder: true,
		description: 'Selects cards that is referenced by other cards with a particular type of reference',
		arguments: [{
			type: 'key-card',
			description: 'The key card',
			default: LINK_FILTER_BASE
		},{
			type: 'reference-type',
			description: 'Reference types',
			default: referenceType('link'),
		},{
			type: 'int',
			description: 'Ply',
			default: '2',
		}]
	},
	[REFERENCES_OUTBOUND_FILTER_NAME]: {
		factory: makeCardLinksConfigurableFilter,
		labelName: 'Degree',
		flipOrder: true,
		description: 'Selects cards that reference other cards with a particular type of reference',
		arguments: [{
			type: 'key-card',
			description: 'The key card',
			default: LINK_FILTER_BASE
		},{
			type: 'reference-type',
			description: 'Reference types',
			default: referenceType('link'),
		},{
			type: 'int',
			description: 'Ply',
			default: '2',
		}]
	},
	[DIRECT_REFERENCES_FILTER_NAME]: {
		factory: makeCardLinksConfigurableFilter,
		labelName: 'Degree',
		flipOrder: true,
		description: 'Selects cards that directly reference or are referenced by other cards with a particular type of reference',
		arguments: [{
			type: 'key-card',
			description: 'The key card',
			default: LINK_FILTER_BASE
		},{
			type: 'reference-type',
			description: 'Reference types',
			default: referenceType('link'),
		}]
	},
	[DIRECT_REFERENCES_INBOUND_FILTER_NAME]: {
		factory: makeCardLinksConfigurableFilter,
		labelName: 'Degree',
		flipOrder: true,
		description: 'Selects cards that reference other cards with a particular type of reference',
		arguments: [{
			type: 'key-card',
			description: 'The key card',
			default: LINK_FILTER_BASE
		},{
			type: 'reference-type',
			description: 'Reference types',
			default: referenceType('link'),
		}]
	},
	[DIRECT_REFERENCES_OUTBOUND_FILTER_NAME]: {
		factory: makeCardLinksConfigurableFilter,
		labelName: 'Degree',
		flipOrder: true,
		description: 'Selects cards that are referenced by other cards with a particular type of reference',
		arguments: [{
			type: 'key-card',
			description: 'The key card',
			default: LINK_FILTER_BASE
		},{
			type: 'reference-type',
			description: 'Reference types',
			default: referenceType('link'),
		}]
	},
	[AUTHOR_FILTER_NAME]: {
		factory: makeAuthorConfigurableFilter,
		description: 'Selects cards that are authored by the give user ID',
		arguments: [{
			type: 'user-id',
			description: 'User ID',
			default: ME_AUTHOR_ID
		}]
	},
	[EXCLUDE_FILTER_NAME]: {
		factory: makeExcludeConfigurableFilter,
		description: 'Inverts a sub-filter expression',
		arguments: [{
			type: 'sub-filter',
			description: 'Sub filter to negate',
			default: ALL_FILTER_NAME
		}]
	},
	[COMBINE_FILTER_NAME]: {
		factory: makeCombineConfigurableFilter,
		description: 'Returns the union of two sub-filter expressions',
		arguments: [{
			type: 'sub-filter',
			description: 'First sub filter to combine',
			default: ALL_FILTER_NAME
		}, {
			type: 'sub-filter',
			description: 'Second sub filter to combine',
			default: ALL_FILTER_NAME
		}]
	},
	[EXPAND_FILTER_NAME]: {
		factory: makeExpandConfigurableFilter,
		description: 'Filters the first sub expression, but then expands the result set to be any cards connected given the given connection type',
		arguments: [{
			type: 'sub-filter',
			description: 'First sub filter to select the starter set of cards to expand',
			default: ALL_FILTER_NAME
		}, {
			type: 'expand-filter',
			description: 'The link filter to expand the result set from the first part by',
			default: DEFAULT_LINK_SUB_FILTER
		}]
	},
	[CARDS_FILTER_NAME]: {
		//This filter matches precisely the IDsorSlugs provided. It's generally
		//used in conjunction with the exclude filter.
		factory: makeCardsConfigurableFilter,
		description: 'Selects a precise list of specific cards. It\'s typically used in conjunction with the ' + EXCLUDE_FILTER_NAME + ' filter',
		arguments: [{
			type: 'multiple-cards',
			description: 'Cards to include',
			default: KEY_CARD_ID_PLACEHOLDER,
		}]
	},
	[QUERY_FILTER_NAME]: {
		factory: makeQueryConfigurableFilter,
		suppressLabels: true,
		description: 'Selects cards that contain text that at least partially matches a provided query',
		arguments: [{
			type: 'text',
			description: 'Query text',
			default: 'foo',
		}],
	},
	[QUERY_STRICT_FILTER_NAME]: {
		factory: makeQueryConfigurableFilter,
		suppressLabels: true,
		description: 'Selects cards that contain text that exactly matches a provided query',
		arguments: [{
			type: 'text',
			description: 'Query text',
			default: 'foo',
		}],
	},
	[LIMIT_FILTER_NAME]: {
		//Limit is a special type of filter... it must run at the very last
		//phase after all cards are sorted. So as far as the normal machinery is
		//concerned, it's actually a no-op filter. It's up to Collection to
		//process it.
		factory: makeNoOpConfigurableFilter,
		description: 'Selects only up to a certain number of cards. Limit is a special type of filter that can only apply at the top-level, and there can only be one.',
		arguments: [{
			type: 'int',
			description: 'Limit',
			default: '10'
		}],
	},
	[OFFSET_FILTER_NAME]: {
		//Offset is a special type of filter... it must run at the very last
		//phase after all cards are sorted. So as far as the normal machinery is
		//concerned, it's actually a no-op filter. It's up to Collection to
		//process it.
		factory: makeNoOpConfigurableFilter,
		description: 'Drops the first n cards from the returned set. When used in conjunction with limit, allows pagination. Offset is a special type of filter that can only apply at the top-level, and there can only be one.',
		arguments: [{
			type: 'int',
			description: 'Offset',
			default: '10'
		}],
	},
	[SIMILAR_FILTER_NAME]: {
		factory: makeSimilarConfigurableFilter,
		suppressLabels: true,
		description: 'Selects cards that are similar to a given key card. It is primarily used for its sort order.',
		arguments: [{
			type: 'key-card',
			description: 'Key card',
			default: KEY_CARD_ID_PLACEHOLDER
		}],
	},
	[SIMILAR_CUTOFF_FILTER_NAME]: {
		factory: makeSimilarConfigurableFilter,
		suppressLabels: true,
		description: 'Selects cards that are similar to a given key card and above some float threshold of similarity',
		arguments: [{
			type: 'key-card',
			description: 'Key card',
			default: KEY_CARD_ID_PLACEHOLDER
		},
		{
			type: 'float',
			description: 'Float cutoff',
			default: 0.5,
		}],
	},
	[ABOUT_CONCEPT_FILTER_NAME]: {
		factory: makeAboutConceptConfigurableFilter,
		suppressLabels: true,
		description: 'Selects cards that reference a given text concept',
		arguments: [{
			type: 'concept-str-or-id',
			description: 'Concept or CardID',
			default: 'concept-name',
		}],
	},
	[MISSING_CONCEPT_FILTER_NAME]: {
		factory: makeMissingConceptConfigurableFilter,
		labelName: 'Suggested Concept Count',
		description: 'Selects cards that appear to be missing a particular concept reference',
		arguments: [{
			type: 'concept-str-or-id',
			description: 'Concept or CardID',
			default: 'concept-name',
		}],
	},
	[SAME_TYPE_FILTER_NAME]: {
		factory: makeSameTypeConfigurableFilter,
		description: 'Cards with the same type as the provided card',
		arguments: [{
			type: 'key-card',
			description: 'Key Card',
			default: KEY_CARD_ID_PLACEHOLDER,
		}]
	},
	[DIFFERENT_TYPE_FILTER_NAME]: {
		factory: makeSameTypeConfigurableFilter,
		description: 'Cards with a different type as the provided card',
		arguments: [{
			type: 'key-card',
			description: 'Key Card',
			default: KEY_CARD_ID_PLACEHOLDER,
		}]
	}
};

//The configurable filters that are allowed to start a multi-part filter.
export const CONFIGURABLE_FILTER_NAMES = Object.fromEntries(Object.entries(CONFIGURABLE_FILTER_INFO).map(entry => [entry[0], true]));

const LINKS_FILTER_NAMES = Object.fromEntries(Object.entries(CONFIGURABLE_FILTER_INFO).filter(entry => entry[1].factory == makeCardLinksConfigurableFilter).map(entry => [entry[0], true]));

const memoizedConfigurableFilters : {[name : ConfigurableFilterName] : ConfigurableFilterFuncFactoryResult} = {};

export const makeConfigurableFilter = (name : ConfigurableFilterName) : ConfigurableFilterFuncFactoryResult => {
	if (!memoizedConfigurableFilters[name]) {
		const parts = name.split('/');
		const func = CONFIGURABLE_FILTER_INFO[parts[0]].factory || makeNoOpConfigurableFilter;
		memoizedConfigurableFilters[name] = func(parts[0], ...parts.slice(1));
	}
	return memoizedConfigurableFilters[name];
};

export const splitCompoundFilter = (fullFilterName : ConfigurableFilterName) : [firstPart : ConfigurableFilterType, rest: ConfigurableFilterRest] => {
	const filterParts = fullFilterName.split('/');
	const firstFilterPart = filterParts[0];
	const restFilter = filterParts.slice(1).join('/');
	return [firstFilterPart, restFilter];
};

export const splitUnionFilter = (unionFilter : UnionFilterName) : ConcreteFilterName[] => {
	const [firstPart] = splitCompoundFilter(unionFilter);
	return firstPart.split(UNION_FILTER_DELIMITER);
};

export const piecesForConfigurableFilter = (fullFilterName : FilterName) : ConfigurableFilterControlPiece[] => {
	//TODO: it's kind of weird that this bespoke logic is here, instead of fully
	//being driven by constant configuration from filters.js
	const [filterName, rest] = splitCompoundFilter(fullFilterName);
	if (!rest) {
		console.warn('Unexpectedly no rest');
		return [];
	}
	const config = CONFIGURABLE_FILTER_INFO[filterName];
	if (!config) {
		console.warn('Unexpectedly no config');
		return [];
	}
	const pieces = rest.split('/');
	const result : ConfigurableFilterControlPiece[] = [];
	let pieceIndex = 0;
	for (const arg of config.arguments) {
		const controlType = arg.type;
		if (pieceIndex >= pieces.length) {
			console.warn('Ran out of pieces');
			continue;
		}
		switch (controlType) {
		case 'date':
			const subPieces = pieces.slice(pieceIndex, 2);
			pieceIndex += 2;
			if (subPieces[0] == BETWEEN_FILTER_NAME) {
				//one more
				subPieces.push(pieces[pieceIndex]);
				pieceIndex++;
			}
			result.push({
				controlType,
				description: arg.description,
				value: subPieces.join('/')
			});
			break;
		case 'sub-filter':
		case 'expand-filter':
			//consume the pices for this first subfilter
			const [nextSubFilter] = extractSubFilters(pieces.slice(pieceIndex));
			result.push({
				controlType,
				description: arg.description,
				value: nextSubFilter,
			});
			pieceIndex += nextSubFilter.split('/').length;
			break;
		case 'text':
		case 'key-card':
		case 'int':
		case 'float':
		case 'reference-type':
		case 'user-id':
		case 'multiple-cards':
		case 'concept-str-or-id':
			//The majority of filters are one piece for one argument.
			result.push({
				controlType,
				description: arg.description,
				value: pieces[pieceIndex],
			});
			pieceIndex++;
			break;
		default:
			assertUnreachable(controlType);
		}
	}
	return result;
};

const sectionNameForCard = (card : Card, sections : Sections) : string => {
	if (!card) {
		return '';
	}
	const section = sections[card.section];
	return section ? section.title : '';
};

//EAch sort is an extractor, a description (currently just useful for
//documentation; not shown anywhere), and a labelName to show in the drawer next
//to the label that extractor returns. The extractor is given the card object
//and the sections info map, and a map of all cards, and "sortExtras" and
//returns an array, where the 0 index is the raw value to compare for sorting,
//and the 1th value is the label to display. sortExtra is a dictionary of
//informations that special configurable filters emitted for each item, to be
//retrieved later. labelName is either a string OR a function that accepts a
//sortExtra parameter and returns a string. All sorts are currently assumed to
//be DESCENDING; if there's a new one that isn't, then add a property to config
//called ascending and toggle that. If reorderable is a function, it should
//accept sortExtras and return whether it's reorderable.
export const SORTS : SortConfigurationMap = {
	//Default sort is a no-op, unless a configurable filter was used that emits
	//sortValues, in which case it uses those. Note that
	//collection._makeSortedCards has logic tailored to this to know when it can
	//bail out early
	'default': {
		extractor: (card, sections, _, sortExtra) : [number, string] => {
			if (!sortExtra || Object.keys(sortExtra).length == 0) return [0, sectionNameForCard(card, sections)];
			//Pick whatever is the first key stored, which will be the first
			//configurable filter that emitted sortValues from left to right in
			//the URL
			const key = Object.keys(sortExtra)[0];
			const values = sortExtra[key];
			const config = CONFIGURABLE_FILTER_INFO[key];
			const value = values[card.id] || 0.0;
			//You might want to flip the sort order while having the displayed
			//order be the same. For example, any of the link-degree
			//configurable filters want the key card to go first.
			const result : [number, string] = [config.flipOrder ? value * -1 : value, config.suppressLabels ? '' : '' + value];
			return result;
		},
		description: 'The default order of the cards within each section in order',
		labelName: (sortExtra) => {
			if (!sortExtra || Object.keys(sortExtra).length == 0) return 'Section';
			//Pick whatever is the first key stored, which will be the first
			//configurable filter that emitted sortValues from left to right in
			//the URL
			const key = Object.keys(sortExtra)[0];
			const config = CONFIGURABLE_FILTER_INFO[key];
			return config && config.labelName ? config.labelName : 'Section';
		},
		reorderable: (sortExtra) => !sortExtra || Object.keys(sortExtra).length == 0
	},
	'original-order': {
		extractor: (card, sections) => [0, sectionNameForCard(card, sections)],
		description: 'The default order of the cards within each section in order',
		labelName: 'Section',
		reorderable: () => true
	},
	'link-count': {
		extractor: (card) => {
			const inbound_links = references(card).inboundLinksArray();
			return [inbound_links.length, '' + inbound_links.length];
		},
		description: 'In descending order by number of inbound links',
		labelName: 'Link Count',
	},
	'updated': {
		extractor: (card) => {
			const timestamp = card.updated_substantive;
			return [timestamp ? timestamp.seconds : 0, prettyTime(timestamp)];
		},
		description: 'In descending order by when each card was last substantively updated',
		labelName:'Updated',
	},
	'created': {
		extractor: (card) => {
			const timestamp = card.updated_substantive;
			return [timestamp ? timestamp.seconds : 0, prettyTime(timestamp)];
		},
		description: 'In descending order by when each card was created',
		labelName:'Created',
	},
	'stars': {
		extractor: (card) => [card.star_count || 0, ''],
		description: 'In descending order by number of stars',
	},
	'commented': {
		extractor: (card) => {
			const timestamp = card.updated_message;
			return [timestamp ? timestamp.seconds : 0, prettyTime(timestamp)];
		},
		description: 'In descending order by when each card last had a new message',
		labelName: 'Commented',
	},
	'recent': {
		extractor: (card) => {
			const messageValue = card.updated_message ? card.updated_message.seconds : 0;
			const updatedValue = card.updated_substantive ? card.updated_substantive.seconds : 0;
			const usingMessageValue = messageValue > updatedValue;
			const value = usingMessageValue ? messageValue : updatedValue;
			const timestamp = usingMessageValue ? card.updated_message : card.updated_substantive;
			return [value, prettyTime(timestamp)];
		},
		description: 'In descending order by when each card was last updated or had a new message',
		labelName: 'Last Activity',
	},
	'last-tweeted': {
		extractor: (card) => {
			return [card.last_tweeted.seconds, prettyTime(card.last_tweeted)];
		},
		description: 'In descending order of when they were last auto-tweeted',
		labelName: 'Tweeted'
	},	
	'tweet-count': {
		extractor: (card) => [card.tweet_count, '' + card.tweet_count],
		description: 'In descending order of how many times the card has been tweeted',
		labelName: 'Tweet Count',
	},
	'tweet-order': {
		extractor: tweetOrderExtractor as (card : ProcessedCard, sections : Sections, allCards : ProcessedCards) => [number, string],
		description: 'In descending order of the ones that are most deserving of a tweet',
		labelName: 'Tweet Worthiness',
	},
	'todo-difficulty': {
		extractor: (card : ProcessedCard) => {
			const result = MAX_TOTAL_TODO_DIFFICULTY - cardTODOConfigKeys(card).map(key => TODO_DIFFICULTY_MAP[key]).reduce((prev, curr) => prev + curr, 0.0);
			return [result, '' + result];
		},
		description: 'In ascending order of how difficult remaining TODOs are',
		labelName: 'TODO Difficulty'
	},
	'random': {
		extractor: (card, _, __, ___, filterExtras) => {
			return [hash(card.id + filterExtras.randomSalt), ''];
		},
		description: 'A random order',
		labelName: 'Random Order'
	},
	'card-rank': {
		extractor: (card, _, cards) => {
			//This is memoized so as long as cards is the same it won't be re-run.
			const ranks = pageRank(cards);
			const rank = ranks[card.id] || 0.0;
			return [rank, '' + Math.round(rank * 100000)];
		},
		description: 'Ranked by card rank (like page rank but for cards)',
		labelName: 'Rank',
	}
};

const defaultCardFilterName = (basename : string) : [string, string, string, string] => {
	return ['has-' + basename, 'no-' + basename, 'does-not-need-' + basename, 'needs-' + basename];
};

const defaultNonTodoCardFilterName = (basename : string) : [string, string, string, string] => {
	return [basename, 'not-' + basename, basename, 'not-' + basename];
};

export const TODO_COMBINED_FILTER_NAME = 'has-todo';
const TODO_COMBINED_INVERSE_FILTER_NAME = 'no-todo';

//this is whether the given type of TODO might be _automaticaly_ applied. Any
//card can manually have a TODO applied via auto_todo_overrides.
const cardMayHaveAutoTODO = (card : Card, todoConfig : TODOTypeInfo) : boolean => {
	return card && todoConfig.autoApply && (todoConfig.cardTypes ? todoConfig.cardTypes[card.card_type] : true);
};

//These are the enum values in CARD_FILTER_CONFIGS that configure whether an
//item is a TODO or not.

type TODOTypeBase = {
	type: string,
	cardTypes? : {
		[type in CardType]+? : true
	}
};

type TODOTypeInfoNonTODO = TODOTypeBase & {
	isTODO: false,
	autoApply: false
};

type TODOTypeInfoFreeform = TODOTypeBase & {
	type: 'freeform',
	isTODO : true,
	autoApply : false,
};

type TODOTypeInfoAutoTODO = TODOTypeBase & {
	isTODO : true,
	autoApply : true,
};

type TODOTypeInfo = TODOTypeInfoAutoTODO | TODOTypeInfoFreeform | TODOTypeInfoNonTODO;

//TODO_TYPE_NA is for card filters that are not TODOs
const TODO_TYPE_NA : TODOTypeInfoNonTODO = {
	type: 'na',
	isTODO: false,
	autoApply: false,
};

//TODO_TYPE_AUTO_CONTENT is for card filters that are TODOs and are auto-set on
//cards of type CONTENT, meaning that their key is legal in auto_todo_overrides.
const TODO_TYPE_AUTO_CONTENT : TODOTypeInfoAutoTODO = {
	type: 'auto',
	autoApply: true,
	//cardTypes is the types of cards that will have it autoapplied. However,
	//any card that has it actively set to false in their auto_todo_overrides
	//will show as having that TODO.
	cardTypes: {
		'content': true,
	},
	isTODO: true,
};

//TODO_TYPE_AUTO_CONTENT is for card filters that are TODOs and are auto-set on
//cards of type CONTENT, meaning that their key is legal in auto_todo_overrides.
const TODO_TYPE_AUTO_CONTENT_AND_CONCEPT : TODOTypeInfoAutoTODO = {
	type: 'auto',
	autoApply: true,
	//cardTypes is the types of cards that will have it autoapplied. However,
	//any card that has it actively set to false in their auto_todo_overrides
	//will show as having that TODO.
	cardTypes: {
		'content': true,
		'concept': true,
	},
	isTODO: true,
};

//TODO_TYPE_AUTO_WORKING_NOTES is for card filters that are TODOs and are auto-set on
//cards of type WORKING_NOTES, meaning that their key is legal in auto_todo_overrides.
const TODO_TYPE_AUTO_WORKING_NOTES : TODOTypeInfoAutoTODO = {
	type: 'auto',
	autoApply: true,
	//Will only ever be auto-applied to working-notes card
	cardTypes: {
		'working-notes': true,
	},
	isTODO: true,
};

//TODO_TYPE_FREEFORM is for card filters that are TODOs but are set via the freeform
//notes property and are not valid keys in auto_todo_overrides.
const TODO_TYPE_FREEFORM : TODOTypeInfoFreeform = {
	type: 'freeform',
	isTODO: true,
	autoApply: false,
};

type CardFilterConfigItem<T extends TODOTypeBase> = [filterNames: [string, string, string, string], test: CardTestFunc, typ : T, weight : number, description : string];

type CardFilterConfigMap = {
	[name : string]: CardFilterConfigItem<TODOTypeInfo>
}

type CardFilterConfigMapNonTODO = {
	[name : string] : CardFilterConfigItem<TODOTypeInfoNonTODO>
};

type CardFilterConfigMapAutoTODO = {
	[typ in AutoTODOType]: CardFilterConfigItem<TODOTypeInfoAutoTODO>
};

type CardFilterConfigMapFreeformTODO = {
	[key in FreeformTODOKey]: CardFilterConfigItem<TODOTypeInfoFreeform>
}

const CARD_FILTER_CONFIGS_FOR_TYPE : CardFilterConfigMapNonTODO= Object.fromEntries(Object.keys(CARD_TYPE_CONFIGURATION).map(function(cardType){return ['type-' + cardType, [defaultNonTodoCardFilterName(cardType), card => card.card_type == cardType, TODO_TYPE_NA, 0.0, 'Card that is of ' + cardType + ' type.']];}));
const CARD_FILTER_CONFIGS_FOR_REFERENCES : CardFilterConfigMapNonTODO= Object.fromEntries(TypedObject.keys(REFERENCE_TYPES).map(key => [key, [defaultCardFilterName(key + '-references'), card => references(card).byType[key] !== undefined, TODO_TYPE_NA, 0.0, 'Whether the card has any references of type ' + key]]));
const CARD_FILTER_CONFIGS_FOR_REFERENCES_INBOUND : CardFilterConfigMapNonTODO = Object.fromEntries(TypedObject.keys(REFERENCE_TYPES).map(key => ['inbound-' + key, [defaultCardFilterName('inbound-' + key + '-references'), card => references(card).byTypeInbound[key] !== undefined, TODO_TYPE_NA, 0.0, 'Whether the card has any inbound references of type ' + key]]));

const CARD_FILTER_AUTO_TODO_CONFIGS : CardFilterConfigMapAutoTODO = {
	'slug': [defaultCardFilterName('slug'), (card : Card) => card.slugs && card.slugs.length > 0, TODO_TYPE_AUTO_CONTENT, 0.2, 'Whether the card has a slug set'],
	'content': [defaultCardFilterName('content'), (card : Card) => cardHasContent(card), TODO_TYPE_AUTO_CONTENT_AND_CONCEPT, 5.0, 'Whether the card has any content whatsoever'],
	'substantive-content': [defaultCardFilterName('substantive-content'), (card : ProcessedCard) => cardHasSubstantiveContent(card), TODO_TYPE_AUTO_CONTENT, 3.0, 'Whether the card has more than a reasonable minimum amount of content'],
	//NOTE: links and inbound-links are very similar to link-reference, but whereas those are TODO_TYPE_NA, these are TODO_TYPE_AUTO
	'links': [defaultCardFilterName('links'), (card : Card) => references(card).linksArray().length > 0, TODO_TYPE_AUTO_CONTENT, 1.0, 'Whether the card links out to other cards'],
	'inbound-links': [defaultCardFilterName('inbound-links'), (card : Card) => references(card).inboundLinksArray().length > 0, TODO_TYPE_AUTO_CONTENT, 2.0, 'Whether the card has other cards that link to it'],
	'reciprocal-links': [['has-all-reciprocal-links', 'missing-reciprocal-links', 'does-not-need-reciprocal-links', 'needs-reciprocal-links'], (card : Card) => cardMissingReciprocalLinks(card).length == 0, TODO_TYPE_AUTO_CONTENT, 1.0, 'Whether every inbound link has a matching outbound link'],
	'tags': [defaultCardFilterName('tags'), (card : Card) => card.tags && card.tags.length > 0, TODO_TYPE_AUTO_CONTENT, 1.0, 'Whether the card has any tags'],
	'published': [['published', 'unpublished', 'does-not-need-to-be-published', 'needs-to-be-published'], (card : Card) => card.published, TODO_TYPE_AUTO_CONTENT, 0.5, 'Whether the card is published'],
	//The following TODO types will never be automatically applied, because their test function always returns false, but they can be manually applied.
	'prose': [defaultCardFilterName('prose'), () => true, TODO_TYPE_AUTO_CONTENT, 0.5, 'Whether the card has manually been marked as needing to be turned into flowing prose, as opposed to disjoint details'],
	'citations': [defaultCardFilterName('citations'), () => true, TODO_TYPE_AUTO_CONTENT, 0.3, 'Whether the card has citations that need to be formally represented'],
	'diagram': [defaultCardFilterName('diagram'), () => true, TODO_TYPE_AUTO_CONTENT, 0.8, 'Whether the card needs diagrams to be created or modified'],
	//Being a priority is considered an extra TODO; not being prioritized is considered to have that TODO done.
	//Because it always returns true, the latter two filter-names are what you actually want to use to filter.
	'prioritized': [['not-automatically-prioritized', 'automatically-prioritized', 'not-prioritized', 'prioritized'], () => true, TODO_TYPE_AUTO_CONTENT, 0.1, 'Whether the card is marked as a priority to develop, because it talks about important topics. Kind of like a star for an author to prioritize it.'],
	//Mined is always flagged on cards that it might be autoapplied to. The only way to make it go away is to add a true to the auto_todo_overrides for it.
	//To find cards that are _partially_ mined, use the 'has-inbound-mined-from-references/not-mined' filters.
	'content-mined': [['mined-for-content', 'not-mined-for-content', 'does-not-need-to-be-mined-for-content', 'needs-to-be-mined-for-content'], () => false, TODO_TYPE_AUTO_WORKING_NOTES, 2.0, 'Whether the card has had its insights \'mined\' into other cards. Only automatically applied to working-notes cards. The only way to clear it is to add a force TODO disable for it'],
};

const CARD_FILTER_FREEFORM_TODO_CONFIGS : CardFilterConfigMapFreeformTODO = {
	//TODO_COMBINED_FILTERS looks for the fourth key in the filtername array, so
	//we just duplicate the first two since they're the same (the reason they'd
	//differ is if there's an override key and that could make the has- and
	//needs- filters be different, and there isn't.)
	'freeform-todo': [['no-freeform-todo', 'has-freeform-todo', 'no-freeform-todo', 'has-freeform-todo'], (card : Card) => !cardHasTodo(card), TODO_TYPE_FREEFORM, 1.0, 'Whether the card has any text in its freeform TODO field']
};

const CARD_FILTER_NON_TODO_CONFIGS : CardFilterConfigMapNonTODO = {
	//Now all non-auto TODOs.
	'comments': [defaultCardFilterName('comments'), (card : Card) => card.thread_count > 0, TODO_TYPE_NA, 0.0, 'Whether the card has comments'],
	'notes': [defaultCardFilterName('notes'), (card : Card) => cardHasNotes(card), TODO_TYPE_NA, 0.0, 'Whether the card has notes'],
	'images': [defaultCardFilterName('images'), (card : Card) => card && card.images && card.images.length > 0, TODO_TYPE_NA, 0.0, 'Whether the card has images'],
	'orphaned': [defaultNonTodoCardFilterName('orphaned'), (card : Card) => !card.section, TODO_TYPE_NA, 0.0, 'Whether the card is part of a section or not'],		
	'tweet': [defaultCardFilterName('tweet'), (card : Card) => card.tweet_count > 0, TODO_TYPE_NA, 0.0, 'Whether the card has any tweets from the bot'],
	[setName('everything')]: [defaultNonTodoCardFilterName(SET_INFOS['everything'].filterEquivalent), () => true, TODO_TYPE_NA, 0.0, 'Every card is in the everything set'],
	//note: a number of things rely on `has-body` filter which is derived from this configuration
	'body': [defaultCardFilterName('body'), (card : Card) => card && BODY_CARD_TYPES[card.card_type], TODO_TYPE_NA, 0.0, 'Cards that are of a type that has a body field'],
	'substantive-references': [defaultCardFilterName('substantive-references'), (card : Card) => references(card).substantiveArray().length > 0, TODO_TYPE_NA, 0.0, 'Whether the card has any substantive references of any type'],
	'inbound-substantive-references': [defaultCardFilterName('inbound-substantive-references'), (card : Card) => references(card).inboundSubstantiveArray().length > 0, TODO_TYPE_NA, 0.0, 'Whether the card has any substantive inbound references of any type'],
	'concept-references': [defaultCardFilterName('concept-references'), (card : Card) => references(card).typeClassArray('concept').length > 0, TODO_TYPE_NA, 0.0, 'Whether the card has any concept references of any type'],
	'inbound-concept-references': [defaultCardFilterName('inbound-concept-references'), (card : Card) => references(card).inboundTypeClassArray('concept').length > 0, TODO_TYPE_NA, 0.0, 'Whether the card has any concept inbound references of any type']
};

//Card filters are filters that can tell if a given card is in it given only the
//card object itself. They're so common that in order to reduce extra machinery
//they're factored into a single config here and all of the other machinery uses
//it (and extends with non-card-filter-types as appropriate). The keys of each
//config object are used as the keys in card.auto_todo_overrides map.
const CARD_FILTER_CONFIGS : CardFilterConfigMap = Object.assign(
	/*
		Tuple of:
		0) good/bad filtername (good is primary), including no-todo/todo version if applicable, 
		1) then the card->in-filter test (true is the 'done' state for TODOs),
		2) then one of the TODO_TYPE enum values,
		3) then how bad they are in terms of TODO weight if it's a TODO, 
		4) then a description of what the TODO means.
	*/
	CARD_FILTER_AUTO_TODO_CONFIGS,
	CARD_FILTER_FREEFORM_TODO_CONFIGS,
	CARD_FILTER_NON_TODO_CONFIGS,
	CARD_FILTER_CONFIGS_FOR_TYPE,
	CARD_FILTER_CONFIGS_FOR_REFERENCES,
	CARD_FILTER_CONFIGS_FOR_REFERENCES_INBOUND
);


//REVERSE_CARD_FILTER_CXONFIG_MAP maps the filter names, e.g. 'has-links',
//'needs-links', 'does-not-need-links' to 'links'. Need to use a function
//literal not an arrow func because arrow funcs don't close over and we need
//entry[0].
export const REVERSE_CARD_FILTER_CONFIG_MAP = Object.fromEntries(Object.entries(CARD_FILTER_CONFIGS).map(entry => entry[1][0].map(function(filterNameListItem) {return [filterNameListItem, entry[0]];})).flat(1));


//TODO_ALL_INFOS is TODO_INFOS but also with an entry for FREEFORM_TODO_KEY. Use
//TODO_INFOS for any tag-list in editing mode as the FREEFORM_TODO_KEY isn't a
//valid key to set inoverrides; this is useful for the case where we want to
//non-editing show auto-todos.
export const TODO_ALL_INFOS = Object.fromEntries(Object.entries(CARD_FILTER_CONFIGS).filter(entry => entry[1][2].isTODO).map(entry => [entry[0], {id: entry[0], suppressLink: true, description: entry[1][4], title: toTitleCase(entry[0].split('-').join(' '))}]));

//TODO_INFOS are appropriate to pass into tag-list.tagInfos as options to enable or disable.
export const TODO_AUTO_INFOS = Object.fromEntries(Object.entries(TODO_ALL_INFOS).filter(entry => CARD_FILTER_CONFIGS[entry[0]][2].autoApply));

const TODO_DIFFICULTY_MAP = Object.fromEntries(Object.entries(CARD_FILTER_CONFIGS).map(entry => [entry[0], entry[1][3]]));
const MAX_TOTAL_TODO_DIFFICULTY = Object.entries(TODO_DIFFICULTY_MAP).map(entry => entry[1]).reduce((prev, curr) => prev + curr, 0.0);

//cardTODOConfigKeys returns the card filter keys (which index into for example
//TODO_INFOS) representing the todos that are active for this card--that is, the
//TODOs that are NOT marked done. If onlyNonOverrides is true, then it will skip
//any keys that are only true (not done) because they're overridden to be marked
//as not done.
export const cardTODOConfigKeys = (card : Card, onlyNonOverrides  = false) : TODOType[] => {
	//TODO: this ideally should be in util.js (with the other cardHasContent
	//functions), but because of entanglement of constants this has to live next
	//to these constants.
	if (!card) return [];

	const result : TODOType[] = [];

	for (const configKey of Object.keys(CARD_FILTER_CONFIGS)) {
		const config = CARD_FILTER_CONFIGS[configKey];
		const todoConfig = config[2];
		if (!todoConfig.isTODO) continue;
		const todoKey = todoType.parse(configKey);
		//No matter what, if the override is set to 'done' then the TODO isn't active.
		const autoTODOKeyResult = autoTODOType.safeParse(todoKey);
		if (autoTODOKeyResult.success) {
			const autoTODOKey = autoTODOKeyResult.data;
			if (card.auto_todo_overrides[autoTODOKey] === true) continue;
			if (!onlyNonOverrides && card.auto_todo_overrides[autoTODOKey] === false) {
				result.push(autoTODOKey);
				continue;
			}
		}
		if (todoConfig.autoApply && !cardMayHaveAutoTODO(card, todoConfig)) continue;
		const todoDone = config[1](card);
		if (!todoDone) {
			result.push(todoKey);
		}
	}
	return result;
};

//Theser are filters who are the inverse of another, smaller set. Instead of
//creating a whole set of "all cards minus those", we keep track of them as
//exclude sets.
export const INVERSE_FILTER_NAMES = Object.assign(
	{
		'unstarred': 'starred',
		'unread': 'read',
		[ALL_FILTER_NAME]: NONE_FILTER_NAME,
		[TODO_COMBINED_INVERSE_FILTER_NAME]: TODO_COMBINED_FILTER_NAME,
	},
	Object.fromEntries(Object.entries(SET_INFOS).map(entry => ['not-' + entry[1].filterEquivalent, entry[1].filterEquivalent])),
	//extend with ones for all of the card filters badsed on that config
	Object.fromEntries(Object.entries(CARD_FILTER_CONFIGS).map(entry => [entry[1][0][1], entry[1][0][0]])),
	//Add the inverse need filters (skipping ones htat are not a TODO)
	Object.fromEntries(Object.entries(CARD_FILTER_CONFIGS).filter(entry => entry[1][2].autoApply).map(entry => [entry[1][0][3], entry[1][0][2]]))
);

const makeDoesNotNeedFunc = (baseFunc : CardTestFunc, overrideKeyName : AutoTODOType) : CardTestFunc => {
	return function(card) {
		if (card.auto_todo_overrides[overrideKeyName] === true) return true;
		if (card.auto_todo_overrides[overrideKeyName] === false) return false;
		return baseFunc(card);
	};
};

const DOES_NOT_NEED_FILTER_FUNCS = Object.fromEntries(Object.entries(CARD_FILTER_CONFIGS).filter(entry => entry[1][2].autoApply).map(entry => [entry[1][0][2], {func: makeDoesNotNeedFunc(entry[1][1], REVERSE_CARD_FILTER_CONFIG_MAP[entry[1][0][2]]), description: 'Does not need ' + entry[1][4]}]));

const FREEFORM_TODO_FUNC = CARD_FILTER_FREEFORM_TODO_CONFIGS['freeform-todo'][1];

const COMBINED_TODO_FUNCS = [FREEFORM_TODO_FUNC, ...Object.values(DOES_NOT_NEED_FILTER_FUNCS).map(obj => obj.func)];

const combinedTodoFunc = (card : Card) : boolean => {
	//The funcs return true when it's 'done' (no todo). So if all of them return
	//true, we don't have any TODOs, whereas if any of them return false we do
	//have at least one todo.
	return !COMBINED_TODO_FUNCS.every(func => func(card));
};

export const CARD_FILTER_FUNCS : {[name : string]: {func: CardTestFunc, description: string}} = Object.assign(
	//The main filter names
	Object.fromEntries(Object.entries(CARD_FILTER_CONFIGS).map(entry => [entry[1][0][0], {func: entry[1][1], description: entry[1][4]}])),
	//does-not-need filters for TODOs
	DOES_NOT_NEED_FILTER_FUNCS,
	//combined filter func
	{
		[TODO_COMBINED_FILTER_NAME]: {
			func: combinedTodoFunc,
			description: 'Whether the card has any TODO',
		}
	},
);

const CARD_NON_INVERTED_FILTER_DESCRIPTIONS = Object.assign(
	Object.fromEntries(Object.entries(CARD_FILTER_FUNCS).map(entry => [entry[0], entry[1].description])),
	{
		'starred': 'Cards that you have starred',
		[NONE_FILTER_NAME]: 'Matches no cards',
		'read': 'Cards that you have read',
	},
	Object.fromEntries(Object.entries(SET_INFOS).map(entry => [entry[1].filterEquivalent, 'A filter equivalent of the set ' + entry[0]])),
	Object.fromEntries(Object.entries(CONFIGURABLE_FILTER_INFO).map(entry => [entry[0], entry[1].description])),
);

export const CARD_FILTER_DESCRIPTIONS = Object.assign(
	CARD_NON_INVERTED_FILTER_DESCRIPTIONS,
	Object.fromEntries(Object.entries(INVERSE_FILTER_NAMES).map(entry => [entry[0], 'Inverse of ' + entry[1]]))
);

//We pull this out because it has to be the same in filters and filtersSnapshot
//and to avoid having to duplicate it.
const INITIAL_STATE_FILTERS = Object.assign(
	{
		//None will match nothing. We use it for orphans.
		[NONE_FILTER_NAME]: {},
		starred: {},
		read: {},
	},
	Object.fromEntries(Object.entries(SET_INFOS).map(entry => [entry[1].filterEquivalent, {}])),
	//note: `in-everything-set` will be included in the above set and this next
	//one, but that's OK, they'll both be the same.
	Object.fromEntries(Object.entries(CARD_FILTER_FUNCS).map(entry => [entry[0], {}])),
);

export const INITIAL_STATE : CollectionState = {
	activeSetName: 'main',
	activeFilterNames: [],
	activeSortName: 'default',
	activeSortReversed: false,
	activeViewMode: 'list',
	activeViewModeExtra: '',
	filters: INITIAL_STATE_FILTERS,
	filtersSnapshot: INITIAL_STATE_FILTERS,
	requestedCard: '',
	activeCardId: '',
	randomSalt: randomString(16),
	activeRenderOffset: 0,
};
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
} from './util.js';

import {
	tweetOrderExtractor,
} from './tweet-helpers.js';

import {
	CARD_TYPE_CONTENT,
	CARD_TYPE_CONFIGURATION,
	BODY_CARD_TYPES,
	REFERENCE_TYPES,
	references
} from './card_fields.js';

import {
	PreparedQuery
} from './nlp.js';

export const DEFAULT_SET_NAME = 'main';
//reading-list is a set (as well as filters, e.g. `in-reading-list`) since the
//order matters and is customizable by the user. Every other collection starts
//from the `all` set and then filters and then maybe sorts, but reading-list
//lets a custom order.
export const READING_LIST_SET_NAME = 'reading-list';
export const EVERYTHING_SET_NAME = 'everything';

//Note: every time you add a new set name, add it here too and make sure that a
//filter of that name is kept updated.
export const FILTER_EQUIVALENTS_FOR_SET = {
	[DEFAULT_SET_NAME]: 'in-all-set',
	[READING_LIST_SET_NAME]: 'in-reading-list',
	[EVERYTHING_SET_NAME]: 'in-everything-set'
};

//If filter names have this character in them then they're actually a union of
//the filters
export const UNION_FILTER_DELIMITER = '+';

export const SET_NAMES = Object.entries(FILTER_EQUIVALENTS_FOR_SET).map(entry => entry[0]);

//The word in the URL That means "the part after this is a sort".
export const SORT_URL_KEYWORD = 'sort';
export const SORT_REVERSED_URL_KEYWORD = 'reverse';

export const DEFAULT_SORT_NAME = 'default';
export const RECENT_SORT_NAME = 'recent';

const makeDateConfigurableFilter = (propName, comparisonType, firstDateStr, secondDateStr) => {

	if (propName == UPDATED_FILTER_NAME) propName = 'updated_substantive';
	if (propName == LAST_TWEETED_FILTER_NAME) propName = 'last_tweeted';
	const firstDate = firstDateStr ? new Date(firstDateStr) : null;
	const secondDate = secondDateStr ? new Date(secondDateStr) : null;

	switch (comparisonType) {
	case BEFORE_FILTER_NAME:
		return function(card) {
			const val = card[propName];
			if (!val) return false;
			const difference = val.toMillis() - firstDate.getTime();
			return difference < 0;
		};
	case AFTER_FILTER_NAME:
		return function(card) {
			const val = card[propName];
			if (!val) return false;
			const difference = val.toMillis() - firstDate.getTime();
			return difference > 0;
		};
	case BETWEEN_FILTER_NAME:
		//Bail if the second date isn't provided
		if (!secondDate) return () => false;
		return function(card) {
			const val = card[propName];
			if (!val) return false;
			const firstDifference = val.toMillis() - firstDate.getTime();
			const secondDifference = val.toMillis() - secondDate.getTime();
			return (firstDifference > 0 && secondDifference < 0) || (firstDifference < 0 && secondDifference > 0) ;
		};
	default:
		return () => false;
	}
};

const unionSet = (...sets) => {
	let result = {};
	for (let set of sets) {
		if (!set) continue;
		for (let key of Object.keys(set)) {
			result[key] = set[key];
		}
	}
	return result;
};

const INCLUDE_KEY_CARD_PREFIX = '+';

const makeCardLinksConfigurableFilter = (filterName, cardID, countStr) => {
	const isInbound = filterName == PARENTS_FILTER_NAME || filterName == ANCESTORS_FILTER_NAME;
	const twoWay = filterName == DIRECT_CONNECTIONS_FILTER_NAME || filterName == CONNECTIONS_FILTER_NAME;
	if (filterName == CHILDREN_FILTER_NAME || filterName == PARENTS_FILTER_NAME || filterName == DIRECT_CONNECTIONS_FILTER_NAME) countStr = '1';
	let count = parseInt(countStr);
	if (isNaN(count)) count = 1;
	if (!cardID) cardID = '';

	let includeKeyCard = false;
	if (cardID.startsWith(INCLUDE_KEY_CARD_PREFIX)) {
		includeKeyCard = true;
		cardID = cardID.substring(INCLUDE_KEY_CARD_PREFIX.length);
	}

	//We have to memoize the functor we return, even though the filter machinery
	//will memoize too, because otherwise literally every card in a given run
	//will have a NEW BFS done. So memoize as long as cards are the same.
	let memoizedCardsLastSeen = null;
	let memoizedMap = null;

	return function(card, cards) {
		if (cards != memoizedCardsLastSeen) memoizedMap = null;
		if (!memoizedMap) {
			if (twoWay){
				const bfsForOutbound = cardBFS(cardID, cards, count, includeKeyCard, false);
				const bfsForInbound = Object.fromEntries(Object.entries(cardBFS(cardID, cards, count, includeKeyCard, true)).map(entry => [entry[0], entry[1] * -1]));
				//inbound might have a -0 in it, so have outbound be second so we get just the zero
				memoizedMap = unionSet(bfsForInbound,bfsForOutbound);
			} else {
				memoizedMap = cardBFS(cardID, cards, count, includeKeyCard, isInbound);
			}
			memoizedCardsLastSeen = cards;
		}
		let val = memoizedMap[card.id];
		//Return the degree of separation so it's available to sort on
		return [val !== undefined, val];
	};

};

const makeExcludeConfigurableFilter = (filterName, idString) => {
	//ids can be a single id or slug, or a conjunction of them delimited by '+'
	const idsToMatch = Object.fromEntries(idString.split(INCLUDE_KEY_CARD_PREFIX).map(id => [id, true]));

	//TODO: only calculate the slug --> id once so subsequent matches can be done with one lookup
	return function(card) {
		if (idsToMatch[card.id]) return false;
		if (!card.slugs) return true;
		for (let slug of card.slugs) {
			if (idsToMatch[slug]) return false;
		}
		return true;
	};
};

const makeQueryConfigurableFilter = (filterName, rawQueryString) => {

	//TODO: also de-url encode?
	const decodedQueryString = rawQueryString.split('+').join(' ');

	const query = new PreparedQuery(decodedQueryString);

	return function(card) {
		const [score, partialMatch] = query.cardScore(card);
		return [score > 0.0, score, partialMatch];
	};
};

//Fallback configurable filter
const makeNoOpConfigurableFilter = () => {
	return () => true;
};

const UPDATED_FILTER_NAME = 'updated';
const LAST_TWEETED_FILTER_NAME = 'last-tweeted';
const BEFORE_FILTER_NAME = 'before';
const AFTER_FILTER_NAME = 'after';
const BETWEEN_FILTER_NAME = 'between';
const DIRECT_CONNECTIONS_FILTER_NAME = 'direct-connections';
const CONNECTIONS_FILTER_NAME = 'connections';
const CHILDREN_FILTER_NAME = 'children';
const DESCENDANTS_FILTER_NAME = 'descendants';
const PARENTS_FILTER_NAME = 'parents';
const ANCESTORS_FILTER_NAME = 'ancestors';
const EXCLUDE_FILTER_NAME = 'exclude';
const QUERY_FILTER_NAME = 'query';

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
	[EXCLUDE_FILTER_NAME]: 1,
	[QUERY_FILTER_NAME]: 1,
};

//the factories should return a filter func that takes the card to opeate on,
//then cards. The function should return either true/false, or, if wants to make
//values available for later sorts in sortExtras, it can emit an array [matches,
//sortValue] where matches is a boolean and sortValue is the value to pass into
//sortExtras for that card. It can also emit a [matches, sortValue,
//partialMatch], where partialMatch denotes the item should be ghosted. If the
//filter emits sortExtras, then it should also define a labelName.
const CONFIGURABLE_FILTER_INFO = {
	[UPDATED_FILTER_NAME]: {
		factory: makeDateConfigurableFilter,
	},
	[LAST_TWEETED_FILTER_NAME]: {
		factory: makeDateConfigurableFilter,
	},
	[CHILDREN_FILTER_NAME]: {
		factory: makeCardLinksConfigurableFilter,
		labelName: 'Degree',
		flipOrder: true,
	},
	[DESCENDANTS_FILTER_NAME]: {
		factory: makeCardLinksConfigurableFilter,
		labelName: 'Degree',
		flipOrder: true,
	},
	[PARENTS_FILTER_NAME]: {
		factory: makeCardLinksConfigurableFilter,
		labelName: 'Degree',
		flipOrder: true,
	},
	[ANCESTORS_FILTER_NAME]: {
		factory: makeCardLinksConfigurableFilter,
		labelName: 'Degree',
		flipOrder: true,
	},
	[DIRECT_CONNECTIONS_FILTER_NAME]: {
		factory: makeCardLinksConfigurableFilter,
		labelName: 'Degree',
		flipOrder: true,
	},
	[CONNECTIONS_FILTER_NAME]: {
		factory: makeCardLinksConfigurableFilter,
		labelName: 'Degree',
		flipOrder: true,
	},
	[EXCLUDE_FILTER_NAME]: {
		factory: makeExcludeConfigurableFilter,
	},
	[QUERY_FILTER_NAME]: {
		factory: makeQueryConfigurableFilter,
		labelName: 'Score',
		suppressLabels: true,
	},
};

//The configurable filters that are allowed to start a multi-part filter.
export const CONFIGURABLE_FILTER_NAMES = Object.fromEntries(Object.entries(CONFIGURABLE_FILTER_INFO).map(entry => [entry[0], true]));

let memoizedConfigurableFilters = {};

export const makeConfigurableFilter = (name) => {
	if (!memoizedConfigurableFilters[name]) {
		const parts = name.split('/');
		const func = CONFIGURABLE_FILTER_INFO[parts[0]].factory || makeNoOpConfigurableFilter;
		memoizedConfigurableFilters[name] = func(...parts);
	}
	return memoizedConfigurableFilters[name];
};

const sectionNameForCard = (card, sections) => {
	let section = sections[card.section];
	return section ? section.title : '';
};

//The sale for the random sort, which should stay the same within a session (so
//the sort order doesn't change randomly) but be different across sessions.
const RANDOM_SALT = randomString(16);

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
//called ascending and toggle that.
export const SORTS = {
	//Default sort is a no-op, unless a configurable filter was used that emits
	//sortValues, in which case it uses those. Note that
	//collection._makeSortedCards has logic tailored to this to know when it can
	//bail out early
	[DEFAULT_SORT_NAME]: {
		extractor: (card, sections, cards, sortExtra) => {
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
			const result = [config.flipOrder ? value * -1 : value, config.suppressLabels ? '' : value];
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
		}
	},
	'original-order': {
		extractor: (card, sections) => [0, sectionNameForCard(card, sections)],
		description: 'The default order of the cards within each section in order',
		labelName: 'Section',
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
	'stars': {
		extractor: (card) => [card.star_count || 0, '' + card.star_count],
		description: 'In descending order by number of stars',
		labelName: 'Stars',
	},
	'commented': {
		extractor: (card) => {
			const timestamp = card.updated_message;
			return [timestamp ? timestamp.seconds : 0, prettyTime(timestamp)];
		},
		description: 'In descending order by when each card last had a new message',
		labelName: 'Commented',
	},
	[RECENT_SORT_NAME]: {
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
		extractor: tweetOrderExtractor,
		description: 'In descending order of the ones that are most deserving of a tweet',
		labelName: 'Tweet Worthiness',
	},
	'todo-difficulty': {
		extractor: (card) => {
			const result = MAX_TOTAL_TODO_DIFFICULTY - cardTodoConfigKeys(card).map(key => TODO_DIFFICULTY_MAP[key]).reduce((prev, curr) => prev + curr, 0.0);
			return [result, '' + result];
		},
		description: 'In ascending order of how difficult remaining TODOs are',
		labelName: 'TODO Difficulty'
	},
	'random': {
		extractor: (card) => {
			return [hash(card.id + RANDOM_SALT), ''];
		},
		description: 'A random order',
		labelName: 'Random Order'
	},
	'card-rank': {
		extractor: (card, sections, cards) => {
			//This is memoized so as long as cards is the same it won't be re-run.
			let ranks = pageRank(cards);
			let rank = ranks[card.id] || 0.0;
			return [rank, '' + Math.round(rank * 100000)];
		},
		description: 'Ranked by card rank (like page rank but for cards)',
		labelName: 'Rank',
	}
};

const defaultCardFilterName = (basename) => {
	return ['has-' + basename, 'no-' + basename, 'does-not-need-' + basename, 'needs-' + basename];
};

const defaultNonTodoCardFilterName = (basename) => {
	return [basename, 'not-' + basename, basename, 'not-' + basename];
};

const FREEFORM_TODO_KEY = 'freeform-todo';
export const TODO_COMBINED_FILTER_NAME = 'has-todo';
const TODO_COMBINED_INVERSE_FILTER_NAME = 'no-todo';

const cardMayHaveAutoTODO = card => {
	return card && card.card_type == CARD_TYPE_CONTENT;
};

//These are the enum values in CARD_FILTER_CONFIGS that configure whether an
//item is a TODO or not.

//TODO_TYPE_NA is for card filters that are not TODOs
const TODO_TYPE_NA = {
	type: 'na',
	isTODO: false,
};
//TODO_TYPE_AUTO is for card filters that are TODOs and are auto-set, meaning that
//their key is legal in auto_todo_overrides.
const TODO_TYPE_AUTO = {
	type: 'auto',
	isTODO: true,
};

//TODO_TYPE_FREEFORM is for card filters that are TODOs but are set via the freeform
//notes property and are not valid keys in auto_todo_overrides.
const TODO_TYPE_FREEFORM = {
	type: 'freeform',
	isTODO: true,
};

//Card filters are filters that can tell if a given card is in it given only the
//card object itself. They're so common that in order to reduce extra machinery
//they're factored into a single config here and all of the other machinery uses
//it (and extends with non-card-filter-types as appropriate). The keys of each
//config object are used as the keys in card.auto_todo_overrides map.
const CARD_FILTER_CONFIGS = Object.assign(
	//tuple of good/bad filtername (good is primary), including no-todo/todo version if applicable, then the card->in-filter test, then one of the TODO_TYPE enum values, then how bad they are in terms of TODO weight, then a description of what the TODO means.
	{
		'comments': [defaultCardFilterName('comments'), card => card.thread_count, TODO_TYPE_NA, 0.0, 'Whether the card has comments'],
		'notes': [defaultCardFilterName('notes'), card => cardHasNotes(card), TODO_TYPE_NA, 0.0, 'Whether the card has notes'],
		'orphaned': [defaultNonTodoCardFilterName('orphaned'), card => !card.section, TODO_TYPE_NA, 0.0, 'Whether the card is part of a section or not'],
		'slug': [defaultCardFilterName('slug'), card => card.slugs && card.slugs.length, TODO_TYPE_AUTO, 0.2, 'Whether the card has a slug set'],
		'content': [defaultCardFilterName('content'), card => cardHasContent(card), TODO_TYPE_AUTO, 5.0, 'Whether the card has any content whatsoever'],
		'substantive-content': [defaultCardFilterName('substantive-content'), card => cardHasSubstantiveContent(card), TODO_TYPE_AUTO, 3.0, 'Whether the card has more than a reasonable minimum amount of content'],
		//NOTE: links and inbound-links are very similar to link-reference, but whereas those are TODO_TYPE_NA, these are TODO_TYPE_AUTO
		'links': [defaultCardFilterName('links'), card => references(card).linksArray().length, TODO_TYPE_AUTO, 1.0, 'Whether the card links out to other cards'],
		'inbound-links': [defaultCardFilterName('inbound-links'), card => references(card).inboundLinksArray().length, TODO_TYPE_AUTO, 2.0, 'Whether the card has other cards that link to it'],
		'reciprocal-links': [['has-all-reciprocal-links', 'missing-reciprocal-links', 'does-not-need-reciprocal-links', 'needs-reciprocal-links'], card => cardMissingReciprocalLinks(card).length == 0, TODO_TYPE_AUTO, 1.0, 'Whether every inbound link has a matching outbound link'],
		'tags': [defaultCardFilterName('tags'), card => card.tags && card.tags.length, TODO_TYPE_AUTO, 1.0, 'Whether the card has any tags'],
		'published': [['published', 'unpublished', 'does-not-need-to-be-published', 'needs-to-be-published'], card => card.published, TODO_TYPE_AUTO, 0.5, 'Whether the card is published'],
		'tweet': [defaultCardFilterName('tweet'), card => card.tweet_count > 0, TODO_TYPE_NA, 0.0, 'Whether the card has any tweets from the bot'],
		//The following TODO types will never be automatically applied, because their test function always returns false, but they can be manually applied.
		'prose': [defaultCardFilterName('prose'), () => true, TODO_TYPE_AUTO, 0.5, 'Whether the card has manually been marked as needing to be turned into flowing prose, as opposed to disjoint details'],
		'citations': [defaultCardFilterName('citations'), () => true, TODO_TYPE_AUTO, 0.3, 'Whether the card has citations that need to be formally represented'],
		[EVERYTHING_SET_NAME]: [defaultNonTodoCardFilterName(FILTER_EQUIVALENTS_FOR_SET[EVERYTHING_SET_NAME]), () => true, TODO_TYPE_NA, 0.0, 'Every card is in the everything set'],
		'body': [defaultCardFilterName('body'), card => card && BODY_CARD_TYPES[card.card_type], TODO_TYPE_NA, 0.0, 'Cards that are of a type that has a body field'],
		'substantive-references': [defaultCardFilterName('substantive-references'), card => references(card).substantiveArray().length, TODO_TYPE_NA, 0.0, 'Whether the card has any substantive references of any type'],
		'inbound-substantive-references': [defaultCardFilterName('inbound-substantive-references'), card => references(card).inboundSubstantiveArray().length, TODO_TYPE_NA, 0.0, 'Whether the card has any substantive inbound references of any type'],
		//TODO_COMBINED_FILTERS looks for the fourth key in the filtername array, so
		//we just duplicate the first two since they're the same (the reason they'd
		//differ is if there's an override key and that could make the has- and
		//needs- filters be different, and there isn't.)
		[FREEFORM_TODO_KEY]: [['no-freeform-todo', 'has-freeform-todo', 'no-freeform-todo', 'has-freeform-todo'], card => !cardHasTodo(card), TODO_TYPE_FREEFORM, 1.0, 'Whether the card has any text in its freeform TODO field'],
	},
	Object.fromEntries(Object.keys(CARD_TYPE_CONFIGURATION).map(function(cardType){return [cardType, [defaultNonTodoCardFilterName(cardType), card => card.card_type == cardType, TODO_TYPE_NA, 0.0, 'Card that is of ' + cardType + ' type.']];})),
	Object.fromEntries(Object.keys(REFERENCE_TYPES).map(key => [key, [defaultCardFilterName(key + '-references'), card => references(card).byType[key], TODO_TYPE_NA, 0.0, 'Whether the card has any references of type ' + key]])),
	Object.fromEntries(Object.keys(REFERENCE_TYPES).map(key => ['inbound-' + key, [defaultCardFilterName('inbound-' + key + '-references'), card => references(card).byTypeInbound[key], TODO_TYPE_NA, 0.0, 'Whether the card has any inbound references of type ' + key]])),
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
export const TODO_AUTO_INFOS = Object.fromEntries(Object.entries(TODO_ALL_INFOS).filter(entry => CARD_FILTER_CONFIGS[entry[0]][2] == TODO_TYPE_AUTO));

//TODO_CONFIG_KEYS is all of the keys into CARD_FILTER_CONFIG that represent the
//set of items that count as a TODO.
const TODO_CONFIG_KEYS = Object.fromEntries(Object.entries(CARD_FILTER_CONFIGS).filter(entry => entry[1][2].isTODO).map(entry => [entry[0], true]));

//TODO_OVERRIDE_LEGAL_KEYS reflects the only keys that are legal to set in card.auto_todo_overrides
export const TODO_OVERRIDE_LEGAL_KEYS = Object.fromEntries(Object.entries(TODO_CONFIG_KEYS).filter(entry => CARD_FILTER_CONFIGS[entry[0]][2] == TODO_TYPE_AUTO));

const TODO_DIFFICULTY_MAP = Object.fromEntries(Object.entries(CARD_FILTER_CONFIGS).map(entry => [entry[0], entry[1][3]]));
const MAX_TOTAL_TODO_DIFFICULTY = Object.entries(TODO_DIFFICULTY_MAP).map(entry => entry[1]).reduce((prev, curr) => prev + curr, 0.0);

//cardTodoConfigKeys returns the card filter keys (which index into for example
//TODO_INFOS) representing the todos that are active for this card. If
//onlyNonOverrides is true, then it will skip any keys that are only true because
//they're overridden to true.
export const cardTodoConfigKeys = (card, onlyNonOverrides) => {
	//TODO: this ideally should be in util.js (with the other cardHasContent
	//functions), but because of entanglement of constants this has to live next
	//to these constants.
	if (!card) return [];

	let result = [];

	for (let configKey of Object.keys(CARD_FILTER_CONFIGS)) {
		const config = CARD_FILTER_CONFIGS[configKey];
		if (!config[2].isTODO) continue;
		if (config[2] == TODO_TYPE_AUTO) {
			if (!cardMayHaveAutoTODO(card)) continue;
			if (card.auto_todo_overrides[configKey] === false) continue;
		}
		const done = config[1](card);
		if (!done || (!onlyNonOverrides && card.auto_todo_overrides[configKey] === true)) {
			result.push(configKey);
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
		[TODO_COMBINED_INVERSE_FILTER_NAME]: TODO_COMBINED_FILTER_NAME,
	},
	Object.fromEntries(Object.entries(FILTER_EQUIVALENTS_FOR_SET).map(entry => ['not-' + entry[1], entry[1]])),
	//extend with ones for all of the card filters badsed on that config
	Object.fromEntries(Object.entries(CARD_FILTER_CONFIGS).map(entry => [entry[1][0][1], entry[1][0][0]])),
	//Add the inverse need filters (skipping ones htat are not a TODO)
	Object.fromEntries(Object.entries(CARD_FILTER_CONFIGS).filter(entry => entry[1][2] == TODO_TYPE_AUTO).map(entry => [entry[1][0][3], entry[1][0][2]]))
);

const makeBasicCardFilterFunc = (baseFunc, todoConfig) => {
	if (todoConfig.isTODO) {
		return function(card) {
			//Cards that can't have auto TODOs are marked as having met the condition.
			//TODO: is this logic right? Shouldn't we just skip all of these?
			if(!cardMayHaveAutoTODO(card)) return true;
			return baseFunc(card);
		};
	}
	//If it's just a normal type of filter, e.g. TODO_NA, then just use the
	//default filter func.
	return baseFunc;
};

const makeDoesNotNeedFunc = (baseFunc, overrideKeyName) => {
	return function(card) {
		if (card.auto_todo_overrides[overrideKeyName] === false) return true;
		if (card.auto_todo_overrides[overrideKeyName] === true) return false;
		return baseFunc(card);
	};
};

const DOES_NOT_NEED_FILTER_FUNCS = Object.fromEntries(Object.entries(CARD_FILTER_CONFIGS).filter(entry => entry[1][2] == TODO_TYPE_AUTO).map(entry => [entry[1][0][2], makeDoesNotNeedFunc(entry[1][1], REVERSE_CARD_FILTER_CONFIG_MAP[entry[1][0][2]])]));

const FREEFORM_TODO_FUNC = CARD_FILTER_CONFIGS[FREEFORM_TODO_KEY][1];

const COMBINED_TODO_FUNCS = [FREEFORM_TODO_FUNC, ...Object.values(DOES_NOT_NEED_FILTER_FUNCS)];

const combinedTodoFunc = (card) => {
	//The funcs return true when it's 'done' (no todo). So if all of them return
	//true, we don't have any TODOs, whereas if any of them return false we do
	//have at least one todo.
	return !COMBINED_TODO_FUNCS.every(func => func(card));
};

export const CARD_FILTER_FUNCS = Object.assign(
	//The main filter names
	Object.fromEntries(Object.entries(CARD_FILTER_CONFIGS).map(entry => [entry[1][0][0], makeBasicCardFilterFunc(entry[1][1], entry[1][2])])),
	//does-not-need filters for TODOs
	DOES_NOT_NEED_FILTER_FUNCS,
	//combined filter func
	{
		[TODO_COMBINED_FILTER_NAME]: combinedTodoFunc,
	},
);

//We pull this out because it has to be the same in filters and pendingFilters
//and to avoid having to duplicate it.
const INITIAL_STATE_FILTERS = Object.assign(
	{
		//None will match nothing. We use it for orphans.
		none: {},
		starred: {},
		read: {},
	},
	Object.fromEntries(Object.entries(FILTER_EQUIVALENTS_FOR_SET).map(entry => [entry[1], {}])),
	//note: `in-everything-set` will be included in the above set and this next
	//one, but that's OK, they'll both be the same.
	Object.fromEntries(Object.entries(CARD_FILTER_FUNCS).map(entry => [entry[0], {}])),
);

export const INITIAL_STATE = {
	activeSetName: DEFAULT_SET_NAME,
	//activeFilterNames is the list of named filters to apply to the default
	//set. These names are either concrete filters, inverse filters, or union
	//filters (i.e. they concatenate conrete or inverse filternames delimited by
	//'+'). For the purposes of processing URLs though they can all be treated
	//as though they're concrete filters named their literal name in this.
	activeFilterNames: [],
	activeSortName: DEFAULT_SORT_NAME,
	activeSortReversed: false,
	//These are the actual values of the filters in current use. We queue up
	//changes in pendingFilters and then synchronize this value to that value
	//when we know it's OK for the collection to change.
	filters: INITIAL_STATE_FILTERS,
	//The things that modify filters actuall modify pendingFilters. Only when we
	//receive a COMMIT_PENDING_COLLECTION_MODIFICATIONS do we copy over the modifications.
	pendingFilters: INITIAL_STATE_FILTERS,
	//requestCard is the identifier specifically requested in the URL. This
	//could be the card's ID, a slug for that card, or a special placeholder
	//like `_`. The fully resolved activeCard is stored in activeCardId.
	requestedCard: '',
	//the fully resolved literal ID of the active card (not slug, not special
	//placeholder).
	activeCardId: '',
};
import {
	RECENT_SORT_NAME,
	READING_LIST_SET_NAME,
	EVERYTHING_SET_NAME
} from './filters.js';

import {
	CollectionDescription
} from './collection_description.js';

import * as icons from './components/my-icons.js';

import {
	CARD_TYPE_WORKING_NOTES,
	CARD_TYPE_CONCEPT
} from './card_fields.js';

export const READING_LIST_FALLBACK_CARD = 'about-reading-lists';
export const STARS_FALLBACK_CARD = 'about-stars';

export const tabConfiguration = (config, sections, tags) => {
	if (!config) config = DEFAULT_CONFIG;
	let array = config;
	let lastArray = [];
	let changesMade = false;
	let count = 0;
	do {
		changesMade = false;
		lastArray = array;
		array = [];
		for (let item of lastArray) {
			const [expandedItems, didExpand] = expandTabConfigItem(item, sections, tags);
			if (didExpand) changesMade = true;
			array = array.concat(...expandedItems);
		}
		count++;
	} while(changesMade && count < 100);
	return inflateCollectionsAndIcons(array);
};

const inflateCollectionsAndIcons = (config) => {
	let result = [];
	for (let item of config) {
		let itemToAdd = {...item};
		if (item.collection && !(item.collection instanceof CollectionDescription)) {
			itemToAdd.collection = CollectionDescription.deserialize(item.collection);
		}
		if (item.icon && typeof item.icon == 'string') {
			itemToAdd.icon = icons[item.icon];
			if (!itemToAdd.icon) {
				console.warn('Invalid icon name: ' + item.icon);
			}
		}
		result.push(itemToAdd);
	}
	return result;
};

/*
Valid fields in config items:
{
	//If set, will expand in line for the named expansion. See src/tabs.js for named expansions.
	//Applies recursively until no expansions remain.
	//Note that 'sections' is a special value that will expand to the current values of sections.
	expand: 'STRING',
	//collection can be either a string that can be deserialized into a CollectionDescription, or an actual 
	//CollectionDescription. It will be expanded to be a CollectionDescription either way.
	collection: 'STRING_OR_COLLECTION,
	//Can be either a string naming an ICON constant in src/components/my-icons.js, or an actual Icon template.
	//If provided, will render that instead of the display_name text.
	icon: 'STRING_OR_ICON_TEMPLATE',
	//The text string to show. Alway used for title of the tab, but also will use if no icon provided.
	display_name: 'STRING',
	//If true, the display_name will be rendered with italics
	italics: true,
	//If true, a count of how many cards are in the collection will be calculated and rendered.
	count: true,
	//If true, will not show the item if the count is 0. count config property must also be true.
	hideIfEmpty: true,
	//If true, the item will not be rendered. This is useful if you want fallback_cards or start_cards 
	//to be available but don't want the tab to show up.
	hide: true,
	//If provided, will show these fallback cards if no real cards match the collection. The strings can be IDs or 
	//slugs for the target cards.
	fallback_cards: [CARD_ID_OR_SLUG, ...]
	//If provided, will show these start cards if the collection being show is precisely the collection described 
	//by this descripton. The strings can be IDS or slugs for the target cards.
	start_cards: [CARD_ID_OR_SLUG, ...]
	//The first item that has default:true will be used as the default collection if the app is loaded without a 
	//collection. The auto sections portion will automatically select at least one item to be default.
	default: true
}
*/

const DEFAULT_CONFIG = [
	{
		expand: 'default_tabs'
	}
];

const EXPANSION_ITEMS = {
	'default_tabs': [
		{
			expand: 'sections',
		},
		{
			expand: 'hidden_tags',
		},
		{
			expand: 'default_end_tabs',
		}
	],
	'default_end_tabs': [
		{
			expand: 'recent'
		},
		{
			expand: 'reading-list'
		},
		{
			expand: 'starred'
		},
		{
			expand: 'unread'
		},
		{
			expand: 'working-notes',
		},
		{
			expand: 'concepts',
		}
	],
	'recent': [
		{
			display_name: 'Recent',
			collection: new CollectionDescription('', ['has-content'], RECENT_SORT_NAME, false),
		}
	],
	'reading-list': [
		{
			icon: icons.PLAYLIST_PLAY_ICON,
			display_name: 'Your reading list',
			collection: new CollectionDescription(READING_LIST_SET_NAME),
			count: true,
			fallback_cards: [READING_LIST_FALLBACK_CARD],
		}
	],
	'starred': [
		{
			icon: icons.STAR_ICON,
			display_name: 'Your starred cards',
			collection: new CollectionDescription('', ['starred']),
			count: true,
			fallback_cards: [STARS_FALLBACK_CARD],
		}
	],
	'unread': [
		{
			icon: icons.VISIBILITY_ICON,
			display_name: 'Cards you haven\'t read yet',
			collection: new CollectionDescription('', ['unread']),
			count: true,
		}
	],
	'working-notes': [
		{
			icon: icons.INSERT_DRIVE_FILE_ICON,
			display_name: 'Working note cards',
			collection: new CollectionDescription(EVERYTHING_SET_NAME, [CARD_TYPE_WORKING_NOTES]),
			count:true,
			hideIfEmpty: true,
		}
	],
	'concepts': [
		{
			icon: icons.MENU_BOOK_ICON,
			display_name: 'Concept cards',
			collection: new CollectionDescription(EVERYTHING_SET_NAME, [CARD_TYPE_CONCEPT]),
			count:true,
			hideIfEmpty: true,
		}
	],
};

const DEFAULT_LOADING_TAB = {
	collection: new CollectionDescription(),
	display_name: 'Loading...',
	italics: true,
};


const tabsForSections = (sections, doHide) => {
	//Only doSelectDefaultIfNonProvided for sections
	if (!doHide) doHide = false;
	if (!sections || Object.keys(sections).length == 0) {
		return [{...DEFAULT_LOADING_TAB, hide:doHide}];
	}

	const result = Object.values(sections).map(section => ({
		display_name: section.title,
		collection: new CollectionDescription('', [section.id]),
		start_cards: section.start_cards,
		hide: doHide,
		default: section.default,
	}));

	return result;
};

const expandTabConfigItem = (configItem, sections, tags) => {
	if (!configItem) return [[configItem], false];

	if (!configItem.expand) return [[configItem], false];

	const configItemWithoutExpand = Object.fromEntries(Object.entries(configItem).filter(entry => entry[0] != 'expand'));

	//We expand the first item (without the expand keyword) first, then the
	//expansion item (once each for each item in the expansion). That means you
	//can set non-default properties, e.g. {expand:'concept', default:true} and
	//have the default:true still exist after expansion.
	if (EXPANSION_ITEMS[configItem.expand]) return [[...EXPANSION_ITEMS[configItem.expand].map(item => ({...configItemWithoutExpand, ...item}))], true];

	if (configItem.expand == 'sections') {
		return [tabsForSections(sections, false), true];
	}
	if (configItem.expand == 'hidden_sections') {
		return [tabsForSections(sections, true), true];
	}
	if (configItem.expand == 'tags') {
		return [tabsForSections(tags), true];
	}
	if (configItem.expand == 'hidden_tags') {
		return [tabsForSections(tags, true), true];
	}

	console.warn('Unknown tabs expansion: ' + configItem.expand);
	return [[], false];
};
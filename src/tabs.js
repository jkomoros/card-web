import {
	RECENT_SORT_NAME,
	READING_LIST_SET_NAME,
} from './filters.js';

import {
	CollectionDescription
} from './collection_description.js';

import * as icons from './components/my-icons.js';

export const READING_LIST_FALLBACK_CARD = 'about-reading-lists';
export const STARS_FALLBACK_CARD = 'about-stars';

export const tabConfiguration = (config, sections) => {
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
			const [expandedItems, didExpand] = expandTabConfigItem(item, sections);
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
	//If provided, will show these fallback cards if no real cards match the collection. The strings can be IDs or 
	//slugs for the target cards.
	fallback_cards: [CARD_ID_OR_SLUG, ...]
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
	]
};

const DEFAULT_LOADING_SECTIONS_TAB = [
	{
		collection: new CollectionDescription(),
		display_name: 'Loading...',
		italics: true,
	}
];

const tabsForSections = (sections) => {
	if (!sections || Object.keys(sections).length == 0) {
		return DEFAULT_LOADING_SECTIONS_TAB;
	}
	return Object.values(sections).map(section => ({
		display_name: section.title,
		collection: new CollectionDescription('', [section.id])
	}));
};

const expandTabConfigItem = (configItem, sections) => {
	if (!configItem) return [[configItem], false];

	if (!configItem.expand) return [[configItem], false];

	if (EXPANSION_ITEMS[configItem.expand]) return [[...EXPANSION_ITEMS[configItem.expand]], true];

	if (configItem.expand == 'sections') {
		return [tabsForSections(sections), true];
	}
	console.warn('Unknown tabs expansion: ' + configItem.expand);
	return [[], false];
};
import {
	RECENT_SORT_NAME,
	READING_LIST_SET_NAME,
} from './filters.js';

import {
	CollectionDescription
} from './collection_description.js';

import * as icons from './components/my-icons.js';

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
			array.concat(...expandedItems);
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
		}
	],
	'starred': [
		{
			icon: icons.STAR_ICON,
			display_name: 'Your starred cards',
			collection: new CollectionDescription('', ['starred']),
			count: true,
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
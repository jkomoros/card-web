import {
	CollectionDescription
} from './collection_description.js';

import * as icons from './components/my-icons.js';

import {
	CARD_TYPE_WORKING_NOTES,
	CARD_TYPE_CONCEPT,
	READING_LIST_SET_NAME,
	EVERYTHING_SET_NAME,
	SORT_NAME_RECENT,
	SORT_NAME_STARS,
	TAB_CONFIG_DEFAULT_TABS,
	TAB_CONFIG_DEFAULT_END_TABS,
	TAB_CONFIG_SECTIONS,
	TAB_CONFIG_HIDDEN_SECTIONS,
	TAB_CONFIG_TAGS,
	TAB_CONFIG_HIDDEN_TAGS,
	TAB_CONFIG_POPULAR,
	TAB_CONFIG_RECENT,
	TAB_CONFIG_READING_LIST,
	TAB_CONFIG_STARRED,
	TAB_CONFIG_UNREAD,
	TAB_CONFIG_WORKING_NOTES,
	TAB_CONFIG_CONCEPTS,
	TAB_CONFIG_TWITTER
} from './type_constants.js';

import {
	TWITTER_HANDLE
} from './config.GENERATED.SECRET.js';

import {
	TabConfigItem,
	TabConfig,
	ExpandedTabConfig,
	ExpandedTabConfigItem,
	Sections,
	TabConfigName,
	TabConfigOverrides
} from './types.js';

export const READING_LIST_FALLBACK_CARD = 'about-reading-lists';
export const STARS_FALLBACK_CARD = 'about-stars';

const DEFAULT_OVERRIDES : TabConfigOverrides = {before: {}, after: {}};

export const tabConfiguration = (config : TabConfig, overrides : TabConfigOverrides, sections : Sections, tags : Sections) : ExpandedTabConfig => {
	if (!config) config = DEFAULT_CONFIG;
	if (!overrides) overrides = DEFAULT_OVERRIDES;
	let array = config;
	let lastArray = [];
	let changesMade = false;
	let count = 0;
	do {
		changesMade = false;
		lastArray = array;
		array = [];
		for (const item of lastArray) {
			const [expandedItems, didExpand] = expandTabConfigItem(tabConfigItem(item), sections, tags);
			if (didExpand) changesMade = true;
			array = array.concat(...expandedItems);
		}
		count++;
	} while(changesMade && count < 100);
	return inflateCollectionsAndIcons(array);
};

const tabConfigItem = (input : TabConfigName | TabConfigItem) : TabConfigItem => {
	return typeof input == 'string' ? {expand: input} : input; 
};

const inflateCollectionsAndIcons = (config : TabConfig) : ExpandedTabConfig => {
	const result = [];
	for (const rawItem of config) {
		const item = tabConfigItem(rawItem);
		const itemToAdd : ExpandedTabConfigItem = {
			...item,
			expandedCollection:  (item.collection instanceof CollectionDescription) ? item.collection : (item.collection ? CollectionDescription.deserialize(item.collection as string) : null),
			expandedIcon: (typeof item.icon != 'string') ? item.icon : icons[item.icon]
		};
		if (item.icon && !itemToAdd.expandedIcon) console.warn('Invalid icon name: ' + item.icon);
		result.push(itemToAdd);
	}
	return result;
};

const DEFAULT_CONFIG : TabConfig = [
	{
		expand: TAB_CONFIG_DEFAULT_TABS
	}
];

const EXPANSION_ITEMS : {[name in TabConfigName]+?: TabConfig} = {
	[TAB_CONFIG_DEFAULT_TABS]: [
		{
			expand: TAB_CONFIG_SECTIONS,
		},
		{
			expand: TAB_CONFIG_HIDDEN_TAGS,
		},
		{
			expand: TAB_CONFIG_DEFAULT_END_TABS,
		}
	],
	[TAB_CONFIG_DEFAULT_END_TABS]: [
		{
			expand: TAB_CONFIG_POPULAR,
		},
		{
			expand: TAB_CONFIG_RECENT,
		},
		{
			expand: TAB_CONFIG_READING_LIST,
		},
		{
			expand: TAB_CONFIG_STARRED,
		},
		{
			expand: TAB_CONFIG_UNREAD,
		},
		{
			expand: TAB_CONFIG_WORKING_NOTES,
		},
		{
			expand: TAB_CONFIG_CONCEPTS,
		},
		{
			expand: TAB_CONFIG_TWITTER,
		}
	],
	[TAB_CONFIG_POPULAR]: [
		{
			icon: icons.INSIGHTS_ICON,
			display_name: 'Popular',
			//TODO: this should be DEFAULT_SET_NAME, but if you click on the tab with DEFAULT_SET_NAME and a sort and no filters, it breaks
			collection: new CollectionDescription(EVERYTHING_SET_NAME,[], SORT_NAME_STARS, false),
			//If any section has default set to true first, it will be default. This is thus a fallback.
			default:true,
		}
	],
	[TAB_CONFIG_RECENT]: [
		{
			icon: icons.SCHEDULE_ICON,
			display_name: 'Recent',
			collection: new CollectionDescription(EVERYTHING_SET_NAME, ['has-content'], SORT_NAME_RECENT, false),
		}
	],
	[TAB_CONFIG_READING_LIST]: [
		{
			icon: icons.PLAYLIST_PLAY_ICON,
			display_name: 'Your reading list',
			collection: new CollectionDescription(READING_LIST_SET_NAME),
			count: true,
			fallback_cards: [READING_LIST_FALLBACK_CARD],
		}
	],
	[TAB_CONFIG_STARRED]: [
		{
			icon: icons.STAR_ICON,
			display_name: 'Your starred cards',
			collection: new CollectionDescription(EVERYTHING_SET_NAME, ['starred']),
			count: true,
			fallback_cards: [STARS_FALLBACK_CARD],
		}
	],
	[TAB_CONFIG_UNREAD]: [
		{
			icon: icons.VISIBILITY_ICON,
			display_name: 'Cards you haven\'t read yet',
			collection: new CollectionDescription('', ['unread']),
			count: true,
		}
	],
	[TAB_CONFIG_WORKING_NOTES]: [
		{
			icon: icons.INSERT_DRIVE_FILE_ICON,
			display_name: 'Working note cards',
			collection: new CollectionDescription(EVERYTHING_SET_NAME, [CARD_TYPE_WORKING_NOTES, 'unpublished'], SORT_NAME_RECENT, false),
			count:true,
			hideIfEmpty: true,
		}
	],
	[TAB_CONFIG_CONCEPTS]: [
		{
			icon: icons.MENU_BOOK_ICON,
			display_name: 'Concept cards',
			collection: new CollectionDescription(EVERYTHING_SET_NAME, [CARD_TYPE_CONCEPT]),
			count:true,
			hideIfEmpty: true,
		}
	],
	[TAB_CONFIG_TWITTER]: [
		{
			icon: icons.TWITTER_ICON,
			display_name: '@' + TWITTER_HANDLE + ' tweets multiple times a day with cards from this collection. It\'s a great way to dip your toe in the content.',
			href: 'https://twitter.com/' + TWITTER_HANDLE,
			//Don't show the item if no twitter handle
			hide: !TWITTER_HANDLE,
		}
	]
};

const DEFAULT_LOADING_TAB : TabConfigItem = {
	collection: new CollectionDescription(),
	display_name: 'Loading...',
	italics: true,
};


const tabsForSections = (sections : Sections, doHide? : boolean) : TabConfig => {
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

const expandTabConfigItem = (configItem : TabConfigItem, sections : Sections, tags : Sections) : [expandedConfig: TabConfig, changesMade : boolean] => {
	if (!configItem) return [[configItem], false];

	if (!configItem.expand) return [[configItem], false];

	const configItemWithoutExpand = Object.fromEntries(Object.entries(configItem).filter(entry => entry[0] != 'expand'));

	//We expand the first item (without the expand keyword) first, then the
	//expansion item (once each for each item in the expansion). That means you
	//can set non-default properties, e.g. {expand:'concept', default:true} and
	//have the default:true still exist after expansion.
	if (EXPANSION_ITEMS[configItem.expand]) return [[...EXPANSION_ITEMS[configItem.expand].map(item => ({...configItemWithoutExpand, ...tabConfigItem(item)}))], true];

	if (configItem.expand == TAB_CONFIG_SECTIONS) {
		return [tabsForSections(sections, false), true];
	}
	if (configItem.expand == TAB_CONFIG_HIDDEN_SECTIONS) {
		return [tabsForSections(sections, true), true];
	}
	if (configItem.expand == TAB_CONFIG_TAGS) {
		return [tabsForSections(tags), true];
	}
	if (configItem.expand == TAB_CONFIG_HIDDEN_TAGS) {
		return [tabsForSections(tags, true), true];
	}

	console.warn('Unknown tabs expansion: ' + configItem.expand);
	return [[], false];
};
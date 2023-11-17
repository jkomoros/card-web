import {
	CollectionDescription
} from './collection_description.js';

import * as icons from './components/my-icons.js';

import {
	TWITTER_HANDLE
} from './config.GENERATED.SECRET.js';

import {
	TabConfigItem,
	TabConfig,
	ExpandedTabConfig,
	ExpandedTabConfigItem,
	Sections,

} from './types.js';

import {
	TabConfigName,
	TabConfigOverrides
} from './types_simple.js';

import {
	store
} from './store.js';

import {
	randomizeCollection,
	RANDOM_CARD_COLLECTION
} from './actions/collection.js';
import { cardTypeFilter } from './filters.js';

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
		for (const rawItem of lastArray) {
			const item = tabConfigItem(rawItem);
			let [expandedItems, didExpand] = expandTabConfigItem(item, sections, tags);
			if (didExpand) changesMade = true;
			if (item.expand) {
				if (overrides.before) {
					const override = overrides.before[item.expand];
					if (override) {
						expandedItems = [override, ...expandedItems];
						changesMade = true;
					}
				}
				if (overrides.after) {
					const override = overrides.after[item.expand];
					if (override) {
						expandedItems = [...expandedItems, override];
						changesMade = true;
					}
				}
			}
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
			expandedCollection:  (item.collection instanceof CollectionDescription) ? item.collection : (item.collection ? CollectionDescription.deserialize(item.collection as string) : new CollectionDescription()),
			expandedIcon: (typeof item.icon != 'string') ? (item.icon || icons.CANCEL_ICON) : (icons[item.icon] || icons.CANCEL_ICON)
		};
		if (item.icon && !itemToAdd.expandedIcon) console.warn('Invalid icon name: ' + item.icon);
		result.push(itemToAdd);
	}
	return result;
};

const DEFAULT_CONFIG : TabConfig = [
	{
		expand: 'default_tabs'
	}
];

const EXPANSION_ITEMS : {[name in Exclude<TabConfigName, 'sections' | 'hidden_sections' | 'tags' | 'hidden_tags'>]: TabConfig} = {
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
			expand: 'popular',
		},
		{
			expand: 'recent',
		},
		{
			expand: 'reading-list',
		},
		{
			expand: 'starred',
		},
		{
			expand: 'unread',
		},
		{
			expand: 'working-notes',
		},
		{
			expand: 'concepts',
		},
		{
			expand: 'random',
		},
		{
			expand: 'twitter',
		}
	],
	'popular': [
		{
			icon: icons.INSIGHTS_ICON,
			display_name: 'Popular',
			//TODO: this should be DEFAULT_SET_NAME, but if you click on the tab with DEFAULT_SET_NAME and a sort and no filters, it breaks
			collection: new CollectionDescription('everything',[], 'stars', false),
			//If any section has default set to true first, it will be default. This is thus a fallback.
			default:true,
		}
	],
	'recent': [
		{
			icon: icons.SCHEDULE_ICON,
			display_name: 'Recent',
			collection: new CollectionDescription('everything', ['has-content'], 'recent', false),
		}
	],
	'reading-list': [
		{
			icon: icons.PLAYLIST_PLAY_ICON,
			display_name: 'Your reading list',
			collection: new CollectionDescription('reading-list'),
			count: true,
			fallback_cards: [READING_LIST_FALLBACK_CARD],
		}
	],
	'starred': [
		{
			icon: icons.STAR_ICON,
			display_name: 'Your starred cards',
			collection: new CollectionDescription('everything', ['starred']),
			count: true,
			fallback_cards: [STARS_FALLBACK_CARD],
		}
	],
	'unread': [
		{
			icon: icons.VISIBILITY_ICON,
			display_name: 'Cards you haven\'t read yet',
			collection: new CollectionDescription('main', ['unread']),
			count: true,
		}
	],
	'working-notes': [
		{
			icon: icons.INSERT_DRIVE_FILE_ICON,
			display_name: 'Working note cards',
			collection: new CollectionDescription('everything', [cardTypeFilter('working-notes'), 'unpublished'], 'recent', false),
			count:true,
			hideIfEmpty: true,
		}
	],
	'concepts': [
		{
			icon: icons.MENU_BOOK_ICON,
			display_name: 'Concept cards',
			collection: new CollectionDescription('everything', [cardTypeFilter('concept')]),
			count:true,
			hideIfEmpty: true,
		}
	],
	'twitter': [
		{
			icon: icons.TWITTER_ICON,
			display_name: '@' + TWITTER_HANDLE + ' tweets multiple times a day with cards from this collection. It\'s a great way to dip your toe in the content.',
			href: 'https://twitter.com/' + TWITTER_HANDLE,
			//Don't show the item if no twitter handle
			hide: !TWITTER_HANDLE,
		}
	],
	'random': [
		{
			icon: icons.CASINO_ICON,
			display_name: 'Random card (⌘⌥⇧R)',
			collection: RANDOM_CARD_COLLECTION,
			action: () => store.dispatch(randomizeCollection())
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
		collection: new CollectionDescription('main', [section.id]),
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
	if (configItem.expand in EXPANSION_ITEMS) {
		//eslint-disable-next-line @typescript-eslint/no-explicit-any
		const items = (EXPANSION_ITEMS as any)[configItem.expand] as TabConfig;
		return [[...items.map(item => ({...configItemWithoutExpand, ...tabConfigItem(item)}))], true];
	}

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
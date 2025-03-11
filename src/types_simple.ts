//These are popped out into a simple file with (minimal) imports so npm run
//generate:schema doens't have to import the whole project.

import {
	z
} from 'zod';

import {
	CardIdentifier
} from '../shared/types.js';

//Ugh doesn't this import kind of ruin the point?
import * as icons from './components/my-icons.js';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const tabConfigName = z.enum([
	'default_tabs',
	'default_end_tabs',
	'sections',
	'hidden_sections',
	'tags',
	'hidden_tags',
	'popular',
	'recent',
	'reading-list',
	'starred',
	'unread',
	'working-notes',
	'concepts',
	'twitter',
	'random'
]);

export type TabConfigName = z.infer<typeof tabConfigName>;

export type IconName = keyof(typeof icons);

//If a TabConfigName is given, then it will be treated as though it were {expand:"<NAME>"}
export type TabConfigInput = (TabConfigName | TabConfigItemInput)[];

export interface TabConfigItemInput {
	//If set, will expand in line for the named expansion. See src/tabs.js for named expansions.
	//Applies recursively until no expansions remain.
	//Note that 'sections' is a special value that will expand to the current values of sections.
	expand?: TabConfigName,
	//collection can be either a string that can be deserialized into a CollectionDescription, or an actual 
	//CollectionDescription. It will be expanded to be a CollectionDescription either way. Each item should have a collection
	//or an href. If it's a string, remember it should start with a setname, e/g. 'everything/working-notes'
	collection?: string,
	//If set, the item will render an <a href='href' target='_blank'>
	href?: string,
	//Can be either a string naming an ICON constant in src/components/my-icons.js, or an actual Icon template.
	//If provided, will render that instead of the display_name text.
	icon?: IconName,
	//The text string to show. Alway used for title of the tab, but also will use if no icon provided.
	display_name?: string,
	//If true, the display_name will be rendered with italics
	italics?: boolean,
	//If true, a count of how many cards are in the collection will be calculated and rendered.
	count?: boolean,
	//If true, will not show the item if the count is 0.
	hideIfEmpty?: boolean,
	//If true, the item will not be rendered. This is useful if you want fallback_cards or start_cards 
	//to be available but don't want the tab to show up.
	hide?: boolean,
	//If provided, will show these fallback cards if no real cards match the collection. The strings can be IDs or 
	//slugs for the target cards.
	fallback_cards?: CardIdentifier[],
	//If provided, will show these start cards if the collection being show is precisely the collection described 
	//by this descripton. The strings can be IDS or slugs for the target cards.
	start_cards?: CardIdentifier[],
	//The first item that has default:true will be used as the default collection if the app is loaded without a 
	//collection. The auto sections portion will automatically select at least one item to be default.
	default?: boolean
	//If provided, will also execute the action when the user taps
	action? : () => void;
}

//Items in the before map will be placed immediately before any item matching
//the name. Items in the after map will be placed immediately after the item
//matching hte name.
export type TabConfigOverrides = {
	before?: {
		[name in TabConfigName]+? : TabConfigItemInput
	},
	after?: {
		[name in TabConfigName]+?: TabConfigItemInput
	}
}

//This is the the type that PermissionType is driven off of.
//functions/types/ts:UserPermissions is also based on this
export type UserPermissionsCore = {
	admin? : boolean,
	viewApp? : boolean,
	edit? : boolean,
	editSection? : boolean,
	editTag? : boolean,
	editCard? : boolean,
	createCard? : boolean,
	viewUnpublished? : boolean,
	comment? : boolean,
	star? : boolean,
	markRead? : boolean,
	modifyReadingList? : boolean,
	remoteAI?: boolean
}
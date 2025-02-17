import {
	PermissionInfoCollection
} from './types.js';

//Note: when adding one to this, also update UserPermissions type.
export const PERMISSION_ADMIN = 'admin';
export const PERMISSION_VIEW_APP = 'viewApp';
export const PERMISSION_EDIT = 'edit';
export const PERMISSION_EDIT_SECTION = 'editSection';
export const PERMISSION_EDIT_TAG = 'editTag';
export const PERMISSION_EDIT_CARD = 'editCard';
export const PERMISSION_CREATE_CARD = 'createCard';
export const PERMISSION_VIEW_UNPUBLISHED = 'viewUnpublished';
export const PERMISSION_COMMENT = 'comment';
export const PERMISSION_STAR = 'star';
export const PERMISSION_MARK_READ = 'markRead';
export const PERMISSION_MODIFY_READING_LIST = 'modifyReadingList';
export const PERMISSION_MODIFY_DICTIONARY = 'modifyDictionary';
export const PERMISSION_REMOTE_AI = 'remoteAI';

import {
	USER_TYPE_ALL_PERMISSIONS,
	USER_TYPE_ANONYMOUS_PERMISSIONS,
	USER_TYPE_SIGNED_IN_PERMISSIONS,
	USER_TYPE_SIGNED_IN_DOMAIN_PERMISSIONS,
} from './config.GENERATED.SECRET.js';

export const COMPOSED_USER_TYPE_ALL_PERMISSIONS = {...USER_TYPE_ALL_PERMISSIONS};
export const COMPOSED_USER_TYPE_ANOYMOUS_PERMISSIONS = {...COMPOSED_USER_TYPE_ALL_PERMISSIONS, ...USER_TYPE_ANONYMOUS_PERMISSIONS};
export const COMPOSED_USER_TYPE_SIGNED_IN_PERMISSIONS = {...COMPOSED_USER_TYPE_ANOYMOUS_PERMISSIONS, ...USER_TYPE_SIGNED_IN_PERMISSIONS};
export const COMPOSED_USER_TYPE_SIGNED_IN_DOMAIN_PERMISSIONS = {...COMPOSED_USER_TYPE_SIGNED_IN_PERMISSIONS, ...USER_TYPE_SIGNED_IN_DOMAIN_PERMISSIONS};

//NOTE: all of the logic above this line is effectively recreated in gulpfile.js

export const PERMISSIONS_INFO : PermissionInfoCollection = {
	[PERMISSION_ADMIN]: {
		displayName: 'Admin',
		description: 'admin is the highest permission, which allows basically all actions, including deleting things. Note that this may only be set to true on a specific permissions record for a user, not at any other override point, since it\'s so sensitive. It also may not be set within the permissions editor, but only manually in the firebase console due to its sensitivity.',
		locked: true,
	},
	[PERMISSION_VIEW_APP]: {
		displayName: 'View App',
		description: 'viewApp is basic view-only access to the app, allowing people to see published cards, as well as tags, sections, and comments/threads. This default setting allows anyone to see content when they first visit even if not logged in.',
	},
	[PERMISSION_EDIT]: {
		displayName: 'Edit',
		description: 'edit allows the user to edit any record: any card, any section (and in future more). Note that if this is true, then viewUnpublished is forced on, too.',
	},
	[PERMISSION_EDIT_SECTION]: {
		displayName: 'Edit Section',
		description: 'people with editSection permission can modify any section, including adding cards to them, removing cards, and reordering cards in them.',
	},
	[PERMISSION_EDIT_TAG]: {
		displayName: 'Edit Tag',
		description: 'people with editTag can modify any tag, including adding cards to them and removing cards to them.',
	},
	[PERMISSION_EDIT_CARD]: {
		displayName: 'Edit Card',
		description: 'people with editCard can edit any card. This permission also allows the user to view any card, even unpublished ones. The user who authored a card may always edit it. Users who are explicitly listed as editors on a card may also edit it even without this permission.',
		legalOnCard: true,
	},
	[PERMISSION_CREATE_CARD]: {
		displayName: 'Create Card',
		description: 'If true, then the user may create new cards that they are the author of. Note that they must also have editSection (or edit, or admin) permission in the section to add a card into.',
	},
	[PERMISSION_VIEW_UNPUBLISHED]: {
		displayName: 'View Unpublished',
		description: 'viewUnpublished allows users with this permission to even view cards that are not published. Requires viewApp to be true to read cards in the first place. If edit is true, then this permission is implied true. Users can always view unpublished cards they are an author or editor of, even if this permission is false.',
	},
	[PERMISSION_COMMENT]: {
		displayName: 'Comment',
		description: 'comment allows users with this permission to create and edit messages and threads that they are the owner of.',
	},
	[PERMISSION_STAR]: {
		displayName: 'Star',
		description: 'whether the user may star a card',
	},
	[PERMISSION_MARK_READ]: {
		displayName: 'Mark Read',
		description: 'whether the user may mark a card read',
	},
	[PERMISSION_MODIFY_READING_LIST]: {
		displayName: 'Modify Reading List',
		description: 'whether the user may add to or remove from their reading list',
	},
	[PERMISSION_MODIFY_DICTIONARY]: {
		displayName: 'Modify Dictionary',
		description: 'whether the user may modify the spelling dictionary',
	},
	[PERMISSION_REMOTE_AI]: {
		displayName: 'Use Remote AI Calls',
		description: 'whether the user may use remote OpenAI calls, which costs per call. This powers AI Assitant features.'
	}
};

export const PERMISSIONS_LEGAL_ON_CARD_INFO : PermissionInfoCollection = Object.fromEntries(Object.entries(PERMISSIONS_INFO).filter(entry => entry[1].legalOnCard));
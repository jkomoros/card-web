export const PERMISSION_ADMIN = 'admin';
export const PERMISSION_VIEW_APP = 'viewApp';
export const PERMISSION_EDIT = 'edit';
export const PERMISSION_EDIT_SECTION = 'editSection';
export const PERMISSION_EDIT_TAG = 'editTag';
export const PERMISSION_CREATE_CARD = 'createCard';
export const PERMISSION_VIEW_UNPUBLISHED = 'viewUnpublished';
export const PERMISSION_COMMENT = 'comment';
export const PERMISSION_STAR = 'star';
export const PERMISSION_MARK_READ = 'markRead';
export const PERMISSION_MODIFY_READING_LIST = 'modifyReadingList';

export const PERMISSIONS_INFO = {
	[PERMISSION_ADMIN]: {
		displayName: 'Admin',
		description: 'admin is the highest permission, which allows basically all actions, including deleting things. Note that this may only be set to true on a specific permissions record for a user, not at any other override point, since it\'s so sensitive.',
		locked: true,
	},
	[PERMISSION_VIEW_APP]: {
		displayName: 'View App',
		description: 'viewApp is basic view-only access to the app, allowing people to see published cards, as well as tags, sections, and comments/threads. This default setting allows anyone to see content when they first visit even if not logged in.',
		default: true,
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
};

//BASE_PERMISSIONS are the permissions as configured directly in the javascript
//code. Note that this is duplicated in firestore.TEMPLATE.rules
const BASE_PERMISSIONS = Object.fromEntries(Object.entries(PERMISSIONS_INFO).map(entry => [entry[0], entry[1].default || false]));

const BASE_USER_TYPE_ANONYMOUS_PERMISSIONS = {
	[PERMISSION_STAR]: true,
	[PERMISSION_MARK_READ]: true,
	[PERMISSION_MODIFY_READING_LIST]: true
};

const BASE_USER_TYPE_SIGNED_IN_PERMISSIONS = {
	[PERMISSION_COMMENT]: true,
};

const BASE_USER_TYPE_SIGNED_IN_DOMAIN_PERMISSIONS = {};

import {
	USER_TYPE_ALL_PERMISSIONS,
	USER_TYPE_ANONYMOUS_PERMISSIONS,
	USER_TYPE_SIGNED_IN_PERMISSIONS,
	USER_TYPE_SIGNED_IN_DOMAIN_PERMISSIONS,
} from '../config.GENERATED.SECRET.js';

export const COMPOSED_USER_TYPE_ALL_PERMISSIONS = {...BASE_PERMISSIONS, ...USER_TYPE_ALL_PERMISSIONS};
export const COMPOSED_USER_TYPE_ANOYMOUS_PERMISSIONS = {...COMPOSED_USER_TYPE_ALL_PERMISSIONS, ...BASE_USER_TYPE_ANONYMOUS_PERMISSIONS, ...USER_TYPE_ANONYMOUS_PERMISSIONS};
export const COMPOSED_USER_TYPE_SIGNED_IN_PERMISSIONS = {...COMPOSED_USER_TYPE_ANOYMOUS_PERMISSIONS, ...BASE_USER_TYPE_SIGNED_IN_PERMISSIONS, ...USER_TYPE_SIGNED_IN_PERMISSIONS};
export const COMPOSED_USER_TYPE_SIGNED_IN_DOMAIN_PERMISSIONS = {...COMPOSED_USER_TYPE_SIGNED_IN_PERMISSIONS, ...BASE_USER_TYPE_SIGNED_IN_DOMAIN_PERMISSIONS, ...USER_TYPE_SIGNED_IN_DOMAIN_PERMISSIONS};
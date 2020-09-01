import { 
	SIGNIN_USER,
	SIGNIN_SUCCESS,
	SIGNIN_FAILURE,
	SIGNOUT_USER,
	SIGNOUT_SUCCESS,
	UPDATE_STARS,
	UPDATE_READS,
	AUTO_MARK_READ_PENDING_CHANGED,
	UPDATE_READING_LIST,
	UPDATE_USER_PERMISSIONS
} from '../actions/user.js';

import {
	setRemove,
	setUnion
} from '../util.js';

import {
	COMMIT_PENDING_COLLECTION_MODIFICATIONS 
} from '../actions/collection.js';


//BASE_PERMISSIONS are the permissions as configured directly in the javascript
//code. Note that this is duplicated in firestore.TEMPLATE.rules
export const BASE_PERMISSIONS = {
	//admin is the highest permission, which allows basically all actions,
	//including deleting things. Note that this may only be set to true on a
	//specific permissions record for a user, not at any other override point,
	//since it's so sensitive.
	admin: false,
	//viewApp is basic view-only access to the app, allowing people to see
	//published cards, as well as tags, sections, and comments/threads. This
	//default setting allows anyone to see content when they first visit even if
	//not logged in.
	viewApp: true,
	//edit allows the user to edit any record: any card, any section (and in
	//future more). Note that if this is true, then viewUnpublished is forced
	//on, too.
	edit: false,
	//people with editSection permission can modify any section, including
	//adding cards to them, removing cards, and reordering cards in them.
	editSection: false,
	//people with editTag can modify any tag, including adding cards to them and
	//removing cards to them.
	editTag: false,
	//If true, then the user may create new cards that they are the author of.
	//Note that they must also have editSection (or edit, or admin) permission
	//in the section to add a card into.
	createCard: false,
	//viewUnpublished allows users with this permission to even view cards that
	//are not published. Requires viewApp to be true to read cards in the first
	//place. If edit is true, then this permission is implied true. Users can
	//always view unpublished cards they are an author or editor of, even if
	//this permission is false.
	viewUnpublished: false,
	//comment allows users with this permission to create and edit messages and
	//threads that they are the owner of.
	comment: false,
	//whether the user may star a card
	star: false,
	//whether the user may mark a card read
	markRead: false,
	//whether the user may add to or remove from their reading list
	modifyReadingList: false,
};

export const BASE_USER_TYPE_ANONYMOUS_PERMISSIONS = {
	star: true,
	markRead: true,
	modifyReadingList: true
};

export const BASE_USER_TYPE_SIGNED_IN_PERMISSIONS = {
	comment: true,
};

const INITIAL_STATE = {
	user : null,
	//pending is true whenever we are expecting either a SIGNIN_SUCCESS or
	//SIGNOUT_SUCCESS. That's true both when the page loads before we get the
	//initial auth state (which is why it defaults to true), and also when the
	//user has proactively hit the signIn or signOut buttons.
	pending: true,
	error: null,
	//userPermissions is the object that tells us what we're allowed to do. The
	//security rules will actually enforce this; this is mainly just to not have
	//affordances in the client UI if they won't work. See BASE_PERMISSIONS
	//documentation for what the legal values are.
	userPermissions: {},
	stars : {},
	reads: {},
	readingList: [],
	//This is the reading list that we use for the purposes of the live set. We
	//only update it when COMMIT_PENDING_COLLECTION_MODIFICATIONS is called, for
	//similar reasons that we use filters/pendingFiltesr for sets. That is,
	//reading-list is liable to change while the user is viewing that set, due
	//to their own actions, and it would be weird if the cards would disappear
	//when they hit that button.
	readingListForSet: [],
	//These two are analoges to cardsLoaded et al in data. They're set to true
	//after UPDATE_STARS or _READS has been called at least once.  Primarily for
	//selectDataIsFullyLoaded purposes.
	starsLoaded: false,
	readsLoaded: false,
	readingListLoaded: false,
	userPermissionsLoaded: false,
	autoMarkReadPending: false,
};

const app = (state = INITIAL_STATE, action) => {
	switch (action.type) {
	case SIGNIN_USER:
		return {
			...state,
			pending: true
		};
	case SIGNIN_SUCCESS:
		return {
			...state,
			pending:false,
			user: action.user,
			stars: {},
			reads: {}
		};
	case SIGNIN_FAILURE:
		return {
			...state,
			pending:false,
			error: action.error
		};
	case SIGNOUT_USER:
		return {
			...state,
			pending:true
		};
	case SIGNOUT_SUCCESS:
		return {
			...state,
			pending:false,
			user: null,
			stars: {},
			reads: {}
		};
	case UPDATE_STARS:
		return {
			...state,
			stars: setUnion(setRemove(state.stars, action.starsToRemove), action.starsToAdd),
			starsLoaded: true,
		};
	case UPDATE_READS:
		return {
			...state,
			reads: setUnion(setRemove(state.reads, action.readsToRemove), action.readsToAdd),
			readsLoaded: true,
		};
	case UPDATE_READING_LIST:
		return {
			...state,
			readingList: [...action.list],
			readingListLoaded: true,
		};
	case UPDATE_USER_PERMISSIONS:
		return {
			...state,
			userPermissions: {...action.permissions},
			userPermissionsLoaded: true,
		};
	case COMMIT_PENDING_COLLECTION_MODIFICATIONS:
		return {
			...state,
			readingListForSet: [...state.readingList]
		};
	case AUTO_MARK_READ_PENDING_CHANGED:
		return {
			...state,
			autoMarkReadPending: action.pending
		};
	default:
		return state;
	}
};

export default app;
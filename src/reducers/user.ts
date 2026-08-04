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
	UPDATE_USER_PERMISSIONS,
	SomeAction
} from '../actions.js';

import {
	setRemove,
	setUnion
} from '../util.js';

import {
	UPDATE_COLLECTION_SHAPSHOT 
} from '../actions.js';

import {
	UserState
} from '../types.js';

const INITIAL_STATE : UserState = {
	user : null,
	pending: true,
	error: null,
	userPermissions: {},
	stars : {},
	reads: {},
	readingList: [],
	readingListSnapshot: [],
	starsLoaded: false,
	readsLoaded: false,
	readingListLoaded: false,
	userPermissionsLoaded: false,
	autoMarkReadPending: false,
};

const app = (state : UserState = INITIAL_STATE, action : SomeAction) : UserState => {
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
			reads: {},
			//The reading list and all three loaded flags used to SURVIVE
			//sign-out: the previous account's reading list stayed on screen for
			//the signed-out session, and the flags kept claiming an
			//authoritative delivery that belonged to someone else — so nothing
			//waited for the new session's data before proceeding.
			readingList: [],
			readingListSnapshot: [],
			starsLoaded: false,
			readsLoaded: false,
			readingListLoaded: false
		};
	//`*Loaded` means "the authoritative listener has delivered", and it gates
	//selectDataIsFullyLoaded. An OPTIMISTIC update carries `optimistic: true` so
	//it cannot claim that: a local star, or auto-mark-read firing on boot, would
	//otherwise flip the flag with a single entry while the real set was still in
	//flight, and everything gated on "user state loaded" would proceed against
	//one card instead of hundreds.
	case UPDATE_STARS:
		return {
			...state,
			stars: setUnion(setRemove(state.stars, action.starsToRemove), action.starsToAdd),
			starsLoaded: state.starsLoaded || !action.optimistic,
		};
	case UPDATE_READS:
		return {
			...state,
			reads: setUnion(setRemove(state.reads, action.readsToRemove), action.readsToAdd),
			readsLoaded: state.readsLoaded || !action.optimistic,
		};
	case UPDATE_READING_LIST:
		return {
			...state,
			readingList: [...action.list],
			readingListLoaded: state.readingListLoaded || !action.optimistic,
		};
	case UPDATE_USER_PERMISSIONS:
		return {
			...state,
			userPermissions: {...action.permissions},
			userPermissionsLoaded: true,
		};
	case UPDATE_COLLECTION_SHAPSHOT:
		return {
			...state,
			readingListSnapshot: [...state.readingList]
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
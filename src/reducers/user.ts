import {
	AnyAction
} from 'redux';

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
	UPDATE_COLLECTION_SHAPSHOT 
} from '../actions/collection.js';

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

const app = (state : UserState = INITIAL_STATE, action : AnyAction) : UserState => {
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
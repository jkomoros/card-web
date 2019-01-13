import { 
	SIGNIN_USER,
	SIGNIN_SUCCESS,
	SIGNIN_FAILURE,
	SIGNOUT_USER,
	SIGNOUT_SUCCESS,
	UPDATE_STARS,
	UPDATE_READS,
	AUTO_MARK_READ_PENDING_CHANGED,
} from '../actions/user.js';

import {
	setRemove,
	setUnion
} from '../util.js';

const INITIAL_STATE = {
	user : null,
	pending: false,
	error: null,
	stars : {},
	reads: {},
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
			stars: setUnion(setRemove(state.stars, action.starsToRemove), action.starsToAdd)
		};
	case UPDATE_READS:
		return {
			...state,
			reads: setUnion(setRemove(state.reads, action.readsToRemove), action.readsToAdd)
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
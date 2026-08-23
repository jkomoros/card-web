//Persistent failures the user still needs to know about.
//
//Distinct from the snack bar, which reports things that are true and then over.
//This is for a broken durability promise: a write that will not retry, or one
//that has failed repeatedly. HOUSE-STYLE §3.6.1 point 4 — a broken promise
//escalates rather than evaporating.
//
//The store already had cardModificationError, set on every failed write and
//cleared ONLY by the next successful MODIFY_CARD. Nothing rendered it, and there
//was no way to dismiss it. This slice is the surface it never had.

import {
	REPORT_PERSISTENT_ERROR,
	DISMISS_PERSISTENT_ERROR,
	SomeAction
} from '../actions.js';

import {
	ErrorsState
} from '../types.js';

const INITIAL_STATE : ErrorsState = {
	errors: [],
};

const errors = (state : ErrorsState = INITIAL_STATE, action : SomeAction) : ErrorsState => {
	switch (action.type) {
	case REPORT_PERSISTENT_ERROR: {
		//The same failure recurring is one problem, not N. Without this, a
		//write retrying every few seconds would paper the screen.
		const existing = action.error.dedupeKey ? state.errors.findIndex(entry => entry.dedupeKey === action.error.dedupeKey) : -1;
		if (existing >= 0) {
			const errors = [...state.errors];
			errors[existing] = action.error;
			return {...state, errors};
		}
		return {...state, errors: [...state.errors, action.error]};
	}
	case DISMISS_PERSISTENT_ERROR:
		return {
			...state,
			errors: state.errors.filter(entry => entry.id !== action.errorID),
		};
	default:
		return state;
	}
};

export default errors;

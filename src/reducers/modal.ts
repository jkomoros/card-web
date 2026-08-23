//The parked-request stack behind src/modal.ts's async seam (#708).
//
//A STACK rather than a slot, because the issue says so and because it is true:
//native modals block, so only one could ever be outstanding. In-app dialogs do
//not, so a second request can legitimately arrive while the first is open. The
//last entry is the live one.

import {
	MODAL_OPEN,
	MODAL_RESOLVE,
	SomeAction
} from '../actions.js';

import {
	ModalState
} from '../types.js';

const INITIAL_STATE : ModalState = {
	requests: [],
};

const modal = (state : ModalState = INITIAL_STATE, action : SomeAction) : ModalState => {
	switch (action.type) {
	case MODAL_OPEN:
		return {
			...state,
			requests: [...state.requests, action.request],
		};
	case MODAL_RESOLVE:
		return {
			...state,
			//Filter by id rather than popping: a resolve can arrive for a
			//request that is no longer on top if a dialog was dismissed out of
			//order, and dropping the wrong one would strand a promise.
			requests: state.requests.filter(request => request.id !== action.requestID),
		};
	default:
		return state;
	}
};

export default modal;

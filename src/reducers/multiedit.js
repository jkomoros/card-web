import {
	MULTI_EDIT_DIALOG_OPEN,
	MULTI_EDIT_DIALOG_CLOSE
} from '../actions/multiedit.js';

const INITIAL_STATE = {
	open: false,
};

const app = (state = INITIAL_STATE, action) => {
	switch (action.type) {
	case MULTI_EDIT_DIALOG_OPEN:
		return {
			...state,
			open: true
		};
	case MULTI_EDIT_DIALOG_CLOSE:
		return {
			...state,
			open: false,
		};
	default:
		return state;
	}
};

export default app;
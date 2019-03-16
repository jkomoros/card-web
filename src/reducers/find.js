import {
	FIND_DIALOG_OPEN,
	FIND_DIALOG_CLOSE,
	FIND_UPDATE_QUERY,
	FIND_CARD_TO_LINK
} from '../actions/find.js';

const INITIAL_STATE = {
	open: false,
	query: '',
	linking: false
};

const app = (state = INITIAL_STATE, action) => {
	switch (action.type) {
	case FIND_DIALOG_OPEN:
		return {
			...state,
			linking: false,
			query: '',
			open: true
		};
	case FIND_DIALOG_CLOSE:
		return {
			...state,
			open: false,
			query: ''
		};
	case FIND_UPDATE_QUERY: 
		return {
			...state,
			query: action.query
		};
	case FIND_CARD_TO_LINK:
		return {
			...state,
			open: true,
			linking: true,
			query: action.query
		};
	default:
		return state;
	}
};

export default app;
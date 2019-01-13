import {
	UPDATE_RECENT_CARDS,
	RECENT_FETCHING
} from '../actions/recent.js';

const INITIAL_STATE = {
	cardsBySection: {},
	fetching: false
};

const app = (state = INITIAL_STATE, action) => {
	switch (action.type) {
	case UPDATE_RECENT_CARDS:
		return {
			...state,
			cardsBySection: action.cardsBySection,
			fetching: false
		};
	case RECENT_FETCHING:
		return {
			...state,
			fetching: action.isFetching
		};
	default:
		return state;
	}
};

export default app;
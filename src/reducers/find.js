import {
	FIND_DIALOG_OPEN,
	FIND_DIALOG_CLOSE,
	FIND_UPDATE_QUERY,
	FIND_CARD_TO_LINK,
	FIND_UPDATE_ACTIVE_QUERY,
	FIND_CARD_TO_PERMISSION
} from '../actions/find.js';

const INITIAL_STATE = {
	open: false,
	//query is the query as input by the user, as quick as we can update state.
	query: '',
	//activeQuery is the query that goes into the processing pipeline. We only
	//update this every so often as query is updated, because it is expensive
	//and drives expensive template updating, introducing lag.
	activeQuery: '',
	linking: false,
	permissions: false,
};

const app = (state = INITIAL_STATE, action) => {
	switch (action.type) {
	case FIND_DIALOG_OPEN:
		return {
			...state,
			linking: false,
			permissions: false,
			query: '',
			activeQuery: '',
			open: true
		};
	case FIND_DIALOG_CLOSE:
		return {
			...state,
			open: false,
			query: '',
			activeQuery: '',
		};
	case FIND_UPDATE_QUERY: 
		return {
			...state,
			query: action.query
		};
	case FIND_UPDATE_ACTIVE_QUERY:
		return {
			...state,
			activeQuery: state.query,
		};
	case FIND_CARD_TO_LINK:
		return {
			...state,
			open: true,
			linking: true,
			permissions: false,
			query: action.query,
			activeQuery: action.query
		};
	case FIND_CARD_TO_PERMISSION:
		return {
			...state,
			open: true,
			linking: false,
			permissions: true,
			query: action.query,
			activeQuery: action.query
		};
	default:
		return state;
	}
};

export default app;
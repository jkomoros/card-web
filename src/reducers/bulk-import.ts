import {
	BULK_IMPORT_DIALOG_CLOSE,
	BULK_IMPORT_DIALOG_OPEN,
	SomeAction
} from '../actions.js';

import {
	BulkImportState
} from '../types.js';

const INITIAL_STATE : BulkImportState = {
	open: false,
	bodies: []
};

const app = (state : BulkImportState = INITIAL_STATE, action : SomeAction) : BulkImportState => {
	switch (action.type) {
	case BULK_IMPORT_DIALOG_CLOSE:
		return {
			...state,
			open: false
		};
	case BULK_IMPORT_DIALOG_OPEN:
		return {
			...state,
			open: true,
			bodies: []
		};
	default:
		return state;
	}
};

export default app;
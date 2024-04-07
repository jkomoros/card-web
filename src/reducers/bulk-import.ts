import {
	BULK_IMPORT_DIALOG_CLOSE,
	BULK_IMPORT_DIALOG_OPEN,
	BULK_IMPORT_PENDING,
	BULK_IMPORT_SET_BODIES,
	BULK_IMPORT_SUCCESS,
	SomeAction
} from '../actions.js';

import {
	BulkImportState
} from '../types.js';

const INITIAL_STATE : BulkImportState = {
	open: false,
	mode: 'import',
	pending: false,
	bodies: [],
	importer: '',
	importerVersion: 0
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
			mode: 'import',
			pending: false,
			bodies: [],
			importer: '',
			importerVersion: 0
		};
	case BULK_IMPORT_PENDING:
		return {
			...state,
			pending: true
		};
	case BULK_IMPORT_SUCCESS:
		return {
			...state,
			pending: false,
			open: false
		};
	case BULK_IMPORT_SET_BODIES:
		return {
			...state,
			bodies: [...action.bodies],
			importer: action.importer,
			importerVersion: action.importerVersion
		};
	default:
		return state;
	}
};

export default app;
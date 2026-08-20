import {
	BULK_IMPORT_DIALOG_CLOSE,
	BULK_IMPORT_DIALOG_OPEN,
	BULK_IMPORT_PENDING,
	BULK_IMPORT_SET_BODIES,
	BULK_IMPORT_SUCCESS,
	BULK_IMPORT_SET_OVERRIDE_CARD_ORDER,
	SomeAction,
	BULK_IMPORT_FAILURE
} from '../actions.js';

import {
	BulkImportState
} from '../types.js';

const INITIAL_STATE : BulkImportState = {
	open: false,
	mode: 'import',
	pending: false,
	error: '',
	overrideCardOrder: null,
	bodies: [],
	importer: '',
	importerVersion: 0
};

const app = (state : BulkImportState = INITIAL_STATE, action : SomeAction) : BulkImportState => {
	switch (action.type) {
	case BULK_IMPORT_DIALOG_CLOSE:
		return {
			...state,
			open: false,
			//Clear on CLOSE, not on OPEN (adversarial review of 9484c181):
			//the user closing the dialog is the acknowledgement of a shown
			//failure, so a stale message must not greet the NEXT session —
			//it leaked into the Export dialog, in warning red, days later.
			//Clearing here rather than on OPEN also keeps the one message a
			//user can otherwise lose: a late failure dispatched AFTER an
			//impatient close-while-pending lands post-clear and still shows
			//on the next open.
			error: ''
		};
	case BULK_IMPORT_DIALOG_OPEN:
		return {
			...state,
			open: true,
			mode: action.mode,
			pending: false,
			bodies: [],
			overrideCardOrder: null,
			importer: '',
			importerVersion: 0
		};
	case BULK_IMPORT_PENDING:
		return {
			...state,
			pending: true,
			error: ''
		};
	case BULK_IMPORT_SUCCESS:
		return {
			...state,
			pending: false,
			open: false
		};
	case BULK_IMPORT_FAILURE:
		//In-dialog, not alert() (#758): this used to fire a blocking OS
		//modal from INSIDE the reducer. The dialog stays open on failure,
		//so it is the natural surface for the message.
		return {
			...state,
			pending: false,
			error: action.error
		};
	case BULK_IMPORT_SET_BODIES:
		return {
			...state,
			bodies: [...action.bodies],
			importer: action.importer,
			importerVersion: action.importerVersion
		};
	case BULK_IMPORT_SET_OVERRIDE_CARD_ORDER:
		return {
			...state,
			overrideCardOrder: action.order,
			pending: false
		};
	default:
		return state;
	}
};

export default app;
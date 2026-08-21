import {
	BULK_IMPORT_DIALOG_CLOSE,
	BULK_IMPORT_DIALOG_OPEN,
	BULK_IMPORT_PENDING,
	BULK_IMPORT_SET_BODIES,
	BULK_IMPORT_SUCCESS,
	BULK_IMPORT_SET_OVERRIDE_CARD_ORDER,
	SomeAction,
	BULK_IMPORT_FAILURE,
	BULK_IMPORT_PROGRESS,
	BULK_IMPORT_OUTCOME
} from '../actions.js';

import {
	BulkImportState
} from '../types.js';

const INITIAL_STATE : BulkImportState = {
	open: false,
	mode: 'import',
	pending: false,
	error: '',
	progress: null,
	outcome: null,
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
			error: '',
			outcome: null,
			progress: null
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
			error: '',
			outcome: null,
			progress: null
		};
	case BULK_IMPORT_PROGRESS:
		return {
			...state,
			progress: action.progress
		};
	case BULK_IMPORT_OUTCOME:
		//The import finished with something to say: the dialog STAYS OPEN
		//(#758) so the report lives in the surface that produced it, with
		//calm phrasing for queued and error phrasing only for discarded —
		//instead of an alert() that could name no cards.
		return {
			...state,
			pending: false,
			progress: null,
			outcome: action.outcome
		};
	case BULK_IMPORT_SUCCESS:
		return {
			...state,
			progress: null,
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
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
	BULK_IMPORT_OUTCOME,
	SIGNIN_SUCCESS,
	SIGNOUT_SUCCESS
} from '../actions.js';

import {
	BulkImportState
} from '../types.js';

const INITIAL_STATE : BulkImportState = {
	session: 0,
	accountUid: null,
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
	case SIGNIN_SUCCESS:
		//Profile enrichment dispatches SIGNIN_SUCCESS again for the SAME
		//account. It must not close a dialog or discard a draft entered while
		//updateProfile was in flight.
		if (state.accountUid === action.user.uid) return state;
		return {...INITIAL_STATE, accountUid: action.user.uid, session: state.session + 1};
	case SIGNOUT_SUCCESS:
		return {...INITIAL_STATE, session: state.session + 1};
	case BULK_IMPORT_DIALOG_CLOSE:
		return {
			...state,
			open: false,
			pending: false,
			session: state.session + 1,
			//Closing acknowledges the report and detaches any outstanding
			//operation. Durable writes continue, but cannot replace a new draft.
			error: '',
			outcome: null,
			progress: null
		};
	case BULK_IMPORT_DIALOG_OPEN:
		return {
			...state,
			open: true,
			session: state.session + 1,
			accountUid: action.uid ?? state.accountUid,
			mode: action.mode,
			error: '',
			outcome: null,
			progress: null,
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
			session: state.session + 1,
			accountUid: action.uid ?? state.accountUid,
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
		//instead of an alert() that could name no cards. bodies is DISARMED
		//(the adversarial review caught this): leaving it populated left a
		//loaded re-import form with an enabled commit button directly under
		//a report saying the cards already exist — one click duplicated the
		//whole import, twice over on the queued path once the durable
		//intents also replayed.
		return {
			...state,
			pending: false,
			progress: null,
			bodies: [],
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
			progress: null,
			error: action.error
		};
	case BULK_IMPORT_SET_BODIES:
		return {
			...state,
			session: state.session + 1,
			pending: false,
			progress: null,
			error: '',
			outcome: null,
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

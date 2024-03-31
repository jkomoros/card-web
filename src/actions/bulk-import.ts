import {
	BULK_IMPORT_DIALOG_CLOSE,
	BULK_IMPORT_DIALOG_OPEN,
	BULK_IMPORT_SET_BODIES,
	SomeAction
} from '../actions.js';

import {
	importBodiesFromGoogleDocs
} from '../contenteditable.js';

import {
	selectBulkImportDialogBodies
} from '../selectors.js';

import {
	ThunkSomeAction
} from '../store.js';

import {
	bulkCreateWorkingNotes
} from './data.js';

export const openBulkImportDialog = () : SomeAction => ({
	type : BULK_IMPORT_DIALOG_OPEN,
});

export const closeBulkImportDialog = () : SomeAction =>  ({
	type: BULK_IMPORT_DIALOG_CLOSE
});

export const processBulkImportContent = (content : string) : SomeAction => {
	const bodies = importBodiesFromGoogleDocs(content);
	return {
		type: BULK_IMPORT_SET_BODIES,
		bodies
	};
};

export const commitBulkImport = () : ThunkSomeAction => (dispatch, getState) => {
	const state = getState();
	const bodies = selectBulkImportDialogBodies(state);
	dispatch(closeBulkImportDialog());
	dispatch(bulkCreateWorkingNotes(bodies, {importer:'google-docs-bulleted', importer_version:1}));
};
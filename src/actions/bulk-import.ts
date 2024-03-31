import {
	BULK_IMPORT_DIALOG_CLOSE,
	BULK_IMPORT_DIALOG_OPEN,
	SomeAction
} from '../actions.js';

export const openBulkImportDialog = () : SomeAction => ({
	type : BULK_IMPORT_DIALOG_OPEN,
});

export const closeAIDialog = () : SomeAction =>  ({
	type: BULK_IMPORT_DIALOG_CLOSE
});
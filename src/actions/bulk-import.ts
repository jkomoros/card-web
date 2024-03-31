import {
	BULK_IMPORT_DIALOG_CLOSE,
	BULK_IMPORT_DIALOG_OPEN,
	BULK_IMPORT_SET_BODIES,
	SomeAction
} from '../actions.js';

import {
	importBodiesFromGoogleDocs
} from '../contenteditable.js';

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
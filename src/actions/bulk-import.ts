import {
	BULK_IMPORT_DIALOG_CLOSE,
	BULK_IMPORT_DIALOG_OPEN,
	BULK_IMPORT_PENDING,
	BULK_IMPORT_SET_BODIES,
	BULK_IMPORT_SET_OVERRIDE_CARD_ORDER,
	SomeAction
} from '../actions.js';

import {
	importBodiesFromGoogleDocs
} from '../contenteditable.js';

import {
	selectActiveCollectionCards,
	selectBulkImportDialogBodies,
	selectBulkImportDialogImporter,
	selectBulkImportDialogImporterVersion,
	selectUserMayUseAI
} from '../selectors.js';

import {
	httpsCallable
} from 'firebase/functions';

import {
	functions
} from '../firebase.js';

import {
	ThunkSomeAction
} from '../store.js';

import {
	BulkImportDialogMode
} from '../types.js';

import {
	bulkCreateWorkingNotes
} from './data.js';

import {
	CardID
} from '../types_simple.js';

//Replicated in `functions/src/types.ts`
export type SemanticSortRequestData = {
	cards: CardID[]
}

//Replicated in `functions/src/types.ts
export type SemanticSortResponseData = {
	cards: CardID[]
}

export const openBulkImportDialog = (mode : BulkImportDialogMode) : SomeAction => ({
	type : BULK_IMPORT_DIALOG_OPEN,
	mode
});

export const closeBulkImportDialog = () : SomeAction =>  ({
	type: BULK_IMPORT_DIALOG_CLOSE
});

export const processBulkImportContent = (content : string, flat : boolean) : SomeAction => {
	const bodies = importBodiesFromGoogleDocs(content, flat ? 'flat' : 'bulleted');
	return {
		type: BULK_IMPORT_SET_BODIES,
		bodies,
		importer: flat ? 'google-docs-flat' : 'google-docs-bulleted',
		importerVersion: 1
	};
};

export const commitBulkImport = () : ThunkSomeAction => (dispatch, getState) => {
	const state = getState();
	const bodies = selectBulkImportDialogBodies(state);
	const importer = selectBulkImportDialogImporter(state);
	if (!importer) throw new Error('importer not set');
	const importer_version = selectBulkImportDialogImporterVersion(state);
	//bulkCreateWorkingNotes will both set the pending flag and also success
	//when done, which will close the dialog.
	dispatch(bulkCreateWorkingNotes(bodies, {importer, importer_version}));
};

const semanticSortCallable = httpsCallable<SemanticSortRequestData, SemanticSortResponseData>(functions, 'semanticSort');

export const semanticSortExport = () : ThunkSomeAction => async (dispatch, getState) => {
	const state = getState();
	if (!selectUserMayUseAI(state)) throw new Error('User may not use AI');
	const cards = selectActiveCollectionCards(state);
	const cardIDs = cards.map(card => card.id);
	dispatch({
		type: BULK_IMPORT_PENDING
	});
	const result = await semanticSortCallable({cards: cardIDs});
	dispatch({
		type: BULK_IMPORT_SET_OVERRIDE_CARD_ORDER,
		order: result.data.cards
	});
};
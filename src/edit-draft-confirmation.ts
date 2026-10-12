//Fired on window whenever a stored draft is written, stamped, or removed, so
//the recovery banner re-reads the slots. Lives in this leaf module so
//actions/data can announce without importing the watcher (a cycle).
export const EDIT_DRAFT_CHANGED_EVENT = 'card-web-edit-draft-changed';

export type SingleSaveIdentity = {
	cardID: string,
	operationID: string,
};

export type DraftSaveIdentity = {
	cardID: string,
	operationID?: string,
};

export const draftMatchesConfirmedSave = (
	draft : DraftSaveIdentity | null,
	confirmation : SingleSaveIdentity | null,
) => Boolean(draft && confirmation && draft.cardID === confirmation.cardID &&
	draft.operationID === confirmation.operationID);

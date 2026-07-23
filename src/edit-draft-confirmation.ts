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

import {cardDiffHasChanges, cardFromDiff, generateCardDiff} from './card_diff.js';
import {EDITING_RESTORE_DRAFT} from './actions.js';
import {navigateToCardInDefaultCollection} from './actions/app.js';
import {editingStart} from './actions/editor.js';
import {
	selectActiveCard,
	selectEditingCard,
	selectEditingUnderlyingCardSnapshot,
	selectIsEditing,
	selectUid,
	selectUserMayEditActiveCard,
} from './selectors.js';
import {store} from './store.js';
import type {CardDiff, CardID, State, Uid} from './types.js';
import {draftMatchesConfirmedSave, SingleSaveIdentity} from './edit-draft-confirmation.js';

export const EDIT_DRAFT_STORAGE_KEY = 'card-web-edit-draft-v1';
export const EDIT_DRAFT_CHANGED_EVENT = 'card-web-edit-draft-changed';

export type StoredEditDraft = {
	version: 1,
	uid: Uid,
	cardID: CardID,
	diff: CardDiff,
	substantive: boolean,
	baseUpdated: {seconds: number, nanoseconds: number} | null,
	savedAt: number,
	operationID?: string,
};

const currentState = () => store.getState() as State;

const timestampParts = (value : unknown) : StoredEditDraft['baseUpdated'] => {
	if (!value || typeof value !== 'object') return null;
	const candidate = value as {seconds?: unknown, nanoseconds?: unknown};
	if (typeof candidate.seconds !== 'number' || typeof candidate.nanoseconds !== 'number') return null;
	return {seconds: candidate.seconds, nanoseconds: candidate.nanoseconds};
};

const isDraft = (value : unknown) : value is StoredEditDraft => {
	if (!value || typeof value !== 'object') return false;
	const draft = value as Partial<StoredEditDraft>;
	return draft.version === 1 && typeof draft.uid === 'string' && Boolean(draft.uid) &&
		typeof draft.cardID === 'string' && Boolean(draft.cardID) &&
		Boolean(draft.diff) && typeof draft.diff === 'object' &&
		typeof draft.substantive === 'boolean' && typeof draft.savedAt === 'number';
};

export const readEditDraft = () : StoredEditDraft | null => {
	try {
		const encoded = localStorage.getItem(EDIT_DRAFT_STORAGE_KEY);
		if (!encoded) return null;
		const value : unknown = JSON.parse(encoded);
		return isDraft(value) ? value : null;
	} catch {
		return null;
	}
};

const announceDraftChanged = () => window.dispatchEvent(new CustomEvent(EDIT_DRAFT_CHANGED_EVENT));

const persistDraft = (draft : StoredEditDraft) => {
	localStorage.setItem(EDIT_DRAFT_STORAGE_KEY, JSON.stringify(draft));
	announceDraftChanged();
};

export const clearEditDraft = () => {
	try {
		localStorage.removeItem(EDIT_DRAFT_STORAGE_KEY);
	} finally {
		announceDraftChanged();
	}
};

const writeDraftForState = (state : State) => {
	const uid = selectUid(state);
	const card = selectEditingCard(state);
	const base = selectEditingUnderlyingCardSnapshot(state);
	if (!uid || !selectIsEditing(state) || !card || !base || card.id !== base.id) return;
	const diff = generateCardDiff(base, card);
	if (!cardDiffHasChanges(diff)) return;
	const draft : StoredEditDraft = {
		version: 1,
		uid,
		cardID: card.id,
		diff,
		substantive: Boolean(state.editor?.substantive),
		baseUpdated: timestampParts(base.updated),
		savedAt: Date.now(),
	};
	persistDraft(draft);
};

const stampDraftForSave = (identity : SingleSaveIdentity | null) => {
	if (!identity) return;
	const draft = readEditDraft();
	if (!draft || draft.cardID !== identity.cardID || draft.uid !== selectUid(currentState())) return;
	persistDraft({...draft, operationID: identity.operationID});
};

let installed = false;
let writeTimer : number | undefined;
let previouslyDirty = false;

const flushPendingDraft = () => {
	if (writeTimer === undefined) return;
	window.clearTimeout(writeTimer);
	writeTimer = undefined;
	writeDraftForState(currentState());
};

export const installEditDraftWatcher = () => {
	if (installed) return;
	installed = true;
	store.subscribe(() => {
		const state = currentState();
		const card = selectEditingCard(state);
		const base = selectEditingUnderlyingCardSnapshot(state);
		const dirty = Boolean(selectUid(state) && selectIsEditing(state) && card && base &&
			card.id === base.id && cardDiffHasChanges(generateCardDiff(base, card)));
		if (!dirty) {
			if (writeTimer !== undefined) window.clearTimeout(writeTimer);
			writeTimer = undefined;
			//Only remove a draft when an active editing session became clean. A
			//fresh page must retain the prior session's recoverable draft.
			if (previouslyDirty) clearEditDraft();
			previouslyDirty = false;
			return;
		}
		previouslyDirty = true;
		if (writeTimer !== undefined) window.clearTimeout(writeTimer);
		writeTimer = window.setTimeout(() => {
			writeTimer = undefined;
			writeDraftForState(currentState());
		}, 200);
	});
	window.addEventListener('storage', event => {
		if (event.key === EDIT_DRAFT_STORAGE_KEY) announceDraftChanged();
	});
	window.addEventListener('card-web-preserve-edit-draft-for-save', event => {
		flushPendingDraft();
		stampDraftForSave((event as CustomEvent<SingleSaveIdentity>).detail || null);
		previouslyDirty = false;
	});
	window.addEventListener('card-web-single-save-confirmed', event => {
		const confirmation = (event as CustomEvent<SingleSaveIdentity>).detail || null;
		//Only the exact operation that preserved this draft may clear it. An
		//unrelated permissions save—or a late acknowledgement—must leave it alone.
		if (draftMatchesConfirmedSave(readEditDraft(), confirmation)) clearEditDraft();
	});
	window.addEventListener('beforeunload', flushPendingDraft);
	document.addEventListener('visibilitychange', () => {
		if (document.visibilityState === 'hidden') flushPendingDraft();
	});
};

const waitForRecoverableCard = (cardID : CardID) : Promise<boolean> => new Promise(resolve => {
	const ready = () => {
		const state = currentState();
		return selectActiveCard(state)?.id === cardID && selectUserMayEditActiveCard(state);
	};
	if (ready()) {
		resolve(true);
		return;
	}
	const unsubscribe = store.subscribe(() => {
		if (!ready()) return;
		window.clearTimeout(timeout);
		unsubscribe();
		resolve(true);
	});
	const timeout = window.setTimeout(() => {
		unsubscribe();
		resolve(false);
	}, 15000);
});

export const recoverEditDraft = async () : Promise<void> => {
	const draft = readEditDraft();
	if (!draft || draft.uid !== selectUid(currentState())) throw new Error('No draft is available for this account.');
	if (selectIsEditing(currentState())) throw new Error('Finish the current edit before recovering a draft.');
	if (selectActiveCard(currentState())?.id !== draft.cardID) {
		store.dispatch(navigateToCardInDefaultCollection(draft.cardID));
	}
	if (!await waitForRecoverableCard(draft.cardID)) throw new Error('The draft card could not be loaded.');
	const current = selectActiveCard(currentState());
	if (!current) throw new Error('The draft card is unavailable.');
	const currentUpdated = timestampParts(current.updated);
	const baseChanged = Boolean(draft.baseUpdated && currentUpdated &&
		(draft.baseUpdated.seconds !== currentUpdated.seconds || draft.baseUpdated.nanoseconds !== currentUpdated.nanoseconds));
	if (baseChanged && !confirm('This card changed after the draft was saved. Recover the draft on top of the newest version?')) return;
	store.dispatch(editingStart());
	const startedBase = selectEditingUnderlyingCardSnapshot(currentState());
	if (!startedBase || startedBase.id !== draft.cardID) throw new Error('The editor could not be opened for this draft.');
	store.dispatch({
		type: EDITING_RESTORE_DRAFT,
		card: cardFromDiff(startedBase, draft.diff),
		substantive: draft.substantive,
	});
};

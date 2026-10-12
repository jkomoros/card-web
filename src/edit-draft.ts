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
import {draftMatchesConfirmedSave, EDIT_DRAFT_CHANGED_EVENT, SingleSaveIdentity} from './edit-draft-confirmation.js';

//The v1 single slot. Still recognized (and migrated) on read: a draft
//written before the per-card upgrade must survive it.
export const EDIT_DRAFT_STORAGE_KEY = 'card-web-edit-draft-v1';
//#766: one slot PER CARD. The single shared slot silently broke when #763
//made editor sessions per-card: a second session's keystrokes overwrote the
//first card's stamped draft, and the second session finishing CLEAN deleted
//it outright — so a paused save's Stop-and-recover flow surfaced the wrong
//card's words, or none.
export const EDIT_DRAFT_STORAGE_PREFIX = 'card-web-edit-draft-v2-';
//Drafts are small diffs, but per-card slots could accrete without bound in
//localStorage; keep the newest few. Enforced on every persist that creates a
//new slot (rewrites to an existing slot cannot change the count).
export const MAX_EDIT_DRAFT_SLOTS = 8;
export {EDIT_DRAFT_CHANGED_EVENT};

const draftKey = (cardID : CardID) => EDIT_DRAFT_STORAGE_PREFIX + cardID;

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

const readDraftAtKey = (key : string) : StoredEditDraft | null => {
	try {
		const encoded = localStorage.getItem(key);
		if (!encoded) return null;
		const value : unknown = JSON.parse(encoded);
		return isDraft(value) ? value : null;
	} catch {
		return null;
	}
};

//Adopt a pre-upgrade v1 draft into its card's own slot, never clobbering a
//newer v2 draft for the same card.
const migrateLegacyDraft = () => {
	//The overwhelmingly common case is that no v1 record exists at all: bail
	//before issuing a removeItem for a key that was never there.
	let encoded : string | null = null;
	try {
		encoded = localStorage.getItem(EDIT_DRAFT_STORAGE_KEY);
	} catch {
		return;
	}
	if (encoded === null) return;
	let legacy : StoredEditDraft | null = null;
	try {
		const value : unknown = JSON.parse(encoded);
		legacy = isDraft(value) ? value : null;
	} catch {
		//A malformed v1 record migrates nothing but is still removed below.
		legacy = null;
	}
	if (legacy) {
		const existing = readDraftAtKey(draftKey(legacy.cardID));
		if (!existing || existing.savedAt <= legacy.savedAt) {
			try {
				localStorage.setItem(draftKey(legacy.cardID), JSON.stringify(legacy));
			} catch {
				//Quota/disabled storage: leave the v1 record in place so the
				//draft is not lost; the reads below still see nothing for v2.
				return;
			}
		}
	}
	try {
		localStorage.removeItem(EDIT_DRAFT_STORAGE_KEY);
	} catch {
		//Best effort.
	}
};

//Every stored draft, newest first. Callers filter by uid where it matters.
export const readEditDrafts = () : StoredEditDraft[] => {
	migrateLegacyDraft();
	const drafts : StoredEditDraft[] = [];
	try {
		for (const key of Object.keys(localStorage)) {
			if (!key.startsWith(EDIT_DRAFT_STORAGE_PREFIX)) continue;
			const draft = readDraftAtKey(key);
			if (draft) drafts.push(draft);
		}
	} catch {
		return [];
	}
	return drafts.sort((a, b) => b.savedAt - a.savedAt);
};

//With a cardID: that card's draft. Without: the newest draft of any card —
//the pre-#766 single-slot read, preserved for callers that just want "the"
//draft.
export const readEditDraft = (cardID? : CardID) : StoredEditDraft | null => {
	migrateLegacyDraft();
	if (cardID !== undefined) return readDraftAtKey(draftKey(cardID));
	return readEditDrafts()[0] ?? null;
};

//Exported for tests. Stamped drafts are EXEMPT victims (#766 review): an
//operationID marks a paused save's recovery record — the exact artifact this
//module exists to protect — and stamped drafts cannot accrete unboundedly,
//since confirmation or explicit discard clears them deterministically. So the
//count may exceed the cap while saves are paused. Stamped drafts consume
//slots first; unstamped drafts get whatever budget remains, and only they are
//eligible victims, oldest first. Because excess is measured against the
//UNSTAMPED budget (never the raw total), the victim slice can never wrap
//around to swallow the whole unstamped list — the newest unstamped draft
//survives whenever the budget is at least 1. And when stamped drafts alone
//fill the cap (budget 0, every unstamped draft over budget),
//justPersistedCardID shields the slot that was just written. Together those
//make the invariant unconditional: the just-persisted draft is never the one
//evicted.
export const enforceEditDraftSlotCap = (justPersistedCardID? : CardID) => {
	const drafts = readEditDrafts();
	const stamped = drafts.filter(draft => draft.operationID);
	const unstamped = drafts.filter(draft => !draft.operationID);
	//Clamped: an over-cap stamped population must not drive the budget
	//negative and inflate excess past the unstamped count.
	const unstampedBudget = Math.max(0, MAX_EDIT_DRAFT_SLOTS - stamped.length);
	const excess = unstamped.length - unstampedBudget;
	if (excess <= 0) return;
	//unstamped is newest-first, so the last `excess` entries are the oldest.
	for (const stale of unstamped.slice(-excess)) {
		if (stale.cardID === justPersistedCardID) continue;
		try {
			localStorage.removeItem(draftKey(stale.cardID));
		} catch {
			//Best effort.
		}
	}
};

const announceDraftChanged = () => window.dispatchEvent(new CustomEvent(EDIT_DRAFT_CHANGED_EVENT));

const persistDraft = (draft : StoredEditDraft) => {
	try {
		//Enforce the cap only when this persist CREATES a slot: rewriting an
		//existing slot cannot change the slot count, and enforcement re-reads
		//(and JSON.parses) every stored draft — far too heavy to run on every
		//200ms debounce tick of an editing session.
		const key = draftKey(draft.cardID);
		const createsSlot = localStorage.getItem(key) === null;
		localStorage.setItem(key, JSON.stringify(draft));
		if (createsSlot) enforceEditDraftSlotCap(draft.cardID);
	} catch (err) {
		//Quota or disabled storage. Unguarded, this threw from inside a
		//setTimeout and from the preserve-for-save handler, which skipped
		//stampDraftForSave and left a stale "unsaved draft available" banner
		//after a SUCCESSFUL save. Draft recovery degrades; nothing else should.
		console.warn('Could not persist the edit draft for recovery:', err);
		return;
	}
	announceDraftChanged();
};

//With a cardID: clear only that card's slot — the ONLY form the watcher and
//the save-confirmation path may use, so one card's teardown can never
//destroy another card's parked draft (#766). Without: clear everything (the
//user's explicit discard-all, and account hygiene).
export const clearEditDraft = (cardID? : CardID) => {
	try {
		if (cardID !== undefined) {
			localStorage.removeItem(draftKey(cardID));
		} else {
			localStorage.removeItem(EDIT_DRAFT_STORAGE_KEY);
			for (const key of Object.keys(localStorage)) {
				if (key.startsWith(EDIT_DRAFT_STORAGE_PREFIX)) localStorage.removeItem(key);
			}
		}
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
	const draft = readEditDraft(identity.cardID);
	if (!draft || draft.cardID !== identity.cardID || draft.uid !== selectUid(currentState())) return;
	persistDraft({...draft, operationID: identity.operationID});
};

let installed = false;
let writeTimer : number | undefined;
//WHICH card's session is dirty, not just whether one is: the dirty->clean
//clear must target that card's slot alone (#766).
let previousDirtyCardID : CardID | '' = '';
//When set, the next dirty->clean transition keeps the persisted draft instead of
//clearing it. The watcher cannot tell a user CHOOSING to discard from the app
//tearing the editor down underneath them: both arrive as EDITING_FINISH. Set
//this before any programmatic teardown so the user's work survives it.
let preserveDraftThroughNextFinish = false;

//Call immediately BEFORE dispatching EDITING_FINISH for any reason that is not
//the user electing to discard their edits (ownership loss, tab supersession,
//auth scope change). Without it, purgeAndDeactivate's EDITING_FINISH made the
//watcher see dirty->clean and delete the localStorage draft — destroying
//unsaved work with no confirmation, in exactly the involuntary paths where the
//user never got a choice.
export const preserveEditDraftThroughTeardown = () => {
	//Flush synchronously first: the debounced write may not have landed yet, so
	//the most recent keystrokes would otherwise not be in the draft we keep.
	flushPendingDraft();
	preserveDraftThroughNextFinish = true;
};

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
			//Only remove a draft when an active editing session became clean —
			//and only THAT session's card's draft: another card's parked draft
			//(e.g. stamped for a paused save) is not this session's to delete.
			//A fresh page must retain the prior session's recoverable draft.
			if (previousDirtyCardID && !preserveDraftThroughNextFinish) clearEditDraft(previousDirtyCardID);
			preserveDraftThroughNextFinish = false;
			previousDirtyCardID = '';
			return;
		}
		previousDirtyCardID = card ? card.id : '';
		if (writeTimer !== undefined) window.clearTimeout(writeTimer);
		writeTimer = window.setTimeout(() => {
			writeTimer = undefined;
			writeDraftForState(currentState());
		}, 200);
	});
	window.addEventListener('storage', event => {
		if (event.key === EDIT_DRAFT_STORAGE_KEY || event.key?.startsWith(EDIT_DRAFT_STORAGE_PREFIX)) announceDraftChanged();
	});
	window.addEventListener('card-web-preserve-edit-draft-for-save', event => {
		flushPendingDraft();
		stampDraftForSave((event as CustomEvent<SingleSaveIdentity>).detail || null);
		previousDirtyCardID = '';
	});
	window.addEventListener('card-web-single-save-confirmed', event => {
		const confirmation = (event as CustomEvent<SingleSaveIdentity>).detail || null;
		//Only the exact operation that preserved this draft may clear it — and
		//only its own card's slot. An unrelated permissions save—or a late
		//acknowledgement—must leave it alone.
		if (confirmation && draftMatchesConfirmedSave(readEditDraft(confirmation.cardID), confirmation)) clearEditDraft(confirmation.cardID);
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

export const recoverEditDraft = async (cardID? : CardID) : Promise<void> => {
	//With a cardID (the banner names the draft it is showing): that exact
	//slot. Without: the newest draft belonging to this account.
	const draft = cardID !== undefined
		? readEditDraft(cardID)
		: readEditDrafts().find(candidate => candidate.uid === selectUid(currentState())) ?? null;
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

import {
	slugLegal
} from './database.js';

import {
	TypedObject
} from '../../shared/typed_object.js';

import {
	db,
	deepEqualIgnoringTimestamps,
	serverTimestampSentinel
} from '../firebase.js';

import {
	doc,
	getDoc,
	getDocFromServer,
	getDocs,
	query,
	where,
	orderBy,
	collection,
	arrayUnion,
	arrayRemove,
	deleteField,
	serverTimestamp,
	Timestamp
} from 'firebase/firestore';

import {
	navigateToCardInCurrentCollection,
	navigateToCollection,
	navigateToNextCard
} from './app.js';

import {
	closeMultiEditDialog,
	openMultiEditDialog,
} from './multiedit.js';

import {
	editingFinish,
	slugAdded,
	tagAdded
} from './editor.js';

import {
	newID,
	idWasVended,
	normalizeSlug,
	createSlugFromArbitraryString,
	stripEphemeralCardFields,
} from '../util.js';

import {
	corpusWorkerOwnsCardIngestion
} from '../corpus-mode.js';

import {
	perfEnabled
} from '../perf.js';

import {
	ensureAuthor
} from './comments.js';

import {
	clearSelectedCards,
	doSelectCards,
	refreshCardSelector,
	updateCollectionSnapshot,
} from './collection.js';

import {
	selectActiveSectionId,
	selectUid,
	selectUser,
	selectUserIsAdmin,
	selectFilters,
	selectCards,
	selectDataIsFullyLoaded,
	selectCardIDsUserMayEdit,
	selectLastSectionID,
	getUserMayEditSection,
	selectUserMayCreateCard,
	selectPendingNewCardIDToNavigateTo,
	selectIsEditing,
	selectActiveCardID,
	getReasonUserMayNotDeleteCard,
	selectPendingDeletions,
	selectCardModificationPending,
	getCardById,
	selectMultiEditDialogOpen,
	selectSortOrderForGlobalAppend,
	getSortOrderImmediatelyAdjacentToCard,
	selectUserMayReorderActiveCollection,
	selectActiveCollectionDescription,
	selectRawCards,
	getUserMayEditTag,
	selectEditingCard,
	selectEnqueuedCards,
	selectPendingModificationCount,
	selectExpectedCardFetchTypeForNewUnpublishedCard,
	selectUserMayViewUnpublished,
} from '../selectors.js';

import {
	INVERSE_FILTER_NAMES,
	SET_NAMES,
	SORT_URL_KEYWORD,
	CONFIGURABLE_FILTER_URL_PARTS,
	collectionDescription,
	SELECTED_FILTER_NAME,
} from '../filters.js';

import {
	PERMISSION_EDIT_CARD
} from '../permissions.js';

import {
	CARD_TYPE_CONFIGURATION,
	DEFAULT_CARD_TYPE,
	KEY_CARD_ID_PLACEHOLDER,
	editableFieldsForCardType,
	sortOrderIsDangerous,
	isNewCardIDPlaceholder,
	DEFAULT_SORT_ORDER_INCREMENT,
	COLORS
} from '../../shared/card_fields.js';

import {
	CARDS_COLLECTION,
	CARD_UPDATES_COLLECTION,
	SECTION_UPDATES_COLLECTION,
	SECTIONS_COLLECTION,
	TAGS_COLLECTION,
	TAG_UPDATES_COLLECTION,
	TOMBSTONES_COLLECTION,
	TWEETS_COLLECTION,
} from '../../shared/collection-constants.js';

import {
	EMPTY_CARD_ID
} from '../card_fields.js';

import {
	cardWithNormalizedTextProperties
} from '../nlp.js';

import {
	ngrams,
	CURRENT_NLP_VERSION,
	nlpSourceFingerprintForCard
} from '../../shared/nlp.js';

import type {
	NLPTokenStorage,
	CardFieldType
} from '../../shared/types.js';

import {
	UPDATE_SERVER_IDF
} from '../actions.js';

import {
	cardDiffHasChanges,
	validateCardDiff,
	applyCardDiff,
	applyCardFirebaseUpdate,
	inboundLinksUpdates,
	generateFinalCardDiff,
} from '../card_diff.js';

import {
	CARD_TYPE_EDITING_FINISHERS
} from '../card_finishers.js';

import {
	references,
} from '../references.js';

import {
	AppThunkDispatch,
	ThunkSomeAction,
	store
} from '../store.js';

import {
	MultiBatch,
	MultiBatchCommitError
} from '../multi_batch.js';

import {
	recoveryIDsForGroupOutcomes,
	rollbackCardsStillOptimistic
} from '../edit-recovery.js';

import {
	State,
	CardDiff,
	Card,
	Cards,
	CardID,
	CardUpdate,
	CardType,
	UserInfo,
	SectionID,
	Slug,
	TagID,
	Sections,
	AuthorsMap,
	Tags,
	CreateCardOpts,
	TweetMap,
	CardFetchType,
	CardFlags,
	Filters,
} from '../types.js';

import {
	COMMITTED_PENDING_FILTERS_WHEN_FULLY_LOADED,
	EXPECTED_NEW_CARD_FAILED,
	EXPECT_CARD_DELETIONS,
	EXPECT_NEW_CARD,
	EXPECT_FETCHED_CARDS,
	MODIFY_CARD,
	MODIFY_CARD_FAILURE,
	MODIFY_CARD_SUCCESS,
	BULK_TAG_OPERATION_PROGRESS,
	NAVIGATED_TO_NEW_CARD,
	REMOVE_CARDS,
	REORDER_STATUS,
	SET_PENDING_SLUG,
	SomeAction,
	TWEETS_LOADING,
	UPDATE_AUTHORS,
	UPDATE_CARDS,
	UPDATE_SECTIONS,
	UPDATE_TAGS,
	UPDATE_TWEETS,
	ENQUEUE_CARD_UPDATES,
	BULK_IMPORT_PENDING,
	BULK_IMPORT_SUCCESS,
	CLEAR_ENQUEUED_CARD_UPDATES,
	ECHO_LOCAL_CARD_MODIFICATIONS,
	RECONCILE_CARDS_AFTER_FAILED_COMMIT
} from '../actions.js';

//map of cardID => promiseResolver that's waiting
const waitingForCards : {[id : CardID]: ((card : Card) => void)[]} = {};

const waitingForCardToExistStoreUpdated = () => {
	let itemDeleted = false;
	for (const cardID of Object.keys(waitingForCards)) {
		const card = getCardById(store.getState() as State, cardID);
		if (!card) continue;
		for (const promiseResolver of waitingForCards[cardID]) {
			promiseResolver(card);
		}
		delete waitingForCards[cardID];
		itemDeleted = true;
	}
	if (itemDeleted && Object.keys(waitingForCards).length == 0) {
		if (unsubscribeFromStore) unsubscribeFromStore();
		unsubscribeFromStore = null;
	}
};


let unsubscribeFromStore : (() => void) | null = null;

//returns a promise that will be resolved when a card with that ID exists, returning the card.
export const waitForCardToExist = (cardID : CardID) => {
	const card = getCardById(store.getState() as State, cardID);
	if (card) return Promise.resolve(card);
	if (!waitingForCards[cardID]) waitingForCards[cardID] = [];
	if (!unsubscribeFromStore) unsubscribeFromStore = store.subscribe(waitingForCardToExistStoreUpdated);
	const promise = new Promise<Card>((resolve) => {
		waitingForCards[cardID].push(resolve);
	});
	return promise;
};

//When a new tag is created, it is randomly assigned one of these values.
const TAG_COLORS = Object.values(COLORS);

export const modifyCard = (card : Card, update : CardDiff, substantive = false) => {
	return modifyCardsWithDurableMultiEdit([card], update, substantive, 'single');
};

export const modifyCards = (cards : Card[], update : CardDiff, substantive = false, failOnError = false) => {
	const updates = Object.fromEntries(cards.map(card => [card.id, update]));
	return modifyCardsIndividually(cards, updates, substantive, failOnError);
};

// Large label sweeps are the common multi-edit case and need stronger
// guarantees than a best-effort collection of independent Firestore batches.
// Persist the immutable intent locally before the first write, then commit
// small, idempotent chunks. A reload or ownership transfer on this browser can
// safely retry any chunk whose acknowledgement was lost.
const BULK_TAG_OPERATION_STORAGE_KEY = 'card-web-pending-bulk-tag-operation-v1';
const DURABLE_MULTI_EDIT_STORAGE_KEY = 'card-web-pending-multi-edit-v1';

//An in-memory request may have paused while its durable intent remains. UI
//entry points use this in addition to Redux's active-request flag so a user
//cannot begin a second edit that the serialized mutation runner cannot yet
//accept. Treat unreadable storage as pending: the recovery UI must resolve it
//explicitly rather than risking an overlapping edit.
export const durableCardMutationPending = () : boolean => {
	if (typeof localStorage === 'undefined') return false;
	try {
		return Boolean(
			localStorage.getItem(BULK_TAG_OPERATION_STORAGE_KEY) ||
			localStorage.getItem(DURABLE_MULTI_EDIT_STORAGE_KEY)
		);
	} catch {
		return true;
	}
};
// 30 cards cost ~184 effective operations. This remains atomic even when the
// SDK sentinel detector fails closed to MultiBatch's supported 249-op limit.
// Non-admin rules can spend one access call/card, so use an even smaller chunk.
//Rules evaluate card-scoped permission helpers for both the card and audit
//document. Even admins can therefore spend one distinct access call/card;
//stay under Firestore's 20-call atomic-operation ceiling for every role.
const BULK_TAG_ADMIN_CHUNK_SIZE = 15;
const BULK_TAG_EDITOR_CHUNK_SIZE = 15;

type BulkTagOperation = {
	version: 1,
	id: string,
	uid: string,
	tag: TagID,
	adding: boolean,
	targetIDs: CardID[],
	nextIndex: number,
};

let bulkTagOperationRunning = false;
let bulkTagResumeAttemptedThisPage = false;

const readBulkTagOperation = () : BulkTagOperation | null => {
	if (typeof localStorage === 'undefined') return null;
	const raw = localStorage.getItem(BULK_TAG_OPERATION_STORAGE_KEY);
	if (!raw) return null;
	try {
		const value = JSON.parse(raw) as BulkTagOperation;
		if (value.version !== 1 || !value.id || !value.uid || !value.tag ||
			typeof value.adding !== 'boolean' || !Array.isArray(value.targetIDs) ||
			!Number.isInteger(value.nextIndex) || value.nextIndex < 0 || value.nextIndex > value.targetIDs.length ||
			value.targetIDs.some(id => typeof id !== 'string' || !id) ||
			new Set(value.targetIDs).size !== value.targetIDs.length) throw new Error('invalid shape');
		return value;
	} catch (err) {
		throw new Error(`The saved bulk-label operation is corrupt and was not discarded: ${err}`);
	}
};

const persistBulkTagOperation = (operation : BulkTagOperation) => {
	if (typeof localStorage === 'undefined') throw new Error('Bulk label edits require durable browser storage');
	localStorage.setItem(BULK_TAG_OPERATION_STORAGE_KEY, JSON.stringify(operation));
};

const clearBulkTagOperation = () => {
	if (typeof localStorage !== 'undefined') localStorage.removeItem(BULK_TAG_OPERATION_STORAGE_KEY);
};

const bulkTagProgressAction = (operation : BulkTagOperation) : SomeAction => ({
	type: BULK_TAG_OPERATION_PROGRESS,
	total: operation.targetIDs.length,
	completed: operation.nextIndex,
	tag: operation.tag,
	adding: operation.adding,
	description: `${operation.adding ? 'Adding' : 'Removing'} “${operation.tag}”`,
	serverConfirmed: true,
});

export const modifyCardsWithDurableTagOperation = (cards : Card[], tag : TagID, adding : boolean) : ThunkSomeAction => async (dispatch, getState) => {
	if (bulkTagOperationRunning) return;
	bulkTagOperationRunning = true;
	bulkTagResumeAttemptedThisPage = true;
	let operation : BulkTagOperation | null = null;
	try {
		const state = getState();
		const uid = selectUid(state);
		if (!uid) throw new Error('You must be signed in to modify labels');
		operation = readBulkTagOperation();
		let checkingServerMarker = Boolean(operation);
		if (!operation && readDurableMultiEdit()) throw new Error('Finish the pending multi-edit before starting another operation');
		if (operation && operation.uid !== uid) {
			throw new Error('A bulk-label operation from another account is pending in this browser. Sign back into that account to finish it.');
		}
		if (!operation) {
			//A heterogeneous selection is the normal UI case. Persist and audit only
			//cards whose current label state actually needs the requested transform;
			//arrayUnion/arrayRemove would be state-idempotent but would still bump
			//updated and create misleading history for already-matching cards.
			const cardsNeedingChange = cards.filter(card => adding
				? !(card.tags || []).includes(tag)
				: (card.tags || []).includes(tag));
			dispatch(modifyCardAction(cardsNeedingChange.length));
			operation = {
				version: 1,
				id: `bulk-tag-${Date.now()}-${newID()}`,
				uid,
				tag,
				adding,
				targetIDs: cardsNeedingChange.map(card => card.id),
				nextIndex: 0,
			};
			// This is the write-ahead record: no server mutation may happen first.
			persistBulkTagOperation(operation);
		} else if (operation.tag !== tag || operation.adding !== adding) {
			throw new Error(`Finish the pending ${operation.adding ? 'add' : 'remove'} “${operation.tag}” operation before starting another bulk edit.`);
		}
		if (!operation.targetIDs.length) {
			clearBulkTagOperation();
			dispatch(modifyCardAction(0));
			dispatch(modifyCardSuccess(0));
			return;
		}

		dispatch(modifyCardAction(operation.targetIDs.length));
		dispatch(bulkTagProgressAction(operation));
		const remaining = operation.targetIDs.slice(operation.nextIndex);
		const chunkSize = selectUserIsAdmin(getState()) ? BULK_TAG_ADMIN_CHUNK_SIZE : BULK_TAG_EDITOR_CHUNK_SIZE;
		let tagPreflightComplete = false;
		for (let offset = 0; offset < remaining.length; offset += chunkSize) {
			const chunkIDs = remaining.slice(offset, offset + chunkSize);
			const chunkStart = operation.nextIndex;
			const markerRef = doc(db, 'users', operation.uid, 'multi_edit_chunks', `${operation.id}-${chunkStart}`);
			if (checkingServerMarker) {
				const marker = await getDocFromServer(markerRef);
				checkingServerMarker = false;
				if (marker.exists() && marker.data().operation_id === operation.id &&
					marker.data().next_index === chunkStart + chunkIDs.length) {
					operation.nextIndex += chunkIDs.length;
					persistBulkTagOperation(operation);
					dispatch(bulkTagProgressAction(operation));
					continue;
				}
			}
			// Check completion first. A chunk may have committed before this tab
			// lost its acknowledgement; a later label deletion or permission
			// change must not prevent us from recognizing that durable marker.
			if (!tagPreflightComplete) {
				const tagSnapshot = await getDocFromServer(doc(db, TAGS_COLLECTION, operation.tag));
				if (!tagSnapshot.exists()) throw new Error(`The “${operation.tag}” label no longer exists`);
				if (!getUserMayEditTag(getState(), operation.tag)) throw new Error(`You do not have permission to edit the “${operation.tag}” label`);
				tagPreflightComplete = true;
			}
			const currentState = getState();
			if (selectUid(currentState) !== operation.uid) throw new Error('Account changed while the bulk-label operation was running');
			const rawCards = selectRawCards(currentState);
			const chunkCards = chunkIDs.map(id => rawCards[id]);
			const missingIDs = chunkIDs.filter((_, index) => !chunkCards[index]);
			if (missingIDs.length) throw new Error(`Cannot safely continue: ${missingIDs.length} target cards are not loaded (${missingIDs.slice(0, 3).join(', ')}${missingIDs.length > 3 ? ', …' : ''})`);

			const batch = new MultiBatch(db);
			batch.beginAtomicGroup(`${operation.id}-${offset}`);
			for (const card of chunkCards as Card[]) {
				if (!selectCardIDsUserMayEdit(currentState)[card.id]) throw new Error(`You no longer have permission to edit ${card.id}`);
				const auditID = `${operation.id}-${card.id}-${operation.adding ? 'add' : 'remove'}`;
				const cardUpdateObject = {
					tags: adding ? arrayUnion(operation.tag) : arrayRemove(operation.tag),
					updated: serverTimestamp(),
				};
				const cardRef = doc(db, CARDS_COLLECTION, card.id);
				batch.update(cardRef, cardUpdateObject);
				//The fast path must preserve the same canonical audit history as an
				//ordinary card edit. Stable operation/card IDs make a retried chunk
				//idempotent if the commit acknowledgement was lost.
				batch.set(doc(cardRef, CARD_UPDATES_COLLECTION, auditID), {
					[adding ? 'add_tags' : 'remove_tags']: [operation.tag],
					batch: operation.id,
					substantive: false,
					timestamp: serverTimestamp(),
				});
				batch.set(doc(db, TAGS_COLLECTION, operation.tag, TAG_UPDATES_COLLECTION, auditID), {
					timestamp: serverTimestamp(),
					[adding ? 'add_card' : 'remove_card']: card.id,
				});
			}
			ensureAuthor(batch, selectUser(currentState) as UserInfo);
			const tagRef = doc(db, TAGS_COLLECTION, operation.tag);
			batch.update(tagRef, {
				cards: adding ? arrayUnion(...chunkIDs) : arrayRemove(...chunkIDs),
				updated: serverTimestamp(),
			});
			batch.set(markerRef, {
				operation_id: operation.id,
				next_index: chunkStart + chunkIDs.length,
				tag: operation.tag,
				adding: operation.adding,
				card_ids: chunkIDs,
				updated: serverTimestamp(),
			});
			batch.endAtomicGroup();
			if (selectUid(getState()) !== operation.uid) throw new Error('Account changed before the next bulk-label chunk could commit');
			await batch.commit();

			operation.nextIndex += chunkIDs.length;
			persistBulkTagOperation(operation);
			dispatch(bulkTagProgressAction(operation));
		}

		clearBulkTagOperation();
		const total = operation.targetIDs.length;
		if (total > 1) alert(`${operation.adding ? 'Added' : 'Removed'} “${operation.tag}” ${operation.adding ? 'to' : 'from'} ${total} cards.`);
		dispatch(modifyCardSuccess(total));
	} catch (err) {
		const error = err instanceof Error ? err : new Error(String(err));
		const completed = operation?.nextIndex || 0;
		const total = operation?.targetIDs.length || 0;
		const detail = total ? ` ${completed} of ${total} cards are server-confirmed; ${total - completed} remain safely retryable.` : '';
		dispatch(modifyCardFailure(new Error(`Bulk-label save paused.${detail} ${error.message}`)));
		const enqueuedUpdates = selectEnqueuedCards(getState());
		if (Object.values(enqueuedUpdates).some(cards => Object.keys(cards).length)) dispatch(updateEnqueuedCards());
		if (operation) dispatch(bulkTagProgressAction(operation));
	} finally {
		bulkTagOperationRunning = false;
	}
};

const resumePendingBulkTagOperation = () : ThunkSomeAction => async (dispatch, getState) => {
	if (bulkTagResumeAttemptedThisPage || bulkTagOperationRunning || !selectDataIsFullyLoaded(getState())) return;
	try {
		const operation = readBulkTagOperation();
		if (!operation) {
			await dispatch(resumePendingDurableMultiEdit());
			return;
		}
		if (operation.uid !== selectUid(getState())) return;
		bulkTagResumeAttemptedThisPage = true;
		dispatch(openMultiEditDialog());
		const rawCards = selectRawCards(getState());
		await dispatch(modifyCardsWithDurableTagOperation(
			operation.targetIDs.map(id => rawCards[id]).filter((card): card is Card => Boolean(card)),
			operation.tag,
			operation.adding,
		));
	} catch (err) {
		bulkTagResumeAttemptedThisPage = true;
		dispatch(modifyCardFailure(err instanceof Error ? err : new Error(String(err))));
	}
};

export const retryPendingBulkTagOperation = () : ThunkSomeAction => async (dispatch, getState) => {
	if (bulkTagOperationRunning) return;
	let operation : BulkTagOperation | null;
	try {
		const pending = readBulkTagOperation();
		if (!pending) {
			await dispatch(resumePendingDurableMultiEdit(true));
			return;
		}
		operation = pending;
	} catch (err) {
		dispatch(modifyCardFailure(err instanceof Error ? err : new Error(String(err))));
		return;
	}
	const rawCards = selectRawCards(getState());
	await dispatch(modifyCardsWithDurableTagOperation(
		operation.targetIDs.map(id => rawCards[id]).filter((card): card is Card => Boolean(card)),
		operation.tag,
		operation.adding,
	));
};

export const abandonPendingBulkTagOperation = () : ThunkSomeAction => (dispatch) => {
	const operation = readBulkTagOperation();
	if (!operation) {
		const generic = readDurableMultiEdit();
		if (!generic) return;
		const remaining = generic.targetIDs.length - generic.nextIndex;
		if (!confirm(`Stop this operation? ${generic.nextIndex} cards were processed safely and this operation will not attempt the remaining ${remaining}. This cannot undo confirmed changes.`)) return;
		clearDurableMultiEdit();
		dispatch(modifyCardSuccess(0));
		return;
	}
	const remaining = operation.targetIDs.length - operation.nextIndex;
	if (!confirm(`Stop this operation? ${operation.nextIndex} cards are server-confirmed and ${remaining} will be left unchanged. This cannot undo the confirmed changes.`)) return;
	clearBulkTagOperation();
	dispatch(modifyCardSuccess(0));
};

type DurableMultiEdit = {
	version: 1,
	id: string,
	uid: string,
	targetIDs: CardID[],
	nextIndex: number,
	modifiedCount: number,
	update: CardDiff,
	substantive?: boolean,
	kind?: 'single' | 'multi',
};

let durableMultiEditRunning = false;

const readDurableMultiEdit = () : DurableMultiEdit | null => {
	if (typeof localStorage === 'undefined') return null;
	const raw = localStorage.getItem(DURABLE_MULTI_EDIT_STORAGE_KEY);
	if (!raw) return null;
	try {
		const value = JSON.parse(raw) as DurableMultiEdit;
		if (value.version !== 1 || !value.id || !value.uid || !Array.isArray(value.targetIDs) ||
			!Number.isInteger(value.nextIndex) || value.nextIndex < 0 || value.nextIndex > value.targetIDs.length ||
			!Number.isInteger(value.modifiedCount) || value.modifiedCount < 0 || value.modifiedCount > value.nextIndex ||
			!value.update || typeof value.update !== 'object' || Array.isArray(value.update) ||
			value.targetIDs.some(id => typeof id !== 'string' || !id) || new Set(value.targetIDs).size !== value.targetIDs.length) {
			throw new Error('invalid shape');
		}
		return value;
	} catch (err) {
		throw new Error(`The saved multi-edit operation is corrupt and was not discarded: ${err}`);
	}
};

const persistDurableMultiEdit = (operation : DurableMultiEdit) => {
	if (typeof localStorage === 'undefined') throw new Error('Multi-edit requires browser storage');
	localStorage.setItem(DURABLE_MULTI_EDIT_STORAGE_KEY, JSON.stringify(operation));
};

const clearDurableMultiEdit = () => {
	if (typeof localStorage !== 'undefined') localStorage.removeItem(DURABLE_MULTI_EDIT_STORAGE_KEY);
};

const durableMultiEditProgress = (operation : DurableMultiEdit) : SomeAction => ({
	type: BULK_TAG_OPERATION_PROGRESS,
	total: operation.targetIDs.length,
	completed: operation.nextIndex,
	tag: '',
	adding: true,
	description: 'Saving multi-edit',
	serverConfirmed: false,
});

export const modifyCardsWithDurableMultiEdit = (cards : Card[], update : CardDiff, substantive = false, kind : 'single' | 'multi' = 'multi') : ThunkSomeAction => async (dispatch, getState) => {
	if (durableMultiEditRunning || bulkTagOperationRunning) return;
	durableMultiEditRunning = true;
	let operation : DurableMultiEdit | null = null;
	try {
		const uid = selectUid(getState());
		if (!uid) throw new Error('You must be signed in to modify cards');
		if (readBulkTagOperation()) throw new Error('Finish the pending label operation before starting another multi-edit');
		operation = readDurableMultiEdit();
		let checkingServerMarker = Boolean(operation);
		if (operation && operation.uid !== uid) throw new Error('A multi-edit from another account is pending in this browser');
		if (!operation) {
			const targetIDs = cards.map(card => card.id);
			if (kind === 'single' && targetIDs.length !== 1) throw new Error('A single-card save must contain exactly one card');
			operation = {version: 1, id: `${kind}-edit-${Date.now()}-${newID()}`, uid, targetIDs, nextIndex: 0, modifiedCount: 0, update, substantive, kind};
			persistDurableMultiEdit(operation);
			//The write-ahead intent is durable now. Release the blocking editor
			//immediately, retain its draft until server confirmation, and report
			//truthfully as Saving rather than Saved.
			if (kind === 'single' && selectIsEditing(getState())) {
				window.dispatchEvent(new CustomEvent('card-web-preserve-edit-draft-for-save'));
				dispatch(editingFinish());
			}
		} else if (JSON.stringify(operation.update) !== JSON.stringify(update) ||
			JSON.stringify(operation.targetIDs) !== JSON.stringify(cards.map(card => card.id)) ||
			Boolean(operation.substantive) !== substantive || (operation.kind || 'multi') !== kind) {
			throw new Error('A different multi-edit is already pending. Retry or stop that saved operation first.');
		}
		dispatch(modifyCardAction(operation.targetIDs.length));
		dispatch(durableMultiEditProgress(operation));

		while (operation.nextIndex < operation.targetIDs.length) {
			const chunkStart = operation.nextIndex;
			const markerRef = doc(db, 'users', operation.uid, 'multi_edit_chunks', `${operation.id}-${chunkStart}`);
			if (checkingServerMarker) {
				const marker = await getDocFromServer(markerRef);
				checkingServerMarker = false;
				const markerNextIndex = marker.data()?.next_index;
				const markerModifiedCount = marker.data()?.modified_count;
				if (marker.exists() && marker.data().operation_id === operation.id &&
					Number.isInteger(markerNextIndex) && markerNextIndex > chunkStart && markerNextIndex <= operation.targetIDs.length &&
					Number.isInteger(markerModifiedCount) && markerModifiedCount >= 0 && markerModifiedCount <= markerNextIndex - chunkStart) {
					operation.nextIndex = markerNextIndex;
					operation.modifiedCount += markerModifiedCount;
					persistDurableMultiEdit(operation);
					dispatch(durableMultiEditProgress(operation));
					continue;
				}
			}
			let candidateSize = Math.min(10, operation.targetIDs.length - operation.nextIndex);
			let batch : MultiBatch | null = null;
			let chunkIDs : CardID[] = [];
			let modifiedCount = 0;
			while (candidateSize >= 1) {
				chunkIDs = operation.targetIDs.slice(operation.nextIndex, operation.nextIndex + candidateSize);
				const authoritative = await authoritativeCardsAfterFailedCommit(chunkIDs);
				if (authoritative.failedIDs.length || authoritative.removedIDs.length) throw new Error(`Could not load ${authoritative.failedIDs.length + authoritative.removedIDs.length} target cards`);
				const state = getState();
				batch = new MultiBatch(db, `${operation.id}-${operation.nextIndex}`);
				modifiedCount = 0;
				for (const id of chunkIDs) {
					batch.beginAtomicGroup(id);
					//A normal one-card editor save retains the canonical per-card and
					//section/tag audit documents and all derived finisher fields. The
					//Dialog multi-edit still uses explicit fields so unrelated finisher output
					//cannot leak into the operation. It must retain the normal audit records:
					//the chunk marker is a recovery checkpoint, not a replacement for the
					//canonical card/tag history read by the rest of the application. Candidate
					//sizing below keeps that complete atomic group within Firestore's limit.
					const compactMultiEdit = operation.kind !== 'single';
					const modified = await modifyCardWithBatch(state, authoritative.cards[id], operation.update, Boolean(operation.substantive), batch, undefined, undefined, false, compactMultiEdit, false);
					if (modified) {
						batch.endAtomicGroup();
						modifiedCount++;
					} else {
						batch.abortAtomicGroup();
					}
				}
				if (modifiedCount) {
					batch.beginAtomicGroup();
					ensureAuthor(batch, selectUser(state) as UserInfo);
					batch.endAtomicGroup();
				}
				batch.beginAtomicGroup();
				batch.set(markerRef, {
					operation_id: operation.id,
					next_index: chunkStart + chunkIDs.length,
					modified_count: modifiedCount,
					card_ids: chunkIDs,
					update: operation.update,
					updated: serverTimestamp(),
				});
				batch.endAtomicGroup();
				if (batch.pendingUnderlyingBatchCount <= 1) break;
				if (candidateSize === 1) throw new Error(`The edit to ${chunkIDs[0]} exceeds Firestore's atomic batch limit`);
				candidateSize = Math.max(1, Math.floor(candidateSize / 2));
			}
			if (!batch) throw new Error('Could not prepare a safe multi-edit batch');
			if (selectUid(getState()) !== operation.uid) throw new Error('Account changed before the next multi-edit chunk could commit');
			await batch.commit();
			operation.nextIndex += chunkIDs.length;
			operation.modifiedCount += modifiedCount;
			persistDurableMultiEdit(operation);
			dispatch(durableMultiEditProgress(operation));
		}
		clearDurableMultiEdit();
		if (operation.kind === 'single') window.dispatchEvent(new CustomEvent('card-web-single-save-confirmed'));
		if (operation.targetIDs.length > 1) alert(`${operation.modifiedCount} cards modified.${operation.targetIDs.length - operation.modifiedCount ? ` ${operation.targetIDs.length - operation.modifiedCount} already matched.` : ''}`);
		dispatch(modifyCardSuccess(operation.modifiedCount));
	} catch (err) {
		const error = err instanceof Error ? err : new Error(String(err));
		const completed = operation?.nextIndex || 0;
		const total = operation?.targetIDs.length || 0;
		dispatch(modifyCardFailure(new Error(`Multi-edit paused. ${completed} of ${total} cards were processed safely; ${total - completed} remain retryable. ${error.message}`), true));
		const enqueued = selectEnqueuedCards(getState());
		if (Object.values(enqueued).some(group => Object.keys(group).length)) dispatch(updateEnqueuedCards());
		if (operation) dispatch(durableMultiEditProgress(operation));
	} finally {
		durableMultiEditRunning = false;
	}
};

const resumePendingDurableMultiEdit = (force = false) : ThunkSomeAction => async (dispatch, getState) => {
	if (durableMultiEditRunning || bulkTagOperationRunning || (!force && !selectDataIsFullyLoaded(getState()))) return;
	try {
		const operation = readDurableMultiEdit();
		if (!operation || operation.uid !== selectUid(getState())) return;
		if (operation.kind !== 'single') dispatch(openMultiEditDialog());
		const raw = selectRawCards(getState());
		await dispatch(modifyCardsWithDurableMultiEdit(
			operation.targetIDs.map(id => raw[id]).filter((card): card is Card => Boolean(card)),
			operation.update,
			Boolean(operation.substantive),
			operation.kind || 'multi',
		));
	} catch (err) {
		const error = err instanceof Error ? err : new Error(String(err));
		if (/corrupt/.test(error.message) && confirm(`${error.message}\n\nDiscard this unreadable saved operation? This may leave already-completed changes in place.`)) {
			clearDurableMultiEdit();
			return;
		}
		dispatch(modifyCardFailure(error));
	}
};

// Resume from the readiness transition itself; card delivery is not
// necessarily the last thing that makes the corpus ready (tags, permissions,
// or sections may arrive later). Also retry a paused transient failure when
// this browser comes back online.
let bulkTagResumeWatcherInstalled = false;
export const installBulkTagResumeWatcher = () => {
	if (bulkTagResumeWatcherInstalled) return;
	bulkTagResumeWatcherInstalled = true;
	let readinessWasLive = selectDataIsFullyLoaded(store.getState() as State);
	const scheduleResume = () => setTimeout(() => {
		void store.dispatch(resumePendingBulkTagOperation());
	}, 0);
	store.subscribe(() => {
		const ready = selectDataIsFullyLoaded(store.getState() as State);
		if (ready && !readinessWasLive) scheduleResume();
		readinessWasLive = ready;
	});
	if (readinessWasLive) scheduleResume();
	window.addEventListener('online', () => {
		bulkTagResumeAttemptedThisPage = false;
		scheduleResume();
	});
};

//Bound one-document server reads so a failed very-large multi-edit doesn't
//turn recovery into an unbounded burst. Individual reads work for users whose
//rules permit particular unpublished cards but not an arbitrary ID query.
const FAILED_COMMIT_RECONCILIATION_CONCURRENCY = 20;

const authoritativeCardsAfterFailedCommit = async (cardIDs: CardID[]) => {
	const cards: Cards = {};
	const removedIDs: CardID[] = [];
	const failedIDs: CardID[] = [];
	for (let index = 0; index < cardIDs.length; index += FAILED_COMMIT_RECONCILIATION_CONCURRENCY) {
		const ids = cardIDs.slice(index, index + FAILED_COMMIT_RECONCILIATION_CONCURRENCY);
		const results = await Promise.allSettled(ids.map(id => getDocFromServer(doc(db, CARDS_COLLECTION, id))));
		results.forEach((result, resultIndex) => {
			const id = ids[resultIndex];
			if (result.status === 'rejected') {
				failedIDs.push(id);
				return;
			}
			if (!result.value.exists()) {
				removedIDs.push(id);
				return;
			}
			//Keep the complete server document for the worker reconciliation.
			//nlp_search_tokens are intentionally ephemeral in Redux, but they are
			//the worker search index's authoritative input.
			cards[id] = {...result.value.data({serverTimestamps: 'estimate'}), id} as Card;
		});
	}
	return {cards, removedIDs, failedIDs};
};

export const modifyCardsIndividually = (cards : Card[], updates : {[id : CardID] : CardDiff}, substantive = false, failOnError = false) : ThunkSomeAction => async (dispatch, getState) => {
	const state = getState();
	const startingUid = selectUid(state);
	const startingMayViewUnpublished = selectUserMayViewUnpublished(state);
	const startingScope = {uid: startingUid, mayViewUnpublished: startingMayViewUnpublished};

	if (selectCardModificationPending(state)) {
		console.log('Can\'t modify card; another card is being modified.');
		return;
	}

	cards.forEach((card) => {
		if (!updates[card.id]) {
			//We throw even if failOnError is false because this is something that affects all cards
			throw new Error(`Missing update for ${card.id}`);
		}
	});

	dispatch(modifyCardAction(Object.keys(updates).length));

	const batch = new MultiBatch(db);
	let modifiedCount = 0;
	let errorCount = 0;
	const localEchoes : Cards = {};
	const echoIDsByCard: {[id: CardID]: CardID[]} = {};

	for (const card of cards) {

		if (!card || !card.id) {
			console.log('No id on card');
			if (failOnError) {
				//MODIFY_CARD was already dispatched: returning without a
				//SUCCESS/FAILURE leaves pendingModifications latched true
				//forever, silently rejecting every future save until reload.
				dispatch(modifyCardFailure(new Error('No id on card'), true));
				return;
			}
			continue;
		}

		const update = updates[card.id];

		//This shouldn't happen since we verified it above, but tell typescript
		//we know there's an update.
		if (!update) continue;

		batch.beginAtomicGroup(card.id);
		try {
			//Stage this card's materialized echoes separately. If validation or
			//atomic-group placement fails, none of its optimistic state may leak
			//into the successfully prepared cards.
			const cardEchoes: Cards = {};
			const modified = await modifyCardWithBatch(state, card, update, substantive, batch, cardEchoes, localEchoes, false);
			if (modified) {
				batch.endAtomicGroup();
				Object.assign(localEchoes, cardEchoes);
				echoIDsByCard[card.id] = Object.keys(cardEchoes);
				modifiedCount++;
			} else {
				batch.abortAtomicGroup();
			}
		} catch (err) {
			batch.abortAtomicGroup();
			console.warn('Couldn\'t modify card: ' + err);
			errorCount++;
			if (failOnError) {
				dispatch(modifyCardFailure(err));
				return;
			}
		}
	}
	if (modifiedCount > 0) {
		//The author record describes the acting user, not an individual card.
		//Writing the same hot document once per selected card made a 60k-card
		//multi-edit perform 60k redundant writes.
		batch.beginAtomicGroup();
		ensureAuthor(batch, selectUser(state) as UserInfo);
		batch.endAtomicGroup();
	}

	//Optimistic echo (worker modes only, inside echoLocalCardModifications):
	//apply the materialized post-write cards NOW, before the server ack —
	//the same latency compensation Firestore's own listeners give off mode.
	//Snapshot the pre-write cards first so a failed commit can roll back.
	let priorCards : Cards | null = null;
	if (modifiedCount > 0 && Object.keys(localEchoes).length) {
		const rawCards = selectRawCards(getState());
		priorCards = {};
		for (const id of Object.keys(localEchoes)) {
			if (rawCards[id]) priorCards[id] = rawCards[id];
		}
		await dispatch(echoLocalCardModifications(localEchoes, startingScope));
	}

	try {
		await batch.commit();
	} catch(err) {
		const currentState = getState();
		if (selectUid(currentState) !== startingUid ||
			selectUserMayViewUnpublished(currentState) !== startingMayViewUnpublished) {
			//Never replay optimistic or queued data from a more privileged auth
			//scope into the newly restricted store.
			dispatch(modifyCardFailure(new Error('Couldn\'t save card after account permissions changed: ' + err)));
			return;
		}
		const {ambiguousIDs, failedOnlyIDs} = recoveryIDsForGroupOutcomes(
			echoIDsByCard,
			err instanceof MultiBatchCommitError ? err.succeededGroupIDs : [],
			err instanceof MultiBatchCommitError ? err.failedGroupIDs : Object.keys(echoIDsByCard),
		);

		//A failed underlying Firestore batch is atomic, so cards touched only by
		//failed groups need no billed reread. Restore them if their exact local
		//optimistic version is still current; listener-delivered versions win.
		if (priorCards && failedOnlyIDs.length) {
			const failedOnlySet = new Set(failedOnlyIDs);
			const rollbackPrior = Object.fromEntries(Object.entries(priorCards).filter(([id]) => failedOnlySet.has(id))) as Cards;
			const optimisticForComparison = Object.fromEntries(Object.entries(localEchoes)
				.filter(([id]) => failedOnlySet.has(id))
				.map(([id, card]) => [id, stripEphemeralCardFields(card)])) as Cards;
			const rollbackCards = rollbackCardsStillOptimistic(
				rollbackPrior,
				optimisticForComparison,
				selectRawCards(getState()),
				(current, optimistic) => deepEqualIgnoringTimestamps(current, optimistic) &&
					current.updated instanceof Timestamp && optimistic.updated instanceof Timestamp &&
					current.updated.isEqual(optimistic.updated),
			);
			if (Object.keys(rollbackCards).length) await dispatch(echoLocalCardModifications(rollbackCards, startingScope));
		}

		//MultiBatch may have partially succeeded. After it has fully settled,
		//only cards composed from BOTH successful and failed atomic groups are
		//uncertain. Force-read those and install exactly what the server has.
		const authoritative = await authoritativeCardsAfterFailedCommit(ambiguousIDs);
		if (authoritative.failedIDs.length) {
			console.warn(`Couldn't reconcile ${authoritative.failedIDs.length} cards after a failed commit; live listeners remain the fallback.`);
		}
		//Fail FIRST: MODIFY_CARD_FAILURE zeroes the enqueue gate, so the
		//authoritative server cards below direct-apply instead of stranding
		//in the queue (where they'd sit while the worker corpus was already
		//corrected — main/worker divergence at the moment we claim to
		//install server truth).
		dispatch(modifyCardFailure(new Error('Couldn\'t save card: ' + err)));
		//Flush anything the failed cycle stranded in the queue (including
		//the rollback echoes above, which enqueue-merged over the phantom
		//optimistic entries) BEFORE applying server truth, so server wins.
		if (Object.values(selectEnqueuedCards(getState())).some(cards => Object.keys(cards).length)) {
			dispatch(updateEnqueuedCards());
		}
		if (Object.keys(authoritative.cards).length || authoritative.removedIDs.length) {
			dispatch({
				type: RECONCILE_CARDS_AFTER_FAILED_COMMIT,
				cards: authoritative.cards,
				removedIDs: authoritative.removedIDs,
			});
			const published: Cards = {};
			const unpublished: Cards = {};
			for (const card of Object.values(authoritative.cards)) {
				const reduxCard = stripEphemeralCardFields(card);
				if (card.published) published[card.id] = reduxCard;
				else unpublished[card.id] = reduxCard;
			}
			if (Object.keys(published).length) dispatch(receiveCards(published, 'published'));
			if (Object.keys(unpublished).length) dispatch(receiveCards(unpublished, 'unpublished'));
			if (authoritative.removedIDs.length) dispatch({type: REMOVE_CARDS, cardIDs: authoritative.removedIDs});
		}
		return;
	}

	if (modifiedCount > 1 || errorCount > 0) alert(`${modifiedCount} cards modified.${errorCount > 0 ? ` ${errorCount} cards errored. See the console for details.` : ''}`);

	dispatch(modifyCardSuccess(modifiedCount));
};

//In worker modes the card-listener echo takes a full server round trip
//through the worker's separate connection (and its Listen stream may be
//mid-recovery), so nothing latency-compensates a just-committed write the
//way the main thread's own listeners would in off mode. This applies the
//materialized post-write cards locally, and forwards them (unstripped, so
//the worker keeps its search tokens) to the worker via the action tap so its
//corpus doesn't serve stale collections meanwhile. When the real echo
//eventually arrives, receiveCards' timestamp-ignoring dedupe drops it. No-op
//outside worker modes.
const LOCAL_ECHO_WORKER_CHUNK_SIZE = 500;

type EchoAuthScope = {uid : string, mayViewUnpublished : boolean};

const echoLocalCardModifications = (localEchoes : Cards, expectedScope? : EchoAuthScope) => async (dispatch: AppThunkDispatch, getState : () => State): Promise<void> => {
	if (!corpusWorkerOwnsCardIngestion()) return;
	const scopeStillCurrent = () => !expectedScope || (
		selectUid(getState()) === expectedScope.uid &&
		selectUserMayViewUnpublished(getState()) === expectedScope.mayViewUnpublished
	);
	const entries = Object.entries(localEchoes);
	if (!entries.length) return;
	const published : Cards = {};
	const unpublished : Cards = {};
	for (let index = 0; index < entries.length; index += LOCAL_ECHO_WORKER_CHUNK_SIZE) {
		if (!scopeStillCurrent()) return;
		const chunk = entries.slice(index, index + LOCAL_ECHO_WORKER_CHUNK_SIZE);
		dispatch({type: ECHO_LOCAL_CARD_MODIFICATIONS, cards: Object.fromEntries(chunk)});
		for (const [, echoCard] of chunk) {
			const stripped = stripEphemeralCardFields(echoCard);
			if (echoCard.published) published[echoCard.id] = stripped;
			else unpublished[echoCard.id] = stripped;
		}
		//toWire + postMessage structured-clone this chunk synchronously. Yield
		//between chunks so a corpus-wide multi-edit cannot monopolize the UI.
		if (index + LOCAL_ECHO_WORKER_CHUNK_SIZE < entries.length) {
			await new Promise<void>(resolve => setTimeout(resolve, 0));
		}
	}
	if (!scopeStillCurrent()) return;
	if (Object.keys(published).length) dispatch(receiveCards(published, 'published'));
	if (Object.keys(unpublished).length) dispatch(receiveCards(unpublished, 'unpublished'));
};

//returns true if a modificatioon was made to the card, or false if it was a no
//op. When an error is thrown, that's an implied 'false'. If echoCards is
//provided, the locally-materialized post-write cards (the modified card plus
//any cards whose inbound links changed) are accumulated into it, so callers
//can apply them without waiting for the server echo.
export const modifyCardWithBatch = async (state : State, card : Card, rawUpdate : CardDiff, substantive : boolean, batch : MultiBatch, echoCards? : Cards, priorEchoCards? : Cards, ensureAuthorForCard = true, explicitFieldsOnly = false, skipAudit = false) : Promise<boolean> => {

	//If there aren't any updates to a card, that's OK. This might happen in a
	//multiModify where some cards already have the items, for example.
	if (!cardDiffHasChanges(rawUpdate)) return false;

	const user = selectUser(state);

	if (!user) {
		throw new Error('No user');
	}

	if (!selectCardIDsUserMayEdit(state)[card.id]) {
		throw new Error('User isn\'t allowed to edit the given card');
	}

	//This is where cardFinishers and fontSizeBoosts are actually applied.
	let update = await generateFinalCardDiff(state, card, rawUpdate);
	// A dialog multi-edit promises to touch only the fields the user selected.
	// Card-type finishers are still run for validation/no-op normalization, but
	// derived edits to unrelated fields (notably working-notes/quote titles)
	// must not leak into a label, TODO, reference, or publication operation.
	if (explicitFieldsOnly) {
		update = Object.fromEntries(TypedObject.entries(update).filter(([field]) => field in rawUpdate)) as CardDiff;
	}
	//Finalization removes redundant set-like changes (for example, adding a
	//tag the card already has). Do not create audit entries or bump `updated`
	//for a true no-op.
	if (!cardDiffHasChanges(update)) return false;

	const updateObject = {
		...update,
		batch: batch.batchID || '',
		substantive: substantive,
		timestamp: serverTimestamp()
	};

	//validateDiff might throw, but that's OK, because we also throw
	const sectionUpdated = validateCardDiff(state, card, update);

	const cardUpdateObject = applyCardDiff(card, update);
	// Preserve unrelated concurrent set/map edits. The generic diff materializer
	// normally emits the complete tags array / TODO override map; multi-edit
	// intentions are safely expressible as Firestore transforms and dotted
	// fields. Mixed tag removals/additions are emitted as two ordered writes in
	// the same atomic batch below, rather than replacing the whole array.
	const hasMixedTagChanges = Boolean(update.add_tags?.length && update.remove_tags?.length);
	if (update.add_tags?.length && !update.remove_tags?.length) cardUpdateObject.tags = arrayUnion(...update.add_tags);
	if (update.remove_tags?.length && !update.add_tags?.length) cardUpdateObject.tags = arrayRemove(...update.remove_tags);
	if (update.auto_todo_overrides_enablements?.length || update.auto_todo_overrides_disablements?.length || update.auto_todo_overrides_removals?.length) {
		delete cardUpdateObject.auto_todo_overrides;
		for (const todo of update.auto_todo_overrides_enablements || []) cardUpdateObject[`auto_todo_overrides.${todo}`] = true;
		for (const todo of update.auto_todo_overrides_disablements || []) cardUpdateObject[`auto_todo_overrides.${todo}`] = false;
		for (const todo of update.auto_todo_overrides_removals || []) cardUpdateObject[`auto_todo_overrides.${todo}`] = deleteField();
	}
	cardUpdateObject.updated = serverTimestamp();
	if (substantive) cardUpdateObject.updated_substantive = serverTimestamp();

	//Generate NLP tokens if content fields have changed
	const contentFieldsChanged = update.title !== undefined ||
			update.body !== undefined ||
			update.commentary !== undefined ||
			update.subtitle !== undefined ||
			update.title_alternates !== undefined ||
			update.external_link !== undefined;

	if (contentFieldsChanged) {
		//Create a temporary updated card for NLP processing
		const tempUpdatedCard = applyCardFirebaseUpdate(card, cardUpdateObject);

		//Process the card to generate NLP tokens
		//Pass empty maps for fallbackText, importantNgrams, and synonyms
		const processedCard = cardWithNormalizedTextProperties(tempUpdatedCard, {}, {}, {});

		//Convert ProcessedRunInterface to ProcessedRunStorage for Firestore
		//Only store normalized + uppercaseRanges; stemmed and withoutStopWords
		//are derived at load time since the stemmer is deterministic and cheap.
		const nlpTokens : NLPTokenStorage = {};
		for (const [fieldName, runs] of TypedObject.entries(processedCard.nlp)) {
			nlpTokens[fieldName as CardFieldType] = runs.map(run => ({
				normalized: run.normalized,
				...(run.uppercaseRanges ? { uppercaseRanges: run.uppercaseRanges } : {})
			}));
		}

		//Generate nlp_search_tokens: flat array of deduplicated stemmed
		//unigrams + bigrams for server-side array-contains queries
		const searchTokenSet = new Set<string>();
		for (const [, runs] of TypedObject.entries(processedCard.nlp)) {
			if (!runs) continue;
			for (const run of runs) {
				//Add individual stemmed words
				for (const word of run.stemmed.split(' ')) {
					if (word) searchTokenSet.add(word);
				}
				//Add bigrams
				for (const bigram of ngrams(run.stemmed, 2)) {
					searchTokenSet.add(bigram);
				}
			}
		}

			//Add NLP data to card update
			cardUpdateObject.nlp_tokens = nlpTokens;
			cardUpdateObject.nlp_search_tokens = Array.from(searchTokenSet);
			cardUpdateObject.nlp_source_fingerprint = nlpSourceFingerprintForCard(tempUpdatedCard);
			cardUpdateObject.nlp_version = CURRENT_NLP_VERSION;
		}

	//A prior card in this multi-edit may already have changed this card's
	//inbound references. Compose the visible echo on top of that state while
	//the Firestore transforms themselves remain queued independently.
	const updatedCard = applyCardFirebaseUpdate(priorEchoCards?.[card.id] || card, cardUpdateObject);
	const inboundUpdates = inboundLinksUpdates(card.id, card, updatedCard);

	if (echoCards) {
		echoCards[card.id] = updatedCard;
		const rawCards = selectRawCards(state);
		for (const [otherCardID, otherCardUpdate] of TypedObject.entries(inboundUpdates)) {
			//Base each materialization on any echo already accumulated this
			//batch, so successive updates touching the same card compose.
			const base = echoCards[otherCardID] || priorEchoCards?.[otherCardID] || rawCards[otherCardID];
			if (!base) continue;
			echoCards[otherCardID] = applyCardFirebaseUpdate(base, otherCardUpdate);
		}
	}

	const cardRef = doc(db, CARDS_COLLECTION, card.id);

	const updateRef = doc(cardRef, CARD_UPDATES_COLLECTION, `${batch.batchID}-${card.id}`);

	if (!skipAudit) batch.set(updateRef, updateObject);
	if (hasMixedTagChanges) {
		// Keep cardUpdateObject intact for the materialized local/worker card
		// above, but never send its stale complete tags array to Firestore.
		const cardWriteObject = {...cardUpdateObject};
		delete cardWriteObject.tags;
		batch.update(cardRef, cardWriteObject);
		batch.update(cardRef, {tags: arrayRemove(...(update.remove_tags || [])), updated: serverTimestamp()});
		batch.update(cardRef, {tags: arrayUnion(...(update.add_tags || [])), updated: serverTimestamp()});
	} else {
		batch.update(cardRef, cardUpdateObject);
	}

	for (const [otherCardID, otherCardUpdate] of TypedObject.entries(inboundUpdates)) {
		const ref = doc(db, CARDS_COLLECTION, otherCardID);
		batch.update(ref, otherCardUpdate);
	}

	if (ensureAuthorForCard) ensureAuthor(batch, user);

	if (sectionUpdated) {
		//Need to update the section objects too.
		const newSection = cardUpdateObject.section;
		if (newSection) {
			const newSectionRef = doc(db, SECTIONS_COLLECTION, newSection);
			const newSectionUpdateRef = doc(newSectionRef, SECTION_UPDATES_COLLECTION, `${batch.batchID}-${card.id}-add`);
			const newSectionObject = {
				cards: arrayUnion(card.id),
				updated: serverTimestamp()
			};
			const newSectionUpdateObject = {
				timestamp: serverTimestamp(),
				add_card: card.id
			};
			batch.update(newSectionRef, newSectionObject);
			if (!skipAudit) batch.set(newSectionUpdateRef, newSectionUpdateObject);
		}
		const oldSection = card.section;
		if (oldSection) {
			const oldSectionRef = doc(db, SECTIONS_COLLECTION, oldSection);
			const oldSectionUpdateRef = doc(oldSectionRef, SECTION_UPDATES_COLLECTION, `${batch.batchID}-${card.id}-remove`);
			const oldSectionObject = {
				cards: arrayRemove(card.id),
				updated: serverTimestamp()
			};
			const oldSectionUpdateObject = {
				timestamp: serverTimestamp(),
				remove_card: card.id
			};
			batch.update(oldSectionRef, oldSectionObject);
			if (!skipAudit) batch.set(oldSectionUpdateRef, oldSectionUpdateObject);
		}
	}

	if (update.add_tags && update.add_tags.length) {
		//Note: similar logic is replicated in createForkedCard
		for (const tagName of update.add_tags) {
			const tagRef = doc(db, TAGS_COLLECTION, tagName);
			// Date.now() alone collides for many cards prepared in the same
			// millisecond, silently overwriting tag history. Operation + card is
			// unique and stable for this logical batch.
			const tagUpdateRef = doc(tagRef, TAG_UPDATES_COLLECTION, `${batch.batchID}-${card.id}-add`);
			const newTagObject = {
				cards: arrayUnion(card.id),
				updated: serverTimestamp()
			};
			const newTagUpdateObject = {
				timestamp: serverTimestamp(),
				add_card: card.id
			};
			batch.update(tagRef, newTagObject);
			if (!skipAudit) batch.set(tagUpdateRef, newTagUpdateObject);
		}
	}

	if (update.remove_tags && update.remove_tags.length) {
		for (const tagName of update.remove_tags) {
			const tagRef = doc(db, TAGS_COLLECTION, tagName);
			const tagUpdateRef = doc(tagRef, TAG_UPDATES_COLLECTION, `${batch.batchID}-${card.id}-remove`);
			const newTagObject = {
				cards: arrayRemove(card.id),
				updated: serverTimestamp()
			};
			const newTagUpdateObject = {
				timestamp: serverTimestamp(),
				remove_card: card.id
			};
			batch.update(tagRef, newTagObject);
			if (!skipAudit) batch.set(tagUpdateRef, newTagUpdateObject);
		}
	}

	return true;

};

//beforeID is the ID of hte card we should place ourselves immediately before.
export const reorderCard = (cardID : CardID, otherID: CardID, isAfter : boolean) : ThunkSomeAction => async (dispatch, getState) => {

	const state = getState();

	if (!cardID) {
		console.log('That card isn\'t valid');
		return;
	}

	if (cardID == otherID) {
		console.log('Dropping into the same position it is now, which is a no op');
		return;
	}

	if (!selectUserMayReorderActiveCollection(state)) {
		console.log('Reordering the current collection is not allowed');
		return;
	}

	const collectionDescription = selectActiveCollectionDescription(state);

	if (collectionDescription.sortReversed) isAfter = !isAfter;

	const newSortOrder = getSortOrderImmediatelyAdjacentToCard(state, otherID, !isAfter);

	if (sortOrderIsDangerous(newSortOrder)) {
		console.warn('Dangerous sort order proposed: ', newSortOrder, ' See issue #199');
		return;
	}

	dispatch(reorderStatus(true));

	const batch = new MultiBatch(db);
	const update = {
		sort_order: newSortOrder,
	};

	const cards = selectCards(state);
	const card = cards[cardID];

	const localEchoes : Cards = {};

	//The await matters: modifyCardWithBatch queues its writes after its first
	//internal await, so an un-awaited call commits an EMPTY batch and the
	//reorder silently never persists. The try matters too: a throw from
	//inside (permission check, diff validation) would otherwise leave
	//pendingReorder latched true forever.
	try {
		await modifyCardWithBatch(state, card, update, false, batch, localEchoes);
		await batch.commit();
	} catch(err) {
		console.warn(err);
		dispatch(reorderStatus(false));
		return;
	}
	dispatch(reorderStatus(false));

	//In off mode firestore's latency compensation tells the store
	//automatically; in worker modes apply the local echo ourselves (see
	//modifyCardsIndividually).
	await dispatch(echoLocalCardModifications(localEchoes));
};

const setPendingSlug = (slug : Slug) : SomeAction => {
	return {
		type:SET_PENDING_SLUG,
		slug
	};
};

const addLegalSlugToCard = (cardID : CardID, legalSlug : Slug, setName? : boolean) : Promise<void> => {
	//legalSlug must already be verified to be legal.
	const batch = new MultiBatch(db);
	const cardRef = doc(db, CARDS_COLLECTION, cardID);
	const update : CardUpdate = {
		slugs: arrayUnion(legalSlug),
		updated: serverTimestamp(),
	};
	if (setName) update.name = legalSlug;
	batch.update(cardRef, update);
	return batch.commit();
};

export const addSlug = (cardId : CardID, newSlug : Slug) : ThunkSomeAction => async (dispatch, getState) => {
 
	newSlug = normalizeSlug(newSlug);

	if (!newSlug) {
		console.log('Must provide a legal slug');
		return;
	}

	const state = getState();
	const editingCard = selectEditingCard(state);
	if (!editingCard) throw new Error('No editing card');
	const isEditingCard = editingCard.id == cardId;

	//slugLegal is a http callable, and it might take multiple seconds if the
	//cloud function is cold.
	dispatch(setPendingSlug(newSlug));

	let result;
	try {
		result = await slugLegal(newSlug);
	} catch(err) {
		dispatch(setPendingSlug(''));
		console.warn(err);
		return;
	}

	if (!result.legal) {
		alert('Couldn\'t add slug: ' + result.reason);
		dispatch(setPendingSlug(''));
		return;
	}

	await addLegalSlugToCard(cardId, newSlug, false);

	dispatch(setPendingSlug(''));

	if (isEditingCard) {
		//We're editing this card, update it in the state.
		dispatch(slugAdded(newSlug));
	}

};

const reservedCollectionName = (state : State, name : string) : boolean => {

	if (!selectDataIsFullyLoaded(state)) {
		console.warn('Sections not loaded');
		return true;
	}

	if (name == SORT_URL_KEYWORD) return true;
	if (name == KEY_CARD_ID_PLACEHOLDER) return true;
	if (isNewCardIDPlaceholder(name)) return true;

	//Filters already contains section names if data is fully loaded.
	const filters = selectFilters(state) || {};

	const keys = [...Object.keys(filters), ...Object.keys(INVERSE_FILTER_NAMES), ...SET_NAMES, ...Object.keys(CONFIGURABLE_FILTER_URL_PARTS)];

	for (const key of keys) {
		if (name == key) return true;
	}
	return false;
};

export const createTag = (name : TagID, displayName : string) : ThunkSomeAction => async (dispatch, getState) => {

	if (!name) {
		console.warn('No short name provided');
		return;
	}

	name = normalizeSlug(name);

	const state = getState();

	if (reservedCollectionName(state, name)) {
		console.warn('That name is reserved');
		return;
	}

	if (!name) {
		console.warn('Tag name invalid');
		return;
	}

	if (!displayName) {
		console.warn('No short name provided');
		return;
	}

	const user = selectUser(state);

	if (!user) {
		console.warn('No user logged in');
		return;
	}

	if (!selectUserIsAdmin(state)) {
		console.log('User isn\'t admin!');
		return;
	}

	const tagRef = doc(db, TAGS_COLLECTION, name);

	const tag = await getDoc(tagRef);

	if (tag.exists()) {
		console.warn('A tag with that name already exists');
		return;
	}

	const startCardId = 'tag-' + name;
	const startCardRef = doc(db, CARDS_COLLECTION, startCardId);

	const card = await getDoc(startCardRef);

	if (card.exists()) {
		console.warn('A card with that id already exists');
		return;
	}

	//Randomly pick a tag color to start with. If an admin wants to edit it they
	//can just edit it by hand in the DB.
	const color = TAG_COLORS[Math.floor(Math.random() * TAG_COLORS.length)];

	const batch = new MultiBatch(db);

	batch.set(tagRef, {
		cards: [],
		start_cards: [startCardId],
		title:displayName,
		updated: serverTimestamp(),
		color: color,
	});

	const cardObject = defaultCardObject(startCardId, user, '', 'section-head', selectSortOrderForGlobalAppend(state));
	cardObject.title = displayName;
	cardObject.subtitle = displayName + ' is a topical tag';
	cardObject.published = true;

	batch.set(startCardRef, cardObject);

	batch.commit().then(() => dispatch(tagAdded(name)));

};

//This omits fields that are already covered in defaultCardObject's arguments
const CARD_FIELDS_TO_COPY_ON_FORK : Partial<Record<keyof Card, true>> = {
	permissions: true,
	title: true,
	body: true,
	references_info: true,
	references: true,
	font_size_boost: true,
	notes: true,
	todo: true,
	tags: true,
};

//exported entireoly for initialSetUp in maintence.js
export const defaultCardObject = (id : CardID, user : UserInfo, section : SectionID, cardType : CardType, sortOrder : number) : Card => {
	return {
		id : '?DEFAULT-INVALID-ID?',
		created: serverTimestampSentinel(),
		updated: serverTimestampSentinel(),
		author: user.uid,
		permissions: {
			[PERMISSION_EDIT_CARD]: [],
		},
		collaborators: [],
		updated_substantive: serverTimestampSentinel(),
		updated_message: serverTimestampSentinel(),
		star_count: 0,
		star_count_manual: 0,
		tweet_favorite_count: 0,
		tweet_retweet_count: 0,
		thread_count: 0,
		thread_resolved_count: 0,
		sort_order: sortOrder,
		title: '',
		section: section,
		body: '',
		references: {},
		references_info: {},
		references_inbound: {},
		references_info_inbound: {},
		flags: {},
		font_size_boost: {},
		card_type: cardType,
		notes: '',
		todo: '',
		slugs: [],
		name: id,
		tags: [],
		published: false,
		images: [],
		auto_todo_overrides: {},
		last_tweeted: Timestamp.fromDate(new Date(0)),
		tweet_count: 0
	};
};

export const bulkCreateWorkingNotes = (bodies : string[], flags? : CardFlags) : ThunkSomeAction => async (dispatch, getState) => {
	const WORKING_NOTES_CONFIG = CARD_TYPE_CONFIGURATION['working-notes'];
	//Sanity check that working-notes is configured in a way we expect.
	if (!WORKING_NOTES_CONFIG) throw new Error('No working notes config');
	if (WORKING_NOTES_CONFIG.publishedByDefault) throw new Error('Working notes are not published by default');
	if (!WORKING_NOTES_CONFIG.orphanedByDefault) throw new Error('Working notes are not orphaned by default');
	const cardFinisher = CARD_TYPE_EDITING_FINISHERS['working-notes'];
	if (!cardFinisher) throw new Error('Working notes didn\'t a card finisher');

	if (bodies.length == 0) return;

	const state = getState();
	if (!selectUserMayCreateCard(state)) throw new Error('User may not create cards');

	const user = selectUser(state);
	if (!user) throw new Error('No user');

	dispatch({
		type: BULK_IMPORT_PENDING
	});

	const batch = new MultiBatch(db);
	ensureAuthor(batch, user);

	const ids : CardID[] = [];

	let sortOrder = selectSortOrderForGlobalAppend(state);

	for (const body of bodies) {
		const id = newID();
		if (sortOrderIsDangerous(sortOrder)) {
			console.warn('Dangerous sort order proposed: ', sortOrder, sortOrder / Number.MAX_VALUE, ' See issue #199');
			return;
		}
		const obj = defaultCardObject(id, user, '', 'working-notes', sortOrder);
		obj.body = body;
		cardFinisher(obj, state);
		if (flags) obj.flags = {...flags};
		batch.set(doc(db, CARDS_COLLECTION, id), obj);
		ids.push(id);
		sortOrder -= DEFAULT_SORT_ORDER_INCREMENT;
	}

	const firstID = ids[0];

	//Tell card-view to expect a new card to be loaded, so the machinery to wait
	//for the new cards works.
	dispatch({
		type: EXPECT_NEW_CARD,
		//We'll only tell it to expect the first one, since they'll all come
		//back in one batch anyway.
		ID: firstID,
		cardType: 'working-notes',
		navigate: false,
		noSectionChange: true,
		cardLoadingChannel: selectExpectedCardFetchTypeForNewUnpublishedCard(state)
	});

	await batch.commit();

	await waitForCardToExist(firstID);

	dispatch(clearSelectedCards());
	dispatch(doSelectCards(ids));
	
	dispatch({
		type: BULK_IMPORT_SUCCESS
	});

	const selectedCards = collectionDescription(SELECTED_FILTER_NAME);
	dispatch(navigateToCollection(selectedCards));

};

//createCard creates an inserts a new card. see also createWorkingNotesCard
//which is similar but simpler.
//Valid arguments of opts:
// cardType: type of card
// section: sectionID to add to
// id: ID to use
// noNavigate: if true, will not navigate to the card when created
// title: title of card

export const createCard = (opts : CreateCardOpts) : ThunkSomeAction => async (dispatch, getState) => {

	//NOTE: if you modify this card you may also want to modify createForkedCard and bulkCreateWorkingNotes

	//newCard creates and inserts a new card in the givne section with the given id.

	const state = getState();

	const user = selectUser(state);

	if (!user) {
		console.log('No user');
		return;
	}

	if (!selectUserMayCreateCard(state)) {
		console.log('User isn\'t allowed to create card');
		return;
	}

	const cardType : CardType = opts.cardType || DEFAULT_CARD_TYPE;

	const CARD_TYPE_CONFIG = CARD_TYPE_CONFIGURATION[cardType] || null;
	if (!CARD_TYPE_CONFIG) {
		console.log('Invalid cardType: ' + cardType);
		return;
	}

	//if section is not provided, use the last section... unless it's a card
	//type that is orphaned by default, in which case we should not put it in a
	//section at all.
	let section = opts.section || '';
	
	if (!section && !CARD_TYPE_CONFIG.orphanedByDefault) {
		section = selectLastSectionID(state);
	}

	if (!section && !CARD_TYPE_CONFIG.orphanedByDefault) {
		console.log('No section identified for a card type that is not orphaned by default');
		return;
	}

	let id = opts.id;
	const idFromOpts = opts.id !== undefined;

	if (id) {
		id = normalizeSlug(id);
	} else {
		id = newID();
	}

	const noNavigate = opts.noNavigate || false;

	let title = opts.title || '';

	if (CARD_TYPE_CONFIG.publishedByDefault && editableFieldsForCardType(cardType).title && !title) {
		const titleFromPrompt = prompt('What should the card\'s title be?');
		if (!titleFromPrompt) {
			console.log('No title provided');
			return;
		}
		title = titleFromPrompt;
	}

	if (section && !getUserMayEditSection(state, section)) {
		console.log('User doesn\'t have edit permission for section the card will be added to.');
		return;
	}

	let sortOrder = selectSortOrderForGlobalAppend(state);
	if (section && selectActiveSectionId(state) == section) {
		sortOrder = getSortOrderImmediatelyAdjacentToCard(state, selectActiveCardID(state), false);
	}

	if (sortOrderIsDangerous(sortOrder)) {
		console.warn('Dangerous sort order proposed: ', sortOrder, sortOrder / Number.MAX_VALUE, ' See issue #199');
		return;
	}

	const obj = defaultCardObject(id, user, section, cardType, sortOrder);
	obj.title = title;
	if (CARD_TYPE_CONFIG.publishedByDefault) obj.published = true;
	if (CARD_TYPE_CONFIG.defaultBody) obj.body = CARD_TYPE_CONFIG.defaultBody;
	if (opts.body !== undefined) obj.body = opts.body;

	const cardFinisher = CARD_TYPE_EDITING_FINISHERS[cardType];

	if (cardFinisher) {
		try {
			cardFinisher(obj, state);
		} catch(err) {
			alert(err);
			console.warn('Card finisher threw an error');
			return;
		}
	}

	const autoSlugConfig = opts.autoSlug !== undefined ? opts.autoSlug : CARD_TYPE_CONFIG.autoSlug;

	let autoSlug = '';
	let fallbackAutoSlug = '';
	if (autoSlugConfig) {
		autoSlug = createSlugFromArbitraryString(title);
		fallbackAutoSlug = normalizeSlug(cardType + '-' + autoSlug);
		if (autoSlugConfig == 'prefixed') {
			//Don't even try the non-card prefixed one.
			autoSlug = fallbackAutoSlug;
			fallbackAutoSlug = '';
		}
	}

	if (CARD_TYPE_CONFIG.publishedByDefault && autoSlugConfig) {
		if (!confirm(`You're creating a card that will be published by default and have its slug set automatically. Is it spelled correctly?\n\nTitle: ${title}\nSlug: ${autoSlug}${fallbackAutoSlug ? `\nAlternate Slug: ${fallbackAutoSlug}` : ''}\n\nDo you want to proceed?`)) {
			console.log('Aborted by user');
			return;
		}
	}

	const cardDocRef = doc(db, CARDS_COLLECTION, id);

	//Tell card-view to expect a new card to be loaded, and when data is
	//fully loaded again, it will then trigger the navigation.
	dispatch({
		type: EXPECT_NEW_CARD,
		ID: id,
		cardType: cardType,
		navigate: !noNavigate,
		noSectionChange: !section,
		cardLoadingChannel: obj.published ? 'published' : selectExpectedCardFetchTypeForNewUnpublishedCard(state)
	});

	if (idFromOpts && !idWasVended(id)) {

		//Checking id is legal is a very expensive operation. If we generated
		//our own id via newID we can just assume it's safe and doesn't conflict
		//with existing ones due to sufficient entropy.

		//Check to make sure the ID is legal. Note that the id and slugs are in the
		//same ID space, so we can reuse slugLegal. Note that slugLegal could take
		//up to 10 seconds to complete if the cloud function is not pre-warmed.
		const result = await slugLegal(id);
		if (!result.legal) {
			console.log('ID is already taken: ' + result.reason);
			if (!noNavigate) {
				//Tell it to not expect the card to be inserted anymore
				dispatch({
					type:EXPECTED_NEW_CARD_FAILED,
				});
			}
			return;
		}
	}

	let autoSlugLegalPromise = null;
	let fallbackAutoSlugLegalPromise = null;
	if (autoSlugConfig) {
		//Kick this off in parallel. We'll await it later.
		autoSlugLegalPromise = slugLegal(autoSlug);
		fallbackAutoSlugLegalPromise = fallbackAutoSlug ?  slugLegal(fallbackAutoSlug) : null;
	}

	const batch = new MultiBatch(db);

	ensureAuthor(batch, user);
	batch.set(cardDocRef, obj);

	if (section) {
		const sectionRef = doc(db, SECTIONS_COLLECTION, obj.section);
		const sectionUpdateRef = doc(sectionRef, SECTION_UPDATES_COLLECTION, '' + Date.now());
		batch.update(sectionRef, {
			cards: arrayUnion(id),
			updated: serverTimestamp(),
		});
		batch.set(sectionUpdateRef, {
			timestamp: serverTimestamp(), 
			add_card: id
		});
	}

	try {
		await batch.commit();
	} catch (err) {
		console.warn(err);
		dispatch({type: EXPECTED_NEW_CARD_FAILED});
		return;
	}

	//updateSections will be called and update the current view. card-view's
	//updated will call navigateToNewCard once the data is fully loaded again
	//(if EXPECT_NEW_CARD was dispatched above). If noSectionChange is true
	//above, it will only wait for the card, not the section, to load.

	if (!autoSlug) return;

	await waitForCardToExist(id);
	const autoSlugLegalResult = await autoSlugLegalPromise;
	const fallbackAutoSlugLegalResult = fallbackAutoSlugLegalPromise ? await fallbackAutoSlugLegalPromise : null;

	if (autoSlugLegalResult && !autoSlugLegalResult.legal) {
		if (!fallbackAutoSlug || (fallbackAutoSlugLegalResult && !fallbackAutoSlugLegalResult.legal)) {
			console.warn(`The autoSlug, ${autoSlug} ${fallbackAutoSlug ? `(and its fallback ${fallbackAutoSlug}) ` : ''}was not legal, so it will not be proposed. Reason: ${autoSlugLegalResult.reason}${fallbackAutoSlugLegalResult ? `and ${fallbackAutoSlugLegalResult.reason}` : ''}`);
			return;
		}
	}

	const slugToUse = (autoSlugLegalResult && autoSlugLegalResult.legal) ? autoSlug : fallbackAutoSlug;

	//Just triple check that we didn't fall back on a non-existent fallbackAutoSlug.
	if (!slugToUse) return;

	try {
		await addLegalSlugToCard(id, slugToUse, true);
	} catch(err) {
		console.warn('Couldn\'t add slug to card: ' + err);
	}

};

export const createForkedCard = (cardToFork : Card | null) : ThunkSomeAction => async (dispatch, getState) => {
	//NOTE: if you modify this card you likely also want to modify
	//createWorkingNotesCard too and likely also createForkedCard

	//newCard creates and inserts a new card in the givne section with the given id.
	if (typeof cardToFork !== 'object' || !cardToFork) {
		console.warn('cardToFork wasn\'t valid object');
		return;
	}

	if (!confirm('This will create a forked copy of the current card. OK?')) return;

	const state = getState();

	const id = newID();

	const section = cardToFork.section;
	const cardType = cardToFork.card_type;

	if (!getUserMayEditSection(state, section)) {
		console.log('User doesn\'t have edit permission for section the card will be added to.');
		return;
	}

	const user = selectUser(state);

	if (!user) {
		console.log('No user');
		return;
	}

	if (!selectUserMayCreateCard(state)) {
		console.log('User isn\'t allowed to create card');
		return;
	}

	const sortOrder = getSortOrderImmediatelyAdjacentToCard(state, cardToFork.id, false);

	const newCard = defaultCardObject(id,user,section,cardType, sortOrder);
	for (const key of TypedObject.keys(CARD_FIELDS_TO_COPY_ON_FORK)) {
		//We can literally leave these as the same object because they'll just
		//be sent to firestore and the actual card we'll store will be new
		
		//eslint-disable-next-line @typescript-eslint/no-explicit-any
		(newCard as any)[key] = cardToFork[key] as any;
	}
	//references accessor will copy the references on setting something
	//If the card we're copying was itself a fork, we want to overwrite that otherwise it gets confusing.
	references(newCard).setCardReferencesOfType('fork-of', [cardToFork.id]);
	references(newCard).setCardReference(cardToFork.id, 'mined-from');

	const inboundUpdates = inboundLinksUpdates(id, null, newCard);

	const illegalTags : {[tag : TagID] : true} = {};
	for (const tag of cardToFork.tags) {
		if (!getUserMayEditTag(state, tag)) illegalTags[tag] = true;
	}

	if (Object.keys(illegalTags).length) {
		const message = 'The card you are forking contains tags (' + Object.keys(illegalTags).join(', ') + ') that you do not have edit access on. Hit OK to fork the card, minus those tags. Hit cancel to abort forking.';
		if (!confirm(message)) {
			console.log('User aborted fork due to illegal tags');
			return;
		}
		//newCard.tags could TECHNICALLY be a FieldValue (e.g. an arrayUnion).
		if (Array.isArray(newCard.tags)) {
			newCard.tags = newCard.tags.filter(tag => !illegalTags[tag]);
		}
	}

	const cardDocRef = doc(db, CARDS_COLLECTION, id);

	//Tell card-view to expect a new card to be loaded, and when data is
	//fully loaded again, it will then trigger the navigation.
	dispatch({
		type: EXPECT_NEW_CARD,
		ID: id,
		cardType: cardType,
		navigate: true,
		noSectionChange: !section,
		cardLoadingChannel: newCard.published ? 'published' : selectExpectedCardFetchTypeForNewUnpublishedCard(state)
	});

	const batch = new MultiBatch(db);
	ensureAuthor(batch, user);

	batch.set(cardDocRef, newCard);

	for (const [otherCardID, otherCardUpdate] of Object.entries(inboundUpdates)) {
		const ref = doc(db, CARDS_COLLECTION, otherCardID);
		batch.update(ref, otherCardUpdate);
	}
	if (Array.isArray(newCard.tags)) {
		for (const tagName of newCard.tags) {
			const tagRef = doc(db, TAGS_COLLECTION, tagName);
			const tagUpdateRef = doc(tagRef, TAG_UPDATES_COLLECTION, '' + Date.now());
			const newTagObject = {
				cards: arrayUnion(id),
				updated: serverTimestamp()
			};
			const newTagUpdateObject = {
				timestamp: serverTimestamp(),
				add_card: id,
			};
			batch.update(tagRef, newTagObject);
			batch.set(tagUpdateRef, newTagUpdateObject);
		}
	}

	if (section) {
		const sectionRef = doc(db, SECTIONS_COLLECTION, newCard.section);
		batch.update(sectionRef, {
			cards: arrayUnion(id),
			updated: serverTimestamp()
		});
		const sectionUpdateRef = doc(sectionRef, SECTION_UPDATES_COLLECTION, '' + Date.now());
		batch.set(sectionUpdateRef, {
			timestamp: serverTimestamp(), 
			add_card: id,
		});
	}

	batch.commit();
	return;


	//updateSections will be called and update the current view. card-view's
	//updated will call navigateToNewCard once the data is fully loaded again
	//(if EXPECT_NEW_CARD was dispatched above)
};

export const deleteCard = (card : Card) : ThunkSomeAction => async (dispatch, getState) => {

	const state = getState();

	const reason = getReasonUserMayNotDeleteCard(state, card);

	if (reason) {
		console.warn(reason);
		return;
	}

	if (!confirm('Are you sure you want to delete this card? This action cannot be undone.')) {
		return;
	}

	//Mark the whole asynchronous delete transaction as in flight, including
	//the reads performed before batch.commit(). The single-tab ownership
	//handoff uses this marker to avoid deactivating a page while it can still
	//issue the delete. A false value below cancels the marker on failure.
	dispatch({type: EXPECT_CARD_DELETIONS, cards: {[card.id]: true}});

	//If editing, cancel editing
	if (selectIsEditing(state)) {
		dispatch(editingFinish());
	}

	if (selectActiveCardID(state) == card.id) {
		//If we're currently selected, then when we're deleted it will say 'no card found'.
		dispatch(navigateToNextCard());
	}

	const batch = new MultiBatch(db);
	const ref = doc(db, CARDS_COLLECTION, card.id);

	//Deletion tombstone, written atomically with the delete: the watermark
	//delta sync can never observe a disappearance (a deleted doc simply
	//stops matching queries), so other devices learn about deletions by
	//listening to this collection. See docs/corpus-sync-design.md.
	//ORDER MATTERS: the tombstone and the card delete are added FIRST so
	//they land in the same underlying WriteBatch — MultiBatch splits at
	//~500 ops and permits partial failure, and a card with hundreds of
	//updates/ subdocs could otherwise push these two into different batches
	//(card deleted, tombstone lost = a permanent ghost on other devices).
	batch.set(doc(db, TOMBSTONES_COLLECTION, card.id), {
		deleted: serverTimestamp(),
		by: selectUid(state),
		published: Boolean(card.published)
	});
	batch.delete(ref);

	try {
		const updates = await getDocs(collection(ref, CARD_UPDATES_COLLECTION));
		for (const update of updates.docs) {
			batch.delete(update.ref);
		}

		//Clean up inbound reference entries on other cards that this card pointed to.
		//Passing null as afterCard makes referencesCardsDiff treat all outbound
		//references as deletions, generating deleteField() updates.
		const inboundUpdates = inboundLinksUpdates(card.id, card, null);
		for (const [otherCardID, otherCardUpdate] of TypedObject.entries(inboundUpdates)) {
			const otherRef = doc(db, CARDS_COLLECTION, otherCardID);
			batch.update(otherRef, otherCardUpdate);
		}

		await batch.commit();
	} catch (error) {
		dispatch({type: EXPECT_CARD_DELETIONS, cards: {[card.id]: false}});
		throw error;
	}

	//The card update will lead to removeCards being called later

};

export const navigateToNewCard = () : ThunkSomeAction => (dispatch, getState) => {
	const ID = selectPendingNewCardIDToNavigateTo(getState());
	if (!ID) return;
	//navigateToNewCard is called when the expected cards/sections are loaded.
	//Ensure that we have the up-to-date sections loaded. The case of adding a
	//card to the current secitno works fine because updateSections will have
	//called refreshCardSelector with force. But it doesn't work automatically
	//for working-notes being added when viewinng working ntoes, since those
	//cards are all oprhaned.
	dispatch(updateCollectionSnapshot());
	//navigateToCard will intiate a chain of actions that culminates in
	//showCard, where we will note that we navigated to new card so we don't do
	//it again.
	dispatch(navigateToCardInCurrentCollection(ID));
};

export const navigatedToNewCard = () : SomeAction => {
	return {
		type:NAVIGATED_TO_NEW_CARD,
	};
};

const modifyCardAction = (modificationCount : number) : SomeAction => {
	return {
		type: MODIFY_CARD,
		modificationCount
	};
};

const modifyCardSuccess = (modificationCount : number) : ThunkSomeAction => (dispatch, getState) => {
	//Durable single-card saves release their own editor immediately after the
	//write-ahead intent is persisted. Do not close whatever editor happens to
	//be open when a later server acknowledgement arrives: it may be a distinct
	//session started after another kind of mutation.
	const state = getState();
	if (selectMultiEditDialogOpen(state)) {
		dispatch(closeMultiEditDialog());
	}
	dispatch({
		type:MODIFY_CARD_SUCCESS,
		modificationCount,
	});
	//Echoes for the committed writes may have arrived (and been enqueued)
	//before the commit resolved. The commit has settled and the reducer just
	//zeroed the gate, so flush whatever is queued unconditionally — an
	//enqueued-count threshold can never be met when dedupe dropped
	//updated-only echoes.
	const enqueuedUpdates = selectEnqueuedCards(getState());
	if (Object.values(enqueuedUpdates).some(cards => Object.keys(cards).length)) {
		dispatch(updateEnqueuedCards());
	}
};

const modifyCardFailure = (err : Error, skipAlert? : boolean) : SomeAction => {
	if (skipAlert) {
		console.warn(err);
	} else {
		alert(err);
	}
	return {
		type: MODIFY_CARD_FAILURE,
		error: err,
	};
};

export const reorderStatus = (pending : boolean) : SomeAction => {
	return {
		type: REORDER_STATUS,
		pending
	};
};

export const updateSections = (sections : Sections) : ThunkSomeAction => (dispatch, getState) => {
	dispatch({
		type: UPDATE_SECTIONS,
		sections,
	});

	//If the update is a single section updating and it's the one currently
	//visible then we should update collections. This could happen for example
	//if a new card is added, or if cards are reordered.
	const currentSectionId = selectActiveSectionId(getState());
	const force = Object.keys(sections).length == 1 && sections[currentSectionId] !== undefined;

	dispatch(refreshCardSelector(force));
};

export const updateAuthors = (authors : AuthorsMap) : ThunkSomeAction => (dispatch, getState) => {

	const state = getState();

	const user = selectUser(state);

	if (user && user.uid) {
		const authorRec = authors[user.uid];
		if (authorRec) {
			if ((!authorRec.displayName || !authorRec.photoURL) && (user.displayName || user.photoURL)) {
				//there's an author rec for our user, but it's missing
				//displayName or photoURL, and we have them. This could happen
				//if a user was manually listed as a collaborator or editor
				//without already being in the authors table. We should ensure
				//author!
				console.log('Saving extra author information because our authors rec was missing it');
				const batch = new MultiBatch(db);
				ensureAuthor(batch, user);
				//don't need to wait for it resolve
				batch.commit();
			}
		}
	}

	dispatch({
		type: UPDATE_AUTHORS,
		authors
	});
};

export const updateTags = (tags : Tags) : ThunkSomeAction => (dispatch) => {
	dispatch({
		type:UPDATE_TAGS,
		tags,
	});
	dispatch(refreshCardSelector(false));
};

type TimestampLike = {seconds : number, nanoseconds : number};

const timestampsEquivalent = (a? : TimestampLike, b? : TimestampLike) : boolean =>
	Boolean(a && b && a.seconds === b.seconds && a.nanoseconds === b.nanoseconds);

//How often the fast dedupe path double-checks itself against the full deep
//equality check.
const FAST_DEDUPE_VALIDATION_RATE = 0.01;

//fastDedupe should be passed only for snapshot deliveries that are expected
//to overwhelmingly redeliver cards we already hold (e.g. the initial
//onSnapshot delivery right after getDocs primed the cache): matching updated
//timestamps are then treated as proof of equivalence, replacing an O(full
//card) deep compare per doc with a two-number compare. A small sample is
//still deep-checked and logged (and applied) on mismatch.
export const receiveCards = (cards: Cards, fetchType : CardFetchType, fastDedupe = false, ownsInput = false, cardFilters? : Filters, cardFilterCorpusIDs? : CardID[]) : ThunkSomeAction => (dispatch, getState) => {
	const startTime = performance.now();
	const existingCards = selectRawCards(getState());
	//A full replacement is safe only when the worker snapshot and the atomic
	//post-action Redux corpus have the exact same ID domain. Otherwise a stale
	//Redux ghost (or a partial prime) would silently disappear from filters
	//before authoritative reconciliation.
	let safeCardFilters : Filters | undefined;
	if (cardFilters && cardFilterCorpusIDs) {
		const existingIDs = Object.keys(existingCards);
		const incomingIDs = Object.keys(cards);
		const combinedCount = existingIDs.length + incomingIDs.filter(id => !existingCards[id]).length;
		if (combinedCount === cardFilterCorpusIDs.length && cardFilterCorpusIDs.every(id => existingCards[id] || cards[id])) {
			safeCardFilters = cardFilters;
		}
	}
	//Worker wire decoding creates a private object for this call. Reuse that
	//object instead of allocating and populating a second ~40k-entry map during
	//the atomic warm-corpus handoff. Other callers retain the non-mutating
	//default because their input ownership is not guaranteed.
	const cardsToUpdate : Cards = ownsInput ? cards : {};
	const inputCount = Object.keys(cards).length;
	for (const card of Object.values(cards)) {
		const existing = existingCards[card.id];
		if (existing) {
			if (fastDedupe && timestampsEquivalent(existing.updated as TimestampLike, card.updated as TimestampLike)) {
				const validate = Math.random() < FAST_DEDUPE_VALIDATION_RATE;
				if (!validate || deepEqualIgnoringTimestamps(existing, card)) {
					if (ownsInput) delete cardsToUpdate[card.id];
					continue;
				}
				console.warn(`[PERF] receiveCards fast dedupe mismatch for ${card.id}; applying update`);
			} else if (deepEqualIgnoringTimestamps(existing, card)) {
				//Check ot see if we already have effectively the same card locally with no notional changes.
				if (ownsInput) delete cardsToUpdate[card.id];
				continue;
			}
		}
		if (!ownsInput) cardsToUpdate[card.id] = card;
	}
	const diffCount = Object.keys(cardsToUpdate).length;
	const diffTime = performance.now() - startTime;
	//Gated: these fired unconditionally on every batch for every user (the
	//review's ambient-noise finding); DEBUG_PERF.enable() turns them on.
	if (perfEnabled()) console.log(`[PERF] receiveCards(${fetchType}): diffed ${inputCount} cards → ${diffCount} changed in ${diffTime.toFixed(1)}ms`);

	const pendingModifications = selectPendingModificationCount(getState());
	if (pendingModifications == 0) {
		//Direct-apply path. These used to ALSO run through the enqueue path,
		//whose flush condition (enqueued >= 0 pending) was always satisfied —
		//so every batch was applied TWICE, doubling the downstream
		//recalculation cascade. The paths are now exclusive; first flush any
		//leftovers a failed/corrected modification cycle stranded in the
		//queue (they're older than this batch, so they apply first).
		const leftovers = selectEnqueuedCards(getState());
		if (Object.values(leftovers).some(cards => Object.keys(cards).length)) {
			dispatch(updateEnqueuedCards());
		}
		dispatch(updateCards(cardsToUpdate, fetchType, safeCardFilters));
	} else {
		dispatch(enqueueCardUpdates(cardsToUpdate, fetchType));
	}
	if (perfEnabled()) console.log(`[PERF] receiveCards(${fetchType}): total ${(performance.now() - startTime).toFixed(1)}ms`);
};

const updateCards = (cards : Cards, fetchType : CardFetchType, cardFilters? : Filters) : ThunkSomeAction => (dispatch) => {
	dispatch({
		type: UPDATE_CARDS,
		cards,
		fetchType,
		cardFilters
	});
	dispatch(refreshCardSelector(false));
};

const enqueueCardUpdates = (cards : Cards, fetchType : CardFetchType) : ThunkSomeAction => (dispatch, getState) => {
	dispatch({
		type: ENQUEUE_CARD_UPDATES,
		cards,
		fetchType
	});

	//Check if we just added enough cards that we were expecting so we can now dispatch all updates.
	const pendingModifications = selectPendingModificationCount(getState());
	const enquedUpdates = selectEnqueuedCards(getState());
	const count = Object.values(enquedUpdates).reduce((acc, val) => acc + Object.keys(val).length, 0);
	if (count >= pendingModifications) {
		dispatch(updateEnqueuedCards());
	}
};

const updateEnqueuedCards = () : ThunkSomeAction => (dispatch, getState) => {
	const enqueuedCards = selectEnqueuedCards(getState());
	//Note: if there were multiple types enqueued, this would lead to extra
	//cachce invalidation for each type. But that should be very uncommon; the
	//most common case is when multiple cards are updated, and they'll all be
	//hit by the same updater.
	for (const fetchType of TypedObject.keys(enqueuedCards)) {
		const cards = enqueuedCards[fetchType];
		if (!cards) continue;
		dispatch(updateCards(cards, fetchType));
	}
	dispatch({
		type: CLEAR_ENQUEUED_CARD_UPDATES,
	});
};

//This number is used in removeCards. it should be large enough that the race
//between queries for published and unpublished cards should have resolved by
//when it fires.
const REMOVE_CARDS_TIMEOUT = 3000;

export const removeCards = (cardIDs : CardID[], unpublished : boolean) : ThunkSomeAction => (dispatch, getState) => {

	//cards that we expected to be deleted won't show up in the other query
	//ever, so we don't have to wait for the timeout and can delete them now.
	//cards that we weren't told were going to be deleted might show up in the
	//other collection, so wait.

	const expectedDeletions = selectPendingDeletions(getState());

	const nonDeletions : CardID[] = [];
	const deletions : CardID[] = [];

	for (const id of cardIDs) {
		if (expectedDeletions[id]) {
			deletions.push(id);
		} else {
			nonDeletions.push(id);
		}
	}

	if (deletions.length) {
		dispatch(actuallyRemoveCards(deletions, unpublished));
	}

	if (nonDeletions.length) {
		setTimeout(() => {
			dispatch(actuallyRemoveCards(nonDeletions, unpublished));
		}, REMOVE_CARDS_TIMEOUT);
	}
};

//actuallyRemoveCards is the meat of removeCards. It goes through and issues a
//REMOVE_CARDS order for any card whose published property equals the opposite
//of unpublished. Notiobally the logic is: there are two types of live card
//queries: one for published and possibly one for unpublished cards. A given
//card might be removed from either set... but in certain cases it might have
//popped IN in the ohter set (e.g. if the published property was changed). We
//avoid the race between it popping out and then popping in by waiting for
//REMOVE_CARDS_TIMEOUT. By the time this fires, the card will have been
//overwritten with whatever the most recent version of the data is from the
//database, either the published or unpublished variety. The unpublished
//parameter says: "The unpublished query wants you to remove this card". If the
//card in the state wasn't put there by the unpublished side when this runs,
//then it shouldn't be removed, because a more recent copy was put there by the
//published side.
const actuallyRemoveCards = (cardIDs : CardID[], unpublished : boolean) : ThunkSomeAction => (dispatch, getState) => {

	const published = !unpublished;
	const cards = selectCards(getState());

	const filteredCardIDs = cardIDs.filter(id => cards[id] ? cards[id].published == published : false);

	//If a card just had its published property changed (meaning it popped from
	//the unpublished to published collection or vice versa), then this would be
	//empty, and no more work is necessary.
	if (!filteredCardIDs.length) return;

	dispatch(cullCards(filteredCardIDs));
};

//This simply culls any cards with matching IDs from the state.
const cullCards = (cardIDs : CardID[]) : SomeAction => {
	return {
		type: REMOVE_CARDS,
		cardIDs
	};
};

export const fetchTweets = (card : Card) : ThunkSomeAction => async (dispatch) => {

	if (!card || Object.values(card).length == 0 || card.id == EMPTY_CARD_ID) return;

	dispatch({
		type: TWEETS_LOADING,
		loading: true,
	});

	//This query requires an index, defined in firestore.indexes.json
	const snapshot = await getDocs(query(collection(db, TWEETS_COLLECTION), where('card', '==', card.id), where('archived', '==', false), orderBy('created', 'desc')));

	if (snapshot.empty) {
		dispatch({
			type: TWEETS_LOADING,
			loading: false,
		});
		return;
	}

	const tweets = Object.fromEntries(snapshot.docs.map(doc => [doc.id, doc.data()])) as TweetMap;

	dispatch({
		type: UPDATE_TWEETS,
		tweets
	});
};

export const expectUnpublishedCards = (fetchType : CardFetchType) : SomeAction => {
	return {
		type: EXPECT_FETCHED_CARDS,
		fetchType
	};
};

//Denotes that we just did a pending filters commit when the data was fully
//loaded... and shouldn't do it again.
export const committedFiltersWhenFullyLoaded = () : SomeAction => {
	return {
		type: COMMITTED_PENDING_FILTERS_WHEN_FULLY_LOADED,
	};
};

/**
 * Loads the server-generated IDF map from Cloud Storage.
 * This is called during app initialization to enable faster fingerprint generation.
 */
export const loadServerIDFMap = () : ThunkSomeAction => async (dispatch) => {
	const { loadServerIDF } = await import('../idf-cache.js');

	const serverIDF = await loadServerIDF();

	dispatch({
		type: UPDATE_SERVER_IDF,
		serverIDF
	});
};

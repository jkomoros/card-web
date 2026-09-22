//The limit that Firebase enacts for writes in one batch. MultiBatch will count
//writes correctly, including double-counting updates that use one of the
//readback sentinels.

import {
	getObjectPath,
	objectPathToValue,
	deepEqual,
} from './util.js';

import {
	installServerTimestamps,
	isServerTimestampSentinel
} from './firebase.js';

import {
	serverTimestamp,
	arrayUnion,
	writeBatch,
	runTransaction,
	Firestore,
	WriteBatch,
	Transaction,
	SetOptions,
	DocumentReference
} from 'firebase/firestore';

import {
	MultiBatchBase,
} from '../shared/multi_batch.js';

export {
	MultiBatchCommitError,
} from '../shared/multi_batch.js';

import {
	CARDS_COLLECTION
} from '../shared/collection-constants.js';

import {
	FirestoreLeafValue
} from './types.js';

import {
	beginMutation,
	trackMutation
} from './mutation-barrier.js';

import {
	NON_AUTOMATIC_MERGE_FIELDS,
	overwrittenCardFields,
	overwriteConflictMessage,
} from './durable-overwrite-guard.js';
import {DEFAULT_IMAGE} from './images.js';

const FIRESTORE_BATCH_LIMIT = 500;

//serverTimestampSentinel is the most basic one.
const SENTINEL_FIELD_PATH = objectPathToValue(serverTimestamp(), 'serverTimestamp');
if (!SENTINEL_FIELD_PATH) throw new Error('no sentinel field path');

const extraOperationCountForValue = (val : unknown) : boolean => {
	//Note: this function is very tied to the implementation of
	//firestore.FieldValue and may need to change if it changes.
	if (typeof val !== 'object') return false;
	if (!val) return false;
	const innerVal = getObjectPath(val, SENTINEL_FIELD_PATH);
	if (!innerVal) {
		//It's not a sentinel itself, but its sub-values could be.
		return Object.values(val).some(item => extraOperationCountForValue(item));
	}
	if (typeof innerVal !== 'string') return false;
	if (innerVal !== 'serverTimestamp' && innerVal !== 'arrayRemove' && innerVal != 'arrayUnion') return false;
	return true;
};

const SENTINEL_DEFINITION_VALID = extraOperationCountForValue(arrayUnion(1));

if (!SENTINEL_DEFINITION_VALID) {
	console.warn('The shape of sentinel values that Multibatch is designed to look for seems to be out of date. That means batch sizes will be smaller than they need to be.');
}

//If we can't detect sentinels correctly, we need to assume that EVERY update double-counts.
const EFFECTIVE_BATCH_LIMIT = SENTINEL_DEFINITION_VALID ? FIRESTORE_BATCH_LIMIT : Math.floor(FIRESTORE_BATCH_LIMIT / 2) - 1;

//THE `updated` INVARIANT (docs/corpus-sync-design.md) is enforced by the
//SHARED base class via the cardWriteGuard config below: set/update THROW on
//any top-level card write that doesn't stamp updated with a serverTimestamp
//sentinel, and updateWithoutTimestampBump (also on the base) admits only
//the audited reader-counter allowlist. Hosting the enforcement in the base
//means the admin-SDK MultiBatch (tools/mount.ts) applies the SAME policy —
//the invariant must not depend on which SDK performs the write.
//
//The POLICY (which paths must bump, the allowlist, the messages) lives in
//the zero-import, unit-tested core in shared/card-write-guard.ts. Here we
//supply only the SDK-specific bit: whether data.updated is a
//serverTimestamp sentinel. isServerTimestampSentinel (./firebase.ts)
//recognizes BOTH the literal serverTimestamp() FieldValue (the modify path)
//AND the serverTimestampSentinel() vended Timestamp (defaultCardObject /
//the create path) — a detector matching only the former throws on every
//card creation.

//MultiBatch is a thing that can be used as a drop-in replacement firebase db
//batch, and will automatically split into multiple underlying batches if it's
//getting close to the limit. Note that unlike a normal batch, it's possible for
//a partial failure if one batch fails and others don't.
type CardFieldGuard = {ref: DocumentReference, base: {[field: string]: unknown}, desired: {[field: string]: unknown}, expected?: {[field: string]: unknown}, groupIDs?: Set<string>};

export class MultiBatch extends MultiBatchBase<WriteBatch, DocumentReference> {
	private _protectedContent: Map<string, CardFieldGuard>;

	constructor(db : Firestore, batchID? : string) {
		const protectedContent = new Map<string, CardFieldGuard>();
		const replay = new WeakMap<WriteBatch, ((transaction: Transaction) => void)[]>();
		const recordContent = (ref: DocumentReference, data: object) => {
			const guard = protectedContent.get(ref.path);
			if (!guard) return;
			for (const [field, value] of Object.entries(data)) {
				if (NON_AUTOMATIC_MERGE_FIELDS[field]) guard.desired[field] = value;
			}
		};
		super({
			createBatch: () => {
				const batch = writeBatch(db);
				replay.set(batch, []);
				return batch;
			},
			batchSet: (batch, ref, data, options?) => {
				batch.set(ref, data, (options as SetOptions) || {});
				replay.get(batch)!.push(transaction => transaction.set(ref, data, (options as SetOptions) || {}));
				recordContent(ref, data);
			},
			batchUpdate: (batch, ref, data) => {
				batch.update(ref, data);
				replay.get(batch)!.push(transaction => transaction.update(ref, data));
				recordContent(ref, data);
			},
			batchDelete: (batch, ref) => {
				batch.delete(ref);
				replay.get(batch)!.push(transaction => transaction.delete(ref));
			},
			commitBatch: async (batch, groupIDs) => {
				const guards = [...protectedContent.values()].filter(guard =>
					(Object.keys(guard.desired).length || Object.keys(guard.expected || {}).length) &&
					(!guard.groupIDs || !groupIDs || groupIDs.some(id => guard.groupIDs!.has(id))));
				if (!guards.length) return batch.commit();
				//Keep the already-planned writes fixed across SDK retries. A
				//transaction retry must re-check content, never silently rebase an
				//older draft onto the newer server value. Read every source before
				//any write, including in split fanout batches; an already-committed
				//prefix is safe only while its source still equals our desired value.
				await trackMutation(() => runTransaction(db, async transaction => {
					const finishAttempt = beginMutation();
					try {
						const snapshots = await Promise.all(guards.map(guard => transaction.get(guard.ref)));
						for (let index = 0; index < guards.length; index++) {
							const guard = guards[index];
							const snapshot = snapshots[index];
							if (!snapshot.exists()) throw new Error('A card was deleted while this save was being prepared. Your edit was not saved.');
							const server = snapshot.data();
							const changedExpectedFields = Object.keys(guard.expected || {}).filter(field => !deepEqual(server[field], guard.expected![field]));
							if (changedExpectedFields.length) throw new Error('This card changed while its links were being repaired. The repair will retry using the latest card.');
							const base = Object.fromEntries(Object.keys(guard.desired).map(field => [field, guard.base[field]]));
							const conflicts = overwrittenCardFields(guard.desired, {[guard.ref.id]: base}, {[guard.ref.id]: server}, [guard.ref.id], {images: DEFAULT_IMAGE as unknown as {[key: string]: unknown}});
							if (conflicts.length) throw new Error(overwriteConflictMessage(conflicts));
						}
						for (const operation of replay.get(batch)!) operation(transaction);
					} finally {
						finishAttempt();
					}
				}));
			},
			preprocessData: installServerTimestamps,
			writeCountForUpdate: (update: object) => {
				for (const val of Object.values(update)) {
					if (extraOperationCountForValue(val)) return 2;
				}
				return 1;
			},
			cardWriteGuard: {
				cardsCollection: CARDS_COLLECTION,
				refPath: (ref : DocumentReference) => ref.path,
				isServerTimestampValue: (value : unknown) => isServerTimestampSentinel(value as FirestoreLeafValue),
			},
		}, EFFECTIVE_BATCH_LIMIT, batchID);
		this._protectedContent = protectedContent;
	}

	//Opt in with the authoritative planning snapshot, before adding writes.
	//Only whole-value content fields actually written by this batch are checked;
	//additive tags/references and unrelated content changes keep their fast path.
	protectCardContent(ref: DocumentReference, base: object) {
		const existing = this._protectedContent.get(ref.path);
		const guard : CardFieldGuard = existing || {ref, base: {...base}, desired: {}, groupIDs: this._atomicGroupID ? new Set() : undefined};
		if (!this._atomicGroupID) guard.groupIDs = undefined;
		else guard.groupIDs?.add(this._atomicGroupID);
		this._protectedContent.set(ref.path, guard);
	}

	//Fanout repair can depend on source fields without rewriting the source.
	//Pin those fields to the planning snapshot in the same transaction as the
	//repair, so a concurrent membership edit cannot revive a stale mirror.
	protectCardFields(ref: DocumentReference, expected: {[field: string]: unknown}) {
		const guard = this._protectedContent.get(ref.path) || {ref, base: {}, desired: {}};
		guard.expected = {...guard.expected, ...expected};
		//An explicit dependency can protect fanout that never writes the source
		//document, so it applies to every underlying batch in this operation.
		guard.groupIDs = undefined;
		this._protectedContent.set(ref.path, guard);
	}

	override async commit() : Promise<void> {
		//Claim immediately before the first SDK write can begin. If ownership was
		//lost while a workflow assembled this local batch, the fence cancels it
		//without sending any write; once commit starts, handoff waits for it. A
		//The resulting MutationFencedError is important to callers: a workflow
		//must never continue as though a requested write succeeded.
		const finishMutation = beginMutation();
		try {
			await super.commit();
		} finally {
			finishMutation();
		}
	}
}

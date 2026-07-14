//The limit that Firebase enacts for writes in one batch. MultiBatch will count
//writes correctly, including double-counting updates that use one of the
//readback sentinels.

import {
	getObjectPath,
	objectPathToValue,
} from './util.js';

import {
	installServerTimestamps,
	isServerTimestampSentinel
} from './firebase.js';

import {
	serverTimestamp,
	arrayUnion,
	writeBatch,
	Firestore,
	WriteBatch,
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
export class MultiBatch extends MultiBatchBase<WriteBatch, DocumentReference> {

	constructor(db : Firestore) {
		super({
			createBatch: () => writeBatch(db),
			batchSet: (batch, ref, data, options?) => batch.set(ref, data, (options as SetOptions) || {}),
			batchUpdate: (batch, ref, data) => batch.update(ref, data),
			batchDelete: (batch, ref) => batch.delete(ref),
			commitBatch: (batch) => batch.commit(),
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
		}, EFFECTIVE_BATCH_LIMIT);
	}
}

//The limit that Firebase enacts for writes in one batch. MultiBatch will count
//writes correctly, including double-counting updates that use one of the
//readback sentinels.
const FIRESTORE_BATCH_LIMIT = 500;

import {
	randomString,
	getObjectPath,
	objectPathToValue,
} from './util.js';

import {
	installServerTimestamps
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

//MultiBatch is a thing that can be used as a drop-in replacement firebase db
//batch, and will automatically split into multiple underlying batches if it's
//getting close to the limit. Note that unlike a normal batch, it's possible for
//a partial failure if one batch fails and others don't.
export class MultiBatch {

	_db : Firestore;
	_currentBatchOperationCount : number;
	_currentBatch? : WriteBatch;
	_batches : WriteBatch[];
	_id : string;

	constructor(db : Firestore) {
		this._db = db;
		this._currentBatchOperationCount = 0;
		this._currentBatch = null;
		this._batches = [];
		this._id = randomString(8);
	}

	//batchID will return a random string that will be consistent for all of
	//this batch. It's useful to persist in the db, allowing figuring out which
	//modifications were part of the same 'logical' batch, since it's possible
	//that the actual batches will be split up and some will fail and others
	//won't.
	get batchID() {
		return this._id;
	}

	get _batch() : WriteBatch {
		if (this._currentBatchOperationCount >= EFFECTIVE_BATCH_LIMIT) {
			this._currentBatch = null;
		}
		if (!this._currentBatch) {
			this._currentBatch = writeBatch(this._db);
			this._batches.push(this._currentBatch);
			this._currentBatchOperationCount = 0;
		}
		return this._currentBatch;
	}

	_writeCountForUpdate(update : object) : number {
		//Firestore treats updates as counting for 1, unless there are 1 or more
		//of {serverTimestamp, arrayUnion, or arrayRemove}.
		
		for (const val of Object.values(update)) {
			if (extraOperationCountForValue(val)) return 2;
		}
		return 1;
	}

	delete(ref : DocumentReference) {
		this._batch.delete(ref);
		this._currentBatchOperationCount++;
		return this;
	}

	//A wrapper around batch.set that also calls installServerTimestamps on the object
	set(ref : DocumentReference, data : object, options? : SetOptions) {
		data = installServerTimestamps(data);
		this._batch.set(ref, data, options);
		this._currentBatchOperationCount += this._writeCountForUpdate(data);
		return this;
	}

	//A wrapper around batch.update that also calls installServerTimestamps on the object
	update(ref : DocumentReference, data : object) {
		data = installServerTimestamps(data);
		//TODO: the signature in the documentation is kind of weird for this
		//one. Are there two different modes?
		this._batch.update(ref, data);
		this._currentBatchOperationCount += this._writeCountForUpdate(data);
		return this;
	}

	commit() {
		return Promise.all(this._batches.map(batch => batch.commit()));
	}

}
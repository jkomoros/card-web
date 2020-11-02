//The limit that Firebase enacts for writes in one batch. MultiBatch will count
//writes correctly, including double-counting updates that use one of the
//readback sentinels.
const FIRESTORE_BATCH_LIMIT = 500;

//MultiBatch is a thing that can be used as a drop-in replacement firebase db
//batch, and will automatically split into multiple underlying batches if it's
//getting close to the limit. Note that unlike a normal batch, it's possible for
//a partial failure if one batch fails and others don't.
export const MultiBatch = class {
	constructor(db) {
		this._db = db;
		this._currentBatchOperationCount = 0;
		this._currentBatch = null;
		this._batches = [];
	}

	get _batch() {
		if (this._currentBatchOperationCount >= FIRESTORE_BATCH_LIMIT) {
			this._currentBatch = null;
		}
		if (!this._currentBatch) {
			this._currentBatch = this._db.batch();
			this._batches.push(this._currentBatch);
			this._currentBatchOperationCount = 0;
		}
		return this._currentBatch;
	}

	_writeCountForUpdate(update) {
		//Firestore treats updates as counting for 1, unless there are 1 or more
		//of {serverTimestamp, arrayUnion, or arrayRemove}.
		
		//Note: this function is very tied to the implementation of
		//firestore.FieldValue and may need to change if it changes.
		for (let val of Object.values(update)) {
			if (typeof val !== 'object') continue;
			if (!val['lc']) continue;
			if (typeof val['lc'] !== 'string') continue;
			const parts = val['lc'].split('.');
			if (parts.length !== 2) continue;
			if (parts[0] !== 'FieldValue') continue;
			if (parts[1] !== 'serverTimestamp' && parts[1] !== 'arrayRemove' && parts[1] != 'arrayUnion') continue;
			return 2;
		}
		return 1;
	}

	delete(ref) {
		this._batch.delete(ref);
		this._currentBatchOperationCount++;
		return this;
	}

	set(ref, data, options) {
		this._batch.set(ref, data, options);
		this._currentBatchOperationCount += this._writeCountForUpdate(data);
		return this;
	}

	update(ref, data) {
		//TODO: the signature in the documentation is kind of weird for this
		//one. Are there two different modes?
		this._batch.update(ref, data);
		this._currentBatchOperationCount += this._writeCountForUpdate(data);
		return this;
	}

	commit() {
		return Promise.all(this._batches.map(batch => batch.commit()));
	}

};
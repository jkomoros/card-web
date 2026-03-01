// Generic MultiBatchBase for auto-splitting Firestore batches at the 500-op
// limit. Parameterized with batch operations so it works with any SDK.

import {
	randomString
} from './util.js';

const FIRESTORE_BATCH_LIMIT = 500;

// Configuration for SDK-specific batch operations
export interface MultiBatchConfig<TBatch, TRef> {
	createBatch: () => TBatch;
	batchSet: (batch: TBatch, ref: TRef, data: object, options?: object) => void;
	batchUpdate: (batch: TBatch, ref: TRef, data: object) => void;
	batchDelete: (batch: TBatch, ref: TRef) => void;
	commitBatch: (batch: TBatch) => Promise<void>;
	// Optional: preprocess data before writing (e.g. installServerTimestamps)
	preprocessData?: (data: object) => object;
	// Optional: count write operations for sentinel-heavy updates.
	// Returns the number of ops this update counts as (default: 1).
	writeCountForUpdate?: (update: object) => number;
}

export class MultiBatchBase<TBatch, TRef> {

	protected _config: MultiBatchConfig<TBatch, TRef>;
	protected _currentBatchOperationCount: number;
	protected _currentBatch: TBatch | null;
	protected _batches: TBatch[];
	protected _id: string;
	protected _effectiveBatchLimit: number;

	constructor(config: MultiBatchConfig<TBatch, TRef>, effectiveBatchLimit: number = FIRESTORE_BATCH_LIMIT) {
		this._config = config;
		this._currentBatchOperationCount = 0;
		this._currentBatch = null;
		this._batches = [];
		this._id = randomString(8);
		this._effectiveBatchLimit = effectiveBatchLimit;
	}

	get batchID() {
		return this._id;
	}

	protected get _batch(): TBatch {
		if (this._currentBatchOperationCount >= this._effectiveBatchLimit) {
			this._currentBatch = null;
		}
		if (!this._currentBatch) {
			this._currentBatch = this._config.createBatch();
			this._batches.push(this._currentBatch);
			this._currentBatchOperationCount = 0;
		}
		return this._currentBatch;
	}

	protected _writeCountForUpdate(update: object): number {
		if (this._config.writeCountForUpdate) {
			return this._config.writeCountForUpdate(update);
		}
		return 1;
	}

	delete(ref: TRef) {
		this._config.batchDelete(this._batch, ref);
		this._currentBatchOperationCount++;
		return this;
	}

	set(ref: TRef, data: object, options?: object) {
		if (this._config.preprocessData) {
			data = this._config.preprocessData(data);
		}
		this._config.batchSet(this._batch, ref, data, options);
		this._currentBatchOperationCount += this._writeCountForUpdate(data);
		return this;
	}

	update(ref: TRef, data: object) {
		if (this._config.preprocessData) {
			data = this._config.preprocessData(data);
		}
		this._config.batchUpdate(this._batch, ref, data);
		this._currentBatchOperationCount += this._writeCountForUpdate(data);
		return this;
	}

	commit() {
		return Promise.all(this._batches.map(batch => this._config.commitBatch(batch)));
	}
}

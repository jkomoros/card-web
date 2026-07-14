// Generic MultiBatchBase for auto-splitting Firestore batches at the 500-op
// limit. Parameterized with batch operations so it works with any SDK.

import {
	randomString
} from './util.js';

import {
	cardWriteViolation,
	nonBumpCardWriteViolation
} from './card-write-guard.js';

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
	// Optional: enforce the `updated` write-invariant on top-level card docs
	// (docs/corpus-sync-design.md). When present, set/update THROW on a card
	// write that doesn't stamp updated with the SDK's serverTimestamp
	// sentinel, and updateWithoutTimestampBump only admits the reader-counter
	// allowlist. Hosted here in the BASE so both the client SDK MultiBatch
	// (src/multi_batch.ts) and the admin one (tools/mount.ts) enforce the
	// same policy — the invariant must not depend on which SDK writes.
	cardWriteGuard?: {
		cardsCollection: string;
		refPath: (ref: TRef) => string;
		isServerTimestampValue: (value: unknown) => boolean;
	};
}

//A logical MultiBatch can span several independent Firestore batches. Keep
//the partial-success information when one or more of those commits fail so
//callers can reconcile against the server instead of assuming an all-or-none
//outcome.
export class MultiBatchCommitError extends Error {
	readonly succeededBatchCount: number;
	readonly failedBatchCount: number;
	readonly reasons: unknown[];

	constructor(succeededBatchCount: number, reasons: unknown[]) {
		const detail = reasons.length === 1 ? `: ${String(reasons[0])}` : '';
		super(`${reasons.length} of ${succeededBatchCount + reasons.length} Firestore batches failed${detail}`);
		this.name = 'MultiBatchCommitError';
		this.succeededBatchCount = succeededBatchCount;
		this.failedBatchCount = reasons.length;
		this.reasons = reasons;
	}
}

export class MultiBatchBase<TBatch, TRef> {

	protected _config: MultiBatchConfig<TBatch, TRef>;
	protected _currentBatchOperationCount: number;
	protected _currentBatch: TBatch | null;
	protected _batches: TBatch[];
	protected _id: string;
	protected _effectiveBatchLimit: number;
	protected _atomicGroup: {count: number, apply: (batch: TBatch) => void}[] | null;

	constructor(config: MultiBatchConfig<TBatch, TRef>, effectiveBatchLimit: number = FIRESTORE_BATCH_LIMIT) {
		this._config = config;
		this._currentBatchOperationCount = 0;
		this._currentBatch = null;
		this._batches = [];
		this._id = randomString(8);
		this._effectiveBatchLimit = effectiveBatchLimit;
		this._atomicGroup = null;
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

	protected _queueOperation(count: number, apply: (batch: TBatch) => void) {
		if (this._atomicGroup) {
			this._atomicGroup.push({count, apply});
			return;
		}
		apply(this._batch);
		this._currentBatchOperationCount += count;
	}

	//Buffer a logical unit of writes until its total size is known. endAtomicGroup
	//then places the whole unit in one underlying Firestore batch, rolling to a
	//fresh batch first when necessary. This preserves the efficiency of packed
	//multi-card commits without ever bisecting one card's denormalized writes.
	beginAtomicGroup() {
		if (this._atomicGroup) throw new Error('MultiBatch atomic groups cannot be nested');
		this._atomicGroup = [];
	}

	endAtomicGroup() {
		if (!this._atomicGroup) throw new Error('No MultiBatch atomic group is active');
		const operations = this._atomicGroup;
		this._atomicGroup = null;
		const count = operations.reduce((total, operation) => total + operation.count, 0);
		if (count > this._effectiveBatchLimit) {
			throw new Error(`Atomic write group requires ${count} operations; Firestore limit is ${this._effectiveBatchLimit}`);
		}
		if (!count) return;
		if (this._currentBatch && this._currentBatchOperationCount + count > this._effectiveBatchLimit) {
			this._currentBatch = null;
			this._currentBatchOperationCount = 0;
		}
		const batch = this._batch;
		for (const operation of operations) operation.apply(batch);
		this._currentBatchOperationCount += count;
	}

	abortAtomicGroup() {
		if (!this._atomicGroup) return;
		this._atomicGroup = null;
	}

	delete(ref: TRef) {
		this._queueOperation(1, batch => this._config.batchDelete(batch, ref));
		return this;
	}

	protected _assertCardWriteAllowed(ref: TRef, data: object, noBump: boolean) {
		const guard = this._config.cardWriteGuard;
		if (!guard) return;
		const path = guard.refPath(ref);
		const violation = noBump
			? nonBumpCardWriteViolation(path, guard.cardsCollection, Object.keys(data))
			: cardWriteViolation(path, guard.cardsCollection, guard.isServerTimestampValue((data as {updated?: unknown}).updated));
		if (violation) throw new Error(violation);
	}

	set(ref: TRef, data: object, options?: object) {
		this._assertCardWriteAllowed(ref, data, false);
		if (this._config.preprocessData) {
			data = this._config.preprocessData(data);
		}
		const count = this._writeCountForUpdate(data);
		this._queueOperation(count, batch => this._config.batchSet(batch, ref, data, options));
		return this;
	}

	update(ref: TRef, data: object) {
		this._assertCardWriteAllowed(ref, data, false);
		if (this._config.preprocessData) {
			data = this._config.preprocessData(data);
		}
		const count = this._writeCountForUpdate(data);
		this._queueOperation(count, batch => this._config.batchUpdate(batch, ref, data));
		return this;
	}

	//The EXPLICIT, audited escape hatch for the reader-counter writers whose
	//rules branches forbid touching `updated` (see card-write-guard.ts's
	//allowlist). Throws if the write touches anything beyond the counters —
	//the hatch is not an opt-out for real content.
	updateWithoutTimestampBump(ref: TRef, data: object) {
		this._assertCardWriteAllowed(ref, data, true);
		if (this._config.preprocessData) {
			data = this._config.preprocessData(data);
		}
		const count = this._writeCountForUpdate(data);
		this._queueOperation(count, batch => this._config.batchUpdate(batch, ref, data));
		return this;
	}

	async commit(): Promise<void> {
		//Do not use Promise.all here. It rejects as soon as the first batch
		//fails, while the other independent commits can still be in flight. A
		//caller that immediately rolls back or refetches can then race those
		//late commits and "recover" to a state that was never authoritative.
		if (this._atomicGroup) throw new Error('Cannot commit while a MultiBatch atomic group is active');
		const results = await Promise.allSettled(this._batches.map(batch => Promise.resolve().then(() => this._config.commitBatch(batch))));
		const reasons = results
			.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
			.map(result => result.reason);
		if (reasons.length) {
			throw new MultiBatchCommitError(results.length - reasons.length, reasons);
		}
	}
}
